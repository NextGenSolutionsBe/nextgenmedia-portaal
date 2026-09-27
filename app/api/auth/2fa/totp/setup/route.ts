import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { safeMessage } from '@/lib/api-error'
import { startSetup } from '@/lib/twofa/kern'
import { eigenAccount } from '@/lib/twofa/route'

export const dynamic = 'force-dynamic'

/**
 * POST — instelling starten. Maakt server-side een nieuw geheim, bewaart het
 * VERSLEUTELD als "lopende setup" (15 min geldig, nog niet actief) en geeft de
 * QR-code + het geheim terug — de enige keer dat het geheim de server verlaat.
 * Elke nieuwe start vervangt de vorige setup; na activeren wordt het nooit meer
 * teruggegeven.
 */
export async function POST() {
  try {
    const g = await eigenAccount({ kernNodig: true, koppelenBijInloggen: true })
    if (!g.ok) return g.res
    const account = g.sessie.user.email ?? g.sessie.user.id
    const r = await startSetup(g.kern!, g.sessie.user.id, account)
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    const qrSvg = await QRCode.toString(r.uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    return NextResponse.json(
      { qrSvg, geheim: r.geheimLeesbaar, uri: r.uri },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
