import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesOfferte, publiekeLink, OfferteFout } from '@/lib/offertes-server'
import { kopieInhoud, maakOpgemaakteOfferte, wijzigOpgemaakteOfferte } from '@/lib/offertes-opmaak-server'
import { GELDIG_DAGEN } from '@/lib/offertes'
import { fout } from '../../_fout'

export const dynamic = 'force-dynamic'

const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const plus = (n: number) => { const d = new Date(`${vandaag()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** PATCH = een concept aanpassen (nieuwe pdf, zelfde link). POST { actie: 'kopie' } = een kopie als nieuw concept. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const o = await wijzigOpgemaakteOfferte(createAdminSupabaseClient(), id, b)
    await logAudit({ action: 'offerte.aangepast', entityType: 'offerte', entityId: id, summary: `Offerte ${o.offertenummer ?? ''} "${o.titel}" aangepast (concept)`, actorUserId: user.id, actorEmail: user.email ?? null, ...requestMeta(req) })
    return NextResponse.json({ offerte: { ...o, link: publiekeLink(o) } })
  } catch (e) { return fout(e, 'offerte.opmaken.PATCH') }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const b = await req.json().catch(() => ({})) as { actie?: unknown }
    if (b.actie !== 'kopie') return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const bron = await leesOfferte(admin, id)
    if (!bron) throw new OfferteFout('Offerte niet gevonden.', 404)
    if (bron.bron !== 'opgemaakt' || !bron.inhoud) throw new OfferteFout('Enkel een offerte die in de app opgemaakt werd, kan je kopiëren.', 409)
    const o = await maakOpgemaakteOfferte(admin, {
      client_id: bron.client_id, klant_naam: bron.klant_naam, opdracht_id: bron.opdracht_id, merk: bron.merk, verantwoordelijke: bron.verantwoordelijke,
      inhoud: kopieInhoud(bron.inhoud, vandaag(), plus(GELDIG_DAGEN)),
    }, { userId: user.id, email: user.email ?? null })
    await logAudit({ action: 'offerte.gekopieerd', entityType: 'offerte', entityId: o.id, summary: `Kopie van offerte ${bron.offertenummer ?? bron.titel}: ${o.offertenummer}`, actorUserId: user.id, actorEmail: user.email ?? null, ...requestMeta(req) })
    return NextResponse.json({ offerte: { ...o, link: publiekeLink(o) } })
  } catch (e) { return fout(e, 'offerte.opmaken.POST') }
}
