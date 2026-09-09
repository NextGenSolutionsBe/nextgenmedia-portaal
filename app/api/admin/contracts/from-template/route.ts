import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, insertResilient , isActiveStaff } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { logContractEvent } from '@/lib/contract-audit'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export const maxDuration = 60

// POST — maak een nieuw contract op basis van een template.
// Neemt over: originele PDF, detected_fields, handtekeningzone, template_id.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const b = await req.json()
    const templateId = b.template_id as string
    const client_id = (b.client_id as string) || null
    const service_slug = (b.service_slug as string) || null
    const signer_name = (b.signer_name as string)?.trim() || null
    const signer_email = (b.signer_email as string)?.trim() || null
    const expires_at = (b.expires_at as string) || null
    const title = (b.title as string)?.trim()

    if (!templateId) return NextResponse.json({ error: 'Template is verplicht' }, { status: 400 })

    const { data: tpl } = await admin.from('contract_templates').select('*').eq('id', templateId).maybeSingle()
    if (!tpl) return NextResponse.json({ error: 'Template niet gevonden' }, { status: 404 })
    if (!tpl.pdf_path) return NextResponse.json({ error: 'Template heeft geen PDF' }, { status: 400 })

    const finalTitle = title || tpl.name || 'Contract'
    const accessToken = randomUUID()

    const { data: contract, error: contractErr } = await insertResilient(
      admin,
      'contracts',
      {
        client_id,
        title: finalTitle,
        created_by: user.id,
        template_id: templateId,
        service_slug,
        status: 'draft',
        signer_name,
        signer_email,
        expires_at,
        detected_fields: Array.isArray(tpl.detected_fields) ? tpl.detected_fields : [],
        sig_page: tpl.sig_page ?? 1,
        sig_x_pct: tpl.sig_x_pct ?? 5,
        sig_y_pct: tpl.sig_y_pct ?? 25,
        sig_width: tpl.sig_width ?? 200,
        sig_height: tpl.sig_height ?? 60,
        access_token: accessToken,
      },
      { required: ['title', 'access_token'] },
    )
    if (contractErr || !contract) throw new Error(contractErr?.message ?? 'Aanmaken mislukt')
    const contractId = contract.id as string

    // Kopieer de template-PDF naar het contractpad (origineel blijft ongewijzigd).
    const { data: file, error: dlErr } = await admin.storage.from('contracts').download(tpl.pdf_path)
    if (dlErr || !file) {
      await admin.from('contracts').delete().eq('id', contractId)
      throw new Error('Template-PDF kon niet gekopieerd worden')
    }
    const pdfPath = `${client_id || 'algemeen'}/${contractId}.pdf`
    const { error: upErr } = await admin.storage
      .from('contracts')
      .upload(pdfPath, Buffer.from(await file.arrayBuffer()), { contentType: 'application/pdf', upsert: true })
    if (upErr) {
      await admin.from('contracts').delete().eq('id', contractId)
      throw new Error(`PDF kopiëren mislukt: ${upErr.message}`)
    }
    await admin.from('contracts').update({ pdf_path: pdfPath }).eq('id', contractId)

    await logContractEvent(admin, contractId, 'created_from_template', {
      actor: user.email ?? user.id, meta: { template_id: templateId, template_name: tpl.name },
    })

    try {
      revalidatePath('/admin/contracts')
      if (client_id) revalidatePath(`/admin/clients/${client_id}`)
      revalidatePath('/portal/contracts')
    } catch { }

    return NextResponse.json({ id: contractId })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
