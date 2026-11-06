import 'server-only'
import { schrijfWerkmap } from '@/lib/excel/xlsx-schrijf'
import type { Werkmap, Cel, Kolom } from '@/lib/excel/spec'

/**
 * Archief van de oude verkooppipeline (2 nov 2026), vóór de pipeline opging in
 * Projecten en de koude leads verdwenen. Eén Excel met alles wat er stond:
 * leads met bedrijf en contactpersoon, de tijdlijn, activiteiten en afspraken.
 * Het bestand staat in de privébucket `archief`; enkel een admin downloadt het
 * (met een kortlevende link) via /api/admin/opdrachten/pipeline-archief.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: { from: (b: string) => any }; auth?: any }
type Rij = Record<string, unknown>

export const ARCHIEF_BUCKET = 'archief'
export const ARCHIEF_SLEUTEL = 'pipeline_archief'

const GEHEIM = /token|secret|password|wachtwoord|api_key|signature_image/i

async function alles(admin: Admin, tabel: string, select: string, orde = 'created_at'): Promise<Rij[]> {
  const uit: Rij[] = []
  for (let van = 0; van < 100_000; van += 1000) {
    const { data, error } = await admin.from(tabel).select(select).order(orde, { ascending: true }).range(van, van + 999)
    if (error) throw new Error(`${tabel}: ${error.message}`)
    const rijen = (data ?? []) as Rij[]
    uit.push(...rijen)
    if (rijen.length < 1000) break
  }
  return uit
}

const waarde = (v: unknown): Cel => {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 30_000)
  return String(v).slice(0, 30_000)
}

/** Alle kolommen die in de rijen voorkomen (behalve geheimen), in volgorde van eerste voorkomen. */
function kolommenVan(rijen: Rij[]): string[] {
  const set = new Set<string>()
  for (const r of rijen.slice(0, 2000)) for (const k of Object.keys(r)) if (!GEHEIM.test(k)) set.add(k)
  return [...set]
}

function tabel(rijen: Rij[], kolommen: string[], koppen?: Record<string, string>): { kolommen: Kolom[]; rijen: Cel[][] } {
  return {
    kolommen: kolommen.map((k) => ({ kop: koppen?.[k] ?? k })),
    rijen: rijen.map((r) => kolommen.map((k) => waarde(r[k]))),
  }
}

export async function maakPipelineArchief(admin: Admin): Promise<{ pad: string; leads: number; tijdlijn: number; activiteiten: number; afspraken: number; bytes: number }> {
  const [leads, bedrijven, contacten, pijplijnen, tijdlijn, activiteiten, afspraken] = await Promise.all([
    alles(admin, 'sales_leads', '*'),
    alles(admin, 'sales_companies', '*'),
    alles(admin, 'sales_contacts', '*'),
    alles(admin, 'sales_pipelines', 'id, key, name', 'key'),
    alles(admin, 'sales_lead_events', '*'),
    alles(admin, 'sales_activiteiten', '*'),
    alles(admin, 'sales_appointments', '*'),
  ])
  const bedrijf = new Map(bedrijven.map((b) => [String(b.id), b]))
  const contact = new Map(contacten.map((c) => [String(c.id), c]))
  const pijplijn = new Map(pijplijnen.map((p) => [String(p.id), String(p.name ?? p.key ?? '')]))

  // Verantwoordelijke: e-mail van de gebruiker in plaats van een id.
  const mails = new Map<string, string>()
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    for (const u of (data?.users ?? []) as { id: string; email?: string | null }[]) if (u.email) mails.set(u.id, u.email)
  } catch { /* zonder e-mails: dan het id */ }

  const bedrijfVelden = kolommenVan(bedrijven).filter((k) => !['id', 'sales_client_id'].includes(k))
  const contactVelden = kolommenVan(contacten).filter((k) => !['id', 'sales_client_id', 'company_id'].includes(k))
  const leadVelden = kolommenVan(leads).filter((k) => !['sales_client_id', 'company_id', 'contact_id', 'pipeline_id', 'assigned_to'].includes(k))

  const leadRijen: Rij[] = leads.map((l) => {
    const b = bedrijf.get(String(l.company_id)) ?? {}
    const c = contact.get(String(l.contact_id)) ?? {}
    const r: Rij = { pipeline: pijplijn.get(String(l.pipeline_id)) ?? null, verantwoordelijke: l.assigned_to ? mails.get(String(l.assigned_to)) ?? l.assigned_to : null }
    for (const k of bedrijfVelden) r[`bedrijf_${k}`] = b[k]
    for (const k of contactVelden) r[`contact_${k}`] = c[k]
    for (const k of leadVelden) r[k] = l[k]
    return r
  })
  const leadNaam = new Map(leads.map((l) => [String(l.id), String((bedrijf.get(String(l.company_id)) ?? {}).name ?? '')]))
  const metBedrijf = (rijen: Rij[]) => rijen.map((r) => ({ bedrijf: r.lead_id ? leadNaam.get(String(r.lead_id)) ?? null : null, ...r }))

  const leadKolommen = ['pipeline', 'verantwoordelijke', ...bedrijfVelden.map((k) => `bedrijf_${k}`), ...contactVelden.map((k) => `contact_${k}`), ...leadVelden]
  const tl = metBedrijf(tijdlijn), ac = metBedrijf(activiteiten), af = metBedrijf(afspraken)

  const werkmap: Werkmap = {
    bestandsnaam: 'pipeline-archief',
    titel: 'Oude verkooppipeline (archief)',
    bron: 'NextGenMedia Portal, vóór de overstap naar Projecten (2 november 2026)',
    bladen: [
      { naam: 'Leads', titel: `Leads (${leadRijen.length})`, toelichting: ['Alle leads met bedrijf en contactpersoon, zoals ze in de pipeline stonden.'], blokken: [{ soort: 'tabel', ...tabel(leadRijen, leadKolommen) }] },
      { naam: 'Tijdlijn', titel: `Tijdlijn en notities (${tl.length})`, blokken: [{ soort: 'tabel', ...tabel(tl, ['bedrijf', ...kolommenVan(tijdlijn)]) }] },
      { naam: 'Activiteiten', titel: `Activiteiten (${ac.length})`, blokken: [{ soort: 'tabel', ...tabel(ac, ['bedrijf', ...kolommenVan(activiteiten)]) }] },
      { naam: 'Afspraken', titel: `Afspraken (${af.length})`, blokken: [{ soort: 'tabel', ...tabel(af, ['bedrijf', ...kolommenVan(afspraken)]) }] },
    ],
  }
  const { buffer } = schrijfWerkmap(werkmap)
  const dag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  const pad = `pipeline/pipeline-archief-${dag}-${Date.now()}.xlsx`
  const { error } = await admin.storage.from(ARCHIEF_BUCKET).upload(pad, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false })
  if (error) throw new Error(`Opslaan mislukt: ${error.message}`)
  const info = { pad, op: new Date().toISOString(), leads: leadRijen.length, tijdlijn: tl.length, activiteiten: ac.length, afspraken: af.length, bytes: buffer.length }
  await admin.from('app_settings').upsert({ key: ARCHIEF_SLEUTEL, value: info, updated_at: info.op, updated_by_email: 'systeem' }, { onConflict: 'key' })
  return info
}
