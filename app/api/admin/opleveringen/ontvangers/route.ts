import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { laadOntvangers } from '@/lib/opleveringen-ontvangers-server'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** GET ?client_id= — wie de mail over een oplevering kan krijgen: alle accounts van de klant en het klantadres. */
export async function GET(req: NextRequest) {
  try {
    if (!(await magIk('opleveringen', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
    const clientId = req.nextUrl.searchParams.get('client_id') ?? ''
    if (!UUID.test(clientId)) return NextResponse.json({ error: 'Ongeldige klant.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const r = await laadOntvangers(admin as unknown as Parameters<typeof laadOntvangers>[0], clientId)
    if (!r.klant) return NextResponse.json({ error: 'Klant niet gevonden.' }, { status: 404 })
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'opleveringen.ontvangers') }, { status: 500 }) }
}
