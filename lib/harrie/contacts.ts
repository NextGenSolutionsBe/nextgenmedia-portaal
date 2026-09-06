import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { stageLabel } from '@/lib/sales/stages'
import {
  blokkeer, domeinVanEmail, domeinVanWebsite, normaliseerKbo, schoonEmail, uniek,
  HARRIE_LABEL, type HarrieContact,
} from '@/lib/harrie/model'

/**
 * De lijst die Harrie ophaalt: wie mag hij benaderen, en wie niet.
 *
 * Drie bronnen, want ze staan alle drie ergens anders in deze app:
 *
 *  1. SALES_LEADS — de pipeline. Per fase instelbaar of die blokkeert.
 *  2. CLIENTS     — onze échte klanten. ALTIJD geblokkeerd, ook als ze nooit
 *                   in de pipeline gestaan hebben. Dit is de belangrijkste van
 *                   de drie: een koude wervingsmail naar een klant is het
 *                   ergste wat deze koppeling kan laten gebeuren.
 *  3. KANTOOR_BEDRIJVEN — onze eigen bedrijven en de partners waarmee we
 *                   samenwerken. Ook altijd geblokkeerd.
 *
 * Elke bron krijgt een eigen id-voorvoegsel, zodat de id's uniek zijn én
 * stabiel: Harrie onthoudt ze en stuurt ze terug bij een gebeurtenis.
 */

const PAGINA_MAX = 500

export type ContactPagina = {
  items: HarrieContact[]
  nextCursor: string | null
}

/** Instellingen: welke fases blokkeren, en waar nieuwe prospects landen. */
export async function harrieInstellingen(): Promise<{ geblokkeerdeFases: string[]; pipelineId: string | null }> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('harrie_instellingen')
    .select('geblokkeerde_fases, pipeline_id').eq('id', true).maybeSingle()
  const rij = data as { geblokkeerde_fases: string[] | null; pipeline_id: string | null } | null
  return {
    geblokkeerdeFases: rij?.geblokkeerde_fases ?? [],
    pipelineId: rij?.pipeline_id ?? null,
  }
}

/**
 * De cursor is niet meer dan "waar was ik gebleven": bron + tijdstip + id.
 * Sorteren op (updatedAt, id) maakt de volgorde stabiel, ook wanneer twintig
 * rijen exact dezelfde seconde dragen — anders zou een rij bij het volgende
 * blad kunnen ontbreken of dubbel komen.
 */
type Cursor = { bron: 'lead' | 'client' | 'kantoor'; op: string; id: string }

function leesCursor(ruw: string | null): Cursor | null {
  if (!ruw) return null
  try {
    const c = JSON.parse(Buffer.from(ruw, 'base64url').toString('utf8')) as Cursor
    if (!c || !['lead', 'client', 'kantoor'].includes(c.bron) || !c.op || !c.id) return null
    return c
  } catch {
    return null
  }
}
const schrijfCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')

/** Rij uit de pipeline → contact voor Harrie. */
type LeadRij = {
  id: string; stage_key: string; do_not_call: boolean; archived_at: string | null
  updated_at: string; assigned_to: string | null; labels: string[] | null
  sales_companies: {
    name: string; website: string | null; phone: string | null; email: string | null
    ondernemingsnummer: string | null; updated_at: string | null
  } | null
  sales_contacts: {
    name: string | null; email: string | null; phone: string | null; mobile: string | null
    updated_at: string | null
  } | null
}

function uitLead(l: LeadRij, geblokkeerdeFases: string[], naamPerId: Map<string, string>): HarrieContact {
  const b = l.sales_companies
  const c = l.sales_contacts
  const emails = uniek([schoonEmail(c?.email), schoonEmail(b?.email)])
  const domeinen = uniek([
    domeinVanWebsite(b?.website),
    ...emails.map((e) => domeinVanEmail(e)),
  ])
  // Een gearchiveerde lead telt niet meer mee: Harrie mag die weer oppakken.
  const weg = !!l.archived_at
  return {
    id: `lead_${l.id}`,
    company: b?.name ?? 'Onbekend bedrijf',
    kbo: normaliseerKbo(b?.ondernemingsnummer),
    emails,
    domains: domeinen,
    phones: uniek([c?.phone, c?.mobile, b?.phone]),
    website: b?.website ?? null,
    stage: stageLabel(l.stage_key),
    doNotContact: weg ? false : blokkeer({
      stageKey: l.stage_key, doNotCall: l.do_not_call, geblokkeerdeFases,
      vanHarrie: (l.labels ?? []).includes(HARRIE_LABEL),
    }),
    owner: l.assigned_to ? (naamPerId.get(l.assigned_to) ?? null) : null,
    // ENKEL de tijd van de lead zelf, niet die van het bedrijf of het contact.
    // Harrie onthoudt de hoogste waarde en vraagt daarmee de volgende keer
    // `updated_since`; wij filteren en sorteren op sales_leads.updated_at.
    // Stuurden we hier een nieuwere tijd uit een andere tabel, dan sloeg Harrie
    // een tijdstip op dat vóór ons filter ligt en glipten er wijzigingen langs.
    // Een databanktrigger tikt deze kolom aan zodra het bedrijf of de
    // contactpersoon verandert, dus hij loopt nooit achter.
    updatedAt: nieuwste([l.updated_at]),
    ...(weg ? { deleted: true } : {}),
  }
}

/**
 * Het laatste van een aantal tijdstippen.
 *
 * Nodig omdat een lead ook "gewijzigd" is wanneer alleen het telefoonnummer bij
 * het BEDRIJF veranderde. Zou dat niet meetellen, dan zag Harrie dat nieuwe
 * nummer pas bij de volledige ophaling van de volgende dag.
 */
function nieuwste(tijden: (string | null | undefined)[]): string {
  let max = 0
  for (const t of tijden) {
    const ms = t ? new Date(t).getTime() : NaN
    if (Number.isFinite(ms) && ms > max) max = ms
  }
  return new Date(max || Date.now()).toISOString()
}

/**
 * Eén blad contacten. De drie bronnen worden na elkaar afgelopen — eerst alle
 * leads, dan de klanten, dan de kantoorbedrijven — zodat de cursor eenvoudig
 * blijft en de volgorde altijd dezelfde is.
 */
export async function haalContacten(opties: {
  updatedSince: string | null
  cursor: string | null
  limit: number
}): Promise<ContactPagina> {
  const admin = createAdminSupabaseClient()
  const limiet = Math.min(Math.max(opties.limit || 200, 1), PAGINA_MAX)
  const { geblokkeerdeFases } = await harrieInstellingen()
  const sinds = opties.updatedSince
  const cursor = leesCursor(opties.cursor)

  // Namen van de setters, voor het veld `owner`.
  const naamPerId = new Map<string, string>()
  try {
    const { data } = await admin.from('sales_setters').select('auth_user_id, name')
    for (const s of (data ?? []) as { auth_user_id: string | null; name: string }[]) {
      if (s.auth_user_id) naamPerId.set(s.auth_user_id, s.name)
    }
  } catch { /* zonder namen werkt de rest gewoon */ }

  const items: HarrieContact[] = []
  let bron: Cursor['bron'] = cursor?.bron ?? 'lead'

  // ── 1. De pipeline ─────────────────────────────────────────────────────────
  if (bron === 'lead') {
    let q = admin.from('sales_leads')
      .select(`id, stage_key, do_not_call, archived_at, updated_at, assigned_to, labels,
        sales_companies ( name, website, phone, email, ondernemingsnummer, updated_at ),
        sales_contacts  ( name, email, phone, mobile, updated_at )`)
      .order('updated_at', { ascending: true }).order('id', { ascending: true })
      .limit(limiet + 1)
    if (sinds) q = q.gte('updated_at', sinds)
    if (cursor) q = q.or(`updated_at.gt.${cursor.op},and(updated_at.eq.${cursor.op},id.gt.${cursor.id})`)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    const rijen = (data ?? []) as unknown as LeadRij[]
    const meer = rijen.length > limiet
    for (const l of rijen.slice(0, limiet)) items.push(uitLead(l, geblokkeerdeFases, naamPerId))

    if (meer) {
      const laatste = rijen[limiet - 1]
      return { items, nextCursor: schrijfCursor({ bron: 'lead', op: laatste.updated_at, id: laatste.id }) }
    }
    bron = 'client'   // pipeline afgewerkt: door naar de klanten
  }

  // ── 2. Onze klanten — altijd geblokkeerd ───────────────────────────────────
  if (bron === 'client' && items.length < limiet) {
    const over = limiet - items.length
    let q = admin.from('clients')
      .select('id, company_name, contact_name, email, website_url, btw_nummer, archived_at, updated_at')
      .order('updated_at', { ascending: true }).order('id', { ascending: true })
      .limit(over + 1)
    if (sinds) q = q.gte('updated_at', sinds)
    if (cursor?.bron === 'client') {
      q = q.or(`updated_at.gt.${cursor.op},and(updated_at.eq.${cursor.op},id.gt.${cursor.id})`)
    }

    const { data, error } = await q
    if (error) throw new Error(error.message)
    type KlantRij = {
      id: string; company_name: string; contact_name: string | null; email: string | null
      website_url: string | null; btw_nummer: string | null; archived_at: string | null; updated_at: string
    }
    const rijen = (data ?? []) as KlantRij[]
    const meer = rijen.length > over

    for (const k of rijen.slice(0, over)) {
      const emails = uniek([schoonEmail(k.email)])
      items.push({
        id: `client_${k.id}`,
        company: k.company_name,
        kbo: normaliseerKbo(k.btw_nummer),
        emails,
        domains: uniek([domeinVanWebsite(k.website_url), ...emails.map(domeinVanEmail)]),
        phones: [],
        website: k.website_url,
        stage: k.archived_at ? 'oud-klant' : 'klant',
        // Ook een oud-klant blijft geblokkeerd: een koude wervingsmail naar
        // iemand die ons kent, leest als "ze weten niet eens wie ik ben".
        doNotContact: true,
        owner: k.contact_name,
        updatedAt: nieuwste([k.updated_at]),
      })
    }
    if (meer) {
      const laatste = rijen[over - 1]
      return { items, nextCursor: schrijfCursor({ bron: 'client', op: laatste.updated_at, id: laatste.id }) }
    }
    bron = 'kantoor'
  }

  // ── 3. Eigen bedrijven en partners uit het Kantoor ─────────────────────────
  if (bron === 'kantoor' && items.length < limiet) {
    const over = limiet - items.length
    let q = admin.from('kantoor_bedrijven')
      .select('id, naam, email, is_eigen, created_at')
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .limit(over + 1)
    if (sinds) q = q.gte('created_at', sinds)
    if (cursor?.bron === 'kantoor') {
      q = q.or(`created_at.gt.${cursor.op},and(created_at.eq.${cursor.op},id.gt.${cursor.id})`)
    }

    const { data } = await q
    type KantoorRij = { id: string; naam: string; email: string | null; is_eigen: boolean; created_at: string }
    const rijen = (data ?? []) as KantoorRij[]
    const meer = rijen.length > over

    for (const b of rijen.slice(0, over)) {
      const emails = uniek([schoonEmail(b.email)])
      items.push({
        id: `kantoor_${b.id}`,
        company: b.naam,
        kbo: null,
        emails,
        domains: uniek(emails.map(domeinVanEmail)),
        phones: [],
        website: null,
        stage: b.is_eigen ? 'eigen bedrijf' : 'partner',
        doNotContact: true,
        owner: null,
        updatedAt: nieuwste([b.created_at]),
      })
    }
    if (meer) {
      const laatste = rijen[over - 1]
      return { items, nextCursor: schrijfCursor({ bron: 'kantoor', op: laatste.created_at, id: laatste.id }) }
    }
  }

  return { items, nextCursor: null }
}
