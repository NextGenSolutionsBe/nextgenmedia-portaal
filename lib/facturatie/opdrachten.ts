import 'server-only'
import { createHash } from 'crypto'
import { canonicalStatus } from '@/lib/contract-status'
import { logContractEvent } from '@/lib/contract-audit'
import { baseUrl } from '@/lib/email'
import { DEFAULT_VAT, inclFromExcl } from '@/lib/invoices'
import {
  facturatieLijst, maakOpdrachtTaak, werkOpdrachtTaakBij, opdrachtTaakBestaat, type OpdrachtTaak,
} from '@/lib/clickup'
import {
  leidSchemaAf, binnenTweeWerkdagen, TYPE_LABEL, type Opdracht, type OpdrachtStatus, type ContractRij, type KlantRij,
} from './schema'
export * from './schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
const dag = (s: string | null | undefined): string | null => (s ? String(s).slice(0, 10) : null)

/**
 * Contract ondertekend → facturatieopdrachten → ClickUp.
 *
 * Wanneer een contract definitief ondertekend is (status 'signed'; er is één
 * ondertekenaar per contract, dus dat ís "alle handtekeningen aanwezig"),
 * leidt dit de facturatiemomenten af uit de facturatieafspraken op het
 * contract en zet ze klaar als OPDRACHTEN — geen facturen. De factuur zelf
 * maakt het team in de Facturen-module, met één klik vanuit de opdracht.
 *
 * Idempotent: de databank weigert een tweede opdracht voor hetzelfde
 * contract + factuurdatum + type, dus een dubbele trigger of een herhaalde
 * verwerking maakt nooit iets extra aan. Elke ClickUp-taak hoort bij precies
 * één opdracht (task-id op de rij), en een hersynchronisatie werkt de
 * bestaande taak bij in plaats van een nieuwe te maken.
 *
 * ClickUp-fouten raken nooit contract- of opdrachtgegevens: de opdracht
 * blijft staan met sync_status 'mislukt' en de reden, en kan opnieuw.
 */

async function log(admin: Admin, r: {
  contract_id: string | null; opdracht_id?: string | null; gebeurtenis: string; contractstatus?: string | null
  verwerking_sleutel?: string | null; clickup_task_id?: string | null; sync_status?: string | null; fout?: string | null; poging?: number | null; details?: Record<string, unknown>
}) {
  try { await admin.from('contract_facturatie_log').insert({ ...r, fout: r.fout ? String(r.fout).slice(0, 1000) : null }) } catch { /* log mag nooit breken */ }
}

async function laadContract(admin: Admin, contractId: string): Promise<{ contract: ContractRij | null; klant: KlantRij | null }> {
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
  aangemaakt: number; bestaand: number; gesynct: number; mislukt: number
}

/**
 * Het startpunt: wordt aangeroepen op het moment dat een contract 'signed'
 * wordt (tekenlink of upload van een al getekend contract), én handmatig
 * vanuit het contractscherm voor contracten van vóór deze automatisering.
 */
export async function verwerkOndertekening(admin: Admin, contractId: string, bron: 'tekenlink' | 'upload_getekend' | 'handmatig', actor?: string | null): Promise<VerwerkResultaat> {
  const uit: VerwerkResultaat = { gestart: false, aangemaakt: 0, bestaand: 0, gesynct: 0, mislukt: 0 }
  const { contract, klant } = await laadContract(admin, contractId)
  if (!contract) { uit.reden = 'Contract niet gevonden.'; return uit }

  // Enkel een definitief ondertekend contract. Verstuurd, bekeken, verlopen
  // of geannuleerd start niets — ook niet als iemand het handmatig probeert.
  if (canonicalStatus(contract.status) !== 'getekend') {
    uit.reden = `Contractstatus is "${contract.status ?? 'onbekend'}", niet ondertekend. Er is niets aangemaakt.`
    await log(admin, { contract_id: contractId, gebeurtenis: 'overgeslagen_niet_ondertekend', contractstatus: contract.status, details: { bron } })
    return uit
  }
  uit.gestart = true
  const sleutel = `${contractId}:${dag(contract.signed_at) ?? 'geen-datum'}:${bron}`

  const schema = leidSchemaAf(contract, klant)
  const status: OpdrachtStatus = schema.ontbrekend.length ? 'controle_vereist' : 'open'
  const btw = DEFAULT_VAT
  const rijen = schema.momenten.map((m) => ({
    contract_id: contractId, client_id: contract.client_id ?? null,
    volgnr: m.volgnr, aantal: m.aantal, type: m.type, factuurdatum: m.factuurdatum, periode: m.periode,
    bedrag_excl: m.bedrag_excl, btw_pct: btw, bedrag_incl: m.bedrag_excl === null ? null : inclFromExcl(m.bedrag_excl, btw),
    omschrijving: m.omschrijving, status, ontbrekend: schema.ontbrekend, aandachtspunten: schema.aandachtspunten,
    sync_status: 'in_afwachting', bron: bron === 'handmatig' ? 'handmatig' : 'automatisch',
  }))

  // Bestaande opdrachten blijven onaangeroerd; alleen nieuwe momenten komen erbij.
  const { data: voor } = await admin.from('contract_facturatie_opdrachten').select('id').eq('contract_id', contractId)
  const voorIds = new Set(((voor ?? []) as { id: string }[]).map((r) => r.id))
  const { error } = await admin.from('contract_facturatie_opdrachten').upsert(rijen, { onConflict: 'contract_id,factuurdatum,type', ignoreDuplicates: true })
  if (error) {
    await log(admin, { contract_id: contractId, gebeurtenis: 'aanmaken_mislukt', contractstatus: contract.status, verwerking_sleutel: sleutel, fout: error.message })
    uit.reden = `Opdrachten aanmaken mislukt: ${error.message}`
    return uit
  }
  const { data: na } = await admin.from('contract_facturatie_opdrachten').select('*').eq('contract_id', contractId).order('volgnr')
  const alle = (na ?? []) as Opdracht[]
  uit.aangemaakt = alle.filter((r) => !voorIds.has(r.id)).length
  uit.bestaand = alle.length - uit.aangemaakt

  await log(admin, {
    contract_id: contractId, gebeurtenis: 'ondertekend_verwerkt', contractstatus: contract.status, verwerking_sleutel: sleutel,
    details: { bron, aangemaakt: uit.aangemaakt, bestaand: uit.bestaand, controle_vereist: status === 'controle_vereist', ontbrekend: schema.ontbrekend },
  })
  if (uit.aangemaakt > 0) {
    await logContractEvent(admin, contractId, 'facturatie_opdrachten_aangemaakt', { actor: actor ?? null, meta: { aantal: uit.aangemaakt, bron } })
    if (status === 'controle_vereist') await logContractEvent(admin, contractId, 'facturatie_controle_vereist', { actor: actor ?? null, meta: { ontbrekend: schema.ontbrekend } })
  }

  // ClickUp, per opdracht en best-effort: een fout hier laat de opdracht staan.
  for (const o of alle) {
    if (o.status === 'geannuleerd' || o.status === 'afgehandeld') continue
    if (o.sync_status === 'gesynchroniseerd' && o.clickup_task_id) continue
    const r = await synchroniseerOpdracht(admin, o.id)
    if (r.ok) uit.gesynct++; else uit.mislukt++
  }
  return uit
}

// ── ClickUp-taak per opdracht ────────────────────────────────────────────────

const eur = (v: number | null) => (v === null ? '—' : `€ ${v.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const dmy = (s: string) => { const [j, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${j}` }

function taakVoor(o: Opdracht, c: ContractRij, klant: KlantRij | null): OpdrachtTaak {
  const bedrijf = klant?.company_name ?? c.signer_name ?? 'Onbekende klant'
  const project = c.title ?? 'Contract'
  const basis = baseUrl().replace(/\/$/, '')
  const meerdere = o.aantal > 1
  const naam = `Factuur versturen – ${bedrijf} – ${project}${meerdere ? ` – termijn ${o.volgnr}/${o.aantal}${o.periode ? ` (${o.periode})` : ''}` : ''}`
  const btwBedrag = o.bedrag_excl === null ? null : Math.round(o.bedrag_excl * o.btw_pct) / 100
  const incl = o.bedrag_excl === null ? null : (o.bedrag_incl ?? inclFromExcl(o.bedrag_excl, o.btw_pct))
  const punten = [...o.ontbrekend.map((x) => `ONTBREEKT: ${x}`), ...o.aandachtspunten]
  const regels = [
    o.status === 'controle_vereist' ? '⚠️ CONTROLE VEREIST — er ontbreken gegevens (zie onderaan). Controleer vóór je factureert.' : null,
    '',
    `Klantnaam: ${klant?.contact_name ?? c.signer_name ?? '—'}`,
    `Bedrijfsnaam: ${bedrijf}`,
    `Ondernemingsnummer: ${klant?.btw_nummer ?? 'ontbreekt'}`,
    `Facturatieadres: niet in het klantendossier — controleer`,
    `E-mailadres: ${klant?.email ?? c.signer_email ?? 'ontbreekt'}`,
    `Contractnummer: ${c.id} (unieke referentie van het contract in het portaal)`,
    `Project / opdracht: ${project}`,
    `Type factuur: ${TYPE_LABEL[o.type]}${meerdere ? ` (termijn ${o.volgnr} van ${o.aantal})` : ''}`,
    o.periode && meerdere ? `Facturatieperiode: ${o.periode}` : null,
    `Facturatiedatum: ${dmy(o.factuurdatum)}`,
    `Betalingstermijn: ${o.betalingstermijn_dagen ? `${o.betalingstermijn_dagen} dagen` : 'niet vastgelegd in het contract'}`,
    `Bedrag excl. btw: ${eur(o.bedrag_excl)}`,
    `Btw-percentage: ${o.btw_pct} %`,
    `Btw-bedrag: ${eur(btwBedrag)}`,
    `Bedrag incl. btw: ${eur(incl)}`,
    '',
    'Links:',
    c.client_id ? `- Klantendossier: ${basis}/admin/clients/${c.client_id}` : '- Klantendossier: geen klant gekoppeld',
    `- Facturatieopdracht: ${basis}/admin/contracts/${c.id}#facturatie`,
    `- Ondertekend contract: ${basis}/admin/contracts/${c.id}`,
    '',
    punten.length ? 'Aandachtspunten / ontbrekende gegevens:' : null,
    ...punten.map((p) => `- ${p}`),
    '',
    `Referentie: ${c.id} | ${o.factuurdatum} | ${o.type}`,
  ].filter((r): r is string => r !== null)
  return { naam, beschrijving: regels.join('\n'), deadline: o.factuurdatum, hoog: binnenTweeWerkdagen(o.factuurdatum) }
}

const vingerafdrukVan = (t: OpdrachtTaak) => createHash('sha1').update(JSON.stringify(t)).digest('hex')

export type SyncResultaat = { ok: boolean; fout?: string; taskId?: string | null; bijgewerkt?: boolean; overgeslagen?: string }

/**
 * Eén opdracht naar ClickUp. Bestaat de taak al, dan wordt ze bijgewerkt
 * (alleen als er iets veranderde); is ze in ClickUp verwijderd, dan komt er
 * één nieuwe. Een claim op de rij voorkomt dat twee gelijktijdige pogingen
 * (dubbele webhook, retry naast een klik) elk een taak aanmaken.
 */
export async function synchroniseerOpdracht(admin: Admin, opdrachtId: string): Promise<SyncResultaat> {
  const { data: o0 } = await admin.from('contract_facturatie_opdrachten').select('*').eq('id', opdrachtId).maybeSingle()
  const o = o0 as Opdracht | null
  if (!o) return { ok: false, fout: 'Opdracht niet gevonden.' }
  if (o.status === 'geannuleerd') return { ok: true, overgeslagen: 'geannuleerd' }

  // Claim: alleen als er geen andere poging bezig is (of die is blijven hangen).
  const grens = new Date(Date.now() - 2 * 60_000).toISOString()
  const { data: claim } = await admin.from('contract_facturatie_opdrachten')
    .update({ sync_bezig_sinds: new Date().toISOString() })
    .eq('id', opdrachtId).or(`sync_bezig_sinds.is.null,sync_bezig_sinds.lt.${grens}`)
    .select('id')
  if (!claim || (claim as unknown[]).length === 0) return { ok: false, fout: 'Er loopt al een synchronisatie voor deze opdracht.' }

  const poging = (o.sync_pogingen ?? 0) + 1
  const klaar = async (velden: Record<string, unknown>) => {
    await admin.from('contract_facturatie_opdrachten').update({ ...velden, sync_bezig_sinds: null, updated_at: new Date().toISOString() }).eq('id', opdrachtId)
  }

  try {
    const lijst = await facturatieLijst()
    if (!lijst.ok) throw new Error(lijst.reden)
    const { contract, klant } = await laadContract(admin, o.contract_id)
    if (!contract) throw new Error('Contract niet gevonden.')
    const taak = taakVoor(o, contract, klant)
    const vingerafdruk = vingerafdrukVan(taak)

    let taskId = o.clickup_task_id
    let url = o.clickup_url
    let bijgewerkt = false
    if (taskId && await opdrachtTaakBestaat(taskId)) {
      if (o.vingerafdruk !== vingerafdruk || o.sync_status !== 'gesynchroniseerd') { await werkOpdrachtTaakBij(taskId, taak); bijgewerkt = true }
    } else {
      if (taskId) await log(admin, { contract_id: o.contract_id, opdracht_id: o.id, gebeurtenis: 'taak_verdwenen_in_clickup', clickup_task_id: taskId })
      const nieuw = await maakOpdrachtTaak(taak)
      taskId = nieuw.taskId; url = nieuw.url
    }
    await klaar({ clickup_task_id: taskId, clickup_url: url, sync_status: 'gesynchroniseerd', sync_fout: null, sync_pogingen: poging, laatste_sync_op: new Date().toISOString(), vingerafdruk })
    await log(admin, { contract_id: o.contract_id, opdracht_id: o.id, gebeurtenis: bijgewerkt ? 'clickup_bijgewerkt' : (o.clickup_task_id === taskId ? 'clickup_ongewijzigd' : 'clickup_aangemaakt'), clickup_task_id: taskId, sync_status: 'gesynchroniseerd', poging, details: { lijst: lijst.pad } })
    if (o.sync_status !== 'gesynchroniseerd') await logContractEvent(admin, o.contract_id, 'facturatie_sync_ok', { meta: { opdracht_id: o.id, task_id: taskId } })
    return { ok: true, taskId, bijgewerkt }
  } catch (e) {
    const fout = e instanceof Error ? e.message : String(e)
    await klaar({ sync_status: 'mislukt', sync_fout: fout.slice(0, 500), sync_pogingen: poging, laatste_sync_op: new Date().toISOString() })
    await log(admin, { contract_id: o.contract_id, opdracht_id: o.id, gebeurtenis: 'clickup_mislukt', clickup_task_id: o.clickup_task_id, sync_status: 'mislukt', fout, poging })
    if (o.sync_status !== 'mislukt') await logContractEvent(admin, o.contract_id, 'facturatie_sync_mislukt', { meta: { opdracht_id: o.id, fout: fout.slice(0, 200) } })
    return { ok: false, fout }
  }
}

/**
 * Veilige retry voor de cron: mislukte of blijven-hangen opdrachten opnieuw
 * proberen, met oplopende wachttijd (5 min × 2^pogingen, max 8 pogingen).
 * Daarna blijft de opdracht 'mislukt' staan en is de knop in het scherm de weg.
 */
export async function herprobeerSyncs(admin: Admin, max = 10): Promise<{ geprobeerd: number; gelukt: number }> {
  const uit = { geprobeerd: 0, gelukt: 0 }
  try {
    const { data } = await admin.from('contract_facturatie_opdrachten')
      .select('id, sync_status, sync_pogingen, laatste_sync_op, created_at')
      .in('sync_status', ['in_afwachting', 'mislukt']).in('status', ['open', 'controle_vereist'])
      .order('created_at').limit(50)
    const nu = Date.now()
    const kandidaten = ((data ?? []) as { id: string; sync_status: string; sync_pogingen: number; laatste_sync_op: string | null; created_at: string }[]).filter((r) => {
      if (r.sync_pogingen >= 8) return false
      const laatst = Date.parse(r.laatste_sync_op ?? r.created_at)
      const wacht = 5 * 60_000 * Math.pow(2, Math.max(0, r.sync_pogingen - 1))
      return r.sync_status === 'in_afwachting' ? nu - laatst > 10 * 60_000 : nu - laatst > wacht
    }).slice(0, max)
    for (const k of kandidaten) {
      uit.geprobeerd++
      const r = await synchroniseerOpdracht(admin, k.id)
      if (r.ok) uit.gelukt++
    }
  } catch { /* retry mag de cron nooit laten falen */ }
  return uit
}
