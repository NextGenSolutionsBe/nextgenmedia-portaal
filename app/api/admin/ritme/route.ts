import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesPersoon } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { kwartaalVan } from '@/lib/ritme/model'
import {
  RitmeFout, scorecard, bewaarScorecard, werkvoorraadPerBedrijf, overleg, overlegActie, doelen, doelActie, beslissingen, beslissingActie, beloftes, type Ik,
} from '@/lib/ritme/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Ritme van de zaakvoerders (verbeterplan fase 7): scorecard, weekoverleg,
 * kwartaaldoelen, beslissingen met stemming, beloftes en werkvoorraad.
 * Enkel voor de zaakvoerders. Niets wordt ingepland of verstuurd.
 *  GET ?deel=scorecard|werkvoorraad|overleg(&week=)|doelen(&kwartaal=)|beslissingen|beloftes
 *  POST { actie } (scorecard.instellingen, overleg.*, doel.*, beslissing.*)
 */
async function zaakvoerder(): Promise<Ik | null> {
  const p = await leesPersoon()
  return p?.isAdmin ? { userId: p.userId, email: p.email, naam: p.naam, isAdmin: true } : null
}
const fout = (e: unknown) => e instanceof RitmeFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e) }, { status: 400 })
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

export async function GET(req: NextRequest) {
  try {
    if (!(await zaakvoerder())) return NextResponse.json({ error: 'Enkel voor de zaakvoerders' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const sp = req.nextUrl.searchParams
    const deel = sp.get('deel')
    if (deel === 'scorecard') return NextResponse.json(await scorecard(admin))
    if (deel === 'werkvoorraad') return NextResponse.json({ werkvoorraad: await werkvoorraadPerBedrijf(admin) })
    if (deel === 'overleg') { const w = sp.get('week'); return NextResponse.json(await overleg(admin, w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : vandaag())) }
    if (deel === 'doelen') { const k = sp.get('kwartaal'); const kw = k && /^\d{4}-Q[1-4]$/.test(k) ? k : kwartaalVan(vandaag()); return NextResponse.json({ kwartaal: kw, doelen: await doelen(admin, kw) }) }
    if (deel === 'beslissingen') return NextResponse.json({ beslissingen: await beslissingen(admin) })
    if (deel === 'beloftes') return NextResponse.json({ beloftes: await beloftes(admin), vandaag: vandaag() })
    return NextResponse.json({ error: 'Onbekend onderdeel' }, { status: 400 })
  } catch (e) { return fout(e) }
}

export async function POST(req: NextRequest) {
  try {
    const ik = await zaakvoerder()
    if (!ik) return NextResponse.json({ error: 'Enkel voor de zaakvoerders' }, { status: 403 })
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!b || typeof b.actie !== 'string') return NextResponse.json({ error: 'Ongeldige vraag' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    if (b.actie === 'scorecard.instellingen') return NextResponse.json({ instellingen: await bewaarScorecard(admin, b.instellingen, ik) })
    if (b.actie.startsWith('overleg.')) return NextResponse.json({ overleg: await overlegActie(admin, b, ik) })
    if (b.actie.startsWith('doel.')) { await doelActie(admin, b, ik); return NextResponse.json({ ok: true }) }
    if (b.actie.startsWith('beslissing.')) { await beslissingActie(admin, b, ik); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (e) { return fout(e) }
}
