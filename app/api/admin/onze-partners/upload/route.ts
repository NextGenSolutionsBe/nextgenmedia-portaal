import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { marketingUploadLink } from '@/lib/marketing-server'

export const dynamic = 'force-dynamic'

/** Logo opladen: ondertekende uploadlink in de publieke marketingbucket. */
export async function POST(req: NextRequest) {
  if (!(await magIk('onze_partners', 'toevoegen')) && !(await magIk('onze_partners', 'aanpassen'))) return NextResponse.json({ error: 'Geen recht om logo\'s op te laden.' }, { status: 403 })
  const r = await marketingUploadLink(createAdminSupabaseClient(), 'partners', await req.json().catch(() => ({})))
  if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
  return NextResponse.json({ pad: r.pad, token: r.token, bucket: r.bucket })
}
