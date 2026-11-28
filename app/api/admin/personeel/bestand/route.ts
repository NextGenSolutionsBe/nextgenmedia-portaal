import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, BUCKET } from '@/lib/personeel/server'
import { isUuid } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/**
 * GET ?pad=<personeel_id>/sessies/... — een bestand dat een medewerker bij een
 * werkverslag toevoegde, via een tijdelijke link (10 minuten). Enkel paden
 * onder sessies/: documenten en foto's lopen via het dossier (met hun eigen rechten).
 */
export async function GET(req: NextRequest) {
  try {
    const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
    const pad = req.nextUrl.searchParams.get('pad') ?? ''
    const [pid, soort] = pad.split('/')
    if (!isUuid(pid) || soort !== 'sessies' || pad.includes('..')) return NextResponse.json({ error: 'Ongeldig bestand' }, { status: 400 })
    const { data, error } = await g.admin.storage.from(BUCKET).createSignedUrl(pad, 600)
    if (error || !data?.signedUrl) return NextResponse.json({ error: 'Bestand niet gevonden' }, { status: 404 })
    return NextResponse.redirect(data.signedUrl)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
