import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'
import {
  validateFramerConfig, listFramerCollections, listFramerFields, suggestFieldMap,
  analyzeFramerProject, testPublish, friendlyMissing, testFramerConnection, logFramerAction, type FramerClientConfig,
} from '@/lib/framer'

// Framer-verbindingen + publicaties zijn externe calls die kunnen aanslepen.
export const maxDuration = 60

type AccountRow = {
  id: string; name: string; framer_project_url: string | null; framer_api_key: string | null
  framer_blog_collection_id: string | null; framer_field_map: unknown; framer_last_sync: string | null
  briefing?: string | null
}

const configOf = (a: AccountRow): FramerClientConfig => ({
  projectUrl: a.framer_project_url, apiKeyEncrypted: a.framer_api_key,
  collectionId: a.framer_blog_collection_id, fieldMap: (a.framer_field_map ?? null) as Record<string, string> | null,
})

// GET — overzicht per blogaccount + dashboardstats, of ?logs=<account_id>
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()

    const logsFor = req.nextUrl.searchParams.get('logs')
    if (logsFor) {
      const { data } = await admin.from('framer_logs').select('id, actie, status, foutmelding, created_at').eq('account_id', logsFor).order('created_at', { ascending: false }).limit(50)
      return NextResponse.json({ logs: data ?? [] })
    }

    const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
    const [{ data: accounts }, { data: blogs }, { data: logs }] = await Promise.all([
      admin.from('blog_accounts').select('id, name, framer_project_url, framer_api_key, framer_blog_collection_id, framer_field_map, framer_last_sync, briefing').order('name'),
      admin.from('blogs').select('account_id, status'),
      admin.from('framer_logs').select('actie, status, created_at').gte('created_at', startToday.toISOString()),
    ])
    const blogRows = (blogs ?? []) as { account_id: string | null; status: string }[]
    const cnt = (id: string, st: string) => blogRows.filter((b) => b.account_id === id && b.status === st).length

    const rows = ((accounts ?? []) as AccountRow[]).map((a) => {
      const cfg = configOf(a)
      const valid = validateFramerConfig(cfg).ok
      const missing = friendlyMissing(cfg, { brandContext: !!a.briefing })
      const failed = cnt(a.id, 'gefaald')
      const state = failed > 0 ? 'rood' : (valid && missing.length === 0) ? 'groen' : 'oranje'
      return {
        id: a.id, company_name: a.name, connected: !!(a.framer_project_url && a.framer_api_key),
        project_url: a.framer_project_url, collection_linked: !!a.framer_blog_collection_id, framer_valid: valid,
        missing, last_sync: a.framer_last_sync,
        published: cnt(a.id, 'gepubliceerd'), review: cnt(a.id, 'klaar_voor_review'), approved: cnt(a.id, 'goedgekeurd'), failed, state,
      }
    })

    const publishedToday = (logs ?? []).filter((l: { actie: string; status: string }) => l.actie === 'publish' && l.status === 'ok').length
    const failedToday = (logs ?? []).filter((l: { status: string }) => l.status === 'gefaald').length
    const stats = {
      linkedProjects: rows.filter((r) => r.framer_valid).length,
      activeProjects: rows.filter((r) => r.connected).length,
      publishedToday, failedTotal: rows.reduce((s, r) => s + r.failed, 0), failedToday,
      readyToPublish: rows.reduce((s, r) => s + r.review + r.approved, 0),
    }
    return NextResponse.json({ rows, stats })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST { action, account_id, collection_id? }
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    if (!b.account_id) return NextResponse.json({ error: 'account_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: a } = await admin.from('blog_accounts').select('id, name, framer_project_url, framer_api_key, framer_blog_collection_id, framer_field_map, framer_last_sync, briefing').eq('id', b.account_id).maybeSingle()
    if (!a) return NextResponse.json({ error: 'Blogaccount niet gevonden' }, { status: 404 })
    const config = configOf(a as AccountRow)

    if (b.action === 'test') {
      const r = await testFramerConnection(config)
      await logFramerAction(b.account_id, null, 'test', r.ok ? 'ok' : 'gefaald', r.ok ? null : r.error)
      return NextResponse.json(r)
    }
    if (b.action === 'collections') {
      const r = await listFramerCollections(config)
      await logFramerAction(b.account_id, null, 'connect', r.ok ? 'ok' : 'gefaald', r.ok ? null : r.error)
      return NextResponse.json(r)
    }
    if (b.action === 'fields') {
      const collId = b.collection_id || a.framer_blog_collection_id
      if (!collId) return NextResponse.json({ error: 'Geen collectie geselecteerd' }, { status: 400 })
      const r = await listFramerFields(config, collId)
      if (r.ok && r.fields) return NextResponse.json({ ok: true, fields: r.fields, suggested: suggestFieldMap(r.fields) })
      return NextResponse.json(r)
    }
    if (b.action === 'analyze') {
      const r = await analyzeFramerProject(config)
      await logFramerAction(b.account_id, null, 'connect', r.ok ? 'ok' : 'gefaald', r.ok ? null : r.error)
      return NextResponse.json(r)
    }
    if (b.action === 'test_publish') {
      const r = await testPublish(config)
      await logFramerAction(b.account_id, null, 'publish', r.ok ? 'ok' : 'gefaald', r.ok ? 'Testpublicatie ok' : `Testpublicatie: ${r.error}`)
      return NextResponse.json(r)
    }
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
