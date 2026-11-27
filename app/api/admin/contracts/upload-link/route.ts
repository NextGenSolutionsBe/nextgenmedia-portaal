import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, isActiveStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { MAX_PDF_MB } from '@/lib/upload'

export const dynamic = 'force-dynamic'

/**
 * POST { naam, grootte } — een ondertekende uploadlink voor een contract- of templatepdf
 * (tot 10 MB). De browser laadt rechtstreeks op in de bucket `contracts` onder `opladen/`;
 * het aanmaken haalt hem daar op (Vercel weigert verzoeken boven ±4,5 MB).
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as { naam?: unknown; grootte?: unknown }
    const grootte = Number(b.grootte)
    if (!/\.pdf$/i.test(String(b.naam ?? ''))) return NextResponse.json({ error: 'Enkel een PDF.' }, { status: 400 })
    if (!Number.isFinite(grootte) || grootte <= 0) return NextResponse.json({ error: 'Leeg bestand.' }, { status: 400 })
    if (grootte > MAX_PDF_MB * 1024 * 1024) return NextResponse.json({ error: `PDF te groot — max ${MAX_PDF_MB} MB.` }, { status: 413 })
    const pad = `opladen/${randomUUID()}.pdf`
    const { data, error } = await createAdminSupabaseClient().storage.from('contracts').createSignedUploadUrl(pad)
    if (error || !data?.token) throw new Error(error?.message ?? 'Uploadlink maken mislukt')
    return NextResponse.json({ pad, token: data.token, bucket: 'contracts' })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Uploadlink maken mislukt') }, { status: 500 })
  }
}
