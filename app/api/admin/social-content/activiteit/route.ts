import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createClient, createAdminSupabaseClient, isActiveStaff } from '@/lib/supabase/server'
import { leesContentActiviteit, plaatsOpmerking } from '@/lib/content/kalender-beheer-server'
import { opmerkingTekst } from '@/lib/content/kalender-rol'

export const dynamic = 'force-dynamic'

async function intern() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { fout: NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 }) }
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (data?.role !== 'admin' && !(await isActiveStaff(user.id))) return { fout: NextResponse.json({ error: 'Geen toegang' }, { status: 403 }) }
  return { user }
}

/** GET ?item=<id> — activiteit en opmerkingen van één contentitem (wie, wanneer, wat), voor het detailpaneel. */
export async function GET(req: NextRequest) {
  try {
    const i = await intern(); if (i.fout) return i.fout
    const id = req.nextUrl.searchParams.get('item') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Onbekend item' }, { status: 400 })
    return NextResponse.json({ activiteit: await leesContentActiviteit(createAdminSupabaseClient(), id) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** POST {item, tekst} — opmerking van NextGenMedia bij een item; de klant ziet ze in het portaal. */
export async function POST(req: NextRequest) {
  try {
    const i = await intern(); if (i.fout) return i.fout
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = String(b.item ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Onbekend item' }, { status: 400 })
    let tekst
    try { tekst = opmerkingTekst(b.tekst) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ongeldige opmerking.' }, { status: 400 }) }
    const admin = createAdminSupabaseClient()
    const { data: item } = await admin.from('social_content_items').select('id, client_id').eq('id', id).maybeSingle()
    if (!item) return NextResponse.json({ error: 'Item niet gevonden' }, { status: 404 })
    await plaatsOpmerking(admin, { item_id: item.id, client_id: item.client_id, door: i.user.email ?? null, rol: 'nextgenmedia', tekst })
    return NextResponse.json({ ok: true, activiteit: await leesContentActiviteit(admin, item.id) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
