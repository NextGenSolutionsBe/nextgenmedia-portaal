import 'server-only'
import { createHash } from 'crypto'
import { logContractEvent } from '@/lib/contract-audit'
import { archiveerContract, laatsteArchief, meldOndertekening } from '@/lib/contract-archief'
import { MANUEEL } from '@/lib/contracten/manueel-getekend'
import { baseUrl } from '@/lib/email'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { vandaagISO } from '@/lib/opdrachten'
import { taakVoorWie, werkdagenLater } from '@/lib/opdrachten-offerte-model'
import { leadTaakOpties, maakOpdrachtTaak, taakAfvinken } from '@/lib/sales/lead-taken-server'
import { stempelTegenhandtekening } from './tegenhandtekening-pdf'
import {
  datumRegel, bedrijfVoorMerk, controleerNaam, leesHandtekening, moetTegentekenen, redenNietTegentekenen,
  tegentekenTaak, zoneKolommen, type OnsZone,
} from './tegenhandtekening'

/**
 * Tegenhandtekening, de serverkant (regels in ./tegenhandtekening.ts).
 *
 * Onze handtekening komt op een KOPIE van het door de klant getekende PDF
 * (tegengetekend/<id>-<tijdstip>.pdf). Het bestand van de klant blijft ongewijzigd en
 * bewaard (klant_getekend_pdf_path); signed_pdf_path wijst daarna naar de
 * versie met beide handtekeningen, zodat de klantapp, de ontvangstpagina en de
 * downloads vanzelf die versie tonen. Het archief maakt er een nieuwe versie
 * met een nieuw certificaat van en Legal krijgt die één keer.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any
const BUCKET = 'contracts'

export class TegentekenFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

/** Vaste sleutel per contract voor de ClickUp-taak (één taak, ook bij herhaald proberen). */
export function tegentekenSleutel(contractId: string): string {
  const h = createHash('sha256').update(`tegenteken:${contractId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`
}

/** Onleesbare tekens (buiten WinAnsi) vervangen, anders weigert de standaardfont. */
const veilig = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, '?')

async function kaartVan(admin: Admin, contractId: string): Promise<{ id: string; merk: string | null; verantwoordelijke: string | null } | null> {
  const { data } = await admin.from('opdrachten').select('id, merk, verantwoordelijke').eq('contract_id', contractId).maybeSingle()
  return (data ?? null) as { id: string; merk: string | null; verantwoordelijke: string | null } | null
}

export type TegentekenInvoer = {
  handtekening: unknown; zone: unknown; naam: unknown
  door: { userId: string; email: string | null }
  ip?: string | null; ua?: string | null
}

export async function tegenteken(admin: Admin, contractId: string, inv: TegentekenInvoer): Promise<{ pdfPad: string; op: string }> {
  const { data: c } = await admin.from('contracts').select('*').eq('id', contractId).maybeSingle()
  if (!c) throw new TegentekenFout('Contract niet gevonden.', 404)
  if (!('tegengetekend_op' in c)) throw new TegentekenFout('De databank wordt nog bijgewerkt. Probeer het zo meteen opnieuw.', 503)
  const reden = redenNietTegentekenen(c)
  if (reden) throw new TegentekenFout(reden, c.tegengetekend_op ? 409 : 400)

  const naam = controleerNaam(inv.naam)
  if (!naam) throw new TegentekenFout('Je naam ontbreekt op je account. Vul ze in bij Mijn account.')
  const hand = leesHandtekening(inv.handtekening)
  if (!hand.ok) throw new TegentekenFout(hand.fout)

  const basis = (c.signed_pdf_path as string | null) ?? (c.pdf_path as string)
  const { data: bestand, error: dlFout } = await admin.storage.from(BUCKET).download(basis)
  if (dlFout || !bestand) throw new TegentekenFout('Het getekende PDF werd niet gevonden in de opslag.', 500)
  const png = Buffer.from(hand.base64, 'base64')
  const kaart = await kaartVan(admin, contractId)
  const bedrijf = bedrijfVoorMerk(kaart?.merk)
  const op = new Date().toISOString()
  let gestempeld: { bytes: Uint8Array; zone: OnsZone }
  try {
    gestempeld = await stempelTegenhandtekening(new Uint8Array(await bestand.arrayBuffer()), png, inv.zone, datumRegel(op))
  } catch (e) {
    throw new TegentekenFout(`De handtekening kon niet op het PDF gezet worden (${e instanceof Error ? e.message : 'onbekende fout'}).`, 500)
  }
  const { bytes, zone } = gestempeld

  // Eigen bestandsnaam per poging: tekenen twee mensen tegelijk, dan overschrijft de tweede nooit het bestand van de eerste.
  const stempel = op.replace(/[^0-9]/g, '').slice(0, 14)
  const pad = `tegengetekend/${contractId}-${stempel}.pdf`
  const { error: upFout } = await admin.storage.from(BUCKET).upload(pad, Buffer.from(bytes), { contentType: 'application/pdf', upsert: false })
  if (upFout) throw new TegentekenFout(`Bewaren van het PDF mislukt: ${upFout.message}`, 500)
  // De tekening zelf apart bewaren (bewijs), naast het contract.
  await admin.storage.from(BUCKET).upload(`tegenhandtekening/${contractId}-${stempel}.png`, png, { contentType: 'image/png', upsert: false }).catch(() => null)

  // Voorwaardelijk: twee mensen tegelijk = één handtekening.
  const { data: gelukt, error } = await admin.from('contracts').update({
    signed_pdf_path: pad,
    klant_getekend_pdf_path: (c.signed_pdf_path as string | null) ?? null,
    tegengetekend_op: op, tegengetekend_door: naam, tegengetekend_door_email: inv.door.email, tegengetekend_user_id: inv.door.userId, tegengetekend_bedrijf: bedrijf,
    ...zoneKolommen(zone),
  }).eq('id', contractId).is('tegengetekend_op', null).select('id')
  if (error) throw new TegentekenFout(error.message, 500)
  if (!(gelukt ?? []).length) throw new TegentekenFout('Iemand anders tekende dit contract net. Herlaad de pagina.', 409)

  await logContractEvent(admin, contractId, 'tegengetekend', { actor: inv.door.email ?? naam, ip: inv.ip ?? null, ua: inv.ua ?? null, meta: { naam, bedrijf, zone, basis } })

  return { pdfPad: pad, op }
}

/**
 * Wat na het tekenen volgt, op de achtergrond (zo ga je meteen door naar het
 * volgende contract): het archief maakt een nieuwe versie met het certificaat
 * met beide handtekeningen en Legal krijgt die één keer; de projectkaart krijgt
 * een notitie en de taak "contract tegentekenen" wordt afgevinkt.
 */
export async function naTegentekenen(admin: Admin, contractId: string, door: { userId: string; email: string | null; naam: string }): Promise<void> {
  const { data: c } = await admin.from('contracts').select('id, title, ondertekening_wijze, tegengetekend_bedrijf').eq('id', contractId).maybeSingle()
  if (!c) return
  if (c.ondertekening_wijze !== MANUEEL) {
    try {
      const vorige = await laatsteArchief(admin, contractId)
      const bron = vorige?.dossier?.bron && vorige.dossier.bron !== 'handmatig' ? vorige.dossier.bron : 'tekenlink'
      const archief = await archiveerContract(admin, contractId, bron, door.email ?? door.naam)
      await meldOndertekening(admin, archief, { actor: door.email ?? door.naam })
    } catch (e) { console.error('[tegenhandtekening] archief:', e instanceof Error ? e.message : e) }
  }
  const kaart = await kaartVan(admin, contractId)
  if (kaart) {
    await voegNotitieToe(admin, kaart.id, `Contract "${c.title ?? ''}" ondertekend namens ${c.tegengetekend_bedrijf ?? 'NextGenMedia'} door ${door.naam}.`, 'systeem', { id: door.userId, email: door.email, naam: door.naam }).catch(() => null)
  }
  await sluitTegentekenTaak(admin, contractId).catch(() => null)
}

/** Zodra de klant tekende: één ClickUp-taak op de projectkaart, voor de verantwoordelijke. */
export async function maakTegentekenTaak(admin: Admin, contractId: string): Promise<void> {
  const { data: c } = await admin.from('contracts').select('*').eq('id', contractId).maybeSingle()
  if (!c || !moetTegentekenen(c)) return
  const kaart = await kaartVan(admin, contractId)
  if (!kaart) return
  let klant: string | null = null
  if (c.client_id) {
    const { data: k } = await admin.from('clients').select('company_name').eq('id', c.client_id).maybeSingle()
    klant = (k as { company_name?: string | null } | null)?.company_name ?? null
  }
  if (/^test$/i.test(String(klant ?? '').trim())) return
  const t = tegentekenTaak({ klant, titel: String(c.title ?? 'Contract'), ondertekenaar: c.signer_name ?? null, op: c.signed_at ?? null, url: `${baseUrl()}/admin/contracts/${contractId}/tegentekenen` })
  try {
    const opties = await leadTaakOpties(admin, null, taakVoorWie(kaart.verantwoordelijke, null))
    if (!opties.ingesteld) throw new Error('ClickUp is niet gekoppeld')
    const assignee = opties.standaard ?? opties.leden.find((l) => /^bram\b/i.test(l.naam))?.id ?? null
    if (!assignee) throw new Error('geen ClickUp-lid gevonden om de taak aan toe te wijzen')
    await maakOpdrachtTaak(admin, kaart.id, {
      omschrijving: t.omschrijving, notitie: t.notitie, deadline: werkdagenLater(vandaagISO(), 2),
      assignee_id: assignee, merk: kaart.merk === 'nextgensolutions' ? 'nextgensolutions' : 'nextgenmedia', aanvraag_sleutel: tegentekenSleutel(contractId),
    }, { userId: null, email: null })
  } catch (e) {
    await voegNotitieToe(admin, kaart.id, `De taak "${t.omschrijving}" kon niet in ClickUp (${e instanceof Error ? e.message : 'onbekende fout'}). Het contract staat wel bij "Contracten tegentekenen" in het Command Center.`, 'systeem', null).catch(() => null)
  }
}

/** De taak "contract tegentekenen" afvinken (ook in ClickUp), als ze nog open staat. */
export async function sluitTegentekenTaak(admin: Admin, contractId: string): Promise<void> {
  const { data } = await admin.from('opdracht_taken').select('id').eq('aanvraag_sleutel', tegentekenSleutel(contractId)).is('afgerond_op', null)
  for (const t of (data ?? []) as { id: string }[]) {
    try { await taakAfvinken(admin, 'opdracht', t.id) } catch (e) { console.warn('[tegenhandtekening] taak afvinken:', e instanceof Error ? e.message : e) }
  }
}
