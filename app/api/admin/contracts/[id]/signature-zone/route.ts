import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { sig_page, sig_x_pct, sig_y_pct, sig_width, sig_height } = await req.json()

    const admin = createAdminSupabaseClient()
    const { error } = await admin
      .from('contracts')
      .update({
        sig_page: Math.max(1, Number(sig_page) || 1),
        sig_x_pct: Math.max(0, Math.min(95, Number(sig_x_pct) || 5)),
        sig_y_pct: Math.max(0, Math.min(95, Number(sig_y_pct) || 75)),
        sig_width: Math.max(50, Number(sig_width) || 200),
        sig_height: Math.max(30, Number(sig_height) || 60),
      })
      .eq('id', id)

    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
