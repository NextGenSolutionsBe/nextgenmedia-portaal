import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { generatePlan } from '@/lib/content-planner'
import { normaliseerKanalen } from '@/lib/social-platforms'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// GET — fetch the social-media config for a client (pre-fills the dialog)
export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get('clientId')
    if (!clientId) return NextResponse.json({ error: 'clientId vereist' }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    // This is an /api/admin route returning client business data — require admin,
    // not merely an authenticated session.
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()

    const [{ data: client }, { data: sc }] = await Promise.all([
      admin.from('clients').select('niche, company_name').eq('id', clientId).maybeSingle(),
      admin
        .from('service_contracts')
        .select('config, start_date')
        .eq('client_id', clientId)
        .eq('service_slug', 'social-media')
        .maybeSingle(),
    ])

    const cfg = (sc?.config ?? {}) as Record<string, unknown>

    return NextResponse.json({
      niche: client?.niche ?? '',
      company_name: client?.company_name ?? '',
      start_date: sc?.start_date ?? null,
      postsPerMonth: Number(cfg.posts ?? 0),
      reelsPerMonth: Number(cfg.reels ?? 0),
      storiesPerMonth: Number(cfg.stories ?? 0),
      channels: Array.isArray(cfg.channels) ? (cfg.channels as string[]) : [],
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — APPEND new planned content items
// IMPORTANT: this never deletes or overwrites existing content. Admin can re-run
// generation (e.g. once per platform) and items are simply added to the calendar.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const {
      clientId,
      months,
      postsPerMonth,
      reelsPerMonth,
      storiesPerMonth,
      channels,
      niche,
    } = await req.json()

    if (!clientId || !Array.isArray(months) || months.length === 0) {
      return NextResponse.json({ error: 'Ongeldige invoer' }, { status: 400 })
    }

    // Channels MUST come from request body — admin chooses per generation.
    // Kanalen normaliseren (Instagram/Facebook → Meta) en pas terugvallen op
    // Meta als er echt niets gekozen is; het scherm voorkomt dat normaal.
    const genormaliseerd = normaliseerKanalen(channels)
    const planChannels = genormaliseerd.length > 0 ? genormaliseerd : ['meta']

    const planned = generatePlan({
      months,
      postsPerMonth: postsPerMonth ?? 0,
      reelsPerMonth: reelsPerMonth ?? 0,
      storiesPerMonth: storiesPerMonth ?? 0,
      channels: planChannels,
      niche: niche ?? '',
    })

    if (planned.length === 0) {
      return NextResponse.json({ error: 'Geen items — pas de frequentie aan' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // APPEND only — do NOT delete existing items in the range
    const { data, error } = await admin
      .from('social_content_items')
      .insert(planned.map(item => ({
        ...item,
        client_id: clientId,
        platforms: item.platform ? [item.platform] : [],
      })))
      .select('id, client_id, planned_date, platform, platforms, content_type, title, status')

    if (error) throw new Error(error.message)

    try {
      revalidatePath('/admin/services/social-media')
      revalidatePath('/portal/social-media')
    } catch { }

    return NextResponse.json({ ok: true, created: data?.length ?? 0, items: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
