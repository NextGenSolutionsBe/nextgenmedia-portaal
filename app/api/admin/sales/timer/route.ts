import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { getOrCreateSetter } from '@/lib/sales/setters'

export const dynamic = 'force-dynamic'

/**
 * De timer van de ingelogde appointment setter.
 *
 * De tijd wordt op de SERVER gestempeld, niet in de browser. Een klok die de
 * gebruiker zelf kan verzetten mag niet bepalen wat er uitbetaald wordt.
 * Iedereen bedient enkel zijn eigen timer: het profiel volgt uit de sessie,
 * nooit uit het verzoek.
 */

/**
 * De vorm waarin een lopende timer naar het scherm gaat.
 *
 * ÉÉN vorm voor GET én POST. Ze liepen uiteen — GET gaf `startedAt`, POST de
 * ruwe kolom `started_at` — waardoor de teller na het starten op NaN stond tot
 * je de pagina herlaadde.
 */
function runningShape(row: { id: string; started_at: string } | null) {
  return row ? { id: row.id, startedAt: row.started_at } : null
}

async function mySetter() {
  const actor = await requireStaff()
  if (!actor) return null
  const name = (actor.user_metadata?.name as string | undefined)
    || (actor.user_metadata?.full_name as string | undefined)
    || actor.email?.split('@')[0]
    || 'Setter'
  return await getOrCreateSetter(actor.id, name, actor.email ?? null)
}

// GET — loopt er een timer, en sinds wanneer?
export async function GET() {
  try {
    const setter = await mySetter()
    if (!setter) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('sales_time_entries')
      .select('id, started_at').eq('setter_id', setter.id).is('ended_at', null).maybeSingle()

    return NextResponse.json({
      setter: { id: setter.id, name: setter.name, hourlyRateCents: setter.hourly_rate_cents, commissionPct: Number(setter.commission_pct) },
      running: runningShape(data as { id: string; started_at: string } | null),
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST { action: 'start' | 'stop' }
export async function POST(req: NextRequest) {
  try {
    const setter = await mySetter()
    if (!setter) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const admin = createAdminSupabaseClient()

    const { data: running } = await admin.from('sales_time_entries')
      .select('id, started_at').eq('setter_id', setter.id).is('ended_at', null).maybeSingle()

    if (b.action === 'start') {
      // Al bezig? Dan de lopende teruggeven i.p.v. een tweede te starten — dat
      // zou de uren dubbel laten tikken.
      if (running) {
        return NextResponse.json({
          ok: true, already: true,
          running: runningShape(running as { id: string; started_at: string }),
        })
      }
      const { data, error } = await admin.from('sales_time_entries')
        .insert({ setter_id: setter.id, started_at: new Date().toISOString(), source: 'timer' })
        .select('id, started_at').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, running: runningShape(data as { id: string; started_at: string }) })
    }

    if (b.action === 'stop') {
      if (!running) return NextResponse.json({ ok: true, running: null })
      const { error } = await admin.from('sales_time_entries')
        .update({ ended_at: new Date().toISOString(), note: String(b.note ?? '').trim() || null })
        .eq('id', (running as { id: string }).id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, running: null })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
