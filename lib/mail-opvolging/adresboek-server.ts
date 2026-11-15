import 'server-only'
import { kolomVan } from '@/lib/opdrachten-kanban'
import { ALGEMENE_DOMEINEN, EIGEN_DOMEINEN, domeinUitWebsite, domeinVan, normEmail, type Adresboek, type Koppeling } from './regels'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

/** Fasen waarin een project opgevolgd wordt. */
export const ACTIEVE_KOLOMMEN = new Set(['potentieel', 'offerte', 'geaccepteerd', 'contract'])

export type ActiefProject = { id: string; client_id: string | null; lead_id: string | null; status: string; kolom: string; updated_at: string; titel: string; klant: string | null }

/**
 * Wie kennen we? E-mailadressen van klanten, hun gebruikers, wie een contract
 * tekende, wie een offerte kreeg, wie op een meeting kwam, leads en
 * account-based-marketingbedrijven. Plus het domein van de klant (enkel een
 * eigen bedrijfsdomein, nooit gmail.com en co). Enkel mails met iemand uit dit
 * adresboek worden bewaard.
 */
export async function laadAdresboek(admin: Admin): Promise<Adresboek & { projecten: ActiefProject[] }> {
  const veilig = async <T,>(p: PromiseLike<{ data: T[] | null; error?: unknown }>): Promise<T[]> => { try { return (await p).data ?? [] } catch { return [] } }
  const [klanten, gebruikers, contracten, offertes, meetings, opdrachten, afspraken, abm] = await Promise.all([
    veilig(admin.from('clients').select('id, company_name, email, facturatie_email, website_url, archived_at').limit(5000)),
    veilig(admin.from('client_users').select('client_id, email').limit(10000)),
    veilig(admin.from('contracts').select('client_id, signer_email').not('signer_email', 'is', null).limit(10000)),
    veilig(admin.from('offertes').select('client_id, opdracht_id, ontvanger_email').not('ontvanger_email', 'is', null).limit(10000)),
    veilig(admin.from('klant_meetings').select('client_id, project_id, lead_id, klant_ontvangers').limit(5000)),
    veilig(admin.from('opdrachten').select('id, client_id, lead_id, status, updated_at, titel, klant_vrij').limit(5000)),
    veilig(admin.from('sales_appointments').select('lead_id, attendee_email').not('attendee_email', 'is', null).limit(10000)),
    veilig(admin.from('abm_bedrijven').select('email, website, client_id, opdracht_id').limit(5000)),
  ]) as [
    { id: string; company_name: string; email: string | null; facturatie_email: string | null; website_url: string | null; archived_at: string | null }[],
    { client_id: string; email: string | null }[],
    { client_id: string | null; signer_email: string | null }[],
    { client_id: string | null; opdracht_id: string | null; ontvanger_email: string | null }[],
    { client_id: string | null; project_id: string | null; lead_id: string | null; klant_ontvangers: { email?: string }[] | null }[],
    { id: string; client_id: string | null; lead_id: string | null; status: string; updated_at: string; titel: string; klant_vrij: string | null }[],
    { lead_id: string | null; attendee_email: string | null }[],
    { email: string | null; website: string | null; client_id: string | null; opdracht_id: string | null }[],
  ]

  const naam = new Map(klanten.map((k) => [k.id, k.company_name]))
  const opdrachtVanLead = new Map(opdrachten.filter((o) => o.lead_id).map((o) => [o.lead_id as string, o.id]))
  const adressen = new Map<string, Koppeling>()
  const zet = (email: unknown, k: Koppeling) => {
    const e = normEmail(email)
    if (!e || EIGEN_DOMEINEN.includes(e.split('@')[1])) return
    const al = adressen.get(e)
    // Een klant gaat voor een los project; een project vult een klant aan.
    if (!al) adressen.set(e, k)
    else adressen.set(e, { client_id: al.client_id ?? k.client_id, opdracht_id: al.opdracht_id ?? k.opdracht_id })
  }
  for (const k of klanten) if (!k.archived_at) { zet(k.email, { client_id: k.id, opdracht_id: null }); zet(k.facturatie_email, { client_id: k.id, opdracht_id: null }) }
  for (const g of gebruikers) zet(g.email, { client_id: g.client_id, opdracht_id: null })
  for (const c of contracten) if (c.client_id) zet(c.signer_email, { client_id: c.client_id, opdracht_id: null })
  for (const o of offertes) zet(o.ontvanger_email, { client_id: o.client_id, opdracht_id: o.opdracht_id })
  for (const m of meetings) for (const r of m.klant_ontvangers ?? []) zet(r?.email, { client_id: m.client_id, opdracht_id: m.project_id ?? (m.lead_id ? opdrachtVanLead.get(m.lead_id) ?? null : null) })
  for (const a of afspraken) if (a.lead_id && opdrachtVanLead.get(a.lead_id)) zet(a.attendee_email, { client_id: null, opdracht_id: opdrachtVanLead.get(a.lead_id) as string })
  for (const b of abm) if (b.client_id || b.opdracht_id) zet(b.email, { client_id: b.client_id, opdracht_id: b.opdracht_id })

  // Domeinen: enkel als één klant dat domein heeft (anders weten we niet wie).
  const kandidaat = new Map<string, Set<string>>()
  const domein = (d: string | null, client: string | null) => {
    if (!d || !client || ALGEMENE_DOMEINEN.has(d) || EIGEN_DOMEINEN.some((x) => d === x || d.endsWith(`.${x}`))) return
    if (!kandidaat.has(d)) kandidaat.set(d, new Set())
    kandidaat.get(d)!.add(client)
  }
  for (const k of klanten) if (!k.archived_at) { domein(domeinVan(k.email), k.id); domein(domeinVan(k.facturatie_email), k.id); domein(domeinUitWebsite(k.website_url), k.id) }
  for (const g of gebruikers) domein(domeinVan(g.email), g.client_id)
  const domeinen = new Map<string, string>()
  for (const [d, s] of kandidaat) if (s.size === 1) domeinen.set(d, [...s][0])

  const projecten: ActiefProject[] = opdrachten
    .map((o) => ({ id: o.id, client_id: o.client_id, lead_id: o.lead_id, status: o.status, kolom: kolomVan(o.status), updated_at: o.updated_at, titel: o.titel, klant: o.client_id ? naam.get(o.client_id) ?? null : o.klant_vrij }))
    .filter((o) => ACTIEVE_KOLOMMEN.has(o.kolom))
  return { adressen, domeinen, projecten }
}

/** Het lopende project van een klant (het recentst bijgewerkte), voor mails die enkel aan de klant hangen. */
export function projectVanKlant(projecten: ActiefProject[]): Map<string, ActiefProject> {
  const uit = new Map<string, ActiefProject>()
  for (const p of projecten) {
    if (!p.client_id) continue
    const al = uit.get(p.client_id)
    if (!al || p.updated_at > al.updated_at) uit.set(p.client_id, p)
  }
  return uit
}
