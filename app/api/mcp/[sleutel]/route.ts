import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sleutelKlopt as controleerSleutel } from '@/lib/mcp/auth'
// Gedeelde logica in .mjs, zodat het lokale programma en deze route exact
// hetzelfde antwoorden zonder bouwstap ertussen.
import { behandelBericht } from '@/lib/mcp/content.mjs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * MCP-connector over HTTP, zodat het portaal als "custom connector" in Claude
 * gezet kan worden — ook in de browser, waar een lokaal programma niet bereikbaar is.
 *
 * BEVEILIGING. Dit endpoint staat op het open internet en geeft toegang tot de
 * content van alle klanten. Er is bewust GEEN sessie: een connector heeft geen
 * ingelogde gebruiker. In plaats daarvan zit de sleutel in het pad:
 *
 *     https://<domein>/api/mcp/<MCP_SECRET>
 *
 * Dat is een gedeeld geheim, geen volwaardige authenticatie. Wie het adres heeft,
 * heeft toegang. Daarom:
 *  • MCP_SECRET moet lang en willekeurig zijn (minstens 32 tekens; korter weigeren we);
 *  • intrekken doe je door de variabele te vervangen en opnieuw te deployen;
 *  • het endpoint is READ-ONLY — er kan niets gewijzigd of verwijderd worden;
 *  • bij een verkeerde sleutel antwoorden we 404, niet 403. Een 403 verklapt dat
 *    er hier iets bestaat om naar te raden.
 *
 * De vergelijking is tijdconstant, zodat je de sleutel niet teken voor teken
 * kan afleiden uit hoe snel we antwoorden.
 */

const sleutelKlopt = (gegeven: string) => controleerSleutel(gegeven, process.env.MCP_SECRET)

function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase is niet ingesteld in deze omgeving.')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  })
}

const NIET_GEVONDEN = new NextResponse('Not found', { status: 404 })

export async function POST(req: NextRequest, { params }: { params: Promise<{ sleutel: string }> }) {
  const { sleutel } = await params
  if (!sleutelKlopt(sleutel)) return NIET_GEVONDEN

  let bericht: unknown
  try {
    bericht = await req.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Onleesbare JSON' } },
      { status: 400 },
    )
  }

  // Een client mag meerdere berichten tegelijk sturen.
  const binnen = Array.isArray(bericht) ? bericht : [bericht]
  const uit = []
  for (const b of binnen) {
    // Schrijven staat hier BEWUST uit. De enige beveiliging is een sleutel in
    // het adres; wie die heeft zou anders content van alle klanten kunnen
    // aanmaken en overschrijven. Zet dit pas aan als er echte OAuth staat.
    const antwoord = await behandelBericht(supabase, b, false)
    if (antwoord) uit.push(antwoord)
  }

  // Enkel meldingen? Dan is er niets te antwoorden.
  if (uit.length === 0) return new NextResponse(null, { status: 202 })

  return NextResponse.json(Array.isArray(bericht) ? uit : uit[0], {
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * Sommige clients openen eerst een GET voor een doorlopende verbinding. Die
 * bieden we niet aan; 405 is het afgesproken antwoord daarvoor. Bij een
 * verkeerde sleutel blijft het 404, zodat ook dit niets verklapt.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ sleutel: string }> }) {
  const { sleutel } = await params
  if (!sleutelKlopt(sleutel)) return NIET_GEVONDEN
  return new NextResponse('Deze connector werkt via POST.', { status: 405 })
}
