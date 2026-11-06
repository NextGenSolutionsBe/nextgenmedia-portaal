import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid, BUCKET } from '@/lib/personeel/server'
import { veiligeBestandsnaam, MAX_DOCUMENT_BYTES } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST (multipart: file) — een bestand bij een werkverslag uploaden. Het komt
 * in de eigen map van de medewerker (<id>/sessies/…); het pad gaat daarna mee
 * met het verslag. GET ?pad — een eigen bestand openen (tijdelijke link).
 */
export async function POST(req: NextRequest) {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const file = (await req.formData()).get('file') as File | null
    if (!file || file.size === 0) return NextResponse.json({ error: 'Kies een bestand.' }, { status: 400 })
    if (file.size > MAX_DOCUMENT_BYTES) return NextResponse.json({ error: 'Maximaal 20 MB per bestand.' }, { status: 400 })
    const pad = `${g.lid.id}/sessies/${crypto.randomUUID()}-${veiligeBestandsnaam(file.name)}`
    const { error } = await g.admin.storage.from(BUCKET).upload(pad, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream' })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, pad, naam: file.name.slice(0, 200) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const pad = req.nextUrl.searchParams.get('pad') ?? ''
    if (!pad.startsWith(`${g.lid.id}/sessies/`) || pad.includes('..')) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { data } = await g.admin.storage.from(BUCKET).createSignedUrl(pad, 600)
    if (!data?.signedUrl) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    return NextResponse.redirect(data.signedUrl)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
