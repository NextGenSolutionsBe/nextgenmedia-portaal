import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { randomUUID } from 'crypto'
import { checkUpload } from '@/lib/upload-guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BUCKET = 'cms-media'
const MAX = 20 * 1024 * 1024 // 20 MB

// POST (multipart) — klant uploadt een afbeelding/bestand vanaf zijn pc. We slaan
// het op in een publieke Supabase-bucket en geven de publieke URL terug; die URL
// gebruikt de klant als waarde voor een image/file-veld (Framer accepteert URL's).
export async function POST(req: NextRequest) {
  const g = await requirePortalPermission('cms', 'edit')
  if (!g.ok) return g.response
  try {
    const fd = await req.formData()
    const file = fd.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Geen bestand' }, { status: 400 })

    // Type bepalen uit de ECHTE bytes, niet uit bestandsnaam of Content-Type:
    // deze bucket is publiek, dus een als afbeelding vermomd HTML/SVG-bestand
    // zou anders als uitvoerbare pagina geserveerd worden (opgeslagen XSS).
    const checked = await checkUpload(file, { maxBytes: MAX, allow: ['image', 'document'] })
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })

    const admin = createAdminSupabaseClient()
    // Bucket idempotent aanmaken (publiek) zodat de URL rechtstreeks werkt.
    try { await admin.storage.createBucket(BUCKET, { public: true }) } catch { /* bestaat al */ }

    const path = `${g.session.clientId}/${randomUUID()}.${checked.ext}`
    const { error } = await admin.storage.from(BUCKET).upload(path, checked.buffer, {
      contentType: checked.mime, upsert: false,
    })
    if (error) throw new Error(error.message)

    const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
    return NextResponse.json({ url: data.publicUrl })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload mislukt' }, { status: 400 })
  }
}
