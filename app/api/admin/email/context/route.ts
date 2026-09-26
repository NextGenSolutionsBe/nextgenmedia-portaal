import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaff } from '@/lib/supabase/server'
import { buildClientMailContext } from '@/lib/email-context'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// GET ?client_id=&kind=&contract_id=&shoot_id= → ontvanger + placeholder-waarden
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sp = req.nextUrl.searchParams
    const clientId = sp.get('client_id')
    if (!clientId) return NextResponse.json({ error: 'client_id vereist' }, { status: 400 })
    const ctx = await buildClientMailContext({
      clientId,
      kind: sp.get('kind') ?? undefined,
      contractId: sp.get('contract_id'),
      shootId: sp.get('shoot_id'),
      taskId: sp.get('task_id'),
    })
    if (!ctx) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
    return NextResponse.json(ctx)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
