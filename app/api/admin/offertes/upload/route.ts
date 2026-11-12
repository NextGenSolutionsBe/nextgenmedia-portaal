import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { uploadLink } from '@/lib/offertes-server'
import { fout } from '../_fout'

export const dynamic = 'force-dynamic'

/** POST { soort: 'offerte' | 'sjabloon', naam, grootte } → ondertekende uploadlink: de pdf gaat rechtstreeks naar de privé-opslag. */
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { soort?: unknown; naam?: unknown; grootte?: unknown }
    const r = await uploadLink(createAdminSupabaseClient(), b.soort === 'sjabloon' ? 'sjabloon' : 'offerte', String(b.naam ?? ''), Number(b.grootte))
    return NextResponse.json(r)
  } catch (e) { return fout(e, 'offertes.upload') }
}
