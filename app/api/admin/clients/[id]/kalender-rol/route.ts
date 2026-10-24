import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireAdmin, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { isKalenderRol, ROL_INFO, type KalenderRol } from '@/lib/content/kalender-rol'

export const dynamic = 'force-dynamic'

/**
 * Rol van de klant in de contentplanning (clients.kalender_rol). Leeg = Standaard
 * (de werking van vóór de rollen). Lezen: elk intern teamlid (de kalender toont
 * de rol); wijzigen: enkel een beheerder. Raakt geen content, statussen of
 * individuele rechten van subaccounts — die blijven gelden binnen de rol.
 */
type Sub = { id: string; name: string | null; email: string | null; active: boolean; permissions: Record<string, Record<string, boolean>> | null }

async function laad(admin: ReturnType<typeof createAdminSupabaseClient>, id: string) {
  const { data: c, error } = await admin.from('clients').select('id, kalender_rol, kalender_beheer').eq('id', id).maybeSingle()
  if (error) throw new Error(/kalender_rol/.test(error.message) ? 'De databank is nog niet bijgewerkt. Voer de migratie uit.' : error.message)
  if (!c) throw new Error('Klant niet gevonden')
  const [{ data: users }, { data: log }] = await Promise.all([
    admin.from('client_users').select('id, name, email, active, permissions').eq('client_id', id).order('created_at'),
    admin.from('audit_log').select('actor_email, created_at').eq('action', 'client.kalender_rol').eq('entity_id', id).order('created_at', { ascending: false }).limit(1),
  ])
  const laatste = ((log ?? []) as { actor_email: string | null; created_at: string }[])[0]
  return {
    rol: isKalenderRol(c.kalender_rol) ? (c.kalender_rol as KalenderRol) : null,
    oudBeheer: c.kalender_beheer === true,
    gewijzigd: laatste ? { door: laatste.actor_email, op: laatste.created_at } : null,
    // Individuele portaalrechten op social media: binnen de rol blijven die gelden.
    subaccounts: ((users ?? []) as Sub[]).map((u) => {
      // Lege rechten = volledige rechten (zelfde terugval als lib/portal-auth.ts).
      const leeg = !u.permissions || Object.keys(u.permissions).length === 0
      const sm = leeg ? { view: true, edit: true, feedback: true, approve_scripts: true } : (u.permissions?.social_media ?? {})
      return { id: u.id, naam: u.name, email: u.email, actief: u.active, rechten: { view: sm.view === true, edit: sm.edit === true, feedback: sm.feedback === true, approve_scripts: sm.approve_scripts === true } }
    }),
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    return NextResponse.json(await laad(createAdminSupabaseClient(), id))
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Enkel een beheerder kan de rol in de contentplanning wijzigen.' }, { status: 403 })
    const { id } = await params
    const b = (await req.json().catch(() => ({}))) as { rol?: unknown }
    // 'standaard' (of leeg) = terug naar de werking van vóór de rollen.
    if (b.rol !== null && b.rol !== 'standaard' && !isKalenderRol(b.rol)) return NextResponse.json({ error: 'Kies een geldige rol.' }, { status: 400 })
    const nieuw: KalenderRol | null = isKalenderRol(b.rol) ? b.rol : null
    const admin = createAdminSupabaseClient()
    const oud = await laad(admin, id)
    if (oud.rol === nieuw) return NextResponse.json({ ok: true, ongewijzigd: true, ...oud })
    // Enkel deze ene klant; niets anders wordt aangeraakt.
    const { error } = await admin.from('clients').update({ kalender_rol: nieuw }).eq('id', id)
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    const label = (r: KalenderRol | null) => ROL_INFO[r ?? 'standaard'].label
    await logAudit({ action: 'client.kalender_rol', entityType: 'client', entityId: id, summary: `Rol in de contentplanning: ${label(oud.rol)} → ${label(nieuw)}`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent, metadata: { oud: oud.rol, nieuw } })
    try { revalidatePath(`/admin/clients/${id}`); revalidatePath('/portal'); revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true, ...(await laad(admin, id)) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
