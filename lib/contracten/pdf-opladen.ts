'use client'

import { createClient } from '@/lib/supabase/client'
import { MAX_PDF_MB, pdfTeGroot } from '@/lib/upload'

/**
 * Een contract- of templatepdf rechtstreeks naar de opslag (tot 10 MB) en het pad
 * terug. Het aanmaken (POST /api/admin/contracts of contract-templates met `pdf_pad`)
 * haalt de pdf daar op. Zo weigert Vercel niets meer boven 4 MB.
 */
export async function laadContractPdfOp(file: File): Promise<string> {
  if (pdfTeGroot(file)) throw new Error(`PDF te groot — max ${MAX_PDF_MB} MB.`)
  const naam = /\.pdf$/i.test(file.name) ? file.name : `${file.name}.pdf`
  const r = await fetch('/api/admin/contracts/upload-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam, grootte: file.size }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Opladen mislukt')
  const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, file, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(`Opladen mislukt: ${error.message}`)
  return j.pad as string
}

/**
 * Een bijlage bij een contract (getekende pdf, bestelbon, foto, mail) tot 10 MB:
 * eerst een uploadlink, dan rechtstreeks naar de opslag, dan registreren.
 */
export async function laadContractBijlageOp(contractId: string, file: File): Promise<void> {
  if (file.size > MAX_PDF_MB * 1024 * 1024) throw new Error(`"${file.name}" is te groot (max ${MAX_PDF_MB} MB).`)
  const basis = `/api/admin/contracts/${contractId}/bijlagen`
  const json = { 'Content-Type': 'application/json' }
  const r = await fetch(basis, { method: 'POST', headers: json, body: JSON.stringify({ link: true, naam: file.name || 'bijlage', grootte: file.size }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Opladen mislukt')
  const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (error) throw new Error(`Opladen mislukt: ${error.message}`)
  const r2 = await fetch(basis, { method: 'POST', headers: json, body: JSON.stringify({ pad: j.pad, naam: file.name || 'bijlage', mime: file.type || null }) })
  const j2 = await r2.json().catch(() => ({}))
  if (!r2.ok) throw new Error(j2.error || 'Opladen mislukt')
}
