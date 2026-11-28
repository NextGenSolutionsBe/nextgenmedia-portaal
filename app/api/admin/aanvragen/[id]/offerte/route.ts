import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { BUCKET, offertePad } from '@/lib/aanvragen/bestanden'

export const dynamic = 'force-dynamic'

const MAX_OFFERTE = 20 * 1024 * 1024

/**
 * Een offerte (PDF) opladen: stap 1, een ondertekende uploadlink. Daarna
 * koppelt PATCH { actie: 'offerte', pad, ... } ze aan de aanvraag. De prijs
 * staat in de offerte zelf; de app rekent niets uit.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('aanvragen', 'aanpassen'))) return NextResponse.json({ error: 'Je mag aanvragen niet aanpassen.' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: a } = await admin.from('klant_aanvragen').select('id').eq('id', id).maybeSingle()
    if (!a) return NextResponse.json({ error: 'Aanvraag niet gevonden.' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as { mimetype?: string; grootte?: number }
    if (String(b.mimetype ?? '').toLowerCase() !== 'application/pdf') return NextResponse.json({ error: 'Een offerte laad je op als PDF. Of plak een link naar de offerte.' }, { status: 400 })
    if (!Number(b.grootte) || Number(b.grootte) > MAX_OFFERTE) return NextResponse.json({ error: 'De PDF is leeg of groter dan 20 MB.' }, { status: 400 })
    const pad = offertePad(id, randomUUID())
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(pad)
    if (error) return NextResponse.json({ error: error.message }, { status: 503 })
    return NextResponse.json({ pad, token: data.token, bucket: BUCKET })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'aanvragen.offerte') }, { status: 500 }) }
}
