import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { marketingUploadLink } from '@/lib/marketing-server'

export const dynamic = 'force-dynamic'

/** Coverfoto van een event: ondertekende uploadlink in de publieke marketingbucket. */
export async function POST(req: NextRequest) {
  if (!(await magIk('events', 'toevoegen')) && !(await magIk('events', 'aanpassen'))) return NextResponse.json({ error: 'Geen recht om foto\'s op te laden.' }, { status: 403 })
  const r = await marketingUploadLink(createAdminSupabaseClient(), 'events', await req.json().catch(() => ({})))
  if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
  return NextResponse.json({ pad: r.pad, token: r.token, bucket: r.bucket })
}
