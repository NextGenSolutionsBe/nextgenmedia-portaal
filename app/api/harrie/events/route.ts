import { NextRequest, NextResponse } from 'next/server'
import { herkenToken, geenToegang } from '@/lib/harrie/auth'
import { verwerkGebeurtenis } from '@/lib/harrie/events'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/harrie/events — wat Harrie deed.
 *
 * Eén gebeurtenis per verzoek. Dezelfde `idempotencyKey` een tweede keer geeft
 * 409; Harrie beschouwt dat als geslaagd en haalt hem uit zijn uitbox. Alles
 * wat wij hier stukmaken (4xx/5xx) probeert hij later opnieuw, dus een fout
 * mag nooit stilzwijgend een 200 worden.
 */
export async function POST(req: NextRequest) {
  if (!(await herkenToken(req))) return geenToegang()
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Geen geldige JSON.' }, { status: 400 })
    }
    const uit = await verwerkGebeurtenis(body)
    if (!uit.ok) return NextResponse.json({ error: uit.fout }, { status: uit.status })
    return NextResponse.json(
      { ok: true, leadId: uit.leadId, resultaat: uit.resultaat },
      { status: uit.status },
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Verwerken mislukt' },
      { status: 500 },
    )
  }
}
