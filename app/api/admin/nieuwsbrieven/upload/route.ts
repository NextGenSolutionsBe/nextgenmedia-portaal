import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { marketingUploadLink } from '@/lib/marketing-server'

export const dynamic = 'force-dynamic'

/** Foto voor een nieuwsbrief: ondertekende uploadlink in de publieke marketingbucket. Video's via YouTube. */
export async function POST(req: NextRequest) {
  if (!(await magIk('nieuwsbrieven', 'toevoegen')) && !(await magIk('nieuwsbrieven', 'aanpassen'))) return NextResponse.json({ error: 'Geen recht om foto\'s op te laden.' }, { status: 403 })
  const r = await marketingUploadLink(createAdminSupabaseClient(), 'nieuws', await req.json().catch(() => ({})))
  if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
  return NextResponse.json({ pad: r.pad, token: r.token, bucket: r.bucket })
}
