import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { MailProjectFout, mailProjectenLijst, maakKaartUitMail, zetMailProject } from '@/lib/mail-opvolging/projecten-server'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

/**
 * Nieuwe projecten uit de mail (Command Center).
 *  GET → open voorstellen en de beslissingen van de laatste weken.
 *  POST { actie: 'ja', id, titel, klant?, client_id?, diensten, merk, verantwoordelijke } → projectkaart in Opvolging.
 *  POST { actie: 'nee' | 'terug', id } → geen nieuw project, of een nee terugzetten.
 * Zelfde rechten als Projecten (module opdrachten).
 */
export async function GET() {
  try {
    if (!(await magIk('opdrachten', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    return NextResponse.json({ projecten: await mailProjectenLijst(createAdminSupabaseClient()) })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
    if (!id) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    if (b.actie === 'ja') {
      const p = await magIk('opdrachten', 'toevoegen')
      if (!p) return NextResponse.json({ error: 'Je mag geen projecten toevoegen.' }, { status: 403 })
      const { opdrachtId, dealId } = await maakKaartUitMail(admin, id, b, { email: p.email ?? null, naam: p.naam ?? null })
      if (dealId) await logAudit({ action: 'ngs.nieuw', entityType: 'ngs_deal', entityId: dealId, summary: `Deal uit de mail: ${String(b.titel ?? '').slice(0, 120)}`, actorUserId: p.userId, actorEmail: p.email, ...requestMeta(req) })
      else await logAudit({ action: 'opdracht.create', entityType: 'opdracht', entityId: opdrachtId, summary: `Projectkaart uit de mail: ${String(b.titel ?? '').slice(0, 120)}`, actorUserId: p.userId, actorEmail: p.email, ...requestMeta(req) })
      try { revalidatePath('/admin') } catch { }
      return NextResponse.json({ ok: true, opdrachtId, dealId: dealId ?? null })
    }
    if (b.actie === 'nee' || b.actie === 'terug') {
      const p = await magIk('opdrachten', 'aanpassen')
      if (!p) return NextResponse.json({ error: 'Je mag dit niet aanpassen.' }, { status: 403 })
      await zetMailProject(admin, id, b.actie === 'nee' ? 'nee' : 'voorstel', p.naam ?? p.email ?? null)
      try { revalidatePath('/admin') } catch { }
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (e) {
    if (e instanceof MailProjectFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e) }, { status: 400 })
  }
}
