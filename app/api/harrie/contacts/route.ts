import { NextRequest, NextResponse } from 'next/server'
import { herkenToken, geenToegang } from '@/lib/harrie/auth'
import { haalContacten } from '@/lib/harrie/contacts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/harrie/contacts — wie Harrie met rust moet laten.
 *
 *   ?updated_since=<ISO8601>  enkel wat daarna wijzigde
 *   ?cursor=<c>               volgende blad
 *   ?limit=<n>                aantal per blad (Harrie vraagt 200)
 *
 * `doNotContact` is de enige waarde die telt. `stage` is vrije tekst en mag
 * veranderen zonder dat er aan Harrie's kant iets stukgaat.
 */
export async function GET(req: NextRequest) {
  if (!(await herkenToken(req))) return geenToegang()
  try {
    const sp = req.nextUrl.searchParams
    const ruwSinds = sp.get('updated_since')
    // Een onleesbare datum negeren we liever dan er een fout van te maken: dan
    // haalt Harrie gewoon alles op, en dat is nooit verkeerd — enkel trager.
    const sinds = ruwSinds && Number.isFinite(new Date(ruwSinds).getTime())
      ? new Date(ruwSinds).toISOString()
      : null

    const pagina = await haalContacten({
      updatedSince: sinds,
      cursor: sp.get('cursor'),
      limit: Number(sp.get('limit') ?? 200) || 200,
    })
    return NextResponse.json(pagina)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ophalen mislukt' },
      { status: 500 },
    )
  }
}
