import { NextRequest, NextResponse } from 'next/server'
import { requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { schrijfWerkmap } from '@/lib/excel/xlsx-schrijf'
import { xlsxAntwoord } from '@/lib/excel/antwoord'
import type { Werkmap } from '@/lib/excel/spec'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Excel-export van een dashboard dat zijn cijfers al in de browser heeft.
 *
 * Het scherm stuurt de werkmap-beschrijving (bladen, tabellen, formules) die
 * het uit zijn eigen, al geladen data opbouwt — dus exact de cijfers en de
 * filters die de gebruiker voor zich ziet, zonder een tweede rekenpad. De
 * server zet dat om naar een echt .xlsx. Wie hier komt, heeft die data al:
 * de route rendert enkel wat de aanroeper zelf aanlevert en leest niets bij.
 */

const MAX_BYTES = 8 * 1024 * 1024
const MAX_BLADEN = 25
const MAX_RIJEN = 60_000

function valideer(w: unknown): Werkmap {
  if (!w || typeof w !== 'object') throw new Error('Geen werkmap meegegeven.')
  const m = w as Partial<Werkmap>
  if (!m.titel || typeof m.titel !== 'string') throw new Error('Titel ontbreekt.')
  if (!Array.isArray(m.bladen) || m.bladen.length === 0) throw new Error('Geen bladen om te exporteren.')
  if (m.bladen.length > MAX_BLADEN) throw new Error(`Te veel bladen (max ${MAX_BLADEN}).`)
  let rijen = 0
  for (const b of m.bladen) {
    if (!b || typeof b.naam !== 'string' || !Array.isArray(b.blokken)) throw new Error('Ongeldig blad.')
    for (const blok of b.blokken) {
      if (blok.soort === 'tabel') {
        if (!Array.isArray(blok.kolommen) || !Array.isArray(blok.rijen)) throw new Error('Ongeldige tabel.')
        rijen += blok.rijen.length
      }
    }
  }
  if (rijen > MAX_RIJEN) throw new Error(`Te veel rijen (${rijen}); maximaal ${MAX_RIJEN} per export.`)
  return { ...m, bestandsnaam: typeof m.bestandsnaam === 'string' && m.bestandsnaam ? m.bestandsnaam : 'NextGenMedia_Export' } as Werkmap
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const lengte = Number(req.headers.get('content-length') ?? 0)
    if (lengte > MAX_BYTES) return NextResponse.json({ error: 'De export is te groot om in één keer te maken.' }, { status: 413 })

    const body = await req.json() as { werkmap?: unknown }
    const werkmap = valideer(body.werkmap)
    const uit = schrijfWerkmap(werkmap)

    const meta = requestMeta(req)
    await logAudit({
      action: 'export.xlsx', entityType: 'export', entityId: null,
      summary: `Excel-export: ${uit.bestandsnaam} (${werkmap.bladen.length} bladen)`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return xlsxAntwoord(uit.buffer, uit.bestandsnaam, uit.mime)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
