import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const BUCKET = 'contracts'
const PRIORITIES = ['laag', 'normaal', 'hoog']
const STATUSES = ['open', 'in_progress', 'done', 'cancelled']

// GET ?client_id= — taken van een klant (admin), incl. bijlage-URL
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const clientId = req.nextUrl.searchParams.get('client_id')
    if (!clientId) return NextResponse.json({ error: 'client_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('client_tasks').select('*').eq('client_id', clientId).order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    const tasks = await Promise.all((data ?? []).map(async (t: { attachment_path: string | null } & Record<string, unknown>) => {
      let attachmentUrl: string | null = null
      if (t.attachment_path) {
        const { data: s } = await admin.storage.from(BUCKET).createSignedUrl(t.attachment_path, 60 * 60)
        attachmentUrl = s?.signedUrl ?? null
      }
      return { ...t, attachmentUrl }
    }))
    return NextResponse.json({ tasks })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST (multipart) — taak aanmaken
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const fd = await req.formData()
    const client_id = fd.get('client_id') as string
    const title = (fd.get('title') as string)?.trim()
    if (!client_id || !title) return NextResponse.json({ error: 'client_id en titel zijn verplicht' }, { status: 400 })

    const priority = PRIORITIES.includes(fd.get('priority') as string) ? (fd.get('priority') as string) : 'normaal'
    const status = STATUSES.includes(fd.get('status') as string) ? (fd.get('status') as string) : 'open'
    const deadline = (fd.get('deadline') as string) || null
    const description = (fd.get('description') as string)?.trim() || null

    const admin = createAdminSupabaseClient()
    let attachmentPath: string | null = null
    let attachmentName: string | null = null
    const file = fd.get('attachment') as File | null
    if (file && file.size > 0) {
      const ext = (file.name.split('.').pop() ?? 'pdf').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'pdf'
      const path = `client-tasks/${client_id}/${randomUUID()}.${ext}`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false })
      if (!upErr) { attachmentPath = path; attachmentName = file.name.slice(0, 200) }
    }

    const { data, error } = await admin.from('client_tasks').insert({
      client_id, title: title.slice(0, 200), description, deadline, priority, status,
      attachment_path: attachmentPath, attachment_name: attachmentName, created_by: actor.id,
    }).select('id').single()
    if (error) throw new Error(error.message)
    try { revalidatePath(`/admin/clients/${client_id}`); revalidatePath('/admin') } catch { }
    return NextResponse.json({ id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH { id, ... } — taak aanpassen
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 400 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const patch: Record<string, unknown> = {}
    if (b.title !== undefined) patch.title = String(b.title).slice(0, 200)
    if (b.description !== undefined) patch.description = b.description || null
    if (b.deadline !== undefined) patch.deadline = b.deadline || null
    if (b.priority !== undefined && PRIORITIES.includes(b.priority)) patch.priority = b.priority
    if (b.status !== undefined && STATUSES.includes(b.status)) {
      patch.status = b.status
      if (b.status === 'done') patch.completed_at = new Date().toISOString()
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('client_tasks').update(patch).eq('id', b.id)
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin'); if (b.client_id) revalidatePath(`/admin/clients/${b.client_id}`) } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: task } = await admin.from('client_tasks').select('attachment_path').eq('id', id).maybeSingle()
    if (task?.attachment_path) { try { await admin.storage.from(BUCKET).remove([task.attachment_path]) } catch { } }
    const { error } = await admin.from('client_tasks').delete().eq('id', id)
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
