import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { requestMeta } from '@/lib/audit'
import { laadPubliekeLink } from '@/lib/formulieren/server'
import { valideerAntwoorden, haalContactUit, LINK_STATUS_LABEL } from '@/lib/formulieren/model'

export const dynamic = 'force-dynamic'

/**
 * Publiek: een ingevuld formulier insturen via /f/<token>.
 *
 * - Honeypot (`website_hp`) + rate limit per IP (10/uur).
 * - De server valideert opnieuw met exact dezelfde regels als de browser.
 * - Bestandspaden moeten bij dít formulier en déze link horen.
 * - De velden worden meebewaard (snapshot), zodat latere wijzigingen aan het
 *   formulier oude inzendingen niet onleesbaar maken.
 * Er worden geen interne gegevens teruggegeven.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>

    // Bots vullen het verborgen veld in: doe alsof het gelukt is, bewaar niets.
    if (typeof b.website_hp === 'string' && b.website_hp.trim() !== '') return NextResponse.json({ ok: true })

    const rl = await rateLimit(`formulier-inzending:${clientIp(req)}`, { limit: 10, windowSec: 3600 })
    if (!rl.allowed) return NextResponse.json({ error: 'Je hebt al veel formulieren verstuurd. Probeer het over een uur opnieuw.' }, { status: 429 })

    const pub = await laadPubliekeLink(params.token)
    if (pub.status !== 'ok' || !pub.link || !pub.formulier) {
      const reden = pub.status === 'gebruikt' ? 'Dit formulier werd via deze link al ingevuld.' : `Dit formulier is niet beschikbaar (${LINK_STATUS_LABEL[pub.status].toLowerCase()}).`
      return NextResponse.json({ error: reden }, { status: 410 })
    }

    const { velden } = pub.formulier
    const v = valideerAntwoorden(velden, b.antwoorden, { padPrefix: `${pub.formulier.id}/${pub.link.id}/` })
    if (!v.ok) return NextResponse.json({ error: 'Niet alle velden zijn correct ingevuld.', fouten: v.fouten }, { status: 422 })

    const { naam, email } = haalContactUit(velden, v.schoon)
    const meta = requestMeta(req)
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('formulier_inzendingen').insert({
      formulier_id: pub.formulier.id,
      link_id: pub.link.id,
      client_id: pub.link.client_id,
      antwoorden: v.schoon,
      velden_snapshot: velden,
      naam, email,
      status: 'nieuw',
      ip: meta.ip?.slice(0, 100) ?? null,
      user_agent: meta.userAgent?.slice(0, 500) ?? null,
    })
    if (error) {
      console.error('[formulier-inzending]', error.message)
      return NextResponse.json({ error: 'Versturen is niet gelukt. Probeer het opnieuw.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[formulier-inzending]', err)
    return NextResponse.json({ error: 'Versturen is niet gelukt. Probeer het opnieuw.' }, { status: 400 })
  }
}
