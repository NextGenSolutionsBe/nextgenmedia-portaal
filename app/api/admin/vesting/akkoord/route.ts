import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { laadVestingData } from '@/lib/vesting-data-server'
import { VENNOOT_NAAM, beschrijfAkkoord, controleerHandtekening, vennootVan, type Akkoord, type Onderwerp } from '@/lib/vesting-akkoord'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isOnderwerp = (v: unknown): v is Onderwerp => v === 'contract' || v === 'kost' || v === 'inkomst'

/**
 * Tekenen voor een vestingcontract, een inkomst of een kost. Enkel Marco, Bram
 * en Chiara, elk met het eigen account. De server rekent de cijfers opnieuw uit
 * en weigert als ze niet meer gelijk zijn aan wat de vennoot op het scherm zag:
 * zo hoort een handtekening altijd bij exact die cijfers. Handtekeningen worden
 * nooit gewijzigd of verwijderd (getekend is getekend).
 */
export async function POST(req: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { onderwerp?: unknown; onderwerp_id?: unknown; inhoud_tekst?: unknown; handtekening?: unknown }
    const onderwerp = isOnderwerp(b.onderwerp) ? b.onderwerp : null
    const id = typeof b.onderwerp_id === 'string' && UUID.test(b.onderwerp_id) ? b.onderwerp_id : null
    const gezien = typeof b.inhoud_tekst === 'string' ? b.inhoud_tekst : null
    const handtekening = controleerHandtekening(b.handtekening)
    if (!onderwerp || !id || !gezien) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    if (!handtekening) return NextResponse.json({ error: 'Zet eerst je handtekening in het vak.' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const data = await laadVestingData(admin)
    const vennoot = vennootVan(actor.id, data.vennoten)
    if (!vennoot) return NextResponse.json({ error: 'Enkel Marco, Bram en Chiara tekenen, elk met het eigen account.' }, { status: 403 })

    const info = onderwerp === 'contract' ? data.akkoordContract.get(id) : data.akkoordRegistratie.get(id)
    if (!info || (onderwerp !== 'contract' && info.inhoud.soort !== onderwerp)) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
    if (info.tekst !== gezien) return NextResponse.json({ error: 'De cijfers zijn intussen gewijzigd. Kijk ze opnieuw na en teken dan.', gewijzigd: true }, { status: 409 })
    if (info.stand.per[vennoot].stand === 'getekend') return NextResponse.json({ ok: true, al: true })

    const meta = requestMeta(req)
    const naam = String((actor.user_metadata as { full_name?: unknown } | undefined)?.full_name ?? '').trim() || data.vennoten[vennoot].naam
    const { error } = await admin.from('vesting_handtekeningen').insert({
      onderwerp, onderwerp_id: id, vennoot, user_id: actor.id, naam, email: actor.email ?? null,
      inhoud: info.inhoud, inhoud_tekst: info.tekst, handtekening,
      ip: meta.ip ?? null, user_agent: meta.userAgent ?? null,
    })
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message)

    await logAudit({
      action: 'vesting.getekend', entityType: onderwerp === 'contract' ? 'vesting_contract' : 'vesting_registratie', entityId: id,
      summary: `Vesting: ${VENNOOT_NAAM[vennoot]} tekende · ${beschrijfAkkoord(info.inhoud)}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
      metadata: { vennoot, inhoud: info.inhoud },
    })
    revalidatePath('/admin/vesting')
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Tekenen mislukt') }, { status: 500 })
  }
}

/**
 * GET ?onderwerp=&id=   — alle handtekeningen van één kaart, met de afbeelding (alle versies).
 * GET ?register=1       — het volledige register (zonder afbeeldingen), nieuwste eerst.
 * GET ?handtekening=<id> — één handtekening met afbeelding.
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const sp = req.nextUrl.searchParams
    const admin = createAdminSupabaseClient()

    if (sp.get('register') === '1') {
      const { data, error } = await admin.from('vesting_handtekeningen')
        .select('id, onderwerp, onderwerp_id, vennoot, naam, email, getekend_op, inhoud, ip')
        .order('getekend_op', { ascending: false }).limit(2000)
      if (error) throw new Error(error.message)
      const rijen = ((data ?? []) as { inhoud: Akkoord }[]).map((h) => ({ ...h, beschrijving: beschrijfAkkoord(h.inhoud) }))
      return NextResponse.json({ handtekeningen: rijen })
    }

    const een = sp.get('handtekening') ?? ''
    if (een) {
      if (!UUID.test(een)) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
      const { data } = await admin.from('vesting_handtekeningen').select('id, vennoot, naam, email, getekend_op, handtekening').eq('id', een).maybeSingle()
      if (!data) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
      return NextResponse.json({ handtekening: data })
    }

    const onderwerp = sp.get('onderwerp')
    const id = sp.get('id') ?? ''
    if (!isOnderwerp(onderwerp) || !UUID.test(id)) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const { data, error } = await admin.from('vesting_handtekeningen')
      .select('id, vennoot, naam, email, getekend_op, inhoud_tekst, inhoud, handtekening')
      .eq('onderwerp', onderwerp).eq('onderwerp_id', id).order('getekend_op', { ascending: false })
    if (error) throw new Error(error.message)
    const rijen = ((data ?? []) as { inhoud: Akkoord }[]).map((h) => ({ ...h, beschrijving: beschrijfAkkoord(h.inhoud) }))
    return NextResponse.json({ handtekeningen: rijen })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Laden mislukt') }, { status: 500 })
  }
}
