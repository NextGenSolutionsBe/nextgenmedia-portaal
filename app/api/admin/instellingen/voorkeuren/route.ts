import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesPersoon } from '@/lib/instellingen/laden'
import { MODULES, moduleInfo } from '@/lib/instellingen/model'

export const dynamic = 'force-dynamic'

/**
 * Persoonlijke zichtbaarheid: welke tabbladen verbergt deze gebruiker enkel
 * voor zichzelf? Raakt niemand anders en geen rechten — puur de eigen zijbalk.
 */
export async function GET() {
  try {
    const persoon = await leesPersoon()
    if (!persoon) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('gebruikers_voorkeuren').select('verborgen_modules').eq('auth_user_id', persoon.userId).maybeSingle()
    return NextResponse.json({ verborgen: Array.isArray(data?.verborgen_modules) ? data!.verborgen_modules : [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const persoon = await leesPersoon()
    if (!persoon) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => null)) as { verborgen?: unknown } | null
    const geldig = new Set(MODULES.map((m) => m.key))
    const verborgen = (Array.isArray(b?.verborgen) ? b!.verborgen : [])
      .filter((k): k is string => typeof k === 'string' && geldig.has(k))
      // Vergrendelde onderdelen (Command Center, Instellingen) blijven altijd zichtbaar.
      .filter((k) => !moduleInfo(k)?.vergrendeld)
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('gebruikers_voorkeuren').upsert({ auth_user_id: persoon.userId, verborgen_modules: verborgen, updated_at: new Date().toISOString() }, { onConflict: 'auth_user_id' })
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin', 'layout') } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, verborgen })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
