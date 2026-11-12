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

import type { ContractBerekend, WamKost, WamRij } from './vesting'
import { leadInfo, leadSoortVan, type LeadSoort } from './vesting'
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

/** Het opgeladen bewijsstuk (contract, factuur …): waar het staat en de SHA-256 van het bestand. */
export type Bewijs = { pad: string; naam: string; sha256: string; grootte: number | null }

export function naarBewijs(r: Record<string, unknown>): Bewijs | null {
  const pad = typeof r.bewijs_pad === 'string' ? r.bewijs_pad : ''
  const sha = typeof r.bewijs_sha256 === 'string' ? r.bewijs_sha256 : ''
  if (!pad || !sha) return null
  return { pad, naam: String(r.bewijs_naam ?? pad.split('/').pop() ?? 'document'), sha256: sha, grootte: Number.isFinite(Number(r.bewijs_grootte)) ? Number(r.bewijs_grootte) : null }
}

/** Een opgeladen bestand uit een verzoek: enkel in de map bewijs/ van de vestingopslag. */
export function controleerBewijsInvoer(v: unknown): { pad: string; naam: string } | null {
  if (!v || typeof v !== 'object') return null
  const { pad, naam } = v as { pad?: unknown; naam?: unknown }
  if (typeof pad !== 'string' || !/^bewijs\/[0-9a-f-]{36}\/[^/]{1,200}$/i.test(pad) || pad.includes('..')) return null
  return { pad, naam: typeof naam === 'string' && naam.trim() ? naam.trim().slice(0, 200) : pad.split('/').pop()! }
}

export type KostLijn = { id: string; vesting_contract_id: string; soort: KostSoort; omschrijving: string | null; bedrag: number; verantwoording?: string | null; bewijs?: Bewijs | null }

const rond = (x: number) => Math.round(x * 100) / 100

export function naarKostLijn(r: Record<string, unknown>): KostLijn {
  return {
    id: String(r.id), vesting_contract_id: String(r.vesting_contract_id),
    soort: isKostSoort(r.soort) ? r.soort : 'andere',
    omschrijving: typeof r.omschrijving === 'string' && r.omschrijving.trim() ? r.omschrijving.trim() : null,
    bedrag: Number.isFinite(Number(r.bedrag)) ? rond(Number(r.bedrag)) : 0,
    verantwoording: typeof r.verantwoording === 'string' && r.verantwoording.trim() ? r.verantwoording.trim() : null,
    bewijs: naarBewijs(r),
  }
}

/** Een kostenlijn uit een verzoek: soort, omschrijving en een bedrag > 0 (excl. btw). */
export function controleerKostLijn(b: { soort?: unknown; omschrijving?: unknown; bedrag?: unknown; verantwoording?: unknown }):
  { lijn: { soort: KostSoort; omschrijving: string | null; bedrag: number; verantwoording: string | null } } | { fout: string } {
  const soort = isKostSoort(b.soort) ? b.soort : null
  if (!soort) return { fout: 'Kies wat voor kost het is.' }
  const omschrijving = typeof b.omschrijving === 'string' ? b.omschrijving.trim().slice(0, 200) || null : null
  const bedrag = leesGetal(b.bedrag)
  if (bedrag === null || bedrag <= 0) return { fout: 'Vul een bedrag in (excl. btw).' }
  if (bedrag > 10_000_000) return { fout: 'Dat bedrag is te groot.' }
  const verantwoording = typeof b.verantwoording === 'string' ? b.verantwoording.trim().slice(0, 1000) || null : null
  return { lijn: { soort, omschrijving, bedrag: rond(bedrag), verantwoording } }
}

// ── Inkomsten en algemene kosten (registraties) ─────────────────────────────

/**
 * Een inkomst of kost die niet uit een gewoon klantcontract komt, altijd met
 * een verantwoording. Bv. Marco factureert zijn WAM-contracten voortaan via de
 * BV: WAM wordt klant, de factuur gaat naar WAM en dat geld telt mee (zoals de
 * WAM-afspraak: elke €5.000 = 1%, tot 5%). Een kost (bv. de afsluiting van
 * WAM) gaat van Marco's totaal af. Nooit verwijderd, enkel geschrapt (ook
 * daarvoor tekent iedereen).
 */
export type RegistratieSoort = 'inkomst' | 'kost'
export type Registratie = {
  id: string; soort: RegistratieSoort; datum: string; omschrijving: string; bedrag: number
  verantwoording: string; referentie: string | null; geschrapt: boolean
  bewijs?: Bewijs | null
}

export function naarRegistratie(r: Record<string, unknown>): Registratie {
  return {
    id: String(r.id), soort: r.soort === 'kost' ? 'kost' : 'inkomst',
    datum: r.datum ? String(r.datum).slice(0, 10) : '',
    omschrijving: String(r.omschrijving ?? '').trim(),
    bedrag: Number.isFinite(Number(r.bedrag)) ? rond(Number(r.bedrag)) : 0,
    verantwoording: String(r.verantwoording ?? '').trim(),
    referentie: typeof r.referentie === 'string' && r.referentie.trim() ? r.referentie.trim() : null,
    geschrapt: !!r.geschrapt_op,
    bewijs: naarBewijs(r),
  }
}

/** Velden uit een verzoek: alles verplicht behalve de referentie (factuurnummer, contract …). */
export function controleerRegistratie(b: { soort?: unknown; datum?: unknown; omschrijving?: unknown; bedrag?: unknown; verantwoording?: unknown; referentie?: unknown }, bijAanmaak = true):
  { rij: Partial<Omit<Registratie, 'id' | 'geschrapt' | 'bewijs'>> } | { fout: string } {
  const rij: Partial<Omit<Registratie, 'id' | 'geschrapt' | 'bewijs'>> = {}
  if (bijAanmaak || b.soort !== undefined) {
    if (b.soort !== 'inkomst' && b.soort !== 'kost') return { fout: 'Kies inkomst of kost.' }
    rij.soort = b.soort
  }
  if (bijAanmaak || b.datum !== undefined) {
    const d = typeof b.datum === 'string' ? b.datum.slice(0, 10) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(new Date(`${d}T12:00:00`).getTime())) return { fout: 'Vul de datum in.' }
    rij.datum = d
  }
  if (bijAanmaak || b.omschrijving !== undefined) {
    const o = typeof b.omschrijving === 'string' ? b.omschrijving.trim().slice(0, 200) : ''
    if (o.length < 2) return { fout: 'Waarover gaat het? Vul een omschrijving in.' }
    rij.omschrijving = o
  }
  if (bijAanmaak || b.bedrag !== undefined) {
    const x = leesGetal(b.bedrag)
    if (x === null || x <= 0) return { fout: 'Vul een bedrag in (excl. btw).' }
    if (x > 10_000_000) return { fout: 'Dat bedrag is te groot.' }
    rij.bedrag = rond(x)
  }
  if (bijAanmaak || b.verantwoording !== undefined) {
    const v = typeof b.verantwoording === 'string' ? b.verantwoording.trim().slice(0, 2000) : ''
    if (v.length < 5) return { fout: 'Geef een verantwoording: waarom telt dit mee?' }
    rij.verantwoording = v
  }
  if (b.referentie !== undefined) rij.referentie = typeof b.referentie === 'string' ? b.referentie.trim().slice(0, 200) || null : null
  return { rij }
}

export const somKosten = (lijnen: Pick<KostLijn, 'bedrag'>[]): number => rond(lijnen.reduce((s, l) => s + l.bedrag, 0))

// ── Wat er getekend wordt ───────────────────────────────────────────────────

export type ContractAkkoord = {
  soort: 'contract'
  klant: string
  nr: string
  contract: string | null
  contractwaarde: number | null
  kosten: { soort: string; omschrijving: string | null; bedrag: number; verantwoording?: string | null; bewijs?: { naam: string; sha256: string } }[]
  /** Wat er effectief afgetrokken wordt (de kostenlijnen, of meer als de facturen hogere directe kosten tonen). */
  kosten_totaal: number
  netto: number | null
  afspraak: boolean
  closing: boolean
  /** Hoe de klant binnenkwam (enkel als het geen outbound door Marco is: zo blijven oudere handtekeningen geldig). */
  lead?: LeadSoort
  /** Marco's deel in procent (50 + 50, de soort lead, of een eigen percentage). */
  deel_pct: number
  /** Loopt, vroegtijdig stopgezet of niet-betaler. */
  verloop: 'loopt' | 'stopgezet' | 'niet_betaler'
  /** Vroegtijdig stopgezet: wat de klant werkelijk betaalde. */
  betaald_bij_stop: number | null
  /** Wat er voor Marco meetelt, in euro. */
  telt_mee: number
}
export type RegistratieAkkoord = {
  soort: RegistratieSoort; omschrijving: string; datum: string; bedrag: number
  verantwoording: string; referentie: string | null; geschrapt: boolean
  /** Het bewijsstuk: naam en SHA-256, zodat de handtekening ook over exact dat bestand gaat. */
  bewijs?: { naam: string; sha256: string }
}
export type Akkoord = ContractAkkoord | RegistratieAkkoord

type ContractVoorAkkoord = Pick<ContractBerekend,
  'klant' | 'nr' | 'totaal' | 'kostenAftrek' | 'netto' | 'appointment_door_marco' | 'closed_door_marco' | 'factor' | 'status' | 'betaald_bij_stop' | 'opBetaaldBedrag'> & { lead_soort?: LeadSoort | string | null }

export function contractAkkoord(c: ContractVoorAkkoord, lijnen: KostLijn[], titel: string | null = null): ContractAkkoord {
  const verloop: ContractAkkoord['verloop'] = c.status === 'stopgezet' ? 'stopgezet' : c.status === 'niet_betaler' ? 'niet_betaler' : 'loopt'
  const betaald = c.opBetaaldBedrag && c.betaald_bij_stop !== null && c.betaald_bij_stop !== undefined ? rond(Number(c.betaald_bij_stop)) : null
  const basis = verloop === 'niet_betaler' ? 0 : betaald !== null ? betaald : verloop === 'stopgezet' ? 0 : (c.netto ?? 0)
  return {
    soort: 'contract',
    klant: c.klant.trim(), nr: c.nr, contract: titel?.trim() || null,
    contractwaarde: c.totaal === null ? null : rond(c.totaal),
    kosten: [...lijnen]
      .map((l) => ({
        soort: l.soort, omschrijving: l.omschrijving, bedrag: rond(l.bedrag),
        ...(l.verantwoording ? { verantwoording: l.verantwoording } : {}),
        ...(l.bewijs ? { bewijs: { naam: l.bewijs.naam, sha256: l.bewijs.sha256 } } : {}),
      }))
      .sort((a, b) => a.soort.localeCompare(b.soort) || String(a.omschrijving ?? '').localeCompare(String(b.omschrijving ?? '')) || a.bedrag - b.bedrag),
    kosten_totaal: rond(c.kostenAftrek),
    netto: c.netto === null ? null : rond(c.netto),
    afspraak: c.appointment_door_marco, closing: c.closed_door_marco,
    ...(leadSoortVan(c.lead_soort) ? { lead: leadSoortVan(c.lead_soort) as LeadSoort } : {}),
    deel_pct: rond(c.factor * 100),
    verloop, betaald_bij_stop: betaald,
    telt_mee: rond(basis * c.factor),
  }
}

export function registratieAkkoord(r: Registratie): RegistratieAkkoord {
  return {
    soort: r.soort, omschrijving: r.omschrijving, datum: r.datum, bedrag: rond(r.bedrag),
    verantwoording: r.verantwoording, referentie: r.referentie, geschrapt: r.geschrapt,
    ...(r.bewijs ? { bewijs: { naam: r.bewijs.naam, sha256: r.bewijs.sha256 } } : {}),
  }
}

/** Registraties in de vorm van de rekenkern: inkomsten tellen zoals WAM, kosten gaan van het totaal af. */
export function registratiesVoorBerekening(lijst: Pick<Registratie, 'id' | 'soort' | 'datum' | 'omschrijving' | 'bedrag' | 'geschrapt'>[]): { inkomsten: WamRij[]; kosten: WamKost[] } {
  const actief = lijst.filter((r) => !r.geschrapt && r.bedrag > 0)
  return {
    inkomsten: actief.filter((r) => r.soort === 'inkomst').map((r) => ({
      id: r.id, nr: r.datum, klant: r.omschrijving, client_id: null, contractwaarde: r.bedrag, netto_ontvangen: r.bedrag,
      status: 'voltooid', betalingen_op_schema: true, notitie: null,
      start_datum: null, contract_maanden: null, bedrag_per_factuur: null, frequentie: null, btw_pct: 21, omschrijving: null,
    })),
    kosten: actief.filter((r) => r.soort === 'kost').map((r) => ({ id: r.id, datum: r.datum, omschrijving: r.omschrijving, bedrag: r.bedrag })),
  }
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

export type Onderwerp = 'contract' | 'kost' | 'inkomst'
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
  /** De laatste versie die alle drie tekenden (getekend is getekend), met het moment waarop de derde tekende. */
  laatsteVolledig: { tekst: string; op: string } | null
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
  return { per, volledig: getekend === VENNOTEN.length, getekend, vorige, laatsteVolledig: laatsteVolledigeVersie(handtekeningen) }
}

/** Welke versie tekenden alle drie het laatst? Het moment = wanneer de laatste van de drie tekende. */
export function laatsteVolledigeVersie(handtekeningen: Pick<Handtekening, 'vennoot' | 'getekend_op' | 'inhoud_tekst'>[]): { tekst: string; op: string } | null {
  const per = new Map<string, Map<Vennoot, string>>()
  for (const h of handtekeningen) {
    const m = per.get(h.inhoud_tekst) ?? new Map<Vennoot, string>()
    const al = m.get(h.vennoot)
    if (!al || h.getekend_op < al) m.set(h.vennoot, h.getekend_op)
    per.set(h.inhoud_tekst, m)
  }
  let beste: { tekst: string; op: string } | null = null
  for (const [tekst, m] of Array.from(per.entries())) {
    if (m.size < VENNOTEN.length) continue
    const op = Array.from(m.values()).sort().pop()!
    if (!beste || op > beste.op) beste = { tekst, op }
  }
  return beste
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
  if (huidig.soort !== 'contract' && oud.soort !== 'contract') {
    const o = oud as RegistratieAkkoord
    if (!!o.geschrapt !== huidig.geschrapt) uit.push(huidig.geschrapt ? 'Geschrapt' : 'Teruggezet')
    if (o.bedrag !== huidig.bedrag) uit.push(`Bedrag ${eur(o.bedrag)} → ${eur(huidig.bedrag)}`)
    if (o.omschrijving !== huidig.omschrijving) uit.push('Omschrijving aangepast')
    if (o.datum !== huidig.datum) uit.push('Datum aangepast')
    if ((o.verantwoording ?? '') !== huidig.verantwoording) uit.push('Verantwoording aangepast')
    if ((o.referentie ?? null) !== huidig.referentie) uit.push('Referentie aangepast')
    if ((o.bewijs?.sha256 ?? null) !== (huidig.bewijs?.sha256 ?? null)) uit.push(o.bewijs ? 'Document vervangen' : 'Document toegevoegd')
  }
  if (huidig.soort === 'contract' && oud.soort === 'contract') {
    if (oud.contractwaarde !== huidig.contractwaarde) uit.push(`Contractwaarde ${eur(oud.contractwaarde)} → ${eur(huidig.contractwaarde)}`)
    if (oud.kosten_totaal !== huidig.kosten_totaal) uit.push(`Kosten ${eur(oud.kosten_totaal)} → ${eur(huidig.kosten_totaal)}`)
    else if (JSON.stringify(oud.kosten) !== JSON.stringify(huidig.kosten)) uit.push('Kostenlijnen of hun verantwoording aangepast')
    if (oud.afspraak !== huidig.afspraak) uit.push(`Afspraak door Marco: ${jaNee(oud.afspraak)} → ${jaNee(huidig.afspraak)}`)
    if (oud.closing !== huidig.closing) uit.push(`Closing door Marco: ${jaNee(oud.closing)} → ${jaNee(huidig.closing)}`)
    if ((oud.lead ?? null) !== (huidig.lead ?? null)) uit.push(`Soort lead: ${leadInfo(oud.lead)?.label ?? 'outbound door Marco'} → ${leadInfo(huidig.lead)?.label ?? 'outbound door Marco'}`)
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

/** Eén regel die zegt waarvoor getekend werd, voor het handtekeningenregister. */
export function beschrijfAkkoord(a: Akkoord): string {
  if (a.soort === 'contract') {
    const kosten = a.kosten_totaal ? ` − ${eur(a.kosten_totaal)} kosten` : ''
    const rol = leadInfo(a.lead)?.kort ?? ([a.afspraak && 'afspraak', a.closing && 'closing'].filter(Boolean).join(' + ') || 'geen rol')
    if (a.verloop === 'niet_betaler') return `${a.klant}: niet-betaler, telt voor €0`
    if (a.verloop === 'stopgezet') return `${a.klant}: gestopt, ${eur(a.betaald_bij_stop)} betaald × ${a.deel_pct}% (${rol}) = ${eur(a.telt_mee)} telt mee`
    return `${a.klant}: ${eur(a.contractwaarde)}${kosten} = ${eur(a.netto)} × ${a.deel_pct}% (${rol}) = ${eur(a.telt_mee)} telt mee`
  }
  const wat = a.soort === 'inkomst' ? 'Inkomst' : 'Kost'
  return `${a.geschrapt ? 'Geschrapt: ' : ''}${wat} ${a.omschrijving}: ${a.soort === 'kost' ? '−' : ''}${eur(a.bedrag)}`
}

// ── Certificaat en archiefmail ──────────────────────────────────────────────

export type CertificaatHandtekening = { vennoot: Vennoot; naam: string; email: string | null; getekend_op: string }
export type CertificaatGegevens = {
  nummer: string
  inhoud: Akkoord
  /** SHA-256 van de getekende cijfers (inhoud_tekst). */
  inhoud_sha256: string
  handtekeningen: CertificaatHandtekening[]
  /** Wat het contract Marco oplevert (fractie), berekend toen alle drie tekenden. */
  aandeel: number | null
  /** De aandelen op dat moment. */
  stand: { marco: number; bram: number; chiara: number } | null
  volledig_op: string
}

const pctTekst = (f: number, c = 2) => `${(f * 100).toLocaleString('nl-BE', { minimumFractionDigits: c, maximumFractionDigits: c })}%`
const tijd = (iso: string) => new Date(iso).toLocaleString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })

/** De kernregels van een certificaat: label en waarde, voor de pdf én de mail. */
export function certificaatRegels(g: CertificaatGegevens): [string, string][] {
  const a = g.inhoud
  if (a.soort === 'contract') {
    const rol = leadInfo(a.lead)?.label ?? ([a.afspraak && 'afspraak gezet', a.closing && 'klant geclosed'].filter(Boolean).join(' en ') || 'geen rol')
    return [
      ['Klant', a.klant],
      ['Contract', `${a.contract ?? '—'} (${a.nr})`],
      ['Contractwaarde', eur(a.contractwaarde)],
      ['Kosten', a.kosten_totaal ? `${eur(a.kosten_totaal)}${a.kosten.length ? ` (${a.kosten.map((k) => `${kostSoortLabel(k.soort)} ${eur(k.bedrag)}`).join(', ')})` : ''}` : 'geen'],
      ['Netto', eur(a.netto)],
      ['Marco', `${rol}: ${a.deel_pct}%`],
      ...(a.verloop === 'stopgezet' ? [['Verloop', `vroegtijdig stopgezet, ${eur(a.betaald_bij_stop)} betaald`] as [string, string]] : []),
      ...(a.verloop === 'niet_betaler' ? [['Verloop', 'niet-betaler'] as [string, string]] : []),
      ['Telt mee voor Marco', eur(a.telt_mee)],
      ...(g.aandeel !== null ? [['Levert Marco op', pctTekst(g.aandeel)] as [string, string]] : []),
    ]
  }
  return [
    ['Soort', a.soort === 'inkomst' ? 'Inkomst (telt zoals de WAM-afspraak)' : "Kost (gaat van Marco's totaal af)"],
    ['Omschrijving', `${a.omschrijving}${a.geschrapt ? ' (geschrapt)' : ''}`],
    ['Bedrag', eur(a.bedrag)],
    ['Datum', a.datum],
    ...(a.referentie ? [['Referentie', a.referentie] as [string, string]] : []),
    ['Verantwoording', a.verantwoording],
    ...(a.bewijs ? [['Document', `${a.bewijs.naam} · SHA-256 ${a.bewijs.sha256}`] as [string, string]] : []),
  ]
}

export function certificaatTitel(a: Akkoord): string {
  if (a.soort === 'contract') return `${a.klant} (${a.nr})`
  return `${a.soort === 'inkomst' ? 'Inkomst' : 'Kost'}: ${a.omschrijving}`
}

/** Onderwerp en tekst van de archiefmail naar legal@, zodra alle drie tekenden. */
export function certificaatMail(g: CertificaatGegevens, vennoten: Record<Vennoot, string>): { onderwerp: string; tekst: string } {
  const onderwerp = `Vesting – getekend door alle drie – ${certificaatTitel(g.inhoud)}`
  const regels = [
    'Marco, Bram en Chiara hebben alle drie getekend in de app.',
    '',
    ...certificaatRegels(g).map(([l, w]) => `${l}: ${w}`),
    '',
    'Getekend door:',
    ...g.handtekeningen.map((h) => `- ${vennoten[h.vennoot] ?? h.naam}${h.email ? ` (${h.email})` : ''} op ${tijd(h.getekend_op)}`),
    '',
    ...(g.stand ? [`Stand van de aandelen op ${tijd(g.volledig_op)}: Marco ${pctTekst(g.stand.marco, 0)}, Bram ${pctTekst(g.stand.bram, 0)}, Chiara ${pctTekst(g.stand.chiara, 0)}.`, ''] : []),
    `Certificaat ${g.nummer} in bijlage, met de drie handtekeningen.`,
    `Vingerafdruk van de getekende cijfers (SHA-256): ${g.inhoud_sha256}`,
    '',
    'Deze mail is het archief buiten de app. Niet beantwoorden.',
  ]
  return { onderwerp, tekst: regels.join('\n') }
}
