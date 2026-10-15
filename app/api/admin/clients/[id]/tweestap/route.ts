import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { herbevestigAdmin } from '@/lib/twofa/kern'
import { interneRol, trekAlleSessiesIn, wachtwoordKlopt } from '@/lib/twofa/server'
import { csrfFout, eigenAccount } from '@/lib/twofa/route'
import { stuurBeveiligingsmelding } from '@/lib/twofa/meldingen'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Account = { authUserId: string; naam: string | null; email: string | null; eigenaar: boolean }

/** Portaalaccounts (eigenaar + subaccounts met login) van deze klant — nooit van een andere klant. */
async function accountsVan(clientId: string): Promise<Account[] | null> {
  const db = createAdminSupabaseClient()
  const { data: c } = await db.from('clients').select('id, owner_user_id, email, contact_name').eq('id', clientId).maybeSingle()
  if (!c) return null
  const k = c as { owner_user_id: string | null; email: string | null; contact_name: string | null }
  const lijst: Account[] = []
  if (k.owner_user_id) lijst.push({ authUserId: k.owner_user_id, naam: k.contact_name, email: k.email, eigenaar: true })
  const { data: subs } = await db.from('client_users').select('auth_user_id, name, email').eq('client_id', clientId).not('auth_user_id', 'is', null)
  for (const s of (subs ?? []) as { auth_user_id: string; name: string | null; email: string | null }[]) {
    if (!lijst.some((a) => a.authUserId === s.auth_user_id)) lijst.push({ authUserId: s.auth_user_id, naam: s.name, email: s.email, eigenaar: false })
  }
  return lijst
}

/**
 * GET — 2FA-status per portaalaccount van deze klant. Enkel aan/uit, sinds
 * wanneer en hoeveel herstelcodes er over zijn: NOOIT het geheim, de QR-code,
 * de herstelcodes of hun hashes.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const accounts = await accountsVan(id)
    if (!accounts) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
    const db = createAdminSupabaseClient()
    const ids = accounts.map((a) => a.authUserId)
    const [{ data: totp }, { data: codes }] = await Promise.all([
      ids.length ? db.from('user_totp').select('user_id, actief, geactiveerd_op').in('user_id', ids) : Promise.resolve({ data: [] }),
      ids.length ? db.from('user_herstelcodes').select('user_id').in('user_id', ids).is('gebruikt_op', null) : Promise.resolve({ data: [] }),
    ])
    const t = new Map(((totp ?? []) as { user_id: string; actief: boolean; geactiveerd_op: string | null }[]).map((r) => [r.user_id, r]))
    const over = new Map<string, number>()
    for (const r of (codes ?? []) as { user_id: string }[]) over.set(r.user_id, (over.get(r.user_id) ?? 0) + 1)
    return NextResponse.json({
      accounts: accounts.map((a) => {
        const r = t.get(a.authUserId)
        return { ...a, actief: !!r?.actief, sinds: r?.actief ? r.geactiveerd_op : null, herstelcodesOver: r?.actief ? over.get(a.authUserId) ?? 0 : 0 }
      }),
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST { authUserId, reden, wachtwoord, code? } — admin-reset van de 2FA van een
 * portaalaccount van DEZE klant (telefoon én herstelcodes kwijt). Vereist een
 * reden en de herbevestiging van de admin zelf (eigen wachtwoord + eigen
 * app-code als die er een heeft). Gevolgen: app + herstelcodes weg, alle
 * sessies van dat account ingetrokken, melding per mail, logboek met reden.
 * De reset logt niemand in: het account logt daarna gewoon in met e-mail +
 * wachtwoord en kan zelf opnieuw een app koppelen.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrf = csrfFout(req); if (csrf) return csrf
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const g = await eigenAccount({ kernNodig: true })
    if (!g.ok) return g.res
    const { id } = await params
    const b = (await req.json().catch(() => ({}))) as { authUserId?: unknown; reden?: unknown; wachtwoord?: unknown; code?: unknown }
    const doel = String(b.authUserId ?? '')
    const reden = String(b.reden ?? '').trim()
    if (!UUID.test(doel)) return NextResponse.json({ error: 'Ongeldig account' }, { status: 400 })
    if (reden.length < 5) return NextResponse.json({ error: 'Geef een reden op (minstens 5 tekens).' }, { status: 400 })
    if (doel === actor.id) return NextResponse.json({ error: 'Je eigen 2FA beheer je via Mijn account.' }, { status: 400 })

    const accounts = await accountsVan(id)
    const account = accounts?.find((a) => a.authUserId === doel)
    if (!account) return NextResponse.json({ error: 'Dit account hoort niet bij deze klant.' }, { status: 404 })
    // Interne accounts vallen hier nooit onder (die hebben hun eigen beheer).
    if (await interneRol(doel)) return NextResponse.json({ error: 'Dit is een intern account; beheer het via Accounts en rechten.' }, { status: 400 })

    const r = await herbevestigAdmin(g.kern!, actor.id, {
      wachtwoordOk: await wachtwoordKlopt(g.sessie.user.email, b.wachtwoord),
      code: typeof b.code === 'string' ? b.code : null,
    })
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })

    const actiefVoor = !!(await g.kern!.opslag.lees(doel))?.actief
    await g.kern!.opslag.verwijder(doel)
    await g.kern!.opslag.vervangHerstelcodes(doel, [])
    await trekAlleSessiesIn(doel)

    const db = createAdminSupabaseClient()
    const { data: au } = await db.auth.admin.getUserById(doel)
    const doelEmail = au?.user?.email ?? account.email
    const meta = requestMeta(req)
    await logAudit({
      action: 'auth.2fa.admin_reset_klant', entityType: 'user', entityId: doel,
      summary: `2FA gereset voor ${account.naam || doelEmail || doel} (klantportaal) door een admin`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { client_id: id, reden, eigenaar: account.eigenaar, was_actief: actiefVoor },
      ip: meta.ip, userAgent: meta.userAgent,
    })
    void stuurBeveiligingsmelding(doelEmail, 'admin_reset')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
