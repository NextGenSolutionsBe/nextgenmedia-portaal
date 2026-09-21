import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { insertResilient } from '@/lib/supabase/server'
import { logLeadEvent } from '@/lib/sales/service'
import { stageLabel } from '@/lib/sales/stages'
import {
  ACTIVITEIT_LABEL, formatDuur, uitkomstLabel, type ActiviteitType,
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
