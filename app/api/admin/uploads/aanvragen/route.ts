import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { BUCKET, MAX_BYTES, TOEGESTAAN, bouwPad, leesbareGrootte, mimeToegestaan } from '@/lib/client-uploads'

export const dynamic = 'force-dynamic'

/**
 * Stap 1 van een upload door een medewerker: een ondertekende link opvragen
 * voor de map van een klant.
 *
 * Zelfde schema als het portaal (zie /api/portal/uploads/aanvragen): de
 * browser schrijft rechtstreeks naar de opslag, want een serverfunctie neemt
 * maar een paar megabyte aan. Het verschil: de klant wordt hier expliciet
 * meegegeven en op de server gecontroleerd — het pad bouwen WIJ, met dat
 * client_id vooraan, zodat het bestand nergens anders kan belanden.
 */
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json().catch(() => ({}))
    const clientId = String(b.client_id ?? '').trim()
    const mime = String(b.mimetype ?? '').toLowerCase()
    const grootte = Number(b.grootte)

    if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
      return NextResponse.json({ error: 'Geen klant opgegeven.' }, { status: 400 })
    }
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

    const admin = createAdminSupabaseClient()

    // Bestaat de klant? Anders zou er materiaal in een map zonder eigenaar komen.
    const { data: klant } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle()
    if (!klant) return NextResponse.json({ error: 'Klant niet gevonden.' }, { status: 404 })

    const pad = bouwPad(clientId, mime, randomUUID())
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(pad)

    if (error) {
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
