/**
 * Wat zit vast bij klanten (verbeterplan fase 6, punt 70): alles waarop wij
 * wachten van de klant, per klant, met hoe lang al. Pure regels, getest in
 * tests/sales-fase6.test.ts. Enkel lezen; nooit een mail of herinnering vanzelf.
 */
export type WachtSoort = 'contract' | 'oplevering' | 'content' | 'offerte' | 'aanvraag'
export const WACHT_LABEL: Record<WachtSoort, string> = {
  contract: 'Contract tekenen', oplevering: 'Oplevering bekijken', content: 'Content goedkeuren', offerte: 'Offerte beantwoorden', aanvraag: 'Offerte op aanvraag',
}

export type WachtRij = { client_id: string; klant: string; soort: WachtSoort; titel: string; sinds: string; href: string; aantal?: number }
export type WachtKlant = { client_id: string; klant: string; dagen: number; rijen: (WachtRij & { dagen: number })[] }

const dagenSinds = (iso: string, vandaag: string) => Math.max(0, Math.round((Date.parse(`${vandaag}T12:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)) / 86_400_000))

/** Per klant, de klant die het langst wacht bovenaan; binnen een klant de oudste eerst. */
export function wachtPerKlant(rijen: WachtRij[], vandaag: string): WachtKlant[] {
  const m = new Map<string, WachtKlant>()
  for (const r of rijen) {
    const d = dagenSinds(r.sinds, vandaag)
    const k = m.get(r.client_id) ?? { client_id: r.client_id, klant: r.klant, dagen: 0, rijen: [] }
    k.rijen.push({ ...r, dagen: d })
    k.dagen = Math.max(k.dagen, d)
    m.set(r.client_id, k)
  }
  for (const k of m.values()) k.rijen.sort((a, b) => b.dagen - a.dagen)
  return [...m.values()].sort((a, b) => b.dagen - a.dagen || a.klant.localeCompare(b.klant))
}

export const wachtTekst = (d: number) => (d === 0 ? 'sinds vandaag' : d === 1 ? 'sinds gisteren' : `al ${d} dagen`)
