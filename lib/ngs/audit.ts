/**
 * Het auditrapport van NextGenSolutions (nieuwe werking fase 3, 28 nov 2026).
 * Per audit: de processen (wie raakt ze aan, hoeveel uur per week) en de
 * workflows die we voorstellen. De prijs van een workflow komt uit de waarde
 * voor de klant, nooit uit uren × tarief:
 *   bespaarde uren per week × weken × uurwaarde (instellingen), afgerond,
 * met een maat (Klein, Middel, Groot) en een vork per maat. Buiten de vork kan
 * enkel met een reden. Projecten zonder tijdswinst ("Andere waarde"): geschatte
 * uren × uurprijs, met een marktcheck. De klant ziet nooit de formule, de
 * uurwaarde of de uurprijs: enkel maat, vaste prijs, bespaarde uren en terugverdientijd.
 * Pure regels, getest in tests/ngs-audit.test.ts.
 */
import type { Maat, WerkingInstellingen } from '@/lib/werking/instellingen'

export type Prijzen = WerkingInstellingen['prijzen']
export type Betrokkene = { naam: string; uren: number }
export type Proces = { id: string; naam: string; betrokkenen: Betrokkene[]; uren_per_week: number; notitie: string | null; workflow_id: string | null; volgorde: number }
export type WorkflowSoort = 'tijd' | 'andere_waarde'
export type Workflow = {
  id: string; naam: string; oplossing: string | null; soort: WorkflowSoort; geschatte_uren: number | null; marktcheck: string | null
  interface_of_logboek: boolean; maat: Maat | null; prijs: number | null; prijs_reden: string | null; volgorde: number
}

const rond2 = (x: number) => Math.round(x * 100) / 100
const getal = (v: unknown) => { const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? n : NaN }

/** Wie het proces aanraakt, netjes: naam verplicht, uren per week tussen 0 en 80. */
export function leesBetrokkenen(v: unknown): Betrokkene[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 30).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>
    const naam = String(r.naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const uren = getal(r.uren)
    return naam && uren >= 0 && uren <= 80 ? { naam, uren: rond2(uren) } : null
  }).filter((x): x is Betrokkene => !!x)
}

/** De gemeten uren per week van een proces: opgeteld over iedereen die het aanraakt. */
export const urenPerWeek = (b: Betrokkene[]) => rond2(b.reduce((s, x) => s + x.uren, 0))

/** De maat bij een aantal bespaarde uren per week. Onder het minimum = geen maat (bundelen). */
export function maatVan(uren: number, p: Prijzen): Maat | null {
  if (!(uren >= p.min_uren)) return null
  if (uren > (p.maten.middel.tot ?? Infinity)) return 'groot'
  if (uren >= p.maten.middel.van) return 'middel'
  return 'klein'
}

/** Afronden op de afronding uit de instellingen (bv. € 50). */
export const afgerond = (bedrag: number, stap: number) => Math.round(bedrag / stap) * stap

/** De prijs uit de formule: bespaarde uren × weken × uurwaarde, afgerond. */
export const prijsUitFormule = (uren: number, p: Prijzen) => afgerond(uren * p.weken * p.uurwaarde, p.afronding)

/** Andere waarde (geen tijdswinst): geschatte uren × uurprijs, afgerond. */
export const prijsAndereWaarde = (uren: number, p: Prijzen) => afgerond(uren * p.andere_uurprijs, p.afronding)

export function binnenVork(maat: Maat | null, prijs: number, p: Prijzen): boolean {
  if (!maat) return true
  const v = p.maten[maat]
  return prijs >= v.min && (v.max === null || prijs <= v.max)
}

/** De uren van een workflow: de som van zijn processen. */
export function workflowUren(w: Pick<Workflow, 'id'>, processen: Pick<Proces, 'workflow_id' | 'uren_per_week'>[]): number {
  return rond2(processen.filter((x) => x.workflow_id === w.id).reduce((s, x) => s + x.uren_per_week, 0))
}

/** Het voorstel voor een workflow: maat en prijs. */
export function voorstelVoor(w: Pick<Workflow, 'soort' | 'geschatte_uren'>, uren: number, p: Prijzen): { maat: Maat | null; prijs: number | null } {
  if (w.soort === 'andere_waarde') return { maat: null, prijs: w.geschatte_uren ? prijsAndereWaarde(w.geschatte_uren, p) : null }
  const maat = maatVan(uren, p)
  return { maat, prijs: maat ? prijsUitFormule(uren, p) : null }
}

/**
 * Een prijs bewaren: ligt hij buiten de vork van de maat, dan enkel met een
 * reden van minstens tien tekens (zelfde regel als de minimumprijs bij offertes).
 */
export function controleerPrijs(maat: Maat | null, prijs: unknown, reden: unknown, p: Prijzen): { ok: true; prijs: number; reden: string | null } | { ok: false; fout: string } {
  const n = getal(prijs)
  if (!(n > 0) || n > 10_000_000) return { ok: false, fout: 'Vul een prijs in.' }
  const r = String(reden ?? '').trim()
  if (!binnenVork(maat, n, p)) {
    if (r.length < 10) {
      const v = p.maten[maat!]
      return { ok: false, fout: `Die prijs ligt buiten de vork van ${maat} (€ ${v.min.toLocaleString('nl-BE')}${v.max ? ` tot € ${v.max.toLocaleString('nl-BE')}` : ' en meer'}). Geef een reden van minstens tien tekens.` }
    }
    return { ok: true, prijs: rond2(n), reden: r.slice(0, 500) }
  }
  return { ok: true, prijs: rond2(n), reden: r ? r.slice(0, 500) : null }
}

/**
 * Een workflow apart: een proces onder het minimum (3 uur per week) kan niet
 * alleen. "Bundel met een ander proces." Andere waarde telt niet in uren.
 */
export function waaromNietApart(w: Pick<Workflow, 'soort'>, uren: number, p: Prijzen): string | null {
  if (w.soort === 'andere_waarde') return null
  return uren < p.min_uren ? `Minder dan ${p.min_uren} uur per week: bundel met een ander proces.` : null
}

/** Rapport afronden: elke workflow heeft een prijs, haalt het minimum en heeft een interface of minstens een logboek. */
export function waaromNietAfronden(workflows: Workflow[], processen: Proces[], p: Prijzen): string | null {
  const actief = workflows
  if (!actief.length) return 'Er is nog geen workflow.'
  const los = processen.filter((x) => !x.workflow_id)
  if (los.length) return `${los.length === 1 ? 'Eén proces hangt' : `${los.length} processen hangen`} nog aan geen workflow. Bundel ${los.length === 1 ? 'het' : 'ze'} of haal ${los.length === 1 ? 'het' : 'ze'} weg.`
  for (const w of actief) {
    const uren = workflowUren(w, processen)
    const apart = waaromNietApart(w, uren, p)
    if (apart) return `${w.naam}: ${apart}`
    if (!(w.prijs && w.prijs > 0)) return `${w.naam}: nog geen prijs.`
    if (!w.interface_of_logboek) return `${w.naam}: een oplossing heeft altijd een interface of minstens een logboek. Vink het aan.`
    if (w.soort === 'andere_waarde' && !w.geschatte_uren) return `${w.naam}: hoeveel uur schatten we?`
  }
  return null
}

/** Terugverdientijd in maanden: prijs ÷ (bespaarde uren per week × uurwaarde × 52 ÷ 12). Andere waarde: geen. */
export function terugverdienMaanden(prijs: number | null, uren: number, w: Pick<Workflow, 'soort'>, p: Prijzen): number | null {
  if (!prijs || w.soort === 'andere_waarde' || !(uren > 0)) return null
  return Math.round((prijs / (uren * p.uurwaarde * 52 / 12)) * 10) / 10
}

/** Wat de klant ziet (rapport, klantapp, API): enkel dit, nooit de formule, de uurwaarde of de uurprijs. */
export type KlantWorkflow = { naam: string; oplossing: string | null; maat: Maat | null; prijs: number | null; uren_per_week: number | null; terugverdientijd_maanden: number | null; andere_waarde: boolean }
export function klantWorkflow(w: Workflow, processen: Proces[], p: Prijzen): KlantWorkflow {
  const uren = w.soort === 'tijd' ? workflowUren(w, processen) : null
  return {
    naam: w.naam, oplossing: w.oplossing, maat: w.maat, prijs: w.prijs, uren_per_week: uren,
    terugverdientijd_maanden: terugverdienMaanden(w.prijs, uren ?? 0, w, p), andere_waarde: w.soort === 'andere_waarde',
  }
}

/** Gemiddeld bespaard per workflow (uit afgeronde rapporten), voor de verkoop. */
export function gemiddeldBespaard(rijen: { uren: number }[]): { aantal: number; gemiddeld: number | null } {
  const l = rijen.filter((r) => r.uren > 0)
  return { aantal: l.length, gemiddeld: l.length ? Math.round((l.reduce((s, r) => s + r.uren, 0) / l.length) * 10) / 10 : null }
}

/** Het voorstel van de AI netjes: processen met naam, betrokkenen (naam + uren) en een oplossing. */
export type ProcesVoorstel = { naam: string; betrokkenen: Betrokkene[]; oplossing: string }
export function leesRapportVoorstel(tekst: string): ProcesVoorstel[] | null {
  const m = tekst.match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: unknown
  try { j = JSON.parse(m[0]) } catch { return null }
  const lijst = (j as { processen?: unknown }).processen
  if (!Array.isArray(lijst)) return null
  return lijst.slice(0, 20).map((x) => {
    const r = (x ?? {}) as Record<string, unknown>
    const naam = String(r.naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
    return naam ? { naam, betrokkenen: leesBetrokkenen(r.betrokkenen), oplossing: String(r.oplossing ?? '').trim().slice(0, 2000) } : null
  }).filter((x): x is ProcesVoorstel => !!x)
}
