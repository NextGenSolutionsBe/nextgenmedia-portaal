import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { cronToegang } from '@/lib/meetings/cron-toegang'
import { syncMerk, syncVolgende } from '@/lib/metricool-stats-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * De Metricool-statistieken bijwerken (lib/metricool-stats-server.ts).
 * Aangeroepen door pg_cron (job 'metricool-statistieken', elke 10 minuten) met
 * het geheim van de scheduler (cron_geheimen 'klantmeetings'); zonder geldig
 * geheim gebeurt er niets. Eén merk per ronde, wat ouder is dan 6 uur.
 * Body { blog: "<blogId>", volledig: true } werkt één merk meteen bij.
 */
export async function POST(req: NextRequest) {
  const toegang = await cronToegang(req)
  if (toegang === 'onbereikbaar') return NextResponse.json({ error: 'Databank even niet bereikbaar' }, { status: 503 })
  if (toegang !== 'ja') return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const b = (await req.json().catch(() => ({}))) as { blog?: unknown; volledig?: unknown }
  const admin = createAdminSupabaseClient()
  if (typeof b.blog === 'string' && /^\d{1,20}$/.test(b.blog)) {
    const u = await syncMerk(admin, b.blog, { volledig: b.volledig === true, deadline: Date.now() + 50_000 })
    return NextResponse.json({ ok: true, gedaan: [u] })
  }
  const r = await syncVolgende(admin, { budgetMs: 50_000 })
  return NextResponse.json({ ok: true, ...r, gedaan: r.gedaan.map((g) => ({ blog_id: g.blog_id, cijfers: g.cijfers, posts: g.posts, netwerken: g.netwerken, fouten: g.fouten.length })) })
}
