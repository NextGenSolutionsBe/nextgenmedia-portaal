import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { safeMessage } from '@/lib/api-error'
import { BUCKET, MAX_BYTES, TOEGESTAAN, bouwPad, mimeToegestaan } from '@/lib/aanvragen/bestanden'
import { leesbareGrootte } from '@/lib/client-uploads'
import { moduleVoor, soortUit } from '@/lib/aanvragen/portaal'

export const dynamic = 'force-dynamic'

/**
 * Een ondertekende uploadlink voor één bestand bij een aanvraag. De browser
 * laadt rechtstreeks op naar de opslag (een serverfunctie neemt maar enkele
 * megabytes aan). Het pad kiezen wij en begint met het client_id van de sessie.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const soort = soortUit(b.soort)
  if (!soort) return NextResponse.json({ error: 'Onbekend soort aanvraag' }, { status: 400 })
  const g = await requirePortalPermission(moduleVoor(soort), 'aanvragen')
  if (!g.ok) return g.response
  try {
    const mime = String(b.mimetype ?? '').toLowerCase()
    const grootte = Number(b.grootte)
    if (!mimeToegestaan(mime)) return NextResponse.json({ error: `Dit bestandstype kunnen we niet aannemen. Toegestaan: ${[...new Set(Object.values(TOEGESTAAN))].join(', ')}.` }, { status: 400 })
    if (!Number.isFinite(grootte) || grootte <= 0) return NextResponse.json({ error: 'De grootte van het bestand ontbreekt.' }, { status: 400 })
    if (grootte > MAX_BYTES) return NextResponse.json({ error: `Dit bestand is ${leesbareGrootte(grootte)}. Maximaal ${leesbareGrootte(MAX_BYTES)} per bestand.` }, { status: 400 })
    const pad = bouwPad(g.session.clientId, mime, randomUUID())
    const { data, error } = await createAdminSupabaseClient().storage.from(BUCKET).createSignedUploadUrl(pad)
    if (error) return NextResponse.json({ error: /bucket|not found/i.test(error.message) ? 'De opslag voor aanvragen bestaat nog niet.' : error.message }, { status: 503 })
    return NextResponse.json({ pad, token: data.token, bucket: BUCKET })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'portal-aanvragen.upload') }, { status: 500 }) }
}
