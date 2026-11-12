'use client'

import { createClient } from '@/lib/supabase/client'
import { isAfbeelding, MAX_AFBEELDING, publiekeUrl } from '@/lib/marketing-media'

/**
 * Een afbeelding opladen naar de publieke marketingbucket. Grote foto's worden
 * eerst in de browser verkleind (max. 2000 px, JPEG 85%), zodat de nieuwsfeed
 * snel blijft. `endpoint` geeft een ondertekende uploadlink terug.
 */
export async function laadAfbeeldingOp(endpoint: string, bestand: File): Promise<{ pad: string; url: string }> {
  if (!isAfbeelding(bestand.type)) throw new Error('Kies een JPG, PNG, WebP of GIF.')
  const f = await verklein(bestand)
  if (f.size > MAX_AFBEELDING) throw new Error('De afbeelding is groter dan 15 MB.')
  const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mimetype: f.type, grootte: f.size }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Opladen mislukt')
  const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: f.type, upsert: false })
  if (error) throw new Error(error.message)
  return { pad: j.pad as string, url: publiekeUrl(j.pad) ?? '' }
}

const MAX_PX = 2000

async function verklein(f: File): Promise<File> {
  // GIF (animatie) en kleine bestanden blijven zoals ze zijn.
  if (f.type === 'image/gif' || (f.size < 600 * 1024)) return f
  try {
    const beeld = await createImageBitmap(f)
    const schaal = Math.min(1, MAX_PX / Math.max(beeld.width, beeld.height))
    if (schaal === 1 && f.size < 1.5 * 1024 * 1024) return f
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(beeld.width * schaal); canvas.height = Math.round(beeld.height * schaal)
    canvas.getContext('2d')?.drawImage(beeld, 0, 0, canvas.width, canvas.height)
    // PNG houdt transparantie (logo's); foto's worden JPEG.
    const type = f.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.85))
    if (!blob || blob.size >= f.size) return f
    return new File([blob], f.name.replace(/\.\w+$/, type === 'image/png' ? '.png' : '.jpg'), { type })
  } catch { return f }
}
