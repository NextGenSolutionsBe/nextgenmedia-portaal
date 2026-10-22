import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { behandelBericht } from '@/lib/mcp/content.mjs'
import { RESOURCE_PAD, basisUrl, bearerUit, tokenNaarToegang } from '@/lib/mcp/oauth'
import { verstuurBericht, type Actor } from '@/lib/community/versturen'
import { STANDAARDREGELS } from '@/lib/community/standaardregels'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * De MCP-connector, beveiligd met OAuth.
 *
 * Dit is het adres dat in Claude ingevuld wordt:
 *
 *     https://<domein>/api/mcp
 *
 * Geen geheim in het adres meer. Wie hier aanklopt zonder geldig token krijgt
 * een 401 met een verwijzing naar de metadata; de client volgt die verwijzing,
 * stuurt de gebruiker langs het toestemmingsscherm en komt terug met een token.
 *
 * SCHRIJVEN MAG HIER. Dat is het hele punt van deze route: achter de oude
 * sleutel-in-het-adres stond schrijven uit, omdat iedereen met dat adres alles
 * had kunnen overschrijven. Nu hangt elk token aan een beheerder die er
 * persoonlijk toestemming voor gaf, is het intrekbaar, en staat elke wijziging
 * met naam en toenaam in het auditspoor.
 *
 * De oude route (/api/mcp/[sleutel]) blijft bestaan en blijft alleen-lezen,
 * zodat een bestaande koppeling niet plots stukgaat.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })
}

function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase is niet ingesteld in deze omgeving.')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  })
}

/**
 * De 401 die de hele koppeling op gang brengt.
 *
 * De `resource_metadata`-verwijzing is niet optioneel: zonder die kop weet de
 * client niet wáár hij toestemming moet gaan halen en geeft hij het op met een
 * melding over een mislukte registratie. Precies dat ging eerder mis.
 */
function nietGeautoriseerd(req: Request, uitleg = 'Geen geldig token.') {
  const basis = basisUrl(req)
  return NextResponse.json(
    { error: 'unauthorized', error_description: uitleg },
    {
      status: 401,
      headers: {
        ...CORS,
        'WWW-Authenticate':
          `Bearer realm="NextGenMedia", ` +
          `resource_metadata="${basis}/.well-known/oauth-protected-resource${RESOURCE_PAD}"`,
        'Cache-Control': 'no-store',
      },
    },
  )
}

export async function POST(req: Request) {
  const token = bearerUit(req)
  if (!token) return nietGeautoriseerd(req, 'Er is geen toegangstoken meegestuurd.')

  let toegang
  try {
    toegang = await tokenNaarToegang(supabase(), token)
  } catch (err) {
    return NextResponse.json(
      { error: 'server_error', error_description: (err as Error).message },
      { status: 500, headers: CORS },
    )
  }
  // Onbekend, verlopen of ingetrokken geeft bewust hetzelfde antwoord: het
  // verschil helpt alleen iemand die aan het proberen is.
  if (!toegang) return nietGeautoriseerd(req, 'Het token is ongeldig of verlopen.')

  let bericht: unknown
  try {
    bericht = await req.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Onleesbare JSON' } },
      { status: 400, headers: CORS },
    )
  }

  const binnen = Array.isArray(bericht) ? bericht : [bericht]
  // Community management: wie de connector koppelde, zodat indelen en versturen
  // op naam in audit_log komen (niet als "mcp-connector"). Enkel deze route
  // geeft die context mee; zonder context bestaan de community-tools niet.
  const actor = await actorVan(toegang.userId)
  const ctx = {
    community: {
      actor,
      standaardregels: STANDAARDREGELS,
      verstuur: (a: { berichtId: string; tekst: string; bevestigdDoor: string }) =>
        verstuurBericht({ ...a, actor, via: 'mcp' }),
    },
  }
  const uit = []
  for (const b of binnen) {
    // true = schrijven toegestaan. Zie de toelichting bovenaan dit bestand.
    const antwoord = await behandelBericht(supabase, b, true, ctx)
    if (antwoord) uit.push(antwoord)
  }

  if (uit.length === 0) return new NextResponse(null, { status: 202, headers: CORS })

  return NextResponse.json(Array.isArray(bericht) ? uit : uit[0], {
    headers: { ...CORS, 'Cache-Control': 'no-store' },
  })
}

/** Naam en e-mail van wie de connector koppelde (auth-gebruiker + personeelsfiche). */
async function actorVan(userId: string): Promise<Actor> {
  const db = supabase()
  const [{ data: gebruiker }, { data: staff }] = await Promise.all([
    db.auth.admin.getUserById(userId).catch(() => ({ data: null })),
    db.from('staff_members').select('name').eq('auth_user_id', userId).maybeSingle(),
  ])
  const email = gebruiker?.user?.email ?? null
  return { userId, email, naam: (staff as { name?: string | null } | null)?.name ?? email, rol: 'admin' }
}

/**
 * Sommige clients openen eerst een GET. Zonder token moet dat óók de 401 met de
 * metadata-verwijzing geven — voor een aantal clients is dít het verzoek waarmee
 * de ontdekking begint.
 */
export async function GET(req: Request) {
  const token = bearerUit(req)
  if (!token) return nietGeautoriseerd(req, 'Er is geen toegangstoken meegestuurd.')

  let toegang
  try {
    toegang = await tokenNaarToegang(supabase(), token)
  } catch {
    toegang = null
  }
  if (!toegang) return nietGeautoriseerd(req, 'Het token is ongeldig of verlopen.')

  return new NextResponse('Deze connector werkt via POST.', { status: 405, headers: CORS })
}
