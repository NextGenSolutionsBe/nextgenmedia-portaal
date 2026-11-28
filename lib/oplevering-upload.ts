'use client'

import * as tus from 'tus-js-client'
import { createClient } from '@/lib/supabase/client'
import { loadPdfjs } from '@/lib/pdfjs-laden'

/**
 * Een bestand voor een oplevering opladen, rechtstreeks van de browser naar
 * de opslag. Grote video's (4K, vele GB) gaan in stukjes van 6 MB en hervatten
 * na een onderbreking (TUS, met een ondertekende link van de server). De app
 * zelf ziet die bytes nooit: geen vertraging, geen limiet van Vercel.
 *
 * Vooraf maakt de browser een kleine miniatuur (uit de video of foto), zodat
 * overzichten nooit een video hoeven te laden.
 */

export type Voortgang = { geladen: number; totaal: number; fase: 'voorbereiden' | 'opladen' | 'afronden' }

const STANDAARD_UPLOAD_MAX = 5 * 1024 * 1024 * 1024

function storageHost(): string {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  // https://<ref>.supabase.co → https://<ref>.storage.supabase.co (aangeraden voor grote uploads)
  return url.replace(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i, 'https://$1.storage.supabase.co')
}
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

/** Een foto via een gewoon <img> (ook svg, dat createImageBitmap niet altijd leest). */
function laadAlsImg(f: File): Promise<HTMLImageElement> {
  return new Promise((ok, fout) => {
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); ok(img) }
    img.onerror = () => { URL.revokeObjectURL(url); fout(new Error('Kan de afbeelding niet lezen')) }
    img.src = url
  })
}

/** Eerste pagina van een pdf als miniatuur (grafisch ontwerp, drukwerk, brandbooks). */
async function pdfPagina(f: File): Promise<{ canvas: HTMLCanvasElement; b: number; h: number } | null> {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise
  try {
    const p = await doc.getPage(1)
    const basis = p.getViewport({ scale: 1 })
    const vp = p.getViewport({ scale: Math.min(2, 900 / Math.max(basis.width, basis.height)) })
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height)
    const ctx = c.getContext('2d'); if (!ctx) return null
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height)
    await p.render({ canvasContext: ctx, viewport: vp }).promise
    return { canvas: c, b: Math.round(basis.width), h: Math.round(basis.height) }
  } finally { doc.destroy?.() }
}

/** Miniatuur (JPEG, max. 640 px) en gegevens van een video, foto of pdf. Lukt het niet: zonder miniatuur verder. */
export async function leesBeeld(f: File): Promise<{ poster: Blob | null; duur: number | null; breedte: number | null; hoogte: number | null }> {
  type Beeld = { poster: Blob | null; duur: number | null; breedte: number | null; hoogte: number | null }
  const leeg: Beeld = { poster: null, duur: null, breedte: null, hoogte: null }
  const naarJpeg = async (bron: CanvasImageSource, b: number, h: number) => {
    const schaal = Math.min(1, 640 / Math.max(b, h))
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(b * schaal)); c.height = Math.max(1, Math.round(h * schaal))
    const ctx = c.getContext('2d'); if (!ctx) return null
    ctx.drawImage(bron, 0, 0, c.width, c.height)
    return await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.8))
  }
  try {
    const svg = f.type === 'image/svg+xml' || /\.svg$/i.test(f.name)
    if (f.type.startsWith('image/') || svg) {
      try {
        if (svg) throw new Error('svg via img')
        const bm = await createImageBitmap(f)
        const poster = await naarJpeg(bm, bm.width, bm.height)
        const r = { poster, duur: null, breedte: bm.width, hoogte: bm.height }
        bm.close?.()
        return r
      } catch {
        // Svg (en wat createImageBitmap niet kent): via een gewoon <img>, op een witte achtergrond.
        const img = await laadAlsImg(f)
        const b = img.naturalWidth || 800, h = img.naturalHeight || 800
        const schaal = Math.min(1, 1280 / Math.max(b, h))
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(b * schaal)); c.height = Math.max(1, Math.round(h * schaal))
        const ctx = c.getContext('2d'); if (!ctx) return leeg
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height)
        ctx.drawImage(img, 0, 0, c.width, c.height)
        return { poster: await naarJpeg(c, c.width, c.height), duur: null, breedte: img.naturalWidth || null, hoogte: img.naturalHeight || null }
      }
    }
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      // Grote pdf's (drukbestanden van honderden MB) lezen we niet in: dan zonder miniatuur.
      if (f.size > 80 * 1024 * 1024) return leeg
      const p = await pdfPagina(f).catch(() => null)
      return p ? { poster: await naarJpeg(p.canvas, p.canvas.width, p.canvas.height), duur: null, breedte: p.b, hoogte: p.h } : leeg
    }
    if (!f.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm)$/i.test(f.name)) return leeg
    const url = URL.createObjectURL(f)
    try {
      return await new Promise<Beeld>((ok) => {
        const v = document.createElement('video')
        v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.src = url
        const klaar = (r: Beeld) => { clearTimeout(t); v.removeAttribute('src'); v.load(); ok(r) }
        const t = setTimeout(() => klaar({ ...leeg, duur: Number.isFinite(v.duration) ? v.duration : null, breedte: v.videoWidth || null, hoogte: v.videoHeight || null }), 10_000)
        v.onloadedmetadata = () => { v.currentTime = Math.min(1.5, (v.duration || 3) / 3) }
        v.onseeked = async () => {
          const poster = v.videoWidth ? await naarJpeg(v, v.videoWidth, v.videoHeight) : null
          klaar({ poster, duur: Number.isFinite(v.duration) ? v.duration : null, breedte: v.videoWidth || null, hoogte: v.videoHeight || null })
        }
        v.onerror = () => klaar(leeg)
      })
    } finally { URL.revokeObjectURL(url) }
  } catch { return leeg }
}

function tusUpload(f: File, bucket: string, pad: string, token: string, onVoortgang: (g: Voortgang) => void, signaal?: AbortSignal): Promise<void> {
  return new Promise((ok, fout) => {
    const upload = new tus.Upload(f, {
      endpoint: `${storageHost()}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
      headers: { 'x-signature': token, apikey: anonKey(), 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      // Elke poging krijgt een nieuw pad: nooit een oude upload (naar een ander pad) hervatten.
      // Binnen één poging hervat tus wel zelf na een haperend netwerk (retryDelays).
      storeFingerprintForResuming: false,
      metadata: { bucketName: bucket, objectName: pad, contentType: f.type || 'application/octet-stream', cacheControl: '3600' },
      chunkSize: 6 * 1024 * 1024, // vereist door Supabase
      onProgress: (geladen, totaal) => onVoortgang({ geladen, totaal, fase: 'opladen' }),
      onSuccess: () => ok(),
      onError: (e) => fout(e),
    })
    signaal?.addEventListener('abort', () => { upload.abort(true).catch(() => null); fout(new DOMException('Gestopt', 'AbortError')) })
    upload.start()
  })
}

/** Terugval: gewone ondertekende upload (tot 5 GB), met voortgang via XHR. */
function gewoneUpload(f: File, bucket: string, pad: string, token: string, onVoortgang: (g: Voortgang) => void, signaal?: AbortSignal): Promise<void> {
  return new Promise((ok, fout) => {
    const basis = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
    const url = `${basis}/storage/v1/object/upload/sign/${bucket}/${pad.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(token)}`
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('apikey', anonKey())
    xhr.setRequestHeader('Authorization', `Bearer ${anonKey()}`)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onVoortgang({ geladen: e.loaded, totaal: e.total, fase: 'opladen' }) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? ok() : fout(new Error(`Opladen mislukt (${xhr.status}): ${xhr.responseText.slice(0, 200)}`)))
    xhr.onerror = () => fout(new Error('Netwerkfout tijdens het opladen.'))
    signaal?.addEventListener('abort', () => { xhr.abort(); fout(new DOMException('Gestopt', 'AbortError')) })
    const fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', f)
    xhr.send(fd)
  })
}

export async function laadOpleveringBestandOp(o: { opleveringId: string; versieId: string; bestand: File; onVoortgang: (g: Voortgang) => void; signaal?: AbortSignal }): Promise<void> {
  const f = o.bestand
  o.onVoortgang({ geladen: 0, totaal: f.size, fase: 'voorbereiden' })
  const beeld = await leesBeeld(f)
  const r = await fetch(`/api/admin/opleveringen/${o.opleveringId}/versies/${o.versieId}/bestanden`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ naam: f.name, mimetype: f.type || 'application/octet-stream', grootte: f.size, poster: !!beeld.poster }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Opladen voorbereiden mislukt')

  let posterOk = false
  if (beeld.poster && j.poster) {
    const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.poster.pad, j.poster.token, beeld.poster, { contentType: 'image/jpeg', upsert: false })
    posterOk = !error
  }
  const teGroot = (e: unknown) => /413|too large|maximum allowed size|exceeded/i.test(String((e as Error)?.message ?? e))
  const TE_GROOT = 'Dit bestand is groter dan de limiet van de opslag. Zet in Supabase bij Storage > Settings de "Global file size limit" hoger (bv. 50 GB) en probeer opnieuw.'
  const afbreken = () => fetch(`/api/admin/opleveringen/bestanden/${j.bestand_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ afgebroken: true }) }).catch(() => null)
  try {
    await tusUpload(f, j.bucket, j.pad, j.token, o.onVoortgang, o.signaal)
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') { await afbreken(); throw e }
    if (teGroot(e)) { await afbreken(); throw new Error(TE_GROOT) }
    // Hervatbaar opladen lukte niet: gewone upload als het bestand niet te groot is.
    if (f.size > STANDAARD_UPLOAD_MAX) { await afbreken(); throw new Error(`Opladen mislukt: ${(e as Error)?.message ?? e}`) }
    try { await gewoneUpload(f, j.bucket, j.pad, j.token, o.onVoortgang, o.signaal) } catch (e2) { await afbreken(); throw teGroot(e2) ? new Error(TE_GROOT) : e2 }
  }
  o.onVoortgang({ geladen: f.size, totaal: f.size, fase: 'afronden' })
  const k = await fetch(`/api/admin/opleveringen/bestanden/${j.bestand_id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ klaar: true, duur: beeld.duur, breedte: beeld.breedte, hoogte: beeld.hoogte, poster_ok: posterOk }),
  })
  const jk = await k.json().catch(() => ({}))
  if (!k.ok) throw new Error(jk.error || 'Afronden mislukt')
}
