import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireStaff, createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { ACCOUNT_BUCKET, MAX_FOTO, FOTO_TYPES, fotoVersie } from '@/lib/account-server'

export const dynamic = 'force-dynamic'

const padVan = (meta: Record<string, unknown> | undefined) => (typeof meta?.avatar_pad === 'string' && meta.avatar_pad ? meta.avatar_pad : null)

/** De eigen profielfoto: doorsturen naar een kortlevende ondertekende link. */
export async function GET() {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const pad = padVan(user.user_metadata)
  if (!pad) return NextResponse.json({ error: 'Geen foto' }, { status: 404 })
  const { data, error } = await createAdminSupabaseClient().storage.from(ACCOUNT_BUCKET).createSignedUrl(pad, 3600)
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'Geen foto' }, { status: 404 })
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': 'private, max-age=1800' } })
}

/** Nieuwe profielfoto (de browser verkleint en snijdt ze vierkant bij). */
export async function POST(req: NextRequest) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const form = await req.formData().catch(() => null)
    const f = form?.get('foto')
    if (!f || typeof f === 'string') return NextResponse.json({ error: 'Kies een foto.' }, { status: 400 })
    if (!(FOTO_TYPES as readonly string[]).includes(f.type)) return NextResponse.json({ error: 'Kies een JPG, PNG of WebP.' }, { status: 400 })
    if (f.size > MAX_FOTO) return NextResponse.json({ error: 'De foto is te groot (max. 3 MB).' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg'
    const pad = `${user.id}/${randomUUID()}.${ext}`
    const { error } = await admin.storage.from(ACCOUNT_BUCKET).upload(pad, Buffer.from(await f.arrayBuffer()), { contentType: f.type, upsert: false })
    if (error) throw new Error(error.message)
    const oud = padVan(user.user_metadata)
    const { data: upd, error: e2 } = await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...(user.user_metadata ?? {}), avatar_pad: pad } })
    if (e2) { await admin.storage.from(ACCOUNT_BUCKET).remove([pad]).catch(() => {}); throw new Error(e2.message) }
    if (oud && oud !== pad && oud.startsWith(`${user.id}/`)) await admin.storage.from(ACCOUNT_BUCKET).remove([oud]).catch(() => {})
    try { revalidatePath('/admin', 'layout') } catch { /* */ }
    return NextResponse.json({ ok: true, fotoVersie: upd.user ? fotoVersie(upd.user) : null })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Opladen mislukt') }, { status: 500 })
  }
}

export async function DELETE() {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const admin = createAdminSupabaseClient()
    const oud = padVan(user.user_metadata)
    const rest = { ...(user.user_metadata ?? {}) } as Record<string, unknown>
    rest.avatar_pad = null
    const { error } = await admin.auth.admin.updateUserById(user.id, { user_metadata: rest })
    if (error) throw new Error(error.message)
    if (oud && oud.startsWith(`${user.id}/`)) await admin.storage.from(ACCOUNT_BUCKET).remove([oud]).catch(() => {})
    try { revalidatePath('/admin', 'layout') } catch { /* */ }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Verwijderen mislukt') }, { status: 500 })
  }
}
