import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { clickupConfigured, listClickupMembers, upsertAssignmentTask } from '@/lib/clickup'
import { matchPartnerToMember } from '@/lib/clickup-match'
import { logAudit, requestMeta } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export const maxDuration = 60

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

async function load(admin: ReturnType<typeof createAdminSupabaseClient>, id: string) {
  const { data: a } = await admin.from('freelancer_assignments').select('*').eq('id', id).maybeSingle()
  if (!a) return null
  let partnerName: string | null = null
  if (a.freelancer_id) {
    const { data: f } = await admin.from('freelancers').select('*').eq('id', a.freelancer_id).maybeSingle()
    const fr = (f ?? null) as Record<string, unknown> | null
    partnerName = (fr?.name ?? fr?.full_name ?? fr?.company_name ?? null) as string | null
  }
  let clientName: string | null = null
  if (a.client_id) {
    const { data: c } = await admin.from('clients').select('company_name').eq('id', a.client_id).maybeSingle()
    clientName = c?.company_name ?? null
  }
  return { a, partnerName, clientName }
}

// GET — preview: welk ClickUp-lid matcht de partner? (maakt nog niets aan)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdminUser())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!clickupConfigured()) return NextResponse.json({ configured: false })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const ctx = await load(admin, id)
    if (!ctx) return NextResponse.json({ error: 'Opdracht niet gevonden' }, { status: 404 })

    const members = await listClickupMembers()
    const match = await matchPartnerToMember(ctx.partnerName, members)
    return NextResponse.json({
      configured: true, partnerName: ctx.partnerName,
      alreadySynced: !!ctx.a.clickup_task_id,
      match,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — sync: maak/werk de ClickUp-taak bij + wijs (AI-gematchte) partner toe.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdminUser()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!clickupConfigured()) return NextResponse.json({ error: 'ClickUp niet geconfigureerd (CLICKUP_API_KEY ontbreekt).' }, { status: 400 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const ctx = await load(admin, id)
    if (!ctx) return NextResponse.json({ error: 'Opdracht niet gevonden' }, { status: 404 })

    const members = await listClickupMembers()
    const match = await matchPartnerToMember(ctx.partnerName, members)

    const result = await upsertAssignmentTask({
      title: ctx.a.title, description: ctx.a.description, clientName: ctx.clientName,
      roles: Array.isArray(ctx.a.roles) ? ctx.a.roles : (ctx.a.role ? [ctx.a.role] : []),
      budget: ctx.a.budget ?? ctx.a.payout ?? null, deadline: ctx.a.deadline ?? null,
      assigneeId: match?.id ?? null,
    }, ctx.a.clickup_task_id ?? null)

    if (!result.ok && !result.taskId) return NextResponse.json({ error: result.error || 'Sync mislukt' }, { status: 400 })

    // Resultaat opslaan (veerkrachtig: kolommen kunnen ontbreken vóór migratie).
    const patch: Record<string, unknown> = { clickup_task_id: result.taskId, clickup_assignee: match?.name ?? null, clickup_synced_at: new Date().toISOString() }
    const p = { ...patch }
    for (let i = 0; i < 4; i++) {
      const { error } = await admin.from('freelancer_assignments').update(p).eq('id', id)
      if (!error) break
      const col = String(error.message || '').match(/'([^']+)' column|column "([^"]+)"/)?.[1]
      if (col && col in p) { delete p[col]; continue }
      break
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'assignment.clickup_sync', entityType: 'freelancer_assignment', entityId: id,
      summary: `Opdracht "${ctx.a.title}" gesynct naar ClickUp${match ? ` — toegewezen aan ${match.name} (${match.method})` : ' — geen partner-match'}`,
      actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin',
      metadata: { task_id: result.taskId, match }, ip: meta.ip, userAgent: meta.userAgent,
    })

    try { revalidatePath('/admin/assignments'); if (ctx.a.freelancer_id) revalidatePath(`/admin/partners/${ctx.a.freelancer_id}`) } catch { }
    return NextResponse.json({ ok: true, taskId: result.taskId, match, warning: match ? null : 'Geen overeenkomende partner in ClickUp gevonden — taak zonder verantwoordelijke aangemaakt.' })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
