import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { CATEGORIEEN, type Nieuwsbrief } from '@/lib/nieuwsbrieven'
import { metExtra, uniekeSlug } from '@/lib/nieuwsbrieven-server'

export const dynamic = 'force-dynamic'

/** Nieuwsbrieven. GET → alle (concepten en gepubliceerd). POST → nieuw concept. */
export async function GET() {
  if (!(await magIk('nieuwsbrieven', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
  const { data, error } = await createAdminSupabaseClient().from('nieuwsbrieven').select('*').order('created_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ error: safeMessage(error, 'nieuwsbrieven.GET') }, { status: 500 })
  return NextResponse.json({ nieuwsbrieven: ((data ?? []) as Nieuwsbrief[]).map(metExtra) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  try {
    const persoon = await magIk('nieuwsbrieven', 'toevoegen')
    if (!persoon) return NextResponse.json({ error: 'Je mag geen nieuwsbrieven maken.' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { titel?: string; categorie?: string }
    const titel = String(b.titel ?? '').trim().slice(0, 160) || 'Nieuwe nieuwsbrief'
    const categorie = CATEGORIEEN.some((c) => c.key === b.categorie) ? b.categorie : 'projecten'
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('nieuwsbrieven').insert({ titel, slug: await uniekeSlug(admin, titel), categorie, status: 'concept', auteur_naam: persoon.naam ?? null, created_by: persoon.userId }).select('*').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ nieuwsbrief: metExtra(data as Nieuwsbrief) })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'nieuwsbrieven.POST') }, { status: 500 }) }
}
