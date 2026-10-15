import { NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid, BUCKET } from '@/lib/personeel/server'
import { SESSIE_KOLOMMEN, PLANNING_KOLOMMEN, sessieVoorMedewerker, planningVoorMedewerker, profielVoorMedewerker, bevatFinancieel } from '@/lib/personeel/rechten'
import { dagBrussel, plusDagen } from '@/lib/personeel/tijd'

export const dynamic = 'force-dynamic'

/**
 * GET — het startscherm van de medewerker: eigen profiel, de lopende sessie,
 * de planning van vandaag en de komende dagen, recente sessies en het aantal
 * ongelezen meldingen. Nooit financiële gegevens of adminnotities.
 */
export async function GET() {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const { lid, admin } = g
    const vandaag = dagBrussel(new Date())
    const [actief, planning, recent, meldingen, klanten] = await Promise.all([
      admin.from('personeel_sessies').select(SESSIE_KOLOMMEN).eq('personeel_id', lid.id).eq('status', 'actief').maybeSingle(),
      admin.from('personeel_planning').select(PLANNING_KOLOMMEN).eq('personeel_id', lid.id).neq('status', 'geannuleerd').gte('datum', plusDagen(vandaag, -7)).lte('datum', plusDagen(vandaag, 14)).order('datum').order('start_tijd'),
      admin.from('personeel_sessies').select(SESSIE_KOLOMMEN).eq('personeel_id', lid.id).neq('status', 'actief').order('start_at', { ascending: false }).limit(5),
      admin.from('personeel_meldingen').select('id', { count: 'exact', head: true }).eq('personeel_id', lid.id).is('gelezen_op', null),
      admin.from('clients').select('id, company_name').limit(2000),
    ])
    const klantNaam = new Map(((klanten.data ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
    const metKlant = (r: Record<string, unknown> | null) => (r ? { ...r, klant: r.client_id ? klantNaam.get(String(r.client_id)) ?? null : null } : null)
    let fotoUrl: string | null = null
    if (lid.profielfoto_pad) fotoUrl = (await admin.storage.from(BUCKET).createSignedUrl(lid.profielfoto_pad, 3600)).data?.signedUrl ?? null
    const antwoord = {
      profiel: { ...profielVoorMedewerker(lid as unknown as Record<string, unknown>), foto_url: fotoUrl },
      actief: metKlant(sessieVoorMedewerker(actief.data as Record<string, unknown> | null)),
      planning: ((planning.data ?? []) as unknown as Record<string, unknown>[]).map((p) => metKlant(planningVoorMedewerker(p))),
      recent: ((recent.data ?? []) as unknown as Record<string, unknown>[]).map((s) => metKlant(sessieVoorMedewerker(s))),
      ongelezen: meldingen.count ?? 0,
      vandaag,
    }
    // Laatste vangnet: er mag nooit een financieel veld naar de medewerker gaan.
    if (bevatFinancieel(antwoord)) return NextResponse.json({ error: 'Interne fout: onverwachte gegevens.' }, { status: 500 })
    return NextResponse.json(antwoord)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
