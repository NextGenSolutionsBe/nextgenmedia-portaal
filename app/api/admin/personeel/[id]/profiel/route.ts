import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, audit } from '@/lib/personeel/server'
import { isUuid } from '@/lib/personeel/invoer'
import { controleerProfiel } from '@/lib/team/rollen'
import { functieprofielVan, bewaarFunctieprofiel, studentUren } from '@/lib/team/rollen-server'

export const dynamic = 'force-dynamic'

/** GET — functieprofiel en, voor een student, de uren van dit kalenderjaar tegenover 650. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
    const { data: p } = await g.admin.from('personeel').select('type').eq('id', id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    const [profiel, student] = await Promise.all([
      functieprofielVan(g.admin, id),
      (p as { type: string | null }).type === 'student' ? studentUren(g.admin, id) : Promise.resolve(null),
    ])
    return NextResponse.json({ profiel, student })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** PUT { profiel } — het functieprofiel bewaren (gelogd in de geschiedenis van het dossier). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => null)) as { profiel?: unknown } | null
    const nieuw = controleerProfiel(b?.profiel)
    const oud = await functieprofielVan(g.admin, id)
    await bewaarFunctieprofiel(g.admin, id, nieuw)
    await audit(g.admin, { personeel_id: id, entiteit: 'functieprofiel', actie: 'bijgewerkt', oud, nieuw, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true, profiel: nieuw })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
