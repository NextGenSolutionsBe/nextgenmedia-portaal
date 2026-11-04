/**
 * Vesting: akkoord per contract, met een handtekening van elke vennoot.
 *
 * Elk contract dat voor Marco meetelt, tekenen Marco, Bram en Chiara in de app
 * met hun eigen account. Een handtekening hoort bij exact de cijfers die er op
 * dat moment stonden (de inhoud): contractwaarde, kosten, afspraak en closing,
 * en wat er dus meetelt. Wijzigt er daarna iets, dan geldt de handtekening niet
 * meer voor de nieuwe cijfers en tekent iedereen opnieuw. Algemene kosten (zoals
 * de afsluiting van WAM) tekenen we op dezelfde manier.
 *
 * Pure module: draait op de server (controle bij het tekenen, meldingen) en in
 * het scherm (stand per contract).
 */

import type { ContractBerekend, WamKost } from './vesting'
import { leesGetal } from './getal'

export const VENNOTEN = ['marco', 'bram', 'chiara'] as const
export type Vennoot = (typeof VENNOTEN)[number]
export const VENNOOT_NAAM: Record<Vennoot, string> = { marco: 'Marco', bram: 'Bram', chiara: 'Chiara' }

/** Welk account van wie is: `app_settings.vesting_vennoten`. */
export const VENNOTEN_SLEUTEL = 'vesting_vennoten'
export type VennotenInstelling = Record<Vennoot, { naam: string; user_ids: string[] }>

export function leesVennoten(v: unknown): VennotenInstelling {
  const bron = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const uit = {} as VennotenInstelling
  for (const k of VENNOTEN) {
    const r = (bron[k] && typeof bron[k] === 'object' ? bron[k] : {}) as { naam?: unknown; user_ids?: unknown }
    uit[k] = {
      naam: typeof r.naam === 'string' && r.naam.trim() ? r.naam.trim() : VENNOOT_NAAM[k],
      user_ids: Array.isArray(r.user_ids) ? r.user_ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : [],
    }
  }
  return uit
}

export function vennootVan(userId: string | null | undefined, inst: VennotenInstelling): Vennoot | null {
  if (!userId) return null
  return VENNOTEN.find((k) => inst[k].user_ids.includes(userId)) ?? null
}

// ── Kosten per contract ─────────────────────────────────────────────────────

export const KOST_SOORTEN = [
  { key: 'hosting', label: 'Hosting' },
  { key: 'onderaanneming', label: 'Onderaanneming' },
  { key: 'advertentiebudget', label: 'Advertentiebudget' },
  { key: 'software', label: 'Software en licenties' },
  { key: 'andere', label: 'Andere' },
] as const
export type KostSoort = (typeof KOST_SOORTEN)[number]['key']
export const kostSoortLabel = (k: string): string => KOST_SOORTEN.find((s) => s.key === k)?.label ?? 'Andere'
const isKostSoort = (v: unknown): v is KostSoort => KOST_SOORTEN.some((s) => s.key === v)

export type KostLijn = { id: string; vesting_contract_id: string; soort: KostSoort; omschrijving: string | null; bedrag: number }

const rond = (x: number) => Math.round(x * 100) / 100

export function naarKostLijn(r: Record<string, unknown>): KostLijn {
  return {
    id: String(r.id), vesting_contract_id: String(r.vesting_contract_id),
    soort: isKostSoort(r.soort) ? r.soort : 'andere',
    omschrijving: typeof r.omschrijving === 'string' && r.omschrijving.trim() ? r.omschrijving.trim() : null,
    bedrag: Number.isFinite(Number(r.bedrag)) ? rond(Number(r.bedrag)) : 0,
  }
}

/** Een kostenlijn uit een verzoek: soort, omschrijving en een bedrag > 0 (excl. btw). */
export function controleerKostLijn(b: { soort?: unknown; omschrijving?: unknown; bedrag?: unknown }):
  { lijn: { soort: KostSoort; omschrijving: string | null; bedrag: number } } | { fout: string } {
  const soort = isKostSoort(b.soort) ? b.soort : null
  if (!soort) return { fout: 'Kies wat voor kost het is.' }
  const omschrijving = typeof b.omschrijving === 'string' ? b.omschrijving.trim().slice(0, 200) || null : null
  const bedrag = leesGetal(b.bedrag)
  if (bedrag === null || bedrag <= 0) return { fout: 'Vul een bedrag in (excl. btw).' }
  if (bedrag > 10_000_000) return { fout: 'Dat bedrag is te groot.' }
  return { lijn: { soort, omschrijving, bedrag: rond(bedrag) } }
}

export const somKosten = (lijnen: Pick<KostLijn, 'bedrag'>[]): number => rond(lijnen.reduce((s, l) => s + l.bedrag, 0))

// ── Wat er getekend wordt ───────────────────────────────────────────────────

export type ContractAkkoord = {
  soort: 'contract'
  klant: string
  nr: string
  contract: string | null
  contractwaarde: number | null
  kosten: { soort: string; omschrijving: string | null; bedrag: number }[]
  /** Wat er effectief afgetrokken wordt (de kostenlijnen, of meer als de facturen hogere directe kosten tonen). */
  kosten_totaal: number
  netto: number | null
  afspraak: boolean
  closing: boolean
  /** Marco's deel in procent (50 + 50, of een eigen percentage). */
  deel_pct: number
  /** Loopt, vroegtijdig stopgezet of niet-betaler. */
  verloop: 'loopt' | 'stopgezet' | 'niet_betaler'
  /** Vroegtijdig stopgezet: wat de klant werkelijk betaalde. */
  betaald_bij_stop: number | null
  /** Wat er voor Marco meetelt, in euro. */
  telt_mee: number
}
export type KostAkkoord = { soort: 'kost'; omschrijving: string; datum: string | null; bedrag: number }
export type Akkoord = ContractAkkoord | KostAkkoord

type ContractVoorAkkoord = Pick<ContractBerekend,
  'klant' | 'nr' | 'totaal' | 'kostenAftrek' | 'netto' | 'appointment_door_marco' | 'closed_door_marco' | 'factor' | 'status' | 'betaald_bij_stop' | 'opBetaaldBedrag'>

export function contractAkkoord(c: ContractVoorAkkoord, lijnen: KostLijn[], titel: string | null = null): ContractAkkoord {
  const verloop: ContractAkkoord['verloop'] = c.status === 'stopgezet' ? 'stopgezet' : c.status === 'niet_betaler' ? 'niet_betaler' : 'loopt'
  const betaald = c.opBetaaldBedrag && c.betaald_bij_stop !== null && c.betaald_bij_stop !== undefined ? rond(Number(c.betaald_bij_stop)) : null
  const basis = verloop === 'niet_betaler' ? 0 : betaald !== null ? betaald : verloop === 'stopgezet' ? 0 : (c.netto ?? 0)
  return {
    soort: 'contract',
    klant: c.klant.trim(), nr: c.nr, contract: titel?.trim() || null,
    contractwaarde: c.totaal === null ? null : rond(c.totaal),
    kosten: [...lijnen]
      .map((l) => ({ soort: l.soort, omschrijving: l.omschrijving, bedrag: rond(l.bedrag) }))
      .sort((a, b) => a.soort.localeCompare(b.soort) || String(a.omschrijving ?? '').localeCompare(String(b.omschrijving ?? '')) || a.bedrag - b.bedrag),
    kosten_totaal: rond(c.kostenAftrek),
    netto: c.netto === null ? null : rond(c.netto),
    afspraak: c.appointment_door_marco, closing: c.closed_door_marco,
    deel_pct: rond(c.factor * 100),
    verloop, betaald_bij_stop: betaald,
    telt_mee: rond(basis * c.factor),
  }
}

export function kostAkkoord(k: WamKost): KostAkkoord {
  return { soort: 'kost', omschrijving: k.omschrijving.trim(), datum: k.datum, bedrag: rond(k.bedrag) }
}

/** Vaste tekstvorm (gesorteerde sleutels): twee keer dezelfde cijfers = exact dezelfde tekst. */
export function inhoudTekst(a: Akkoord): string {
  const vast = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(vast)
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, vast((v as Record<string, unknown>)[k])]))
    return v
  }
  return JSON.stringify(vast(a))
}

// ── De stand van de handtekeningen ──────────────────────────────────────────

export type Onderwerp = 'contract' | 'kost'
export type Handtekening = {
  id: string; onderwerp: Onderwerp; onderwerp_id: string; vennoot: Vennoot
  naam: string | null; getekend_op: string; inhoud_tekst: string
}
export type Stand = 'getekend' | 'opnieuw' | 'open'
export type AkkoordStand = {
  per: Record<Vennoot, { stand: Stand; op: string | null; naam: string | null }>
  /** Alle drie getekend voor de huidige cijfers. */
  volledig: boolean
  getekend: number
  /** De inhoud waarvoor het laatst getekend werd, als die verschilt van nu. */
  vorige: string | null
}

export function akkoordStand(huidig: string, handtekeningen: Handtekening[]): AkkoordStand {
  const per = {} as AkkoordStand['per']
  let vorige: string | null = null
  for (const v of VENNOTEN) {
    const eigen = handtekeningen.filter((h) => h.vennoot === v).sort((a, b) => b.getekend_op.localeCompare(a.getekend_op))
    const geldig = eigen.find((h) => h.inhoud_tekst === huidig)
    if (geldig) per[v] = { stand: 'getekend', op: geldig.getekend_op, naam: geldig.naam }
    else if (eigen.length) {
      per[v] = { stand: 'opnieuw', op: eigen[0].getekend_op, naam: eigen[0].naam }
      if (!vorige) vorige = eigen[0].inhoud_tekst
    } else per[v] = { stand: 'open', op: null, naam: null }
  }
  const getekend = VENNOTEN.filter((v) => per[v].stand === 'getekend').length
  return { per, volledig: getekend === VENNOTEN.length, getekend, vorige }
}

const eur = (n: number | null) => (n === null ? '—' : `€${n.toLocaleString('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`)
const jaNee = (b: boolean) => (b ? 'ja' : 'nee')

/** Wat is er veranderd sinds de vorige handtekening? In gewone woorden. */
export function wijzigingen(vorigeTekst: string | null, huidig: Akkoord): string[] {
  if (!vorigeTekst) return []
  let oud: Akkoord
  try { oud = JSON.parse(vorigeTekst) as Akkoord } catch { return ['De cijfers zijn gewijzigd.'] }
  if (oud.soort !== huidig.soort) return ['De cijfers zijn gewijzigd.']
  const uit: string[] = []
  if (huidig.soort === 'kost' && oud.soort === 'kost') {
    if (oud.bedrag !== huidig.bedrag) uit.push(`Bedrag ${eur(oud.bedrag)} → ${eur(huidig.bedrag)}`)
    if (oud.omschrijving !== huidig.omschrijving) uit.push('Omschrijving aangepast')
    if (oud.datum !== huidig.datum) uit.push('Datum aangepast')
  }
  if (huidig.soort === 'contract' && oud.soort === 'contract') {
    if (oud.contractwaarde !== huidig.contractwaarde) uit.push(`Contractwaarde ${eur(oud.contractwaarde)} → ${eur(huidig.contractwaarde)}`)
    if (oud.kosten_totaal !== huidig.kosten_totaal) uit.push(`Kosten ${eur(oud.kosten_totaal)} → ${eur(huidig.kosten_totaal)}`)
    else if (JSON.stringify(oud.kosten) !== JSON.stringify(huidig.kosten)) uit.push('Kostenlijnen aangepast')
    if (oud.afspraak !== huidig.afspraak) uit.push(`Afspraak door Marco: ${jaNee(oud.afspraak)} → ${jaNee(huidig.afspraak)}`)
    if (oud.closing !== huidig.closing) uit.push(`Closing door Marco: ${jaNee(oud.closing)} → ${jaNee(huidig.closing)}`)
    if (oud.deel_pct !== huidig.deel_pct && oud.afspraak === huidig.afspraak && oud.closing === huidig.closing) uit.push(`Deel van Marco ${oud.deel_pct}% → ${huidig.deel_pct}%`)
    if (oud.verloop !== huidig.verloop) uit.push(huidig.verloop === 'stopgezet' ? 'Vroegtijdig stopgezet' : huidig.verloop === 'niet_betaler' ? 'Niet-betaler' : 'Loopt weer')
    if (oud.betaald_bij_stop !== huidig.betaald_bij_stop && huidig.verloop === 'stopgezet') uit.push(`Betaald bij stop ${eur(oud.betaald_bij_stop)} → ${eur(huidig.betaald_bij_stop)}`)
    if (oud.klant !== huidig.klant) uit.push('Klantnaam aangepast')
    if (!uit.length && oud.telt_mee !== huidig.telt_mee) uit.push(`Telt mee ${eur(oud.telt_mee)} → ${eur(huidig.telt_mee)}`)
  }
  return uit.length ? uit : ['De cijfers zijn gewijzigd.']
}

/** Een getekende handtekening (PNG uit het tekenvak): klein genoeg en echt een afbeelding. */
export function controleerHandtekening(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v)) return null
  if (v.length < 200 || v.length > 400_000) return null
  return v
}
