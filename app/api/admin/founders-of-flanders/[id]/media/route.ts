import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { kopieerInstagramMedia } from '@/lib/founders-media-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST — de miniatuur en video van een Instagram-post (opnieuw) ophalen naar de eigen opslag. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('founders', 'aanpassen'))) return NextResponse.json({ error: 'Je mag video\'s niet aanpassen.' }, { status: 403 })
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Onbekende video.' }, { status: 400 })
    const r = await kopieerInstagramMedia(createAdminSupabaseClient(), id, { forceer: true })
    revalidatePath('/portal/founders')
    if (!r.ok) return NextResponse.json({ error: r.fout ?? 'Ophalen mislukt.' }, { status: 502 })
    return NextResponse.json({ ok: true, video: r.video })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'founders.media') }, { status: 500 }) }
}
