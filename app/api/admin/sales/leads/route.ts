import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { createLead, getOrCreateSalesOrg } from '@/lib/sales/service'
import { listPipelines, defaultPipelineId } from '@/lib/sales/pipelines'
import { normalizePhone, looksLikePhone } from '@/lib/sales/dedupe'

export const dynamic = 'force-dynamic'

type LeadRow = {
  id: string; stage_key: string; labels: string[]; callback_at: string | null
  callback_note?: string | null
  archived_at: string | null; do_not_call: boolean; assigned_to: string | null
  updated_at: string; lost_reason: string | null; email_brief: string | null
  pipeline_id: string | null
  sales_companies: {
    id: string; name: string; website: string | null; sector: string | null
    city: string | null; region: string | null; phone: string | null
    email?: string | null; werkklasse?: string | null; activiteit?: string | null
    ondernemingsnummer?: string | null; prioriteit?: string | null
    linkedin?: string | null; employees?: number | null
  } | null
  sales_contacts: { id: string; name: string | null; email: string | null; phone: string | null; mobile: string | null; phone_digits: string | null; role: string | null; linkedin?: string | null } | null
}

// De volledige selectie mét de kolommen uit de migratie, en de smalle variant
// als terugval zolang die migratie nog niet gedraaid is — anders blijft het
// hele scherm leeg met een stille kolomfout.
const SELECT_BREED = `id, stage_key, labels, callback_at, callback_note, archived_at, do_not_call, assigned_to, updated_at, lost_reason, email_brief, pipeline_id,
  sales_companies ( id, name, website, sector, city, region, phone, email, werkklasse, activiteit, ondernemingsnummer, prioriteit, linkedin, employees ),
  sales_contacts  ( id, name, email, phone, mobile, phone_digits, role, linkedin )`
const SELECT_SMAL = `id, stage_key, labels, callback_at, archived_at, do_not_call, assigned_to, updated_at, lost_reason, email_brief, pipeline_id,
  sales_companies ( id, name, website, sector, city, region, phone ),
  sales_contacts  ( id, name, email, phone, mobile, phone_digits, role )`

// GET — alle leads uit de algemene pipeline, met zoeken en filters (§4).
// Zoeken matcht op bedrijf, contactpersoon, e-mail én telefoon (cijfer-
// genormaliseerd, zodat +32470…, 0470… en 470… allemaal hetzelfde vinden).
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sp = req.nextUrl.searchParams
    const salesClientId = (await getOrCreateSalesOrg()).id

    // Welk merk? Enkel een pipeline die echt van ons is telt; een onbekend id
    // valt terug op de standaard i.p.v. stilletjes alles te tonen.
    // 'all' bestaat voor de leadkiezer bij het boeken: daar moet je een lead
    // uit beide merken kunnen aanduiden.
    const pipelines = await listPipelines()
    const wanted = sp.get('pipeline') ?? ''
    const allPipelines = wanted === 'all'
    const pipelineId = pipelines.find((p) => p.id === wanted)?.id ?? pipelines[0]?.id ?? ''

    const admin = createAdminSupabaseClient()
    const bouw = (selectie: string, van: number, tot: number) => {
      let q = admin
        .from('sales_leads')
        .select(selectie, { count: 'exact' })
        .eq('sales_client_id', salesClientId)
        .order('updated_at', { ascending: false })
        // Stabiele tweede sortering: updated_at is bij een verse import voor
        // duizenden rijen identiek, en zonder tiebreaker kan dezelfde rij dan
        // in twee pagina's opduiken terwijl een andere nooit langskomt.
        .order('id', { ascending: true })
        .range(van, tot)

      if (!allPipelines) q = q.eq('pipeline_id', pipelineId)

      // Archief staat standaard uit: gearchiveerde leads zijn zacht verwijderd.
      if (sp.get('archived') === '1') q = q.not('archived_at', 'is', null)
      else q = q.is('archived_at', null)

      const stage = sp.get('stage')
      if (stage) q = q.eq('stage_key', stage)
      if (sp.get('hideDnc') === '1') q = q.eq('do_not_call', false)
      return q
    }

    /**
     * In pagina's ophalen. PostgREST kapt ELKE query af op 1000 rijen — een
     * hogere `limit` helpt niet, die grens staat aan de serverkant. Met 2670
     * leads kreeg je er dus stilletjes 1000, en de rest bestond niet voor de
     * pipeline én niet voor Focus Mode. Vandaar `range` tot alles binnen is.
     */
    const PAGINA = 1000
    const MAX_LEADS = 20_000        // vangnet tegen een oneindige lus
    let rows: LeadRow[] = []
    let totaal = 0
    let selectie = SELECT_BREED

    for (let van = 0; van < MAX_LEADS; van += PAGINA) {
      let { data, error, count } = await bouw(selectie, van, van + PAGINA - 1)
      // Kolommen uit de migratie ontbreken nog? Eén keer terugvallen op de
      // smalle selectie en deze pagina opnieuw ophalen.
      if (error && /callback_note|werkklasse|activiteit|ondernemingsnummer|prioriteit|column/i.test(error.message)) {
        selectie = SELECT_SMAL
        ;({ data, error, count } = await bouw(selectie, van, van + PAGINA - 1))
      }
      if (error) throw new Error(error.message)
      const stuk = (data ?? []) as unknown as LeadRow[]
      if (count !== null && count !== undefined) totaal = count
      rows.push(...stuk)
      if (stuk.length < PAGINA) break
    }

    if (totaal === 0) totaal = rows.length
    const afgekapt = totaal > rows.length

    // Vrij zoeken doen we in code: telefoon moet cijfer-genormaliseerd matchen
    // en dat kan een gewone SQL-ilike niet betrouwbaar.
    const search = (sp.get('q') ?? '').trim()
    if (search) {
      const needle = search.toLowerCase()
      const digits = normalizePhone(search)
      const phoneSearch = looksLikePhone(search) && digits.length >= 3
      rows = rows.filter((r) => {
        if (phoneSearch) {
          const cands = [r.sales_contacts?.phone_digits, normalizePhone(r.sales_contacts?.phone), normalizePhone(r.sales_contacts?.mobile), normalizePhone(r.sales_companies?.phone)]
          if (cands.some((c) => c && c.includes(digits))) return true
        }
        return [r.sales_companies?.name, r.sales_contacts?.name, r.sales_contacts?.email]
          .some((v) => (v ?? '').toLowerCase().includes(needle))
      })
    }

    // Overige filters (combineerbaar).
    const sector = sp.get('sector'); if (sector) rows = rows.filter((r) => r.sales_companies?.sector === sector)
    const city = sp.get('city');     if (city) rows = rows.filter((r) => r.sales_companies?.city === city)
    const region = sp.get('region'); if (region) rows = rows.filter((r) => r.sales_companies?.region === region)
    const label = sp.get('label');   if (label) rows = rows.filter((r) => (r.labels ?? []).includes(label))
    if (sp.get('hasPhone') === '1') rows = rows.filter((r) => !!(r.sales_contacts?.phone || r.sales_contacts?.mobile || r.sales_companies?.phone))
    if (sp.get('hasEmail') === '1') rows = rows.filter((r) => !!r.sales_contacts?.email)
    if (sp.get('hasWebsite') === '1') rows = rows.filter((r) => !!r.sales_companies?.website)
    if (sp.get('callbackToday') === '1') {
      const end = new Date(); end.setHours(23, 59, 59, 999)
      rows = rows.filter((r) => r.callback_at && new Date(r.callback_at).getTime() <= end.getTime())
    }

    return NextResponse.json({ leads: rows, totaal, afgekapt })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuwe lead (manueel). Ontdubbelt op bedrijf binnen de pipeline.
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const salesClientId = (await getOrCreateSalesOrg()).id

    const pipelines = await listPipelines()
    const pipelineId = pipelines.find((p) => p.id === String(b.pipelineId ?? ''))?.id
      ?? await defaultPipelineId()

    const res = await createLead({
      salesClientId,
      pipelineId,
      company: {
        name: String(b.company?.name ?? ''),
        website: b.company?.website, sector: b.company?.sector,
        employees: b.company?.employees ? Number(b.company.employees) : undefined,
        city: b.company?.city, region: b.company?.region, country: b.company?.country,
        phone: b.company?.phone, linkedin: b.company?.linkedin,
      },
      contact: {
        name: b.contact?.name, role: b.contact?.role, email: b.contact?.email,
        phone: b.contact?.phone, mobile: b.contact?.mobile, linkedin: b.contact?.linkedin,
      },
      labels: Array.isArray(b.labels) ? b.labels : [],
    })
    if (!res.ok) return NextResponse.json({ error: res.error, existingLeadId: res.existingLeadId }, { status: 409 })
    return NextResponse.json({ ok: true, id: res.leadId })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
