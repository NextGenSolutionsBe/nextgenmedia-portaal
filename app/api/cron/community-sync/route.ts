import { NextRequest, NextResponse } from 'next/server'
import { cronGeautoriseerd } from '@/lib/community/cron-auth'
import { draaiCommunitySync } from '@/lib/community/sync'
import { DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Community management: comments en DM's uit Metricool ophalen, elke tien
 * minuten (pg_cron, job 'community-sync'). Geen AI, niets versturen.
 * Geheim in cron_geheimen (sleutel 'community_sync'), header x-sync-secret.
 */
export async function POST(req: NextRequest) {
  const toegang = await cronGeautoriseerd(req)
  if (toegang === 'onbereikbaar') return NextResponse.json({ error: DATABANK_TIJDELIJK }, { status: 503, headers: { 'Retry-After': '30' } })
  if (toegang === 'nee') return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const r = await draaiCommunitySync()
  return NextResponse.json(r, { status: r.ok ? 200 : 500 })
}

export const GET = POST
