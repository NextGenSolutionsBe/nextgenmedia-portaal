import { NextRequest, NextResponse } from 'next/server'
import { requireStaff } from '@/lib/supabase/server'
import { exchangeCode } from '@/lib/sales/google-calendar'
import { SIGNATURES } from '@/lib/sales/signatures'
import { listPipelines } from '@/lib/sales/pipelines'
import { listClickupMembers } from '@/lib/clickup'
import { baseUrl } from '@/lib/email'

export const dynamic = 'force-dynamic'

// Terugkeer vanaf Google. We sturen altijd terug naar de kalender met een
// duidelijke melding — nooit een kale JSON-fout in het gezicht van de gebruiker.
export async function GET(req: NextRequest) {
  const back = (msg: string, client?: string) =>
    NextResponse.redirect(`${baseUrl()}/admin/sales/appointments?${new URLSearchParams({ ...(client ? { client } : {}), cal: msg })}`)

  try {
    if (!(await requireStaff())) return NextResponse.redirect(`${baseUrl()}/login`)
    const sp = req.nextUrl.searchParams
    const state = sp.get('state') ?? ''
    const [salesClientId = '', , rawName = '', rawSig = '', rawMerk = '', rawClickup = ''] = state.split(':')
    const name = decodeURIComponent(rawName || '')

    // Handtekening: enkel een sleutel uit onze eigen lijst telt. Zo kan er via
    // de state nooit een vreemde afbeelding in onze mails belanden.
    const sig = SIGNATURES.find((s) => s.key === decodeURIComponent(rawSig || ''))
    const signature = sig
      ? { signature_image_url: sig.url, signature_phone: sig.phone, signature_email: sig.email }
      : undefined
    if (sp.get('error')) return back('geweigerd', salesClientId)
    const code = sp.get('code') ?? ''
    if (!code || !salesClientId) return back('mislukt', salesClientId)

    // Merk: enkel een pipeline die echt van ons is — de state komt van buiten
    // terug, dus we nemen niets zomaar over.
    const pipelines = await listPipelines()
    const merkId = pipelines.find((p) => p.id === decodeURIComponent(rawMerk || ''))?.id ?? null

    // ClickUp-persoon: zelfde wantrouwen. Eerst de vorm (een positief geheel
    // getal), daarna tegen de echte ledenlijst. Alleen als ClickUp geen leden
    // KAN geven (geen sleutel of storing) laten we de vormcheck volstaan —
    // anders zou een ClickUp-storing het koppelen blokkeren.
    let clickupId: number | null = null
    const ruwId = Number(decodeURIComponent(rawClickup || ''))
    if (Number.isInteger(ruwId) && ruwId > 0) {
      const leden = await listClickupMembers()
      clickupId = leden.length === 0 || leden.some((m) => m.id === ruwId) ? ruwId : null
    }

    await exchangeCode(salesClientId, code, name, signature, {
      pipelineId: merkId, clickupAssigneeId: clickupId,
    })
    return back('gekoppeld', salesClientId)
  } catch {
    return back('mislukt')
  }
}
