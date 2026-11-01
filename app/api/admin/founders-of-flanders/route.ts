import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { valideerFoundersVideo, valideerKanaal, naarFoundersVideo, KANAAL_SLEUTEL } from '@/lib/founders-of-flanders'
import { waitUntil } from '@vercel/functions'
import { kopieerInstagramMedia, ontbrekendeMedia } from '@/lib/founders-media-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Founders of Flanders — voorbeeldvideo's. GET → alle (plus de kanaal-link),
 * POST → nieuwe video achteraan, PATCH { kanaal } → link naar het eigen YouTube-kanaal.
 * Volledig los van de nieuwsbrieven: hier staan enkel de video's die je zelf toevoegt.
 */
export async function GET() {
  if (!(await magIk('founders', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
  const admin = createAdminSupabaseClient()
  const [{ data, error }, { count }, { data: kanaal }] = await Promise.all([
    admin.from('founders_videos').select('*').order('volgorde').order('created_at'),
    admin.from('klant_aanvragen').select('id', { count: 'exact', head: true }).eq('soort', 'founders').in('status', ['ontvangen', 'in_behandeling', 'offerte', 'aanvaard']),
    admin.from('app_settings').select('value').eq('key', KANAAL_SLEUTEL).maybeSingle(),
  ])
  if (error) return NextResponse.json({ error: safeMessage(error, 'founders-of-flanders.GET') }, { status: 500 })
  // Instagram-video's die nog niet in de eigen opslag staan: op de achtergrond ophalen.
  const teHalen = ontbrekendeMedia((data ?? []) as Record<string, unknown>[])
  if (teHalen.length) waitUntil(Promise.all(teHalen.map((vid) => kopieerInstagramMedia(admin, vid).catch(() => null))).then(() => revalidatePath('/portal/founders')))
  return NextResponse.json({ videos: ((data ?? []) as Record<string, unknown>[]).map(naarFoundersVideo), open_aanvragen: count ?? 0, kanaal: typeof kanaal?.value === 'string' ? kanaal.value : null }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  try {
    if (!(await magIk('founders', 'toevoegen'))) return NextResponse.json({ error: 'Je mag geen video\'s toevoegen.' }, { status: 403 })
    const v = valideerFoundersVideo(await req.json().catch(() => ({})))
    if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: laatste } = await admin.from('founders_videos').select('volgorde').order('volgorde', { ascending: false }).limit(1).maybeSingle()
    const { data, error } = await admin.from('founders_videos').insert({ ...v.waarde, volgorde: (laatste?.volgorde ?? 0) + 1 }).select('*').single()
    if (error) throw new Error(error.message)
    // Instagram: miniatuur en video meteen naar de eigen opslag, zodat ze in de app speelt.
    const media = v.waarde.embed?.provider === 'instagram' ? await kopieerInstagramMedia(admin, String((data as { id: string }).id), { forceer: true }) : null
    revalidatePath('/portal/founders')
    return NextResponse.json({ video: data, media })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'founders-of-flanders.POST') }, { status: 500 }) }
}

export async function PATCH(req: NextRequest) {
  try {
    const persoon = await magIk('founders', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Je mag dit niet aanpassen.' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { kanaal?: unknown }
    const k = valideerKanaal(b.kanaal)
    if (!k.ok) return NextResponse.json({ error: k.fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('app_settings').upsert({ key: KANAAL_SLEUTEL, value: k.url, updated_at: new Date().toISOString(), updated_by_email: persoon.email }, { onConflict: 'key' })
    if (error) throw new Error(error.message)
    revalidatePath('/portal/founders')
    return NextResponse.json({ kanaal: k.url })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'founders-of-flanders.PATCH') }, { status: 500 }) }
}
