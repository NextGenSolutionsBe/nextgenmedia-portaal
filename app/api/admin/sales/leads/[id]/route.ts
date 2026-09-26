import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { canTransition, normaliseerStage, transitionError, vereistVerantwoordelijke, isGesloten } from '@/lib/sales/stages'
import { isRedenCode, redenTekst } from '@/lib/sales/redenen'
import { isLeadbron } from '@/lib/sales/leadbron'
import { logLeadEvent, moveLeadToPipeline } from '@/lib/sales/service'
import { registreerActiviteit } from '@/lib/sales/activiteiten'
import { listPipelines } from '@/lib/sales/pipelines'
import { GEEN_GEHOOR_UREN, MAX_GEEN_GEHOOR } from '@/lib/sales/focus-queue'
import { normalizePhone, companyDedupeKey } from '@/lib/sales/dedupe'

export const dynamic = 'force-dynamic'

// GET — één lead met historiek (voor het detailpaneel).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const [{ data: lead }, { data: events }, { data: afspraken }] = await Promise.all([
      admin.from('sales_leads')
        .select(`*, sales_companies ( * ), sales_contacts ( * )`)
        .eq('id', id).maybeSingle(),
      admin.from('sales_lead_events').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(100),
      admin.from('sales_appointments').select('*').eq('lead_id', id).order('starts_at', { ascending: false }).limit(5),
    ])
    if (!lead) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })
    const afsprakenUit = ((afspraken ?? []) as Record<string, unknown>[]).map((a) => ({
      id: a.id, starts_at: a.starts_at, ends_at: a.ends_at, status: a.status, outcome: a.outcome ?? null,
      titel: a.titel ?? null, adres: a.adres ?? null, meet_url: a.meet_url ?? null,
      notes: a.notes ?? null, client_note: a.client_note ?? null,
    }))
    const l = lead as Record<string, unknown>
    l.stage_key = normaliseerStage(l.stage_key as string)
    return NextResponse.json({ lead: l, events: events ?? [], afspraken: afsprakenUit })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

const DATUM = /^\d{4}-\d{2}-\d{2}/
/** Nieuwe kanban-kolommen: mogen vóór de migratie nog ontbreken. */
const KANBAN_KOLOMMEN = ['leadbron', 'positie', 'dienst', 'opvolgdatum', 'deal_waarde_cents', 'gesloten_op', 'verlies_reden'] as const

/**
 * PATCH — fase (+ positie), leadbron, dienst, verantwoordelijke, opvolgdatum,
 * terugbelmoment, gewonnen/verloren-gegevens, labels, niet-bellen, archief,
 * bedrijfs- en contactgegevens.
 *
 * Een fasewissel registreert een activiteit `fase_gewijzigd` — en NIETS
 * anders. Een kaart naar "Gebeld" slepen is geen gesprek; dat registreer je
 * apart, anders telt de statistiek gesprekken die nooit gevoerd zijn.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const b = await req.json()
    const admin = createAdminSupabaseClient()

    const { data: currentRow } = await admin.from('sales_leads').select('*').eq('id', id).maybeSingle()
    if (!currentRow) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })
    const current = currentRow as {
      id: string; stage_key: string; contact_id: string | null; pipeline_id: string | null
      company_id: string; sales_client_id: string; lost_reason: string | null; reden_code?: string | null
      warm?: boolean | null; merken?: string[] | null; assigned_to?: string | null
      opvolgdatum?: string | null; dienst?: string | null; leadbron?: string | null
      geen_gehoor_count?: number | null
    }
    const huidigeFase = normaliseerStage(current.stage_key)
    const ik = { id: actor.id, email: actor.email ?? null }

    // Merk verhuizen (ongewijzigd t.o.v. vroeger).
    if (b.pipelineId) {
      const pipelines = await listPipelines()
      const target = pipelines.find((p) => p.id === String(b.pipelineId))
      if (!target) return NextResponse.json({ error: 'Onbekende pipeline' }, { status: 400 })
      if (current.pipeline_id !== target.id) {
        const moved = await moveLeadToPipeline(id, target.id)
        if (!moved.ok) return NextResponse.json({ error: moved.error }, { status: 409 })
        await logLeadEvent(id, { kind: 'system', body: `Verhuisd naar ${target.name}`, actorId: ik.id, actorEmail: ik.email })
      }
    }

    const patch: Record<string, unknown> = {}

    if (Array.isArray(b.merken)) {
      const pipelines = await listPipelines()
      const geldig = pipelines.map((p) => p.key)
      const keuze = [...new Set((b.merken as unknown[]).map((v) => String(v)))].filter((k) => geldig.includes(k))
      if (keuze.length === 0) return NextResponse.json({ error: 'Kies minstens één merk.' }, { status: 400 })
      const huidig = pipelines.find((p) => p.id === current.pipeline_id)
      if (huidig && !keuze.includes(huidig.key)) {
        const doel = pipelines.find((p) => p.key === keuze[0])
        if (doel) {
          const moved = await moveLeadToPipeline(id, doel.id)
          if (!moved.ok) return NextResponse.json({ error: moved.error }, { status: 409 })
          await logLeadEvent(id, { kind: 'system', body: `Verhuisd naar ${doel.name}`, actorId: ik.id, actorEmail: ik.email })
        }
      }
      const vorig = (current.merken ?? []).slice().sort()
      if (JSON.stringify(vorig) !== JSON.stringify(keuze.slice().sort())) {
        const namen = keuze.map((k) => pipelines.find((p) => p.key === k)?.name ?? k)
        await logLeadEvent(id, { kind: 'system', body: `Merk: ${namen.join(' + ')}`, actorId: ik.id, actorEmail: ik.email })
      }
      patch.merken = keuze
    }

    // ── Fasewissel ──────────────────────────────────────────────────────────
    let nieuweFase: string | null = null
    if (typeof b.stage === 'string' && b.stage !== huidigeFase) {
      if (!canTransition(huidigeFase, b.stage)) {
        return NextResponse.json({ error: transitionError(huidigeFase, b.stage) ?? 'Niet toegestaan' }, { status: 400 })
      }
      nieuweFase = b.stage
      patch.stage_key = b.stage
    } else if (typeof b.stage === 'string' && b.stage === huidigeFase && current.stage_key !== huidigeFase) {
      // Oude sleutel in de databank: stil rechtzetten op de nieuwe.
      patch.stage_key = huidigeFase
    }
    if (b.positie !== undefined) {
      const n = Number(b.positie)
      if (Number.isFinite(n) && n >= 0) patch.positie = Math.floor(n)
    }

    // ── Gewonnen / verloren ─────────────────────────────────────────────────
    const naarGewonnen = nieuweFase === 'gewonnen'
    const naarVerloren = nieuweFase === 'verloren'
    if (b.gesloten_op !== undefined) {
      patch.gesloten_op = b.gesloten_op
        ? new Date(DATUM.test(String(b.gesloten_op)) && String(b.gesloten_op).length <= 10 ? `${b.gesloten_op}T12:00:00` : String(b.gesloten_op)).toISOString()
        : null
    } else if (naarGewonnen || naarVerloren) {
      patch.gesloten_op = new Date().toISOString()
    }
    if (b.deal_waarde !== undefined || b.deal_waarde_cents !== undefined) {
      let cents: number | null = null
      if (b.deal_waarde_cents !== undefined && b.deal_waarde_cents !== null && b.deal_waarde_cents !== '') {
        const n = Number(b.deal_waarde_cents); cents = Number.isFinite(n) && n >= 0 ? Math.round(n) : null
      } else if (b.deal_waarde !== undefined && b.deal_waarde !== null && String(b.deal_waarde).trim() !== '') {
        const euros = Number(String(b.deal_waarde).replace(/\./g, '').replace(',', '.'))
        cents = Number.isFinite(euros) && euros >= 0 ? Math.round(euros * 100) : null
      }
      patch.deal_waarde_cents = cents
    }
    if (b.verlies_reden !== undefined) patch.verlies_reden = String(b.verlies_reden ?? '').trim().slice(0, 500) || null

    // ── Losse velden ────────────────────────────────────────────────────────
    if (b.leadbron !== undefined) {
      if (!isLeadbron(b.leadbron)) return NextResponse.json({ error: 'Onbekende leadbron' }, { status: 400 })
      patch.leadbron = b.leadbron
    }
    if (b.dienst !== undefined) patch.dienst = String(b.dienst ?? '').trim().slice(0, 120) || null
    let opvolgGewijzigd = false
    if (b.opvolgdatum !== undefined) {
      const d = b.opvolgdatum ? String(b.opvolgdatum).slice(0, 10) : null
      if (d && !DATUM.test(d)) return NextResponse.json({ error: 'De opvolgdatum klopt niet.' }, { status: 400 })
      if ((current.opvolgdatum ?? null)?.slice(0, 10) !== d) { patch.opvolgdatum = d; opvolgGewijzigd = true }
    }
    /**
     * "Geen gehoor" uit Focus Mode — de belpoging tellen en de lead over
     * GEEN_GEHOOR_UREN laten terugkomen. Op de server, zodat twee setters na
     * elkaar correct tellen. Bewust GEEN fasewissel: na MAX_GEEN_GEHOOR
     * pogingen valt het terugbelmoment weg en slaat de belronde de lead over
     * (zie lib/sales/focus-queue.ts); de kaart blijft waar hij staat.
     */
    let geenGehoorPogingen = 0
    if (b.geen_gehoor === true) {
      geenGehoorPogingen = Number(current.geen_gehoor_count ?? 0) + 1
      patch.geen_gehoor_count = geenGehoorPogingen
      if (geenGehoorPogingen >= MAX_GEEN_GEHOOR) {
        patch.callback_at = null
        patch.callback_note = null
      } else {
        patch.callback_at = new Date(Date.now() + GEEN_GEHOOR_UREN * 3600_000).toISOString()
        patch.callback_note = `Geen gehoor (poging ${geenGehoorPogingen} van ${MAX_GEEN_GEHOOR})`
      }
    }
    if (b.warm === true && !current.warm) { patch.warm = true; patch.warm_op = new Date().toISOString() }
    if (b.warm === false) { patch.warm = false; patch.warm_op = null }
    // Labels: getrimd, zonder lege en zonder dubbels (hoofdletterongevoelig).
    let labelsGewijzigd: { bij: string[]; weg: string[] } | null = null
    if (Array.isArray(b.labels)) {
      const gezien = new Set<string>()
      const labels: string[] = []
      for (const v of b.labels as unknown[]) {
        const l = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
        if (!l || gezien.has(l.toLowerCase())) continue
        gezien.add(l.toLowerCase()); labels.push(l)
      }
      if (labels.length > 30) return NextResponse.json({ error: 'Maximaal 30 labels per lead.' }, { status: 400 })
      const vorige = ((currentRow as { labels?: string[] | null }).labels ?? []).map(String)
      const bij = labels.filter((l) => !vorige.includes(l))
      const weg = vorige.filter((l) => !labels.includes(l))
      if (bij.length || weg.length) labelsGewijzigd = { bij, weg }
      patch.labels = labels
    }
    if (b.callback_at !== undefined) {
      patch.callback_at = b.callback_at ? new Date(b.callback_at).toISOString() : null
      if (!b.callback_at) patch.callback_note = null
    }
    if (b.callback_note !== undefined) patch.callback_note = String(b.callback_note ?? '').trim().slice(0, 300) || null
    if (b.reden_code !== undefined) {
      const code = String(b.reden_code ?? '').trim()
      if (code && isRedenCode(code)) {
        patch.reden_code = code
        patch.lost_reason = redenTekst(code, b.reden_toelichting as string | undefined)
      } else if (!code) patch.reden_code = null
    }
    if (b.lost_reason !== undefined && patch.lost_reason === undefined) patch.lost_reason = String(b.lost_reason ?? '') || null
    if (b.email_brief !== undefined) patch.email_brief = String(b.email_brief ?? '') || null
    if (typeof b.do_not_call === 'boolean') {
      patch.do_not_call = b.do_not_call
      patch.do_not_call_reason = b.do_not_call ? (String(b.do_not_call_reason ?? '') || null) : null
    }
    if (b.archived === true) patch.archived_at = new Date().toISOString()
    if (b.archived === false) patch.archived_at = null
    let verantwoordelijkeGewijzigd = false
    if (b.assigned_to !== undefined) {
      const nieuw = b.assigned_to ? String(b.assigned_to) : null
      if (nieuw !== (current.assigned_to ?? null)) { patch.assigned_to = nieuw; verantwoordelijkeGewijzigd = true }
    }

    if (Object.keys(patch).length > 0) {
      let { error } = await admin.from('sales_leads').update(patch).eq('id', id)
      // Kolommen uit een migratie die nog niet gedraaid is: laten vallen en de
      // rest van de wijziging gewoon doorzetten.
      if (error && /callback_note|reden_code|warm|harrie|geen_gehoor|leadbron|positie|dienst|opvolgdatum|deal_waarde|gesloten_op|verlies_reden|schema cache|PGRST204/i.test(error.message)) {
        for (const k of ['callback_note', 'reden_code', 'warm', 'warm_op', 'geen_gehoor_count', ...KANBAN_KOLOMMEN]) delete patch[k]
        if (Object.keys(patch).length > 0) { ({ error } = await admin.from('sales_leads').update(patch).eq('id', id)) }
        else error = null
      }
      if (error) throw new Error(error.message)
    }

    // ── Bedrijfsgegevens ────────────────────────────────────────────────────
    if (b.company && typeof b.company === 'object' && current.company_id) {
      const { data: bedrijf } = await admin.from('sales_companies')
        .select('id, name, website').eq('id', current.company_id).maybeSingle()
      const huidig = (bedrijf ?? { name: '', website: null }) as { name: string; website: string | null }
      const c: Record<string, unknown> = {}
      for (const k of ['website', 'sector', 'city', 'region', 'country', 'phone', 'linkedin', 'gatekeeper_naam', 'dmu_naam', 'dmu_functie', 'email', 'werkklasse'] as const) {
        if (b.company[k] !== undefined) c[k] = String(b.company[k] ?? '').trim() || null
      }
      if (b.company.name !== undefined) {
        const naam = String(b.company.name ?? '').trim()
        if (!naam) return NextResponse.json({ error: 'Een bedrijf moet een naam houden.' }, { status: 400 })
        c.name = naam
      }
      if (b.company.employees !== undefined) {
        const n = Number(b.company.employees)
        c.employees = Number.isFinite(n) && n > 0 ? Math.floor(n) : null
      }
      if (Object.keys(c).length) {
        if (c.name !== undefined || c.website !== undefined) {
          c.dedupe_key = companyDedupeKey(String(c.name ?? huidig.name), (c.website as string | null | undefined) ?? huidig.website)
        }
        let { error: cErr } = await admin.from('sales_companies').update(c).eq('id', current.company_id)
        if (cErr && /gatekeeper_naam|dmu_naam|dmu_functie|email|werkklasse|schema cache|PGRST204/i.test(cErr.message)) {
          delete c.gatekeeper_naam; delete c.dmu_naam; delete c.dmu_functie; delete c.email; delete c.werkklasse
          if (Object.keys(c).length) { ({ error: cErr } = await admin.from('sales_companies').update(c).eq('id', current.company_id)) }
          else cErr = null
        }
        if (cErr) {
          if (/duplicate|unique|23505/i.test(cErr.message)) {
            return NextResponse.json({
              error: 'Er staat al een ander bedrijf met deze naam of website. Pas een van beide aan, of werk verder in die andere lead.',
            }, { status: 409 })
          }
          throw new Error(cErr.message)
        }
      }
    }

    // ── Contactgegevens ─────────────────────────────────────────────────────
    if (b.contact && typeof b.contact === 'object') {
      const c: Record<string, unknown> = {}
      for (const k of ['name', 'role', 'email', 'phone', 'mobile', 'linkedin'] as const) {
        if (b.contact[k] !== undefined) c[k] = String(b.contact[k] ?? '').trim() || null
      }
      if (b.contact.phone !== undefined || b.contact.mobile !== undefined) {
        c.phone_digits = normalizePhone(String(b.contact.phone ?? b.contact.mobile ?? ''))
      }
      if (Object.keys(c).length && current.contact_id) {
        await admin.from('sales_contacts').update(c).eq('id', current.contact_id)
      } else if (Object.keys(c).length && current.company_id) {
        const { data: nieuwContact } = await admin.from('sales_contacts')
          .insert({ company_id: current.company_id, ...c }).select('id').single()
        if (nieuwContact) await admin.from('sales_leads').update({ contact_id: (nieuwContact as { id: string }).id }).eq('id', id)
      }
    }

    // ── Tijdlijn en activiteiten ────────────────────────────────────────────
    // Een gewonnen/verloren deal telt voor de VERANTWOORDELIJKE (de closer), niet
    // voor wie de kaart versleept — anders klopt de closing rate per medewerker niet.
    const verantwoordelijke = (patch.assigned_to !== undefined ? patch.assigned_to : current.assigned_to ?? null) as string | null
    const dealDoor = verantwoordelijke ?? ik.id
    const dealDoorEmail = verantwoordelijke && verantwoordelijke !== ik.id ? null : ik.email
    if (nieuweFase) {
      if (naarGewonnen || naarVerloren) {
        const cents = patch.deal_waarde_cents as number | null | undefined
        const extra = naarGewonnen
          ? [typeof cents === 'number' ? `€ ${(cents / 100).toLocaleString('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : null, (patch.dienst as string | null) ?? current.dienst ?? null].filter(Boolean).join(' · ') || null
          : ((patch.verlies_reden as string | null) ?? null)
        await registreerActiviteit(admin, {
          leadId: id, medewerkerId: dealDoor, medewerkerEmail: dealDoorEmail,
          type: naarGewonnen ? 'deal_gewonnen' : 'deal_verloren',
          vanFase: huidigeFase, naarFase: nieuweFase, extra,
          notitie: typeof b.note === 'string' ? b.note : null,
        })
      }
      await registreerActiviteit(admin, {
        leadId: id, medewerkerId: ik.id, medewerkerEmail: ik.email,
        type: 'fase_gewijzigd', vanFase: huidigeFase, naarFase: nieuweFase,
      })
    }
    if (opvolgGewijzigd) {
      await registreerActiviteit(admin, {
        leadId: id, medewerkerId: ik.id, medewerkerEmail: ik.email,
        type: 'opvolging', opvolgdatum: (patch.opvolgdatum as string | null) ?? null,
      })
    }
    if (geenGehoorPogingen >= MAX_GEEN_GEHOOR) {
      await logLeadEvent(id, {
        kind: 'system', body: `${geenGehoorPogingen}× geen gehoor — uit de belronde gehaald`,
        actorId: ik.id, actorEmail: ik.email,
      })
    }
    if (verantwoordelijkeGewijzigd) {
      await logLeadEvent(id, {
        kind: 'system', body: patch.assigned_to ? 'Verantwoordelijke gewijzigd' : 'Verantwoordelijke weggehaald',
        actorId: ik.id, actorEmail: ik.email,
      })
      // Staat de lead al op gewonnen/verloren (zonder fasewissel nu), dan verhuist
      // de laatste sluiting mee naar de nieuwe verantwoordelijke — zo telt de deal
      // in de statistieken bij wie hem effectief sloot.
      const faseNu = normaliseerStage((patch.stage_key as string | undefined) ?? current.stage_key)
      if (!nieuweFase && isGesloten(faseNu) && patch.assigned_to) {
        try {
          const { data: laatste } = await admin.from('sales_activiteiten').select('id')
            .eq('lead_id', id).in('type', ['deal_gewonnen', 'deal_verloren']).is('verwijderd_op', null)
            .order('created_at', { ascending: false }).limit(1).maybeSingle()
          if (laatste) await admin.from('sales_activiteiten').update({ medewerker_id: patch.assigned_to, medewerker_email: null }).eq('id', laatste.id)
        } catch { /* statistiek is extra — nooit de wijziging laten falen */ }
      }
    }
    if (labelsGewijzigd) {
      const delen = [
        labelsGewijzigd.bij.length ? `+ ${labelsGewijzigd.bij.join(', ')}` : '',
        labelsGewijzigd.weg.length ? `− ${labelsGewijzigd.weg.join(', ')}` : '',
      ].filter(Boolean)
      await logLeadEvent(id, { kind: 'system', body: `Labels: ${delen.join(' · ')}`, actorId: ik.id, actorEmail: ik.email })
    }
    if (b.company || b.contact) {
      const velden = [
        ...Object.keys((b.company ?? {}) as Record<string, unknown>).map((k) => `bedrijf.${k}`),
        ...Object.keys((b.contact ?? {}) as Record<string, unknown>).map((k) => `contact.${k}`),
      ]
      if (velden.length) await logLeadEvent(id, { kind: 'system', body: `Gegevens aangepast: ${velden.join(', ')}`, actorId: ik.id, actorEmail: ik.email })
    }
    // Losse notitie (zonder fasewissel naar gewonnen/verloren, die nam ze al mee).
    if (typeof b.note === 'string' && b.note.trim() && !(naarGewonnen || naarVerloren)) {
      await registreerActiviteit(admin, {
        leadId: id, medewerkerId: ik.id, medewerkerEmail: ik.email,
        // Altijd een notitie: een gesprek registreer je via /activiteiten
        // (met uitkomst en duur), nooit als losse tekst.
        type: 'interne_notitie', notitie: b.note.trim(),
      })
    }

    const faseNa = normaliseerStage((patch.stage_key as string | undefined) ?? current.stage_key)
    return NextResponse.json({ ok: true, mistVerantwoordelijke: vereistVerantwoordelijke(faseNa) && !verantwoordelijke })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — archiveren (zacht verwijderen; nooit hard).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('sales_leads').update({ archived_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
