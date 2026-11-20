import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { valideerPartner } from '@/lib/partners'
import { publiekeUrl } from '@/lib/marketing-media'

export const dynamic = 'force-dynamic'

/** Onze partners. GET → alle (ook verborgen), POST → nieuwe partner achteraan. */
export async function GET() {
  if (!(await magIk('onze_partners', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
  const { data, error } = await createAdminSupabaseClient().from('onze_partners').select('*').order('volgorde').order('created_at')
  if (error) return NextResponse.json({ error: safeMessage(error, 'partners.GET') }, { status: 500 })
  return NextResponse.json({ partners: (data ?? []).map((p) => ({ ...p, logo_url: publiekeUrl(p.logo_pad) })) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  try {
    if (!(await magIk('onze_partners', 'toevoegen'))) return NextResponse.json({ error: 'Je mag geen partners toevoegen.' }, { status: 403 })
    const v = valideerPartner(await req.json().catch(() => ({})))
    if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: laatste } = await admin.from('onze_partners').select('volgorde').order('volgorde', { ascending: false }).limit(1).maybeSingle()
    const { data, error } = await admin.from('onze_partners').insert({ ...v.waarde, volgorde: (laatste?.volgorde ?? 0) + 1 }).select('*').single()
    if (error) throw new Error(error.message)
    revalidatePath('/portal/partners')
    return NextResponse.json({ partner: { ...data, logo_url: publiekeUrl(data.logo_pad) } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'partners.POST') }, { status: 500 }) }
}
