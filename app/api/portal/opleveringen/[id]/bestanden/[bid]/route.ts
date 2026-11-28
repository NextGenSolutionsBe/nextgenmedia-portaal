import { NextRequest, NextResponse } from 'next/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { tekenBestand } from '@/lib/opleveringen-server'
import { beschikbaarheid } from '@/lib/opleveringen'

export const dynamic = 'force-dynamic'
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

/**
 * GET ?download=1 — een kortlevende link om te kijken of te downloaden.
 * Enkel voor een bestand van de eigen klant, in een gedeelde versie die nog
 * binnen de 3 dagen valt. Downloaden vraagt het recht "download".
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; bid: string }> }) {
  const download = req.nextUrl.searchParams.get('download') === '1'
  const g = await requirePortalPermission('opleveringen', download ? 'download' : 'view')
  if (!g.ok) return g.response
  try {
    const { id, bid } = await params
    if (!isUuid(id) || !isUuid(bid)) return NextResponse.json({ error: 'Onbekend bestand.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: o } = await admin.from('opleveringen').select('id, client_id').eq('id', id).eq('client_id', g.session.clientId).maybeSingle()
    if (!o) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
    const { data: b } = await admin.from('oplevering_bestanden').select('id, pad, naam, status, versie_id, downloads').eq('id', bid).eq('oplevering_id', id).maybeSingle()
    if (!b || (b as { status: string }).status !== 'klaar') return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
    const { data: v } = await admin.from('oplevering_versies').select('gepubliceerd_op, verloopt_op, verwijderd_op').eq('id', (b as { versie_id: string }).versie_id).maybeSingle()
    if (!v || beschikbaarheid(v as { gepubliceerd_op: string | null; verloopt_op: string | null; verwijderd_op: string | null }).status !== 'beschikbaar') {
      return NextResponse.json({ error: 'Dit bestand is niet meer beschikbaar. Vraag ons gerust een nieuwe link.' }, { status: 410 })
    }
    const rij = b as { pad: string; naam: string; downloads: number }
    const url = await tekenBestand(admin, rij, download)
    if (download) {
      await admin.from('oplevering_bestanden').update({ downloads: (rij.downloads ?? 0) + 1, laatst_gedownload_op: new Date().toISOString() }).eq('id', bid)
      await logPortalAction(g.session, 'oplevering.download', { type: 'oplevering_bestand', id: bid }, { req, meta: { oplevering_id: id, naam: rij.naam } })
    }
    return NextResponse.json({ url })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'portal.oplevering.bestand') }, { status: 500 }) }
}
