import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { bevestigSetup, herbevestigAdmin, startSetup } from '@/lib/twofa/kern'
import { wachtwoordKlopt, wisAlleSessies } from '@/lib/twofa/server'
import { eigenAccount, logSecurity } from '@/lib/twofa/route'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DUUR_MS: Record<string, number | null> = { '24u': 24 * 3600_000, '7d': 7 * 86400_000, onbeperkt: null }

/**
 * POST { actie, authUserId, ... } — een admin beheert de 2FA (authenticator-app)
 * van een ANDER intern account. Nooit voor het eigen account (daarvoor is Mijn
 * account). Elke actie komt in het logboek.
 *
 *  aanzetten        2FA weer verplicht (eindigt een vrijstelling)            — geen herbevestiging
 *  uitschakelen     { duur: '24u'|'7d'|'onbeperkt', wachtwoord, code? }      — tijdelijk geen 2FA
 *  resetten         { wachtwoord, code? } — app + herstelcodes weg; bij de volgende login koppelt
 *                   die persoon een nieuwe app
 *  koppel_start     { wachtwoord, code? } — QR voor dat account (de persoon scant met zijn telefoon)
 *  koppel_bevestig  { doelCode } — de code uit die telefoon; enkel voor een koppeling die DEZE
 *                   admin net startte (≤ 15 min). Geeft de herstelcodes van die persoon terug.
 *
 * Herbevestiging = het eigen wachtwoord, plus de eigen app-code als de admin een app heeft.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const g = await eigenAccount({ kernNodig: true })
    if (!g.ok) return g.res
    const kern = g.kern!
    const b = (await req.json().catch(() => ({}))) as {
      actie?: unknown; authUserId?: unknown; wachtwoord?: unknown; code?: unknown; duur?: unknown; doelCode?: unknown
    }
    const actie = String(b.actie ?? '')
    const doel = String(b.authUserId ?? '')
    if (!UUID.test(doel)) return NextResponse.json({ error: 'Ongeldig account' }, { status: 400 })
    if (doel === actor.id) return NextResponse.json({ error: 'Je eigen 2FA beheer je via Mijn account.' }, { status: 400 })

    // Enkel interne accounts (admin of werknemer, niet gearchiveerd).
    const db = createAdminSupabaseClient()
    const [{ data: rol }, { data: staff }, { data: au }] = await Promise.all([
      db.from('user_roles').select('role').eq('user_id', doel).maybeSingle(),
      db.from('staff_members').select('name, email, verwijderd_at').eq('auth_user_id', doel).maybeSingle(),
      db.auth.admin.getUserById(doel),
    ])
    const isAdmin = (rol as { role?: string } | null)?.role === 'admin'
    const st = staff as { name?: string | null; email?: string | null; verwijderd_at?: string | null } | null
    if (!isAdmin && (!st || st.verwijderd_at)) return NextResponse.json({ error: 'Dit is geen actief intern account.' }, { status: 400 })
    const doelEmail = au?.user?.email ?? st?.email ?? null
    const wie = st?.name || doelEmail || doel

    const herbevestig = async () => herbevestigAdmin(kern, actor.id, {
      wachtwoordOk: await wachtwoordKlopt(g.sessie.user.email, b.wachtwoord),
      code: typeof b.code === 'string' ? b.code : null,
    })
    const zetInstelling = async (verplicht: boolean, tot: string | null, note: string) => {
      const { error } = await db.from('login_settings').upsert({
        auth_user_id: doel, two_factor_required: verplicht, vrijgesteld_tot: verplicht ? null : tot,
        note, updated_by: actor.id, updated_at: new Date().toISOString(),
      }, { onConflict: 'auth_user_id' })
      if (error) throw new Error(error.message)
    }

    if (actie === 'aanzetten') {
      await zetInstelling(true, null, '2FA weer verplicht gezet door een admin')
      logSecurity(req, g.sessie, g.rol, 'auth.2fa.aangezet_door_admin', `2FA weer verplicht voor ${wie}`, { entityId: doel })
      return NextResponse.json({ ok: true })
    }

    if (actie === 'uitschakelen') {
      const duur = String(b.duur ?? '')
      if (!(duur in DUUR_MS)) return NextResponse.json({ error: 'Kies hoe lang.' }, { status: 400 })
      const r = await herbevestig(); if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
      const ms = DUUR_MS[duur]
      const tot = ms === null ? null : new Date(Date.now() + ms).toISOString()
      await zetInstelling(false, tot, `2FA tijdelijk uitgeschakeld door een admin (${duur})`)
      logSecurity(req, g.sessie, g.rol, 'auth.2fa.uitgeschakeld_door_admin',
        `2FA uitgeschakeld voor ${wie} ${tot ? `tot ${new Date(tot).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}` : 'tot een admin ze weer aanzet'}`,
        { entityId: doel, metadata: { duur, tot } })
      return NextResponse.json({ ok: true, tot })
    }

    if (actie === 'resetten') {
      const r = await herbevestig(); if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
      await kern.opslag.verwijder(doel)
      await kern.opslag.vervangHerstelcodes(doel, [])
      await wisAlleSessies(doel)
      logSecurity(req, g.sessie, g.rol, 'auth.2fa.reset_door_admin', `App-2FA van ${wie} gereset — koppelt bij de volgende login een nieuwe app`, { entityId: doel })
      return NextResponse.json({ ok: true })
    }

    if (actie === 'koppel_start') {
      const r = await herbevestig(); if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
      const s = await startSetup(kern, doel, doelEmail ?? doel, actor.id)
      if (!s.ok) return NextResponse.json({ error: s.status === 409 ? 'Deze persoon heeft al een app gekoppeld. Reset eerst.' : s.fout }, { status: s.status })
      const qrSvg = await QRCode.toString(s.uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      logSecurity(req, g.sessie, g.rol, 'auth.2fa.koppelen_gestart_door_admin', `App-koppeling gestart voor ${wie}`, { entityId: doel })
      return NextResponse.json({ qrSvg, geheim: s.geheimLeesbaar }, { headers: { 'Cache-Control': 'no-store' } })
    }

    if (actie === 'koppel_bevestig') {
      const rij = await kern.opslag.lees(doel)
      if (!rij?.setup_secret_enc || rij.setup_door !== actor.id) {
        return NextResponse.json({ error: 'Start de koppeling opnieuw.' }, { status: 400 })
      }
      const r = await bevestigSetup(kern, doel, typeof b.doelCode === 'string' ? b.doelCode : '')
      if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
      // Gekoppeld = voortaan verplicht; oude markeringen van die persoon opruimen.
      await zetInstelling(true, null, 'App gekoppeld door een admin')
      await wisAlleSessies(doel)
      logSecurity(req, g.sessie, g.rol, 'auth.2fa.gekoppeld_door_admin', `Authenticator-app gekoppeld voor ${wie}`, { entityId: doel })
      return NextResponse.json({ ok: true, herstelcodes: r.herstelcodes }, { headers: { 'Cache-Control': 'no-store' } })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
