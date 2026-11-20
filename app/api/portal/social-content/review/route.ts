import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { kalenderPoort, geenRecht, logContentActiviteit } from '@/lib/content/kalender-beheer-server'
import { magBeoordelen } from '@/lib/content/kalender-rol'
import { STATUS_LABEL, type Status } from '@/lib/content/kalender-beheer'
import { revalidatePath } from 'next/cache'
import { notifyClientScriptActivity } from '@/lib/admin-alerts'
import { logPortalAction } from '@/lib/portal-auth'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

/**
 * Goedkeuren of een aanpassing vragen voor een item dat op de klant wacht
 * ("Feedback gevraagd", of opnieuw na een gevraagde aanpassing). Wie dat mag,
 * volgt uit de rol van de klant × de eigen portaalrechten (approve_scripts /
 * feedback); een item in een andere status kan je hier nooit goedkeuren.
 */
export async function POST(req: NextRequest) {
  try {
    const p = await kalenderPoort(); if (p.fout) return p.fout
    const { session, admin, rechten, door } = p

    const { id, decision, feedback } = await req.json()
    if (decision !== 'approved' && decision !== 'changes_requested') return NextResponse.json({ error: 'Onbekende beslissing.' }, { status: 400 })
    if (decision === 'changes_requested' && !String(feedback ?? '').trim()) return NextResponse.json({ error: 'Schrijf kort wat er moet veranderen.' }, { status: 400 })

    const { data: oud } = await admin.from('social_content_items').select('id, status').eq('id', String(id ?? '')).eq('client_id', session.clientId).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Item niet gevonden.' }, { status: 404 })
    if (!magBeoordelen(rechten, oud.status, decision)) {
      const kan = decision === 'approved' ? rechten.goedkeuren.length > 0 : rechten.afkeuren.length > 0
      return geenRecht(!kan
        ? (decision === 'approved' ? 'Je kan geen content goedkeuren. Dat doet NextGenMedia.' : 'Je kan geen aanpassing vragen. Plaats een opmerking bij het item.')
        : `Dit item staat op “${STATUS_LABEL[oud.status as Status] ?? oud.status}” en wacht niet op jouw goedkeuring.`)
    }

    // Voorwaardelijk op de oude status: twee gelijktijdige klikken veranderen niets dubbel.
    const { data: rij, error } = await admin
      .from('social_content_items')
      .update({
        status: decision,
        client_feedback: decision === 'changes_requested' ? String(feedback).trim().slice(0, 5000) : (feedback ? String(feedback).slice(0, 5000) : null),
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', oud.id)
      .eq('client_id', session.clientId)
      .eq('status', oud.status)
      .select('id')
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!rij) return NextResponse.json({ error: 'Dit item werd intussen gewijzigd. Vernieuw de pagina.' }, { status: 409 })

    try {
      revalidatePath('/portal')
      revalidatePath('/portal/social-media')
      revalidatePath('/admin/services/social-media')
    } catch { }

    await logContentActiviteit(admin, { item_id: oud.id, client_id: session.clientId, door, rol: 'klant', actie: decision === 'approved' ? 'goedgekeurd' : 'aanpassing gevraagd', details: { van: oud.status, naar: decision } })
    await logPortalAction(
      session,
      decision === 'approved' ? 'portal.script.approved' : 'portal.script.changes_requested',
      { type: 'social_content_item', id: oud.id },
      { req, meta: { decision, van: oud.status } },
    )

    // Directe interne adminmail met 1-uur bundeling per klant (best-effort).
    await notifyClientScriptActivity(session.clientId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
