import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { valideerFoundersVideo } from '@/lib/founders-of-flanders'
import { kopieerInstagramMedia, wisInstagramMedia } from '@/lib/founders-media-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** PATCH → gegevens, of enkel { zichtbaar } / { volgorde }. DELETE → weg. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('founders', 'aanpassen'))) return NextResponse.json({ error: 'Je mag video\'s niet aanpassen.' }, { status: 403 })
    const { id } = await params
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    let patch: Record<string, unknown>
    let nieuweLink = false
    const admin = createAdminSupabaseClient()
    if ('titel' in b) {
      const v = valideerFoundersVideo(b)
      if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
      patch = v.waarde
      // Andere (of geen) Instagram-link: de opgehaalde video hoort er niet meer bij.
      const { data: oud } = await admin.from('founders_videos').select('embed, media_poster_pad, media_video_pad').eq('id', id).maybeSingle()
      const oudeUrl = (oud?.embed as { url?: string } | null)?.url ?? null
      if (oud && oudeUrl !== (v.waarde.embed?.url ?? null)) {
        await wisInstagramMedia(admin, oud as { media_poster_pad?: string | null; media_video_pad?: string | null })
        Object.assign(patch, { media_poster_pad: null, media_video_pad: null, media_status: null, media_fout: null })
        nieuweLink = v.waarde.embed?.provider === 'instagram'
      } else if (v.waarde.embed?.provider === 'instagram' && oud && !oud.media_video_pad) nieuweLink = true
    } else {
      patch = {}
      if (typeof b.zichtbaar === 'boolean') patch.zichtbaar = b.zichtbaar
      if (Number.isInteger(b.volgorde)) patch.volgorde = b.volgorde
    }
    const { data, error } = await admin.from('founders_videos').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Video niet gevonden.' }, { status: 404 })
    // Instagram: miniatuur en video meteen naar de eigen opslag, zodat ze in de app speelt.
    const media = nieuweLink ? await kopieerInstagramMedia(admin, id, { forceer: true }) : null
    revalidatePath('/portal/founders')
    return NextResponse.json({ video: data, media })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'founders.PATCH') }, { status: 500 }) }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('founders', 'verwijderen'))) return NextResponse.json({ error: 'Je mag video\'s niet verwijderen.' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('founders_videos').select('media_poster_pad, media_video_pad').eq('id', id).maybeSingle()
    const { error } = await admin.from('founders_videos').delete().eq('id', id)
    if (error) throw new Error(error.message)
    if (oud) await wisInstagramMedia(admin, oud as { media_poster_pad?: string | null; media_video_pad?: string | null })
    revalidatePath('/portal/founders')
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'founders.DELETE') }, { status: 500 }) }
}
