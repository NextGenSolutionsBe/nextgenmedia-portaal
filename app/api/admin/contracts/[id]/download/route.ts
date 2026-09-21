import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logContractEvent } from '@/lib/contract-audit'
import { documentBestandsnaam, contentDisposition } from '@/lib/contract-archief-model'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET ?type=original|signed — logt de download en stuurt het bestand door met
 * een leesbare bestandsnaam: "Getekend_contract_[klant]_[contract]_[JJJJ-MM-DD].pdf".
 * `?weergave=inline` opent het in de browser i.p.v. te downloaden.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const type = req.nextUrl.searchParams.get('type') === 'signed' ? 'signed' : 'original'
    const inline = req.nextUrl.searchParams.get('weergave') === 'inline'
    const admin = createAdminSupabaseClient()
    const { data: contract } = await admin.from('contracts').select('*').eq('id', id).maybeSingle()
    if (!contract) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })

    const path = type === 'signed'
      ? (contract.signed_pdf_path || `signed/${id}.pdf`)
      : contract.pdf_path
    if (!path) return NextResponse.json({ error: 'Geen bestand beschikbaar' }, { status: 404 })

    const { data: bestand, error } = await admin.storage.from('contracts').download(path)
    if (error || !bestand) return NextResponse.json({ error: 'Bestand niet gevonden' }, { status: 404 })

    const klantNaam = contract.client_id
      ? ((await admin.from('clients').select('company_name').eq('id', contract.client_id).maybeSingle()).data?.company_name ?? null)
      : null
    const bestandsnaam = documentBestandsnaam(type === 'signed' ? 'getekend_contract' : 'origineel', klantNaam, contract.title, type === 'signed' ? contract.signed_at : contract.created_at)

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? null
    await logContractEvent(admin, id, type === 'signed' ? 'downloaded_signed' : 'downloaded_original', {
      actor: user.email ?? user.id, ip, ua: req.headers.get('user-agent'),
    })

    return new NextResponse(await bestand.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(bestandsnaam, inline ? 'inline' : 'attachment'),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
