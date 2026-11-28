import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { eisBeheer } from '@/lib/instellingen/api'
import { leesInstellingen, bewaarInstelling } from '@/lib/instellingen/laden'
import { vergeetInstellingenCache } from '@/lib/instellingen/edge'

export const dynamic = 'force-dynamic'

const BUCKET = 'contracts'           // bestaande private bucket
const MAP = 'branding'
const MAX_BYTES = 2 * 1024 * 1024    // 2 MB

/** Bestandstype uit de eerste bytes — de extensie van de browser is geen bewijs. */
function typeVan(b: Uint8Array): { ext: 'png' | 'jpg'; mime: string } | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  return null
}

// GET — het huidige logo (voorbeeld in de instellingen), enkel voor beheerders.
export async function GET() {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const inst = await leesInstellingen()
    if (!inst.documenten.logo_path) return NextResponse.json({ error: 'Geen eigen logo ingesteld.' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.storage.from(BUCKET).download(inst.documenten.logo_path)
    if (error || !data) return NextResponse.json({ error: 'Logo niet gevonden.' }, { status: 404 })
    const bytes = new Uint8Array(await data.arrayBuffer())
    const t = typeVan(bytes)
    return new NextResponse(bytes.buffer as ArrayBuffer, { headers: { 'Content-Type': t?.mime ?? 'application/octet-stream', 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST (multipart, veld 'bestand') — nieuw logo. PNG of JPG, max 2 MB.
export async function POST(req: NextRequest) {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const form = await req.formData().catch(() => null)
    const bestand = form?.get('bestand')
    if (!(bestand instanceof File)) return NextResponse.json({ error: 'Geen bestand ontvangen.' }, { status: 400 })
    if (bestand.size > MAX_BYTES) return NextResponse.json({ error: 'Het logo mag maximaal 2 MB groot zijn.' }, { status: 400 })
    const bytes = new Uint8Array(await bestand.arrayBuffer())
    const t = typeVan(bytes)
    if (!t) return NextResponse.json({ error: 'Enkel PNG- of JPG-bestanden zijn toegestaan.' }, { status: 400 })

    const pad = `${MAP}/logo-${randomUUID()}.${t.ext}`
    const admin = createAdminSupabaseClient()
    const { error: upErr } = await admin.storage.from(BUCKET).upload(pad, bytes, { contentType: t.mime, upsert: false })
    if (upErr) throw new Error(upErr.message)

    const inst = await leesInstellingen()
    const vorig = inst.documenten.logo_path
    await bewaarInstelling(admin, 'documenten', { ...inst.documenten, logo_path: pad }, g.persoon.email)
    vergeetInstellingenCache()
    const meta = requestMeta(req)
    await logAudit({
      action: 'instellingen.documenten.logo', entityType: 'instellingen', entityId: 'documenten',
      summary: `Logo vervangen (${t.ext.toUpperCase()}, ${Math.round(bestand.size / 1024)} kB)`,
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: g.persoon.rol,
      metadata: { nieuw: pad, vorig: vorig || null, grootte: bestand.size }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, logo_path: pad })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — terug naar het standaardlogo. Het bestand blijft in de bucket (geschiedenis).
export async function DELETE(req: NextRequest) {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const admin = createAdminSupabaseClient()
    const inst = await leesInstellingen()
    if (!inst.documenten.logo_path) return NextResponse.json({ ok: true })
    const vorig = inst.documenten.logo_path
    await bewaarInstelling(admin, 'documenten', { ...inst.documenten, logo_path: '' }, g.persoon.email)
    vergeetInstellingenCache()
    const meta = requestMeta(req)
    await logAudit({
      action: 'instellingen.documenten.logo', entityType: 'instellingen', entityId: 'documenten', summary: 'Eigen logo verwijderd; standaardlogo geldt weer',
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: g.persoon.rol, metadata: { vorig }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
