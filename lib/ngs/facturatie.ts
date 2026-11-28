/**
 * Facturatie van NextGenSolutions (nieuwe werking fase 5, 28 nov 2026). De audit
 * wordt vooraf gefactureerd; elke workflow bij de oplevering. De eerste workflow
 * die gefactureerd wordt, verrekent de audit: hoogstens het bedrag van die
 * workflow, nooit een negatieve factuur, nooit iets terug.
 * Pure regels, getest in tests/ngs-facturatie.test.ts.
 */

const rond = (x: number) => Math.round(x * 100) / 100

/** Verrekening van de audit op een workflow: € 1.040 + € 4.200 → € 1.040 verrekend, € 3.160 te factureren. */
export function verrekening(audit: number | null | undefined, workflow: number): { verrekend: number; teFactureren: number } {
  const a = Number.isFinite(Number(audit)) ? Math.max(0, Number(audit)) : 0
  const w = Math.max(0, Number(workflow) || 0)
  const verrekend = rond(Math.min(a, w))
  return { verrekend, teFactureren: rond(w - verrekend) }
}

/** De vervaldatum: factuurdatum + betaaltermijn. */
export function vervaldag(datum: string, termijn: number): string {
  const d = new Date(`${datum.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.round(termijn)))
  return d.toISOString().slice(0, 10)
}

/** De betaaltermijn van een bedrijf, anders de algemene instelling. */
export function betaaltermijn(vanBedrijf: number | null | undefined, standaard: number): number {
  const n = Number(vanBedrijf)
  return vanBedrijf !== null && vanBedrijf !== undefined && Number.isFinite(n) && n >= 0 && n <= 365 ? Math.round(n) : standaard
}

export type FactuurRegel = { artikel: string; omschrijving: string; prijs: number }

/** De auditfactuur: één regel, het aantal processen in de omschrijving. */
export function auditRegels(processen: number | null, prijs: number): FactuurRegel[] {
  const n = processen ?? 0
  return [{ artikel: 'Audit', omschrijving: n ? `Audit van ${n} ${n === 1 ? 'proces' : 'processen'}, met rapport en presentatie.` : 'Audit met rapport en presentatie.', prijs: rond(prijs) }]
}

/** De factuur van een workflow, met de verrekening van de audit als tweede regel (een negatief bedrag). */
export function workflowRegels(naam: string, oplossing: string | null, prijs: number, verrekend: number): FactuurRegel[] {
  const r: FactuurRegel[] = [{ artikel: naam, omschrijving: oplossing?.trim() || naam, prijs: rond(prijs) }]
  if (verrekend > 0) r.push({ artikel: 'Verrekening audit', omschrijving: 'Het bedrag van de audit, verrekend met deze workflow.', prijs: -rond(verrekend) })
  return r
}

export const totaalVan = (r: FactuurRegel[]) => rond(r.reduce((s, x) => s + x.prijs, 0))
