import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { baseUrl, sendEmail } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { kaartVoorOfferte, ruimKaartVanConceptOp } from '@/lib/opdrachten-offertes'
import { toestelVan } from '@/lib/klant-geopend'
import {
  OFFERTE_BUCKET, geldigOffertePad, geldigSjabloonPad, veiligePdfNaam, offerteLink, valideerOfferte,
  type Offerte, type Sjabloon,
} from '@/lib/offertes'

/**
 * Offertes — serverkant. Altijd service-role, altijd na de toegangscontrole
 * van de route (module Offertes, of de publieke token voor de klant).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: { from: (b: string) => any } }

export class OfferteFout extends Error {
  constructor(public publiek: string, public status = 400) { super(publiek) }
}

const nu = () => new Date().toISOString()
const vandaagBrussel = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const nieuweToken = () => randomBytes(24).toString('base64url')
const INFO = 'info@nextgenmedia.be'

async function log(admin: Admin, offerteId: string, soort: string, extra: { meta?: Record<string, unknown>; ip?: string | null; ua?: string | null } = {}) {
  try { await admin.from('offerte_events').insert({ offerte_id: offerteId, soort, meta: extra.meta ?? null, ip: extra.ip ?? null, user_agent: extra.ua ?? null }) } catch { /* logboek is een extra */ }
}

// ── Opladen (rechtstreeks naar de opslag, met een ondertekende link) ────────

/** Een ondertekende uploadlink voor een pdf: van een offerte of een sjabloon. */
export async function uploadLink(admin: Admin, soort: 'offerte' | 'sjabloon', naam: string, grootte: number): Promise<{ pad: string; token: string; bucket: string }> {
  if (!/\.pdf$/i.test(naam)) throw new OfferteFout('Enkel pdf-bestanden.')
  if (!Number.isFinite(grootte) || grootte <= 0) throw new OfferteFout('Leeg bestand.')
  if (grootte > 25 * 1024 * 1024) throw new OfferteFout('De pdf is groter dan 25 MB.')
  const pad = `${soort === 'offerte' ? 'offertes' : 'sjablonen'}/${randomUUID()}/${veiligePdfNaam(naam)}`
  const { data, error } = await admin.storage.from(OFFERTE_BUCKET).createSignedUploadUrl(pad)
  if (error || !data?.token) throw new Error(error?.message ?? 'Uploadlink maken mislukt')
  return { pad, token: data.token as string, bucket: OFFERTE_BUCKET }
}

/** Staat dit bestand echt in de opslag? */
async function bestaat(admin: Admin, pad: string): Promise<{ bytes: number | null } | null> {
  const map = pad.slice(0, pad.lastIndexOf('/'))
  const naam = pad.slice(pad.lastIndexOf('/') + 1)
  const { data, error } = await admin.storage.from(OFFERTE_BUCKET).list(map, { search: naam, limit: 5 })
  if (error) return null
  const f = ((data ?? []) as { name: string; metadata?: { size?: number } | null }[]).find((x) => x.name === naam)
  return f ? { bytes: typeof f.metadata?.size === 'number' ? f.metadata.size : null } : null
}

// ── Sjablonen ────────────────────────────────────────────────────────────────

export async function sjablonen(admin: Admin, alles = false): Promise<Sjabloon[]> {
  let q = admin.from('offerte_sjablonen').select('*').order('volgorde').order('naam')
  if (!alles) q = q.eq('actief', true)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as Sjabloon[]
}

export async function bewaarSjabloon(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<Sjabloon> {
  const naam = String(b.naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (naam.length < 2) throw new OfferteFout('Geef het sjabloon een naam, bv. "Offerte reel".')
  const merk = b.merk === 'nextgensolutions' ? 'nextgensolutions' : 'nextgenmedia'
  const velden: Record<string, unknown> = {
    naam, merk, dienst: String(b.dienst ?? '').trim().slice(0, 80) || null,
    beschrijving: String(b.beschrijving ?? '').trim().slice(0, 500) || null, updated_at: nu(), updated_by_email: door,
  }
  if (typeof b.actief === 'boolean') velden.actief = b.actief
  // Nieuwe of vervangen pdf.
  let oudPad: string | null = null
  if (b.pdf_pad !== undefined) {
    if (!geldigSjabloonPad(b.pdf_pad)) throw new OfferteFout('Laad de pdf opnieuw op.')
    const f = await bestaat(admin, b.pdf_pad)
    if (!f) throw new OfferteFout('De pdf staat (nog) niet in de opslag. Laad ze opnieuw op.')
    velden.pdf_pad = b.pdf_pad; velden.pdf_naam = String(b.pdf_naam ?? '').slice(0, 160) || null; velden.bytes = f.bytes
  }
  const id = typeof b.id === 'string' ? b.id : null
  if (id) {
    const { data: oud } = await admin.from('offerte_sjablonen').select('pdf_pad').eq('id', id).maybeSingle()
    if (!oud) throw new OfferteFout('Sjabloon niet gevonden.', 404)
    oudPad = velden.pdf_pad && (oud as { pdf_pad: string }).pdf_pad !== velden.pdf_pad ? (oud as { pdf_pad: string }).pdf_pad : null
    const { data, error } = await admin.from('offerte_sjablonen').update(velden).eq('id', id).select('*').single()
    if (error) throw new Error(error.message)
    // De oude pdf mag weg: verstuurde offertes hebben hun eigen kopie.
    if (oudPad) await admin.storage.from(OFFERTE_BUCKET).remove([oudPad]).catch(() => {})
    return data as Sjabloon
  }
  if (!velden.pdf_pad) throw new OfferteFout('Laad de pdf van het sjabloon op.')
  const { data: max } = await admin.from('offerte_sjablonen').select('volgorde').order('volgorde', { ascending: false }).limit(1)
  velden.volgorde = (((max ?? [])[0] as { volgorde?: number } | undefined)?.volgorde ?? 0) + 1
  const { data, error } = await admin.from('offerte_sjablonen').insert(velden).select('*').single()
  if (error) throw new Error(error.message)
  return data as Sjabloon
}

export async function verwijderSjabloon(admin: Admin, id: string): Promise<void> {
  const { data } = await admin.from('offerte_sjablonen').select('pdf_pad').eq('id', id).maybeSingle()
  if (!data) throw new OfferteFout('Sjabloon niet gevonden.', 404)
  const { error } = await admin.from('offerte_sjablonen').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await admin.storage.from(OFFERTE_BUCKET).remove([(data as { pdf_pad: string }).pdf_pad]).catch(() => {})
}

// ── Offertes ─────────────────────────────────────────────────────────────────

/**
 * Nieuwe offerte (concept): klant en project nakijken, de pdf van het sjabloon
 * kopiëren (of de eigen upload nakijken) en een publieke token maken. Er gaat
 * nog niets naar de klant: dat gebeurt pas via de MailComposer.
 */
export async function maakOfferte(admin: Admin, b: Record<string, unknown>, door: { userId: string | null; email: string | null }): Promise<Offerte> {
  const v = valideerOfferte(b, vandaagBrussel())
  if (!v.ok) throw new OfferteFout(v.fout)
  const w = v.waarde
  let klantNaam = w.klant_naam
  let contactEmail: string | null = null, contactNaam: string | null = null
  if (w.client_id) {
    const { data: k } = await admin.from('clients').select('id, company_name, contact_name, email').eq('id', w.client_id).maybeSingle()
    if (!k) throw new OfferteFout('Die klant bestaat niet.')
    const kk = k as { company_name: string | null; contact_name: string | null; email: string | null }
    klantNaam = kk.company_name ?? klantNaam; contactEmail = kk.email; contactNaam = kk.contact_name
  }
  if (w.opdracht_id) {
    const { data: o } = await admin.from('opdrachten').select('id').eq('id', w.opdracht_id).maybeSingle()
    if (!o) throw new OfferteFout('Dat project bestaat niet.')
  }
  const id = randomUUID()
  let pdfPad: string, pdfNaam: string | null
  if (w.sjabloon_id) {
    const { data: s } = await admin.from('offerte_sjablonen').select('pdf_pad, pdf_naam, naam').eq('id', w.sjabloon_id).maybeSingle()
    if (!s) throw new OfferteFout('Dat sjabloon bestaat niet (meer).')
    const sj = s as { pdf_pad: string; pdf_naam: string | null; naam: string }
    pdfNaam = sj.pdf_naam ?? `${sj.naam}.pdf`
    pdfPad = `offertes/${id}/${veiligePdfNaam(pdfNaam)}`
    const { error } = await admin.storage.from(OFFERTE_BUCKET).copy(sj.pdf_pad, pdfPad)
    if (error) throw new Error(`Sjabloon kopiëren mislukt: ${error.message}`)
  } else {
    pdfPad = w.eigen_pad as string
    pdfNaam = w.eigen_naam
    if (!(await bestaat(admin, pdfPad))) throw new OfferteFout('De pdf staat (nog) niet in de opslag. Laad ze opnieuw op.')
  }
  const { data, error } = await admin.from('offertes').insert({
    id, client_id: w.client_id, opdracht_id: w.opdracht_id, klant_naam: klantNaam, titel: w.titel, bedrag_excl: w.bedrag_excl,
    merk: w.merk, sjabloon_id: w.sjabloon_id, pdf_pad: pdfPad, pdf_naam: pdfNaam, token: nieuweToken(), status: 'concept',
    ontvanger_email: contactEmail, ontvanger_naam: contactNaam, geldig_tot: w.geldig_tot,
    created_by: door.userId, created_by_email: door.email,
  }).select('*').single()
  if (error) throw new Error(error.message)
  await log(admin, id, 'aangemaakt', { meta: { door: door.email, sjabloon: w.sjabloon_id } })
  // Projecten: elke offerte hangt aan een kaart in Offerte gestuurd (die van het project, van de klant, of een nieuwe).
  try {
    const { opdrachtId } = await kaartVoorOfferte(admin, id, { id: door.userId, email: door.email, naam: null })
    if (opdrachtId && opdrachtId !== (data as Offerte).opdracht_id) return { ...(data as Offerte), opdracht_id: opdrachtId }
  } catch (e) { console.warn('[offertes] kaart voor offerte mislukt:', e instanceof Error ? e.message : e) }
  return data as Offerte
}

export async function leesOfferte(admin: Admin, id: string): Promise<Offerte | null> {
  const { data } = await admin.from('offertes').select('*').eq('id', id).maybeSingle()
  return (data ?? null) as Offerte | null
}

export async function offertesLijst(admin: Admin, f: { opdracht_id?: string; client_id?: string; limiet?: number } = {}): Promise<Offerte[]> {
  let q = admin.from('offertes').select('*').order('created_at', { ascending: false }).limit(f.limiet ?? 300)
  if (f.opdracht_id) q = q.eq('opdracht_id', f.opdracht_id)
  if (f.client_id) q = q.eq('client_id', f.client_id)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as Offerte[]
}

/**
 * Na een gelukte mail via de MailComposer: de offerte staat op verstuurd (ook
 * bij opnieuw versturen) en het project schuift naar Offerte gestuurd als
 * naam, btw en dienst in orde zijn; anders zegt een notitie wat ontbreekt.
 */
export async function markeerVerstuurd(admin: Admin, o: Offerte, m: { aan: string; logId: string | null; door: { id: string; email: string | null; naam: string | null } }): Promise<void> {
  const eerste = o.status === 'concept'
  await admin.from('offertes').update({
    status: o.status === 'concept' ? 'verstuurd' : o.status, verstuurd_op: nu(), ontvanger_email: m.aan, email_message_id: m.logId, updated_at: nu(),
  }).eq('id', o.id)
  await log(admin, o.id, eerste ? 'verstuurd' : 'opnieuw_verstuurd', { meta: { aan: m.aan, door: m.door.email } })
  const auteur = { id: m.door.id, email: m.door.email, naam: m.door.naam }
  // De kaart staat (of komt) in Offerte gestuurd; zonder project krijgt de offerte er een.
  let opdrachtId = o.opdracht_id
  try { opdrachtId = (await kaartVoorOfferte(admin, o.id, auteur)).opdrachtId } catch (e) { console.warn('[offertes] kaart voor offerte mislukt:', e instanceof Error ? e.message : e) }
  if (opdrachtId) await voegNotitieToe(admin, opdrachtId, `Offerte "${o.titel}" ${eerste ? 'verstuurd' : 'opnieuw verstuurd'} naar ${m.aan}.`, 'systeem', auteur).catch(() => null)
}

export async function trekIn(admin: Admin, id: string, door: string | null): Promise<void> {
  const { data, error } = await admin.from('offertes').update({ status: 'ingetrokken', ingetrokken_op: nu(), updated_at: nu() }).eq('id', id).in('status', ['concept', 'verstuurd']).select('id')
  if (error) throw new Error(error.message)
  if (!(data ?? []).length) throw new OfferteFout('Deze offerte kan niet (meer) ingetrokken worden.')
  await log(admin, id, 'ingetrokken', { meta: { door } })
}

/** Concept weggooien (nog nooit verstuurd): rij en pdf weg. */
export async function verwijderConcept(admin: Admin, id: string): Promise<void> {
  const o = await leesOfferte(admin, id)
  if (!o) throw new OfferteFout('Offerte niet gevonden.', 404)
  if (o.status !== 'concept') throw new OfferteFout('Enkel een concept kan weg. Een verstuurde offerte trek je in.')
  const { error } = await admin.from('offertes').delete().eq('id', id)
  if (error) throw new Error(error.message)
  if (geldigOffertePad(o.pdf_pad)) await admin.storage.from(OFFERTE_BUCKET).remove([o.pdf_pad]).catch(() => {})
  // De kaart die de app voor dit concept maakte, gaat mee als er niets anders aan hangt.
  await ruimKaartVanConceptOp(admin, id, o.opdracht_id).catch(() => {})
}

// ── Publiek (de klant) ───────────────────────────────────────────────────────

export async function offerteVanToken(admin: Admin, token: string): Promise<Offerte | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const { data } = await admin.from('offertes').select('*').eq('token', token).maybeSingle()
  return (data ?? null) as Offerte | null
}

/** De klant opende de offerte (niet het team, geen linkvoorbeeld: dat beslist de pagina). */
export async function registreerGeopend(admin: Admin, o: Offerte, ua: string | null, ip: string | null): Promise<void> {
  const t = nu()
  // Eerste keer voorwaardelijk: twee keer tegelijk openen geeft nooit twee "eerste keren".
  const { data: eerste } = await admin.from('offertes').update({ klant_geopend_op: t }).eq('id', o.id).is('klant_geopend_op', null).select('id')
  const isEerste = (eerste ?? []).length > 0
  await admin.from('offertes').update({ laatst_geopend_op: t, aantal_keer_geopend: (o.aantal_keer_geopend ?? 0) + 1 }).eq('id', o.id)
  await log(admin, o.id, 'geopend', { ua, ip, meta: { toestel: toestelVan(ua), eerste: isEerste } })
  if (isEerste && o.opdracht_id) {
    await voegNotitieToe(admin, o.opdracht_id, `De klant opende de offerte "${o.titel}" (${toestelVan(ua)}).`, 'systeem', null).catch(() => null)
  }
}

/**
 * De klant accepteert. Enkel een verstuurde offerte die nog geldig is; twee
 * keer klikken accepteert één keer. Daarna een interne melding naar info@
 * (nooit een mail naar de klant) en een notitie op het project.
 */
export async function accepteer(admin: Admin, token: string, b: { naam: unknown; ip: string | null; ua: string | null }): Promise<Offerte> {
  const o = await offerteVanToken(admin, token)
  if (!o) throw new OfferteFout('Deze offerte bestaat niet.', 404)
  if (o.status === 'geaccepteerd') return o
  if (o.status !== 'verstuurd') throw new OfferteFout('Deze offerte kan niet meer geaccepteerd worden. Neem contact met ons op.', 409)
  if (o.geldig_tot && o.geldig_tot < vandaagBrussel()) throw new OfferteFout('Deze offerte is verlopen. Neem contact met ons op voor een nieuwe.', 409)
  const naam = String(b.naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (naam.length < 2) throw new OfferteFout('Vul je naam in.')
  const t = nu()
  const { data, error } = await admin.from('offertes').update({
    status: 'geaccepteerd', geaccepteerd_op: t, geaccepteerd_door: naam, geaccepteerd_ip: b.ip, geaccepteerd_ua: b.ua?.slice(0, 400) ?? null, updated_at: t,
  }).eq('id', o.id).eq('status', 'verstuurd').select('*')
  if (error) throw new Error(error.message)
  const na = ((data ?? [])[0] ?? null) as Offerte | null
  if (!na) return (await offerteVanToken(admin, token)) ?? o
  await log(admin, o.id, 'geaccepteerd', { ip: b.ip, ua: b.ua, meta: { naam, toestel: toestelVan(b.ua) } })
  if (o.opdracht_id) await voegNotitieToe(admin, o.opdracht_id, `Offerte "${o.titel}" geaccepteerd door ${naam}. Tijd om het contract op te maken.`, 'systeem', null).catch(() => null)
  // Interne melding (geen klantmail).
  try {
    const link = `${baseUrl().replace(/\/$/, '')}/admin/offertes?offerte=${o.id}`
    const bedrag = o.bedrag_excl ? ` (${Number(o.bedrag_excl).toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })} excl. btw)` : ''
    const tekst = `${o.klant_naam ?? 'Een klant'} accepteerde de offerte "${o.titel}"${bedrag}.\n\nGeaccepteerd door: ${naam}\nOp: ${new Date(t).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}\n\nVolgende stap: het contract opmaken.`
    await sendEmail({ to: INFO, subject: `Offerte geaccepteerd: ${o.klant_naam ?? ''} – ${o.titel}`.slice(0, 180), text: buildEmailText({ bodyText: tekst, ctaText: 'Offerte openen', ctaLink: link }), html: buildEmailHtml({ bodyText: tekst, ctaText: 'Offerte openen', ctaLink: link, merk: o.merk }), idempotencyKey: `offerte-geaccepteerd-${o.id}` })
  } catch { /* melding is een extra; de acceptatie staat vast */ }
  return na
}

/** De pdf voor de publieke pagina of het team (stream, geen verlopende link). */
export async function pdfVan(admin: Admin, o: Pick<Offerte, 'pdf_pad'>): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(OFFERTE_BUCKET).download(o.pdf_pad)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

export const publiekeLink = (o: Pick<Offerte, 'token'>) => offerteLink(baseUrl(), o.token)
