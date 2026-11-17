import 'server-only'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { datumRegel, leesHandtekening, controleerNaam } from '@/lib/contracten/tegenhandtekening'
import { baseUrl, sendEmail, sendEmailMetAfzenderTerugval, EMAIL_FROM, resendKeyFor } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { mailMerkVan, MERK_STIJL } from '@/lib/merk-mail'
import { INFO_ADRES } from '@/lib/meetings/meeting-mail'
import { pdfInfo, stempelBlok } from './pdf'
import {
  blokRegels, controleerMapnaam, controleerVelden, downloadNaam, redenOnsNiet, redenPartijNiet, standaardZone, zoneOfNull,
  type AlgemeenContract, type Map, type Zone,
} from './model'

/**
 * Algemene contracten, de serverkant (regels in ./model.ts). Enkel de
 * zaakvoerders (admins) komen hier; de andere partij enkel via een
 * persoonlijke link (algemene_contract_links, enkel de SHA-256).
 *
 * Bestanden in de privébucket `algemene-contracten`:
 *   origineel/<uuid>/<naam>.pdf          het opgeladen document, verandert nooit
 *   getekend/<id>-<tijd>-<wie>.pdf       elke handtekening = een nieuwe kopie (huidig_pad)
 *   handtekeningen/<id>-<wie>-<tijd>.png de tekening zelf, als bewijs
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any
export const AC_BUCKET = 'algemene-contracten'
const MAX = 50 * 1024 * 1024
const MAX_BIJLAGE = 10 * 1024 * 1024
const LINK_DAGEN = 30

export class AcFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const sha = (b: Uint8Array | Buffer) => createHash('sha256').update(b).digest('hex')
const tokenHash = (t: string) => createHash('sha256').update(`ac-link:${t}`).digest('hex')
const veiligeNaam = (naam: string) => naam.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'document.pdf'
const stempel = (op: string) => op.replace(/[^0-9]/g, '').slice(0, 17)
const basis = () => baseUrl().replace(/\/$/, '')

export const KOLOMMEN = 'id, map_id, titel, tegenpartij, tegenpartij_email, labels, notitie, begin_datum, eind_datum, bestand_naam, bestand_grootte, ons_nodig, ondertekenaar, ons_zone, ons_getekend_op, ons_getekend_door, partij_nodig, partij_zone, partij_getekend_op, partij_naam, partij_geopend_op, laatst_verstuurd_op, gearchiveerd_op, created_at, created_by, versie, paginas'

type Volledig = AlgemeenContract & { bestand_pad: string; huidig_pad: string | null; paginas: number | null }

export async function logEvent(admin: Admin, contractId: string, actie: string, door: string | null, details?: Record<string, unknown>) {
  await admin.from('algemene_contract_events').insert({ contract_id: contractId, actie, door, details: details ?? null }).then(() => null, () => null)
}

/** Alles voor het overzicht: mappen en contracten (ook gearchiveerde, het scherm filtert). */
export async function laadOverzicht(admin: Admin): Promise<{ mappen: Map[]; contracten: AlgemeenContract[] }> {
  const [m, c] = await Promise.all([
    admin.from('algemene_contract_mappen').select('id, naam, volgorde').order('volgorde').order('naam'),
    admin.from('algemene_contracten').select(KOLOMMEN).order('created_at', { ascending: false }).limit(2000),
  ])
  if (m.error) throw new AcFout(/does not exist|schema cache/i.test(m.error.message) ? 'De tabellen voor algemene contracten bestaan nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.' : m.error.message, 500)
  return { mappen: (m.data ?? []) as Map[], contracten: ((c.data ?? []) as AlgemeenContract[]).map((x) => ({ ...x, labels: x.labels ?? [] })) }
}

export async function laadContract(admin: Admin, id: string): Promise<Volledig> {
  const { data } = await admin.from('algemene_contracten').select(`${KOLOMMEN}, bestand_pad, huidig_pad`).eq('id', id).maybeSingle()
  if (!data) throw new AcFout('Contract niet gevonden.', 404)
  return { ...data, labels: data.labels ?? [] }
}

export async function tijdlijn(admin: Admin, id: string) {
  const { data } = await admin.from('algemene_contract_events').select('actie, door, details, created_at').eq('contract_id', id).order('created_at', { ascending: false }).limit(100)
  return (data ?? []) as { actie: string; door: string | null; details: Record<string, unknown> | null; created_at: string }[]
}

// ── Opladen en aanmaken ─────────────────────────────────────────────────────

/** Een ondertekende uploadlink: de browser laadt de PDF rechtstreeks op. */
export async function uploadLink(admin: Admin, naam: string, grootte: number): Promise<{ pad: string; token: string; bucket: string }> {
  if (!/\.pdf$/i.test(naam)) throw new AcFout('Enkel PDF. Een Word-document sla je eerst op als PDF (Bestand → Opslaan als → PDF).')
  if (!Number.isFinite(grootte) || grootte <= 0) throw new AcFout('Leeg bestand.')
  if (grootte > MAX) throw new AcFout('Het bestand is groter dan 50 MB.')
  const pad = `origineel/${randomUUID()}/${veiligeNaam(naam)}`
  const { data, error } = await admin.storage.from(AC_BUCKET).createSignedUploadUrl(pad)
  if (error || !data?.token) throw new AcFout(error?.message ?? 'Uploadlink maken mislukt', 500)
  return { pad, token: data.token as string, bucket: AC_BUCKET }
}

export async function maakContract(admin: Admin, b: Record<string, unknown>, door: { email: string | null; userId: string }): Promise<string> {
  const pad = typeof b.pad === 'string' && /^origineel\/[0-9a-f-]{36}\/[^/]+$/i.test(b.pad) ? b.pad : null
  if (!pad) throw new AcFout('Laad eerst een PDF op.')
  const c = controleerVelden(b)
  if ('fout' in c) throw new AcFout(c.fout)
  const { data: bestand, error } = await admin.storage.from(AC_BUCKET).download(pad)
  if (error || !bestand) throw new AcFout('De PDF is niet (volledig) opgeladen. Probeer opnieuw.')
  const bytes = new Uint8Array(await bestand.arrayBuffer())
  if (!bytes.length) throw new AcFout('De PDF is leeg.')
  if (Buffer.from(bytes.slice(0, 1024)).toString('latin1').indexOf('%PDF') === -1) throw new AcFout('Dit is geen PDF.')
  let paginas = 1
  try { paginas = (await pdfInfo(bytes)).paginas } catch { throw new AcFout('De PDF kan niet gelezen worden (beschadigd of beveiligd).') }
  const naam = typeof b.bestand_naam === 'string' && b.bestand_naam.trim() ? b.bestand_naam.trim().slice(0, 200) : pad.split('/').pop()
  const { data, error: insFout } = await admin.from('algemene_contracten').insert({
    ...c.velden, bestand_pad: pad, bestand_naam: naam, bestand_grootte: bytes.length, bestand_sha256: sha(bytes), paginas,
    ons_zone: standaardZone('ons', paginas), partij_zone: standaardZone('partij', paginas),
    created_by: door.email, created_by_user: door.userId,
  }).select('id').single()
  if (insFout || !data) throw new AcFout(insFout?.message ?? 'Bewaren mislukt', 500)
  await logEvent(admin, data.id, 'opgeladen', door.email, { bestand: naam, paginas, sha256: sha(bytes) })
  return data.id as string
}

// ── Aanpassen, archiveren, verwijderen ──────────────────────────────────────

export async function wijzigContract(admin: Admin, id: string, b: Record<string, unknown>, door: string | null): Promise<void> {
  const c = await laadContract(admin, id)
  const upd: Record<string, unknown> = {}
  const v = controleerVelden(b, true)
  if ('fout' in v) throw new AcFout(v.fout)
  Object.assign(upd, v.velden)
  if ('ons_zone' in b) upd.ons_zone = zoneOfNull(b.ons_zone, c.paginas ?? undefined)
  if ('partij_zone' in b) upd.partij_zone = zoneOfNull(b.partij_zone, c.paginas ?? undefined)
  if ('archief' in b) upd.gearchiveerd_op = b.archief ? new Date().toISOString() : null
  // Wat al getekend werd, blijft "nodig": een handtekening verdwijnt nooit uit de status.
  if (upd.ons_nodig === false && c.ons_getekend_op) delete upd.ons_nodig
  if (upd.partij_nodig === false && c.partij_getekend_op) delete upd.partij_nodig
  if (!Object.keys(upd).length) return
  const { error } = await admin.from('algemene_contracten').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new AcFout(error.message, 500)
  const velden = Object.keys(upd).filter((k) => !k.endsWith('_zone'))
  if ('archief' in b) await logEvent(admin, id, b.archief ? 'gearchiveerd' : 'teruggezet', door)
  else if (velden.length) await logEvent(admin, id, 'aangepast', door, { velden })
}

/** Verwijderen kan enkel zolang niemand tekende (een vergissing bij het opladen); anders archiveren. */
export async function verwijderContract(admin: Admin, id: string): Promise<void> {
  const c = await laadContract(admin, id)
  if (c.ons_getekend_op || c.partij_getekend_op) throw new AcFout('Er staat al een handtekening op. Archiveer het contract in de plaats.', 409)
  await admin.storage.from(AC_BUCKET).remove([c.bestand_pad]).catch(() => null)
  const { error } = await admin.from('algemene_contracten').delete().eq('id', id)
  if (error) throw new AcFout(error.message, 500)
}

// ── Mappen ──────────────────────────────────────────────────────────────────

export async function mapActie(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<void> {
  const id = typeof b.id === 'string' && /^[0-9a-f-]{36}$/i.test(b.id) ? b.id : null
  if (b.actie === 'maak' || b.actie === 'hernoem') {
    const n = controleerMapnaam(b.naam)
    if ('fout' in n) throw new AcFout(n.fout)
    if (b.actie === 'hernoem' && !id) throw new AcFout('Ongeldige map.')
    const { error } = b.actie === 'maak'
      ? await admin.from('algemene_contract_mappen').insert({ naam: n.naam, volgorde: 50, created_by: door })
      : await admin.from('algemene_contract_mappen').update({ naam: n.naam }).eq('id', id)
    if (error) {
      const dubbel = /duplicate|unique/i.test(error.message)
      throw new AcFout(dubbel ? 'Die map bestaat al.' : error.message, dubbel ? 409 : 500)
    }
    return
  }
  if (b.actie === 'verwijder') {
    if (!id) throw new AcFout('Ongeldige map.')
    // De contracten blijven, zonder map.
    await admin.from('algemene_contracten').update({ map_id: null }).eq('map_id', id)
    const { error } = await admin.from('algemene_contract_mappen').delete().eq('id', id)
    if (error) throw new AcFout(error.message, 500)
    return
  }
  throw new AcFout('Onbekende actie.')
}

// ── PDF bekijken en downloaden ──────────────────────────────────────────────

/** Een kortlevende link naar de huidige versie (met alle handtekeningen) of het origineel. */
export async function pdfLink(admin: Admin, c: Volledig, o: { origineel?: boolean; download?: boolean; seconden?: number } = {}): Promise<string | null> {
  const pad = o.origineel ? c.bestand_pad : c.huidig_pad ?? c.bestand_pad
  const naam = o.origineel ? (c.bestand_naam ?? 'origineel.pdf') : downloadNaam(c)
  const { data } = await admin.storage.from(AC_BUCKET).createSignedUrl(pad, o.seconden ?? 300, o.download ? { download: naam } : undefined)
  return data?.signedUrl ?? null
}

// ── Tekenen ─────────────────────────────────────────────────────────────────

/** Een handtekening op de huidige versie zetten en die als nieuwe kopie bewaren. */
async function stempelEnBewaar(admin: Admin, c: Volledig, wie: 'ons' | 'partij', png: Buffer, zone: unknown, regels: string[], op: string): Promise<{ pad: string; zone: Zone; voor: string; na: string }> {
  const { data: bestand, error } = await admin.storage.from(AC_BUCKET).download(c.huidig_pad ?? c.bestand_pad)
  if (error || !bestand) throw new AcFout('De PDF werd niet gevonden in de opslag.', 500)
  const bron = new Uint8Array(await bestand.arrayBuffer())
  let g: { bytes: Uint8Array; zone: Zone }
  try { g = await stempelBlok(bron, png, zone, regels) } catch (e) {
    throw new AcFout(`De handtekening kon niet op de PDF gezet worden (${e instanceof Error ? e.message : 'onbekende fout'}).`, 500)
  }
  const pad = `getekend/${c.id}-${stempel(op)}-${wie}.pdf`
  const { error: upFout } = await admin.storage.from(AC_BUCKET).upload(pad, Buffer.from(g.bytes), { contentType: 'application/pdf', upsert: false })
  if (upFout) throw new AcFout(`Bewaren van de PDF mislukt: ${upFout.message}`, 500)
  await admin.storage.from(AC_BUCKET).upload(`handtekeningen/${c.id}-${wie}-${stempel(op)}.png`, png, { contentType: 'image/png', upsert: false }).catch(() => null)
  return { pad, zone: g.zone, voor: sha(bron), na: sha(g.bytes) }
}

/** Wij tekenen (een zaakvoerder), met naam uit het account en datum en uur van tekenen. */
export async function tekenOns(admin: Admin, id: string, b: Record<string, unknown>, door: { userId: string; email: string | null; naam: string; ip?: string | null; ua?: string | null }): Promise<{ op: string }> {
  const c = await laadContract(admin, id)
  const reden = redenOnsNiet(c)
  if (reden) throw new AcFout(reden, c.ons_getekend_op ? 409 : 400)
  const naam = controleerNaam(door.naam)
  if (!naam) throw new AcFout('Je naam ontbreekt op je account. Vul ze in bij Mijn account.')
  const hand = leesHandtekening(b.handtekening)
  if (!hand.ok) throw new AcFout(hand.fout)
  const op = new Date().toISOString()
  const r = await stempelEnBewaar(admin, c, 'ons', Buffer.from(hand.base64, 'base64'), b.zone ?? c.ons_zone, blokRegels({ naam, namens: 'NextGenMedia', datum: datumRegel(op) }), op)
  const partijZone = 'partij_zone' in b ? zoneOfNull(b.partij_zone, c.paginas ?? undefined) : undefined
  const { data: gelukt, error } = await admin.from('algemene_contracten').update({
    huidig_pad: r.pad, huidig_sha256: r.na, versie: c.versie + 1, ons_zone: r.zone, ...(partijZone !== undefined ? { partij_zone: partijZone } : {}),
    ons_getekend_op: op, ons_getekend_door: naam, ons_getekend_email: door.email, ons_user_id: door.userId, updated_at: op,
  }).eq('id', id).eq('versie', c.versie).is('ons_getekend_op', null).select('id')
  if (error) throw new AcFout(error.message, 500)
  if (!(gelukt ?? []).length) throw new AcFout('Er werd net iets anders op dit contract getekend. Herlaad de pagina.', 409)
  await logEvent(admin, id, 'ons_getekend', door.email ?? naam, { naam, zone: r.zone, sha256_voor: r.voor, sha256_na: r.na, ip: door.ip ?? null, ua: door.ua ?? null })
  return { op }
}

// ── Persoonlijke link voor de andere partij ─────────────────────────────────

export async function maakLink(admin: Admin, contractId: string, email: string | null, door: string | null): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const verloopt = new Date(Date.now() + LINK_DAGEN * 86_400_000).toISOString()
  const { error } = await admin.from('algemene_contract_links').insert({ contract_id: contractId, token_hash: tokenHash(token), email, verloopt_op: verloopt, created_by: door })
  if (error) throw new AcFout(error.message, 500)
  return `${basis()}/document/${token}`
}

/** Het contract achter een link, of null (onbekend, verlopen of gearchiveerd). */
export async function vindLink(admin: Admin, token: string): Promise<{ linkId: string; email: string | null; contract: Volledig } | null> {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null
  const { data: l } = await admin.from('algemene_contract_links').select('id, contract_id, email, verloopt_op').eq('token_hash', tokenHash(token)).maybeSingle()
  if (!l || new Date(l.verloopt_op).getTime() < Date.now()) return null
  try {
    const contract = await laadContract(admin, l.contract_id)
    if (contract.gearchiveerd_op) return null
    return { linkId: l.id, email: l.email ?? null, contract }
  } catch { return null }
}

export async function markeerGeopend(admin: Admin, linkId: string, contractId: string): Promise<void> {
  const nu = new Date().toISOString()
  await admin.from('algemene_contract_links').update({ geopend_op: nu }).eq('id', linkId).is('geopend_op', null)
  const { data } = await admin.from('algemene_contracten').update({ partij_geopend_op: nu }).eq('id', contractId).is('partij_geopend_op', null).select('id')
  if ((data ?? []).length) await logEvent(admin, contractId, 'geopend', null)
}

/** De andere partij tekent via de link: naam, handtekening en akkoord verplicht. */
export async function tekenPartij(admin: Admin, token: string, b: Record<string, unknown>, meta: { ip: string | null; ua: string | null }): Promise<{ op: string; titel: string }> {
  const l = await vindLink(admin, token)
  if (!l) throw new AcFout('Deze link werkt niet meer. Vraag een nieuwe aan.', 404)
  const c = l.contract
  const reden = redenPartijNiet(c)
  if (reden) throw new AcFout(reden, c.partij_getekend_op ? 409 : 400)
  if (b.akkoord !== true) throw new AcFout('Bevestig dat je het document gelezen hebt en ondertekent.')
  const naam = controleerNaam(b.naam)
  if (!naam) throw new AcFout('Vul je volledige naam in.')
  const hand = leesHandtekening(b.handtekening)
  if (!hand.ok) throw new AcFout(hand.fout)
  const op = new Date().toISOString()
  const r = await stempelEnBewaar(admin, c, 'partij', Buffer.from(hand.base64, 'base64'), c.partij_zone ?? standaardZone('partij', c.paginas ?? 1), blokRegels({ naam, datum: datumRegel(op) }), op)
  const { data: gelukt, error } = await admin.from('algemene_contracten').update({
    huidig_pad: r.pad, huidig_sha256: r.na, versie: c.versie + 1, partij_zone: r.zone,
    partij_getekend_op: op, partij_naam: naam, partij_email: l.email, partij_ip: meta.ip, partij_ua: meta.ua?.slice(0, 300) ?? null, updated_at: op,
  }).eq('id', c.id).eq('versie', c.versie).is('partij_getekend_op', null).select('id')
  if (error) throw new AcFout(error.message, 500)
  if (!(gelukt ?? []).length) throw new AcFout('Er werd net iets anders op dit document getekend. Herlaad de pagina en probeer opnieuw.', 409)
  await logEvent(admin, c.id, 'partij_getekend', naam, { naam, email: l.email, zone: r.zone, sha256_voor: r.voor, sha256_na: r.na, ip: meta.ip, ua: meta.ua })
  // Interne melding (geen klantmail): wie tekende wat.
  await sendEmail({
    to: INFO_ADRES,
    subject: `Getekend: ${c.titel}`,
    text: `${naam}${c.tegenpartij ? ` (${c.tegenpartij})` : ''} tekende "${c.titel}" op ${datumRegel(op)}.\n\n${basis()}/admin/algemene-contracten/${c.id}`,
  }).catch(() => null)
  return { op, titel: c.titel }
}

// ── Mailen ──────────────────────────────────────────────────────────────────

/**
 * De mail aan de andere partij, vanuit de MailComposer (voorbeeld en knop
 * Versturen; nooit automatisch). De knop opent een persoonlijke link (30
 * dagen) om te bekijken, downloaden en, als dat gevraagd is, te tekenen. De
 * huidige PDF gaat als bijlage mee (tot 10 MB). Het E-mail Center bewaart de
 * mail zonder de link.
 */
export async function verstuurMail(admin: Admin, id: string, b: Record<string, unknown>, door: { userId: string; email: string | null }): Promise<{ id: string | null; verstuurd_op: string; al_verstuurd?: boolean }> {
  const c = await laadContract(admin, id)
  if (c.gearchiveerd_op) throw new AcFout('Dit contract is gearchiveerd.')
  const aan = String(b.to_email ?? '').trim().toLowerCase()
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(aan)) throw new AcFout('Vul één geldig e-mailadres in.')
  const onderwerp = String(b.subject ?? '').trim().slice(0, 200)
  const tekst = String(b.body ?? '')
  if (!onderwerp) throw new AcFout('Het onderwerp is verplicht.')
  const sleutel = typeof b.verzend_sleutel === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(b.verzend_sleutel) ? b.verzend_sleutel : null
  if (sleutel) {
    const { data: al } = await admin.from('email_messages').select('id, status, created_at').eq('verzend_sleutel', sleutel).maybeSingle()
    if (al?.status === 'sent') return { id: al.id, verstuurd_op: al.created_at, al_verstuurd: true }
  }
  const merk = mailMerkVan(b.merk)
  const van = merk === 'nextgenmedia' ? EMAIL_FROM : MERK_STIJL[merk].van
  const knop = String(b.cta_text ?? '').trim() || 'Document bekijken'
  const url = await maakLink(admin, id, aan, door.email)
  const html = buildEmailHtml({ bodyText: tekst, ctaText: knop, ctaLink: url, merk })
  const text = buildEmailText({ bodyText: tekst, ctaText: knop, ctaLink: url, merk })
  const htmlLog = buildEmailHtml({ bodyText: tekst, ctaText: knop, ctaLink: `${basis()}/document/(persoonlijke link)`, merk })

  // Bijlage: de huidige versie (met alle handtekeningen), als ze klein genoeg is.
  let bijlage: { filename: string; content: string; contentType: string } | null = null
  if (b.bijlage !== false) {
    const { data: f } = await admin.storage.from(AC_BUCKET).download(c.huidig_pad ?? c.bestand_pad)
    if (f) {
      const buf = Buffer.from(await f.arrayBuffer())
      if (buf.length <= MAX_BIJLAGE) bijlage = { filename: downloadNaam(c), content: buf.toString('base64'), contentType: 'application/pdf' }
    }
  }
  const t = () => new Date().toISOString()
  let logId: string | null = null
  try {
    const { data: rij } = await admin.from('email_messages').insert({
      to_email: aan, subject: onderwerp, body: tekst, html: htmlLog, from_email: van, kind: 'algemeen_contract', audience: 'extern',
      related_id: id, verzend_sleutel: sleutel, status: 'bezig', sent_by: door.userId, sent_by_email: door.email, updated_at: t(),
    }).select('id').single()
    logId = rij?.id ?? null
  } catch { /* logboek mag het versturen niet tegenhouden */ }
  const res = await sendEmailMetAfzenderTerugval({
    to: aan, subject: onderwerp, text, html, from: merk === 'nextgenmedia' ? null : van, apiKey: resendKeyFor(merk),
    idempotencyKey: sleutel ? `algemeen-contract-${id}-${sleutel}` : null, ...(bijlage ? { attachments: [bijlage] } : {}),
  })
  if (logId) await admin.from('email_messages').update({ status: res.ok ? 'sent' : 'error', error: res.ok ? null : res.error ?? 'Onbekende fout', provider_id: res.id ?? null, updated_at: t() }).eq('id', logId)
  if (!res.ok) throw new AcFout(res.error || 'Verzenden mislukt')
  const op = t()
  await admin.from('algemene_contracten').update({ laatst_verstuurd_op: op, ...(c.tegenpartij_email ? {} : { tegenpartij_email: aan }) }).eq('id', id)
  await logEvent(admin, id, 'verstuurd', door.email, { aan, bijlage: !!bijlage, ter_ondertekening: c.partij_nodig && !c.partij_getekend_op })
  return { id: logId, verstuurd_op: op }
}
