import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function assertAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (data?.role !== 'admin' && !(await isActiveStaff(user.id))) throw new Error('Geen toegang')
  return user
}

// "YYYY-MM" → { start, end, lastDay }. Maand = 1-12.
function monthInfo(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) throw new Error('Ongeldige maand')
  const lastDay = new Date(y, m, 0).getDate()        // dag 0 van volgende maand = laatste dag
  const pad = (n: number) => String(n).padStart(2, '0')
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}`, lastDay }
}

// Verzet ALLE content van één maand naar een andere maand voor één klant.
// De dag-in-de-maand blijft behouden; bestaat die dag niet in de doelmaand
// (bv. 31 → maand met 30 dagen), dan wordt geklemd op de laatste dag.
export async function POST(req: NextRequest) {
  try {
    await assertAdmin()
    const admin = createAdminSupabaseClient()
    const { clientId, from, to } = await req.json()
    if (!clientId) throw new Error('Geen klant')
    if (!from || !to) throw new Error('Kies een bron- en doelmaand')
    if (from === to) throw new Error('Bron- en doelmaand zijn gelijk')

    const fromM = monthInfo(from)
    const toM = monthInfo(to)
    const toPrefix = to // "YYYY-MM"
    const pad = (n: number) => String(n).padStart(2, '0')

    const { data: rows, error } = await admin
      .from('social_content_items')
      .select('id, planned_date')
      .eq('client_id', clientId)
      .gte('planned_date', fromM.start)
      .lte('planned_date', fromM.end)
    if (error) throw new Error(error.message)

    const items = rows ?? []
    if (items.length === 0) {
      return NextResponse.json({ ok: true, moved: 0, updates: [] })
    }

    const updates: { id: string; planned_date: string }[] = []
    for (const it of items) {
      const day = Number(String(it.planned_date).slice(8, 10)) || 1
      const newDay = Math.min(day, toM.lastDay)
      updates.push({ id: it.id, planned_date: `${toPrefix}-${pad(newDay)}` })
    }

    // Eén update per item (verschillende datums) — een maand content is klein.
    for (const u of updates) {
      const { error: upErr } = await admin
        .from('social_content_items')
        .update({ planned_date: u.planned_date })
        .eq('id', u.id)
      if (upErr) throw new Error(upErr.message)
    }

    try {
      revalidatePath('/admin/services/social-media')
      revalidatePath('/portal/social-media')
    } catch { }

    return NextResponse.json({ ok: true, moved: updates.length, updates })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
