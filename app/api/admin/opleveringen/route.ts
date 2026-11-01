import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { laadOpleveringen } from '@/lib/opleveringen-server'
import { MAX_REVISIES_STANDAARD } from '@/lib/opleveringen'

export const dynamic = 'force-dynamic'

const MIST = /oplevering|does not exist|schema cache/i
const HINT = 'De tabellen voor opleveringen bestaan nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

/** GET — alle opleveringen (?archief=1 ook de gearchiveerde), plus klanten en opdrachten om te koppelen. */
export async function GET(req: NextRequest) {
  try {
    if (!(await magIk('opleveringen', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const archief = req.nextUrl.searchParams.get('archief') === '1'
    const [lijst, { data: klanten }, { data: opdrachten }] = await Promise.all([
      laadOpleveringen(admin, { archief }).catch((e) => { if (MIST.test(String(e?.message))) return null; throw e }),
      admin.from('clients').select('id, company_name, contact_name, email').is('archived_at', null).order('company_name'),
      admin.from('opdrachten').select('id, titel, client_id, status').not('client_id', 'is', null).order('created_at', { ascending: false }).limit(500),
    ])
    if (lijst === null) return NextResponse.json({ opleveringen: [], klanten: klanten ?? [], opdrachten: [], hint: HINT })
    return NextResponse.json({ opleveringen: lijst, klanten: klanten ?? [], opdrachten: opdrachten ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'opleveringen.GET') }, { status: 500 }) }
}

/** POST { client_id, titel, omschrijving?, opdracht_id?, max_revisies? } — nieuwe oplevering met een lege eerste versie. */
export async function POST(req: NextRequest) {
  try {
    const persoon = await magIk('opleveringen', 'toevoegen')
    if (!persoon) return NextResponse.json({ error: 'Je mag geen opleveringen toevoegen.' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const titel = String(b.titel ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!titel) return NextResponse.json({ error: 'Geef de oplevering een titel, bv. "Aftermovie zomerfeest".' }, { status: 400 })
    const clientId = String(b.client_id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) return NextResponse.json({ error: 'Kies de klant.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: k } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle()
    if (!k) return NextResponse.json({ error: 'Die klant bestaat niet.' }, { status: 400 })
    const opdracht = /^[0-9a-f-]{36}$/i.test(String(b.opdracht_id ?? '')) ? String(b.opdracht_id) : null
    const max = Number.isInteger(Number(b.max_revisies)) ? Math.max(0, Math.min(10, Number(b.max_revisies))) : MAX_REVISIES_STANDAARD
    const { data: o, error } = await admin.from('opleveringen').insert({
      client_id: clientId, opdracht_id: opdracht, titel, omschrijving: String(b.omschrijving ?? '').trim().slice(0, 4000) || null,
      max_revisies: max, aangemaakt_door: persoon.naam || persoon.email || null,
    }).select('id').single()
    if (error) throw new Error(MIST.test(error.message) ? HINT : error.message)
    const { error: ev } = await admin.from('oplevering_versies').insert({ oplevering_id: (o as { id: string }).id, nummer: 1 })
    if (ev) throw new Error(ev.message)
    return NextResponse.json({ id: (o as { id: string }).id })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'opleveringen.POST') }, { status: 500 }) }
}
