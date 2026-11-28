import 'server-only'
import { valideerEmbed } from '@/lib/embeds'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { baseUrl, sendEmailMetAfzenderTerugval, resendKeyFor } from '@/lib/email'
import { mailMerkVan, MERK_STIJL } from '@/lib/merk-mail'
import { publiekeUrl } from '@/lib/marketing-media'
import { bouwNieuwsbriefMail } from '@/lib/nieuwsbrief-mail'
import { leestijd, maakSlug, type Nieuwsbrief } from '@/lib/nieuwsbrieven'

/**
 * Nieuwsbrieven aan de serverkant: slugs, ontvangers, versturen per mail en
 * afmelden. Versturen is altijd een bewuste actie van iemand in de admin
 * (voorbeeld + bevestiging), één keer per ontvanger, en elke mail staat in het
 * E-mail Center (email_messages, soort "nieuwsbrief").
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

// ── Afmelden ─────────────────────────────────────────────────────────────────
const geheim = () => process.env.NIEUWSBRIEF_GEHEIM || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
export function afmeldToken(email: string): string {
  return createHmac('sha256', geheim()).update(`nieuwsbrief-afmelden:${email.trim().toLowerCase()}`).digest('base64url').slice(0, 32)
}
export function afmeldTokenKlopt(email: string, token: string): boolean {
  if (!geheim() || !email || !token) return false
  const a = Buffer.from(afmeldToken(email)), b = Buffer.from(String(token))
  return a.length === b.length && timingSafeEqual(a, b)
}
export const afmeldLink = (email: string) => `${baseUrl()}/nieuwsbrief/afmelden?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${afmeldToken(email)}`
export const appLink = (slug: string) => `${baseUrl()}/portal/nieuws/${encodeURIComponent(slug)}`

// ── Slug ─────────────────────────────────────────────────────────────────────
export async function uniekeSlug(admin: Admin, titel: string, behalve?: string): Promise<string> {
  const basis = maakSlug(titel)
  for (let i = 0; i < 50; i++) {
    const kandidaat = i === 0 ? basis : `${basis}-${i + 1}`
    let q = admin.from('nieuwsbrieven').select('id').eq('slug', kandidaat)
    if (behalve) q = q.neq('id', behalve)
    const { data } = await q.maybeSingle()
    if (!data) return kandidaat
  }
  return `${basis}-${Date.now().toString(36)}`
}

/** Voor de feed en de editor: met coverlink en leestijd. */
// Een opgeslagen embed opnieuw nakijken voor hij naar de browser gaat.
export const metExtra = (n: Nieuwsbrief) => ({ ...n, cover_embed: valideerEmbed(n.cover_embed), cover_url: publiekeUrl(n.cover_pad), leestijd: leestijd(n) })

// ── Ontvangers ───────────────────────────────────────────────────────────────
export type Ontvanger = { email: string; naam: string | null; klant: string; client_id: string; bron: 'klant' | 'gebruiker'; afgemeld: boolean; al_verstuurd: boolean }

/** Alle actieve klanten met een e-mailadres, plus hun actieve portaalgebruikers. Eén keer per adres. */
export async function ontvangers(admin: Admin, nieuwsbriefId: string): Promise<Ontvanger[]> {
  const [{ data: klanten }, { data: gebruikers }, { data: afgemeld }, { data: verstuurd }] = await Promise.all([
    admin.from('clients').select('id, company_name, contact_name, email').is('archived_at', null).not('email', 'is', null).limit(5000),
    admin.from('client_users').select('client_id, name, email, active').eq('active', true).not('email', 'is', null).limit(10000),
    admin.from('nieuwsbrief_afmeldingen').select('email').limit(20000),
    admin.from('nieuwsbrief_verzendingen').select('email, status').eq('nieuwsbrief_id', nieuwsbriefId).limit(20000),
  ])
  const naam = new Map(((klanten ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
  const weg = new Set(((afgemeld ?? []) as { email: string }[]).map((r) => r.email.toLowerCase()))
  const al = new Set(((verstuurd ?? []) as { email: string; status: string }[]).filter((r) => r.status === 'verstuurd').map((r) => r.email.toLowerCase()))
  const uit = new Map<string, Ontvanger>()
  const voeg = (email: string | null, o: Omit<Ontvanger, 'email' | 'afgemeld' | 'al_verstuurd'>) => {
    const e = String(email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || uit.has(e)) return
    uit.set(e, { email: e, ...o, afgemeld: weg.has(e), al_verstuurd: al.has(e) })
  }
  for (const k of (klanten ?? []) as { id: string; company_name: string; contact_name: string | null; email: string | null }[]) voeg(k.email, { naam: k.contact_name, klant: k.company_name, client_id: k.id, bron: 'klant' })
  for (const g of (gebruikers ?? []) as { client_id: string; name: string | null; email: string | null }[]) if (naam.has(g.client_id)) voeg(g.email, { naam: g.name, klant: naam.get(g.client_id)!, client_id: g.client_id, bron: 'gebruiker' })
  return [...uit.values()].sort((a, b) => a.klant.localeCompare(b.klant, 'nl') || a.email.localeCompare(b.email))
}

// ── Versturen ────────────────────────────────────────────────────────────────
export type VerzendResultaat = { verstuurd: number; overgeslagen: number; mislukt: { email: string; fout: string }[] }

/**
 * Verstuurt de nieuwsbrief naar de gekozen adressen. Nooit naar wie zich
 * afmeldde, nooit twee keer naar hetzelfde adres (unieke rij per ontvanger +
 * idempotentiesleutel bij Resend). Max. 500 adressen per keer.
 */
export async function verstuurNieuwsbrief(admin: Admin, n: Nieuwsbrief, emails: string[], door: { userId: string | null; email: string | null; naam: string }): Promise<VerzendResultaat> {
  const lijst = await ontvangers(admin, n.id)
  const perAdres = new Map(lijst.map((o) => [o.email, o]))
  const gekozen = [...new Set(emails.map((e) => String(e).trim().toLowerCase()))].slice(0, 500)
  const res: VerzendResultaat = { verstuurd: 0, overgeslagen: 0, mislukt: [] }
  const taken = gekozen.map((e) => async () => {
    const o = perAdres.get(e)
    if (!o || o.afgemeld || o.al_verstuurd) { res.overgeslagen++; return }
    // Eerst de rij: bestaat ze al (dubbele klik, tweede tabblad), dan niet opnieuw.
    const { data: rij, error: insFout } = await admin.from('nieuwsbrief_verzendingen').insert({ nieuwsbrief_id: n.id, email: e, client_id: o.client_id, status: 'bezig', verstuurd_door: door.naam }).select('id').single()
    if (insFout) {
      if (/duplicate|unique|23505/i.test(insFout.message)) {
        // Een eerdere poging die mislukte, mag opnieuw.
        const { data: oud } = await admin.from('nieuwsbrief_verzendingen').select('id, status').eq('nieuwsbrief_id', n.id).ilike('email', e).maybeSingle()
        if (!oud || oud.status !== 'mislukt') { res.overgeslagen++; return }
        await admin.from('nieuwsbrief_verzendingen').update({ status: 'bezig', fout: null }).eq('id', oud.id)
        return verstuurEen(oud.id)
      }
      res.mislukt.push({ email: e, fout: insFout.message }); return
    }
    return verstuurEen((rij as { id: string }).id)

    async function verstuurEen(rijId: string) {
      const m = bouwNieuwsbriefMail(n, { appLink: appLink(n.slug), afmeldLink: afmeldLink(e) })
      // NextGenSolutions: eigen naam en antwoordadres; vertrekt van het hoofdadres zolang dat domein niet geverifieerd is.
      const merk = mailMerkVan(n.merk)
      const r = await sendEmailMetAfzenderTerugval({ to: e, subject: m.onderwerp, text: m.tekst, html: m.html, idempotencyKey: `nieuwsbrief-${n.id}-${e}`, from: merk === 'nextgenmedia' ? null : MERK_STIJL[merk].van, apiKey: resendKeyFor(merk) })
      await admin.from('nieuwsbrief_verzendingen').update({ status: r.ok ? 'verstuurd' : 'mislukt', resend_id: r.id ?? null, fout: r.ok ? null : (r.error ?? 'onbekend').slice(0, 300) }).eq('id', rijId)
      // In het E-mail Center, zoals elke andere mail.
      try {
        await admin.from('email_messages').insert({
          to_email: e, to_client_id: o!.client_id, subject: m.onderwerp, body: m.tekst, html: m.html, kind: 'nieuwsbrief', from_email: MERK_STIJL[merk].van, audience: 'client', trigger_type: 'manual',
          related_id: n.id, status: r.ok ? 'sent' : 'error', error: r.ok ? null : r.error ?? null, provider_id: r.id ?? null, sent_by: door.userId, sent_by_email: door.email,
          verzend_sleutel: `nieuwsbrief-${n.id}-${e}`,
        })
      } catch { /* logging mag het versturen niet breken */ }
      if (r.ok) res.verstuurd++
      else res.mislukt.push({ email: e, fout: r.error ?? 'onbekend' })
    }
  })
  // Een paar tegelijk: snel genoeg, zonder Resend te overspoelen.
  for (let i = 0; i < taken.length; i += 4) await Promise.all(taken.slice(i, i + 4).map((t) => t()))
  if (res.verstuurd) {
    const { count } = await admin.from('nieuwsbrief_verzendingen').select('id', { count: 'exact', head: true }).eq('nieuwsbrief_id', n.id).eq('status', 'verstuurd')
    await admin.from('nieuwsbrieven').update({ mail_verstuurd_op: new Date().toISOString(), mail_aantal: count ?? res.verstuurd }).eq('id', n.id)
  }
  return res
}
