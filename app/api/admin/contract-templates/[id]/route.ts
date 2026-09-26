import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

// PATCH — naam / categorie / actief bijwerken.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAdminUser()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json()
    const patch: Record<string, unknown> = {}
    if (typeof b.name === 'string') patch.name = b.name.trim()
    if ('category' in b) patch.category = b.category || null
    if (typeof b.active === 'boolean') patch.active = b.active
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Niets om bij te werken' }, { status: 400 })
    patch.updated_at = new Date().toISOString()

    const admin = createAdminSupabaseClient()
    // Veerkrachtig: laat ontbrekende kolommen vallen.
    const p = { ...patch }
    for (let i = 0; i < 4; i++) {
      const { error } = await admin.from('contract_templates').update(p).eq('id', id)
      if (!error) break
      const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
      if (col && col in p) { delete p[col]; continue }
      throw new Error(error.message)
    }

    try { revalidatePath('/admin/contracts/templates') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — template verwijderen (+ PDF in storage). Raakt bestaande contracten niet.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAdminUser()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const { data: tpl } = await admin.from('contract_templates').select('pdf_path').eq('id', id).maybeSingle()
    const { error } = await admin.from('contract_templates').delete().eq('id', id)
    if (error) throw new Error(error.message)
    if (tpl?.pdf_path) { try { await admin.storage.from('contracts').remove([tpl.pdf_path]) } catch { } }

    try { revalidatePath('/admin/contracts/templates') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
