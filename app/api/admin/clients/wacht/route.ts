import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { wachtOpKlanten } from '@/lib/klant-wacht-server'

export const dynamic = 'force-dynamic'

/** Wat bij klanten vastzit (fase 6, punt 70). Module Klanten (middleware); enkel lezen. */
export async function GET() {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    return NextResponse.json({ rijen: await wachtOpKlanten(createAdminSupabaseClient()) })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 500 }) }
}
