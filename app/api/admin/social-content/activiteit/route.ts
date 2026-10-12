import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createClient, createAdminSupabaseClient, isActiveStaff } from '@/lib/supabase/server'
import { leesContentActiviteit } from '@/lib/content/kalender-beheer-server'

export const dynamic = 'force-dynamic'

/** GET ?item=<id> — activiteit van één contentitem (wie, wanneer, wat), voor het detailpaneel. */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (data?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('item') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Onbekend item' }, { status: 400 })
    return NextResponse.json({ activiteit: await leesContentActiviteit(createAdminSupabaseClient(), id) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
