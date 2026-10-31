import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { valideerFoundersVideo } from '@/lib/founders-of-flanders'

export const dynamic = 'force-dynamic'

/** Founders of Flanders — voorbeeldvideo's. GET → alle, POST → nieuwe video achteraan. */
export async function GET() {
  if (!(await magIk('founders', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
  const admin = createAdminSupabaseClient()
  const [{ data, error }, { count }] = await Promise.all([
    admin.from('founders_videos').select('*').order('volgorde').order('created_at'),
    admin.from('klant_aanvragen').select('id', { count: 'exact', head: true }).eq('soort', 'founders').in('status', ['ontvangen', 'in_behandeling', 'offerte', 'aanvaard']),
  ])
  if (error) return NextResponse.json({ error: safeMessage(error, 'founders-of-flanders.GET') }, { status: 500 })
  return NextResponse.json({ videos: data ?? [], open_aanvragen: count ?? 0 }, { headers: { 'Cache-Control': 'no-store' } })
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
    revalidatePath('/portal/founders')
    return NextResponse.json({ video: data })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'founders-of-flanders.POST') }, { status: 500 }) }
}
