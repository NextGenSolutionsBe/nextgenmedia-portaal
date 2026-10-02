import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { FOUNDERS } from '@/lib/founders'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// GET — status: bestaan de drie zaakvoerder-accounts al?
export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const emails = new Set((data?.users ?? []).map((u) => (u.email ?? '').toLowerCase()))
    const existing = FOUNDERS.filter((f) => emails.has(f.email.toLowerCase())).map((f) => f.email)
    return NextResponse.json({ existing, total: FOUNDERS.length })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST { password } — maak de drie zaakvoerder-admins aan (idempotent).
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { password } = await req.json()
    if (!password || String(password).length < 8) {
      return NextResponse.json({ error: 'Wachtwoord van minstens 8 tekens vereist' }, { status: 400 })
    }
    const admin = createAdminSupabaseClient()

    // Bestaande gebruikers ophalen (om dubbels te vermijden)
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const byEmail = new Map((list?.users ?? []).map((u) => [(u.email ?? '').toLowerCase(), u]))

    const result: { email: string; status: string }[] = []
    for (const f of FOUNDERS) {
      let userId = byEmail.get(f.email.toLowerCase())?.id
      if (!userId) {
        const { data: created, error } = await admin.auth.admin.createUser({
          email: f.email, password: String(password), email_confirm: true, user_metadata: { name: f.name },
        })
        if (error || !created.user) { result.push({ email: f.email, status: `mislukt: ${error?.message ?? 'onbekend'}` }); continue }
        userId = created.user.id
        result.push({ email: f.email, status: 'aangemaakt' })
      } else {
        result.push({ email: f.email, status: 'bestond al' })
      }
      // Adminrol garanderen (geen aanname over unieke constraint)
      try {
        const { data: existingRole } = await admin.from('user_roles').select('user_id').eq('user_id', userId).maybeSingle()
        if (existingRole) await admin.from('user_roles').update({ role: 'admin' }).eq('user_id', userId)
        else await admin.from('user_roles').insert({ user_id: userId, role: 'admin' })
      } catch { }
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'founders.setup', entityType: 'admin', entityId: null,
      summary: 'Zaakvoerder-admins aangemaakt/gegarandeerd',
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { result }, ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
