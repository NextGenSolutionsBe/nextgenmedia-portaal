import { createClient as createAdminClient } from '@supabase/supabase-js'

/**
 * De service-role client, los van lib/supabase/server.ts.
 *
 * WAAROM APART — de middleware draait op de EDGE-runtime en heeft deze client
 * nodig om rollen te lezen. Importeerde ze die uit server.ts, dan trok de
 * bundler ook React's `cache()` mee, en dat bestaat niet in de edge-build van
 * React ("'cache' is not exported from 'react'"). Dit bestand houdt daarom
 * bewust ALLES buiten de deur wat Next of React aangaat: enkel supabase-js.
 *
 * server.ts exporteert deze functie gewoon opnieuw, dus bestaande imports
 * blijven werken.
 */
export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is niet ingesteld')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createAdminClient<any>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Deze database wordt gedeeld met een tweede applicatie, die in een eigen
    // schema woont. Wij pinnen ons expliciet op `public` in plaats van op de
    // standaard te vertrouwen: dan kan een wijziging elders nooit stilletjes
    // onze queries naar het verkeerde schema laten wijzen.
    db: { schema: 'public' },
  })
}
