import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { AcFout, laadContract, tijdlijn, verwijderContract, wijzigContract } from '@/lib/algemene-contracten/server'
import { leesProfiel } from '@/lib/account-server'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i

const fout = (e: unknown) => e instanceof AcFout
  ? NextResponse.json({ error: e.message }, { status: e.status })
  : NextResponse.json({ error: safeMessage(e, 'algemene-contracten') }, { status: 500 })

/** GET — één contract met de tijdlijn. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
  try {
    const admin = createAdminSupabaseClient()
    const [c, t] = await Promise.all([laadContract(admin, id), tijdlijn(admin, id)])
    const { bestand_pad: _b, huidig_pad: _h, ...rest } = c
    void _b; void _h
    return NextResponse.json({ contract: rest, tijdlijn: t }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fout(e) }
}

/** PATCH — gegevens (ook wie van ons tekent: ons_tekenaars), de plaats van jouw handtekening (mijn_zone), die van de andere partij, archiveren. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    // Wie het vraagt: voor de plaats van je eigen handtekening (mijn_zone).
    const profiel = 'mijn_zone' in b ? await leesProfiel(user).catch(() => null) : null
    const naam = (profiel ? `${profiel.voornaam} ${profiel.achternaam}`.trim() : '') || (user.email ?? '').split('@')[0]
    await wijzigContract(createAdminSupabaseClient(), id, b, user.email ?? null, naam)
    return NextResponse.json({ ok: true })
  } catch (e) { return fout(e) }
}

/** DELETE — enkel zolang niemand tekende (een vergissing bij het opladen). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
  try { await verwijderContract(createAdminSupabaseClient(), id); return NextResponse.json({ ok: true }) } catch (e) { return fout(e) }
}
