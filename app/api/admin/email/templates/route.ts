import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { DEFAULT_TEMPLATES } from '@/lib/email-templates-defaults'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('email_templates').select('*').order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ templates: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const admin = createAdminSupabaseClient()

    // Speciale actie: standaardtemplates toevoegen (enkel wat nog niet bestaat).
    if (b.action === 'seed_defaults') {
      const { data: existing } = await admin.from('email_templates').select('name')
      const have = new Set((existing ?? []).map((t: { name: string }) => t.name))
      const toAdd = DEFAULT_TEMPLATES.filter((t) => !have.has(t.name)).map((t) => ({ ...t, created_by: actor.id }))
      if (toAdd.length > 0) {
        const { error } = await admin.from('email_templates').insert(toAdd)
        if (error) throw new Error(error.message)
      }
      return NextResponse.json({ added: toAdd.length })
    }

    if (!b.name?.trim()) return NextResponse.json({ error: 'Naam is verplicht' }, { status: 400 })
    const { data, error } = await admin.from('email_templates').insert({
      name: String(b.name).slice(0, 120),
      subject: b.subject || '',
      body: b.body || '',
      kind: b.kind || 'generic',
      cta_text: b.cta_text || null,
      cta_link: b.cta_link || null,
      created_by: actor.id,
    }).select('id').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const patch: Record<string, unknown> = {}
    if (b.name !== undefined) patch.name = String(b.name).slice(0, 120)
    if (b.subject !== undefined) patch.subject = b.subject
    if (b.body !== undefined) patch.body = b.body
    if (b.kind !== undefined) patch.kind = b.kind
    if (b.cta_text !== undefined) patch.cta_text = b.cta_text || null
    if (b.cta_link !== undefined) patch.cta_link = b.cta_link || null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('email_templates').update(patch).eq('id', b.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('email_templates').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
