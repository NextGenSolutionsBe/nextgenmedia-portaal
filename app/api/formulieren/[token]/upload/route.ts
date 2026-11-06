import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { laadPubliekeLink, BUCKET } from '@/lib/formulieren/server'
import { bestandExtensie, bouwBestandPad, leesbareGrootte, BESTAND_MAX_BYTES, BESTAND_EXT_TEKST } from '@/lib/formulieren/model'

export const dynamic = 'force-dynamic'

/**
 * Publiek, stap 1 van een upload in een formulier: een ondertekende uploadlink.
 *
 * Zoals bij klantuploads gaat het bestand rechtstreeks van de browser naar de
 * opslag (Vercel neemt maar een paar MB verzoekinhoud aan). Het pad kiest de
 * SERVER: <formulier>/<link>/<uuid>.<ext>. Bij het insturen controleren we dat
 * elk pad met dat voorvoegsel begint.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const rl = await rateLimit(`formulier-upload:${clientIp(req)}`, { limit: 60, windowSec: 3600 })
    if (!rl.allowed) return NextResponse.json({ error: 'Te veel uploads na elkaar. Probeer het over een tijdje opnieuw.' }, { status: 429 })

    const pub = await laadPubliekeLink(params.token)
    if (pub.status !== 'ok' || !pub.link || !pub.formulier) return NextResponse.json({ error: 'Dit formulier is niet (meer) beschikbaar.' }, { status: 404 })

    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const veld = pub.formulier.velden.find((v) => v.id === b.veld_id && v.type === 'bestand')
    if (!veld) return NextResponse.json({ error: 'Dit veld neemt geen bestanden aan.' }, { status: 400 })

    const ext = bestandExtensie(String(b.naam ?? ''), String(b.mimetype ?? ''))
    if (!ext) return NextResponse.json({ error: `Dit bestandstype kunnen we niet aannemen. Toegestaan: ${BESTAND_EXT_TEKST}.` }, { status: 400 })
    const grootte = Number(b.grootte)
    if (!Number.isFinite(grootte) || grootte <= 0) return NextResponse.json({ error: 'De grootte van het bestand ontbreekt.' }, { status: 400 })
    if (grootte > BESTAND_MAX_BYTES) return NextResponse.json({ error: `Dit bestand is ${leesbareGrootte(grootte)}. Maximaal ${leesbareGrootte(BESTAND_MAX_BYTES)} per bestand.` }, { status: 400 })

    const pad = bouwBestandPad(pub.formulier.id, pub.link.id, randomUUID(), ext)
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(pad)
    if (error || !data) {
      console.error('[formulier-upload]', error?.message)
      return NextResponse.json({ error: 'Uploaden lukt momenteel niet. Probeer het later opnieuw.' }, { status: 503 })
    }
    return NextResponse.json({ pad, token: data.token, bucket: BUCKET })
  } catch (err) {
    console.error('[formulier-upload]', err)
    return NextResponse.json({ error: 'Uploaden mislukt. Probeer het opnieuw.' }, { status: 400 })
  }
}
