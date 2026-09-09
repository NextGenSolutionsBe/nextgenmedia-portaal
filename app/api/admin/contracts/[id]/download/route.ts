import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { logContractEvent } from '@/lib/contract-audit'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// GET ?type=original|signed — logt de download en redirect naar een signed URL.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const type = req.nextUrl.searchParams.get('type') === 'signed' ? 'signed' : 'original'
    const admin = createAdminSupabaseClient()
    const { data: contract } = await admin.from('contracts').select('*').eq('id', id).maybeSingle()
    if (!contract) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })

    const path = type === 'signed'
      ? (contract.signed_pdf_path || `signed/${id}.pdf`)
      : contract.pdf_path
    if (!path) return NextResponse.json({ error: 'Geen bestand beschikbaar' }, { status: 404 })

    const { data: urlData, error } = await admin.storage.from('contracts').createSignedUrl(path, 300)
    if (error || !urlData?.signedUrl) return NextResponse.json({ error: 'Bestand niet gevonden' }, { status: 404 })

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? null
    await logContractEvent(admin, id, type === 'signed' ? 'downloaded_signed' : 'downloaded_original', {
      actor: user.email ?? user.id, ip, ua: req.headers.get('user-agent'),
    })

    return NextResponse.redirect(urlData.signedUrl)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
