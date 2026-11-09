import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesProfiel } from '@/lib/account-server'
import {
  UitgaveFout, archiveerUitgave, laadVennotenData, maakUitgave, nieuweRegels, tekenRegels, wijzigUitgave, zetTerug,
} from '@/lib/vennoot-uitgaven-server'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Uitgaven vennoten. Enkel admins. GET = alles; POST { actie, … }. */
export async function GET() {
  const ik = await requireAdmin()
  if (!ik) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try { return NextResponse.json(await laadVennotenData(createAdminSupabaseClient(), ik.id)) }
  catch (e) { return NextResponse.json({ error: safeMessage(e, 'vennoten.GET') }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const ik = await requireAdmin()
  if (!ik) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)
    const profiel = await leesProfiel(ik).catch(() => null)
    const naam = (profiel ? `${profiel.voornaam} ${profiel.achternaam}`.trim() : '') || ik.email || null
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
    let samenvatting = ''
    switch (b.actie) {
      case 'nieuw': { const nieuw = await maakUitgave(admin, b, naam); samenvatting = `Uitgave ${String(b.vennoot)}: ${String(b.omschrijving ?? '')} (${String(b.bedrag ?? '')})`; b.id = nieuw; break }
      case 'wijzig': if (!id) throw new UitgaveFout('Ongeldige vraag.'); await wijzigUitgave(admin, id, b); samenvatting = 'Uitgave aangepast'; break
      case 'archiveer': if (!id) throw new UitgaveFout('Ongeldige vraag.'); await archiveerUitgave(admin, id, b.reden, naam); samenvatting = `Uitgave gearchiveerd: ${String(b.reden ?? '')}`; break
      case 'terugzetten': if (!id) throw new UitgaveFout('Ongeldige vraag.'); await zetTerug(admin, id); samenvatting = 'Uitgave teruggezet uit het archief'; break
      case 'regels': { const v = await nieuweRegels(admin, b, naam); samenvatting = `Regels uitgaven vennoten: versie ${v.versie}`; break }
      case 'teken': if (!id) throw new UitgaveFout('Ongeldige vraag.'); await tekenRegels(admin, id, { userId: ik.id, email: ik.email ?? null, naam, handtekening: b.handtekening, ip: meta.ip, ua: meta.userAgent }); samenvatting = 'Regels uitgaven vennoten getekend'; break
      default: throw new UitgaveFout('Onbekende actie.')
    }
    await logAudit({ action: `vennoot_uitgaven.${String(b.actie)}`, entityType: 'vennoot_uitgaven', entityId: typeof b.id === 'string' ? b.id : null, summary: samenvatting.slice(0, 300), actorUserId: ik.id, actorEmail: ik.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent })
    try { revalidatePath('/admin/vennoten') } catch { }
    return NextResponse.json({ ok: true, id: typeof b.id === 'string' ? b.id : null })
  } catch (e) {
    if (e instanceof UitgaveFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'vennoten.POST') }, { status: 500 })
  }
}
