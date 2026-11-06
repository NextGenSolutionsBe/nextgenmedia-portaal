import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { encryptSecret, isEncrypted } from '@/lib/crypto'
import { firstGenerationDate } from '@/lib/blog-dates'
import { validateFramerConfig } from '@/lib/framer'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// GET ?client_id= — bloginstellingen (API key NOOIT teruggeven, enkel of die bestaat)
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const clientId = req.nextUrl.searchParams.get('client_id')
    if (!clientId) return NextResponse.json({ error: 'client_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: c } = await admin.from('clients').select(
      'id, blogs_inbegrepen, blog_startdatum, blog_frequentie_maanden, blog_aantal_per_cyclus, blog_volgende_generatie_datum, blog_brand_context, framer_project_url, framer_api_key, framer_blog_collection_id, framer_field_map'
    ).eq('id', clientId).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })

    const cfg = {
      projectUrl: c.framer_project_url, apiKeyEncrypted: c.framer_api_key,
      collectionId: c.framer_blog_collection_id,
      fieldMap: (c.framer_field_map ?? null) as Record<string, string> | null,
    }
    const validation = validateFramerConfig(cfg)

    return NextResponse.json({
      settings: {
        blogs_inbegrepen: c.blogs_inbegrepen, blog_startdatum: c.blog_startdatum,
        blog_frequentie_maanden: c.blog_frequentie_maanden, blog_aantal_per_cyclus: c.blog_aantal_per_cyclus,
        blog_volgende_generatie_datum: c.blog_volgende_generatie_datum, blog_brand_context: c.blog_brand_context,
        framer_project_url: c.framer_project_url, framer_blog_collection_id: c.framer_blog_collection_id,
        framer_field_map: c.framer_field_map,
        has_api_key: !!c.framer_api_key, api_key_encrypted: isEncrypted(c.framer_api_key),
      },
      framerValid: validation.ok,
      framerMissing: validation.missing,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — bloginstellingen opslaan (API key wordt versleuteld bewaard)
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    if (!b.client_id) return NextResponse.json({ error: 'client_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()

    const patch: Record<string, unknown> = {}
    if (b.blogs_inbegrepen !== undefined) patch.blogs_inbegrepen = !!b.blogs_inbegrepen
    if (b.blog_startdatum !== undefined) patch.blog_startdatum = b.blog_startdatum || null
    if (b.blog_frequentie_maanden !== undefined) patch.blog_frequentie_maanden = Math.max(1, Number(b.blog_frequentie_maanden) || 1)
    if (b.blog_aantal_per_cyclus !== undefined) patch.blog_aantal_per_cyclus = Math.max(1, Number(b.blog_aantal_per_cyclus) || 1)
    if (b.blog_brand_context !== undefined) patch.blog_brand_context = b.blog_brand_context || null
    if (b.framer_project_url !== undefined) patch.framer_project_url = b.framer_project_url || null
    if (b.framer_blog_collection_id !== undefined) patch.framer_blog_collection_id = b.framer_blog_collection_id || null
    if (b.framer_field_map !== undefined) {
      let fm = b.framer_field_map
      if (typeof fm === 'string') { try { fm = fm.trim() ? JSON.parse(fm) : null } catch { return NextResponse.json({ error: 'Field map is geen geldige JSON' }, { status: 400 }) } }
      patch.framer_field_map = fm || null
    }
    // API key alleen overschrijven als er een nieuwe (niet-lege) waarde komt.
    if (typeof b.framer_api_key === 'string' && b.framer_api_key.trim()) {
      patch.framer_api_key = encryptSecret(b.framer_api_key.trim())
    } else if (b.framer_api_key === null) {
      patch.framer_api_key = null // expliciet wissen
    }

    // Volgende generatiedatum bepalen: bij inschakelen + startdatum, indien nog leeg.
    if (b.recompute_next_date || (patch.blogs_inbegrepen && b.blog_startdatum)) {
      const start = (b.blog_startdatum ?? null) as string | null
      const freq = Number(b.blog_frequentie_maanden) || 1
      if (start) patch.blog_volgende_generatie_datum = firstGenerationDate(start, freq)
    }
    if (b.blog_volgende_generatie_datum !== undefined) patch.blog_volgende_generatie_datum = b.blog_volgende_generatie_datum || null

    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    const { error } = await admin.from('clients').update(patch).eq('id', b.client_id)
    if (error) throw new Error(error.message)
    try { revalidatePath(`/admin/clients/${b.client_id}`) } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
