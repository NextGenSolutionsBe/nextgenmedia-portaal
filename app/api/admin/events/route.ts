import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { valideerEvent, type KlantEvent } from '@/lib/events'
import { agendaOpties, bezetting, standaardAgenda } from '@/lib/events-server'

export const dynamic = 'force-dynamic'

/**
 * Workshops & events (admin).
 *   GET  → alle events met het aantal inschrijvingen en wat nog te factureren is,
 *          plus de Google-agenda's om uit te kiezen.
 *   POST → nieuw concept (nog niet zichtbaar voor klanten, nog niets in Google).
 */
export async function GET() {
  if (!(await magIk('events', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
  try {
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('klant_events').select('*').order('start_op', { ascending: false }).limit(500)
    if (error) throw new Error(error.message)
    const events = (data ?? []) as KlantEvent[]
    const ids = events.map((e) => e.id)
    const [bezet, { data: fact }, agendas, standaard] = await Promise.all([
      bezetting(admin, ids),
      ids.length ? admin.from('klant_event_inschrijvingen').select('event_id, prijs_cents').in('event_id', ids).eq('factuur_status', 'te_factureren').limit(20000) : Promise.resolve({ data: [] }),
      agendaOpties(admin),
      standaardAgenda(admin),
    ])
    const teFact = new Map<string, { aantal: number; cents: number }>()
    for (const r of (fact ?? []) as { event_id: string; prijs_cents: number }[]) {
      const t = teFact.get(r.event_id) ?? { aantal: 0, cents: 0 }
      teFact.set(r.event_id, { aantal: t.aantal + 1, cents: t.cents + (r.prijs_cents ?? 0) })
    }
    return NextResponse.json({
      events: events.map((e) => ({ ...e, ingeschreven: bezet.get(e.id) ?? 0, te_factureren: teFact.get(e.id) ?? { aantal: 0, cents: 0 } })),
      agendas, standaardAgenda: standaard,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'events.GET') }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try {
    const persoon = await magIk('events', 'toevoegen')
    if (!persoon) return NextResponse.json({ error: 'Je mag geen events aanmaken.' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const v = valideerEvent(b)
    if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const agenda = v.waarde.agenda_id ?? await standaardAgenda(admin)
    const { data, error } = await admin.from('klant_events').insert({ ...v.waarde, agenda_id: agenda, status: 'concept', created_by_email: persoon.email ?? null }).select('*').single()
    if (error) throw new Error(error.message)
    await logAudit({ action: 'event.aangemaakt', entityType: 'klant_event', entityId: data.id, actorUserId: persoon.userId, actorEmail: persoon.email, summary: v.waarde.titel }).catch(() => null)
    return NextResponse.json({ event: data })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'events.POST') }, { status: 500 }) }
}
