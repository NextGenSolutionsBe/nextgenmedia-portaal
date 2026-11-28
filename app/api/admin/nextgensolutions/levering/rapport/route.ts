import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { BEDRIJF } from '@/lib/offerte-afzender'
import { klantWorkflow } from '@/lib/ngs/audit'
import { RapportFout, laadRapport, auditLijst, rapportActie } from '@/lib/ngs/audit-server'
import { voorstelRapport } from '@/lib/ngs/audit-ai'
import { maakRapportPdf } from '@/lib/ngs/rapport-pdf'
import { leesInstellingen } from '@/lib/instellingen/laden'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Het auditrapport van NextGenSolutions (nieuwe werking fase 3). Toegang: recht
 * ngs_levering of nextgensolutions (middleware), zodat wie bouwt het rapport kan
 * schrijven zonder de pipeline te zien.
 *  GET ?audits=1        → de lopende audits (zonder dealwaarden)
 *  GET ?deal=<id>       → processen, workflows en de prijsregels
 *  GET ?pdf=<id>        → het rapport als pdf (enkel wat de klant mag zien)
 *  POST { actie, deal, … } → proces.*, samenvoegen, workflow.*, notities, voorstel (AI), voorstel.overnemen, afronden, heropen
 */
async function wie(user: { email?: string | null }) {
  const ident = await leesAdminIdentiteit().catch(() => null)
  return ident?.naam || user.email || null
}

export async function GET(req: NextRequest) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const admin = createAdminSupabaseClient()
    const sp = req.nextUrl.searchParams
    if (sp.get('audits')) return NextResponse.json({ audits: await auditLijst(admin) }, { headers: { 'Cache-Control': 'no-store' } })
    const pdfVan = sp.get('pdf')
    if (pdfVan) {
      const [r, { data: b }, inst] = await Promise.all([
        laadRapport(admin, pdfVan),
        admin.from('bedrijven').select('handelsnaam, naam').eq('slug', 'nextgensolutions').maybeSingle(),
        leesInstellingen(),
      ])
      const handels = (b as { handelsnaam?: string | null; naam?: string | null } | null)?.handelsnaam || 'NextGenSolutions'
      const bytes = await maakRapportPdf({
        klant: r.deal.bedrijf,
        datum: new Date(r.deal.rapport_afgerond_op ?? Date.now()).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' }),
        workflows: r.workflows.map((w) => klantWorkflow(w, r.processen, r.prijzen)),
        handelsnaam: `${BEDRIJF.vennootschap}, handelsnaam ${handels}`,
        nazorgWeken: inst.werking.levering.nazorg_weken,
      })
      const naam = `Auditrapport ${r.deal.bedrijf}`.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80)
      return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${naam}.pdf"`, 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json(await laadRapport(admin, sp.get('deal')), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof RapportFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'ngs-rapport.GET') }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const door = await wie(user)
    if (b.actie === 'voorstel') {
      // AI: enkel een voorstel terug, er wordt niets bewaard.
      const r = await laadRapport(admin, b.deal)
      const notities = typeof b.audit_notities === 'string' ? b.audit_notities : r.deal.audit_notities ?? ''
      const briefing = typeof b.briefing_notities === 'string' ? b.briefing_notities : r.deal.briefing_notities ?? ''
      return NextResponse.json({ ok: true, voorstel: await voorstelRapport({ notities, briefing, klant: r.deal.bedrijf }) })
    }
    const antwoord = await rapportActie(admin, b, door)
    if (['afronden', 'heropen', 'samenvoegen', 'voorstel.overnemen'].includes(String(b.actie))) {
      await logAudit({ action: `ngs.rapport.${String(b.actie)}`, entityType: 'ngs_deal', entityId: typeof b.deal === 'string' ? b.deal : null, summary: `Auditrapport: ${String(b.actie)}`, actorUserId: user.id, actorEmail: user.email ?? null, ...requestMeta(req) })
    }
    try { revalidatePath('/admin/nextgensolutions') } catch { }
    return NextResponse.json(antwoord)
  } catch (e) {
    if (e instanceof RapportFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'ngs-rapport.POST') }, { status: 500 })
  }
}
