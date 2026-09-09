import { zonedToUtc } from '@/lib/sales/availability'

/**
 * Een publicatie van de BDA omzetten naar onze eigen vorm.
 *
 * Pure module: geen netwerk, geen database. Zo is dit los te testen, en dat is
 * nodig ook — de vorm van de BDA-respons is nergens gedocumenteerd.
 */

export const BRUSSELS = 'Europe/Brussels'

export type BdaPublication = Record<string, unknown>

export type Opdracht = {
  referentienummer: string
  dossiernummer: string
  titel: string
  beschrijving: string
  organisatie: string
  cpv_hoofdcode: string
  cpv_hoofd_omschrijving: string
  cpv_bijkomende_codes: string
  aard: string
  procedure: string
  publicatiedatum: string | null
  publicatiedatum_raw: string
  uiterste_indieningsdatum: string | null
  uiterste_indieningsdatum_raw: string
  status: string
  link: string
  bron: string
}

type Vertaald = { language?: string; text?: string }

/**
 * Titels en omschrijvingen zijn meertalig. Nederlands eerst, dan Frans, dan
 * wat er is — Brusselse en federale opdrachten verschijnen vaak enkel in het
 * Frans, en die willen we niet met een lege titel in de lijst.
 */
export function tekstInTaal(items: unknown, taal = 'NL'): string {
  if (!Array.isArray(items)) return ''
  const perTaal = new Map<string, string>()
  for (const raw of items) {
    const i = raw as Vertaald
    if (i?.text) perTaal.set(i.language ?? '', i.text)
  }
  return perTaal.get(taal) ?? perTaal.get('FR') ?? [...perTaal.values()][0] ?? ''
}

/**
 * `vaultSubmissionDeadline` komt binnen als BELGISCHE lokale tijd ZONDER
 * tijdzone ("2026-09-11T09:45:00"). Rechtstreeks als UTC opslaan zou de
 * deadline in de zomer twee uur verschuiven — en dat is precies het soort fout
 * waardoor je een indiening mist.
 */
export function belgischeTijdNaarUtc(raw: string): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null

  // Staat er al een tijdzone in, dan is het onderwerp gesloten.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (!m) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const [, y, mo, d, hh, mi, ss] = m
  const utcMs = zonedToUtc(Number(y), Number(mo), Number(d), Number(hh), Number(mi), BRUSSELS)
  return new Date(utcMs + (Number(ss ?? 0) * 1000)).toISOString()
}

/** 'YYYY-MM-DD' eruit halen; alles anders geeft null in plaats van een fout. */
export function alleenDatum(raw: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((raw ?? '').trim())
  return m ? m[1] : null
}

export function normaliseer(pub: BdaPublication): Opdracht {
  const dossier = (pub.dossier ?? {}) as Record<string, unknown>
  const org = (pub.organisation ?? {}) as Record<string, unknown>
  const cpv = (pub.cpvMainCode ?? {}) as Record<string, unknown>
  const wsId = (pub.publicationWorkspaceId ?? '') as string

  const deadlineRaw = String(pub.vaultSubmissionDeadline ?? '')
  const pubdatumRaw = String(pub.publicationDate ?? '')

  return {
    referentienummer: String(pub.referenceNumber ?? ''),
    dossiernummer: String(dossier.number ?? ''),
    titel: tekstInTaal(dossier.titles),
    beschrijving: tekstInTaal(dossier.descriptions),
    organisatie: tekstInTaal(org.organisationNames),
    cpv_hoofdcode: String(cpv.code ?? ''),
    cpv_hoofd_omschrijving: tekstInTaal(cpv.descriptions),
    cpv_bijkomende_codes: (Array.isArray(pub.cpvAdditionalCodes) ? pub.cpvAdditionalCodes : [])
      .map((c) => String((c as Record<string, unknown>)?.code ?? ''))
      .filter(Boolean)
      .join('; '),
    aard: (Array.isArray(pub.natures) ? pub.natures : []).map(String).join('; '),
    procedure: String(dossier.procurementProcedureType ?? ''),
    publicatiedatum: alleenDatum(pubdatumRaw),
    publicatiedatum_raw: pubdatumRaw,
    uiterste_indieningsdatum: belgischeTijdNaarUtc(deadlineRaw),
    uiterste_indieningsdatum_raw: deadlineRaw,
    status: String(pub.publicationType ?? ''),
    // Het laatste padsegment is de publicationWorkspaceId; die is later nodig
    // om de bestekdocumenten op te halen.
    link: wsId ? `https://www.publicprocurement.be/publication-workspaces/${wsId}` : '',
    bron: 'BDA',
  }
}

/** De workspace-id terug uit een opgeslagen link halen. */
export function workspaceIdUit(link: string): string {
  const m = /publication-workspaces\/([0-9a-f-]{8,})/i.exec(link ?? '')
  return m ? m[1] : ''
}
