import 'server-only'
import { canonicalStatus } from '@/lib/contract-status'
import { logContractEvent } from '@/lib/contract-audit'
import { DEFAULT_VAT } from '@/lib/invoices'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { maakVoorstel, voorstelBedrag, valideerVoorstel, contractSamenvatting, type Voorstelregel } from './voorstel'
import { normaliseerRegels, berekenTotalen } from '@/lib/facturen/regels'
import { normaliseerVerzendstatus, afgeleideBetaalstatus } from '@/lib/facturen/status'
import { vandaagBrussel } from './planner-model'
import { type Opdracht, type OpdrachtStatus, type ContractRij, type KlantRij } from './schema'
export * from './schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }
type Actor = { id: string; email?: string | null }

/**
 * Contract → factuurvoorstel → bevestigde facturen.
 *
 * Bij een definitieve ondertekening (of op vraag van een medewerker) leidt
 * de app een VOORSTEL van facturen af uit de facturatieafspraken op het
 * contract (lib/facturatie/voorstel.ts). Die voorstellen staan in
 * contract_facturatie_opdrachten en zijn nog geen facturen: een mens
 * controleert, past aan en bevestigt. De bevestiging draait in één
 * databanktransactie (bevestig_factuurplanning) en is idempotent — een
 * dubbele klik of herlaadde pagina maakt nooit een tweede factuur.
 *
 * Er gaat niets meer naar ClickUp: de facturenlijst en de planner zijn de
 * werklijst van wie factureert.
 */

async function log(admin: Admin, r: {
  contract_id: string | null; opdracht_id?: string | null; gebeurtenis: string; contractstatus?: string | null
  verwerking_sleutel?: string | null; fout?: string | null; details?: Record<string, unknown>
}) {
  try { await admin.from('contract_facturatie_log').insert({ ...r, fout: r.fout ? String(r.fout).slice(0, 1000) : null }) } catch { /* log mag nooit breken */ }
}

const dag = (s: string | null | undefined): string | null => (s ? String(s).slice(0, 10) : null)

export async function laadContract(admin: Admin, contractId: string): Promise<{ contract: ContractRij | null; klant: KlantRij | null }> {
  const { data: contract } = await admin.from('contracts')
    .select('id, title, status, client_id, service_slug, start_date, end_date, duration_type, signed_at, signer_name, signer_email, expected_invoice_count, invoice_frequency, expected_invoice_amount_excl')
    .eq('id', contractId).maybeSingle()
  if (!contract) return { contract: null, klant: null }
  let klant: KlantRij | null = null
  if (contract.client_id) {
    const { data } = await admin.from('clients').select('id, company_name, contact_name, email, btw_nummer').eq('id', contract.client_id).maybeSingle()
    klant = (data as KlantRij | null) ?? null
  }
  return { contract: contract as ContractRij, klant }
}

export type VerwerkResultaat = {
  gestart: boolean; reden?: string
  aangemaakt: number; bestaand: number
  /** Historisch veld (ClickUp); blijft 0. */
  gesynct: number; mislukt: number
}

async function standaardBtwEnTermijn(): Promise<{ btw: number; termijn: number }> {
  try { const i = await leesInstellingen(); return { btw: Number(i.facturatie.standaard_btw_pct) || DEFAULT_VAT, termijn: Number(i.facturatie.betalingstermijn_dagen) || 30 } }
  catch { return { btw: DEFAULT_VAT, termijn: 30 } }
}

function naarRij(contractId: string, clientId: string | null, v: Voorstelregel, bron: string): Record<string, unknown> {
  const b = voorstelBedrag(v)
  return {
    contract_id: contractId, client_id: clientId,
    volgnr: v.volgnr, aantal: v.aantal, type: v.type, factuurdatum: v.factuurdatum, periode: v.periode,
    bedrag_excl: b.excl, btw_pct: v.btw_pct, bedrag_incl: b.incl,
    omschrijving: v.omschrijving, betalingstermijn_dagen: v.betalingstermijn_dagen,
    status: (v.ontbrekend.length ? 'controle_vereist' : 'open') as OpdrachtStatus,
    ontbrekend: v.ontbrekend, aandachtspunten: v.aandachtspunten,
    regels: v.regels, bron_velden: v.bron_velden, handmatig_gewijzigd: false,
    sync_status: 'controle_vereist', bron,
  }
}

/**
 * Het startpunt: bij ondertekening (tekenlink of upload van een getekend
 * contract) en op vraag van een medewerker. Bestaan er al voorstellen of
 * facturen voor dit contract, dan komt er niets bij (idempotent); opnieuw
 * genereren gaat via genereerVoorstel(…, { vervang: true }).
 */
export async function verwerkOndertekening(admin: Admin, contractId: string, bron: 'tekenlink' | 'upload_getekend' | 'handmatig', actor?: string | null): Promise<VerwerkResultaat> {
  const uit: VerwerkResultaat = { gestart: false, aangemaakt: 0, bestaand: 0, gesynct: 0, mislukt: 0 }
  const { contract, klant } = await laadContract(admin, contractId)
  if (!contract) { uit.reden = 'Contract niet gevonden.'; return uit }
  if (canonicalStatus(contract.status) !== 'getekend') {
    uit.reden = `Contractstatus is "${contract.status ?? 'onbekend'}", niet ondertekend. Er is niets aangemaakt.`
    await log(admin, { contract_id: contractId, gebeurtenis: 'overgeslagen_niet_ondertekend', contractstatus: contract.status, details: { bron } })
    return uit
  }
  uit.gestart = true
  const { data: bestaand } = await admin.from('contract_facturatie_opdrachten').select('id').eq('contract_id', contractId)
  uit.bestaand = (bestaand ?? []).length
  if (uit.bestaand > 0) return uit

  const { btw, termijn } = await standaardBtwEnTermijn()
  const voorstel = maakVoorstel(contract, klant, btw, termijn)
  const rijen = voorstel.regels.map((v) => naarRij(contractId, contract.client_id ?? null, v, bron === 'handmatig' ? 'handmatig' : 'automatisch'))
  const { error } = await admin.from('contract_facturatie_opdrachten').insert(rijen)
  if (error) {
    await log(admin, { contract_id: contractId, gebeurtenis: 'aanmaken_mislukt', contractstatus: contract.status, fout: error.message })
    uit.reden = `Voorstel aanmaken mislukt: ${error.message}`
    return uit
  }
  uit.aangemaakt = rijen.length
  const sleutel = `${contractId}:${dag(contract.signed_at) ?? 'geen-datum'}:${bron}`
  await log(admin, { contract_id: contractId, gebeurtenis: 'voorstel_gegenereerd', contractstatus: contract.status, verwerking_sleutel: sleutel, details: { bron, aangemaakt: uit.aangemaakt, controle_vereist: voorstel.ontbrekend.length > 0, ontbrekend: voorstel.ontbrekend } })
  await logContractEvent(admin, contractId, 'facturatie_opdrachten_aangemaakt', { actor: actor ?? null, meta: { aantal: uit.aangemaakt, bron, voorstel: true } })
  if (voorstel.ontbrekend.length) await logContractEvent(admin, contractId, 'facturatie_controle_vereist', { actor: actor ?? null, meta: { ontbrekend: voorstel.ontbrekend } })
  return uit
}

// ── Voorstel beheren ─────────────────────────────────────────────────────────

export type GenereerResultaat = { ok: true; aangemaakt: number; verwijderd: number; ontbrekend: string[] } | { ok: false; fout: string; handmatigGewijzigd?: number }

/**
 * (Opnieuw) genereren. Onbevestigde voorstellen worden vervangen; bevestigde
 * (met factuur) blijven staan. Zijn er handmatig aangepaste voorstellen, dan
 * weigert dit zonder `vervang: true` — het scherm vraagt eerst bevestiging.
 */
export async function genereerVoorstel(admin: Admin, contractId: string, actor: Actor, opties: { vervang?: boolean } = {}): Promise<GenereerResultaat> {
  const { contract, klant } = await laadContract(admin, contractId)
  if (!contract) return { ok: false, fout: 'Contract niet gevonden.' }
  const { data: huidig } = await admin.from('contract_facturatie_opdrachten').select('id, status, invoice_id, handmatig_gewijzigd, factuurdatum').eq('contract_id', contractId)
  const open = ((huidig ?? []) as { id: string; status: string; invoice_id: string | null; handmatig_gewijzigd: boolean; factuurdatum: string }[]).filter((o) => !o.invoice_id && o.status !== 'afgehandeld')
  const handmatig = open.filter((o) => o.handmatig_gewijzigd).length
  if (open.length > 0 && !opties.vervang) return { ok: false, fout: handmatig > 0 ? `Er zijn ${handmatig} handmatig aangepaste voorstellen. Bevestig dat je die wilt vervangen.` : 'Er bestaat al een voorstel; bevestig dat je het wilt vervangen.', handmatigGewijzigd: handmatig }

  const { btw, termijn } = await standaardBtwEnTermijn()
  const voorstel = maakVoorstel(contract, klant, btw, termijn)
  // Facturatiemomenten die al een factuur hebben, komen niet nog eens in het voorstel.
  const bevestigdeDatums = new Set(((huidig ?? []) as { invoice_id: string | null; factuurdatum: string }[]).filter((o) => o.invoice_id).map((o) => String(o.factuurdatum).slice(0, 10)))
  const nieuw = voorstel.regels.filter((v) => !bevestigdeDatums.has(v.factuurdatum))

  if (open.length) {
    const { error } = await admin.from('contract_facturatie_opdrachten').delete().in('id', open.map((o) => o.id))
    if (error) return { ok: false, fout: error.message }
  }
  if (nieuw.length) {
    const { error } = await admin.from('contract_facturatie_opdrachten').insert(nieuw.map((v) => naarRij(contractId, contract.client_id ?? null, v, 'handmatig')))
    if (error) return { ok: false, fout: error.message }
  }
  await log(admin, { contract_id: contractId, gebeurtenis: 'voorstel_opnieuw_gegenereerd', contractstatus: contract.status, details: { door: actor.email ?? actor.id, verwijderd: open.length, aangemaakt: nieuw.length, handmatig_vervangen: handmatig } })
  await logContractEvent(admin, contractId, 'facturatie_opdrachten_aangemaakt', { actor: actor.email ?? null, meta: { aantal: nieuw.length, bron: 'handmatig', opnieuw: true } })
  return { ok: true, aangemaakt: nieuw.length, verwijderd: open.length, ontbrekend: voorstel.ontbrekend }
}

export type VoorstelInvoer = {
  factuurdatum?: unknown; periode?: unknown; omschrijving?: unknown; bedrag_excl?: unknown; btw_pct?: unknown
  betalingstermijn_dagen?: unknown; vervaldatum?: unknown; regels?: unknown; type?: unknown
}

const txt = (v: unknown, max: number): string | null => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null }
const num = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null }
const datumOk = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Velden uit het formulier vertalen naar een rij; regels winnen van het losse bedrag. */
function patchUit(b: VoorstelInvoer, btwStandaard: number): { patch: Record<string, unknown>; velden: string[]; fout?: string } {
  const patch: Record<string, unknown> = {}
  const velden: string[] = []
  if (b.factuurdatum !== undefined) { if (!datumOk(b.factuurdatum)) return { patch, velden, fout: 'Ongeldige factuurdatum.' }; patch.factuurdatum = b.factuurdatum; patch.periode = b.periode !== undefined ? txt(b.periode, 20) : b.factuurdatum.slice(0, 7); velden.push('factuurdatum') }
  if (b.periode !== undefined) { patch.periode = txt(b.periode, 20); velden.push('periode') }
  if (b.omschrijving !== undefined) { patch.omschrijving = txt(b.omschrijving, 500); velden.push('omschrijving') }
  if (b.btw_pct !== undefined) { const n = num(b.btw_pct); if (n === null || n < 0 || n > 100) return { patch, velden, fout: 'Ongeldig btw-tarief.' }; patch.btw_pct = n; velden.push('btw_pct') }
  if (b.betalingstermijn_dagen !== undefined) { const n = num(b.betalingstermijn_dagen); patch.betalingstermijn_dagen = n === null ? null : Math.max(0, Math.round(n)); velden.push('betalingstermijn_dagen') }
  if (b.vervaldatum !== undefined) { patch.vervaldatum = datumOk(b.vervaldatum) ? b.vervaldatum : null; velden.push('vervaldatum') }
  if (b.type !== undefined && ['voorschot', 'saldo', 'periodiek', 'volledig'].includes(String(b.type))) { patch.type = String(b.type); velden.push('type') }
  const btw = typeof patch.btw_pct === 'number' ? patch.btw_pct : btwStandaard
  if (b.regels !== undefined) {
    const regels = normaliseerRegels(b.regels, btw)
    patch.regels = regels
    velden.push('regels')
    if (regels.length) { const t = berekenTotalen(regels); patch.bedrag_excl = t.excl; patch.bedrag_incl = t.incl }
  }
  if (b.bedrag_excl !== undefined && (patch.regels === undefined || (patch.regels as unknown[]).length === 0)) {
    const n = num(b.bedrag_excl)
    if (n !== null && n < 0) return { patch, velden, fout: 'Het bedrag kan niet negatief zijn.' }
    patch.bedrag_excl = n; patch.bedrag_incl = n === null ? null : Math.round(n * (1 + btw / 100) * 100) / 100
    velden.push('bedrag_excl')
  }
  return { patch, velden }
}

export async function bewerkVoorstel(admin: Admin, contractId: string, opdrachtId: string, b: VoorstelInvoer, actor: Actor): Promise<{ ok: true } | { ok: false; fout: string }> {
  const { data: o } = await admin.from('contract_facturatie_opdrachten').select('*').eq('id', opdrachtId).eq('contract_id', contractId).maybeSingle()
  if (!o) return { ok: false, fout: 'Voorstel niet gevonden.' }
  if (o.invoice_id) return { ok: false, fout: 'Dit voorstel is al bevestigd; pas de factuur zelf aan.' }
  const { patch, velden, fout } = patchUit(b, Number(o.btw_pct) || DEFAULT_VAT)
  if (fout) return { ok: false, fout }
  if (velden.length === 0) return { ok: true }
  // Elk aangepast veld krijgt bron 'handmatig'; wat ontbrak en nu ingevuld is, verdwijnt uit "ontbrekend".
  const bron = { ...((o.bron_velden as Record<string, string> | null) ?? {}) }
  for (const v of velden) bron[v === 'regels' ? 'bedrag_excl' : v] = 'handmatig'
  patch.bron_velden = bron
  patch.handmatig_gewijzigd = true
  patch.updated_at = new Date().toISOString()
  const samen = { ...o, ...patch }
  const fouten = valideerVoorstel({ factuurdatum: samen.factuurdatum, omschrijving: samen.omschrijving, bedrag_excl: samen.bedrag_excl, btw_pct: samen.btw_pct, regels: samen.regels, client_id: undefined })
  patch.ontbrekend = fouten
  if (o.status === 'controle_vereist' && fouten.length === 0) patch.status = 'open'
  if (o.status === 'open' && fouten.length > 0) patch.status = 'controle_vereist'
  const { error } = await admin.from('contract_facturatie_opdrachten').update(patch).eq('id', opdrachtId)
  if (error) return { ok: false, fout: error.message }
  await log(admin, { contract_id: contractId, opdracht_id: opdrachtId, gebeurtenis: 'voorstel_aangepast', details: { door: actor.email ?? actor.id, velden, oud: Object.fromEntries(velden.map((v) => [v, o[v]])), nieuw: Object.fromEntries(velden.map((v) => [v, patch[v]])) } })
  return { ok: true }
}

/** Een voorstel toevoegen: los, of vóór/na een bestaand voorstel (dupliceren = kopie erna). */
export async function voegVoorstelToe(admin: Admin, contractId: string, actor: Actor, b: VoorstelInvoer & { na_id?: string | null; voor_id?: string | null; kopie_van?: string | null }): Promise<{ ok: true; id: string } | { ok: false; fout: string }> {
  const { contract } = await laadContract(admin, contractId)
  if (!contract) return { ok: false, fout: 'Contract niet gevonden.' }
  const { btw, termijn } = await standaardBtwEnTermijn()
  const { data: alle } = await admin.from('contract_facturatie_opdrachten').select('*').eq('contract_id', contractId).order('factuurdatum').order('volgnr')
  const lijst = (alle ?? []) as Opdracht[]
  const anker = lijst.find((o) => o.id === (b.kopie_van ?? b.na_id ?? b.voor_id))
  const basis: Record<string, unknown> = anker
    ? { periode: anker.periode, omschrijving: anker.omschrijving, bedrag_excl: anker.bedrag_excl, btw_pct: anker.btw_pct, bedrag_incl: anker.bedrag_incl, betalingstermijn_dagen: anker.betalingstermijn_dagen, type: anker.type, regels: (anker as unknown as { regels?: unknown }).regels ?? [] }
    : { periode: null, omschrijving: contract.title ?? 'Factuur', bedrag_excl: contract.expected_invoice_amount_excl, btw_pct: btw, bedrag_incl: null, betalingstermijn_dagen: termijn, type: 'volledig', regels: [] }
  // Datum: opgegeven, anders één dag vóór/na het anker, anders vandaag.
  let datum = datumOk(b.factuurdatum) ? b.factuurdatum : null
  if (!datum && anker) { const d = new Date(anker.factuurdatum + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + (b.voor_id ? -1 : 1)); datum = d.toISOString().slice(0, 10) }
  if (!datum) datum = vandaagBrussel()
  const { patch, fout } = patchUit({ ...b, factuurdatum: datum }, Number(basis.btw_pct) || btw)
  if (fout) return { ok: false, fout }
  const rij = { ...basis, ...patch }
  const bedrag = voorstelBedrag({ bedrag_excl: (rij.bedrag_excl as number | null) ?? null, btw_pct: Number(rij.btw_pct) || btw, regels: rij.regels })
  const fouten = valideerVoorstel({ factuurdatum: datum, omschrijving: rij.omschrijving as string | null, bedrag_excl: bedrag.excl, btw_pct: Number(rij.btw_pct), regels: rij.regels, client_id: undefined })
  const ins = {
    contract_id: contractId, client_id: contract.client_id ?? null, volgnr: lijst.length + 1, aantal: lijst.length + 1, type: rij.type ?? 'volledig',
    factuurdatum: datum, periode: rij.periode ?? datum.slice(0, 7), omschrijving: rij.omschrijving, bedrag_excl: bedrag.excl, btw_pct: Number(rij.btw_pct) || btw, bedrag_incl: bedrag.incl,
    betalingstermijn_dagen: rij.betalingstermijn_dagen ?? termijn, status: fouten.length ? 'controle_vereist' : 'open', ontbrekend: fouten, aandachtspunten: [],
    regels: rij.regels ?? [], bron_velden: { factuurdatum: 'handmatig', bedrag_excl: 'handmatig', omschrijving: 'handmatig' }, handmatig_gewijzigd: true, sync_status: 'controle_vereist', bron: 'handmatig',
  }
  const { data, error } = await admin.from('contract_facturatie_opdrachten').insert(ins).select('id').single()
  if (error || !data) return { ok: false, fout: error?.message ?? 'Toevoegen mislukt.' }
  await hernummer(admin, contractId)
  await log(admin, { contract_id: contractId, opdracht_id: data.id, gebeurtenis: b.kopie_van ? 'voorstel_gedupliceerd' : 'voorstel_toegevoegd', details: { door: actor.email ?? actor.id, datum } })
  return { ok: true, id: data.id as string }
}

/** Een onbevestigd voorstel schrappen. Bevestigde blijven: die annuleer je via de factuur. */
export async function verwijderVoorstel(admin: Admin, contractId: string, opdrachtId: string, actor: Actor): Promise<{ ok: true } | { ok: false; fout: string }> {
  const { data: o } = await admin.from('contract_facturatie_opdrachten').select('id, invoice_id, volgnr, factuurdatum').eq('id', opdrachtId).eq('contract_id', contractId).maybeSingle()
  if (!o) return { ok: false, fout: 'Voorstel niet gevonden.' }
  if (o.invoice_id) return { ok: false, fout: 'Dit voorstel is al een factuur geworden; annuleer de factuur in plaats van het voorstel.' }
  const { error } = await admin.from('contract_facturatie_opdrachten').delete().eq('id', opdrachtId)
  if (error) return { ok: false, fout: error.message }
  await hernummer(admin, contractId)
  await log(admin, { contract_id: contractId, opdracht_id: opdrachtId, gebeurtenis: 'voorstel_verwijderd', details: { door: actor.email ?? actor.id, factuurdatum: o.factuurdatum } })
  return { ok: true }
}

/** Volgnummers 1..n op datum, zodat "termijn 3/6" klopt na toevoegen of schrappen. */
async function hernummer(admin: Admin, contractId: string): Promise<void> {
  const { data } = await admin.from('contract_facturatie_opdrachten').select('id, volgnr, aantal').eq('contract_id', contractId).neq('status', 'geannuleerd').order('factuurdatum').order('created_at')
  const rijen = (data ?? []) as { id: string; volgnr: number; aantal: number }[]
  for (let i = 0; i < rijen.length; i++) {
    if (rijen[i].volgnr !== i + 1 || rijen[i].aantal !== rijen.length) await admin.from('contract_facturatie_opdrachten').update({ volgnr: i + 1, aantal: rijen.length }).eq('id', rijen[i].id)
  }
}

/** Alle open voorstellen bevestigen → facturen, in één transactie. */
export async function bevestigPlanning(admin: Admin, contractId: string, actor: Actor, ids?: string[]): Promise<{ ok: true; aangemaakt: number; overgeslagen: number; invoiceIds: string[] } | { ok: false; fout: string }> {
  const { data, error } = await admin.rpc('bevestig_factuurplanning', { p_contract_id: contractId, p_actor_id: actor.id, p_actor_email: actor.email ?? null, p_ids: ids && ids.length ? ids : null })
  if (error) return { ok: false, fout: String(error.message ?? error).replace(/^.*?ERROR:\s*/i, '') }
  const r = (data ?? {}) as { aangemaakt?: number; overgeslagen?: number; invoice_ids?: string[] }
  const aangemaakt = Number(r.aangemaakt) || 0
  await log(admin, { contract_id: contractId, gebeurtenis: 'planning_bevestigd', details: { door: actor.email ?? actor.id, aangemaakt, overgeslagen: r.overgeslagen ?? 0, invoice_ids: r.invoice_ids ?? [] } })
  if (aangemaakt > 0) await logContractEvent(admin, contractId, 'facturatie_bevestigd', { actor: actor.email ?? null, meta: { aangemaakt, invoice_ids: r.invoice_ids ?? [] } })
  return { ok: true, aangemaakt, overgeslagen: Number(r.overgeslagen) || 0, invoiceIds: r.invoice_ids ?? [] }
}

// ── Overzicht voor het contractscherm ────────────────────────────────────────

export type FactuurRij = {
  id: string; invoice_date: string | null; due_date: string | null; sent_at: string | null; periode: string | null; description: string | null; reference: string | null
  amount_excl: number; amount_incl: number; vat_pct: number; status: string; verzendstatus: string; betaalstatus: string | null; betaald_bedrag: number
  contract_bedrag_excl: number | null; extra_excl: number; aantal_regels: number; invoice_month: string | null; client_id: string | null
}

export async function laadFacturatieOverzicht(admin: Admin, contractId: string) {
  const vandaag = vandaagBrussel()
  const [{ data: opdrachten }, { data: facturen }, { data: log }, { contract, klant }, { data: cx }] = await Promise.all([
    admin.from('contract_facturatie_opdrachten').select('*').eq('contract_id', contractId).order('factuurdatum').order('volgnr'),
    admin.from('invoices').select('*').eq('contract_id', contractId).order('invoice_date'),
    admin.from('contract_facturatie_log').select('id, gebeurtenis, fout, details, created_at').eq('contract_id', contractId).order('created_at', { ascending: false }).limit(30),
    laadContract(admin, contractId),
    admin.from('contracts').select('facturatie_bevestigd_op, facturatie_gewijzigd_na_bevestiging, facturatie_gestopt_op').eq('id', contractId).maybeSingle(),
  ])
  const ids = ((facturen ?? []) as { id: string }[]).map((f) => f.id)
  const { data: lijnen } = ids.length ? await admin.from('invoice_lines').select('invoice_id, aantal, prijs_excl, korting_pct, is_extra').in('invoice_id', ids) : { data: [] }
  const perFactuur = new Map<string, { n: number; extra: number }>()
  for (const l of (lijnen ?? []) as { invoice_id: string; aantal: number; prijs_excl: number; korting_pct: number; is_extra: boolean }[]) {
    const p = perFactuur.get(l.invoice_id) ?? { n: 0, extra: 0 }
    p.n++
    if (l.is_extra) p.extra += Math.round(Number(l.aantal) * Number(l.prijs_excl) * (1 - (Number(l.korting_pct) || 0) / 100) * 100) / 100
    perFactuur.set(l.invoice_id, p)
  }
  const rijen: FactuurRij[] = ((facturen ?? []) as Record<string, unknown>[]).map((f) => {
    const s = normaliseerVerzendstatus(f.status as string)
    const incl = Number(f.amount_incl) || 0
    const p = perFactuur.get(String(f.id)) ?? { n: 0, extra: 0 }
    const excl = Number(f.amount_excl) || 0
    const contractueel = f.contract_bedrag_excl === null || f.contract_bedrag_excl === undefined ? (p.n ? Math.max(0, excl - p.extra) : excl) : Number(f.contract_bedrag_excl)
    return {
      id: String(f.id), invoice_date: dag(f.invoice_date as string), due_date: dag(f.due_date as string), sent_at: (f.sent_at as string | null) ?? null, periode: (f.periode as string | null) ?? (f.invoice_month as string | null),
      description: (f.description as string | null) ?? null, reference: (f.reference as string | null) ?? null,
      amount_excl: excl, amount_incl: incl, vat_pct: Number(f.vat_pct) || 0, status: String(f.status), verzendstatus: s,
      betaalstatus: afgeleideBetaalstatus({ verzendstatus: s, betaaldBedrag: Number(f.betaald_bedrag) || 0, totaalIncl: incl, vervaldatum: dag(f.due_date as string), vandaag }),
      betaald_bedrag: Number(f.betaald_bedrag) || 0, contract_bedrag_excl: contractueel, extra_excl: Math.max(0, Math.round((excl - contractueel) * 100) / 100), aantal_regels: p.n,
      invoice_month: (f.invoice_month as string | null) ?? null, client_id: (f.client_id as string | null) ?? null,
    }
  })
  const voorstellen = (opdrachten ?? []) as (Opdracht & { regels: unknown; bron_velden: Record<string, string>; handmatig_gewijzigd: boolean; bevestigd_op: string | null; vervaldatum: string | null })[]
  const contractwaarde = contract && contract.expected_invoice_amount_excl && contract.expected_invoice_count ? Math.round(Number(contract.expected_invoice_amount_excl) * Number(contract.expected_invoice_count) * 100) / 100 : contract?.expected_invoice_amount_excl ? Number(contract.expected_invoice_amount_excl) : null
  const samenvatting = contractSamenvatting({ contractwaarde, facturen: rijen, voorstellen: voorstellen.map((v) => ({ status: v.status, bedrag_excl: v.bedrag_excl, invoice_id: v.invoice_id })) })
  const interpretatie = contract ? maakVoorstel(contract, klant).interpretatie : []
  return {
    voorstellen: voorstellen.map((v) => ({ ...v, bedrag: voorstelBedrag({ bedrag_excl: v.bedrag_excl, btw_pct: Number(v.btw_pct) || DEFAULT_VAT, regels: v.regels }), regels: normaliseerRegels(v.regels, Number(v.btw_pct) || DEFAULT_VAT) })),
    facturen: rijen, log: log ?? [], samenvatting, interpretatie,
    contract: contract ? { ...contract, klant_naam: klant?.company_name ?? null, ...(cx ?? {}) } : null,
    vandaag,
  }
}

/**
 * Het contract is inhoudelijk aangepast nadat de planning bevestigd was:
 * enkel toekomstige, nog niet verstuurde facturen krijgen het nieuwe bedrag.
 * Verstuurde, betaalde of gecrediteerde facturen blijven altijd staan.
 */
export async function herberekenToekomstig(admin: Admin, contractId: string, actor: Actor): Promise<{ ok: true; bijgewerkt: number } | { ok: false; fout: string }> {
  const { contract } = await laadContract(admin, contractId)
  if (!contract) return { ok: false, fout: 'Contract niet gevonden.' }
  const bedrag = Number(contract.expected_invoice_amount_excl)
  if (!Number.isFinite(bedrag) || bedrag <= 0) return { ok: false, fout: 'Het contract heeft geen bedrag per factuur.' }
  const vandaag = vandaagBrussel()
  const { data } = await admin.from('invoices').select('id, status, invoice_date, amount_excl, vat_pct, contract_bedrag_excl').eq('contract_id', contractId).gte('invoice_date', vandaag)
  let n = 0
  for (const f of (data ?? []) as { id: string; status: string; amount_excl: number; vat_pct: number; contract_bedrag_excl: number | null }[]) {
    if (normaliseerVerzendstatus(f.status) !== 'te_versturen') continue
    const oudC = f.contract_bedrag_excl === null ? Number(f.amount_excl) : Number(f.contract_bedrag_excl)
    const extra = Math.max(0, Number(f.amount_excl) - oudC)
    const excl = Math.round((bedrag + extra) * 100) / 100
    const incl = Math.round(excl * (1 + (Number(f.vat_pct) || 0) / 100) * 100) / 100
    const { error } = await admin.from('invoices').update({ amount_excl: excl, amount_incl: incl, contract_bedrag_excl: bedrag, updated_at: new Date().toISOString() }).eq('id', f.id)
    if (error) continue
    // De contractuele regel volgt mee (de eerste niet-extra regel); extra regels blijven.
    const { data: l } = await admin.from('invoice_lines').select('id').eq('invoice_id', f.id).eq('is_extra', false).order('volgnr').limit(1).maybeSingle()
    if (l) await admin.from('invoice_lines').update({ prijs_excl: bedrag, aantal: 1 }).eq('id', l.id)
    await admin.from('invoice_wijzigingen').insert({ invoice_id: f.id, actie: 'aangepast', veld: 'contract_bedrag_excl', oud: String(oudC), nieuw: String(bedrag), reden: 'Contract aangepast na bevestiging — toekomstige facturen herberekend', actor_email: actor.email ?? null })
    n++
  }
  await admin.from('contracts').update({ facturatie_gewijzigd_na_bevestiging: false }).eq('id', contractId)
  await log(admin, { contract_id: contractId, gebeurtenis: 'toekomstige_facturen_herberekend', details: { door: actor.email ?? actor.id, bijgewerkt: n, bedrag } })
  return { ok: true, bijgewerkt: n }
}

/** Contract stopt vroegtijdig: per resterend item beslist de gebruiker (behouden / annuleren). */
export async function stopContract(admin: Admin, contractId: string, actor: Actor, keuzes: { voorstellen_annuleren: string[]; facturen_annuleren: string[]; reden: string; einddatum?: string | null }): Promise<{ ok: true; voorstellen: number; facturen: number } | { ok: false; fout: string }> {
  const reden = String(keuzes.reden ?? '').trim() || 'Contract vroegtijdig stopgezet'
  let v = 0, f = 0
  if (keuzes.voorstellen_annuleren.length) {
    const { error } = await admin.from('contract_facturatie_opdrachten').update({ status: 'geannuleerd', geannuleerd_op: new Date().toISOString(), geannuleerd_door: actor.email ?? null, updated_at: new Date().toISOString() }).eq('contract_id', contractId).is('invoice_id', null).in('id', keuzes.voorstellen_annuleren)
    if (error) return { ok: false, fout: error.message }
    v = keuzes.voorstellen_annuleren.length
  }
  for (const id of keuzes.facturen_annuleren) {
    const { data: inv } = await admin.from('invoices').select('id, status').eq('id', id).eq('contract_id', contractId).maybeSingle()
    if (!inv || normaliseerVerzendstatus(inv.status) !== 'te_versturen') continue
    const { error } = await admin.from('invoices').update({ status: 'geannuleerd', cancelled_at: new Date().toISOString(), cancelled_by_email: actor.email ?? null, status_reden: reden, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) continue
    await admin.from('invoice_wijzigingen').insert({ invoice_id: id, actie: 'geannuleerd', veld: 'status', oud: inv.status, nieuw: 'geannuleerd', reden, actor_email: actor.email ?? null })
    f++
  }
  const patch: Record<string, unknown> = { facturatie_gestopt_op: keuzes.einddatum && datumOk(keuzes.einddatum) ? keuzes.einddatum : vandaagBrussel() }
  await admin.from('contracts').update(patch).eq('id', contractId)
  await log(admin, { contract_id: contractId, gebeurtenis: 'contract_vroegtijdig_gestopt', details: { door: actor.email ?? actor.id, reden, voorstellen_geannuleerd: v, facturen_geannuleerd: f } })
  await logContractEvent(admin, contractId, 'facturatie_gestopt', { actor: actor.email ?? null, meta: { reden, voorstellen: v, facturen: f } })
  return { ok: true, voorstellen: v, facturen: f }
}
