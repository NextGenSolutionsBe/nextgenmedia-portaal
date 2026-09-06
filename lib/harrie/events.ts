import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { createLead, getOrCreateSalesOrg, logLeadEvent } from '@/lib/sales/service'
import { listPipelines } from '@/lib/sales/pipelines'
import { normalizePhone, companyDedupeKey } from '@/lib/sales/dedupe'
import { harrieInstellingen } from '@/lib/harrie/contacts'
import {
  gevolgVan, isHarrieType, normaliseerKbo, schoonEmail, HARRIE_LABEL, type HarrieType,
} from '@/lib/harrie/model'

/**
 * Wat Harrie meldt, verwerken in onze pipeline.
 *
 * De regel die alles bij elkaar houdt: één gebeurtenis mag maar één keer
 * landen. Harrie houdt een uitbox bij en probeert opnieuw als de verbinding
 * wegviel, dus dezelfde melding kán twee keer aankomen. De `idempotencyKey` is
 * uniek in de databank; de tweede poging botst daarop en krijgt 409, wat Harrie
 * als "geslaagd" beschouwt.
 */

export type HarrieProspect = {
  harrieId?: number | string | null
  pipelineRef?: string | null
  company?: string | null
  name?: string | null
  firstName?: string | null
  role?: string | null
  email?: string | null
  phone?: string | null
  kbo?: string | null
  city?: string | null
  sector?: string | null
  linkedinUrl?: string | null
  source?: string | null
  status?: string | null
  channel?: string | null
}

export type Uitkomst =
  | { ok: true; status: 200 | 201; leadId: string | null; resultaat: string }
  | { ok: false; status: 400 | 409 | 500; fout: string }

const tekst = (v: unknown, max = 300): string | null => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

/**
 * De lead zoeken waar deze gebeurtenis bij hoort.
 *
 * Volgorde van zekerheid, precies zoals in het contract: het e-mailadres van de
 * contactpersoon is het hardste bewijs, dan het ondernemingsnummer, dan het
 * algemene adres van het bedrijf, en pas als laatste de bedrijfsnaam. Die
 * laatste stap gebruikt dezelfde ontdubbelsleutel als de rest van de app, zodat
 * "Acme BV" en "acme bvba" op hetzelfde dossier uitkomen.
 */
async function zoekLead(p: HarrieProspect, pipelineId: string): Promise<string | null> {
  const admin = createAdminSupabaseClient()
  const email = schoonEmail(p.email)
  const kbo = normaliseerKbo(p.kbo)

  const leadVanBedrijf = async (companyId: string): Promise<string | null> => {
    const { data } = await admin.from('sales_leads').select('id')
      .eq('company_id', companyId).eq('pipeline_id', pipelineId)
      .is('archived_at', null).limit(1).maybeSingle()
    return (data as { id: string } | null)?.id ?? null
  }

  // 1. Contactpersoon met dit e-mailadres.
  if (email) {
    const { data: contacten } = await admin.from('sales_contacts')
      .select('id, company_id').ilike('email', email).limit(10)
    for (const c of (contacten ?? []) as { id: string; company_id: string }[]) {
      const lead = await leadVanBedrijf(c.company_id)
      if (lead) return lead
    }
  }

  // 2. Ondernemingsnummer. In de databank staat het in wisselende notaties,
  //    dus we halen de kandidaten op en vergelijken genormaliseerd.
  if (kbo) {
    const kaal = kbo.replace(/^0/, '')
    const { data: bedrijven } = await admin.from('sales_companies')
      .select('id, ondernemingsnummer')
      .not('ondernemingsnummer', 'is', null)
      .ilike('ondernemingsnummer', `%${kaal}%`).limit(20)
    for (const b of (bedrijven ?? []) as { id: string; ondernemingsnummer: string }[]) {
      if (normaliseerKbo(b.ondernemingsnummer) !== kbo) continue
      const lead = await leadVanBedrijf(b.id)
      if (lead) return lead
    }
  }

  // 3. Algemeen adres van het bedrijf.
  if (email) {
    const { data: bedrijven } = await admin.from('sales_companies')
      .select('id').ilike('email', email).limit(10)
    for (const b of (bedrijven ?? []) as { id: string }[]) {
      const lead = await leadVanBedrijf(b.id)
      if (lead) return lead
    }
  }

  // 4. Bedrijfsnaam, via de ontdubbelsleutel van de app.
  const naam = tekst(p.company, 200)
  if (naam) {
    const org = await getOrCreateSalesOrg()
    const { data: b } = await admin.from('sales_companies').select('id')
      .eq('sales_client_id', org.id)
      .eq('dedupe_key', companyDedupeKey(naam, null)).maybeSingle()
    if (b) {
      const lead = await leadVanBedrijf((b as { id: string }).id)
      if (lead) return lead
    }
  }

  return null
}

/** In welke pipeline landen prospects van Harrie? */
async function doelPipeline(): Promise<string | null> {
  const { pipelineId } = await harrieInstellingen()
  if (pipelineId) return pipelineId
  const pipelines = await listPipelines()
  // Zonder keuze: NextGenMedia, want daar draait de acquisitie op.
  return pipelines.find((p) => p.key === 'nextgenmedia')?.id ?? pipelines[0]?.id ?? null
}

export async function verwerkGebeurtenis(body: {
  idempotencyKey?: unknown
  type?: unknown
  at?: unknown
  prospect?: HarrieProspect
  detail?: unknown
}): Promise<Uitkomst> {
  const sleutel = tekst(body.idempotencyKey, 200)
  if (!sleutel) return { ok: false, status: 400, fout: 'idempotencyKey ontbreekt.' }
  if (!isHarrieType(body.type)) {
    return { ok: false, status: 400, fout: `Onbekend type "${String(body.type)}".` }
  }
  const type = body.type as HarrieType
  const p = (body.prospect ?? {}) as HarrieProspect
  const detail = tekst(body.detail, 2000)
  const admin = createAdminSupabaseClient()

  // Al gezien? Dan is dit een herhaling uit Harrie's uitbox.
  const { data: bestaand } = await admin.from('harrie_events')
    .select('id').eq('idempotency_key', sleutel).maybeSingle()
  if (bestaand) return { ok: false, status: 409, fout: 'Deze gebeurtenis is al verwerkt.' }

  const pipelineId = await doelPipeline()
  if (!pipelineId) return { ok: false, status: 500, fout: 'Geen pipeline ingesteld.' }

  let leadId = await zoekLead(p, pipelineId)
  let aangemaakt = false

  /**
   * Nog geen dossier? Dan maken we er een.
   *
   * Harrie zoekt zijn eigen prospects op (KBO, LinkedIn), dus dit is de weg
   * waarlangs die in onze pipeline terechtkomen. We gebruiken exact dezelfde
   * functie als het scherm "Nieuwe lead", zodat ontdubbeling en de sleutel op
   * het bedrijf identiek werken.
   */
  if (!leadId) {
    const naam = tekst(p.company, 200) ?? tekst(p.name, 200)
    if (!naam) {
      return { ok: false, status: 400, fout: 'Zonder bedrijfsnaam of naam kan er geen lead aangemaakt worden.' }
    }
    const org = await getOrCreateSalesOrg()
    const res = await createLead({
      salesClientId: org.id,
      pipelineId,
      company: {
        name: naam,
        city: tekst(p.city, 120) ?? undefined,
        sector: tekst(p.sector, 160) ?? undefined,
        phone: tekst(p.phone, 40) ?? undefined,
        ondernemingsnummer: normaliseerKbo(p.kbo) ?? undefined,
      },
      contact: {
        name: tekst(p.name, 160) ?? tekst(p.firstName, 80) ?? undefined,
        role: tekst(p.role, 120) ?? undefined,
        email: schoonEmail(p.email) ?? undefined,
        phone: tekst(p.phone, 40) ?? undefined,
        linkedin: tekst(p.linkedinUrl, 300) ?? undefined,
      },
      labels: [HARRIE_LABEL],
    })
    if (res.ok) { leadId = res.leadId; aangemaakt = true }
    else if (res.existingLeadId) leadId = res.existingLeadId
    else return { ok: false, status: 400, fout: res.error }
  }

  // ── De gevolgen toepassen ──────────────────────────────────────────────────
  const gevolg = gevolgVan(type, detail)
  const patch: Record<string, unknown> = {}

  const { data: huidig } = await admin.from('sales_leads')
    .select('id, stage_key, labels, lost_reason').eq('id', leadId).maybeSingle()
  const lead = huidig as { id: string; stage_key: string; labels: string[] | null; lost_reason: string | null } | null
  if (!lead) return { ok: false, status: 500, fout: 'Lead verdween tijdens het verwerken.' }

  /**
   * De fase zetten — met één rem. `imported` mag een BESTAANDE lead nooit
   * terugzetten naar "Nog te contacteren": een prospect die al in gesprek is,
   * hoort niet terug op de koude lijst omdat Harrie hem opnieuw oplaadt.
   */
  const faseMag = gevolg.fase && gevolg.fase !== lead.stage_key
    && !(gevolg.enkelBijNieuw && !aangemaakt)
  if (faseMag) patch.stage_key = gevolg.fase
  if (gevolg.reden && !lead.lost_reason) patch.lost_reason = gevolg.reden

  if (gevolg.nietMeerBenaderen) {
    patch.do_not_call = true
    patch.do_not_call_reason = 'Uitgeschreven via Harrie'
  }

  /**
   * "Gereageerd" is geen statuswijziging maar een OPDRACHT: bel deze persoon.
   * Door het terugbelmoment op nu te zetten springt de lead vooraan in Focus
   * Mode, met de tekst van de prospect erbij. Zo hoeft niemand een mailtje of
   * een logboek af te speuren om te weten wie er wacht.
   */
  if (gevolg.belTaak) {
    patch.callback_at = new Date().toISOString()
    patch.callback_note = (detail ? `Harrie: ${detail}` : 'Reageerde op de koude benadering — bellen').slice(0, 300)
  }

  /**
   * Net gebeld? Dan het terugbelmoment weghalen, anders blijft de lead vooraan
   * in de belrij staan en belt de volgende setter hem vanmiddag opnieuw.
   */
  if (gevolg.belTaakWissen) {
    patch.callback_at = null
    patch.callback_note = null
  }

  // Labels: het Harrie-label zodat je de herkomst ziet, plus wat de
  // gebeurtenis zelf oplevert (bv. "e-mail ongeldig").
  const labels = new Set([...(lead.labels ?? []), HARRIE_LABEL])
  if (gevolg.label) labels.add(gevolg.label)
  if (labels.size !== (lead.labels ?? []).length) patch.labels = [...labels]

  if (Object.keys(patch).length > 0) {
    let { error } = await admin.from('sales_leads').update(patch).eq('id', leadId)
    // callback_note bestaat pas na de migratie; de rest moet dan gewoon door.
    if (error && /callback_note/i.test(error.message)) {
      delete patch.callback_note
      ;({ error } = await admin.from('sales_leads').update(patch).eq('id', leadId))
    }
    if (error) return { ok: false, status: 500, fout: error.message }
  }

  // Telefoonnummer van de prospect bewaren als wij er nog geen hadden — Harrie
  // haalt die uit zijn eigen bronnen en dat is precies wat een setter nodig heeft.
  const nummer = tekst(p.phone, 40)
  if (nummer) {
    const { data: leadRij } = await admin.from('sales_leads')
      .select('contact_id, company_id').eq('id', leadId).maybeSingle()
    const ids = leadRij as { contact_id: string | null; company_id: string | null } | null
    if (ids?.contact_id) {
      const { data: c } = await admin.from('sales_contacts')
        .select('phone, mobile').eq('id', ids.contact_id).maybeSingle()
      const cc = c as { phone: string | null; mobile: string | null } | null
      if (cc && !cc.phone && !cc.mobile) {
        await admin.from('sales_contacts')
          .update({ phone: nummer, phone_digits: normalizePhone(nummer) })
          .eq('id', ids.contact_id)
      }
    }
  }

  // Op de tijdlijn van de lead, zodat het in de pipeline zichtbaar is.
  await logLeadEvent(leadId, {
    kind: 'system',
    body: gevolg.omschrijving,
    actorEmail: 'harrie@acquisitie',
  })

  const resultaat = [
    aangemaakt ? 'nieuwe lead aangemaakt' : 'gekoppeld aan bestaande lead',
    // Wat er ECHT gebeurde, niet wat het gevolg voorschreef: bij een `imported`
    // op een bestaande lead houdt de rem de fase tegen, en dan mag hier niet
    // staan dat we hem verzet hebben.
    faseMag ? `fase → ${gevolg.fase}`
      : gevolg.fase && gevolg.fase !== lead.stage_key ? `fase blijft ${lead.stage_key}` : null,
    gevolg.belTaak ? 'beltaak gezet' : null,
    gevolg.nietMeerBenaderen ? 'op niet-benaderen gezet' : null,
  ].filter(Boolean).join(', ')

  await admin.from('harrie_events').insert({
    idempotency_key: sleutel,
    type,
    gebeurd_op: tekst(body.at, 40) ? new Date(String(body.at)).toISOString() : new Date().toISOString(),
    prospect: p as unknown as Record<string, unknown>,
    detail,
    lead_id: leadId,
    resultaat,
  })

  return { ok: true, status: aangemaakt ? 201 : 200, leadId, resultaat }
}
