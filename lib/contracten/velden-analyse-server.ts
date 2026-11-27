import 'server-only'
import { analyzeContractPdf, type ContractField } from '@/lib/contract-ai'
import { lijnAnalyseUit } from './velden-uitlijnen-server'
import type { ZoneIn } from './velden-uitlijnen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export type VeldenAnalyse = { fields: ContractField[]; signature: ZoneIn | null; ons: ZoneIn | null; uitgelijnd: boolean }

/**
 * Invulvelden en handtekeningzones van een contract of template zoeken en bewaren
 * (27 nov 2026). De AI zegt welke velden er zijn; de exacte plek komt uit de pdf zelf
 * (lijnen, vakjes, kaders: velden-uitlijnen.ts). Onze handtekeningzone (tegentekenen)
 * zetten we enkel als er nog geen gekozen was. Gebruikt door de knop "Analyseer met AI"
 * en vanzelf na het opladen (VeldenZoeken op de contractpagina).
 */
export async function analyseerVelden(admin: Admin, tabel: 'contracts' | 'contract_templates', rij: { id: string; pdf_path: string | null; ons_sig_page?: number | null }, opts: { zoneVast?: boolean } = {}): Promise<VeldenAnalyse> {
  if (!rij.pdf_path) throw new Error('Geen PDF gekoppeld.')
  const { data: file } = await admin.storage.from('contracts').download(rij.pdf_path)
  if (!file) throw new Error('PDF kon niet geladen worden.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const ai = await analyzeContractPdf(Buffer.from(bytes).toString('base64'))
  const r = await lijnAnalyseUit(bytes, ai)
  const ons = r.ons && (rij.ons_sig_page === null || rij.ons_sig_page === undefined) ? r.ons : null

  const patch: Record<string, unknown> = { detected_fields: r.fields }
  // zoneVast: iemand zette de zone van de klant al zelf; die blijft staan.
  if (r.signature && !opts.zoneVast) {
    patch.sig_page = r.signature.page
    patch.sig_x_pct = Math.max(0, Math.min(95, r.signature.x))
    patch.sig_y_pct = Math.max(0, Math.min(95, r.signature.y))
    patch.sig_width = r.signature.width
    patch.sig_height = r.signature.height
  }
  if (ons) Object.assign(patch, { ons_sig_page: ons.page, ons_sig_x_pct: ons.x, ons_sig_y_pct: ons.y, ons_sig_width: ons.width, ons_sig_height: ons.height })
  // Veerkrachtig: laat ontbrekende kolommen vallen (bv. vóór een migratie).
  const p: Record<string, unknown> = { ...patch }
  for (let i = 0; i < 12; i++) {
    const { error } = await admin.from(tabel).update(p).eq('id', rij.id)
    if (!error) break
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in p) { delete p[col]; continue }
    throw new Error(error.message)
  }
  return { fields: r.fields, signature: r.signature, ons, uitgelijnd: r.uitgelijnd }
}
