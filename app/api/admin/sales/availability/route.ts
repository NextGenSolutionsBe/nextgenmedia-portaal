import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'

export const dynamic = 'force-dynamic'

// GET — werkuren, uitzonderingen en boekingsregels van de pipeline (§8).
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const client = (await getOrCreateSalesOrg()).id
    const admin = createAdminSupabaseClient()
    const [{ data: rules }, { data: exceptions }, { data: c }, { data: conn }] = await Promise.all([
      admin.from('sales_availability_rules').select('*').eq('sales_client_id', client).order('weekday'),
      admin.from('sales_availability_exceptions').select('*').eq('sales_client_id', client).order('date'),
      admin.from('sales_clients').select('*').eq('id', client).maybeSingle(),
      admin.from('sales_calendar_connections').select('id, name, provider, account_email, status, active').eq('sales_client_id', client).order('name'),
    ])
    return NextResponse.json({ rules: rules ?? [], exceptions: exceptions ?? [], client: c, owners: conn ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — werkuren/uitzonderingen/regels opslaan. Werkuren worden in hun geheel
// vervangen: dat is eenvoudiger te begrijpen dan losse rijen bijwerken.
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const client = (await getOrCreateSalesOrg()).id
    const admin = createAdminSupabaseClient()

    // Voor wie gelden deze uren? Leeg = voor de hele klant (elke agenda zonder
    // eigen uren); een agenda-id = alleen voor die persoon.
    const scope: string | null = b.calendarId ? String(b.calendarId) : null
    const scoped = <T extends { eq: (c: string, v: unknown) => T; is: (c: string, v: null) => T }>(q: T): T =>
      scope ? q.eq('calendar_id', scope) : q.is('calendar_id', null)

    if (Array.isArray(b.rules)) {
      const rows = b.rules
        .filter((r: { start_time?: string; end_time?: string }) => r.start_time && r.end_time && r.end_time > r.start_time)
        .map((r: { weekday: number; start_time: string; end_time: string }) => ({
          sales_client_id: client, calendar_id: scope,
          weekday: Number(r.weekday), start_time: r.start_time, end_time: r.end_time,
        }))
      // Alleen de regels van dít bereik vervangen; die van andere personen
      // blijven staan.
      await scoped(admin.from('sales_availability_rules').delete().eq('sales_client_id', client))
      if (rows.length) await admin.from('sales_availability_rules').insert(rows)
    }

    if (Array.isArray(b.exceptions)) {
      await scoped(admin.from('sales_availability_exceptions').delete().eq('sales_client_id', client))
      const rows = b.exceptions
        .filter((e: { date?: string }) => !!e.date)
        .map((e: { date: string; closed?: boolean; start_time?: string; end_time?: string; note?: string }) => ({
          sales_client_id: client, calendar_id: scope, date: e.date, closed: e.closed !== false,
          start_time: e.closed === false ? e.start_time || null : null,
          end_time: e.closed === false ? e.end_time || null : null,
          note: e.note || null,
        }))
      if (rows.length) await admin.from('sales_availability_exceptions').insert(rows)
    }

    const settings: Record<string, unknown> = {}
    const nums = ['buffer_before_min','buffer_after_min','min_notice_min','max_horizon_days','max_per_day','slot_interval_min','default_duration_min'] as const
    for (const k of nums) if (b[k] !== undefined) settings[k] = Math.max(0, Number(b[k]) || 0)
    if (b.timezone) settings.timezone = String(b.timezone)

    // Herinneringsmails: lege lijst = uit. Ontdubbeld en gesorteerd, zodat
    // dezelfde dag niet twee keer in de lijst kan staan.
    if (Array.isArray(b.reminder_days_before)) {
      const days = [...new Set(
        b.reminder_days_before.map((d: unknown) => Math.round(Number(d))).filter((d: number) => Number.isFinite(d) && d >= 0 && d <= 60),
      )].sort((x, y) => (y as number) - (x as number))
      settings.reminder_days_before = days
    }
    if (b.reminder_sender_name !== undefined) {
      settings.reminder_sender_name = String(b.reminder_sender_name ?? '').trim() || null
    }
    if (Object.keys(settings).length) await admin.from('sales_clients').update(settings).eq('id', client)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
