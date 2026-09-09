import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { revalidatePath } from 'next/cache'
import { logContractEvent } from '@/lib/contract-audit'
import { resolvePortalSession, canAccessContract } from '@/lib/portal-auth'
import { FIELD_FONT_PT, baselineFromTopPct } from '@/lib/contract-render'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const {
      token,
      contract_id,
      signer_name,
      signer_email,
      signer_phone,
      signer_address,
      signer_vat,
      signature_data_url,
      field_values, // optioneel: { [label]: waarde } voor AI-gedetecteerde velden
    } = await req.json()

    if (!token || !contract_id || !signer_name || !signer_email) {
      return NextResponse.json({ error: 'Verplichte velden ontbreken' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // Verify token and contract status
    // Use select('*') so sign works even before field-detection migration has run
    const { data: contract } = await admin
      .from('contracts')
      .select('*')
      .eq('id', contract_id)
      .eq('access_token', token)
      .maybeSingle()

    if (!contract) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })
    if (contract.status === 'signed' || contract.status === 'getekend') return NextResponse.json({ error: 'Contract is al ondertekend' }, { status: 400 })

    // Subaccount-bescherming: een ingelogde portaalgebruiker van DEZELFDE klant
    // mag enkel tekenen met contracts.sign. Externe ontvangers (geen sessie of
    // andere klant) gebruiken de publieke tekenlink en worden niet geblokkeerd.
    const portalSession = await resolvePortalSession()
    if (portalSession && contract.client_id === portalSession.clientId && !canAccessContract(portalSession, contract, 'sign')) {
      return NextResponse.json({ error: 'Je hebt geen toestemming om dit contract te ondertekenen.' }, { status: 403 })
    }
    // Vervaldatum: verlopen tekenlink mag niet meer ondertekend worden.
    if (contract.expires_at && String(contract.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10)) {
      // Bewust niet stil: deze update faalde eerder op een te enge
      // CHECK-constraint. Het antwoord aan de ondertekenaar blijft hetzelfde.
      const { error: expErr } = await admin.from('contracts').update({ status: 'expired' }).eq('id', contract_id)
      if (expErr) console.error('[sign] status → expired mislukt:', expErr.message)
      return NextResponse.json({ error: 'Deze tekenlink is verlopen.' }, { status: 410 })
    }

    const signedAt = new Date().toISOString()
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? null
    const userAgent = req.headers.get('user-agent') ?? null

    let signedPdfPath: string | null = null

    // ── Stamp signature onto PDF ──────────────────────────────────────────────
    if (contract.pdf_path && signature_data_url) {
      try {
        // 1. Download original PDF from Supabase Storage
        const { data: fileData } = await admin.storage
          .from('contracts')
          .download(contract.pdf_path)

        if (fileData) {
          const pdfBytes = await fileData.arrayBuffer()
          const pdfDoc = await PDFDocument.load(pdfBytes)
          const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
          const pages = pdfDoc.getPages()

          // ── 1b. Stamp AI-gedetecteerde invulvelden op hun positie ──────────────
          const fields = Array.isArray(contract.detected_fields) ? contract.detected_fields : []
          const values = (field_values && typeof field_values === 'object') ? field_values as Record<string, unknown> : {}
          for (const f of fields as Array<Record<string, unknown>>) {
            if (String(f.type) === 'signature') continue
            const raw = values[String(f.label)]
            if (raw === undefined || raw === null || String(raw) === '') continue
            const text = String(f.type) === 'checkbox' ? (raw ? 'X' : '') : String(raw)
            if (!text) continue
            const pIdx = Math.max(0, Math.min(pages.length - 1, (Number(f.page_number) || 1) - 1))
            const fp = pages[pIdx]
            const { width: fw, height: fh } = fp.getSize()
            // Exact dezelfde positionering als de editor (geen benadering): x vanaf
            // links, baseline afgeleid van de top-positie via de echte paginahoogte.
            const fx = (Number(f.x) || 0) / 100 * fw
            const fy = baselineFromTopPct(Number(f.y) || 0, fh)
            fp.drawText(text.slice(0, 200), { x: fx, y: fy, size: FIELD_FONT_PT, font: helvetica, color: rgb(0.1, 0.1, 0.1) })
          }

          // 2. Embed the signature PNG image
          const base64 = (signature_data_url as string).replace(/^data:image\/png;base64,/, '')
          const sigBuffer = Buffer.from(base64, 'base64')
          const sigImage = await pdfDoc.embedPng(sigBuffer)

          // 3. Determine target page (1-indexed, default to last page)
          const sigPageIdx = Math.max(0, Math.min(pages.length - 1, (contract.sig_page ?? pages.length) - 1))
          const page = pages[sigPageIdx]
          const { width: pageW, height: pageH } = page.getSize()

          // 4. Convert percentage positions → PDF points (PDF origin = bottom-left)
          const xPct = contract.sig_x_pct ?? 5
          const yPct = contract.sig_y_pct ?? 25
          const sigW = contract.sig_width ?? 200
          const sigH = contract.sig_height ?? 60

          const pdfX = (xPct / 100) * pageW
          // PDF y-axis is inverted: y=0 is bottom; we position from top
          const pdfY = pageH - (yPct / 100) * pageH - sigH

          // 5. Draw signature image
          page.drawImage(sigImage, { x: pdfX, y: pdfY, width: sigW, height: sigH })

          // 6. Add text annotation below signature
          const signedDate = new Date(signedAt).toLocaleDateString('nl-BE', {
            day: 'numeric', month: 'long', year: 'numeric',
          })
          const annotText = `Ondertekend door ${signer_name} · ${signedDate}${ip ? ` · IP: ${ip}` : ''}`
          page.drawText(annotText, {
            x: pdfX,
            y: pdfY - 12,
            size: 7,
            font: helvetica,
            color: rgb(0.4, 0.4, 0.4),
            maxWidth: sigW + 100,
          })

          // 7. Save signed PDF
          const signedPdfBytes = await pdfDoc.save()
          const signedPath = `signed/${contract_id}.pdf`
          await admin.storage
            .from('contracts')
            .upload(signedPath, Buffer.from(signedPdfBytes), {
              contentType: 'application/pdf',
              upsert: true,
            })
          signedPdfPath = signedPath
        }
      } catch (pdfErr) {
        // PDF stamping failed — continue, just won't have signed PDF
        console.error('[sign] PDF stamping error:', pdfErr)
      }
    }

    // ── Insert signature record — best effort ─────────────────────────────────
    try {
      await admin.from('contract_signatures').insert({
        contract_id,
        signer_name,
        signer_email,
        signer_phone: signer_phone || null,
        signer_address: signer_address || null,
        signer_vat: signer_vat || null,
        signature_url: null, // no longer stored separately; embedded in PDF
        signed_at: signedAt,
        ip_address: ip,
        user_agent: userAgent,
      })
    } catch { }

    // ── Update contract — CRITICAL OPERATION ──────────────────────────────────
    // First try with signed_pdf_path — if column doesn't exist, retry without it
    let updateErr: { message: string } | null = null
    {
      const { error } = await admin.from('contracts').update({
        status: 'signed',
        signer_name,
        signer_email,
        signed_at: signedAt,
        ...(signedPdfPath ? { signed_pdf_path: signedPdfPath } : {}),
      }).eq('id', contract_id)
      updateErr = error
    }
    // Fallback: if signed_pdf_path column is missing, retry the critical fields only
    if (updateErr && signedPdfPath) {
      const { error } = await admin.from('contracts').update({
        status: 'signed',
        signer_name,
        signer_email,
        signed_at: signedAt,
      }).eq('id', contract_id)
      updateErr = error
    }
    if (updateErr) {
      console.error('[sign] CRITICAL: contract status update failed:', updateErr.message)
      throw new Error(`Ondertekening verwerkt, maar status update faalde: ${updateErr.message}`)
    }

    // ── Ingevulde veldwaarden bewaren — best effort (kolom kan ontbreken) ─────
    if (field_values && typeof field_values === 'object') {
      try { await admin.from('contracts').update({ field_values }).eq('id', contract_id) } catch { }
    }

    // ── Audit-log ─────────────────────────────────────────────────────────────
    if (field_values && Object.keys(field_values as Record<string, unknown>).length > 0) {
      await logContractEvent(admin, contract_id, 'filled', { actor: signer_email, ip, ua: userAgent })
    }
    await logContractEvent(admin, contract_id, 'signed', { actor: signer_email, ip, ua: userAgent })
    if (signedPdfPath) await logContractEvent(admin, contract_id, 'pdf_generated', { actor: signer_email, ip, ua: userAgent })

    // ── Invalidate caches so admin/portal pages refresh immediately ───────────
    try {
      revalidatePath('/admin/contracts')
      revalidatePath(`/admin/contracts/${contract_id}`)
      revalidatePath('/portal/contracts')
      revalidatePath('/portal')
      if (contract.client_id) {
        revalidatePath(`/admin/clients/${contract.client_id}`)
      }
    } catch { }

    // ── Generate download URL for signed PDF ──────────────────────────────────
    let signedPdfUrl: string | null = null
    if (signedPdfPath) {
      const { data: urlData } = await admin.storage
        .from('contracts')
        .createSignedUrl(signedPdfPath, 3600 * 24) // 24h
      signedPdfUrl = urlData?.signedUrl ?? null
    }

    return NextResponse.json({ ok: true, signed_pdf_url: signedPdfUrl })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
