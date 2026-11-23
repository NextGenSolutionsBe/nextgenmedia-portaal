import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { syncMerk } from '@/lib/metricool-stats-server'
import { metricoolConfigured } from '@/lib/metricool'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Admin: de stand van de statistieken-sync per merk.
 *  GET ?blog=<id>  → laatste sync, welke metric per cijfer werkte, fouten
 *  POST { blog_id, volledig? } → dit merk nu bijwerken
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const blog = req.nextUrl.searchParams.get('blog') ?? ''
  if (!/^\d{1,20}$/.test(blog)) return NextResponse.json({ error: 'Ongeldig merk.' }, { status: 400 })
  const { data } = await createAdminSupabaseClient().from('metricool_sync').select('*').eq('blog_id', blog).maybeSingle()
  return NextResponse.json({ configured: metricoolConfigured(), sync: data ?? null })
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { blog_id?: unknown; volledig?: unknown }
    const blog = typeof b.blog_id === 'string' && /^\d{1,20}$/.test(b.blog_id) ? b.blog_id : null
    if (!blog) return NextResponse.json({ error: 'Ongeldig merk.' }, { status: 400 })
    if (!metricoolConfigured()) return NextResponse.json({ error: 'Metricool is niet ingesteld.' }, { status: 400 })
    const u = await syncMerk(createAdminSupabaseClient(), blog, { volledig: b.volledig === true, deadline: Date.now() + 50_000 })
    return NextResponse.json({ ok: true, ...u })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Bijwerken mislukt') }, { status: 500 })
  }
}
