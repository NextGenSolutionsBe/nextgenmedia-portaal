import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaff } from '@/lib/supabase/server'
import { authUrl, googleConfigured } from '@/lib/sales/google-calendar'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

// GET ?name=<persoon> — start de Google-koppeling voor die persoon (§7).
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!googleConfigured()) {
      return NextResponse.json({ error: 'Google is nog niet ingesteld (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ontbreken).' }, { status: 400 })
    }
    // Naam van de persoon wiens agenda we koppelen (Bram, Marco, ...), welke
    // handtekening onder zijn mails hoort, bij welk merk de agenda hoort en
    // wie er in ClickUp toegewezen wordt op de afspraaktaken.
    const name = (req.nextUrl.searchParams.get('name') ?? '').trim().slice(0, 60)
    const signature = (req.nextUrl.searchParams.get('signature') ?? '').trim().slice(0, 40)
    const merkId = (req.nextUrl.searchParams.get('pipeline') ?? '').trim().slice(0, 40)
    // Enkel cijfers: dit wordt straks een ClickUp-lid-id.
    const clickup = (req.nextUrl.searchParams.get('clickup') ?? '').replace(/\D/g, '').slice(0, 20)
    const pipeline = await getOrCreateSalesOrg()
    return NextResponse.redirect(authUrl(pipeline.id, randomUUID(), name, signature, merkId, clickup))
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
