import 'server-only'
import { baseUrl, sendEmail } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { INFO_ADRES } from '@/lib/meetings/meeting-mail'
import { deadlineMs } from '@/lib/sales/lead-taken'
import { clickupConfigured, maakGewoneTaak, zoekOfMaakLijst, sluitTaak, reageerOpTaak, zoekTaakMetMarker, wisOngevraagdeVervaldatum, zetToegewezene, listClickupMembers } from '@/lib/clickup'
import { veiligeFout } from '@/lib/meetings/server'
import {
  valideerAanvraag, vindType, nieuweAanvraagTitel, relevanteExperts, volleNaam, expertiseLabel, clickupNaam, clickupOmschrijving, magIntrekken,
  isStatus, STATUS, TEAM_STATUSSEN, OPEN_STATUSSEN, type AanvraagInvoer, type AanvraagSoort, type AanvraagStatus, type ExpertBron, type OfferteStatus, type Scope,
} from '@/lib/aanvragen/model'
import { BUCKET, MAX_BESTANDEN, mimeToegestaan, padVanKlant } from '@/lib/aanvragen/bestanden'

// Profielfoto's staan in dezelfde privébucket als het personeelsdossier (lib/personeel/server.ts).
const PERSONEEL_BUCKET = 'personeel'

/**
 * Aanvragen van diensten en consultancy. Eén rij per aanvraag in
 * klant_aanvragen, met bestanden apart, en een ClickUp-taak in de lijst
 * "Aanvragen" die altijd als aanvraag herkenbaar blijft (nooit als opdracht).
 * Indienen is veilig te herhalen: dezelfde aanvraag_sleutel = dezelfde aanvraag.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: { from: (b: string) => any } }

export const CLICKUP_LIJST = 'Aanvragen'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const nu = () => new Date().toISOString()
export const vandaagBrussel = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

export class AanvraagFout extends Error {
  constructor(public publiek: string, public status = 400) { super(publiek) }
}

export type AanvraagRij = {
  id: string; client_id: string; soort: AanvraagSoort; type: string; type_label: string; wat: string; briefing: string | null; aandachtspunten: string | null
  antwoorden: Record<string, unknown>; periode_van: string | null; periode_tot: string | null; voorkeursdagen: string[]; tijdstippen: string[]
  locatie: string | null; deadline: string | null; expert_id: string | null; expert_naam: string | null
  status: AanvraagStatus; status_gewijzigd_op: string | null; scope: Scope | null; scope_notitie: string | null
  toegewezen_id: string | null; toegewezen_naam: string | null; planning_datum: string | null; planning_notitie: string | null
  reden_klant: string | null; interne_notitie: string | null
  offerte_titel: string | null; offerte_pad: string | null; offerte_url: string | null; offerte_bestandsnaam: string | null; offerte_notitie: string | null
  offerte_status: OfferteStatus | null; offerte_verstuurd_op: string | null; offerte_beslist_op: string | null; offerte_beslist_door: string | null; offerte_reden: string | null
  clickup_task_id: string | null; clickup_url: string | null; clickup_status: 'wacht' | 'ok' | 'fout'; clickup_fout: string | null
  team_mail_status?: 'ok' | 'fout' | null; team_mail_fout?: string | null
  aanvraag_sleutel: string | null; ingediend_door_id: string | null; ingediend_door_email: string | null; ingediend_door_naam: string | null
  created_at: string; updated_at: string
}
export type BestandRij = { id: string; aanvraag_id: string; client_id: string; pad: string; bestandsnaam: string; mimetype: string | null; grootte: number | null; created_at: string }

/**
 * Bewaart velden op een aanvraag. Met `alsStatus` enkel als de aanvraag nog in
 * die status staat: zo wint niemand een race (klant trekt in terwijl het team
 * net aanvaardt) en overschrijft niemand een beslissing die hij niet zag.
 */
async function bewaar(admin: Admin, id: string, velden: Partial<AanvraagRij>, alsStatus?: AanvraagStatus): Promise<AanvraagRij> {
  let q = admin.from('klant_aanvragen').update({ ...velden, updated_at: nu() }).eq('id', id)
  if (alsStatus) q = q.eq('status', alsStatus)
  const { data, error } = await q.select('*').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new AanvraagFout('Deze aanvraag werd intussen aangepast. Vernieuw de pagina en probeer opnieuw.', 409)
  return data as AanvraagRij
}

async function klantNaam(admin: Admin, clientId: string): Promise<string> {
  const { data } = await admin.from('clients').select('company_name, contact_name').eq('id', clientId).maybeSingle()
  const c = data as { company_name: string | null; contact_name: string | null } | null
  return c?.company_name || c?.contact_name || 'Klant'
}

export const adminLink = (id: string) => `${baseUrl()}/admin/aanvragen?aanvraag=${id}`

// ── Experts ──────────────────────────────────────────────────────────────────

type PersoneelRij = ExpertBron & { functie: string | null; expert_rollen: string[] | null; profielfoto_pad: string | null }

async function zichtbareExperts(admin: Admin): Promise<PersoneelRij[]> {
  const { data, error } = await admin.from('personeel').select('id, voornaam, achternaam, actief, functie, expert_zichtbaar, expert_rollen, expertises, profielfoto_pad')
    .eq('actief', true).eq('expert_zichtbaar', true)
  if (error) throw new Error(error.message)
  return (data ?? []) as PersoneelRij[]
}

/** Wat de klant ziet bij "Kies jouw expert": naam, foto, rollen en de expertises die passen. */
export async function expertsVoor(admin: Admin, soort: AanvraagSoort, typeKey: string): Promise<{ id: string; naam: string; rollen: string[]; expertises: string[]; foto_url: string | null }[]> {
  const t = vindType(soort, typeKey)
  if (!t) throw new AanvraagFout('Onbekende dienst of consultancy.')
  const experts = relevanteExperts(await zichtbareExperts(admin), t)
  const paden = experts.map((e) => e.profielfoto_pad).filter((x): x is string => !!x)
  const urls = new Map<string, string>()
  if (paden.length) {
    const { data } = await admin.storage.from(PERSONEEL_BUCKET).createSignedUrls(paden, 3600)
    for (const r of (data ?? []) as { path: string | null; signedUrl: string | null }[]) if (r.path && r.signedUrl) urls.set(r.path, r.signedUrl)
  }
  return experts.map((e) => ({
    id: e.id, naam: volleNaam(e),
    rollen: (e.expert_rollen ?? []).length ? (e.expert_rollen as string[]) : e.functie ? [e.functie] : [],
    expertises: e.relevant.map(expertiseLabel),
    foto_url: e.profielfoto_pad ? urls.get(e.profielfoto_pad) ?? null : null,
  }))
}

// ── Indienen ─────────────────────────────────────────────────────────────────

export type BestandInvoer = { pad?: unknown; bestandsnaam?: unknown; mimetype?: unknown; grootte?: unknown }

export async function maakAanvraag(
  admin: Admin, clientId: string, b: AanvraagInvoer & { aanvraag_sleutel?: unknown; bestanden?: unknown },
  door: { userId: string | null; email: string | null; naam: string | null },
  o?: ActieOpties,
): Promise<{ aanvraag: AanvraagRij; herhaald: boolean }> {
  const sleutel = String(b.aanvraag_sleutel ?? '')
  if (!UUID.test(sleutel)) throw new AanvraagFout('Ongeldige aanvraag. Vernieuw de pagina en probeer opnieuw.')
  const { data: al } = await admin.from('klant_aanvragen').select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
  if (al) {
    if ((al as AanvraagRij).client_id !== clientId) throw new AanvraagFout('Ongeldige aanvraag.', 409)
    return { aanvraag: al as AanvraagRij, herhaald: true }
  }

  const v = valideerAanvraag(b, vandaagBrussel())
  if (!v.ok) throw new AanvraagFout(v.fout)
  const w = v.waarde

  // Bescherming tegen een vastgelopen knop of misbruik: hoogstens 25 open aanvragen per klant.
  const { count } = await admin.from('klant_aanvragen').select('id', { count: 'exact', head: true }).eq('client_id', clientId).in('status', OPEN_STATUSSEN)
  if ((count ?? 0) >= 25) throw new AanvraagFout('Er staan al veel open aanvragen. We nemen eerst die door; neem gerust contact op via info@nextgenmedia.be.', 429)

  // De gekozen expert moet zichtbaar zijn én passen bij deze dienst. Anders: geen voorkeur, nooit gokken.
  let expertNaam: string | null = null
  if (w.expert_id) {
    const t = vindType(w.soort, w.type)!
    const ok = relevanteExperts(await zichtbareExperts(admin), t).find((e) => e.id === w.expert_id)
    if (!ok) throw new AanvraagFout('Deze expert is niet (meer) beschikbaar voor deze aanvraag. Kies iemand anders of “Geen voorkeur”.')
    expertNaam = volleNaam(ok)
  }

  // Bestanden: enkel paden die wij voor deze klant uitgaven.
  const lijst = (Array.isArray(b.bestanden) ? b.bestanden : []) as BestandInvoer[]
  if (lijst.length > MAX_BESTANDEN) throw new AanvraagFout(`Hoogstens ${MAX_BESTANDEN} bestanden per aanvraag.`)
  const bestanden = lijst.map((x) => {
    if (!padVanKlant(x.pad, clientId)) throw new AanvraagFout('Een bestand hoort niet bij deze aanvraag. Laad het opnieuw op.')
    if (!mimeToegestaan(x.mimetype)) throw new AanvraagFout('Een bestandstype wordt niet ondersteund.')
    return { pad: x.pad, bestandsnaam: String(x.bestandsnaam ?? 'bestand').slice(0, 200), mimetype: String(x.mimetype).toLowerCase(), grootte: Number(x.grootte) || null }
  })

  const { data: rij, error } = await admin.from('klant_aanvragen').insert({
    client_id: clientId, soort: w.soort, type: w.type, type_label: w.typeLabel, wat: w.wat, briefing: w.briefing, aandachtspunten: w.aandachtspunten,
    antwoorden: w.antwoorden, periode_van: w.periode_van, periode_tot: w.periode_tot, voorkeursdagen: w.voorkeursdagen, tijdstippen: w.tijdstippen,
    locatie: w.locatie, deadline: w.deadline, expert_id: w.expert_id, expert_naam: expertNaam, status: 'ontvangen', status_gewijzigd_op: nu(),
    aanvraag_sleutel: sleutel, ingediend_door_id: door.userId, ingediend_door_email: door.email, ingediend_door_naam: door.naam,
  }).select('*').single()
  if (error) {
    if (/duplicate|unique|23505/i.test(error.message)) {
      const { data: dubbel } = await admin.from('klant_aanvragen').select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
      if (dubbel) return { aanvraag: dubbel as AanvraagRij, herhaald: true }
    }
    throw new Error(error.message)
  }
  const a = rij as AanvraagRij
  if (bestanden.length) {
    const { error: bFout } = await admin.from('klant_aanvraag_bestanden').insert(bestanden.map((x) => ({ ...x, aanvraag_id: a.id, client_id: clientId })))
    if (bFout) throw new Error(bFout.message)
  }
  // ClickUp-taak, dan de melding naar info@ (met de ClickUp-link). In de API na het antwoord.
  const afronden = async () => stapTeamMail(admin, await stapClickup(admin, a))
  if (o?.achtergrond) { o.achtergrond(afronden().catch((e) => console.error('[aanvragen:afronden]', veiligeFout(e)))); return { aanvraag: a, herhaald: false } }
  return { aanvraag: await afronden(), herhaald: false }
}

// ── ClickUp ──────────────────────────────────────────────────────────────────

/**
 * ClickUp-gebruiker van een teamlid: wat in Personeel gekoppeld is, anders op
 * e-mailadres of volledige naam. null = niet te koppelen (dan geen toegewezene).
 */
async function clickupLidVan(admin: Admin, personeelId: string | null): Promise<number | null> {
  if (!personeelId) return null
  let { data, error } = await admin.from('personeel').select('voornaam, achternaam, email, clickup_user_id').eq('id', personeelId).maybeSingle()
  if (error) ({ data } = await admin.from('personeel').select('voornaam, achternaam, email').eq('id', personeelId).maybeSingle())
  if (!data) return null
  if (data.clickup_user_id) return Number(data.clickup_user_id)
  const leden = await listClickupMembers()
  const mail = String(data.email ?? '').trim().toLowerCase()
  const naam = volleNaam(data).toLowerCase()
  return (mail ? leden.find((m) => m.email.toLowerCase() === mail)?.id : undefined) ?? leden.find((m) => m.username.toLowerCase() === naam)?.id ?? null
}

/**
 * Taak in de lijst "Aanvragen" op de gewenste datum van de klant, toegewezen
 * aan de gekozen expert (of wie het team aanduidde). Werpt nooit; de uitkomst
 * staat op de aanvraag.
 */
export async function stapClickup(admin: Admin, a: AanvraagRij): Promise<AanvraagRij> {
  if (a.clickup_status === 'ok' && a.clickup_task_id) return a
  if (!clickupConfigured()) return bewaar(admin, a.id, { clickup_status: 'fout', clickup_fout: 'ClickUp is niet gekoppeld (CLICKUP_API_KEY ontbreekt).' })
  try {
    const lijst = await zoekOfMaakLijst(CLICKUP_LIJST)
    const marker = `ngm-aanvraag:${a.id}`
    // Eerder onduidelijk afgelopen? Eerst terugzoeken: nooit een tweede taak.
    if (a.clickup_status === 'fout') {
      const al = await zoekTaakMetMarker(lijst, marker, Date.parse(a.created_at)).catch(() => null)
      if (al) return bewaar(admin, a.id, { clickup_task_id: al, clickup_url: `https://app.clickup.com/t/${al}`, clickup_status: 'ok', clickup_fout: null })
    }
    const klant = await klantNaam(admin, a.client_id)
    const { data: bs } = await admin.from('klant_aanvraag_bestanden').select('bestandsnaam').eq('aanvraag_id', a.id)
    const lid = await clickupLidVan(admin, a.toegewezen_id ?? a.expert_id).catch(() => null)
    const taak = await maakGewoneTaak(lijst, {
      naam: clickupNaam(a.soort, klant, a.type_label),
      omschrijving: clickupOmschrijving({
        ...a, klant, ingediend_door: [a.ingediend_door_naam, a.ingediend_door_email].filter(Boolean).join(' – ') || null,
        bestanden: ((bs ?? []) as { bestandsnaam: string }[]).map((x) => x.bestandsnaam),
      }, adminLink(a.id)),
      deadlineMs: a.periode_van ? deadlineMs(a.periode_van) : null, assigneeId: lid,
    })
    const x = await bewaar(admin, a.id, { clickup_task_id: taak.id, clickup_url: taak.url ?? `https://app.clickup.com/t/${taak.id}`, clickup_status: 'ok', clickup_fout: null })
    // Oudere aanvraag zonder datum: een ClickUp-automatisering zet er anders een vaste datum op.
    if (!a.periode_van) { try { await wisOngevraagdeVervaldatum(taak.id) } catch { /* bijzaak: de taak bestaat */ } }
    return x
  } catch (e) {
    return bewaar(admin, a.id, { clickup_status: 'fout', clickup_fout: veiligeFout(e) })
  }
}

/**
 * Interne melding naar info@nextgenmedia.be bij een nieuwe aanvraag (nooit naar
 * de klant). Eén keer per aanvraag (idempotentiesleutel). Werpt nooit.
 */
async function stapTeamMail(admin: Admin, a: AanvraagRij): Promise<AanvraagRij> {
  let r: { ok: boolean; error?: string }
  try {
    const klant = await klantNaam(admin, a.client_id)
    const { data: bs } = await admin.from('klant_aanvraag_bestanden').select('bestandsnaam').eq('aanvraag_id', a.id)
    const inhoud = clickupOmschrijving({
      ...a, klant, ingediend_door: [a.ingediend_door_naam, a.ingediend_door_email].filter(Boolean).join(' – ') || null,
      bestanden: ((bs ?? []) as { bestandsnaam: string }[]).map((x) => x.bestandsnaam),
    }, adminLink(a.id))
    const clickup = a.clickup_url ? `ClickUp-taak: ${a.clickup_url}` : `Let op: de ClickUp-taak kon niet aangemaakt worden (${a.clickup_fout ?? 'onbekende fout'}). Probeer opnieuw vanuit de aanvraag in de app.`
    const opts = { bodyText: `${inhoud}\n\n${clickup}`, ctaText: 'Aanvraag openen', ctaLink: adminLink(a.id) }
    r = await sendEmail({
      to: INFO_ADRES, subject: `${nieuweAanvraagTitel(a.soort)} – ${klant} – ${a.type_label}`,
      text: buildEmailText(opts), html: buildEmailHtml(opts), idempotencyKey: `aanvraag-team-${a.id}`,
    })
  } catch (e) { r = { ok: false, error: veiligeFout(e) } }
  try { return await bewaar(admin, a.id, { team_mail_status: r.ok ? 'ok' : 'fout', team_mail_fout: r.ok ? null : (r.error ?? 'onbekend').slice(0, 300) }) } catch { return a }
}

/**
 * Waar de ClickUp-stappen van een actie draaien. Zonder `achtergrond` wacht de
 * actie erop (tests, scripts). Met `achtergrond` (in de API: waitUntil) is de
 * gebruiker meteen verder en rondt ClickUp af na het antwoord. Een ClickUp-fout
 * laat een al bewaarde actie nooit mislukken.
 */
export type ActieOpties = { achtergrond?: (p: Promise<unknown>) => void }
async function inClickup(o: ActieOpties | undefined, stap: () => Promise<void>): Promise<void> {
  const p = stap().catch((e) => { console.error('[aanvragen:clickup]', veiligeFout(e)) })
  if (o?.achtergrond) o.achtergrond(p)
  else await p
}

/** ClickUp-taak op wie de aanvraag opvolgt, of anders op de gekozen expert. */
async function volgToegewezene(admin: Admin, a: AanvraagRij): Promise<void> {
  if (!a.clickup_task_id || !clickupConfigured()) return
  try { await zetToegewezene(a.clickup_task_id, await clickupLidVan(admin, a.toegewezen_id ?? a.expert_id)) } catch { /* bijzaak: de toewijzing staat in de app */ }
}

/** Een statuswissel als reactie op de taak; afgewezen, ingetrokken of afgerond sluit de taak. */
async function meldInClickup(a: AanvraagRij, tekst: string, sluit = false): Promise<void> {
  if (!a.clickup_task_id || !clickupConfigured()) return
  await reageerOpTaak(a.clickup_task_id, tekst)
  if (sluit) { try { await sluitTaak(a.clickup_task_id) } catch { /* bijzaak: de status staat in de app */ } }
}

// ── Wat de klant ziet ────────────────────────────────────────────────────────

/** Nooit interne notities, scope, ClickUp of interne planning naar de klant. */
export function klantWeergave(a: AanvraagRij, bestanden: BestandRij[]) {
  return {
    id: a.id, soort: a.soort, type: a.type, type_label: a.type_label, wat: a.wat, briefing: a.briefing, aandachtspunten: a.aandachtspunten,
    antwoorden: a.antwoorden, periode_van: a.periode_van, periode_tot: a.periode_tot, voorkeursdagen: a.voorkeursdagen, tijdstippen: a.tijdstippen,
    locatie: a.locatie, deadline: a.deadline, expert_naam: a.expert_naam,
    status: a.status, status_label: STATUS[a.status]?.klant ?? a.status, reden_klant: a.status === 'afgewezen' ? a.reden_klant : null,
    mag_intrekken: magIntrekken(a.status),
    offerte: a.offerte_status ? {
      titel: a.offerte_titel, notitie: a.offerte_notitie, status: a.offerte_status, verstuurd_op: a.offerte_verstuurd_op, beslist_op: a.offerte_beslist_op,
      heeft_bestand: !!a.offerte_pad, url: a.offerte_url,
    } : null,
    bestanden: bestanden.map((x) => ({ id: x.id, bestandsnaam: x.bestandsnaam, grootte: x.grootte })),
    ingediend_door: a.ingediend_door_naam ?? a.ingediend_door_email, created_at: a.created_at,
  }
}

export async function aanvragenVanKlant(admin: Admin, clientId: string, soort: AanvraagSoort) {
  const { data, error } = await admin.from('klant_aanvragen').select('*').eq('client_id', clientId).eq('soort', soort).order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  const rijen = (data ?? []) as AanvraagRij[]
  const bestanden = await bestandenVan(admin, rijen.map((r) => r.id))
  return rijen.map((r) => klantWeergave(r, bestanden.filter((b) => b.aanvraag_id === r.id)))
}

async function bestandenVan(admin: Admin, ids: string[]): Promise<BestandRij[]> {
  if (!ids.length) return []
  const { data } = await admin.from('klant_aanvraag_bestanden').select('*').in('aanvraag_id', ids).order('created_at', { ascending: true })
  return (data ?? []) as BestandRij[]
}

/** Eén aanvraag, enkel als ze van deze klant is. */
export async function aanvraagVanKlant(admin: Admin, clientId: string, id: string): Promise<AanvraagRij | null> {
  if (!UUID.test(id)) return null
  const { data } = await admin.from('klant_aanvragen').select('*').eq('id', id).eq('client_id', clientId).maybeSingle()
  return (data as AanvraagRij | null) ?? null
}

/** Tijdelijke link naar een bestand of de offerte (5 minuten). */
export async function tijdelijkeLink(admin: Admin, pad: string): Promise<string> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(pad, 300)
  if (error || !data?.signedUrl) throw new AanvraagFout('Het bestand kon niet geopend worden.', 404)
  return data.signedUrl as string
}

export async function bestandVanAanvraag(admin: Admin, aanvraagId: string, bestandId: string): Promise<BestandRij | null> {
  if (!UUID.test(bestandId)) return null
  const { data } = await admin.from('klant_aanvraag_bestanden').select('*').eq('id', bestandId).eq('aanvraag_id', aanvraagId).maybeSingle()
  return (data as BestandRij | null) ?? null
}

// ── Acties van de klant ──────────────────────────────────────────────────────

export async function klantBeslistOfferte(admin: Admin, a: AanvraagRij, besluit: unknown, reden: unknown, door: string, o?: ActieOpties): Promise<AanvraagRij> {
  if (besluit !== 'aanvaard' && besluit !== 'geweigerd') throw new AanvraagFout('Kies aanvaarden of weigeren.')
  if (a.offerte_status !== 'open') throw new AanvraagFout(a.offerte_status ? 'Over deze offerte is al beslist.' : 'Er is geen offerte om te beslissen.', 409)
  const r = String(reden ?? '').trim().slice(0, 1000) || null
  const x = await bewaar(admin, a.id, {
    offerte_status: besluit, offerte_beslist_op: nu(), offerte_beslist_door: door, offerte_reden: r,
    // Aanvaard: wij plannen in. Geweigerd: terug bij ons om op te volgen.
    status: besluit === 'aanvaard' ? 'aanvaard' : 'in_behandeling', status_gewijzigd_op: nu(),
  }, a.status)
  await inClickup(o, () => meldInClickup(x, besluit === 'aanvaard'
    ? `Offerte AANVAARD door ${door} via het klantportaal. Nog in te plannen.`
    : `Offerte GEWEIGERD door ${door} via het klantportaal.${r ? ` Reden: ${r}` : ''}`))
  return x
}

export async function klantTrektIn(admin: Admin, a: AanvraagRij, door: string, o?: ActieOpties): Promise<AanvraagRij> {
  if (!magIntrekken(a.status)) throw new AanvraagFout('Deze aanvraag kan je niet meer intrekken. Neem contact op via info@nextgenmedia.be.', 409)
  const x = await bewaar(admin, a.id, { status: 'ingetrokken', status_gewijzigd_op: nu() }, a.status)
  await inClickup(o, () => meldInClickup(x, `Aanvraag INGETROKKEN door ${door} via het klantportaal.`, true))
  return x
}

// ── Acties van het team ──────────────────────────────────────────────────────

export type TeamActie =
  | { actie: 'status'; status: unknown; reden_klant?: unknown }
  | { actie: 'scope'; scope: unknown; notitie?: unknown }
  | { actie: 'toewijzen'; personeel_id: unknown }
  | { actie: 'planning'; datum: unknown; notitie?: unknown }
  | { actie: 'notitie'; tekst: unknown }
  | { actie: 'offerte'; titel?: unknown; pad?: unknown; bestandsnaam?: unknown; url?: unknown; notitie?: unknown }
  | { actie: 'offerte_intrekken' }
  | { actie: 'clickup_opnieuw' }

const isDag = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export async function teamActie(admin: Admin, a: AanvraagRij, b: TeamActie, door: string, o?: ActieOpties): Promise<AanvraagRij> {
  switch (b.actie) {
    case 'status': {
      if (!isStatus(b.status) || !TEAM_STATUSSEN.includes(b.status)) throw new AanvraagFout('Onbekende status.')
      if (a.status === 'ingetrokken') throw new AanvraagFout('De klant trok deze aanvraag in.', 409)
      const reden = b.status === 'afgewezen' ? String(b.reden_klant ?? '').trim().slice(0, 1000) || null : a.reden_klant
      const st = b.status
      const x = await bewaar(admin, a.id, { status: st, status_gewijzigd_op: nu(), reden_klant: reden }, a.status)
      await inClickup(o, () => meldInClickup(x, `Status: ${STATUS[st].team} (door ${door}).${st === 'afgewezen' && reden ? ` Reden voor de klant: ${reden}` : ''}`, st === 'afgewezen' || st === 'afgerond'))
      return x
    }
    case 'scope': {
      const scope = b.scope === 'binnen' || b.scope === 'buiten' ? b.scope : null
      const x = await bewaar(admin, a.id, { scope, scope_notitie: String(b.notitie ?? '').trim().slice(0, 1000) || null })
      await inClickup(o, () => meldInClickup(x, `Scope: ${scope === 'binnen' ? 'binnen het bestaande contract' : scope === 'buiten' ? 'buiten het bestaande contract' : 'nog niet bepaald'} (door ${door}).`))
      return x
    }
    case 'toewijzen': {
      // ClickUp volgt: de taak staat op wie opvolgt, en zonder toewijzing weer op de gekozen expert.
      if (b.personeel_id === null || b.personeel_id === '') {
        const x = await bewaar(admin, a.id, { toegewezen_id: null, toegewezen_naam: null })
        await inClickup(o, () => volgToegewezene(admin, x))
        return x
      }
      if (typeof b.personeel_id !== 'string' || !UUID.test(b.personeel_id)) throw new AanvraagFout('Ongeldig teamlid.')
      const { data: p } = await admin.from('personeel').select('id, voornaam, achternaam, actief').eq('id', b.personeel_id).maybeSingle()
      if (!p || !p.actief) throw new AanvraagFout('Dit teamlid bestaat niet of is niet actief.')
      const x = await bewaar(admin, a.id, { toegewezen_id: p.id, toegewezen_naam: volleNaam(p) })
      await inClickup(o, () => volgToegewezene(admin, x))
      await inClickup(o, () => meldInClickup(x, `Opvolging bevestigd: ${volleNaam(p)} (door ${door}).`))
      return x
    }
    case 'planning': {
      if (b.datum !== null && b.datum !== '' && !isDag(b.datum)) throw new AanvraagFout('Kies een geldige datum.')
      const datum = isDag(b.datum) ? b.datum : null
      if (datum && !['aanvaard', 'ingepland'].includes(a.status)) throw new AanvraagFout('Plan een aanvraag pas in nadat ze aanvaard is (of de klant de offerte aanvaardde).', 409)
      const x = await bewaar(admin, a.id, {
        planning_datum: datum, planning_notitie: String(b.notitie ?? '').trim().slice(0, 2000) || null,
        ...(datum ? { status: 'ingepland' as const, status_gewijzigd_op: nu() } : a.status === 'ingepland' ? { status: 'aanvaard' as const, status_gewijzigd_op: nu() } : {}),
      })
      await inClickup(o, () => meldInClickup(x, datum ? `Intern ingepland op ${datum} (door ${door}).` : `Interne planning gewist (door ${door}).`))
      return x
    }
    case 'notitie':
      return bewaar(admin, a.id, { interne_notitie: String(b.tekst ?? '').trim().slice(0, 5000) || null })
    case 'offerte': {
      if (['afgewezen', 'ingetrokken', 'afgerond'].includes(a.status)) throw new AanvraagFout('Deze aanvraag is afgesloten.', 409)
      if (a.offerte_status === 'aanvaard') throw new AanvraagFout('De klant aanvaardde de offerte al.', 409)
      const pad = typeof b.pad === 'string' && b.pad.startsWith(`offertes/${a.id}/`) ? b.pad : null
      const ruwUrl = String(b.url ?? '').trim()
      let url: string | null = null
      if (ruwUrl) { try { const u = new URL(ruwUrl); if (u.protocol !== 'https:') throw new Error(); url = u.toString() } catch { throw new AanvraagFout('De offertelink moet met https:// beginnen.') } }
      if (!pad && !url) throw new AanvraagFout('Laad een offerte (PDF) op of plak een link naar de offerte.')
      const x = await bewaar(admin, a.id, {
        offerte_titel: String(b.titel ?? '').trim().slice(0, 200) || `Offerte ${a.type_label}`, offerte_pad: pad, offerte_url: pad ? null : url,
        offerte_bestandsnaam: pad ? String(b.bestandsnaam ?? 'offerte.pdf').slice(0, 200) : null, offerte_notitie: String(b.notitie ?? '').trim().slice(0, 2000) || null,
        offerte_status: 'open', offerte_verstuurd_op: nu(), offerte_beslist_op: null, offerte_beslist_door: null, offerte_reden: null,
        status: 'offerte', status_gewijzigd_op: nu(),
        // Een offerte hoort bij werk buiten de afgesproken scope.
        scope: a.scope ?? 'buiten',
      }, a.status)
      await inClickup(o, () => meldInClickup(x, `Offerte gekoppeld en zichtbaar voor de klant (door ${door}). Wacht op akkoord van de klant.`))
      return x
    }
    case 'offerte_intrekken': {
      if (a.offerte_status !== 'open') throw new AanvraagFout('Er is geen open offerte.', 409)
      const x = await bewaar(admin, a.id, { offerte_status: null, offerte_pad: null, offerte_url: null, offerte_titel: null, offerte_bestandsnaam: null, offerte_notitie: null, offerte_verstuurd_op: null, status: 'in_behandeling', status_gewijzigd_op: nu() }, a.status)
      if (a.offerte_pad) { try { await admin.storage.from(BUCKET).remove([a.offerte_pad]) } catch { /* best effort */ } }
      await inClickup(o, () => meldInClickup(x, `Offerte ingetrokken (door ${door}).`))
      return x
    }
    case 'clickup_opnieuw':
      return stapClickup(admin, a)
  }
}

// ── Overzicht voor het team ──────────────────────────────────────────────────

export async function teamOverzicht(admin: Admin, soort: AanvraagSoort | null) {
  let q = admin.from('klant_aanvragen').select('*').order('created_at', { ascending: false }).limit(300)
  if (soort) q = q.eq('soort', soort)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rijen = (data ?? []) as AanvraagRij[]
  const ids = [...new Set(rijen.map((r) => r.client_id))]
  const { data: klanten } = ids.length ? await admin.from('clients').select('id, company_name, contact_name').in('id', ids) : { data: [] }
  const naam = new Map(((klanten ?? []) as { id: string; company_name: string | null; contact_name: string | null }[]).map((k) => [k.id, k.company_name || k.contact_name || 'Klant']))
  const { data: bs } = rijen.length ? await admin.from('klant_aanvraag_bestanden').select('aanvraag_id').in('aanvraag_id', rijen.map((r) => r.id)) : { data: [] }
  const aantal = new Map<string, number>()
  for (const b of (bs ?? []) as { aanvraag_id: string }[]) aantal.set(b.aanvraag_id, (aantal.get(b.aanvraag_id) ?? 0) + 1)
  return rijen.map((r) => ({ ...r, klant: naam.get(r.client_id) ?? 'Klant', aantal_bestanden: aantal.get(r.id) ?? 0 }))
}

/** Detail met tijdelijke links, en de lopende diensten en contracten van de klant om de scope te beoordelen. */
export async function teamDetail(admin: Admin, id: string) {
  if (!UUID.test(id)) return null
  const { data } = await admin.from('klant_aanvragen').select('*').eq('id', id).maybeSingle()
  if (!data) return null
  const a = data as AanvraagRij
  const [klant, bestanden, { data: diensten }, { data: contracten }, { data: team }, { count: zelfdeMaand }] = await Promise.all([
    klantNaam(admin, a.client_id),
    bestandenVan(admin, [a.id]),
    admin.from('client_services').select('service_slug, active').eq('client_id', a.client_id).eq('active', true),
    admin.from('contracts').select('id, title, status, created_at').eq('client_id', a.client_id).order('created_at', { ascending: false }).limit(10),
    admin.from('personeel').select('id, voornaam, achternaam').eq('actief', true).order('voornaam'),
    admin.from('klant_aanvragen').select('id', { count: 'exact', head: true }).eq('client_id', a.client_id).eq('type', a.type).eq('scope', 'binnen')
      .gte('created_at', `${a.created_at.slice(0, 7)}-01T00:00:00Z`).neq('id', a.id),
  ])
  const links = new Map<string, string>()
  const paden = [...bestanden.map((b) => b.pad), ...(a.offerte_pad ? [a.offerte_pad] : [])]
  if (paden.length) {
    const { data: s } = await admin.storage.from(BUCKET).createSignedUrls(paden, 3600)
    for (const r of (s ?? []) as { path: string | null; signedUrl: string | null }[]) if (r.path && r.signedUrl) links.set(r.path, r.signedUrl)
  }
  return {
    aanvraag: { ...a, klant },
    bestanden: bestanden.map((b) => ({ ...b, url: links.get(b.pad) ?? null })),
    offerte_link: a.offerte_pad ? links.get(a.offerte_pad) ?? null : a.offerte_url,
    context: {
      diensten: ((diensten ?? []) as { service_slug: string }[]).map((d) => d.service_slug),
      contracten: (contracten ?? []) as { id: string; title: string | null; status: string | null }[],
      /** Hoeveel aanvragen van hetzelfde type al als "binnen contract" stonden in de maand van deze aanvraag. */
      binnen_scope_deze_maand: zelfdeMaand ?? 0,
    },
    team: ((team ?? []) as { id: string; voornaam: string; achternaam: string | null }[]).map((p) => ({ id: p.id, naam: volleNaam(p) })),
  }
}
