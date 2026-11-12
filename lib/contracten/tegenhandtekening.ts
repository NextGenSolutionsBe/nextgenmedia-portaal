/**
 * Tegenhandtekening: na de klant tekent NextGenMedia het contract ook.
 * Pure regels (getest in tests/tegenhandtekening.test.ts).
 *
 *  - Elk contract heeft een zone voor de klant (sig_*) én een zone voor ons
 *    (ons_sig_*). Ontbreekt die laatste (oudere contracten), dan staat ze
 *    standaard gespiegeld naast die van de klant; je kan ze bij het tekenen nog verslepen.
 *  - Tegentekenen kan enkel op een contract dat de klant al tekende, en maar één keer.
 *  - Het door de klant getekende bestand verandert nooit: onze handtekening komt
 *    op een kopie, die de nieuwe getekende versie wordt (nieuwe archiefversie).
 */

import { canonicalStatus } from '@/lib/contract-status'

/** x en y in % vanaf linksboven, breedte en hoogte in PDF-punten (zoals de zone van de klant). */
export type OnsZone = { page: number; x: number; y: number; w: number; h: number }

type KlantZone = { sig_page?: number | null; sig_x_pct?: number | null; sig_y_pct?: number | null; sig_width?: number | null; sig_height?: number | null }
type OnsKolommen = { ons_sig_page?: number | null; ons_sig_x_pct?: number | null; ons_sig_y_pct?: number | null; ons_sig_width?: number | null; ons_sig_height?: number | null }

const A4_BREEDTE = 595.28
const rond = (v: number) => Math.round(v * 10) / 10
const getal = (v: unknown, terugval: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : terugval)
const tussen = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/** Onze plek als er nog geen is: dezelfde pagina en hoogte als de klant, aan de andere kant van de pagina. */
export function standaardOnsZone(k: KlantZone): OnsZone {
  const page = Math.max(1, Math.round(getal(k.sig_page, 1)))
  const x = getal(k.sig_x_pct, 5), y = getal(k.sig_y_pct, 75)
  const w = tussen(getal(k.sig_width, 200), 60, 400), h = tussen(getal(k.sig_height, 60), 24, 200)
  const breedtePct = (w / A4_BREEDTE) * 100
  const maxX = Math.max(0, 98 - breedtePct)
  const nx = x < 45 ? Math.min(maxX, x + 50) : Math.max(0, x - 50)
  return { page, x: rond(nx), y: rond(tussen(y, 0, 95)), w, h }
}

/** De zone voor ons: wat ingesteld is, anders de standaard naast de klant. */
export function onsZoneVan(c: KlantZone & OnsKolommen): OnsZone {
  if (c.ons_sig_page && c.ons_sig_x_pct !== null && c.ons_sig_x_pct !== undefined && c.ons_sig_y_pct !== null && c.ons_sig_y_pct !== undefined) {
    return controleerZone({ page: c.ons_sig_page, x: c.ons_sig_x_pct, y: c.ons_sig_y_pct, w: c.ons_sig_width, h: c.ons_sig_height })
  }
  return standaardOnsZone(c)
}

/** Een zone uit een verzoek: altijd binnen de pagina en met een redelijke grootte. */
export function controleerZone(b: unknown, aantalPaginas?: number): OnsZone {
  const z = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  const max = aantalPaginas && aantalPaginas > 0 ? aantalPaginas : 999
  return {
    page: tussen(Math.round(getal(z.page, 1)), 1, max),
    x: rond(tussen(getal(z.x, 55), 0, 98)),
    y: rond(tussen(getal(z.y, 75), 0, 98)),
    w: Math.round(tussen(getal(z.w, 200), 60, 400)),
    h: Math.round(tussen(getal(z.h, 60), 24, 200)),
  }
}

/** Kolommen om de zone te bewaren. */
export const zoneKolommen = (z: OnsZone) => ({ ons_sig_page: z.page, ons_sig_x_pct: z.x, ons_sig_y_pct: z.y, ons_sig_width: z.w, ons_sig_height: z.h })

type ContractStand = { status?: string | null; tegengetekend_op?: string | null }

/** Wacht dit contract nog op onze handtekening? (De klant tekende, wij nog niet.) */
export const moetTegentekenen = (c: ContractStand): boolean => canonicalStatus(c.status) === 'getekend' && !c.tegengetekend_op
export const isTegengetekend = (c: ContractStand): boolean => !!c.tegengetekend_op

/** Waarom kan dit contract (nog) niet door ons getekend worden? null = het kan. */
export function redenNietTegentekenen(c: ContractStand & { pdf_path?: string | null; signed_pdf_path?: string | null }): string | null {
  if (c.tegengetekend_op) return 'Dit contract is al door ons ondertekend.'
  if (canonicalStatus(c.status) !== 'getekend') return 'De klant moet het contract eerst ondertekenen.'
  if (!c.signed_pdf_path && !c.pdf_path) return 'Dit contract heeft geen PDF om te ondertekenen.'
  return null
}

/** Namens welk bedrijf we tekenen (merk van de projectkaart). */
export const bedrijfVoorMerk = (merk: string | null | undefined): string =>
  merk === 'nextgensolutions' ? 'NextGenSolutions' : merk === 'foundersofflanders' ? 'Founders of Flanders' : 'NextGenMedia'

/** Een naam voor onder de handtekening: opgekuist, 2 tot 80 tekens. */
export function controleerNaam(v: unknown): string | null {
  const n = String(v ?? '').replace(/\s+/g, ' ').trim()
  return n.length >= 2 && n.length <= 80 ? n : null
}

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/

/** De getekende handtekening als base64 (zonder voorvoegsel), of een fout. */
export function leesHandtekening(v: unknown): { ok: true; base64: string } | { ok: false; fout: string } {
  const m = typeof v === 'string' ? v.match(PNG_DATA_URL) : null
  if (!m) return { ok: false, fout: 'Teken eerst je handtekening.' }
  const bytes = Math.floor((m[1].length * 3) / 4)
  if (bytes < 300) return { ok: false, fout: 'Teken eerst je handtekening.' }
  if (bytes > 1_500_000) return { ok: false, fout: 'De handtekening is te groot. Probeer opnieuw.' }
  return { ok: true, base64: m[1] }
}

/** De regel onder onze handtekening op de PDF. */
export function annotatie(o: { naam: string; bedrijf: string; op: string }): string {
  const datum = new Date(o.op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
  return `Ondertekend namens ${o.bedrijf} door ${o.naam} · ${datum}`
}

/**
 * Datum en uur onder de handtekening, in hetzelfde blok: het moment van tekenen
 * in Belgische tijd, bv. "9 november 2026, 14:32". Niemand vult dit zelf in.
 */
export function datumRegel(op: string | Date): string {
  const d = typeof op === 'string' ? new Date(op) : op
  const dag = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
  const uur = d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Brussels' })
  return `${dag}, ${uur}`
}

/** Hoogte (punten) die de datumregel onderaan het blok inneemt; de handtekening krijgt de rest. */
export const DATUM_HOOGTE = 12

/**
 * Het volgende contract om te tekenen, in de volgorde van de lijst (recentste
 * eerst). Na het laatste begint het opnieuw bij het eerste dat nog open staat
 * (bv. een overgeslagen contract). null = er is geen ander meer.
 */
export function volgendeInLijst(open: string[], huidig: string): string | null {
  const i = open.indexOf(huidig)
  if (i === -1) return open[0] ?? null
  const na = open[i + 1]
  if (na) return na
  return open[0] && open[0] !== huidig ? open[0] : null
}

/** De taak in ClickUp zodra de klant tekende. */
export function tegentekenTaak(o: { klant: string | null; titel: string; ondertekenaar: string | null; op: string | null; url: string }): { omschrijving: string; notitie: string } {
  const klant = o.klant?.trim() || 'klant'
  const op = o.op ? new Date(o.op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' }) : null
  return {
    omschrijving: `Contract tegentekenen – ${klant}`.slice(0, 200),
    notitie: [
      `"${o.titel}" werd ondertekend${o.ondertekenaar ? ` door ${o.ondertekenaar}` : ''}${op ? ` op ${op}` : ''}.`,
      `Zet nu ook onze handtekening: ${o.url}`,
    ].join('\n'),
  }
}

/** Hoe de klant het contract ziet: door beide partijen ondertekend, of wacht nog op ons. */
export function handtekeningStand(c: ContractStand): 'beide' | 'wacht_op_ons' | null {
  if (canonicalStatus(c.status) !== 'getekend') return null
  return c.tegengetekend_op ? 'beide' : 'wacht_op_ons'
}
