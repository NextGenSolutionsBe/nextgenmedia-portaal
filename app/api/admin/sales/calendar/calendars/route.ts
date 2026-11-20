import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { listCalendars, defaultBusyIds, setBusyCalendars } from '@/lib/sales/google-calendar'
import { getOrCreateSalesOrg } from '@/lib/sales/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * De agenda's binnen één gekoppeld Google-account, en welke daarvan als bezet
 * meetellen. Een account heeft er meestal meerdere (Marco, Bram, Chiara, ...);
 * die moeten allemaal kunnen blokkeren, anders lijkt een bezet uur vrij.
 */

/** Hoort deze koppeling bij ónze pipeline? Voorkomt dat een id van buiten werkt. */
async function ownConnection(connectionId: string): Promise<boolean> {
  if (!connectionId) return false
  const admin = createAdminSupabaseClient()
  const pipeline = await getOrCreateSalesOrg()
  const { data } = await admin.from('sales_calendar_connections')
    .select('id').eq('id', connectionId).eq('sales_client_id', pipeline.id).maybeSingle()
  return !!data
}

// GET ?connection=<id>
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const connectionId = req.nextUrl.searchParams.get('connection') ?? ''
    if (!(await ownConnection(connectionId))) {
      return NextResponse.json({ error: 'Agenda niet gevonden' }, { status: 404 })
    }

    const admin = createAdminSupabaseClient()
    const { data: conn } = await admin.from('sales_calendar_connections')
      .select('*').eq('id', connectionId).maybeSingle()

    const calendars = await listCalendars(connectionId)
    const stored = (conn as { busy_calendar_ids?: string[] | null } | null)?.busy_calendar_ids
    // Nog niets opgeslagen → toon de standaardkeuze, zodat het scherm laat zien
    // wat er op dit moment écht meetelt.
    const selected = Array.isArray(stored) && stored.length > 0 ? stored : defaultBusyIds(calendars)

    return NextResponse.json({ calendars, selected, writeTarget: (conn as { calendar_id?: string } | null)?.calendar_id ?? null })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST { connection, ids: string[] } — welke agenda's blokkeren.
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const connectionId = String(b.connection ?? '')
    if (!(await ownConnection(connectionId))) {
      return NextResponse.json({ error: 'Agenda niet gevonden' }, { status: 404 })
    }

    // Enkel id's die écht bij dit account horen — nooit blind opslaan wat de
    // browser meestuurt.
    const valid = new Set((await listCalendars(connectionId)).map((c) => c.id))
    const ids = (Array.isArray(b.ids) ? b.ids : [])
      .map((v: unknown) => String(v))
      .filter((v: string) => valid.has(v))

    await setBusyCalendars(connectionId, ids)
    return NextResponse.json({ ok: true, count: ids.length })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
