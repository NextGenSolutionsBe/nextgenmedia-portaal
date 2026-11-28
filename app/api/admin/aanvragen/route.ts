import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { teamOverzicht } from '@/lib/aanvragen/server'
import { soortUit } from '@/lib/aanvragen/portaal'

export const dynamic = 'force-dynamic'

/** Aanvragen uit het klantportaal. GET ?soort=dienst|consultancy (diensten en consultancy apart). */
export async function GET(req: NextRequest) {
  try {
    if (!(await magIk('aanvragen', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang tot Aanvragen.' }, { status: 403 })
    return NextResponse.json({ aanvragen: await teamOverzicht(createAdminSupabaseClient(), soortUit(req.nextUrl.searchParams.get('soort'))) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'aanvragen.GET') }, { status: 500 }) }
}
