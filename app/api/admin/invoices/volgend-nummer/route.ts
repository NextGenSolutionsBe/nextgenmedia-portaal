import { NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { volgendNummer } from '@/lib/facturatie/factuurnummer-server'

export const dynamic = 'force-dynamic'

/** GET → het volgende externe factuurnummer ({ nummer: '2026-124', laatste: '2026-123' }). Module Facturen (middleware). */
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    return NextResponse.json(await volgendNummer(createAdminSupabaseClient()))
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
