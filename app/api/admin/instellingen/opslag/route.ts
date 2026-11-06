import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { eisBeheer } from '@/lib/instellingen/api'
import { samenvatting, type RuwVerbruik } from '@/lib/opslag'
import { safeMessage } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

/**
 * Opslagverbruik (databank + bestanden) van deze app. Enkel cijfers per
 * onderdeel, geen bestandsnamen. Wie de instellingen mag beheren, ziet het
 * ook onderaan de zijbalk.
 */
export async function GET() {
  const g = await eisBeheer()
  if (!g.ok) return g.response
  try {
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.rpc('opslag_verbruik')
    if (error) throw new Error(error.message)
    return NextResponse.json({ opslag: samenvatting(data as RuwVerbruik), op: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, max-age=300' } })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Opslag kon niet gelezen worden') }, { status: 500 })
  }
}
