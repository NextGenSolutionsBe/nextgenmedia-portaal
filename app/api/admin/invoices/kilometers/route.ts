import { NextRequest, NextResponse } from 'next/server'
import { magIk, leesInstellingen } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { zoekAdressen, afstandTussen, AfstandFout } from '@/lib/facturen/afstand-server'
import { STANDAARD_KM_TARIEF } from '@/lib/facturen/kilometers'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Kilometervergoeding op een factuur (module Facturen, recht aanpassen).
 *  GET                            → het standaardtarief en de btw (Instellingen → Facturatie)
 *  GET  ?q=<adres>                → adresvoorstellen terwijl je typt
 *  POST { van, naar }             → afstand over de weg (één richting, hele km)
 * Van en naar zijn { adres, lat?, lon? }; met coördinaten zoeken we het adres niet opnieuw op.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await magIk('invoices', 'aanpassen'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const q = req.nextUrl.searchParams.get('q')
    if (q === null) {
      const inst = await leesInstellingen()
      return NextResponse.json({ tarief: inst.facturatie.km_tarief_excl || STANDAARD_KM_TARIEF, btw: inst.facturatie.km_btw_pct ?? 21 })
    }
    return NextResponse.json({ voorstellen: await zoekAdressen(q) })
  } catch (e) {
    safeMessage(e, 'km-adressen')
    return NextResponse.json({ voorstellen: [], fout: 'Adressen opzoeken lukt nu niet. Typ het adres volledig.' })
  }
}

const plek = (v: unknown): { adres: string; lat: number | null; lon: number | null } | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const adres = String(o.adres ?? '').trim().slice(0, 300)
  const lat = typeof o.lat === 'number' && Math.abs(o.lat) <= 90 ? o.lat : null
  const lon = typeof o.lon === 'number' && Math.abs(o.lon) <= 180 ? o.lon : null
  return adres ? { adres, lat, lon } : null
}

export async function POST(req: NextRequest) {
  try {
    if (!(await magIk('invoices', 'aanpassen'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const van = plek(b.van), naar = plek(b.naar)
    if (!van || !naar) return NextResponse.json({ error: 'Vul van waar en naar waar in.' }, { status: 400 })
    return NextResponse.json(await afstandTussen(van, naar))
  } catch (e) {
    if (e instanceof AfstandFout) return NextResponse.json({ error: e.message }, { status: 422 })
    return NextResponse.json({ error: safeMessage(e, 'km-afstand') }, { status: 500 })
  }
}
