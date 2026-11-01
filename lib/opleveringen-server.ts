import 'server-only'
import { baseUrl, sendEmail } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { INFO_ADRES } from '@/lib/meetings/meeting-mail'
import {
  opleveringStatus, actieveVersie, revisieStand, versieLabel, beschikbaarheid, tijdLabel,
  type Versie, type Feedback, type FeedbackPunt, type OpleveringStatus,
} from '@/lib/opleveringen'

// Video-opleveringen (server). De bestanden gaan nooit door een Vercel-functie:
// opladen gebeurt rechtstreeks vanuit de browser naar de opslag (met een
// ondertekende link, hervatbaar) en kijken of downloaden met een kortlevende
// ondertekende link die pas aangemaakt wordt als iemand op de knop drukt. Zo
// blijft de app even snel, hoe groot de video ook is.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: { from: (b: string) => any } }

export const BUCKET = 'opleveringen'
const KIJK_SEC = 6 * 3600
const POSTER_SEC = 6 * 3600

export type BestandRij = {
  id: string; oplevering_id: string; versie_id: string; pad: string; poster_pad: string | null; naam: string; mimetype: string | null
  grootte: number; duur: number | null; breedte: number | null; hoogte: number | null; status: 'upload' | 'klaar'; volgorde: number
  downloads: number; laatst_gedownload_op: string | null; created_at: string
}
export type VersieRij = Versie & { oplevering_id: string; gepubliceerd_door: string | null; created_at: string }
export type OpleveringRij = {
  id: string; client_id: string; opdracht_id: string | null; titel: string; omschrijving: string | null; max_revisies: number
  gearchiveerd_op: string | null; aangemaakt_door: string | null; created_at: string; updated_at: string
}
export type FeedbackRij = Feedback & { oplevering_id: string; door_email: string | null; door_user_id: string | null }

export type OpleveringVolledig = OpleveringRij & {
  klant_naam: string | null
  status: OpleveringStatus
  versies: (VersieRij & { label: string; bestanden: (BestandRij & { poster_url: string | null })[] })[]
  feedback: FeedbackRij[]
  revisies: ReturnType<typeof revisieStand>
  actieve_versie_id: string | null
}

const stukken = <T,>(a: T[], n = 100): T[][] => { const uit: T[][] = []; for (let i = 0; i < a.length; i += n) uit.push(a.slice(i, i + n)); return uit }

/**
 * Opleveringen met versies, bestanden en feedback. `klant`: enkel voor die
 * klant, enkel gedeelde versies en volledig opgeladen bestanden (zoals de
 * klant ze ziet). Posters krijgen een ondertekende link (klein, één oproep);
 * de video's zelf niet: die link komt pas bij afspelen of downloaden.
 */
export async function laadOpleveringen(admin: Admin, o: { klant?: string; id?: string; archief?: boolean } = {}): Promise<OpleveringVolledig[]> {
  let q = admin.from('opleveringen').select('*').order('updated_at', { ascending: false }).limit(500)
  if (o.klant) q = q.eq('client_id', o.klant)
  if (o.id) q = q.eq('id', o.id)
  if (!o.archief && !o.id) q = q.is('gearchiveerd_op', null)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rijen = (data ?? []) as OpleveringRij[]
  if (!rijen.length) return []
  const ids = rijen.map((r) => r.id)
  const [{ data: vs }, { data: bs }, { data: fb }, { data: kl }] = await Promise.all([
    admin.from('oplevering_versies').select('*').in('oplevering_id', ids).order('nummer'),
    admin.from('oplevering_bestanden').select('*').in('oplevering_id', ids).order('volgorde').order('created_at'),
    admin.from('oplevering_feedback').select('*').in('oplevering_id', ids).order('created_at'),
    admin.from('clients').select('id, company_name').in('id', [...new Set(rijen.map((r) => r.client_id))]),
  ])
  const versies = (vs ?? []) as VersieRij[]
  let bestanden = (bs ?? []) as BestandRij[]
  const feedback = ((fb ?? []) as FeedbackRij[]).map((f) => ({ ...f, punten: Array.isArray(f.punten) ? f.punten : [] }))
  if (o.klant) bestanden = bestanden.filter((b) => b.status === 'klaar')
  const naam = new Map(((kl ?? []) as { id: string; company_name: string | null }[]).map((k) => [k.id, k.company_name]))

  // Posters van bestanden waarvan de versie nog beschikbaar is (of een concept voor het team).
  const zichtbaar = new Set(versies.filter((v) => !v.verwijderd_op).map((v) => v.id))
  const posterPaden = bestanden.filter((b) => b.poster_pad && zichtbaar.has(b.versie_id)).map((b) => b.poster_pad as string)
  const posterUrl = new Map<string, string>()
  for (const s of stukken(posterPaden)) {
    const { data: urls } = await admin.storage.from(BUCKET).createSignedUrls(s, POSTER_SEC)
    for (const u of (urls ?? []) as { path: string | null; signedUrl: string | null }[]) if (u.path && u.signedUrl) posterUrl.set(u.path, u.signedUrl)
  }

  return rijen.map((r) => {
    const eigenVersies = versies.filter((v) => v.oplevering_id === r.id && (!o.klant || v.gepubliceerd_op))
    const eigenFeedback = feedback.filter((f) => f.oplevering_id === r.id)
    const actief = actieveVersie(eigenVersies, eigenFeedback)
    return {
      ...r,
      klant_naam: naam.get(r.client_id) ?? null,
      status: opleveringStatus(eigenVersies, eigenFeedback),
      versies: eigenVersies.map((v) => ({
        ...v, label: versieLabel(v),
        bestanden: bestanden.filter((b) => b.versie_id === v.id).map((b) => ({ ...b, poster_url: b.poster_pad ? posterUrl.get(b.poster_pad) ?? null : null })),
      })),
      feedback: eigenFeedback,
      revisies: revisieStand(eigenFeedback, r.max_revisies),
      actieve_versie_id: actief?.id ?? null,
    }
  })
}

/** Ondertekende link om te kijken (stream) of te downloaden (met de echte bestandsnaam). */
export async function tekenBestand(admin: Admin, b: Pick<BestandRij, 'pad' | 'naam'>, download: boolean): Promise<string> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(b.pad, KIJK_SEC, download ? { download: b.naam } : undefined)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Link maken mislukt')
  return data.signedUrl as string
}

/**
 * Opruimen (scheduler): bestanden van versies die langer dan 3 dagen gedeeld
 * zijn uit de opslag halen, en uploads die na een dag nog niet klaar zijn.
 * Versies, namen en feedback blijven bewaard; de miniaturen ook (klein).
 */
export async function ruimOpleveringenOp(admin: Admin, nu: Date = new Date()): Promise<{ versies: number; bestanden: number; uploads: number }> {
  const { data: vs } = await admin.from('oplevering_versies').select('id').is('verwijderd_op', null).not('verloopt_op', 'is', null).lt('verloopt_op', nu.toISOString()).limit(200)
  const verlopen = ((vs ?? []) as { id: string }[]).map((v) => v.id)
  let bestanden = 0
  if (verlopen.length) {
    const { data: bs } = await admin.from('oplevering_bestanden').select('pad').in('versie_id', verlopen)
    const paden = ((bs ?? []) as { pad: string }[]).map((b) => b.pad)
    for (const s of stukken(paden)) { const { error } = await admin.storage.from(BUCKET).remove(s); if (!error) bestanden += s.length }
    await admin.from('oplevering_versies').update({ verwijderd_op: nu.toISOString() }).in('id', verlopen)
  }
  // Uploads die na 24 uur nog niet afgerond zijn: weg (bestand en rij).
  const { data: oud } = await admin.from('oplevering_bestanden').select('id, pad, poster_pad').eq('status', 'upload').lt('created_at', new Date(nu.getTime() - 86_400_000).toISOString()).limit(200)
  const hangend = (oud ?? []) as { id: string; pad: string; poster_pad: string | null }[]
  if (hangend.length) {
    await admin.storage.from(BUCKET).remove(hangend.flatMap((b) => [b.pad, b.poster_pad].filter(Boolean) as string[])).catch(() => null)
    await admin.from('oplevering_bestanden').delete().in('id', hangend.map((b) => b.id))
  }
  return { versies: verlopen.length, bestanden, uploads: hangend.length }
}

/** Alle bestanden van een oplevering (of één versie) uit de opslag halen. */
export async function wisBestanden(admin: Admin, filter: { oplevering_id?: string; versie_id?: string; id?: string }): Promise<void> {
  let q = admin.from('oplevering_bestanden').select('pad, poster_pad')
  if (filter.id) q = q.eq('id', filter.id)
  else if (filter.versie_id) q = q.eq('versie_id', filter.versie_id)
  else if (filter.oplevering_id) q = q.eq('oplevering_id', filter.oplevering_id)
  else return
  const { data } = await q
  const paden = ((data ?? []) as { pad: string; poster_pad: string | null }[]).flatMap((b) => [b.pad, b.poster_pad].filter(Boolean) as string[])
  for (const s of stukken(paden)) await admin.storage.from(BUCKET).remove(s).catch(() => null)
}

/** Interne melding naar info@ als de klant feedback geeft of goedkeurt. Nooit een mail naar de klant. */
export async function meldFeedbackAanTeam(o: { oplevering: Pick<OpleveringRij, 'id' | 'titel'>; klant: string; versie: Pick<Versie, 'nummer' | 'is_finaal'>; soort: Feedback['soort']; ronde: number | null; tekst: string | null; punten: FeedbackPunt[]; door: string; feedbackId: string }): Promise<void> {
  const titel = o.soort === 'goedkeuring' ? 'Goedgekeurd' : o.soort === 'revisie' ? `Revisieronde ${o.ronde}` : 'Opmerking'
  const regels = [
    `${o.klant} · ${o.oplevering.titel} · ${versieLabel(o.versie)}`,
    `${titel} door ${o.door}.`,
    o.tekst ? `\n${o.tekst}` : '',
    ...o.punten.map((p) => `• ${p.tijd !== null ? `${tijdLabel(p.tijd)} – ` : ''}${p.tekst}`),
  ].filter(Boolean)
  const link = `${baseUrl()}/admin/opleveringen?oplevering=${o.oplevering.id}`
  const opts = { bodyText: regels.join('\n'), ctaText: 'Oplevering openen', ctaLink: link }
  await sendEmail({
    to: INFO_ADRES, subject: `${titel}: ${o.oplevering.titel} – ${o.klant}`,
    text: buildEmailText(opts), html: buildEmailHtml(opts), idempotencyKey: `oplevering-feedback-${o.feedbackId}`,
  }).catch(() => null)
}

export { beschikbaarheid }
