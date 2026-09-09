import { NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// Returns the full clients list for admin dropdowns / pickers.
// SECURITY: admin-only. Returns empty list (not 403) when called by non-admin
// to keep the UX clean when the same client component runs in a portal context.
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ clients: [] })

    // Verify admin role server-side — never trust the caller
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) {
      return NextResponse.json({ clients: [] })
    }

    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from('clients')
      .select('id, company_name')
      .order('company_name')

    return NextResponse.json({ clients: data ?? [] })
  } catch {
    return NextResponse.json({ clients: [] })
  }
}
