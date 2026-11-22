/**
 * Uitgaven vennoten — pure regels (getest in tests/vennoot-uitgaven.test.ts).
 *
 * Aankopen op de zakelijke rekening die vooral één vennoot voordeel geven
 * (een fiets om naar het werk te gaan, een broodje bij een klantbezoek).
 * Elke vennoot krijgt per maand een budget (standaard € 250). Wat je niet
 * gebruikt, spaar je: het tegoed = budget × maanden sinds de start − wat je
 * besteedde. Een gearchiveerde uitgave (bv. verworpen uitgave) telt niet meer
 * mee, maar blijft zichtbaar met haar verantwoording.
 *
 * De regels (en het budget) tekenen Marco, Bram en Chiara alle drie; elke
 * aanpassing is een nieuwe versie die opnieuw getekend wordt.
 */

import { leesGetal } from './getal'
import { VENNOTEN, type Vennoot } from './vesting-akkoord'

export { VENNOTEN, type Vennoot }

export const STANDAARD_BUDGET = 250

export type Uitgave = {
  id: string
  vennoot: Vennoot
  datum: string            // JJJJ-MM-DD
  omschrijving: string     // wat
  doel: string | null      // waarvoor het dient
  bedrag: number           // betaald van de zakelijke rekening (incl. btw)
  bewijs_pad: string | null
  bewijs_naam: string | null
  gearchiveerd_op: string | null
  gearchiveerd_door: string | null
  archief_reden: string | null
  created_at: string | null
  created_by: string | null
  /** Eén bonnetje verdeeld over meerdere vennoten ({ bram: 25, chiara: 25 }); leeg = alles is van `vennoot`. */
  verdeling?: Verdeling | null
  /** Een betaling van een terugkerende uitgave (afgeleid, geen eigen rij): de afspraak en hoe vaak. */
  terugkerend_id?: string
  frequentie?: Frequentie
}

export type Verdeling = Partial<Record<Vennoot, number>>

export type RegelsVersie = { id: string; versie: number; regels: string[]; maandbudget: number; start_maand: string; created_at: string | null; created_by: string | null }

const isVennoot = (v: unknown): v is Vennoot => VENNOTEN.includes(v as Vennoot)
const rond = (x: number) => Math.round(x * 100) / 100
const DAG = /^\d{4}-\d{2}-\d{2}$/
const MAAND = /^\d{4}-(0[1-9]|1[0-2])$/

// ── Een uitgave invoeren ────────────────────────────────────────────────────

export type UitgaveInvoer = { vennoot: Vennoot; datum: string; omschrijving: string; doel: string | null; bedrag: number; verdeling?: Verdeling }

/**
 * Een uitgave: voor één vennoot (`vennoot`) of verdeeld over meerdere
 * (`vennoten`, standaard gelijk; `verdeling` = zelf gekozen bedragen die samen
 * het totaal moeten zijn). `vennoot` is dan de eerste van de lijst.
 */
export function controleerUitgave(b: Record<string, unknown>, vandaag: string): { ok: true; waarde: UitgaveInvoer } | { ok: false; fout: string } {
  const lijst = Array.isArray(b.vennoten) ? VENNOTEN.filter((v) => (b.vennoten as unknown[]).includes(v)) : isVennoot(b.vennoot) ? [b.vennoot] : []
  if (!lijst.length) return { ok: false, fout: 'Kies voor welke vennoot de uitgave was.' }
  const datum = String(b.datum ?? '').trim()
  if (!DAG.test(datum) || Number.isNaN(Date.parse(`${datum}T12:00:00Z`))) return { ok: false, fout: 'Kies de datum van de uitgave.' }
  if (datum > vandaag) return { ok: false, fout: 'De datum ligt in de toekomst.' }
  const omschrijving = String(b.omschrijving ?? '').replace(/\s+/g, ' ').trim()
  if (omschrijving.length < 2) return { ok: false, fout: 'Wat was de uitgave?' }
  if (omschrijving.length > 200) return { ok: false, fout: 'Hou de omschrijving kort (max 200 tekens).' }
  const doel = String(b.doel ?? '').trim().slice(0, 500) || null
  const bedrag = leesGetal(b.bedrag)
  if (bedrag === null || bedrag <= 0) return { ok: false, fout: 'Vul het bedrag in.' }
  if (bedrag > 100_000) return { ok: false, fout: 'Dat bedrag is te hoog.' }
  const waarde: UitgaveInvoer = { vennoot: lijst[0], datum, omschrijving, doel, bedrag: rond(bedrag) }
  if (lijst.length === 1) return { ok: true, waarde }
  // Verdeeld: zelf gekozen bedragen, of gelijk (de centen die overschieten bij de eersten).
  if (b.verdeling && typeof b.verdeling === 'object') {
    const ruw = b.verdeling as Record<string, unknown>
    const verdeling: Verdeling = {}
    for (const v of lijst) {
      const deel = leesGetal(ruw[v])
      if (deel === null || deel <= 0) return { ok: false, fout: 'Vul voor elke gekozen vennoot een deel in (meer dan € 0).' }
      verdeling[v] = rond(deel)
    }
    const som = rond(Object.values(verdeling).reduce((t, x) => t + (x ?? 0), 0))
    if (Math.abs(som - waarde.bedrag) > 0.004) return { ok: false, fout: `De delen samen (€ ${som.toFixed(2).replace('.', ',')}) moeten het totaal zijn (€ ${waarde.bedrag.toFixed(2).replace('.', ',')}).` }
    return { ok: true, waarde: { ...waarde, verdeling } }
  }
  return { ok: true, waarde: { ...waarde, verdeling: gelijkVerdeeld(waarde.bedrag, lijst) } }
}

/** Gelijk verdelen tot op de cent: € 50 over twee = 25 + 25, € 10 over drie = 3,34 + 3,33 + 3,33. */
export function gelijkVerdeeld(bedrag: number, vennoten: Vennoot[]): Verdeling {
  const lijst = VENNOTEN.filter((v) => vennoten.includes(v))
  const centen = Math.round(bedrag * 100)
  const basis = Math.floor(centen / lijst.length)
  const rest = centen - basis * lijst.length
  return Object.fromEntries(lijst.map((v, i) => [v, (basis + (i < rest ? 1 : 0)) / 100])) as Verdeling
}

/** Wie wat draagt van een uitgave: de verdeling, of alles voor `vennoot`. */
export function delenVan(u: Pick<Uitgave, 'vennoot' | 'bedrag' | 'verdeling'>): { vennoot: Vennoot; bedrag: number }[] {
  const v = u.verdeling ? VENNOTEN.filter((k) => typeof u.verdeling![k] === 'number') : []
  if (v.length < 2) return [{ vennoot: u.vennoot, bedrag: u.bedrag }]
  return v.map((k) => ({ vennoot: k, bedrag: u.verdeling![k]! }))
}
export const wieBetrokken = (u: Pick<Uitgave, 'vennoot' | 'bedrag' | 'verdeling'>) => delenVan(u).map((d) => d.vennoot)
export const deelVan = (u: Pick<Uitgave, 'vennoot' | 'bedrag' | 'verdeling'>, v: Vennoot) => delenVan(u).find((d) => d.vennoot === v)?.bedrag ?? 0
export const isVerdeeld = (u: Pick<Uitgave, 'vennoot' | 'bedrag' | 'verdeling'>) => delenVan(u).length > 1

/** Een archiefverantwoording: verplicht, kort. */
export function controleerReden(v: unknown): string | null {
  const r = String(v ?? '').replace(/\s+/g, ' ').trim()
  return r.length >= 3 ? r.slice(0, 500) : null
}
export const REDEN_VOORSTEL = 'Mochten we niet inbrengen, moest naar verworpen uitgaven.'

// ── Periodes ────────────────────────────────────────────────────────────────

export type PeriodeSoort = 'maand' | 'kwartaal' | 'jaar'
export type Periode = { soort: PeriodeSoort; ref: string; van: string; tot: string; maanden: string[]; label: string }

const MAANDNAAM = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const maandStr = (j: number, m: number) => `${j}-${String(m).padStart(2, '0')}`
const laatsteDag = (j: number, m: number) => new Date(Date.UTC(j, m, 0)).getUTCDate()

export const maandLabel = (ym: string) => { const [j, m] = ym.split('-').map(Number); return `${MAANDNAAM[m - 1]} ${j}` }

/** De periode (maand, kwartaal of jaar) waarin `ref` (JJJJ-MM) valt. */
export function periodeVan(soort: PeriodeSoort, ref: string): Periode {
  const [j, m] = (MAAND.test(ref) ? ref : '2026-01').split('-').map(Number)
  const [m1, m2] = soort === 'maand' ? [m, m] : soort === 'kwartaal' ? [Math.floor((m - 1) / 3) * 3 + 1, Math.floor((m - 1) / 3) * 3 + 3] : [1, 12]
  const maanden = Array.from({ length: m2 - m1 + 1 }, (_, i) => maandStr(j, m1 + i))
  const label = soort === 'maand' ? maandLabel(maanden[0]) : soort === 'kwartaal' ? `Q${Math.ceil(m1 / 3)} ${j}` : String(j)
  return { soort, ref: maanden[0], van: `${maanden[0]}-01`, tot: `${maandStr(j, m2)}-${String(laatsteDag(j, m2)).padStart(2, '0')}`, maanden, label }
}

/** Een periode verder of terug. */
export function verschuif(p: Periode, stap: number): Periode {
  const [j, m] = p.ref.split('-').map(Number)
  const n = p.soort === 'maand' ? 1 : p.soort === 'kwartaal' ? 3 : 12
  const totaal = j * 12 + (m - 1) + stap * n
  return periodeVan(p.soort, maandStr(Math.floor(totaal / 12), (totaal % 12) + 1))
}

/** Aantal maanden van `van` tot en met `tot` (JJJJ-MM); 0 als tot vóór van ligt. */
export function maandenTussen(van: string, tot: string): number {
  const [j1, m1] = van.split('-').map(Number), [j2, m2] = tot.split('-').map(Number)
  return Math.max(0, (j2 * 12 + m2) - (j1 * 12 + m1) + 1)
}

// ── Budget en tegoed ────────────────────────────────────────────────────────

export type Budget = { maandbudget: number; start_maand: string }

/** Het budget uit de laatste regels; zonder regels: standaard € 250 vanaf de eerste uitgave (of deze maand). */
export function budgetVan(regels: Pick<RegelsVersie, 'maandbudget' | 'start_maand'> | null, uitgaven: Pick<Uitgave, 'datum'>[], huidigeMaand: string): Budget {
  if (regels) return { maandbudget: regels.maandbudget, start_maand: regels.start_maand }
  const eerste = uitgaven.map((u) => u.datum.slice(0, 7)).sort()[0]
  return { maandbudget: STANDAARD_BUDGET, start_maand: eerste && eerste < huidigeMaand ? eerste : huidigeMaand }
}

const telt = (u: Pick<Uitgave, 'gearchiveerd_op'>) => !u.gearchiveerd_op

export type VennootStand = {
  vennoot: Vennoot
  besteedPeriode: number
  /** Budget van de periode, inclusief het extra budget waar alle drie akkoord op gaven. */
  budgetPeriode: number
  /** Het extra budget in de periode (zit al in budgetPeriode). */
  extraPeriode: number
  /** Al het extra budget tot nu (zit al in budgetTotaal). */
  extraTotaal: number
  aantalPeriode: number
  besteedTotaal: number
  budgetTotaal: number
  /** Wat de vennoot vandaag nog mag: opgespaard budget min alles wat al besteed is. Negatief = te veel uitgegeven. */
  tegoed: number
}

/**
 * Per vennoot: wat in de gekozen periode besteed werd tegenover het budget van
 * die periode, en het tegoed vandaag (alles sinds de start). Enkel maanden
 * vanaf de start en tot en met deze maand geven budget.
 */
export function standPerVennoot(uitgaven: Uitgave[], budget: Budget, periode: Periode, huidigeMaand: string, extras: BudgetExtra[] = [], extraAkkoorden: ExtraAkkoord[] = []): VennootStand[] {
  const maandenMetBudget = periode.maanden.filter((m) => m >= budget.start_maand && m <= huidigeMaand).length
  const basisTotaal = rond(budget.maandbudget * maandenTussen(budget.start_maand, huidigeMaand))
  // Extra budget telt pas als alle drie akkoord gaven, en pas vanaf zijn maand (zoals het gewone budget).
  const geldig = extras.filter((e) => extraTelt(e, extraAkkoorden) && e.maand <= huidigeMaand)
  return VENNOTEN.map((v) => {
    // Een verdeelde uitgave telt bij elke vennoot voor zijn deel.
    const eigen = uitgaven.filter((u) => telt(u) && deelVan(u, v) > 0).map((u) => ({ ...u, bedrag: deelVan(u, v) }))
    const inPeriode = eigen.filter((u) => u.datum >= periode.van && u.datum <= periode.tot)
    const besteedTotaal = rond(eigen.reduce((s, u) => s + u.bedrag, 0))
    const extraTotaal = extraVoor(geldig, v)
    const extraPeriode = extraVoor(geldig, v, periode.maanden)
    const budgetTotaal = rond(basisTotaal + extraTotaal)
    return {
      vennoot: v,
      besteedPeriode: rond(inPeriode.reduce((s, u) => s + u.bedrag, 0)),
      budgetPeriode: rond(budget.maandbudget * maandenMetBudget + extraPeriode),
      extraPeriode,
      extraTotaal,
      aantalPeriode: inPeriode.length,
      besteedTotaal,
      budgetTotaal,
      tegoed: rond(budgetTotaal - besteedTotaal),
    }
  })
}

/** Uitgaven in een periode (en eventueel van één vennoot), nieuwste eerst. */
export function uitgavenIn(uitgaven: Uitgave[], periode: Periode | null, vennoot: Vennoot | null, archief: boolean): Uitgave[] {
  return uitgaven
    .filter((u) => (archief ? !!u.gearchiveerd_op : !u.gearchiveerd_op))
    .filter((u) => !vennoot || wieBetrokken(u).includes(vennoot))
    .filter((u) => !periode || (u.datum >= periode.van && u.datum <= periode.tot))
    .sort((a, b) => b.datum.localeCompare(a.datum) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
}

/** De uitgaven per maand (nieuwste maand eerst), met het totaal van die maand (met `vennoot`: enkel zijn of haar deel). */
export function perMaand(uitgaven: Uitgave[], vennoot: Vennoot | null = null): { maand: string; label: string; uitgaven: Uitgave[]; totaal: number }[] {
  const groepen = new Map<string, Uitgave[]>()
  for (const u of uitgaven) { const m = u.datum.slice(0, 7); groepen.set(m, [...(groepen.get(m) ?? []), u]) }
  return Array.from(groepen.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([maand, l]) => ({ maand, label: maandLabel(maand), uitgaven: l, totaal: rond(l.reduce((s, u) => s + (vennoot ? deelVan(u, vennoot) : u.bedrag), 0)) }))
}

/**
 * De periodes om uit te kiezen (nieuwste eerst): van de eerste uitgave (of de
 * start van het budget, als die vroeger ligt) tot en met deze maand.
 */
export function periodeOpties(soort: PeriodeSoort, eersteMaand: string | null, huidigeMaand: string): Periode[] {
  const start = eersteMaand && MAAND.test(eersteMaand) && eersteMaand < huidigeMaand ? eersteMaand : huidigeMaand
  const uit: Periode[] = []
  let p = periodeVan(soort, huidigeMaand)
  for (let i = 0; i < 240; i++) {
    uit.push(p)
    if (p.ref <= start || p.maanden.includes(start)) break
    p = verschuif(p, -1)
  }
  return uit
}

// ── Regels ──────────────────────────────────────────────────────────────────

export const STANDAARD_REGELS = [
  'Elke vennoot mag per maand voor het afgesproken budget aankopen doen op de zaak die hem of haar persoonlijk voordeel geven.',
  'Wat je in een maand niet gebruikt, spaar je op. Wie meer uitgeeft dan zijn tegoed, overlegt eerst met de andere twee.',
  'Bij elke uitgave hoort een bonnetje of factuur.',
  'Is een uitgave niet aftrekbaar, dan archiveren we ze met de reden erbij.',
]

/** De regels uit een verzoek: één per regel, leeg weg, hoogstens 30 van elk 300 tekens. */
export function controleerRegels(b: Record<string, unknown>): { ok: true; waarde: { regels: string[]; maandbudget: number; start_maand: string } } | { ok: false; fout: string } {
  const ruw = Array.isArray(b.regels) ? b.regels.map(String) : String(b.regels ?? '').split('\n')
  const regels = ruw.map((r) => r.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!regels.length) return { ok: false, fout: 'Schrijf minstens één regel.' }
  if (regels.length > 30) return { ok: false, fout: 'Hoogstens 30 regels.' }
  if (regels.some((r) => r.length > 300)) return { ok: false, fout: 'Hou elke regel onder de 300 tekens.' }
  const budget = leesGetal(b.maandbudget)
  if (budget === null || budget < 0 || budget > 10_000) return { ok: false, fout: 'Vul een geldig maandbudget in.' }
  const start = String(b.start_maand ?? '').trim()
  if (!MAAND.test(start)) return { ok: false, fout: 'Kies vanaf welke maand het tegoed telt.' }
  return { ok: true, waarde: { regels, maandbudget: rond(budget), start_maand: start } }
}

/** Wat er precies getekend wordt: de regels, het budget en de start, als vaste tekst. */
export function regelsTekst(v: Pick<RegelsVersie, 'versie' | 'regels' | 'maandbudget' | 'start_maand'>): string {
  return [
    `Regels uitgaven vennoten, versie ${v.versie}`,
    `Budget per vennoot per maand: EUR ${v.maandbudget.toFixed(2)}`,
    `Tegoed telt vanaf: ${v.start_maand}`,
    ...v.regels.map((r, i) => `${i + 1}. ${r}`),
  ].join('\n')
}

/** Wat veranderde er tegenover de vorige versie? Voor de regelsviewer. */
export function regelsVerschil(nu: Pick<RegelsVersie, 'regels' | 'maandbudget' | 'start_maand'>, vorige: Pick<RegelsVersie, 'regels' | 'maandbudget' | 'start_maand'> | null): { nieuw: boolean[]; weg: string[]; budget: boolean; start: boolean } {
  if (!vorige) return { nieuw: nu.regels.map(() => false), weg: [], budget: false, start: false }
  const oud = new Set(vorige.regels.map((r) => r.trim()))
  const hier = new Set(nu.regels.map((r) => r.trim()))
  return {
    nieuw: nu.regels.map((r) => !oud.has(r.trim())),
    weg: vorige.regels.filter((r) => !hier.has(r.trim())),
    budget: nu.maandbudget !== vorige.maandbudget,
    start: nu.start_maand !== vorige.start_maand,
  }
}

export type RegelHandtekening = { vennoot: Vennoot; naam: string | null; getekend_op: string; inhoud_tekst: string; handtekening?: string | null }

/** Wie tekende de huidige versie (met exact deze tekst)? */
export function tekenStand(v: RegelsVersie | null, handtekeningen: RegelHandtekening[]): Record<Vennoot, RegelHandtekening | null> & { allen: boolean } {
  const tekst = v ? regelsTekst(v) : null
  const per = Object.fromEntries(VENNOTEN.map((k) => [k, (tekst && handtekeningen.find((h) => h.vennoot === k && h.inhoud_tekst === tekst)) || null])) as Record<Vennoot, RegelHandtekening | null>
  return { ...per, allen: !!tekst && VENNOTEN.every((k) => !!per[k]) }
}

// ── Akkoord per uitgave ──────────────────────────────────────────────────────
// Marco, Bram en Chiara drukken elk op "Akkoord" bij een uitgave. Het akkoord
// hoort bij exact deze tekst: wordt de uitgave aangepast (bedrag, datum, wat,
// waarvoor, voor wie of de bon), dan geeft iedereen opnieuw akkoord.

export type UitgaveAkkoord = { uitgave_id: string; vennoot: Vennoot; naam: string | null; akkoord_op: string; inhoud_tekst: string }

export function uitgaveTekst(u: Pick<Uitgave, 'id' | 'vennoot' | 'datum' | 'omschrijving' | 'doel' | 'bedrag' | 'bewijs_pad' | 'bewijs_naam'> & { verdeling?: Verdeling | null }): string {
  // Eén vennoot: exact dezelfde tekst als vroeger (bestaande akkoorden blijven geldig).
  const delen = delenVan({ vennoot: u.vennoot, bedrag: u.bedrag, verdeling: u.verdeling ?? null })
  const verdeeld = delen.length > 1
  return [
    `Uitgave ${u.id}`,
    `Voor: ${verdeeld ? delen.map((d) => d.vennoot).join(', ') : u.vennoot}`,
    `Datum: ${u.datum}`,
    `Wat: ${u.omschrijving}`,
    `Waarvoor: ${u.doel ?? '—'}`,
    `Bedrag: ${rond(u.bedrag).toFixed(2)}`,
    ...(verdeeld ? [`Verdeling: ${delen.map((d) => `${d.vennoot} ${rond(d.bedrag).toFixed(2)}`).join(', ')}`] : []),
    `Bon: ${u.bewijs_pad ? `${u.bewijs_naam ?? 'bon'} (${u.bewijs_pad})` : 'geen'}`,
  ].join('\n')
}

/** Wie gaf akkoord op de uitgave zoals ze nu is? */
export function akkoordStand(u: Parameters<typeof uitgaveTekst>[0], akkoorden: UitgaveAkkoord[]): Record<Vennoot, UitgaveAkkoord | null> & { allen: boolean; aangepast: boolean } {
  const tekst = uitgaveTekst(u)
  const hier = akkoorden.filter((a) => a.uitgave_id === u.id)
  const per = Object.fromEntries(VENNOTEN.map((k) => [k, hier.find((a) => a.vennoot === k && a.inhoud_tekst === tekst) ?? null])) as Record<Vennoot, UitgaveAkkoord | null>
  return { ...per, allen: VENNOTEN.every((k) => !!per[k]), aangepast: hier.some((a) => a.inhoud_tekst !== tekst) }
}

/** Uitgaven (niet gearchiveerd) die nog op het akkoord van deze vennoot wachten. */
export function wachtOpAkkoord(uitgaven: Uitgave[], akkoorden: UitgaveAkkoord[], wie: Vennoot): Uitgave[] {
  return uitgaven.filter((u) => !u.gearchiveerd_op && !akkoordStand(u, akkoorden)[wie])
}

// ── Akkoord: gedeeld door extra budget en terugkerende uitgaven ─────────────

export type Akkoord = { vennoot: Vennoot; naam: string | null; akkoord_op: string; inhoud_tekst: string }
export type AkkoordStand = Record<Vennoot, Akkoord | null> & { allen: boolean; aangepast: boolean }

function standOp(tekst: string, hier: Akkoord[]): AkkoordStand {
  const per = Object.fromEntries(VENNOTEN.map((k) => [k, hier.find((a) => a.vennoot === k && a.inhoud_tekst === tekst) ?? null])) as Record<Vennoot, Akkoord | null>
  return { ...per, allen: VENNOTEN.every((k) => !!per[k]), aangepast: hier.some((a) => a.inhoud_tekst !== tekst) }
}

/** "Marco", "Marco en Bram", "Marco, Bram en Chiara". */
export function namenLijst(namen: string[]): string {
  if (namen.length <= 1) return namen[0] ?? ''
  return `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`
}

// ── Extra budget ────────────────────────────────────────────────────────────
// Een vennoot (of alle drie) mag in een bepaalde maand meer uitgeven, met een
// onderbouwing. Het telt pas mee in het tegoed als Marco, Bram en Chiara alle
// drie akkoord gaven op exact die tekst; aangepast = opnieuw akkoord.

export type BudgetExtra = {
  id: string
  vennoten: Vennoot[]
  maand: string            // JJJJ-MM
  bedrag: number           // per vennoot
  reden: string
  gearchiveerd_op: string | null
  gearchiveerd_door: string | null
  archief_reden: string | null
  created_at: string | null
  created_by: string | null
}
export type ExtraAkkoord = Akkoord & { extra_id: string }
export type ExtraInvoer = { vennoten: Vennoot[]; maand: string; bedrag: number; reden: string }

export function controleerExtra(b: Record<string, unknown>): { ok: true; waarde: ExtraInvoer } | { ok: false; fout: string } {
  const lijst = Array.isArray(b.vennoten) ? b.vennoten : []
  const vennoten = VENNOTEN.filter((v) => lijst.includes(v))
  if (!vennoten.length) return { ok: false, fout: 'Kies voor welke vennoot of vennoten.' }
  const maand = String(b.maand ?? '').trim()
  if (!MAAND.test(maand)) return { ok: false, fout: 'Kies de maand.' }
  const bedrag = leesGetal(b.bedrag)
  if (bedrag === null || bedrag <= 0) return { ok: false, fout: 'Vul het bedrag per vennoot in.' }
  if (bedrag > 100_000) return { ok: false, fout: 'Dat bedrag is te hoog.' }
  const reden = String(b.reden ?? '').replace(/\s+/g, ' ').trim()
  if (reden.length < 10) return { ok: false, fout: 'Schrijf kort waarom (minstens een zin).' }
  return { ok: true, waarde: { vennoten, maand, bedrag: rond(bedrag), reden: reden.slice(0, 1000) } }
}

/** Wat er precies goedgekeurd wordt. */
export function extraTekst(e: Pick<BudgetExtra, 'id' | 'vennoten' | 'maand' | 'bedrag' | 'reden'>): string {
  return [
    `Extra budget ${e.id}`,
    `Voor: ${VENNOTEN.filter((v) => e.vennoten.includes(v)).join(', ')}`,
    `Maand: ${e.maand}`,
    `Bedrag per vennoot: ${rond(e.bedrag).toFixed(2)}`,
    `Waarom: ${e.reden}`,
  ].join('\n')
}

export const extraStand = (e: Parameters<typeof extraTekst>[0], akkoorden: ExtraAkkoord[]): AkkoordStand =>
  standOp(extraTekst(e), akkoorden.filter((a) => a.extra_id === e.id))

/** Telt mee: niet geschrapt en alle drie akkoord. */
export const extraTelt = (e: BudgetExtra, akkoorden: ExtraAkkoord[]) => !e.gearchiveerd_op && extraStand(e, akkoorden).allen

/** Het extra budget van één vennoot, eventueel enkel in bepaalde maanden. */
export function extraVoor(extras: BudgetExtra[], v: Vennoot, maanden?: string[]): number {
  return rond(extras.filter((e) => e.vennoten.includes(v) && (!maanden || maanden.includes(e.maand))).reduce((s, e) => s + e.bedrag, 0))
}

// ── Terugkerende uitgaven ───────────────────────────────────────────────────
// Lease, huur, abonnement: een vast bedrag elke maand, elk kwartaal of elk
// jaar. Elke betaling tot vandaag telt mee als een uitgave van die vennoot;
// het akkoord geven de drie één keer, op de afspraak zelf.

export const FREQUENTIES = ['maand', 'kwartaal', 'jaar'] as const
export type Frequentie = (typeof FREQUENTIES)[number]
export const FREQ: Record<Frequentie, { elke: string; per: string; stap: number }> = {
  maand: { elke: 'Elke maand', per: 'per maand', stap: 1 },
  kwartaal: { elke: 'Elk kwartaal', per: 'per kwartaal', stap: 3 },
  jaar: { elke: 'Elk jaar', per: 'per jaar', stap: 12 },
}
export const isFrequentie = (v: unknown): v is Frequentie => (FREQUENTIES as readonly string[]).includes(String(v))

export type Terugkerend = {
  id: string
  vennoot: Vennoot
  omschrijving: string
  doel: string | null
  bedrag: number           // per keer
  frequentie: Frequentie
  start_datum: string      // eerste betaling
  eind_datum: string | null // laatste mogelijke betaling; leeg = loopt door
  bewijs_pad: string | null
  bewijs_naam: string | null
  gearchiveerd_op: string | null
  gearchiveerd_door: string | null
  archief_reden: string | null
  created_at: string | null
  created_by: string | null
}
export type TerugkerendAkkoord = Akkoord & { terugkerend_id: string }
export type TerugkerendInvoer = { vennoot: Vennoot; omschrijving: string; doel: string | null; bedrag: number; frequentie: Frequentie; start_datum: string; eind_datum: string | null }

const geldigeDag = (d: string) => DAG.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d

export function controleerTerugkerend(b: Record<string, unknown>): { ok: true; waarde: TerugkerendInvoer } | { ok: false; fout: string } {
  if (!isVennoot(b.vennoot)) return { ok: false, fout: 'Kies voor welke vennoot de uitgave is.' }
  const omschrijving = String(b.omschrijving ?? '').replace(/\s+/g, ' ').trim()
  if (omschrijving.length < 2) return { ok: false, fout: 'Wat is de uitgave? (bv. Lease Tesla)' }
  if (omschrijving.length > 200) return { ok: false, fout: 'Hou de omschrijving kort (max 200 tekens).' }
  const doel = String(b.doel ?? '').trim().slice(0, 500) || null
  const bedrag = leesGetal(b.bedrag)
  if (bedrag === null || bedrag <= 0) return { ok: false, fout: 'Vul het bedrag per keer in.' }
  if (bedrag > 100_000) return { ok: false, fout: 'Dat bedrag is te hoog.' }
  if (!isFrequentie(b.frequentie)) return { ok: false, fout: 'Kies hoe vaak: elke maand, elk kwartaal of elk jaar.' }
  const start = String(b.start_datum ?? '').trim()
  if (!geldigeDag(start)) return { ok: false, fout: 'Kies de datum van de eerste betaling.' }
  const eindRuw = String(b.eind_datum ?? '').trim()
  const eind = eindRuw ? eindRuw : null
  if (eind && !geldigeDag(eind)) return { ok: false, fout: 'De einddatum klopt niet.' }
  if (eind && eind < start) return { ok: false, fout: 'De einddatum ligt vóór de eerste betaling.' }
  return { ok: true, waarde: { vennoot: b.vennoot, omschrijving, doel, bedrag: rond(bedrag), frequentie: b.frequentie, start_datum: start, eind_datum: eind } }
}

export function terugkerendTekst(t: Pick<Terugkerend, 'id' | 'vennoot' | 'omschrijving' | 'doel' | 'bedrag' | 'frequentie' | 'start_datum' | 'eind_datum' | 'bewijs_pad' | 'bewijs_naam'>): string {
  return [
    `Terugkerende uitgave ${t.id}`,
    `Voor: ${t.vennoot}`,
    `Wat: ${t.omschrijving}`,
    `Waarvoor: ${t.doel ?? '—'}`,
    `Bedrag: ${rond(t.bedrag).toFixed(2)} ${FREQ[t.frequentie].per}`,
    `Vanaf: ${t.start_datum}`,
    `Tot en met: ${t.eind_datum ?? 'loopt door'}`,
    `Contract of factuur: ${t.bewijs_pad ? `${t.bewijs_naam ?? 'document'} (${t.bewijs_pad})` : 'geen'}`,
  ].join('\n')
}

export const terugkerendStand = (t: Parameters<typeof terugkerendTekst>[0], akkoorden: TerugkerendAkkoord[]): AkkoordStand =>
  standOp(terugkerendTekst(t), akkoorden.filter((a) => a.terugkerend_id === t.id))

/**
 * De datums van de betalingen: de eerste, dan telkens 1, 3 of 12 maanden later
 * op dezelfde dag (bestaat die dag niet, de laatste dag van de maand), tot en
 * met de einddatum en tot en met `tot`.
 */
export function betaaldata(t: Pick<Terugkerend, 'start_datum' | 'eind_datum' | 'frequentie'>, tot: string): string[] {
  if (!geldigeDag(t.start_datum)) return []
  const [j0, m0, d0] = t.start_datum.split('-').map(Number)
  const grens = t.eind_datum && t.eind_datum < tot ? t.eind_datum : tot
  const uit: string[] = []
  for (let i = 0; i < 1200; i++) {
    const totaal = j0 * 12 + (m0 - 1) + i * FREQ[t.frequentie].stap
    const j = Math.floor(totaal / 12), m = (totaal % 12) + 1
    const d = Math.min(d0, laatsteDag(j, m))
    const datum = `${maandStr(j, m)}-${String(d).padStart(2, '0')}`
    if (datum > grens) break
    uit.push(datum)
  }
  return uit
}

/** De eerstvolgende betaling na vandaag, of null (gestopt of afgelopen). */
export function volgendeBetaling(t: Pick<Terugkerend, 'start_datum' | 'eind_datum' | 'frequentie'>, vandaag: string): string | null {
  const ver = `${Number(vandaag.slice(0, 4)) + 2}${vandaag.slice(4)}`
  return betaaldata(t, ver).find((d) => d > vandaag) ?? null
}

/** Loopt nog: niet geschrapt en (geen einde of het einde ligt niet in het verleden). */
export const isLopend = (t: Pick<Terugkerend, 'gearchiveerd_op' | 'eind_datum'>, vandaag: string) => !t.gearchiveerd_op && (!t.eind_datum || t.eind_datum >= vandaag)

/** De betalingen tot en met vandaag, als uitgaven (voor de lijst per maand en het tegoed). Geschrapte afspraken tellen niet. */
export function terugkerendeUitgaven(lijst: Terugkerend[], vandaag: string): Uitgave[] {
  return lijst.filter((t) => !t.gearchiveerd_op).flatMap((t) => betaaldata(t, vandaag).map((d) => ({
    id: `t:${t.id}:${d}`, vennoot: t.vennoot, datum: d, omschrijving: t.omschrijving, doel: t.doel, bedrag: t.bedrag,
    bewijs_pad: t.bewijs_pad, bewijs_naam: t.bewijs_naam, gearchiveerd_op: null, gearchiveerd_door: null, archief_reden: null,
    created_at: t.created_at, created_by: t.created_by, terugkerend_id: t.id, frequentie: t.frequentie,
  })))
}

// ── Wat wacht op jouw akkoord ───────────────────────────────────────────────

export type OpenAkkoorden = { uitgaven: Uitgave[]; extras: BudgetExtra[]; terugkerend: Terugkerend[]; totaal: number }

export function openAkkoorden(d: {
  uitgaven: Uitgave[]; akkoorden: UitgaveAkkoord[]
  extras?: BudgetExtra[]; extraAkkoorden?: ExtraAkkoord[]
  terugkerend?: Terugkerend[]; terugkerendAkkoorden?: TerugkerendAkkoord[]
}, wie: Vennoot): OpenAkkoorden {
  const uitgaven = wachtOpAkkoord(d.uitgaven, d.akkoorden, wie)
  const extras = (d.extras ?? []).filter((e) => !e.gearchiveerd_op && !extraStand(e, d.extraAkkoorden ?? [])[wie])
  const terugkerend = (d.terugkerend ?? []).filter((t) => !t.gearchiveerd_op && !terugkerendStand(t, d.terugkerendAkkoorden ?? [])[wie])
  return { uitgaven, extras, terugkerend, totaal: uitgaven.length + extras.length + terugkerend.length }
}

/** "2 uitgaven, 1 extra budget en 1 terugkerende uitgave". */
export function openAkkoordenTekst(o: OpenAkkoorden): string {
  const delen = [
    o.uitgaven.length ? `${o.uitgaven.length} ${o.uitgaven.length === 1 ? 'uitgave' : 'uitgaven'}` : null,
    o.extras.length ? `${o.extras.length} keer extra budget` : null,
    o.terugkerend.length ? `${o.terugkerend.length} ${o.terugkerend.length === 1 ? 'terugkerende uitgave' : 'terugkerende uitgaven'}` : null,
  ].filter((x): x is string => !!x)
  return namenLijst(delen)
}

// ── Bonnetje lezen (AI) ─────────────────────────────────────────────────────
// De AI leest een foto of pdf van een bonnetje en stelt voor wat het is, de
// datum en het bedrag. Enkel een voorstel: wie en waarvoor kiest de vennoot,
// en niets wordt bewaard tot iemand op Bewaren drukt.

export type BonVoorstel = { winkel: string | null; omschrijving: string | null; datum: string | null; bedrag: number | null; zekerheid: number; opmerking: string | null }

/** Het antwoord van de AI nakijken: enkel een geldige datum (niet in de toekomst) en een bedrag in euro. */
export function leesBonVoorstel(text: string, vandaag: string): BonVoorstel {
  const leeg: BonVoorstel = { winkel: null, omschrijving: null, datum: null, bedrag: null, zekerheid: 0, opmerking: 'Het bonnetje kon niet gelezen worden.' }
  const a = text.indexOf('{'), z = text.lastIndexOf('}')
  if (a === -1 || z === -1) return leeg
  let p: Record<string, unknown>
  try { p = JSON.parse(text.slice(a, z + 1)) } catch { return leeg }
  if (p.is_bon === false) return { ...leeg, opmerking: 'Dit lijkt geen bonnetje of factuur.' }
  const kort = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '') || null
  const datumRuw = typeof p.datum === 'string' ? p.datum.trim() : ''
  const datum = DAG.test(datumRuw) && new Date(`${datumRuw}T12:00:00Z`).toISOString().slice(0, 10) === datumRuw && datumRuw <= vandaag ? datumRuw : null
  const munt = typeof p.munt === 'string' ? p.munt.trim().toUpperCase() : 'EUR'
  const getal = leesGetal(p.totaal)
  const bedrag = munt === 'EUR' && getal !== null && getal > 0 && getal <= 100_000 ? rond(getal) : null
  const zekerheid = Number(p.zekerheid)
  return {
    winkel: kort(p.winkel, 80),
    omschrijving: kort(p.omschrijving, 200),
    datum, bedrag,
    zekerheid: Number.isFinite(zekerheid) ? Math.max(0, Math.min(1, zekerheid)) : 0,
    opmerking: munt !== 'EUR' && getal !== null ? `Het bonnetje is in ${munt}; vul het bedrag in euro in.` : null,
  }
}
