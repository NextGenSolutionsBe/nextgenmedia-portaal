import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { insertResilient } from '@/lib/supabase/server'
import { logLeadEvent } from '@/lib/sales/service'
import { stageLabel } from '@/lib/sales/stages'
import {
  ACTIVITEIT_LABEL, formatDuur, isActiviteitType, uitkomstLabel, type ActiviteitType,
} from '@/lib/sales/activiteiten-model'

/**
 * Eén activiteit registreren: in sales_activiteiten (waar de statistieken op
 * draaien) ÉN als regel op de tijdlijn (sales_lead_events), zodat het
 * detailpaneel niets nieuws hoeft te leren.
 *
 * De tijdlijnregel wordt ALTIJD geschreven; de activiteitenrij is best-effort.
 * Bestaat de tabel nog niet (migratie niet gedraaid), dan blijft de app gewoon
 * werken — enkel de statistiek mist die rij tot de migratie er is.
 */
export type NieuweActiviteit = {
  leadId: string
  medewerkerId: string | null
  medewerkerEmail: string | null
  type: ActiviteitType
  duurSeconden?: number | null
  uitkomst?: string | null
  notitie?: string | null
  /** JJJJ-MM-DD */
  opvolgdatum?: string | null
  vanFase?: string | null
  naarFase?: string | null
  afspraakId?: string | null
  /** Extra tekst voor de tijdlijn (bv. bedrag bij een gewonnen deal). */
  extra?: string | null
}

const KIND: Record<ActiviteitType, 'call' | 'note' | 'stage' | 'system'> = {
  telefoongesprek: 'call',
  interne_notitie: 'note',
  fase_gewijzigd: 'stage',
  email_verstuurd: 'system',
  lead_afgehandeld: 'system',
  opvolging: 'system',
  afspraak_gepland: 'system',
  voorstel_verstuurd: 'system',
  deal_gewonnen: 'system',
  deal_verloren: 'system',
}

const datumTekst = (d: string | null | undefined): string => {
  if (!d) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

/** Wat er op de tijdlijn komt te staan. */
export function tijdlijnTekst(a: NieuweActiviteit): string | null {
  const notitie = (a.notitie ?? '').trim()
  const stukken: string[] = []
  switch (a.type) {
    case 'telefoongesprek':
      stukken.push('Gebeld')
      if (a.uitkomst) stukken.push(uitkomstLabel(a.uitkomst))
      if (a.duurSeconden !== null && a.duurSeconden !== undefined) stukken.push(formatDuur(a.duurSeconden))
      break
    case 'email_verstuurd': stukken.push('E-mail verstuurd'); break
    case 'lead_afgehandeld': stukken.push('Lead afgehandeld'); break
    case 'opvolging': stukken.push(a.opvolgdatum ? `Opvolgdatum: ${datumTekst(a.opvolgdatum)}` : 'Opvolgdatum gewist'); break
    case 'afspraak_gepland': stukken.push('Afspraak gepland'); break
    case 'voorstel_verstuurd': stukken.push('Voorstel verstuurd'); break
    case 'deal_gewonnen': stukken.push('Gewonnen'); break
    case 'deal_verloren': stukken.push('Verloren'); break
    case 'interne_notitie': return notitie || null
    case 'fase_gewijzigd':
      // Een fasewissel heeft richting in from/to; de tekst blijft leeg tenzij
      // er iets bij gezegd werd.
      return notitie || (a.extra ?? null)
  }
  if (a.extra) stukken.push(a.extra)
  if (a.naarFase) stukken.push(`→ ${stageLabel(a.naarFase)}`)
  const kop = stukken.join(' · ')
  return notitie ? `${kop}\n${notitie}` : kop
}

export async function registreerActiviteit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>,
  a: NieuweActiviteit,
): Promise<{ id: string | null }> {
  // 1) De activiteit zelf (best-effort, zie boven).
  let id: string | null = null
  try {
    const { data, error } = await insertResilient(admin, 'sales_activiteiten', {
      lead_id: a.leadId,
      medewerker_id: a.medewerkerId,
      medewerker_email: a.medewerkerEmail,
      type: a.type,
      duur_seconden: a.duurSeconden ?? null,
      uitkomst: a.uitkomst ?? null,
      notitie: (a.notitie ?? '').trim() || null,
      opvolgdatum: a.opvolgdatum ?? null,
      naar_fase: a.naarFase ?? null,
      afspraak_id: a.afspraakId ?? null,
    }, { required: ['lead_id', 'type'] })
    if (error) {
      if (!/sales_activiteiten|does not exist|schema cache|relation/i.test(error.message)) {
        console.error('[sales] activiteit registreren mislukt:', error.message)
      }
    } else {
      id = (data?.id as string | undefined) ?? null
    }
  } catch (e) {
    console.error('[sales] activiteit registreren mislukt:', e instanceof Error ? e.message : e)
  }

  // 2) De tijdlijn — altijd. Op de kaart komt enkel de INTERNE NOTITIE als
  //    "laatste notitie", niet de gesprekskop ("Gebeld · Voicemail"): die zegt
  //    niets over wat er besproken is.
  const notitie = (a.notitie ?? '').trim()
  await logLeadEvent(a.leadId, {
    kind: KIND[a.type],
    body: tijdlijnTekst(a),
    fromStage: a.type === 'fase_gewijzigd' ? a.vanFase ?? null : null,
    toStage: a.type === 'fase_gewijzigd' ? a.naarFase ?? null : null,
    actorId: a.medewerkerId,
    actorEmail: a.medewerkerEmail,
    laatsteNotitie: notitie ? notitie : false,
  })

  return { id }
}

export const activiteitLabel = (t: ActiviteitType): string => ACTIVITEIT_LABEL[t]

// ── Aanpassen en verwijderen: de tijdlijn mee rechtzetten ───────────────────
//
// Een activiteit staat twee keer: in sales_activiteiten (statistiek) en als
// regel op de tijdlijn. Zonder deze stap bleef een verwijderde notitie gewoon
// op de tijdlijn en op de kaart ("laatste notitie") staan — dan lijkt het alsof
// verwijderen niet werkt. Alles hier is best-effort: de activiteit zelf is dan
// al aangepast, en de statistiek kijkt enkel naar sales_activiteiten.

export type ActiviteitRij = {
  id: string
  lead_id: string
  medewerker_id: string | null
  type: string
  notitie: string | null
  uitkomst: string | null
  duur_seconden: number | null
  opvolgdatum: string | null
  naar_fase: string | null
  created_at: string
}

export const ACTIVITEIT_RIJ_KOLOMMEN =
  'id, lead_id, medewerker_id, type, notitie, uitkomst, duur_seconden, opvolgdatum, naar_fase, created_at'

function alsNieuw(a: ActiviteitRij): NieuweActiviteit | null {
  if (!isActiviteitType(a.type)) return null
  return {
    leadId: a.lead_id, medewerkerId: a.medewerker_id, medewerkerEmail: null, type: a.type,
    duurSeconden: a.duur_seconden, uitkomst: a.uitkomst, notitie: a.notitie,
    opvolgdatum: a.opvolgdatum, naarFase: a.naar_fase,
  }
}

/**
 * De tijdlijnregel die bij deze activiteit hoort. Er is geen rechtstreekse
 * koppeling, dus: zelfde lead, soort en auteur, vlak na het aanmaken, en bij
 * voorkeur exact dezelfde tekst. Twijfel (meerdere kandidaten, geen exacte
 * match) → niets aanraken; liever een regel te veel dan de verkeerde weg.
 */
async function zoekTijdlijnRegel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>, a: ActiviteitRij,
): Promise<{ id: string } | null> {
  const nieuw = alsNieuw(a)
  const t = new Date(a.created_at).getTime()
  if (!nieuw || !Number.isFinite(t)) return null
  const { data, error } = await admin.from('sales_lead_events')
    .select('id, body, actor_id, created_at')
    .eq('lead_id', a.lead_id).eq('kind', KIND[nieuw.type])
    .gte('created_at', new Date(t - 5_000).toISOString())
    .lte('created_at', new Date(t + 60_000).toISOString())
    .order('created_at', { ascending: true }).limit(20)
  if (error || !data) return null
  const kandidaten = (data as { id: string; body: string | null; actor_id: string | null }[])
    .filter((r) => !a.medewerker_id || !r.actor_id || r.actor_id === a.medewerker_id)
  const verwacht = (tijdlijnTekst(nieuw) ?? '').trim()
  const exact = kandidaten.find((r) => (r.body ?? '').trim() === verwacht)
  if (exact) return exact
  return kandidaten.length === 1 ? kandidaten[0] : null
}

/**
 * Stond de tekst van deze activiteit als "laatste notitie" op de kaart, zoek
 * dan de vorige echte notitie op de tijdlijn op (of maak het veld leeg).
 */
async function herberekenLaatsteNotitie(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>, leadId: string, oudeTekst: string | null,
): Promise<void> {
  const oud = (oudeTekst ?? '').trim().slice(0, 300)
  if (!oud) return
  const { data: lead, error } = await admin.from('sales_leads').select('laatste_notitie').eq('id', leadId).maybeSingle()
  if (error || !lead) return
  if (((lead as { laatste_notitie: string | null }).laatste_notitie ?? '').trim() !== oud) return
  const { data: ev } = await admin.from('sales_lead_events')
    .select('kind, body, created_at').eq('lead_id', leadId).in('kind', ['note', 'call'])
    .order('created_at', { ascending: false }).limit(25)
  let tekst: string | null = null
  let op: string | null = null
  for (const e of (ev ?? []) as { kind: string; body: string | null; created_at: string }[]) {
    const body = (e.body ?? '').trim()
    // Bij een gesprek staat de notitie onder de kop ("Gebeld · Voicemail").
    const nl = body.indexOf('\n')
    const t = e.kind === 'note' ? body : (nl >= 0 ? body.slice(nl + 1).trim() : '')
    if (t) { tekst = t.slice(0, 300); op = e.created_at; break }
  }
  await admin.from('sales_leads').update({ laatste_notitie: tekst, laatste_notitie_op: op }).eq('id', leadId)
}

/** Na een zachte verwijdering: de tijdlijnregel neutraliseren. */
export async function tijdlijnNaVerwijderen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>, a: ActiviteitRij, door: string | null,
): Promise<void> {
  try {
    const regel = await zoekTijdlijnRegel(admin, a)
    if (regel) {
      const label = isActiviteitType(a.type) ? ACTIVITEIT_LABEL[a.type] : 'Activiteit'
      await admin.from('sales_lead_events')
        .update({ kind: 'system', body: `${label} verwijderd${door ? ` door ${door.split('@')[0]}` : ''}` })
        .eq('id', regel.id)
    }
    await herberekenLaatsteNotitie(admin, a.lead_id, a.notitie)
  } catch (e) {
    console.error('[sales] tijdlijn na verwijderen:', e instanceof Error ? e.message : e)
  }
}

/** Na een aanpassing: de tijdlijnregel dezelfde tekst geven. */
export async function tijdlijnNaAanpassen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>, oud: ActiviteitRij, nieuw: ActiviteitRij,
): Promise<void> {
  try {
    const regel = await zoekTijdlijnRegel(admin, oud)
    const n = alsNieuw(nieuw)
    if (regel && n) {
      const body = tijdlijnTekst(n)
      if (body) await admin.from('sales_lead_events').update({ body }).eq('id', regel.id)
    }
    if ((oud.notitie ?? '') !== (nieuw.notitie ?? '')) {
      await herberekenLaatsteNotitie(admin, oud.lead_id, oud.notitie)
    }
  } catch (e) {
    console.error('[sales] tijdlijn na aanpassen:', e instanceof Error ? e.message : e)
  }
}
