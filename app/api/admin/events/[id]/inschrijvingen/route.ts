import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { schrijfUit, syncGasten, stuurBevestiging } from '@/lib/events-server'

export const dynamic = 'force-dynamic'

/**
 * Een inschrijving beheren vanuit de admin.
 *   { inschrijving, actie: 'factuur', factuur_status: 'te_factureren' | 'gefactureerd' }
 *   { inschrijving, actie: 'uitschrijven' }        → van de gastenlijst, geen mail
 *   { inschrijving, actie: 'bevestiging_opnieuw' } → enkel als de vorige mislukte
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const persoon = await magIk('events', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Je mag inschrijvingen niet aanpassen.' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { inschrijving?: string; actie?: string; factuur_status?: string }
    const admin = createAdminSupabaseClient()
    const { data: rij } = await admin.from('klant_event_inschrijvingen').select('id, event_id, naam, prijs_cents, status, factuur_status, bevestiging_status').eq('id', String(b.inschrijving ?? '')).eq('event_id', params.id).maybeSingle()
    if (!rij) return NextResponse.json({ error: 'Inschrijving niet gevonden' }, { status: 404 })
    const audit = (actie: string) => logAudit({ action: `event.inschrijving.${actie}`, entityType: 'klant_event', entityId: params.id, actorUserId: persoon.userId, actorEmail: persoon.email, summary: String(rij.naam) }).catch(() => null)

    if (b.actie === 'factuur') {
      if (!(rij.prijs_cents > 0)) return NextResponse.json({ error: 'Dit was een gratis inschrijving.' }, { status: 400 })
      if (b.factuur_status !== 'te_factureren' && b.factuur_status !== 'gefactureerd') return NextResponse.json({ error: 'Onbekende status' }, { status: 400 })
      const { data, error } = await admin.from('klant_event_inschrijvingen').update({ factuur_status: b.factuur_status, updated_at: new Date().toISOString() }).eq('id', rij.id).select('*').single()
      if (error) throw new Error(error.message)
      await audit(b.factuur_status)
      return NextResponse.json({ inschrijving: data })
    }
    if (b.actie === 'uitschrijven') {
      const r = await schrijfUit(admin, rij.id, persoon.naam ?? persoon.email ?? 'NextGenMedia')
      if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 409 })
      waitUntil(syncGasten(admin, r.eventId).catch(() => null))
      await audit('uitgeschreven')
      return NextResponse.json({ ok: true })
    }
    if (b.actie === 'bevestiging_opnieuw') {
      if (rij.status !== 'ingeschreven') return NextResponse.json({ error: 'Deze persoon is uitgeschreven.' }, { status: 409 })
      if (rij.bevestiging_status !== 'mislukt') return NextResponse.json({ error: 'De bevestiging is al verstuurd of wordt verstuurd.' }, { status: 409 })
      await admin.from('klant_event_inschrijvingen').update({ bevestiging_status: 'nog_niet', bevestiging_fout: null }).eq('id', rij.id).eq('bevestiging_status', 'mislukt')
      const uitkomst = await stuurBevestiging(admin, rij.id)
      await audit('bevestiging_opnieuw')
      return uitkomst === 'verzonden' ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Versturen lukte niet. Bekijk de foutmelding bij de inschrijving.' }, { status: 502 })
    }
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) { return NextResponse.json({ error: safeMessage(err, 'events.inschrijvingen.PATCH') }, { status: 500 }) }
}
