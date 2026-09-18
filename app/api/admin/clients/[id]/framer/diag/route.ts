import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { framerConfigured, framerApiKey, diagnoseFramer, probeWriteFramer } from '@/lib/framer-cms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET — diagnose: ruwe Framer-respons (collecties + velden + 1-2 items) zodat we
// de exacte veldshapes kunnen bevestigen. Admin/staff-only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: client } = await admin
      .from('clients').select('id, framer_project_url, framer_api_key').eq('id', id).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
    if (!framerConfigured(client)) return NextResponse.json({ error: 'Framer nog niet geconfigureerd' }, { status: 400 })

    const url = client.framer_project_url as string
    const key = framerApiKey(client)

    // ?probe=1 → schrijf-test (voegt tijdelijk 1 testitem toe + ruimt op) om te
    // bepalen welke fieldData-vorm Framer accepteert. ?collection=<id> optioneel.
    if (req.nextUrl.searchParams.get('probe') === '1') {
      const colId = req.nextUrl.searchParams.get('collection') ?? undefined
      const probe = await probeWriteFramer(url, key, colId)
      return NextResponse.json({ ok: true, probe })
    }

    const result = await diagnoseFramer(url, key)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fout' }, { status: 400 })
  }
}
