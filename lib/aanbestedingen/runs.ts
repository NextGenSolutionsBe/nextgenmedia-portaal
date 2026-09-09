import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

/**
 * Runs: de voortgang van ophalen, beoordelen en uitwerken — en het annuleren.
 *
 * Waarom via de database en niet via het afbreken van de aanvraag: die drie
 * taken draaien als één lange HTTP-aanvraag op de server. Het venster sluiten
 * of de verbinding verbreken stopt dat werk NIET; het loopt gewoon door en
 * blijft tokens uitgeven. Daarom vraagt annuleren een vlag aan in de database,
 * en kijkt de lopende taak daar tussen twee stappen naar.
 *
 * Gevolg: annuleren is nooit onmiddellijk. Wat al bezig is wordt afgemaakt —
 * één AI-oproep, één pagina opdrachten — en daarna stopt hij netjes. Dat is met
 * opzet: halverwege afbreken zou een half weggeschreven dossier opleveren.
 */

export type RunFase = 'ophalen' | 'scoren' | 'analyseren'

/** Een run die langer dan dit stilstaat is niet meer bezig, maar gestorven —
 *  de serverfunctie stopt na vijf minuten. Zonder deze grens blijft een
 *  gecrashte run voor altijd "bezig" en kan je niets meer starten. */
const DOOD_NA_MS = 6 * 60 * 1000

export async function startRun(
  filterId: string, fase: RunFase, omschrijving: string, door: string,
): Promise<string | null> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('aanbesteding_runs').insert({
    filter_id: filterId,
    status: 'bezig',
    fase,
    omschrijving,
    aangevraagd_door: door,
    gestart_op: new Date().toISOString(),
  }).select('id').single()
  return (data as { id: string } | null)?.id ?? null
}

export async function updateRun(runId: string | null, velden: Record<string, unknown>) {
  if (!runId) return
  const admin = createAdminSupabaseClient()
  await admin.from('aanbesteding_runs').update(velden).eq('id', runId)
}

/**
 * Is het annuleren gevraagd? Wordt tussen stappen gepolst.
 *
 * Faalt de lezing (netwerk, database even weg), dan zeggen we NEE en gaat het
 * werk door. Doorgaan is hier het veilige antwoord: bij ja stoppen we werk dat
 * de gebruiker wél wilde.
 */
export async function isGeannuleerd(runId: string | null): Promise<boolean> {
  if (!runId) return false
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from('aanbesteding_runs')
      .select('annuleren_gevraagd')
      .eq('id', runId)
      .maybeSingle()
    return (data as { annuleren_gevraagd: boolean } | null)?.annuleren_gevraagd === true
  } catch {
    return false
  }
}

export async function rondAf(
  runId: string | null, status: 'klaar' | 'mislukt' | 'geannuleerd', resultaat: string,
) {
  await updateRun(runId, {
    status, fase: '', resultaat, omschrijving: '', klaar_op: new Date().toISOString(),
  })
}

export type ActieveRun = {
  id: string
  fase: string
  stap_nu: number
  stap_totaal: number
  omschrijving: string
  annuleren_gevraagd: boolean
  gestart_op: string | null
}

/**
 * De run die nu bezig is voor deze workspace, of null.
 *
 * Een run die al langer dan zes minuten "bezig" staat rekenen we als gestorven
 * en zetten we meteen op mislukt. Anders blijft het scherm eeuwig draaien op
 * werk dat allang weg is.
 */
export async function actieveRun(filterId: string): Promise<ActieveRun | null> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('aanbesteding_runs')
    .select('id, fase, stap_nu, stap_totaal, omschrijving, annuleren_gevraagd, gestart_op')
    .eq('filter_id', filterId)
    .eq('status', 'bezig')
    .order('aangevraagd_op', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null

  const run = data as ActieveRun
  const gestart = run.gestart_op ? new Date(run.gestart_op).getTime() : 0
  if (gestart && Date.now() - gestart > DOOD_NA_MS) {
    await rondAf(run.id, 'mislukt', 'Afgebroken: de taak is stilgevallen (tijdslimiet van de server).')
    return null
  }
  return run
}

/** De laatste afgeronde run, voor de melding onder de kaart. */
export async function laatsteRun(filterId: string) {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('aanbesteding_runs')
    .select('fase, status, resultaat, klaar_op')
    .eq('filter_id', filterId)
    .neq('status', 'bezig')
    .order('aangevraagd_op', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data ?? null) as { fase: string; status: string; resultaat: string; klaar_op: string | null } | null
}
