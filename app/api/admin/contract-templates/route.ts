import { safeMessage } from '@/lib/api-error'
import { MAX_UPLOAD_MB, fileTooBig } from '@/lib/upload'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, insertResilient , isActiveStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

// GET — alle templates (admin).
export async function GET() {
  try {
    const user = await requireAdminUser()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from('contract_templates')
      .select('id, name, category, pdf_path, detected_fields, active, created_at')
      .order('created_at', { ascending: false })
    return NextResponse.json({ templates: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuwe template (naam, categorie, PDF). PDF in contracts-bucket onder templates/.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdminUser()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const formData = await req.formData()
    const pdf = formData.get('pdf') as File | null
    const name = (formData.get('name') as string)?.trim()
    const category = (formData.get('category') as string)?.trim() || null
    if (!name) return NextResponse.json({ error: 'Naam is verplicht' }, { status: 400 })
    // Zelfde grens als het formulier (lib/upload.ts); zie contracts/route.ts.
    if (pdf && fileTooBig(pdf)) {
      return NextResponse.json({ error: `PDF te groot — max ${MAX_UPLOAD_MB} MB. Comprimeer het bestand en probeer opnieuw.` }, { status: 413 })
    }

    const { data: tpl, error: tplErr } = await insertResilient(
      admin,
      'contract_templates',
      { name, category, active: true, created_by: user.id },
      { required: ['name'] },
    )
    if (tplErr || !tpl) throw new Error(tplErr?.message ?? 'Aanmaken mislukt')
    const templateId = tpl.id as string

    if (pdf) {
      const arrayBuffer = await pdf.arrayBuffer()
      const pdfPath = `templates/${templateId}.pdf`
      const { error: uploadErr } = await admin.storage
        .from('contracts')
        .upload(pdfPath, Buffer.from(arrayBuffer), { contentType: 'application/pdf', upsert: true })
      if (uploadErr) {
        await admin.from('contract_templates').delete().eq('id', templateId)
        throw new Error(`PDF upload mislukt: ${uploadErr.message}`)
      }
      await admin.from('contract_templates').update({ pdf_path: pdfPath }).eq('id', templateId)
    }

    try { revalidatePath('/admin/contracts/templates') } catch { }
    return NextResponse.json({ id: templateId })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
