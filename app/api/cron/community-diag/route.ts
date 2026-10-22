import { NextRequest, NextResponse } from 'next/server'
import { metricoolConfigured, listBrands } from '@/lib/metricool'
import { diagnoseInbox } from '@/lib/metricool-inbox'
import { cronGeautoriseerd } from '@/lib/community/cron-auth'
import { DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Inbox-diagnose zonder login, enkel met het community-cron-geheim (x-sync-secret).
 * Zelfde uitvoer als /api/admin/metricool/diag?inbox=1 — LEEST enkel, wijzigt niets.
 * Bedoeld om de veldnamen van de Metricool-inbox te bevestigen (stap 0).
 *   ?brands=1                          de merken
 *   ?blogId=123&netwerk=instagram      comments, gesprekken en authorizations
 */
export async function GET(req: NextRequest) {
  const toegang = await cronGeautoriseerd(req)
  if (toegang === 'onbereikbaar') return NextResponse.json({ error: DATABANK_TIJDELIJK }, { status: 503 })
  if (toegang === 'nee') return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  if (!metricoolConfigured()) return NextResponse.json({ configured: false })
  const sp = req.nextUrl.searchParams
  try {
    if (sp.get('brands') === '1') return NextResponse.json({ brands: await listBrands() })
    const blogId = sp.get('blogId')
    if (!blogId) return NextResponse.json({ error: 'blogId is verplicht (zie ?brands=1).' }, { status: 400 })
    const netwerk = (sp.get('netwerk') ?? 'instagram').toLowerCase()
    return NextResponse.json({ blogId, netwerk, inbox: await diagnoseInbox(blogId, netwerk) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fout' }, { status: 400 })
  }
}
