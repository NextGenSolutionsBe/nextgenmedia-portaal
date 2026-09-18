#!/usr/bin/env node
/**
 * MCP-connector voor het NextGenMedia-portaal — lokale ingang.
 *
 * Praat via stdin/stdout en draait op je eigen machine. Er is ook een ingang
 * over HTTP (app/api/mcp/[sleutel]) voor gebruik in de browser. Beide gebruiken
 * dezelfde logica uit lib/mcp/content.mjs, zodat ze niet uit elkaar lopen.
 *
 * Dit bestand doet dus nog maar twee dingen: de omgeving inlezen en berichten
 * heen en weer schuiven.
 *
 * READ-ONLY. Schrijft nooit naar de database.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { behandelBericht } from '../lib/mcp/content.mjs'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')

// .env.local wint van .env, net als bij Next.js.
for (const naam of ['.env', '.env.local']) {
  const pad = join(PROJECT, naam)
  if (!existsSync(pad)) continue
  for (const regel of readFileSync(pad, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(regel)
    if (!m) continue
    const waarde = m[2].trim().replace(/^["']|["']$/g, '')
    if (waarde) process.env[m[1]] = waarde
  }
}

// Lokaal mag schrijven: dit programma draait op de eigen machine en is niet
// vanaf het internet bereikbaar. Uitzetten kan met MCP_SCHRIJVEN=0.
const MAG_SCHRIJVEN = process.env.MCP_SCHRIJVEN !== '0'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/** Alles naar stderr: stdout is het protocolkanaal en mag niets anders bevatten. */
const log = (...a) => process.stderr.write(a.join(' ') + '\n')

let db = null
function supabase() {
  if (!URL_ || !KEY) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt. ' +
      'Zet ze in .env.local in de projectmap, of geef ze mee als omgevingsvariabelen.',
    )
  }
  if (!db) db = createClient(URL_, KEY, { auth: { persistSession: false }, db: { schema: 'public' } })
  return db
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', async (stuk) => {
  buffer += stuk
  let n
  while ((n = buffer.indexOf('\n')) >= 0) {
    const regel = buffer.slice(0, n).trim()
    buffer = buffer.slice(n + 1)
    if (!regel) continue
    let bericht
    try { bericht = JSON.parse(regel) } catch { log('[fout] onleesbaar bericht'); continue }
    const antwoord = await behandelBericht(supabase, bericht, MAG_SCHRIJVEN)
    if (antwoord) process.stdout.write(JSON.stringify(antwoord) + '\n')
  }
})
process.stdin.on('end', () => process.exit(0))

log('nextgenmedia-portaal MCP-server gestart' + (MAG_SCHRIJVEN ? ' (lezen + schrijven)' : ' (alleen lezen)') + (URL_ && KEY ? '' : ' — LET OP: Supabase-omgeving ontbreekt'))
