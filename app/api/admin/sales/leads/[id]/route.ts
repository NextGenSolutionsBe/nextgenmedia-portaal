import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { canTransition, transitionError, APPOINTMENT_STAGE } from '@/lib/sales/stages'
import { MAX_GEEN_GEHOOR, GEEN_GEHOOR_UREN } from '@/lib/sales/focus-queue'
import { logLeadEvent, moveLeadToPipeline } from '@/lib/sales/service'
import { listPipelines } from '@/lib/sales/pipelines'
import { normalizePhone, companyDedupeKey } from '@/lib/sales/dedupe'

export const dynamic = 'force-dynamic'

// GET — één lead met historiek (voor het detailpaneel).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const [{ data: lead }, { data: events }] = await Promise.all([
      admin.from('sales_leads')
        .select(`*, sales_companies ( * ), sales_contacts ( * )`)
        .eq('id', id).maybeSingle(),
      admin.from('sales_lead_events').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(100),
    ])
    if (!lead) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })
    return NextResponse.json({ lead, events: events ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — fase, labels, terugbellen, niet-bellen, briefing, contactgegevens.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const b = await req.json()
    const admin = createAdminSupabaseClient()

    const { data: current } = await admin.from('sales_leads')
      .select('id, stage_key, contact_id, pipeline_id, company_id, sales_client_id, lost_reason, geen_gehoor_count')
      .eq('id', id).maybeSingle()
    if (!current) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })

    // Merk wisselen: de lead verhuist naar de andere pipeline. Dat kan botsen
    // met de regel "één actieve lead per bedrijf per pipeline", dus we melden
    // dat netjes in plaats van een databasefout te tonen.
    if (b.pipelineId) {
      const pipelines = await listPipelines()
      const target = pipelines.find((p) => p.id === String(b.pipelineId))
      if (!target) return NextResponse.json({ error: 'Onbekende pipeline' }, { status: 400 })
      const cur = current as { pipeline_id: string | null; company_id: string; sales_client_id: string }
      if (cur.pipeline_id !== target.id) {
        const moved = await moveLeadToPipeline(id, target.id)
        if (!moved.ok) return NextResponse.json({ error: moved.error }, { status: 409 })
        await logLeadEvent(id, {
          kind: 'system', body: `Verhuisd naar ${target.name}`,
          actorId: actor.id, actorEmail: actor.email ?? null,
        })
      }
    }

    const patch: Record<string, unknown> = {}

    // Fasewissel — "Afspraak ingepland" kan hier NOOIT gezet worden (§3): die
    // ontstaat uitsluitend via een geslaagde boeking in Appointment setting.
    if (typeof b.stage === 'string' && b.stage !== current.stage_key) {
      if (b.stage === APPOINTMENT_STAGE || !canTransition(current.stage_key, b.stage)) {
        return NextResponse.json({ error: transitionError(current.stage_key, b.stage) ?? 'Niet toegestaan' }, { status: 400 })
      }
      // "Geen interesse" EIST een reden — hier, niet alleen in het scherm.
      // De sectorstatistiek draait erop, en een controle die alleen in de
      // browser leeft is geen controle. De reden mag in dezelfde aanvraag
      // meekomen of al op de lead staan.
      if (b.stage === 'not_interested') {
        const reden = String(b.lost_reason ?? '').trim()
          || String((current as { lost_reason?: string | null }).lost_reason ?? '').trim()
        if (!reden) {
          return NextResponse.json({
            error: 'Geef een reden op waarom er geen interesse is — daar draait de statistiek op.',
          }, { status: 400 })
        }
      }
      patch.stage_key = b.stage
    }

    /**
     * "Geen gehoor" — de belpoging tellen en de lead op de juiste manier
     * laten terugkomen.
     *
     * Dit gebeurt op de SERVER en niet in het belscherm: twee setters kunnen
     * dezelfde lead na elkaar proberen, en een teller die in de browser leeft
     * telt dan verkeerd of helemaal niet. Bovendien is dit precies het pad
     * waarlangs een lead voorgoed uit de belronde verdwijnt.
     */
    if (b.geen_gehoor === true) {
      const huidig = Number((current as { geen_gehoor_count?: number }).geen_gehoor_count ?? 0)
      const nieuw = huidig + 1
      patch.geen_gehoor_count = nieuw

      if (nieuw >= MAX_GEEN_GEHOOR) {
        // Genoeg geprobeerd. Eigen eindfase, en het terugbelmoment weg — anders
        // zou de lead ondanks de fase toch nog blijven opduiken.
        patch.stage_key = 'max_pogingen'
        patch.callback_at = null
        patch.callback_note = null
        await logLeadEvent(id, {
          kind: 'system',
          body: `${nieuw}× geen gehoor — uit de belronde gehaald`,
          actorId: actor.id, actorEmail: actor.email ?? null,
        })
      } else {
        patch.callback_at = new Date(Date.now() + GEEN_GEHOOR_UREN * 3600_000).toISOString()
        patch.callback_note = `Geen gehoor (poging ${nieuw} van ${MAX_GEEN_GEHOOR})`
        // Nog niet gesproken, maar wel geprobeerd: dat is "gecontacteerd".
        if (current.stage_key === 'to_contact') patch.stage_key = 'contacted'
      }
    }

    if (Array.isArray(b.labels)) patch.labels = b.labels.map(String)
    if (b.callback_at !== undefined) {
      patch.callback_at = b.callback_at ? new Date(b.callback_at).toISOString() : null
      // Zonder terugbelmoment heeft de notitie erbij geen betekenis meer.
      if (!b.callback_at) patch.callback_note = null
    }
    if (b.callback_note !== undefined) {
      patch.callback_note = String(b.callback_note ?? '').trim().slice(0, 300) || null
    }
    if (b.lost_reason !== undefined) patch.lost_reason = String(b.lost_reason ?? '') || null
    if (b.email_brief !== undefined) patch.email_brief = String(b.email_brief ?? '') || null
    if (typeof b.do_not_call === 'boolean') {
      patch.do_not_call = b.do_not_call
      patch.do_not_call_reason = b.do_not_call ? (String(b.do_not_call_reason ?? '') || null) : null
    }
    if (b.archived === true) patch.archived_at = new Date().toISOString()
    if (b.archived === false) patch.archived_at = null
    if (b.assigned_to !== undefined) patch.assigned_to = b.assigned_to || null

    if (Object.keys(patch).length > 0) {
      let { error } = await admin.from('sales_leads').update(patch).eq('id', id)
      // callback_note bestaat pas na de migratie; zonder die kolom moet de
      // rest van de wijziging gewoon doorgaan.
      if (error && /callback_note/i.test(error.message)) {
        delete patch.callback_note
        if (Object.keys(patch).length > 0) {
          ;({ error } = await admin.from('sales_leads').update(patch).eq('id', id))
        } else {
          error = null
        }
      }
      if (error) throw new Error(error.message)
    }

    /**
     * Bedrijfsgegevens bijwerken.
     *
     * Twee dingen om in de gaten te houden:
     *
     * 1. Een bedrijf hangt onder MEER dan deze ene lead — hetzelfde bedrijf kan
     *    in beide merken staan. Wie hier de naam verbetert, verbetert hem dus
     *    overal. Dat is de bedoeling (één bedrijf, één naam), maar het scherm
     *    zegt het er wel bij.
     * 2. De ontdubbelsleutel is afgeleid van website of naam. Verandert er een
     *    van beide, dan moet die sleutel mee — anders duikt hetzelfde bedrijf
     *    bij de volgende import alsnog een tweede keer op.
     */
    if (b.company && typeof b.company === 'object' && current.company_id) {
      const { data: bedrijf } = await admin.from('sales_companies')
        .select('id, name, website').eq('id', current.company_id).maybeSingle()
      const huidig = (bedrijf ?? { name: '', website: null }) as { name: string; website: string | null }

      const c: Record<string, unknown> = {}
      for (const k of [
        'website', 'sector', 'city', 'region', 'country', 'phone', 'linkedin',
        'gatekeeper_naam', 'dmu_naam', 'dmu_functie',
      ] as const) {
        if (b.company[k] !== undefined) c[k] = String(b.company[k] ?? '').trim() || null
      }
      if (b.company.name !== undefined) {
        const naam = String(b.company.name ?? '').trim()
        // Een bedrijf zonder naam is in elke lijst onvindbaar. Liever weigeren
        // dan een lege rij die niemand nog terugvindt.
        if (!naam) return NextResponse.json({ error: 'Een bedrijf moet een naam houden.' }, { status: 400 })
        c.name = naam
      }
      if (b.company.employees !== undefined) {
        const n = Number(b.company.employees)
        c.employees = Number.isFinite(n) && n > 0 ? Math.floor(n) : null
      }

      if (Object.keys(c).length) {
        if (c.name !== undefined || c.website !== undefined) {
          c.dedupe_key = companyDedupeKey(
            String(c.name ?? huidig.name),
            (c.website as string | null | undefined) ?? huidig.website,
          )
        }
        let { error: cErr } = await admin.from('sales_companies').update(c).eq('id', current.company_id)
        // Gatekeeper en beslissingnemer zijn nieuwe kolommen: zolang de migratie
        // niet gedraaid is, mag de rest van de wijziging gewoon doorgaan.
        if (cErr && /gatekeeper_naam|dmu_naam|dmu_functie/i.test(cErr.message)) {
          delete c.gatekeeper_naam; delete c.dmu_naam; delete c.dmu_functie
          if (Object.keys(c).length) {
            ;({ error: cErr } = await admin.from('sales_companies').update(c).eq('id', current.company_id))
          } else {
            cErr = null
          }
        }
        if (cErr) {
          // De unieke sleutel botst: er staat al een ánder bedrijf met deze
          // naam of website. Dat samenvoegen is geen bewerking maar een fusie,
          // en die doen we niet stilzwijgend.
          if (/duplicate|unique|23505/i.test(cErr.message)) {
            return NextResponse.json({
              error: 'Er staat al een ander bedrijf met deze naam of website. Pas een van beide aan, of werk verder in die andere lead.',
            }, { status: 409 })
          }
          throw new Error(cErr.message)
        }
      }
    }

    /**
     * Contactgegevens bijwerken (o.a. e-mail overschrijven vanuit de boeking).
     *
     * Heeft de lead nog géén contactpersoon — dat komt voor bij een import waar
     * alleen het bedrijf bekend was — dan maken we die hier alsnog aan. Anders
     * kun je aan de telefoon de naam die je net hoort nergens kwijt.
     */
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
        if (nieuwContact) {
          await admin.from('sales_leads').update({ contact_id: (nieuwContact as { id: string }).id }).eq('id', id)
        }
      }
    }

    if (patch.stage_key) {
      await logLeadEvent(id, {
        kind: 'stage', fromStage: current.stage_key, toStage: String(patch.stage_key),
        actorId: actor.id, actorEmail: actor.email ?? null,
      })
    }
    // Wie gegevens aanpast, laat een spoor na op de tijdlijn. Bij een fout
    // nummer of een verkeerde naam wil je later kunnen zien wanneer het
    // veranderde en door wie.
    if (b.company || b.contact) {
      const velden = [
        ...Object.keys((b.company ?? {}) as Record<string, unknown>).map((k) => `bedrijf.${k}`),
        ...Object.keys((b.contact ?? {}) as Record<string, unknown>).map((k) => `contact.${k}`),
      ]
      if (velden.length) {
        await logLeadEvent(id, {
          kind: 'system', body: `Gegevens aangepast: ${velden.join(', ')}`,
          actorId: actor.id, actorEmail: actor.email ?? null,
        })
      }
    }
    if (typeof b.note === 'string' && b.note.trim()) {
      await logLeadEvent(id, { kind: b.noteKind === 'call' ? 'call' : 'note', body: b.note.trim(), actorId: actor.id, actorEmail: actor.email ?? null })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — archiveren (zacht verwijderen; nooit hard, §4).
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
