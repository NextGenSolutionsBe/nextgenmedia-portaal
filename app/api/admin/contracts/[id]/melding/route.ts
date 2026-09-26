import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { hermeldOndertekening } from '@/lib/contract-archief'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST — de melding naar Legal voor de nieuwste archiefversie (opnieuw)
 * versturen. Idempotent: is ze voor die versie al verstuurd, dan gebeurt er
 * niets en meldt het antwoord `alVerstuurd: true`.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: c } = await admin.from('contracts').select('id, status').eq('id', id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })
    if (String(c.status) !== 'signed' && String(c.status) !== 'getekend') return NextResponse.json({ error: 'Enkel voor een getekend contract kan een melding naar Legal vertrekken.' }, { status: 400 })

    const r = await hermeldOndertekening(admin, id, actor.email ?? null)
    try { revalidatePath(`/admin/contracts/${id}`) } catch { }
    if (r.overgeslagen) return NextResponse.json({ ok: true, alVerstuurd: true, naar: r.naar, versie: r.archief.versie, certificaatNr: r.archief.certificaatNr })
    if (!r.ok) return NextResponse.json({ ok: false, error: `Melding naar Legal mislukt: ${r.fout ?? 'onbekende fout'}`, naar: r.naar }, { status: 502 })
    return NextResponse.json({ ok: true, naar: r.naar, versie: r.archief.versie, certificaatNr: r.archief.certificaatNr })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
