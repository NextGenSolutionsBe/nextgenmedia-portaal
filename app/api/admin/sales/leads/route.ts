import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin, requireStaff } from '@/lib/supabase/server'
import { createLead, getOrCreateSalesOrg } from '@/lib/sales/service'
import { listPipelines, defaultPipelineId } from '@/lib/sales/pipelines'
import { listSalesMedewerkers } from '@/lib/sales/medewerkers'
import { normalizePhone, looksLikePhone } from '@/lib/sales/dedupe'
import { isStageKey, normaliseerStage, stageKeysVoor } from '@/lib/sales/stages'
import { isInboundBron, normaliseerLeadbron } from '@/lib/sales/leadbron'
import { registreerActiviteit } from '@/lib/sales/activiteiten'
import { laadOpdrachtenPerLead, voegOpdrachtToe } from '@/lib/sales/lead-opdrachten'
import { leadWaardeCents, leesOpdrachtInvoer, type OpdrachtKort } from '@/lib/sales/opdrachten-model'

export const dynamic = 'force-dynamic'

export type LeadRow = {
  id: string; stage_key: string; labels: string[]; callback_at: string | null
  callback_note?: string | null
  archived_at: string | null; do_not_call: boolean; assigned_to: string | null
  updated_at: string; created_at?: string; lost_reason: string | null; email_brief: string | null
  /** Kopie van de laatste notitie, zodat de kaart ze kan tonen. */
  laatste_notitie?: string | null; laatste_notitie_op?: string | null
  geen_gehoor_count?: number | null
  reden_code?: string | null
  warm?: boolean | null; warm_op?: string | null
  harrie?: Record<string, unknown> | null
  pipeline_id: string | null
  merken?: string[] | null
  /** Kanban-velden (na de migratie). */
  leadbron?: string | null; positie?: number | null; dienst?: string | null
  opvolgdatum?: string | null; deal_waarde_cents?: number | null
  gesloten_op?: string | null; verlies_reden?: string | null
  website_aanvraag?: Record<string, unknown> | null
  /** Opdrachten (titel + bedrag) en de afgeleide waarde van de lead. */
  opdrachten?: OpdrachtKort[]
  waarde_cents?: number
  sales_companies: {
    id: string; name: string; website: string | null; sector: string | null
    city: string | null; region: string | null; phone: string | null
    email?: string | null; werkklasse?: string | null; activiteit?: string | null
    ondernemingsnummer?: string | null; prioriteit?: string | null
    linkedin?: string | null; employees?: number | null
    gatekeeper_naam?: string | null; dmu_naam?: string | null; dmu_functie?: string | null
  } | null
  sales_contacts: { id: string; name: string | null; email: string | null; phone: string | null; mobile: string | null; phone_digits: string | null; role: string | null; linkedin?: string | null } | null
}

// De volledige selectie mét de kolommen uit de migraties, en twee smallere
// varianten als terugval zolang een migratie nog niet gedraaid is — anders
// blijft het hele bord leeg met een stille kolomfout.
const SELECT_KANBAN = `id, stage_key, labels, callback_at, callback_note, archived_at, do_not_call, assigned_to, updated_at, created_at, lost_reason, reden_code, warm, warm_op, harrie, email_brief, pipeline_id, merken, laatste_notitie, laatste_notitie_op, geen_gehoor_count,
  leadbron, positie, dienst, opvolgdatum, deal_waarde_cents, gesloten_op, verlies_reden, website_aanvraag,
  sales_companies ( id, name, website, sector, city, region, phone, email, werkklasse, activiteit, ondernemingsnummer, prioriteit, linkedin, employees, gatekeeper_naam, dmu_naam, dmu_functie ),
  sales_contacts  ( id, name, email, phone, mobile, phone_digits, role, linkedin )`
const SELECT_BREED = `id, stage_key, labels, callback_at, callback_note, archived_at, do_not_call, assigned_to, updated_at, created_at, lost_reason, reden_code, warm, warm_op, harrie, email_brief, pipeline_id, merken, laatste_notitie, laatste_notitie_op, geen_gehoor_count,
  sales_companies ( id, name, website, sector, city, region, phone, email, werkklasse, activiteit, ondernemingsnummer, prioriteit, linkedin, employees, gatekeeper_naam, dmu_naam, dmu_functie ),
  sales_contacts  ( id, name, email, phone, mobile, phone_digits, role, linkedin )`
const SELECT_SMAL = `id, stage_key, labels, callback_at, archived_at, do_not_call, assigned_to, updated_at, created_at, lost_reason, email_brief, pipeline_id,
  sales_companies ( id, name, website, sector, city, region, phone ),
  sales_contacts  ( id, name, email, phone, mobile, phone_digits, role )`

/** Vandaag als JJJJ-MM-DD in Brussel. */
function vandaagBrussel(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function plusDagen(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// GET — alle leads voor het bord, met zoeken en filters.
// Zoeken matcht op bedrijf, contactpersoon, e-mail, website én telefoon
// (cijfer-genormaliseerd, zodat +32470…, 0470… en 470… hetzelfde vinden).
export async function GET(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sp = req.nextUrl.searchParams
    const salesClientId = (await getOrCreateSalesOrg()).id

    // Eén bord voor beide merken; ?pipeline= blijft werken als filter.
    const pipelines = await listPipelines()
    const wanted = sp.get('pipeline') ?? ''
    const gekozen = pipelines.find((p) => p.id === wanted) ?? null
    const allPipelines = !gekozen
    const pipelineId = gekozen?.id ?? ''
    const pipelineKey = gekozen?.key ?? ''

    const admin = createAdminSupabaseClient()
    let metMerken = true
    let metPositie = true
    const bouw = (selectie: string, van: number, tot: number, tel: boolean) => {
      let q = admin
        .from('sales_leads')
        .select(selectie, tel ? { count: 'exact' } : undefined)
        .eq('sales_client_id', salesClientId)
      // Volgorde binnen een kolom: positie, dan recentst gewijzigd. Zo overleeft
      // een sleep een herlaad. Nieuwe kaarten (nog geen positie) bovenaan.
      // Stabiele tiebreaker op id voor de paginering.
      if (metPositie) q = q.order('positie', { ascending: true, nullsFirst: true })
      q = q.order('updated_at', { ascending: false }).order('id', { ascending: true }).range(van, tot)

      if (!allPipelines) {
        q = metMerken && pipelineKey
          ? q.or(`pipeline_id.eq.${pipelineId},merken.cs.{${pipelineKey}}`)
          : q.eq('pipeline_id', pipelineId)
      }
      if (sp.get('archived') === '1') q = q.not('archived_at', 'is', null)
      else q = q.is('archived_at', null)

      const stage = sp.get('stage')
      if (stage) q = q.in('stage_key', stageKeysVoor(normaliseerStage(stage)))
      if (sp.get('hideDnc') === '1') q = q.eq('do_not_call', false)
      return q
    }

    // In pagina's ophalen: PostgREST kapt elke query af op 1000 rijen.
    const PAGINA = 1000
    const MAX_LEADS = 20_000
    let rows: LeadRow[] = []
    let totaal = 0
    let selectie = SELECT_KANBAN

    for (let van = 0; van < MAX_LEADS; van += PAGINA) {
      const tel = van === 0
      let { data, error, count } = await bouw(selectie, van, van + PAGINA - 1, tel)
      // Kanban-kolommen ontbreken nog? Terugvallen op de bredere selectie
      // zonder positie; dan nog een keer op de smalle.
      if (error && selectie === SELECT_KANBAN && /leadbron|positie|dienst|opvolgdatum|deal_waarde|gesloten_op|verlies_reden|website_aanvraag|column/i.test(error.message)) {
        selectie = SELECT_BREED
        metPositie = false
        ;({ data, error, count } = await bouw(selectie, van, van + PAGINA - 1, tel))
      }
      if (error && /callback_note|werkklasse|activiteit|ondernemingsnummer|prioriteit|reden_code|warm|merken|harrie|column/i.test(error.message)) {
        selectie = SELECT_SMAL
        metMerken = false
        metPositie = false
        ;({ data, error, count } = await bouw(selectie, van, van + PAGINA - 1, tel))
      }
      if (error) throw new Error(error.message)
      const stuk = (data ?? []) as unknown as LeadRow[]
      if (count !== null && count !== undefined) totaal = count
      rows.push(...stuk)
      if (stuk.length < PAGINA) break
    }

    if (totaal === 0) totaal = rows.length
    const afgekapt = totaal > rows.length

    // Oude fasesleutels normaliseren zodat het bord ook vóór de migratie klopt.
    for (const r of rows) {
      r.stage_key = normaliseerStage(r.stage_key)
      r.leadbron = normaliseerLeadbron(r.leadbron)
      // Harrie-leads van vóór de leadbron-kolom herkennen aan hun label.
      if (r.leadbron === 'outbound' && (r.labels ?? []).includes('Harrie')) r.leadbron = 'harrie'
      // Oude verliesreden tonen zolang er geen nieuwe is.
      if (!r.verlies_reden && r.lost_reason && r.stage_key === 'verloren') r.verlies_reden = r.lost_reason
    }

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
        return [r.sales_companies?.name, r.sales_contacts?.name, r.sales_contacts?.email, r.sales_companies?.website, r.sales_companies?.email, r.laatste_notitie]
          .some((v) => (v ?? '').toLowerCase().includes(needle))
      })
    }

    const leadbron = sp.get('leadbron')
    if (leadbron === 'inbound') rows = rows.filter((r) => isInboundBron(r.leadbron))
    else if (leadbron === 'outbound_alle') rows = rows.filter((r) => !isInboundBron(r.leadbron))
    else if (leadbron) rows = rows.filter((r) => r.leadbron === leadbron)
    const verantwoordelijke = sp.get('verantwoordelijke')
    if (verantwoordelijke === 'niemand') rows = rows.filter((r) => !r.assigned_to)
    else if (verantwoordelijke) rows = rows.filter((r) => r.assigned_to === verantwoordelijke)
    const dienst = sp.get('dienst')
    if (dienst) rows = rows.filter((r) => (r.dienst ?? '').toLowerCase() === dienst.toLowerCase())
    const sector = sp.get('sector'); if (sector) rows = rows.filter((r) => r.sales_companies?.sector === sector)
    const label = sp.get('label');   if (label) rows = rows.filter((r) => (r.labels ?? []).includes(label))
    if (sp.get('warm') === '1') rows = rows.filter((r) => !!r.warm)

    // Opvolgdatum: vandaag / deze week / verlopen. Een terugbelmoment
    // (callback_at) telt mee als opvolgmoment als er geen datum staat.
    const opvolg = sp.get('opvolg')
    if (opvolg) {
      const vandaag = vandaagBrussel()
      const weekEind = plusDagen(vandaag, 7 - ((new Date(`${vandaag}T00:00:00Z`).getUTCDay() + 6) % 7) - 1)
      const datumVan = (r: LeadRow): string | null =>
        r.opvolgdatum ? r.opvolgdatum.slice(0, 10)
          : r.callback_at ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(r.callback_at))
            : null
      rows = rows.filter((r) => {
        const d = datumVan(r)
        if (!d) return false
        if (opvolg === 'vandaag') return d <= vandaag
        if (opvolg === 'week') return d <= weekEind
        if (opvolg === 'verlopen') return d < vandaag
        return true
      })
    }

    // Medewerkers voor "verantwoordelijke": setters en werknemers met de
    // verkoopmodule. Geen tarieven of commissies — enkel id en naam.
    const medewerkers = await listSalesMedewerkers()
    if (!medewerkers.some((m) => m.id === actor.id)) {
      medewerkers.push({ id: actor.id, naam: actor.email?.split('@')[0] ?? 'ik' })
    }
    const isAdmin = !!(await requireAdmin())

    // Opdrachten (titel + bedrag) per lead en de waarde van elke lead. Vóór de
    // migratie bestaat de tabel niet: dan is de waarde de dealwaarde.
    let opdrachtenBeschikbaar = true
    try {
      const perLead = await laadOpdrachtenPerLead(admin, new Set(rows.map((r) => r.id)))
      if (perLead === null) opdrachtenBeschikbaar = false
      for (const r of rows) {
        const lijst = perLead?.get(r.id)
        if (lijst?.length) r.opdrachten = lijst
        r.waarde_cents = leadWaardeCents({ opdrachten: lijst, deal_waarde_cents: r.deal_waarde_cents })
      }
    } catch (e) {
      console.error('[sales] opdrachten laden mislukt:', e instanceof Error ? e.message : e)
      for (const r of rows) r.waarde_cents = leadWaardeCents({ deal_waarde_cents: r.deal_waarde_cents })
    }

    // Leads die een collega NU in Focus Mode belt (slot uit sales_lead_claims).
    let bezet: Record<string, string> = {}
    try {
      const { data: claims } = await admin.from('sales_lead_claims')
        .select('lead_id, naam, auth_user_id')
        .gt('verloopt_op', new Date().toISOString())
      for (const c of (claims ?? []) as { lead_id: string; naam: string | null; auth_user_id: string }[]) {
        if (c.auth_user_id === actor.id) continue
        bezet[c.lead_id] = c.naam ?? 'een collega'
      }
    } catch { bezet = {} }

    return NextResponse.json({ leads: rows, totaal, afgekapt, medewerkers, meId: actor.id, isAdmin, bezet, opdrachtenBeschikbaar })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuwe lead (manueel of snel-toevoegen). Ontdubbelt op bedrijf.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const salesClientId = (await getOrCreateSalesOrg()).id

    const pipelines = await listPipelines()
    const pipelineId = pipelines.find((p) => p.id === String(b.pipelineId ?? ''))?.id
      ?? await defaultPipelineId()

    const stage = isStageKey(b.stage) ? b.stage : undefined
    const opvolgdatum = typeof b.opvolgdatum === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.opvolgdatum)
      ? b.opvolgdatum.slice(0, 10) : null

    // Optioneel: de eerste opdracht (titel + bedrag). Eerst controleren, zodat
    // een fout bedrag geen lead zonder opdracht achterlaat.
    const opdrachtRuw = b.opdracht && typeof b.opdracht === 'object' ? (b.opdracht as Record<string, unknown>) : null
    const metOpdracht = !!opdrachtRuw && (String(opdrachtRuw.titel ?? '').trim() !== '' || String(opdrachtRuw.bedrag ?? '').trim() !== '')
    const opdracht = metOpdracht ? leesOpdrachtInvoer(opdrachtRuw as Record<string, unknown>, true) : null
    if (opdracht && !opdracht.ok) return NextResponse.json({ error: opdracht.error }, { status: 400 })

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
      labels: Array.isArray(b.labels) ? b.labels.map(String) : [],
      leadbron: normaliseerLeadbron(b.leadbron),
      stage,
      dienst: typeof b.dienst === 'string' ? b.dienst : null,
      assignedTo: typeof b.assigned_to === 'string' && b.assigned_to ? b.assigned_to : null,
      opvolgdatum,
      actor: { id: actor.id, email: actor.email ?? null },
    })
    if (!res.ok) return NextResponse.json({ error: res.error, existingLeadId: res.existingLeadId }, { status: 409 })

    const admin = createAdminSupabaseClient()
    const notitie = String(b.note ?? '').trim()
    if (notitie) {
      await registreerActiviteit(admin, {
        leadId: res.leadId, medewerkerId: actor.id, medewerkerEmail: actor.email ?? null,
        type: 'interne_notitie', notitie,
      })
    }
    if (opvolgdatum) {
      await registreerActiviteit(admin, {
        leadId: res.leadId, medewerkerId: actor.id, medewerkerEmail: actor.email ?? null,
        type: 'opvolging', opvolgdatum,
      })
    }
    let waarschuwing: string | undefined
    if (opdracht?.ok) {
      const o = await voegOpdrachtToe(admin, {
        leadId: res.leadId,
        invoer: { ...opdracht.invoer, titel: opdracht.invoer.titel as string, bedrag_cents: opdracht.invoer.bedrag_cents ?? 0 },
        actor: { id: actor.id, email: actor.email ?? null },
      })
      if (!o.ok) waarschuwing = `Lead toegevoegd, maar de opdracht niet: ${o.error}`
    }
    return NextResponse.json({ ok: true, id: res.leadId, waarschuwing })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
