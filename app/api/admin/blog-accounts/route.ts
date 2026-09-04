import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { encryptSecret, isEncrypted } from '@/lib/crypto'
import { firstGenerationDate } from '@/lib/blog-dates'
import { validateFramerConfig, analyzeFramerProject, listFramerFields, suggestFieldMap, type FramerClientConfig } from '@/lib/framer'
import { analyzeWebsiteDeep, buildSiteSignature } from '@/lib/website-analyze'
import { computeHealth } from '@/lib/blog-health'
import { getCronState, runWebsiteMonitor } from '@/lib/blog-automation'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// connect_framer / reanalyze / monitor doen externe calls (Framer + website-scrape
// + AI) die even kunnen duren; verhoog de tijdslimiet zodat ze niet afkappen.
export const maxDuration = 60

// GET — alle blogaccounts + tellingen + klanten voor koppeling
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const [{ data: accounts }, { data: blogs }, { data: clients }, cron] = await Promise.all([
      admin.from('blog_accounts').select('*').order('name'),
      admin.from('blogs').select('account_id, status, sync_status'),
      admin.from('clients').select('id, company_name').is('archived_at', null).order('company_name'),
      getCronState(),
    ])
    const nameById = new Map((clients ?? []).map((c: { id: string; company_name: string }) => [c.id, c.company_name]))
    const blogRows = (blogs ?? []) as { account_id: string | null; status: string; sync_status: string | null }[]
    const cnt = (id: string, st: string) => blogRows.filter((b) => b.account_id === id && b.status === st).length
    const syncProb = (id: string) => blogRows.filter((b) => b.account_id === id && (b.sync_status === 'failed' || b.sync_status === 'pending')).length
    const totalOf = (id: string) => blogRows.filter((b) => b.account_id === id).length

    const rows = ((accounts ?? []) as Record<string, unknown>[]).map((a) => {
      const id = a.id as string
      const cfg = { projectUrl: a.framer_project_url as string | null, apiKeyEncrypted: a.framer_api_key as string | null, collectionId: a.framer_blog_collection_id as string | null, fieldMap: (a.framer_field_map ?? null) as Record<string, string> | null }
      const framer_valid = validateFramerConfig(cfg).ok
      const published = cnt(id, 'gepubliceerd'), review = cnt(id, 'klaar_voor_review'), failed = cnt(id, 'gefaald')
      const sync_problems = syncProb(id)
      const monitor = (a.website_monitor ?? null) as { changed?: boolean; details?: string[]; last_checked?: string } | null
      const health = computeHealth({
        hasBriefing: !!(a.briefing as string)?.trim(), hasKnowledge: !!a.knowledge, websiteAnalyzed: !!a.website_analysis,
        framerValid: framer_valid, published, review, failed, syncProblems: sync_problems, total: totalOf(id),
        maxLiveBlogs: (a.max_live_blogs as number | null) ?? null, websiteChanged: !!monitor?.changed, cronOk: cron.ok, active: !!a.active,
      })
      return {
        id, name: a.name, website_url: a.website_url, client_id: a.client_id,
        client_name: a.client_id ? (nameById.get(a.client_id as string) ?? null) : null,
        active: a.active, frequentie_maanden: a.frequentie_maanden, aantal_per_cyclus: a.aantal_per_cyclus,
        startdatum: a.startdatum, volgende_generatie_datum: a.volgende_generatie_datum, max_live_blogs: a.max_live_blogs,
        briefing: a.briefing, framer_project_url: a.framer_project_url, framer_blog_collection_id: a.framer_blog_collection_id,
        framer_field_map: a.framer_field_map, has_api_key: !!a.framer_api_key, api_key_encrypted: isEncrypted(a.framer_api_key as string),
        framer_valid, website_analyzed_at: a.website_analyzed_at ?? null, has_analysis: !!a.website_analysis,
        knowledge: a.knowledge ?? null, has_knowledge: !!a.knowledge,
        website_changed: !!monitor?.changed, website_change_details: monitor?.details ?? [], website_monitor_at: monitor?.last_checked ?? null,
        published, review, failed, sync_problems,
        health_score: health.score, health_status: health.status, warnings: health.warnings,
      }
    })
    return NextResponse.json({ accounts: rows, clients: clients ?? [], cron })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const admin = createAdminSupabaseClient()

    // 1-klik "Koppel Framer": detecteert automatisch de blogcollectie + velden
    // en bewaart die. De gebruiker hoeft geen Collection ID of Field Map te zien.
    if (b.action === 'connect_framer') {
      if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
      const { data: acc } = await admin.from('blog_accounts').select('framer_project_url, framer_api_key').eq('id', b.id).maybeSingle()
      if (!acc) return NextResponse.json({ error: 'Blogproject niet gevonden' }, { status: 404 })
      const config: FramerClientConfig = { projectUrl: acc.framer_project_url, apiKeyEncrypted: acc.framer_api_key, collectionId: null, fieldMap: null }
      if (!config.projectUrl) return NextResponse.json({ error: 'Vul eerst de Framer projectlink in.' }, { status: 400 })
      if (!config.apiKeyEncrypted) return NextResponse.json({ error: 'Vul eerst de Framer toegangssleutel in.' }, { status: 400 })

      const r = await analyzeFramerProject(config)
      if (!r.ok) return NextResponse.json({ error: r.error || 'Kon geen verbinding maken met Framer.' }, { status: 400 })
      // Kies de blogcollectie: gedetecteerd, anders de enige/eerste collectie.
      let collectionId = r.detectedId ?? null
      let fieldMap = r.suggested ?? null
      if (!collectionId) {
        const first = (r.collections ?? [])[0]
        if (!first) return NextResponse.json({ error: 'Geen CMS-collecties gevonden in dit Framer-project.' }, { status: 400 })
        collectionId = first.id
      }
      // Velden ophalen indien nog niet voorgesteld (bv. bij meerdere collecties).
      if (!fieldMap || Object.keys(fieldMap).length === 0) {
        const f = await listFramerFields(config, collectionId)
        if (f.ok && f.fields) fieldMap = suggestFieldMap(f.fields)
      }
      if (!fieldMap || !fieldMap.titel || !fieldMap.content) {
        return NextResponse.json({ error: 'Verbonden, maar kon de titel-/inhoudvelden niet automatisch herkennen in de collectie.' }, { status: 400 })
      }
      await admin.from('blog_accounts').update({ framer_blog_collection_id: collectionId, framer_field_map: fieldMap }).eq('id', b.id)
      try { revalidatePath('/admin/blogaccounts') } catch { }
      const colName = (r.collections ?? []).find((c) => c.id === collectionId)?.name ?? 'blogcollectie'
      return NextResponse.json({ ok: true, collection: colName })
    }

    // Website opnieuw analyseren (gecached resultaat verversen).
    if (b.action === 'reanalyze') {
      if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
      const { data: acc } = await admin.from('blog_accounts').select('id, website_url').eq('id', b.id).maybeSingle()
      if (!acc) return NextResponse.json({ error: 'Blogaccount niet gevonden' }, { status: 404 })
      if (!acc.website_url) return NextResponse.json({ error: 'Geen website-URL ingesteld voor dit account.' }, { status: 400 })
      const analysis = await analyzeWebsiteDeep(acc.website_url)
      if (!analysis) return NextResponse.json({ error: 'Website kon niet geanalyseerd worden (niet bereikbaar of geen inhoud).' }, { status: 400 })
      // Monitor-baseline meteen verversen → "gewijzigd"-vlag wordt gewist.
      const sig = await buildSiteSignature(acc.website_url)
      const monitor = sig ? { last_checked: new Date().toISOString(), signature: sig, changed: false, details: [] } : undefined
      await admin.from('blog_accounts').update({ website_analysis: analysis, website_analyzed_at: new Date().toISOString(), ...(monitor ? { website_monitor: monitor } : {}) }).eq('id', b.id)
      try { revalidatePath('/admin/blogaccounts') } catch { }
      return NextResponse.json({ ok: true, analysis })
    }

    // Handmatige website-monitor (1 account of allemaal).
    if (b.action === 'monitor') {
      const r = await runWebsiteMonitor({ force: true })
      try { revalidatePath('/admin/blogaccounts') } catch { }
      return NextResponse.json({ ok: true, ...r })
    }

    if (!b.name?.trim()) return NextResponse.json({ error: 'Naam is verplicht' }, { status: 400 })
    const freq = Math.max(1, Number(b.frequentie_maanden) || 1)
    const start = b.startdatum || null
    const insert: Record<string, unknown> = {
      name: String(b.name).slice(0, 160), website_url: b.website_url || null, briefing: b.briefing || null,
      client_id: b.client_id || null, frequentie_maanden: freq, aantal_per_cyclus: Math.max(1, Number(b.aantal_per_cyclus) || 1),
      startdatum: start, max_live_blogs: b.max_live_blogs ? Math.max(1, Number(b.max_live_blogs)) : null,
      framer_project_url: b.framer_project_url || null, framer_blog_collection_id: b.framer_blog_collection_id || null,
      framer_field_map: b.framer_field_map ?? null, active: b.active !== false, created_by: actor.id,
      volgende_generatie_datum: b.volgende_generatie_datum || (start ? firstGenerationDate(start, freq) : null),
      knowledge: b.knowledge ?? null,
    }
    if (typeof b.framer_api_key === 'string' && b.framer_api_key.trim()) insert.framer_api_key = encryptSecret(b.framer_api_key.trim())
    const { data, error } = await admin.from('blog_accounts').insert(insert).select('id').single()
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin/blogaccounts') } catch { }
    return NextResponse.json({ id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 400 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const patch: Record<string, unknown> = {}
    const map: Record<string, string> = {
      name: 'name', website_url: 'website_url', briefing: 'briefing', client_id: 'client_id',
      framer_project_url: 'framer_project_url', framer_blog_collection_id: 'framer_blog_collection_id',
      volgende_generatie_datum: 'volgende_generatie_datum', startdatum: 'startdatum',
    }
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) patch[col] = b[k] || null
    if (b.frequentie_maanden !== undefined) patch.frequentie_maanden = Math.max(1, Number(b.frequentie_maanden) || 1)
    if (b.aantal_per_cyclus !== undefined) patch.aantal_per_cyclus = Math.max(1, Number(b.aantal_per_cyclus) || 1)
    if (b.max_live_blogs !== undefined) patch.max_live_blogs = b.max_live_blogs ? Math.max(1, Number(b.max_live_blogs)) : null
    if (b.active !== undefined) patch.active = !!b.active
    if (b.knowledge !== undefined) patch.knowledge = b.knowledge || null
    if (b.framer_field_map !== undefined) {
      let fm = b.framer_field_map
      if (typeof fm === 'string') { try { fm = fm.trim() ? JSON.parse(fm) : null } catch { return NextResponse.json({ error: 'Field map is geen geldige JSON' }, { status: 400 }) } }
      patch.framer_field_map = fm || null
    }
    if (typeof b.framer_api_key === 'string' && b.framer_api_key.trim()) patch.framer_api_key = encryptSecret(b.framer_api_key.trim())
    else if (b.framer_api_key === null) patch.framer_api_key = null
    // Briefing gewijzigd → website-analyse markeren als verouderd zodat de
    // volgende generatie ze opnieuw uitvoert (zonder hier te blokkeren op een fetch).
    if (b.briefing !== undefined) patch.website_analyzed_at = null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    const { error } = await admin.from('blog_accounts').update(patch).eq('id', b.id)
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin/blogaccounts') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id=[&force=1] — met blogs eraan vereist ?force=1 (cascade verwijdert
// dan ook alle blogs van het project). Zonder force geven we het aantal terug
// zodat de UI een duidelijke bevestiging kan tonen.
export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id')
    const force = req.nextUrl.searchParams.get('force') === '1'
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { count } = await admin.from('blogs').select('id', { count: 'exact', head: true }).eq('account_id', id)
    if ((count ?? 0) > 0 && !force) {
      return NextResponse.json({ error: 'Dit project heeft blogs.', needsForce: true, blogCount: count ?? 0 }, { status: 409 })
    }
    const { error } = await admin.from('blog_accounts').delete().eq('id', id)
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin/blogaccounts'); revalidatePath('/admin/blog-calendar') } catch { }
    return NextResponse.json({ ok: true, deletedBlogs: count ?? 0 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
