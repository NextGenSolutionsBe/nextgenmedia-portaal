import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { safeMessage } from '@/lib/api-error'
import { BUCKET, MAX_BYTES, TOEGESTAAN, bouwPad, leesbareGrootte, mimeToegestaan } from '@/lib/client-uploads'

export const dynamic = 'force-dynamic'

/**
 * Stap 1 van een upload: een ondertekende link opvragen.
 *
 * WAAROM NIET GEWOON HET BESTAND NAAR ONS STUREN. Een serverfunctie op Vercel
 * neemt maar een paar megabyte aan verzoekinhoud aan. Een foto van een
 * telefoon is zo groot, een filmpje veel groter. Dus laten we de browser
 * rechtstreeks naar de opslag uploaden, met een link die wij uitgeven en die
 * maar één pad toestaat.
 *
 * Het pad kiezen WIJ — nooit de client. Het begint met het client_id van de
 * geresolveerde sessie, zodat er geen bestand kan belanden bij een andere klant.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await requirePortalPermission('files', 'upload')
    if (!g.ok) return g.response

    const b = await req.json().catch(() => ({}))
    const mime = String(b.mimetype ?? '').toLowerCase()
    const grootte = Number(b.grootte)

    if (!mimeToegestaan(mime)) {
      const soorten = [...new Set(Object.values(TOEGESTAAN))].join(', ')
      return NextResponse.json(
        { error: `Dit bestandstype kunnen we niet aannemen. Toegestaan: ${soorten}.` },
        { status: 400 },
      )
    }
    if (!Number.isFinite(grootte) || grootte <= 0) {
      return NextResponse.json({ error: 'De grootte van het bestand ontbreekt.' }, { status: 400 })
    }
    if (grootte > MAX_BYTES) {
      return NextResponse.json(
        { error: `Dit bestand is ${leesbareGrootte(grootte)}. Maximaal ${leesbareGrootte(MAX_BYTES)} per bestand.` },
        { status: 400 },
      )
    }

    const pad = bouwPad(g.session.clientId, mime, randomUUID())
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(pad)

    if (error) {
      // Ontbreekt de bucket, zeg dat met zoveel woorden in plaats van een kale 500.
      const hint = /bucket|not found/i.test(error.message)
        ? 'De opslagmap voor klantuploads bestaat nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'
        : error.message
      return NextResponse.json({ error: hint }, { status: 503 })
    }

    return NextResponse.json({ pad, token: data.token })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
