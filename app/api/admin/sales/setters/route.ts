import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { listSetters } from '@/lib/sales/setters'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Uurtarief en commissie per setter.
 *
 * ADMIN-ONLY, en niet zomaar uit voorzichtigheid: deze twee getallen bepalen
 * wat er uitbetaald wordt én wat er als kost in de financiën verschijnt. Een
 * setter die zijn eigen tarief kan aanpassen, past zijn eigen loon aan.
 */
export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    return NextResponse.json({ setters: await listSetters() })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '')
    if (!id) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })

    const patch: Record<string, unknown> = {}

    if ('naam' in b) {
      const naam = String(b.naam ?? '').trim().slice(0, 80)
      if (!naam) return NextResponse.json({ error: 'De naam mag niet leeg zijn.' }, { status: 400 })
      patch.name = naam
    }

    if ('uurtarief' in b) {
      // Euro's binnen, centen opslaan. "50,00" en "50.00" allebei aanvaarden.
      const euros = Number(String(b.uurtarief ?? '').replace(',', '.'))
      if (!Number.isFinite(euros) || euros < 0) {
        return NextResponse.json({ error: 'Het uurtarief klopt niet.' }, { status: 400 })
      }
      patch.hourly_rate_cents = Math.round(euros * 100)
    }

    if ('commissie' in b) {
      const pct = Number(String(b.commissie ?? '').replace(',', '.'))
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        return NextResponse.json({ error: 'De commissie moet tussen 0 en 100 procent liggen.' }, { status: 400 })
      }
      patch.commission_pct = pct
    }

    if ('actief' in b) patch.active = !!b.actief

    /**
     * Onbezoldigd: een zaakvoerder die zelf belt. We zetten tarief én
     * commissie meteen op nul in plaats van alleen de vlag te zetten. Zo staat
     * er in de databank geen bedrag dat niet geldt — en kan een latere
     * berekening die de vlag zou vergeten nooit alsnog €50/u opleveren.
     */
    if ('onbezoldigd' in b) {
      patch.onbezoldigd = !!b.onbezoldigd
      if (b.onbezoldigd) {
        patch.hourly_rate_cents = 0
        patch.commission_pct = 0
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Niets om aan te passen.' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    let { error } = await admin.from('sales_setters').update(patch).eq('id', id)
    // Kolom onbezoldigd nog niet gemigreerd? Dan de rest wél bewaren.
    if (error && /onbezoldigd|PGRST204|schema cache/i.test(error.message)) {
      delete patch.onbezoldigd
      ;({ error } = await admin.from('sales_setters').update(patch).eq('id', id))
      if (!error) {
        return NextResponse.json({
          ok: true,
          warning: 'Tarief en commissie zijn opgeslagen, maar de markering "geen vergoeding" niet: draai eerst de migratie.',
        })
      }
    }
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'sales.setter.update', entityType: 'sales_setter', entityId: id,
      summary: 'Verkoop: tarief/commissie van een setter aangepast',
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
