'use client'

import { createClient } from '@/lib/supabase/client'

/**
 * Profielfoto van een teamlid opladen, zo vaak en zo groot als je wil.
 *
 * Een foto van een gsm is al snel 5 à 10 MB; via de server zou Vercel die
 * weigeren (413, limiet 4,5 MB). Daarom: eerst in de browser verkleinen
 * (max. 1200 px, JPEG) en dan rechtstreeks naar de opslag met een
 * ondertekende uploadlink. De server zet daarna enkel de nieuwe foto op het
 * dossier en ruimt de oude op.
 */
export async function laadProfielfotoOp(personeelId: string, bestand: File): Promise<void> {
  const f = await maakProfielfoto(bestand)
  const basis = `/api/admin/personeel/${personeelId}/foto`
  const r = await fetch(basis, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mimetype: f.type, grootte: f.size }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Opladen mislukt')
  const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: f.type, upsert: false })
  if (error) throw new Error(`Opladen mislukt: ${error.message}`)
  const b = await fetch(basis, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: j.pad }) })
  const jb = await b.json().catch(() => ({}))
  if (!b.ok) throw new Error(jb.error || 'Bewaren mislukt')
}

const MAX_PX = 1200

/** Elke foto wordt een nette JPEG van hoogstens 1200 px (ook PNG, WebP en HEIC als de browser die kan lezen). */
export async function maakProfielfoto(f: File): Promise<File> {
  if (!/^image\//.test(f.type) && !/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name)) throw new Error('Kies een foto (JPG, PNG, WebP of HEIC).')
  let beeld: ImageBitmap
  try { beeld = await createImageBitmap(f) } catch {
    // Kan de browser het niet lezen (bv. HEIC buiten Safari)? Een kleine JPG/PNG/WebP gaat dan gewoon zoals hij is.
    if (/^image\/(jpeg|png|webp|gif)$/.test(f.type) && f.size <= 10 * 1024 * 1024) return f
    throw new Error('Deze foto kan de browser niet openen. Kies een JPG of PNG, of exporteer de foto eerst als JPG.')
  }
  const schaal = Math.min(1, MAX_PX / Math.max(beeld.width, beeld.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(beeld.width * schaal)); canvas.height = Math.max(1, Math.round(beeld.height * schaal))
  const ctx = canvas.getContext('2d')
  if (!ctx) return f
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height) // transparante PNG: witte achtergrond i.p.v. zwart
  ctx.drawImage(beeld, 0, 0, canvas.width, canvas.height)
  beeld.close?.()
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.86))
  if (!blob) return f
  return new File([blob], (f.name.replace(/\.\w+$/, '') || 'foto') + '.jpg', { type: 'image/jpeg' })
}
