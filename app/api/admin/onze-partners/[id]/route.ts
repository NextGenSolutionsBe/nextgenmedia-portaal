import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { valideerPartner } from '@/lib/partners'
import { publiekeUrl } from '@/lib/marketing-media'
import { verwijderMarketingBestand } from '@/lib/marketing-server'

export const dynamic = 'force-dynamic'

/** PATCH → gegevens, of enkel { zichtbaar } / { volgorde }. DELETE → weg (logo mee). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('onze_partners', 'aanpassen'))) return NextResponse.json({ error: 'Je mag partners niet aanpassen.' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('onze_partners').select('*').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Partner niet gevonden.' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    let patch: Record<string, unknown>
    if ('naam' in b) {
      const v = valideerPartner(b)
      if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
      patch = v.waarde
    } else {
      patch = {}
      if (typeof b.zichtbaar === 'boolean') patch.zichtbaar = b.zichtbaar
      if (Number.isInteger(b.volgorde)) patch.volgorde = b.volgorde
    }
    const { data, error } = await admin.from('onze_partners').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
    if (error) throw new Error(error.message)
    if ('logo_pad' in patch && oud.logo_pad && oud.logo_pad !== patch.logo_pad) await verwijderMarketingBestand(admin, oud.logo_pad)
    revalidatePath('/portal/partners')
    return NextResponse.json({ partner: { ...data, logo_url: publiekeUrl(data.logo_pad) } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'partners.PATCH') }, { status: 500 }) }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('onze_partners', 'verwijderen'))) return NextResponse.json({ error: 'Je mag partners niet verwijderen.' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('onze_partners').select('logo_pad').eq('id', id).maybeSingle()
    const { error } = await admin.from('onze_partners').delete().eq('id', id)
    if (error) throw new Error(error.message)
    await verwijderMarketingBestand(admin, oud?.logo_pad)
    revalidatePath('/portal/partners')
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'partners.DELETE') }, { status: 500 }) }
}
