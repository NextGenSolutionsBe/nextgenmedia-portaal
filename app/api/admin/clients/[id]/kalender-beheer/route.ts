import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * "Contentkalender beheren door klant" — per klant, door een bevoegde interne gebruiker.
 * Wie: alle gebruikers van de klant, of geselecteerde (eigenaar via vinkje, subaccounts
 * via het bestaande portaalrecht social_media.edit — geen tweede rechtensysteem).
 * Standaard UIT.
 */
type Gebruiker = { id: string; name: string | null; email: string | null; active: boolean; permissions: Record<string, Record<string, boolean>> | null }

async function laad(admin: ReturnType<typeof createAdminSupabaseClient>, id: string) {
  const { data: c, error } = await admin.from('clients').select('id, company_name, email, kalender_beheer, kalender_beheer_wie, kalender_beheer_eigenaar').eq('id', id).maybeSingle()
  if (error) throw new Error(/kalender_beheer/.test(error.message) ? 'De databank is nog niet bijgewerkt.' : error.message)
  if (!c) throw new Error('Klant niet gevonden')
  const { data: users } = await admin.from('client_users').select('id, name, email, active, permissions').eq('client_id', id).order('created_at')
  return {
    beheer: { aan: !!c.kalender_beheer, wie: c.kalender_beheer_wie === 'geselecteerd' ? 'geselecteerd' : 'alle', eigenaar: c.kalender_beheer_eigenaar !== false },
    eigenaar: c.email ?? null,
    gebruikers: ((users ?? []) as Gebruiker[]).map((u) => ({ id: u.id, naam: u.name, email: u.email, actief: u.active, beheer: u.permissions?.social_media?.edit === true })),
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    return NextResponse.json(await laad(createAdminSupabaseClient(), id))
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const b = (await req.json().catch(() => ({}))) as { aan?: boolean; wie?: string; eigenaar?: boolean; gebruikers?: Record<string, boolean> }
    const admin = createAdminSupabaseClient()
    const oud = await laad(admin, id)
    const nieuw = { kalender_beheer: b.aan === true, kalender_beheer_wie: b.wie === 'geselecteerd' ? 'geselecteerd' : 'alle', kalender_beheer_eigenaar: b.eigenaar !== false }
    const { error } = await admin.from('clients').update(nieuw).eq('id', id)
    if (error) throw new Error(error.message)
    // Geselecteerde subaccounts: het bestaande recht social_media.edit, enkel voor gebruikers van DEZE klant.
    const gewijzigd: string[] = []
    if (b.gebruikers && typeof b.gebruikers === 'object') {
      const { data: users } = await admin.from('client_users').select('id, permissions').eq('client_id', id)
      for (const u of (users ?? []) as { id: string; permissions: Record<string, Record<string, boolean>> | null }[]) {
        if (!(u.id in b.gebruikers)) continue
        const wil = b.gebruikers[u.id] === true
        const perms = { ...(u.permissions ?? {}) }
        const sm = { ...(perms.social_media ?? {}) }
        if ((sm.edit === true) === wil) continue
        sm.edit = wil; if (wil) sm.view = true
        perms.social_media = sm
        const { error: ue } = await admin.from('client_users').update({ permissions: perms }).eq('id', u.id).eq('client_id', id)
        if (ue) throw new Error(ue.message)
        gewijzigd.push(u.id)
      }
    }
    const meta = requestMeta(req)
    await logAudit({ action: 'client.kalender_beheer', entityType: 'client', entityId: id, summary: nieuw.kalender_beheer ? `Contentkalender beheren door klant AAN (${nieuw.kalender_beheer_wie})` : 'Contentkalender beheren door klant UIT', actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent, metadata: { oud: oud.beheer, nieuw, gebruikers_gewijzigd: gewijzigd } })
    try { revalidatePath(`/admin/clients/${id}`); revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true, ...(await laad(admin, id)) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
