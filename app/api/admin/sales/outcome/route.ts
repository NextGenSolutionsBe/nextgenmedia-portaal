import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { commissionCents } from '@/lib/sales/earnings'
import { logAudit, requestMeta } from '@/lib/audit'
import { LOST_STAGE, WON_STAGE, normaliseerStage } from '@/lib/sales/stages'
import { registreerActiviteit } from '@/lib/sales/activiteiten'

export const dynamic = 'force-dynamic'

/**
 * De afloop van een afspraak vastleggen: gewonnen of verloren.
 *
 * ADMIN-ONLY. Hier hangt geld aan vast — de commissie van de setter volgt
 * hieruit — dus dit is niets wat een setter over zijn eigen afspraken beslist.
 *
 * Bij "gewonnen" wordt de commissie METEEN berekend en OPGESLAGEN, samen met
 * het percentage dat op dat moment gold. Verandert dat percentage later, dan
 * verandert er niets aan wat al afgesproken was.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Enkel een admin kan dit vastleggen' }, { status: 403 })
    const b = await req.json()

    const id = String(b.appointmentId ?? '')
    const outcome = String(b.outcome ?? '')
    if (!id) return NextResponse.json({ error: 'Afspraak ontbreekt' }, { status: 400 })
    if (!['won', 'lost', 'open'].includes(outcome)) {
      return NextResponse.json({ error: 'Kies gewonnen, verloren of open' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    const org = await getOrCreateSalesOrg()
    const { data: appt } = await admin.from('sales_appointments')
      .select('id, setter_profile_id, setter_id, lead_id')
      .eq('id', id).eq('sales_client_id', org.id).maybeSingle()
    if (!appt) return NextResponse.json({ error: 'Afspraak niet gevonden' }, { status: 404 })

    // Wie krijgt de commissie? Het profiel van de setter die geboekt heeft.
    let setterProfileId = (appt as { setter_profile_id: string | null }).setter_profile_id ?? null
    if (!setterProfileId) {
      const authId = (appt as { setter_id: string | null }).setter_id
      if (authId) {
        const { data: s } = await admin.from('sales_setters')
          .select('id').eq('auth_user_id', authId).maybeSingle()
        setterProfileId = (s as { id: string } | null)?.id ?? null
      }
    }

    const patch: Record<string, unknown> = {
      outcome: outcome === 'open' ? null : outcome,
      outcome_at: outcome === 'open' ? null : new Date().toISOString(),
      outcome_by: outcome === 'open' ? null : actor.id,
      setter_profile_id: setterProfileId,
      outcome_reason: null,
      deal_value_cents: null,
      commission_cents: null,
      commission_pct: null,
      tijdsbelasting: null,
    }

    // De reden bij een verloren afspraak is bewust optioneel.
    if (outcome === 'lost') patch.outcome_reason = String(b.reason ?? '').trim() || null

    if (outcome === 'won') {
      // Bedrag komt binnen in euro's; centen zijn de opslageenheid.
      const euros = Number(String(b.dealValue ?? '').replace(',', '.'))
      if (!Number.isFinite(euros) || euros <= 0) {
        return NextResponse.json({ error: 'Vul de waarde van het eerste contract in' }, { status: 400 })
      }
      const cents = Math.round(euros * 100)

      /**
       * Commissiepercentage van deze setter. Een ONBEZOLDIGDE setter (een
       * zaakvoerder die zelf belt) krijgt 0 — anders zou de standaard van 7%
       * stilletjes een commissie opbouwen voor iemand die er geen krijgt.
       */
      let pct = 7
      if (setterProfileId) {
        const { data: s } = await admin.from('sales_setters')
          .select('commission_pct, onbezoldigd').eq('id', setterProfileId).maybeSingle()
        const rij = s as { commission_pct?: number; onbezoldigd?: boolean } | null
        if (rij?.onbezoldigd) {
          pct = 0
        } else {
          const v = Number(rij?.commission_pct)
          if (Number.isFinite(v) && v > 0) pct = v
        }
      }

      patch.deal_value_cents = cents
      patch.commission_pct = pct
      patch.commission_cents = commissionCents(cents, pct)

      // Hoeveel werk vraagt dit project? Weegt de waarde in de ROI van de
      // setter. Optioneel: zonder keuze telt de deal volledig mee.
      const tb = Number(b.tijdsbelasting)
      patch.tijdsbelasting = Number.isInteger(tb) && tb >= 1 && tb <= 5 ? tb : null
    }

    const { error } = await admin.from('sales_appointments').update(patch).eq('id', id)
    if (error) {
      if (/outcome|deal_value|commission|setter_profile|PGRST204|schema cache/i.test(error.message)) {
        return NextResponse.json({
          error: 'De migratie voor de setter-cijfers is nog niet gedraaid; draai supabase/migrations/99999999_SYNC_ALL.sql.',
        }, { status: 503 })
      }
      throw new Error(error.message)
    }

    /**
     * De lead mee: een gewonnen afspraak is een gewonnen deal op het bord, een
     * verloren afspraak een verloren lead. Best-effort — de commissie staat al
     * vast — en enkel als de kaart er nog niet staat, zodat een correctie geen
     * tweede deal-activiteit oplevert.
     */
    const leadId = (appt as { lead_id?: string | null }).lead_id ?? null
    if (leadId && outcome !== 'open') {
      try {
        const { data: leadRij } = await admin.from('sales_leads').select('id, stage_key, dienst').eq('id', leadId).maybeSingle()
        const lead = leadRij as { id: string; stage_key: string; dienst?: string | null } | null
        const doel = outcome === 'won' ? WON_STAGE : LOST_STAGE
        if (lead && normaliseerStage(lead.stage_key) !== doel) {
          const van = normaliseerStage(lead.stage_key)
          const leadPatch: Record<string, unknown> = { stage_key: doel, gesloten_op: new Date().toISOString() }
          if (outcome === 'won') leadPatch.deal_waarde_cents = patch.deal_value_cents
          if (outcome === 'lost' && patch.outcome_reason) leadPatch.verlies_reden = patch.outcome_reason
          let { error: lErr } = await admin.from('sales_leads').update(leadPatch).eq('id', leadId)
          if (lErr && /gesloten_op|deal_waarde|verlies_reden|schema cache|PGRST204/i.test(lErr.message)) {
            ;({ error: lErr } = await admin.from('sales_leads').update({ stage_key: doel }).eq('id', leadId))
          }
          if (!lErr) {
            await registreerActiviteit(admin, {
              leadId, medewerkerId: actor.id, medewerkerEmail: actor.email ?? null,
              type: outcome === 'won' ? 'deal_gewonnen' : 'deal_verloren', vanFase: van, naarFase: doel,
              extra: outcome === 'won'
                ? `€ ${(Number(patch.deal_value_cents) / 100).toLocaleString('nl-BE')}${lead.dienst ? ` · ${lead.dienst}` : ''}`
                : (patch.outcome_reason as string | null) ?? null,
            })
            await registreerActiviteit(admin, {
              leadId, medewerkerId: actor.id, medewerkerEmail: actor.email ?? null,
              type: 'fase_gewijzigd', vanFase: van, naarFase: doel,
            })
          }
        }
      } catch (e) {
        console.error('[sales] lead mee sluiten na afloop mislukt:', e instanceof Error ? e.message : e)
      }
    }

    const meta = requestMeta(req)
    await logAudit({
      action: `sales.appointment.${outcome}`, entityType: 'sales_appointment', entityId: id,
      summary: outcome === 'won'
        ? `Verkoop: afspraak gewonnen, eerste contract ${Number(patch.deal_value_cents) / 100} EUR`
        : outcome === 'lost' ? 'Verkoop: afspraak verloren' : 'Verkoop: afloop teruggezet naar open',
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({
      ok: true,
      commissionCents: patch.commission_cents ?? 0,
      commissionPct: patch.commission_pct ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
