import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { meld } from '@/lib/personeel/server'
import { dagBrussel, plusDagen, isVergeten, uurBrussel } from '@/lib/personeel/tijd'
import { VERGETEN_NA_UUR, mapLabel } from '@/lib/personeel/model'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Dagelijkse herinneringen voor Personeel (Vercel Cron, beveiligd met CRON_SECRET):
 *  · werkblok vandaag     → de medewerker
 *  · documenten           → admins: vervalt binnen 30 dagen / vervallen / verplichte map leeg
 * Elke herinnering heeft een vaste sleutel, zodat ze nooit twee keer vertrekt.
 * Of ze in-app en/of per mail gaat, volgt de notificatie-instellingen.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.nextUrl.searchParams.get('key') === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const admin = createAdminSupabaseClient()
  const vandaag = dagBrussel(new Date())
  const teller = { werkblok: 0, documenten: 0 }

  const [{ data: planning }, { data: docs }, { data: mensen }] = await Promise.all([
    admin.from('personeel_planning').select('id, personeel_id, datum, start_tijd, eind_tijd, taak, project').eq('datum', vandaag).neq('status', 'geannuleerd'),
    admin.from('personeel_documenten').select('id, personeel_id, naam, map, vervalt_op, verplicht'),
    admin.from('personeel').select('id, voornaam, achternaam, actief'),
  ])
  const naam = new Map(((mensen ?? []) as { id: string; voornaam: string; achternaam: string | null }[]).map((m) => [m.id, [m.voornaam, m.achternaam].filter(Boolean).join(' ')]))

  for (const p of (planning ?? []) as { id: string; personeel_id: string; start_tijd: string; eind_tijd: string; taak: string | null; project: string | null }[]) {
    await meld(admin, { personeel_id: p.personeel_id, event: 'werkblok_binnenkort', titel: `Vandaag gepland: ${String(p.start_tijd).slice(0, 5)}–${String(p.eind_tijd).slice(0, 5)}`, tekst: `${p.taak ?? p.project ?? 'Werkblok'} — bekijk de briefing in je planning.`, link: '/team/planning', sleutel: `werkblok:${p.id}:${vandaag}` })
    teller.werkblok++
  }
  const binnen30 = plusDagen(vandaag, 30)
  const lijst = (docs ?? []) as { id: string; personeel_id: string; naam: string; map: string; vervalt_op: string | null; verplicht: boolean }[]
  for (const d of lijst) {
    if (!d.vervalt_op || d.vervalt_op > binnen30) continue
    const vervallen = d.vervalt_op < vandaag
    await meld(admin, { personeel_id: null, event: 'documenten', titel: `Document ${vervallen ? 'vervallen' : 'vervalt binnenkort'} — ${naam.get(d.personeel_id) ?? ''}`, tekst: `${d.naam} (${mapLabel(d.map)}) ${vervallen ? 'is vervallen op' : 'vervalt op'} ${d.vervalt_op.split('-').reverse().join('/')}.`, link: `/admin/personeel/${d.personeel_id}?tab=documenten`, sleutel: `doc:${d.id}:${d.vervalt_op}:${vervallen ? 'v' : 'b'}` })
    teller.documenten++
  }
  // Actieve medewerkers zonder overeenkomst in hun dossier.
  for (const m of (mensen ?? []) as { id: string; actief: boolean }[]) {
    if (m.actief === false) continue
    if (lijst.some((d) => d.personeel_id === m.id && d.map === 'overeenkomst')) continue
    await meld(admin, { personeel_id: null, event: 'documenten', titel: `Overeenkomst ontbreekt — ${naam.get(m.id) ?? ''}`, tekst: 'Er staat nog geen arbeids- of studentenovereenkomst in het personeelsdossier.', link: `/admin/personeel/${m.id}?tab=documenten`, sleutel: `doc:ontbreekt:${m.id}:${vandaag.slice(0, 7)}` })
    teller.documenten++
  }
  return NextResponse.json({ ok: true, ...teller })
}
