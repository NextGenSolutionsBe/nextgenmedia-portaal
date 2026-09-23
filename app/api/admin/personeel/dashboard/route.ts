import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, magFinancieel, laadTarieven } from '@/lib/personeel/server'
import { bouwDashboard, zonderKosten, type DSessie, type DPlanning } from '@/lib/personeel/dashboard'
import { dagBrussel, periodeBereik, plusDagen, type PeriodeSoort } from '@/lib/personeel/tijd'
import { dagOf, uuidOf, tekst } from '@/lib/personeel/invoer'
import { isMedewerkerType, isSessieStatus, typeLabel } from '@/lib/personeel/model'
import type { Tarief } from '@/lib/personeel/kost'

export const dynamic = 'force-dynamic'

const SOORTEN: PeriodeSoort[] = ['dag', 'week', 'maand', 'kwartaal', 'aangepast']

/**
 * GET ?periode=dag|week|maand|kwartaal|aangepast&anker&van&tot
 *     &personeel_id&type&client_id&project&status
 * Het financiële managementdashboard. Zonder rechten op Financiën krijg je
 * enkel de uren; alle bedragen staan dan op nul.
 */
export async function GET(req: NextRequest) {
  try {
    const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
    const sp = req.nextUrl.searchParams
    const soort = (SOORTEN as string[]).includes(sp.get('periode') ?? '') ? (sp.get('periode') as PeriodeSoort) : 'maand'
    const anker = dagOf(sp.get('anker')) ?? dagBrussel(new Date())
    const periode = periodeBereik(soort, anker, sp.get('van') ?? undefined, sp.get('tot') ?? undefined)
    const financieel = await magFinancieel(g.persoon)
    const filters = {
      personeel_id: uuidOf(sp.get('personeel_id')) ?? undefined,
      type: isMedewerkerType(sp.get('type')) ? sp.get('type')! : undefined,
      client_id: uuidOf(sp.get('client_id')) ?? undefined,
      project: tekst(sp.get('project'), 200) ?? undefined,
      status: isSessieStatus(sp.get('status')) ? sp.get('status')! : undefined,
    }
    const [{ data: mensen }, { data: sessies }, { data: planning }, { data: klanten }] = await Promise.all([
      g.admin.from('personeel').select('id, voornaam, achternaam, type, actief, functie').order('voornaam'),
      g.admin.from('personeel_sessies').select('id, personeel_id, start_at, eind_at, pauzes, status, client_id, project, kost_bedrag').gte('start_at', `${plusDagen(periode.van, -1)}T00:00:00Z`).lte('start_at', `${plusDagen(periode.tot, 1)}T23:59:59Z`).limit(10000),
      g.admin.from('personeel_planning').select('id, personeel_id, datum, start_tijd, eind_tijd, status, client_id, project').gte('datum', periode.van).lte('datum', periode.tot).limit(10000),
      g.admin.from('clients').select('id, company_name').order('company_name').limit(2000),
    ])
    const lijst = (mensen ?? []) as { id: string; voornaam: string; achternaam: string | null; type: string; actief: boolean; functie: string | null }[]
    const tarieven = new Map<string, Tarief[]>()
    if (financieel) for (const m of lijst) tarieven.set(m.id, await laadTarieven(g.admin, m.id))
    const klantNaam = new Map(((klanten ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
    let d = bouwDashboard({
      medewerkers: lijst.map((m) => ({ id: m.id, naam: [m.voornaam, m.achternaam].filter(Boolean).join(' '), type: m.type, actief: m.actief !== false, functie: m.functie })),
      tarieven, sessies: (sessies ?? []) as DSessie[], planning: (planning ?? []) as DPlanning[], periode, filters,
      klantNaam: (id) => (id ? klantNaam.get(id) ?? 'Onbekende klant' : 'Geen klant'),
    })
    d = { ...d, perType: d.perType.map((r) => ({ ...r, label: typeLabel(r.sleutel) })) }
    if (!financieel) d = zonderKosten(d)
    return NextResponse.json({
      ...d, periode, soort, anker, magFinancieel: financieel,
      keuzes: { medewerkers: lijst.map((m) => ({ id: m.id, naam: [m.voornaam, m.achternaam].filter(Boolean).join(' ') })), klanten: klanten ?? [] },
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
