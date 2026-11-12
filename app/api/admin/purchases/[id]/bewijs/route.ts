import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { laadAankoopActor, rechtenVoor, BEVESTIGD } from '@/lib/aankopen/rechten'
import { bevestigAankoop, vindCertificaat, leesCertificaat } from '@/lib/aankopen/bewijs'

export const dynamic = 'force-dynamic'

/**
 * Bewijsdocument downloaden. Het bestand wordt door de server gestreamd na
 * controle van identiteit en rechten — er bestaat geen publieke link.
 * Bestaat er voor een bevestigde aanvraag nog geen document (van vóór deze
 * functie), dan wordt het nu één keer aangemaakt; daarna altijd hetzelfde.
 * ?version=N geeft een eerdere (vervangen) versie.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await laadAankoopActor()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: p } = await admin.from('purchases').select('*').eq('id', params.id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Aankoop niet gevonden' }, { status: 404 })
    if (!rechtenVoor(actor, p as never).bewijs) return NextResponse.json({ error: 'Je mag dit bewijsdocument niet downloaden.' }, { status: 403 })

    const versieParam = req.nextUrl.searchParams.get('version')
    const versie = versieParam && /^\d+$/.test(versieParam) ? Number(versieParam) : null
    let cert = await vindCertificaat(admin, params.id, versie)
    if (!cert && !versie && BEVESTIGD.includes(String(p.status)) && !p.deleted_at) cert = await bevestigAankoop(admin, params.id, actor.email)
    if (!cert) return NextResponse.json({ error: 'Er is geen bewijsdocument voor deze aanvraag (nog niet bevestigd).' }, { status: 404 })

    const bytes = await leesCertificaat(admin, cert)
    const meta = requestMeta(req)
    await logAudit({ action: 'purchase.certificate_download', entityType: 'purchase', entityId: params.id, summary: `Bewijsdocument ${cert.certificate_no} gedownload`, actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.isAdmin ? 'admin' : 'staff', ip: meta.ip, userAgent: meta.userAgent })
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${cert.file_name.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(cert.file_name)}`,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Certificaat': cert.certificate_no,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
