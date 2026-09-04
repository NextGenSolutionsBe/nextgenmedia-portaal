import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { commissionCents } from '@/lib/sales/earnings'
import { logAudit, requestMeta } from '@/lib/audit'

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
      .select('id, setter_profile_id, setter_id')
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
