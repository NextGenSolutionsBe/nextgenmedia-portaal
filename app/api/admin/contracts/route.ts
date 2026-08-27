import { safeMessage } from '@/lib/api-error'
import { MAX_UPLOAD_MB, fileTooBig } from '@/lib/upload'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, insertResilient , isActiveStaff } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { logContractEvent } from '@/lib/contract-audit'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const formData = await req.formData()
    const pdf = formData.get('pdf') as File | null
    const client_id = formData.get('client_id') as string
    const title = formData.get('title') as string
    const contract_type = (formData.get('contract_type') as string | null) || null
    const duration_type = (formData.get('duration_type') as string | null) || null
    const service_slug = formData.get('service_slug') as string | null
    const signer_name = formData.get('signer_name') as string | null
    const signer_email = formData.get('signer_email') as string | null

    // "Already signed" path — for existing clients whose contract is signed offline
    const alreadySigned = formData.get('already_signed') === 'true'
    const signedAt = formData.get('signed_at') as string | null
    const startMonth = formData.get('start_month') as string | null   // YYYY-MM
    const durationMonths = formData.get('duration_months') as string | null

    // client_id is OPTIONEEL: een contract mag zonder klant bestaan (publieke
    // tekenlink / intern). Enkel een PDF en titel zijn verplicht.
    if (!pdf || !title) {
      return NextResponse.json({ error: 'PDF en titel zijn verplicht' }, { status: 400 })
    }
    // Zelfde grens als het formulier (lib/upload.ts) — maar hier afgedwongen,
    // want een browsercontrole is te omzeilen. Boven ~4,5 MB zou Vercel het
    // verzoek sowieso kaal weigeren; zo blijft de melding altijd de onze.
    if (fileTooBig(pdf)) {
      return NextResponse.json({ error: `PDF te groot — max ${MAX_UPLOAD_MB} MB. Comprimeer het bestand (bv. "Opslaan als PDF met verkleind formaat") en probeer opnieuw.` }, { status: 413 })
    }

    // Aantal maanden afleiden uit het contractduur-type (eenmalig/onbepaald = geen einddatum).
    const PRESET_MONTHS: Record<string, number> = { maandelijks: 1, '3m': 3, '6m': 6, '12m': 12 }
    const months = duration_type === 'aangepast'
      ? parseInt(durationMonths ?? '0', 10)
      : (PRESET_MONTHS[duration_type ?? ''] ?? 0)

    // Derive start/end dates. Eenmalig/onbepaalde duur → geen verplichte looptijd.
    let startDate: string | null = null
    let endDate: string | null = null
    if (duration_type !== 'eenmalig' && startMonth) {
      startDate = `${startMonth.slice(0, 7)}-01`
      if (months > 0) {
        const d = new Date(startDate + 'T00:00:00Z')
        d.setUTCMonth(d.getUTCMonth() + months)
        endDate = d.toISOString().slice(0, 10)
      }
    }

    // Create contract record first to get the ID.
    // insertResilient drops any column the live schema lacks (e.g. start_date /
    // end_date on older contracts tables) and retries.
    const accessToken = randomUUID()
    const { data: contract, error: contractErr } = await insertResilient(
      admin,
      'contracts',
      {
        client_id: client_id || null,
        title,
        contract_type,
        duration_type,
        created_by: user.id,
        service_slug: service_slug || null,
        status: alreadySigned ? 'signed' : 'draft',
        signer_name: signer_name || null,
        signer_email: signer_email || null,
        signed_at: alreadySigned ? (signedAt || new Date().toISOString().slice(0, 10)) : null,
        start_date: startDate,
        end_date: endDate,
        access_token: accessToken,
      },
      { required: ['client_id', 'title', 'access_token'] },
    )

    if (contractErr || !contract) throw new Error(contractErr?.message ?? 'Aanmaken mislukt')
    const contractId = contract.id as string

    // Upload PDF
    const arrayBuffer = await pdf.arrayBuffer()
    const pdfPath = `${client_id || 'algemeen'}/${contractId}.pdf`
    const { error: uploadErr } = await admin.storage
      .from('contracts')
      .upload(pdfPath, Buffer.from(arrayBuffer), {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadErr) {
      // Clean up contract if upload fails
      await admin.from('contracts').delete().eq('id', contractId)
      throw new Error(`PDF upload mislukt: ${uploadErr.message}`)
    }

    // For an already-signed upload, the uploaded PDF IS the signed document, so
    // store it as signed_pdf_path too (client + admin can download it directly).
    await admin.from('contracts').update({ pdf_path: pdfPath }).eq('id', contractId)
    if (alreadySigned) {
      // Separate update so a missing signed_pdf_path column doesn't block pdf_path.
      try { await admin.from('contracts').update({ signed_pdf_path: pdfPath }).eq('id', contractId) } catch { }
    }

    await logContractEvent(admin, contractId, 'uploaded', { actor: user.email ?? user.id, meta: { title } })

    // Invalidate caches so new contract appears in lists immediately
    try {
      revalidatePath('/admin/contracts')
      revalidatePath(`/admin/clients/${client_id}`)
      revalidatePath('/portal/contracts')
      revalidatePath('/portal')
    } catch { }

    return NextResponse.json({ id: contractId })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
