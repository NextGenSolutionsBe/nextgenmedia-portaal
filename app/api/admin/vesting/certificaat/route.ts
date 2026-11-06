import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { laadVestingData } from '@/lib/vesting-data-server'
import { certificaatBytes, mailCertificaat, zorgVoorCertificaat, type CertificaatRij } from '@/lib/vesting-certificaat-server'
import type { Onderwerp } from '@/lib/vesting-akkoord'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isOnderwerp = (v: unknown): v is Onderwerp => v === 'contract' || v === 'kost' || v === 'inkomst'
const kort = (r: CertificaatRij) => ({ id: r.id, nummer: r.nummer, volledig_op: r.volledig_op, mail_status: r.mail_status, mail_op: r.mail_op, mail_fout: r.mail_fout })

/**
 * POST { onderwerp, id }        — het certificaat van de laatste versie die alle drie tekenden (maken als het nog niet bestaat; mailt één keer naar legal@).
 * POST { certificaat_id, actie: 'mail' } — de archiefmail opnieuw versturen (na een mislukte poging).
 */
export async function POST(req: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { onderwerp?: unknown; id?: unknown; certificaat_id?: unknown; actie?: unknown }
    const admin = createAdminSupabaseClient()

    if (b.actie === 'mail') {
      const id = typeof b.certificaat_id === 'string' && UUID.test(b.certificaat_id) ? b.certificaat_id : null
      if (!id) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
      const { data: rij } = await admin.from('vesting_certificaten').select('*').eq('id', id).maybeSingle()
      if (!rij) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
      const data = await laadVestingData(admin)
      const na = await mailCertificaat(admin, rij as CertificaatRij, data.vennoten)
      const meta = requestMeta(req)
      await logAudit({ action: 'vesting.certificaat_gemaild', entityType: 'vesting_certificaat', entityId: id, summary: `Vesting: certificaat ${na.nummer} opnieuw gemaild (${na.mail_status})`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent })
      if (na.mail_status !== 'verstuurd') return NextResponse.json({ error: `Mailen mislukt: ${na.mail_fout ?? 'onbekende fout'}`, certificaat: kort(na) }, { status: 502 })
      return NextResponse.json({ ok: true, certificaat: kort(na) })
    }

    const onderwerp = isOnderwerp(b.onderwerp) ? b.onderwerp : null
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
    if (!onderwerp || !id) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const data = await laadVestingData(admin)
    const rij = await zorgVoorCertificaat(admin, data, onderwerp, id, { mail: true })
    if (!rij) return NextResponse.json({ error: 'Nog niet door alle drie getekend.' }, { status: 409 })
    return NextResponse.json({ ok: true, certificaat: kort(rij) })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Certificaat maken mislukt') }, { status: 500 })
  }
}

/** GET ?id=<certificaat> — het certificaat als pdf. */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: rij } = await admin.from('vesting_certificaten').select('nummer, pdf_pad').eq('id', id).maybeSingle()
    if (!rij) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
    const bytes = await certificaatBytes(admin, rij as CertificaatRij)
    if (!bytes) return NextResponse.json({ error: 'Het certificaat is nog niet klaar.' }, { status: 404 })
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="vestingcertificaat-${(rij as { nummer: string }).nummer}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Downloaden mislukt') }, { status: 500 })
  }
}
