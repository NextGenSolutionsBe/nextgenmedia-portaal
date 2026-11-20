import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { AccountFout, klantAccount, maakKlantAccount } from '@/lib/klant-account-server'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

/**
 * Het klantaccount (login voor de klantapp).
 *  GET  → heeft de klant een account, met welk e-mailadres.
 *  POST { email } → account aanmaken voor een klant zonder login (bv. een
 *       snelle klant). Niemand kent het wachtwoord: de klant kiest het zelf
 *       via de welkomstmail. Enkel admins.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const a = await klantAccount(createAdminSupabaseClient(), id)
    return NextResponse.json({ heeftAccount: !!a.userId, email: a.email, klant: a.klant, contact: a.contact })
  } catch (e) {
    if (e instanceof AccountFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e) }, { status: 400 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const b = await req.json().catch(() => ({})) as { email?: unknown }
    const a = await maakKlantAccount(createAdminSupabaseClient(), id, b.email)
    const m = requestMeta(req)
    await logAudit({ action: 'client.account_aangemaakt', entityType: 'client', entityId: id, summary: `Klantaccount aangemaakt voor ${a.klant} (${a.email})`, actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin', ip: m.ip, userAgent: m.userAgent })
    try { revalidatePath(`/admin/clients/${id}`) } catch { }
    return NextResponse.json({ ok: true, email: a.email })
  } catch (e) {
    if (e instanceof AccountFout) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e) }, { status: 400 })
  }
}
