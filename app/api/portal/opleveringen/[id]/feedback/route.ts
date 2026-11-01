import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { laadOpleveringen, meldFeedbackAanTeam } from '@/lib/opleveringen-server'
import { valideerFeedback } from '@/lib/opleveringen'

export const dynamic = 'force-dynamic'

/**
 * POST { versie_id, soort: 'revisie' | 'goedkeuring' | 'opmerking', tekst?, punten? }
 * Revisie en goedkeuring kunnen enkel op de laatst gedeelde versie, één keer
 * per versie; een revisie enkel zolang er rondes over zijn. Een opmerking kan
 * altijd. Het team krijgt een interne melding; de klant krijgt nooit een mail.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requirePortalPermission('opleveringen', 'feedback')
  if (!g.ok) return g.response
  try {
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Onbekende oplevering.' }, { status: 400 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const v = valideerFeedback(b)
    if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const [o] = await laadOpleveringen(admin, { id })
    if (!o || o.client_id !== g.session.clientId) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
    const versie = o.versies.find((x) => x.id === String(b.versie_id ?? '') && x.gepubliceerd_op)
    if (!versie) return NextResponse.json({ error: 'Kies een gedeelde versie.' }, { status: 400 })
    let ronde: number | null = null
    if (v.waarde.soort !== 'opmerking') {
      if (o.actieve_versie_id !== versie.id) return NextResponse.json({ error: 'Op deze versie werd al gereageerd, of er is een nieuwere versie.' }, { status: 409 })
      if (v.waarde.soort === 'revisie') {
        if (o.revisies.volgende === null) return NextResponse.json({ error: `Je ${o.revisies.max} revisierondes zijn opgebruikt. Extra wijzigingen? Laat het ons weten via een opmerking.` }, { status: 409 })
        ronde = o.revisies.volgende
      }
    }
    const door = g.session.name || g.session.email || 'Klant'
    const { data, error } = await admin.from('oplevering_feedback').insert({
      oplevering_id: id, versie_id: versie.id, soort: v.waarde.soort, ronde, tekst: v.waarde.tekst, punten: v.waarde.punten,
      door_naam: door, door_email: g.session.email ?? null, door_user_id: g.session.userId ?? null,
    }).select('id').single()
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return NextResponse.json({ error: 'Je reactie op deze versie is al bewaard.' }, { status: 409 })
      throw new Error(error.message)
    }
    await admin.from('opleveringen').update({ updated_at: new Date().toISOString() }).eq('id', id)
    await logPortalAction(g.session, `oplevering.${v.waarde.soort}`, { type: 'oplevering', id }, { req, meta: { versie: versie.label, ronde } })
    waitUntil(meldFeedbackAanTeam({ oplevering: o, klant: o.klant_naam ?? 'Klant', versie, soort: v.waarde.soort, ronde, tekst: v.waarde.tekst, punten: v.waarde.punten, door, feedbackId: (data as { id: string }).id }))
    return NextResponse.json({ ok: true, ronde })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'portal.oplevering.feedback') }, { status: 500 }) }
}
