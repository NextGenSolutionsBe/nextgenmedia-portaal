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
}

export type RegelsVersie = { id: string; versie: number; regels: string[]; maandbudget: number; start_maand: string; created_at: string | null; created_by: string | null }

const isVennoot = (v: unknown): v is Vennoot => VENNOTEN.includes(v as Vennoot)
const rond = (x: number) => Math.round(x * 100) / 100
const DAG = /^\d{4}-\d{2}-\d{2}$/
const MAAND = /^\d{4}-(0[1-9]|1[0-2])$/

// ── Een uitgave invoeren ────────────────────────────────────────────────────

export type UitgaveInvoer = { vennoot: Vennoot; datum: string; omschrijving: string; doel: string | null; bedrag: number }

export function controleerUitgave(b: Record<string, unknown>, vandaag: string): { ok: true; waarde: UitgaveInvoer } | { ok: false; fout: string } {
  if (!isVennoot(b.vennoot)) return { ok: false, fout: 'Kies voor welke vennoot de uitgave was.' }
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
  return { ok: true, waarde: { vennoot: b.vennoot, datum, omschrijving, doel, bedrag: rond(bedrag) } }
}

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
  budgetPeriode: number
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
export function standPerVennoot(uitgaven: Uitgave[], budget: Budget, periode: Periode, huidigeMaand: string): VennootStand[] {
  const maandenMetBudget = periode.maanden.filter((m) => m >= budget.start_maand && m <= huidigeMaand).length
  const budgetTotaal = rond(budget.maandbudget * maandenTussen(budget.start_maand, huidigeMaand))
  return VENNOTEN.map((v) => {
    const eigen = uitgaven.filter((u) => u.vennoot === v && telt(u))
    const inPeriode = eigen.filter((u) => u.datum >= periode.van && u.datum <= periode.tot)
    const besteedTotaal = rond(eigen.reduce((s, u) => s + u.bedrag, 0))
    return {
      vennoot: v,
      besteedPeriode: rond(inPeriode.reduce((s, u) => s + u.bedrag, 0)),
      budgetPeriode: rond(budget.maandbudget * maandenMetBudget),
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
    .filter((u) => !vennoot || u.vennoot === vennoot)
    .filter((u) => !periode || (u.datum >= periode.van && u.datum <= periode.tot))
    .sort((a, b) => b.datum.localeCompare(a.datum) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
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

export type RegelHandtekening = { vennoot: Vennoot; naam: string | null; getekend_op: string; inhoud_tekst: string; handtekening?: string | null }

/** Wie tekende de huidige versie (met exact deze tekst)? */
export function tekenStand(v: RegelsVersie | null, handtekeningen: RegelHandtekening[]): Record<Vennoot, RegelHandtekening | null> & { allen: boolean } {
  const tekst = v ? regelsTekst(v) : null
  const per = Object.fromEntries(VENNOTEN.map((k) => [k, (tekst && handtekeningen.find((h) => h.vennoot === k && h.inhoud_tekst === tekst)) || null])) as Record<Vennoot, RegelHandtekening | null>
  return { ...per, allen: !!tekst && VENNOTEN.every((k) => !!per[k]) }
}
