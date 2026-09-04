import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabase/server'
import { BdaClient, bdaConfigured } from '@/lib/aanbestedingen/bda'
import { normaliseer } from '@/lib/aanbestedingen/normalize'
import { parseShortLink, isValidShortLink } from '@/lib/aanbestedingen/short-link'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Uitproberen van een filterlink ZONDER iets weg te schrijven.
 *
 * Bedoeld om vóór het echte werk te kunnen zien of een link klopt en hoeveel
 * opdrachten hij oplevert. Admin-only: dit praat met een externe dienst en
 * toont hoe onze filters in elkaar zitten.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!bdaConfigured()) {
      return NextResponse.json({
        error: 'BDA_AUTH_CLIENT_SECRET ontbreekt in de omgeving. Zonder die sleutel kunnen we niets ophalen.',
      }, { status: 503 })
    }

    const sp = req.nextUrl.searchParams
    const code = parseShortLink(sp.get('link') ?? '')
    if (!code || !isValidShortLink(code)) {
      return NextResponse.json({ error: 'Geef een geldige filterlink mee (?link=…).' }, { status: 400 })
    }
    const includeClosed = sp.get('closed') === '1'

    const client = new BdaClient()
    const filter = await client.filterVanShortLink(code)
    const { records, totaal } = await client.alleOpdrachten(code, { includeClosed })

    const voorbeelden = records.slice(0, 5).map((r) => {
      const o = normaliseer(r)
      return {
        referentie: o.referentienummer,
        titel: o.titel,
        organisatie: o.organisatie,
        deadline: o.uiterste_indieningsdatum,
        deadlineOrigineel: o.uiterste_indieningsdatum_raw,
        link: o.link,
      }
    })

    return NextResponse.json({
      ok: true,
      shortLink: code,
      // Wat zit er in dit filter? Handig om te zien of je de juiste plakte.
      filter: {
        cpvCodes: filter.cpvCodes ?? [],
        nutsCodes: filter.nutsCodes ?? [],
        talen: filter.publicationLanguages ?? [],
        aard: filter.natures ?? [],
      },
      opgehaald: records.length,
      totalCount: totaal,
      // Dit moet gelijk zijn; wijkt het af, dan liep het pagineren mis.
      compleet: records.length >= totaal,
      includeClosed,
      voorbeelden,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
