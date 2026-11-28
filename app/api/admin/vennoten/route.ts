import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesProfiel } from '@/lib/account-server'
import {
  UitgaveFout, archiveerUitgave, laadVennotenData, maakUitgave, nieuweRegels, regelsGeschiedenis, tekenRegels, wijzigUitgave, zetTerug, keurUitgaveGoed,
  archiveerExtra, keurExtraGoed, maakExtra, wijzigExtra, zetExtraTerug,
  archiveerTerugkerend, keurTerugkerendGoed, maakTerugkerend, stopTerugkerend, wijzigTerugkerend, zetTerugkerendTerug,
} from '@/lib/vennoot-uitgaven-server'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Uitgaven vennoten. Enkel admins. GET = alles (?regels=alle = alle versies van de regels); POST { actie, … }. */
export async function GET(req: NextRequest) {
  const ik = await requireAdmin()
  if (!ik) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    if (req.nextUrl.searchParams.get('regels') === 'alle') return NextResponse.json({ versies: await regelsGeschiedenis(createAdminSupabaseClient()) })
    return NextResponse.json(await laadVennotenData(createAdminSupabaseClient(), ik.id))
  }
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
    const inv = { userId: ik.id, naam, ip: meta.ip, ua: meta.userAgent }
    const moetId = () => { if (!id) throw new UitgaveFout('Ongeldige vraag.'); return id }
    switch (b.actie) {
      // Extra budget: telt pas als alle drie akkoord gaven; wie het voorstelt of aanpast gaat zelf akkoord.
      case 'extra.nieuw': { b.id = await maakExtra(admin, b, inv); samenvatting = `Extra budget ${String(b.maand ?? '')}: ${String(b.bedrag ?? '')} voor ${Array.isArray(b.vennoten) ? b.vennoten.join(', ') : ''}`; break }
      case 'extra.wijzig': await wijzigExtra(admin, moetId(), b, inv); samenvatting = 'Extra budget aangepast'; break
      case 'extra.archiveer': await archiveerExtra(admin, moetId(), b.reden, naam); samenvatting = `Extra budget geschrapt: ${String(b.reden ?? '')}`; break
      case 'extra.terugzetten': await zetExtraTerug(admin, moetId()); samenvatting = 'Extra budget teruggezet'; break
      case 'extra.akkoord': await keurExtraGoed(admin, moetId(), inv); samenvatting = 'Akkoord met extra budget'; break
      // Terugkerende uitgaven (lease, huur, abonnement).
      case 'terugkerend.nieuw': { b.id = await maakTerugkerend(admin, b, inv); samenvatting = `Terugkerende uitgave ${String(b.vennoot)}: ${String(b.omschrijving ?? '')} (${String(b.bedrag ?? '')} per ${String(b.frequentie ?? '')})`; break }
      case 'terugkerend.wijzig': await wijzigTerugkerend(admin, moetId(), b, inv); samenvatting = 'Terugkerende uitgave aangepast'; break
      case 'terugkerend.stop': await stopTerugkerend(admin, moetId(), b.datum, inv); samenvatting = `Terugkerende uitgave gestopt${typeof b.datum === 'string' ? ` op ${b.datum}` : ''}`; break
      case 'terugkerend.archiveer': await archiveerTerugkerend(admin, moetId(), b.reden, naam); samenvatting = `Terugkerende uitgave geschrapt: ${String(b.reden ?? '')}`; break
      case 'terugkerend.terugzetten': await zetTerugkerendTerug(admin, moetId()); samenvatting = 'Terugkerende uitgave teruggezet'; break
      case 'terugkerend.akkoord': await keurTerugkerendGoed(admin, moetId(), inv); samenvatting = 'Akkoord met terugkerende uitgave'; break
      case 'nieuw': { const nieuw = await maakUitgave(admin, b, naam); samenvatting = `Uitgave ${String(b.vennoot)}: ${String(b.omschrijving ?? '')} (${String(b.bedrag ?? '')})`; b.id = nieuw; break }
      case 'wijzig': if (!id) throw new UitgaveFout('Ongeldige vraag.'); await wijzigUitgave(admin, id, b); samenvatting = 'Uitgave aangepast'; break
      case 'archiveer': if (!id) throw new UitgaveFout('Ongeldige vraag.'); await archiveerUitgave(admin, id, b.reden, naam); samenvatting = `Uitgave gearchiveerd: ${String(b.reden ?? '')}`; break
      case 'terugzetten': if (!id) throw new UitgaveFout('Ongeldige vraag.'); await zetTerug(admin, id); samenvatting = 'Uitgave teruggezet uit het archief'; break
      case 'akkoord': if (!id) throw new UitgaveFout('Ongeldige vraag.'); await keurUitgaveGoed(admin, id, { userId: ik.id, naam, ip: meta.ip, ua: meta.userAgent }); samenvatting = 'Akkoord met de uitgave'; break
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
