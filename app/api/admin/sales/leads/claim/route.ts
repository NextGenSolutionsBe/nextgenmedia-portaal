import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Leads claimen tijdens het bellen.
 *
 * Twee setters die tegelijk werken mogen nooit dezelfde prospect krijgen. Wie
 * een lead in Focus Mode opent, zet er een slot op; de wachtrij van de ander
 * slaat die lead dan over.
 *
 * Het slot VERVALT vanzelf (na 3 minuten) en wordt vernieuwd zolang het scherm
 * openstaat. Zonder die vervaltijd zou een dichtgeklapte browser een lead
 * voorgoed blokkeren — en dat merk je pas als niemand hem ooit nog belt. De
 * beslissing zelf zit in één databasefunctie (claim_lead), want precies hier
 * kunnen twee mensen elkaar kruisen: allebei "vrij" lezen, allebei schrijven.
 */

const MINUTEN = 3

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const leadId = String(b.leadId ?? '')
    if (!leadId) return NextResponse.json({ error: 'leadId ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const naam = (actor.email ?? '').split('@')[0] || 'Een collega'

    const { data, error } = await admin.rpc('claim_lead', {
      p_lead: leadId, p_user: actor.id, p_naam: naam, p_minuten: MINUTEN,
    })
    if (error) {
      // Functie of tabel ontbreekt (migratie nog niet gedraaid): dan bellen
      // zonder slot, in plaats van het bellen helemaal blokkeren.
      if (/claim_lead|does not exist|schema cache/i.test(error.message)) {
        return NextResponse.json({ ok: true, zonderSlot: true })
      }
      throw new Error(error.message)
    }

    const rijen = (data ?? []) as { auth_user_id: string; naam: string | null; verloopt_op: string }[]
    if (rijen.length === 0) {
      // Geweigerd: iemand anders is ermee bezig. Wie, zodat het scherm dat kan
      // zeggen in plaats van een vage foutmelding.
      const { data: bezet } = await admin.from('sales_lead_claims')
        .select('naam').eq('lead_id', leadId).maybeSingle()
      return NextResponse.json({
        ok: false,
        bezetDoor: (bezet as { naam: string | null } | null)?.naam ?? 'een collega',
      }, { status: 409 })
    }

    return NextResponse.json({ ok: true, verlooptOp: rijen[0].verloopt_op })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** DELETE ?leadId= — slot loslaten zodra je klaar bent met deze lead. */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const leadId = req.nextUrl.searchParams.get('leadId') ?? ''
    if (!leadId) return NextResponse.json({ error: 'leadId ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    // Alleen je EIGEN slot loslaten: anders kon iemand het slot van een
    // collega weghalen en alsnog dezelfde prospect bellen.
    await admin.from('sales_lead_claims').delete()
      .eq('lead_id', leadId).eq('auth_user_id', actor.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
