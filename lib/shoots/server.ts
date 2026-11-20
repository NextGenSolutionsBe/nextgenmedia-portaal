import 'server-only'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { baseUrl, sendEmailMetAfzenderTerugval, EMAIL_FROM, resendKeyFor } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { mailMerkVan, MERK_STIJL } from '@/lib/merk-mail'
import {
  afgeleid, controleerBewaren, isEmail, linkVerlooptOp, nogAanTeVullen, normaliseerPlan, shootMail, shootOntvangers,
  type Shoot, type ShootKort,
} from './model'
import { maakShootplanPdf, shootplanBestandsnaam } from './pdf'

/**
 * Shoot planner, de serverkant (regels in ./model.ts). Een shoot is een rij in
 * shoot_briefings; het team werkt via /api/admin/shoots (module shoots), wie
 * het plan per mail kreeg via een persoonlijke link /shoot/<token> (enkel de
 * SHA-256 in shoot_links). Briefingdocumenten staan in de privébucket shoots.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any
export const SHOOT_BUCKET = 'shoots'
const MAX_BESTAND = 25 * 1024 * 1024
export const BRIEFING_TYPES: Record<string, string> = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/plain': 'txt',
}

export class ShootFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const tokenHash = (t: string) => createHash('sha256').update(`shoot-link:${t}`).digest('hex')
const basis = () => baseUrl().replace(/\/$/, '')
const veiligeNaam = (naam: string) => naam.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'briefing'
const UUID = /^[0-9a-f-]{36}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const isBriefingPad = (v: unknown): v is string => typeof v === 'string' && /^briefing\/[0-9a-f-]{36}\/[\w.\-]{1,120}$/i.test(v)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function naarShoot(r: any, klant: string | null): Shoot {
  const plan = normaliseerPlan({
    titel: r.titel, datum: r.shoot_date, status: r.status, doel: r.doel, locaties: r.locaties, programma: r.programma,
    betrokkenen: r.betrokkenen, paklijst: r.paklijst, shotlist: r.shotlist, praktisch: r.praktisch, briefing: r.briefing,
  })
  // Een oudere shoot zonder plan: de vrije locatie van toen als enige locatie.
  if (!plan.locaties.length && r.location) plan.locaties.push({ id: 'oud', naam: String(r.location).slice(0, 200), adres: '', contact: '', telefoon: '', notitie: '' })
  return {
    ...plan, id: r.id, client_id: r.client_id, klant,
    start: r.start_time ?? null, einde: r.end_time ?? null, versie: Number(r.versie ?? 1) || 1,
    briefing_pad: r.briefing_pad ?? null, briefing_naam: r.briefing_naam ?? null, briefing_type: r.briefing_type ?? null,
    laatst_verstuurd_op: r.laatst_verstuurd_op ?? null, updated_at: r.updated_at ?? null, bijgewerkt_door: r.bijgewerkt_door ?? null,
  }
}

async function klantNamen(admin: Admin, ids: string[]): Promise<Map<string, { naam: string; email: string | null; contact: string | null }>> {
  const uit = new Map<string, { naam: string; email: string | null; contact: string | null }>()
  const uniek = Array.from(new Set(ids.filter(Boolean)))
  if (!uniek.length) return uit
  const { data } = await admin.from('clients').select('id, company_name, email, contact_name').in('id', uniek)
  for (const c of data ?? []) uit.set(c.id, { naam: c.company_name ?? 'Klant', email: c.email ?? null, contact: c.contact_name ?? null })
  return uit
}


/** Shoots tussen twee datums (voor de kalender) of vanaf een datum (komende shoots). */
export async function laadShoots(admin: Admin, o: { van: string; tot?: string | null }): Promise<ShootKort[]> {
  let q = admin.from('shoot_briefings').select('*').gte('shoot_date', o.van).order('shoot_date', { ascending: true }).limit(500)
  if (o.tot) q = q.lte('shoot_date', o.tot)
  const { data, error } = await q
  if (error) throw new ShootFout(error.message, 500)
  const namen = await klantNamen(admin, (data ?? []).map((r: { client_id: string }) => r.client_id))
  return (data ?? []).map((r: { client_id: string }) => {
    const s = naarShoot(r, namen.get(r.client_id)?.naam ?? null)
    return {
      id: s.id, client_id: s.client_id, klant: s.klant, titel: s.titel, datum: s.datum, status: s.status, start: s.start, einde: s.einde,
      locaties: s.locaties.map((l) => l.naam), punten: s.programma.length, mensen: s.betrokkenen.length, verstuurd: s.laatst_verstuurd_op,
    }
  }).sort((a: ShootKort, b: ShootKort) => `${a.datum}${a.start ?? '99'}`.localeCompare(`${b.datum}${b.start ?? '99'}`))
}

export async function laadShoot(admin: Admin, id: string): Promise<Shoot & { klantEmail: string | null; klantContact: string | null }> {
  if (!isUuid(id)) throw new ShootFout('Ongeldige shoot.', 400)
  const { data, error } = await admin.from('shoot_briefings').select('*').eq('id', id).maybeSingle()
  if (error) throw new ShootFout(error.message, 500)
  if (!data) throw new ShootFout('Deze shoot bestaat niet meer.', 404)
  const k = (await klantNamen(admin, [data.client_id])).get(data.client_id)
  return { ...naarShoot(data, k?.naam ?? null), klantEmail: k?.email ?? null, klantContact: k?.contact ?? null }
}

/** Kolommen die er pas na de migratie zijn: ontbreekt er één, dan laten we die weg en proberen opnieuw. */
async function veerkrachtig<T>(rij: Record<string, unknown>, doe: (r: Record<string, unknown>) => Promise<{ data: T; error: { message?: string; code?: string } | null }>): Promise<{ data: T; error: { message?: string } | null }> {
  const r = { ...rij }
  for (let i = 0; i < 20; i++) {
    const res = await doe(r)
    const m = res.error ? /column "?([a-z_]+)"? (?:of relation "?[a-z_]+"? )?does not exist|Could not find the '([a-z_]+)' column/i.exec(res.error.message ?? '') : null
    const kolom = m?.[1] ?? m?.[2]
    if (!res.error || !kolom || !(kolom in r)) return res
    delete r[kolom]
  }
  return doe(r)
}

/** Nieuwe shoot of aanpassen. Met `versie` erbij: enkel als niemand anders intussen bewaarde. */
export async function bewaarShoot(admin: Admin, id: string | null, b: Record<string, unknown>, door: { userId: string; email: string | null }): Promise<{ id: string; versie: number }> {
  const plan = normaliseerPlan(b.plan ?? b)
  const clientId = isUuid(b.client_id) ? b.client_id : null
  const fout = controleerBewaren(plan, clientId)
  if (fout) throw new ShootFout(fout)
  const { data: klant } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle()
  if (!klant) throw new ShootFout('Deze klant bestaat niet (meer).')
  const a = afgeleid(plan)
  const rij: Record<string, unknown> = {
    client_id: clientId, shoot_date: plan.datum, start_time: a.start_time, end_time: a.end_time, location: a.location, briefing: plan.briefing || null,
    titel: plan.titel || null, status: plan.status, doel: plan.doel || null, locaties: plan.locaties, programma: plan.programma, betrokkenen: plan.betrokkenen,
    paklijst: plan.paklijst, shotlist: plan.shotlist, praktisch: plan.praktisch || null, bijgewerkt_door: door.email, updated_at: new Date().toISOString(),
  }
  if (b.briefing_pad === null) Object.assign(rij, { briefing_pad: null, briefing_naam: null, briefing_type: null })
  else if (isBriefingPad(b.briefing_pad)) {
    Object.assign(rij, { briefing_pad: b.briefing_pad, briefing_naam: String(b.briefing_naam ?? '').slice(0, 200) || b.briefing_pad.split('/').pop(), briefing_type: typeof b.briefing_type === 'string' ? b.briefing_type.slice(0, 120) : null })
  }

  if (!id) {
    const { data, error } = await veerkrachtig(rij, (r) => admin.from('shoot_briefings').insert({ ...r, versie: 1, created_by: door.userId }).select('id').single())
    if (error || !data) throw new ShootFout(error?.message ?? 'Bewaren mislukt', 500)
    return { id: (data as { id: string }).id, versie: 1 }
  }
  if (!isUuid(id)) throw new ShootFout('Ongeldige shoot.')
  const huidig = await admin.from('shoot_briefings').select('id, versie, briefing_pad').eq('id', id).maybeSingle()
  if (!huidig.data) throw new ShootFout('Deze shoot bestaat niet meer.', 404)
  const oudeVersie = Number(huidig.data.versie ?? 1) || 1
  if (typeof b.versie === 'number' && b.versie !== oudeVersie) throw new ShootFout('Iemand anders paste deze shoot net aan. Herlaad de pagina om de laatste versie te zien.', 409)
  const { data, error } = await veerkrachtig({ ...rij, versie: oudeVersie + 1 }, (r) => {
    let q = admin.from('shoot_briefings').update(r).eq('id', id)
    if ('versie' in r) q = q.eq('versie', oudeVersie)
    return q.select('id')
  })
  if (error) throw new ShootFout(error.message ?? 'Bewaren mislukt', 500)
  if (!(data as unknown[] | null)?.length) throw new ShootFout('Iemand anders paste deze shoot net aan. Herlaad de pagina om de laatste versie te zien.', 409)
  // Een vervangen of weggehaald briefingdocument mag uit de opslag.
  const oudPad = huidig.data.briefing_pad as string | null
  if (oudPad && 'briefing_pad' in rij && rij.briefing_pad !== oudPad) await admin.storage.from(SHOOT_BUCKET).remove([oudPad]).catch(() => null)
  return { id, versie: oudeVersie + 1 }
}

export async function verwijderShoot(admin: Admin, id: string): Promise<void> {
  if (!isUuid(id)) throw new ShootFout('Ongeldige shoot.')
  const { data } = await admin.from('shoot_briefings').select('briefing_pad').eq('id', id).maybeSingle()
  const { error } = await admin.from('shoot_briefings').delete().eq('id', id)
  if (error) throw new ShootFout(error.message, 500)
  if (data?.briefing_pad) await admin.storage.from(SHOOT_BUCKET).remove([data.briefing_pad]).catch(() => null)
}

// ── Briefingdocument ────────────────────────────────────────────────────────

export async function uploadLink(admin: Admin, naam: string, grootte: number, type: string): Promise<{ pad: string; token: string; bucket: string }> {
  if (!BRIEFING_TYPES[type]) throw new ShootFout('Enkel een pdf, foto (jpg, png, webp), Word-document (.docx) of tekstbestand.')
  if (!Number.isFinite(grootte) || grootte <= 0 || grootte > MAX_BESTAND) throw new ShootFout('Het bestand mag maximaal 25 MB zijn.')
  const pad = `briefing/${randomUUID()}/${veiligeNaam(naam)}`
  const { data, error } = await admin.storage.from(SHOOT_BUCKET).createSignedUploadUrl(pad)
  if (error || !data?.token) throw new ShootFout(error?.message ?? 'Uploadlink maken mislukt', 500)
  return { pad, token: data.token as string, bucket: SHOOT_BUCKET }
}

export async function bekijkLink(admin: Admin, pad: string): Promise<string> {
  if (!isBriefingPad(pad)) throw new ShootFout('Ongeldig bestand.')
  const { data, error } = await admin.storage.from(SHOOT_BUCKET).createSignedUrl(pad, 300)
  if (error || !data?.signedUrl) throw new ShootFout('Bestand niet gevonden.', 404)
  return data.signedUrl as string
}

/** Het document als base64 voor de AI (enkel pdf en foto's; Word en tekst leest de browser zelf). */
export async function leesBriefing(admin: Admin, pad: string): Promise<{ base64: string; mime: string } | null> {
  if (!isBriefingPad(pad)) throw new ShootFout('Ongeldig bestand.')
  const { data } = await admin.storage.from(SHOOT_BUCKET).download(pad)
  if (!data) throw new ShootFout('Het briefingdocument werd niet gevonden. Laad het opnieuw op.', 404)
  const mime = String(data.type || '')
  const ext = pad.split('.').pop()?.toLowerCase()
  const echt = mime && mime !== 'application/octet-stream' ? mime : ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : /jpe?g/.test(ext ?? '') ? 'image/jpeg' : mime
  if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(echt)) return null
  const buf = Buffer.from(await data.arrayBuffer())
  if (buf.length > MAX_BESTAND) throw new ShootFout('Het document is te groot om te lezen.')
  return { base64: buf.toString('base64'), mime: echt }
}

/**
 * Het vaste team om snel bij "Wie is erbij" te zetten: wie in Personeel als
 * teamlid of expert in de klantapp staat (actief; het e-mailadres uit Personeel als het er is). Niet heel
 * Personeel: dat is enkel voor hoofdbeheerders. Anderen typ je zelf.
 */
export async function teamLijst(admin: Admin): Promise<{ naam: string; rol: string; email: string; telefoon: string }[]> {
  const { data } = await admin.from('personeel').select('voornaam, achternaam, email, telefoon, functie, actief, einddatum, meeting_zichtbaar, expert_zichtbaar').order('voornaam')
  const vandaag = new Date().toISOString().slice(0, 10)
  return (data ?? [])
    .filter((p: { actief: boolean | null; einddatum: string | null; email: string | null; meeting_zichtbaar: boolean | null; expert_zichtbaar: boolean | null }) =>
      (p.meeting_zichtbaar === true || p.expert_zichtbaar === true) && p.actief !== false && (!p.einddatum || p.einddatum >= vandaag))
    .map((p: { voornaam: string | null; achternaam: string | null; email: string | null; telefoon: string | null; functie: string | null }) => ({
      naam: [p.voornaam, p.achternaam].filter(Boolean).join(' ').trim() || (p.email ?? ''), rol: p.functie ?? '', email: isEmail(p.email) ? String(p.email).trim().toLowerCase() : '', telefoon: p.telefoon ?? '',
    }))
    .filter((t: { naam: string }) => t.naam)
}

// ── Persoonlijke link en mail ───────────────────────────────────────────────

export async function maakLink(admin: Admin, s: Pick<Shoot, 'id' | 'datum'>, email: string | null, naam: string | null, door: string | null): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const { error } = await admin.from('shoot_links').insert({ shoot_id: s.id, token_hash: tokenHash(token), email, naam, verloopt_op: linkVerlooptOp(s.datum, new Date()), created_by: door })
  if (error) throw new ShootFout(error.message, 500)
  return `${basis()}/shoot/${token}`
}

/** De shoot achter een link, of null (onbekend of verlopen). */
export async function vindLink(admin: Admin, token: string): Promise<{ linkId: string; email: string | null; shoot: Shoot } | null> {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null
  const { data: l } = await admin.from('shoot_links').select('id, shoot_id, email, verloopt_op').eq('token_hash', tokenHash(token)).maybeSingle()
  if (!l || new Date(l.verloopt_op).getTime() < Date.now()) return null
  try {
    const s = await laadShoot(admin, l.shoot_id)
    return { linkId: l.id, email: l.email ?? null, shoot: s }
  } catch { return null }
}

export async function markeerGeopend(admin: Admin, linkId: string): Promise<void> {
  await admin.from('shoot_links').update({ geopend_op: new Date().toISOString() }).eq('id', linkId).is('geopend_op', null)
}

/** Wie het plan kreeg en wie het opende (voor het scherm). */
export async function verzondenAan(admin: Admin, id: string): Promise<{ email: string | null; naam: string | null; op: string; geopend_op: string | null }[]> {
  const { data } = await admin.from('shoot_links').select('email, naam, created_at, geopend_op').eq('shoot_id', id).order('created_at', { ascending: false }).limit(100)
  const uit: { email: string | null; naam: string | null; op: string; geopend_op: string | null }[] = []
  for (const r of data ?? []) {
    const al = uit.find((x) => x.email === r.email)
    if (al) { if (!al.geopend_op && r.geopend_op) al.geopend_op = r.geopend_op; continue }
    uit.push({ email: r.email, naam: r.naam, op: r.created_at, geopend_op: r.geopend_op })
  }
  return uit
}

/** Voor de MailComposer: wie kan de mail krijgen en een voorstel van tekst. */
export async function mailVoorbereiden(admin: Admin, id: string) {
  const s = await laadShoot(admin, id)
  const m = shootMail(s)
  return { ontvangers: shootOntvangers(s.betrokkenen, { email: s.klantEmail, naam: s.klantContact || s.klant }), voorstel: m, nog: nogAanTeVullen(s), klant: s.klant }
}

/**
 * Eén mail naar één ontvanger (de MailComposer stuurt per persoon, na
 * voorbeeld en bevestiging; nooit automatisch). De knop opent een eigen link
 * naar het shootplan, de pdf gaat als bijlage mee. Het E-mail Center bewaart
 * de mail zonder de link.
 */
export async function verstuurMail(admin: Admin, id: string, b: Record<string, unknown>, door: { userId: string; email: string | null }): Promise<{ id: string | null; verstuurd_op: string; al_verstuurd?: boolean }> {
  const s = await laadShoot(admin, id)
  const aan = String(b.to_email ?? '').trim().toLowerCase()
  if (!isEmail(aan)) throw new ShootFout('Vul één geldig e-mailadres in.')
  const onderwerp = String(b.subject ?? '').trim().slice(0, 200)
  const tekst = String(b.body ?? '').slice(0, 20000)
  if (!onderwerp) throw new ShootFout('Het onderwerp is verplicht.')
  const sleutel = typeof b.verzend_sleutel === 'string' && /^[0-9a-zA-Z:._-]{8,120}$/.test(b.verzend_sleutel) ? b.verzend_sleutel : null
  if (sleutel) {
    const { data: al } = await admin.from('email_messages').select('id, status, created_at').eq('verzend_sleutel', sleutel).maybeSingle()
    if (al?.status === 'sent') return { id: al.id, verstuurd_op: al.created_at, al_verstuurd: true }
  }
  const naam = typeof b.naam === 'string' ? b.naam.trim().slice(0, 120) || null : null
  const merk = mailMerkVan(b.merk)
  const van = merk === 'nextgenmedia' ? EMAIL_FROM : MERK_STIJL[merk].van
  const knop = String(b.cta_text ?? '').trim().slice(0, 60) || 'Shootplan bekijken'
  const url = await maakLink(admin, s, aan, naam, door.email)
  const html = buildEmailHtml({ bodyText: tekst, ctaText: knop, ctaLink: url, merk })
  const text = buildEmailText({ bodyText: tekst, ctaText: knop, ctaLink: url, merk })
  const htmlLog = buildEmailHtml({ bodyText: tekst, ctaText: knop, ctaLink: `${basis()}/shoot/(persoonlijke link)`, merk })
  let bijlage: { filename: string; content: string; contentType: string } | null = null
  if (b.bijlage !== false) {
    try { bijlage = { filename: shootplanBestandsnaam(s), content: Buffer.from(await maakShootplanPdf(s)).toString('base64'), contentType: 'application/pdf' } } catch { bijlage = null }
  }
  const t = () => new Date().toISOString()
  let logId: string | null = null
  try {
    const { data: rij } = await admin.from('email_messages').insert({
      to_email: aan, to_client_id: s.client_id, subject: onderwerp, body: tekst, html: htmlLog, from_email: van, kind: 'shoot', audience: 'extern',
      related_id: id, verzend_sleutel: sleutel, status: 'bezig', sent_by: door.userId, sent_by_email: door.email, updated_at: t(),
    }).select('id').single()
    logId = rij?.id ?? null
  } catch { /* logboek mag het versturen niet tegenhouden */ }
  const res = await sendEmailMetAfzenderTerugval({
    to: aan, subject: onderwerp, text, html, from: merk === 'nextgenmedia' ? null : van, apiKey: resendKeyFor(merk),
    idempotencyKey: sleutel ? `shoot-${id}-${sleutel}` : null, ...(bijlage ? { attachments: [bijlage] } : {}),
  })
  if (logId) await admin.from('email_messages').update({ status: res.ok ? 'sent' : 'error', error: res.ok ? null : res.error ?? 'Onbekende fout', provider_id: res.id ?? null, updated_at: t() }).eq('id', logId)
  if (!res.ok) throw new ShootFout(res.error || 'Verzenden mislukt')
  const op = t()
  await admin.from('shoot_briefings').update({ laatst_verstuurd_op: op }).eq('id', id).then(() => null, () => null)
  return { id: logId, verstuurd_op: op }
}

