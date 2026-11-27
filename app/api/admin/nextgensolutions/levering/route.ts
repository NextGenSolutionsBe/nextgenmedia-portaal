import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { controleerStory, type StoryInvoer } from '@/lib/ngs/levering'
import {
  LeveringFout, laadLevering, projectDetail, dealKlant, projectStarten, projectVanDeal, wijzigProject, bevestigBriefing, naarFase,
  keurPlanGoed, planTerug, archiveerProject, voegStoriesToe, wijzigStory, archiveerStory, planReview, actiesUitReview, zetActie,
  bewaarCare, careGecontroleerd, archiveerCare, klantSolutions,
} from '@/lib/ngs/levering-server'
import { voorstelUitTijdscan } from '@/lib/ngs/levering-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Levering van NextGenSolutions (verbeterplan fase 5). Toegang: module
 * nextgensolutions (middleware) en actief teamlid.
 *  GET                → projecten en Care
 *  GET ?project=<id>  → één project met stories, deal en Care
 *  GET ?deal=<id>     → het project van een deal (of null)
 *  GET ?klant=<id>    → alles van Solutions bij een klant (klantfiche)
 *  POST { actie, … }  → zie hieronder; nooit iets definitief verwijderd
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
    if (sp.get('project')) return NextResponse.json(await projectDetail(admin, sp.get('project')))
    if (sp.get('deal')) return NextResponse.json({ project: await projectVanDeal(admin, String(sp.get('deal'))) })
    if (sp.get('klant')) return NextResponse.json(await klantSolutions(admin, sp.get('klant')))
    return NextResponse.json(await laadLevering(admin), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof LeveringFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'ngs-levering.GET') }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const door = await wie(user)
    let antwoord: Record<string, unknown> = { ok: true }
    switch (b.actie) {
      case 'deal.klant': await dealKlant(admin, b.deal, b.client_id ?? null, door); break
      case 'project.start': antwoord = { ok: true, id: await projectStarten(admin, b.deal, door) }; break
      case 'project.wijzig': await wijzigProject(admin, b.id, b, door); break
      case 'project.briefing': await bevestigBriefing(admin, b.id, door); break
      case 'project.fase': await naarFase(admin, b.id, b.naar, door); break
      case 'project.plan': antwoord = { ok: true, prijs: await keurPlanGoed(admin, b.id, b.prijs, door) }; break
      case 'project.plan_terug': await planTerug(admin, b.id, door); break
      case 'project.archiveer': await archiveerProject(admin, b.id, door); break
      case 'project.voorstel': {
        // AI: enkel een voorstel terug, er wordt niets bewaard.
        const d = await projectDetail(admin, b.id)
        const notities = typeof b.notities === 'string' ? b.notities : d.project.tijdscan_notities ?? ''
        antwoord = { ok: true, voorstel: await voorstelUitTijdscan({ notities, briefing: d.project.briefing, klant: d.klant ?? d.project.titel }) }
        break
      }
      case 'story.nieuw': {
        const lijst = (Array.isArray(b.stories) ? b.stories : [b]) as Record<string, unknown>[]
        const nette: StoryInvoer[] = []
        for (const s of lijst.slice(0, 30)) { const c = controleerStory(s); if (!c.ok) throw new LeveringFout(c.fout); nette.push(c.story) }
        antwoord = { ok: true, aantal: await voegStoriesToe(admin, b.id, nette) }
        break
      }
      case 'story.wijzig': await wijzigStory(admin, b.id, b.story, b, door); break
      case 'story.archiveer': await archiveerStory(admin, b.id, b.story); break
      case 'review.plan': await planReview(admin, b.id, b, user.id); break
      case 'review.acties': antwoord = { ok: true, aantal: await actiesUitReview(admin, b.id, b.notities, door) }; break
      case 'actie.zet': await zetActie(admin, b.id, b.actie_id, b); break
      case 'care.bewaar': antwoord = { ok: true, id: await bewaarCare(admin, b, door) }; break
      case 'care.gecontroleerd': await careGecontroleerd(admin, b.id); break
      case 'care.archiveer': await archiveerCare(admin, b.id); break
      default: throw new LeveringFout('Onbekende actie.')
    }
    if (b.actie !== 'project.voorstel' && b.actie !== 'actie.zet') {
      const meta = requestMeta(req)
      await logAudit({ action: `ngs.${String(b.actie)}`, entityType: 'ngs_levering', entityId: typeof b.id === 'string' ? b.id : typeof b.deal === 'string' ? b.deal : null, summary: String(b.actie), actorUserId: user.id, actorEmail: user.email ?? null, ip: meta.ip, userAgent: meta.userAgent })
    }
    try { revalidatePath('/admin/nextgensolutions/levering') } catch { /* */ }
    return NextResponse.json(antwoord)
  } catch (e) {
    if (e instanceof LeveringFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'ngs-levering.POST') }, { status: 500 })
  }
}
