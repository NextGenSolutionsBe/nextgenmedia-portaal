import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { maakShootDocument, laadShootDocumentData, bestandsnaamShootDocument, downloadHeaders, LEEG_MELDING } from '@/lib/shoot-document'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Shootdocument (PDF) voor een klant — admin/staff.
 * ?shoot=<id> kiest een specifieke shoot; zonder parameter de eerstvolgende.
 * De PDF wordt telkens vers gemaakt en direct gestreamd (geen opslag, geen link).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Ongeldig klant-id' }, { status: 400 })
    const shootParam = req.nextUrl.searchParams.get('shoot')
    if (shootParam && !UUID.test(shootParam)) return NextResponse.json({ error: 'Ongeldig shoot-id' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const data = await laadShootDocumentData(admin, params.id, shootParam)
    if (data.leeg) {
      if (data.reden === 'geen_klant') return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
      if (data.reden === 'geen_shoot') return NextResponse.json({ error: 'Shoot niet gevonden' }, { status: 404 })
      return NextResponse.json({ error: LEEG_MELDING }, { status: 409 })
    }

    const bytes = await maakShootDocument(data)
    const bestandsnaam = bestandsnaamShootDocument(data.klantNaam, data.projectNaam, data.datum)

    const meta = requestMeta(req)
    await logAudit({
      action: 'social.shoot_document_download', entityType: 'client', entityId: params.id,
      summary: `Shootdocument gedownload voor ${data.klantNaam}${data.shoot?.datum ? ` (shoot ${data.shoot.datum})` : ''}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff',
      metadata: { shoot_id: data.shootId, items: data.items.length, bestandsnaam }, ip: meta.ip, userAgent: meta.userAgent,
    })

    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: downloadHeaders(bestandsnaam, bytes.length) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
