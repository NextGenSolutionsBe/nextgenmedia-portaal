import { NextRequest, NextResponse } from 'next/server'
import { logPortalAction } from '@/lib/portal-auth'
import { kalenderPoort } from '@/lib/content/kalender-beheer-server'
import { safeMessage } from '@/lib/api-error'
import { maakShootDocument, laadShootDocumentData, bestandsnaamShootDocument, downloadHeaders, LEEG_MELDING } from '@/lib/shoot-document'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Shootdocument (PDF) voor de ingelogde klant. De klant komt ALTIJD uit de
 * geresolveerde portaalsessie — nooit uit de query. ?shoot=<id> moet van die
 * klant zijn (de loader filtert op client_id), anders 404. Het document bevat
 * scripts uit de contentkalender: zonder toegang tot de kalender ook geen document.
 */
export async function GET(req: NextRequest) {
  try {
    const p = await kalenderPoort(); if (p.fout) return p.fout
    const { session, admin } = p
    const clientId = session.clientId

    const shootParam = req.nextUrl.searchParams.get('shoot')
    if (shootParam && !UUID.test(shootParam)) return NextResponse.json({ error: 'Ongeldig shoot-id' }, { status: 400 })

    const data = await laadShootDocumentData(admin, clientId, shootParam)
    if (data.leeg) {
      if (data.reden === 'geen_klant' || data.reden === 'geen_shoot') return NextResponse.json({ error: 'Shoot niet gevonden' }, { status: 404 })
      return NextResponse.json({ error: LEEG_MELDING }, { status: 409 })
    }

    const bytes = await maakShootDocument(data)
    const bestandsnaam = bestandsnaamShootDocument(data.klantNaam, data.projectNaam, data.datum)

    await logPortalAction(session, 'social.shoot_document_download', { type: 'shoot_briefing', id: data.shootId }, {
      req, meta: { items: data.items.length, bestandsnaam },
    })

    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: downloadHeaders(bestandsnaam, bytes.length) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
