import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireStaff, createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesProfiel, controleerWachtwoord, geldigEmail, wachtwoordFout } from '@/lib/account-server'

export const dynamic = 'force-dynamic'

/** Mijn account: eigen naam, e-mail en wachtwoord. Enkel voor de ingelogde gebruiker zelf. */
export async function GET() {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  return NextResponse.json({ profiel: await leesProfiel(user) })
}

export async function PATCH(req: NextRequest) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!b) return NextResponse.json({ error: 'Ongeldige gegevens.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const actie = String(b.actie ?? '')
    const { data: staff } = await admin.from('staff_members').select('id').eq('auth_user_id', user.id).maybeSingle()

    if (actie === 'naam') {
      const voornaam = String(b.voornaam ?? '').trim().slice(0, 80)
      const achternaam = String(b.achternaam ?? '').trim().slice(0, 120)
      if (!voornaam) return NextResponse.json({ error: 'Vul je voornaam in.' }, { status: 400 })
      const naam = `${voornaam} ${achternaam}`.trim()
      const { error } = await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...(user.user_metadata ?? {}), name: naam, full_name: naam, voornaam, achternaam } })
      if (error) throw new Error(error.message)
      if (staff) await admin.from('staff_members').update({ name: naam, voornaam, achternaam, updated_at: new Date().toISOString() }).eq('id', (staff as { id: string }).id)
      await logAudit({ actorUserId: user.id, actorEmail: user.email ?? null, action: 'account.naam', entityType: 'account', entityId: user.id, summary: `Naam gewijzigd naar ${naam}`, ...requestMeta(req) })
      try { revalidatePath('/admin', 'layout') } catch { /* */ }
      return NextResponse.json({ ok: true, profiel: await leesProfiel((await admin.auth.admin.getUserById(user.id)).data.user ?? user) })
    }

    if (actie === 'email' || actie === 'wachtwoord') {
      const huidig = String(b.huidigWachtwoord ?? '')
      if (!huidig) return NextResponse.json({ error: 'Vul je huidige wachtwoord in.' }, { status: 400 })
      if (!(await controleerWachtwoord(user.email ?? '', huidig))) return NextResponse.json({ error: 'Je huidige wachtwoord klopt niet.' }, { status: 400 })

      if (actie === 'email') {
        const nieuw = String(b.email ?? '').trim().toLowerCase()
        if (!geldigEmail(nieuw)) return NextResponse.json({ error: 'Dat is geen geldig e-mailadres.' }, { status: 400 })
        if (nieuw === (user.email ?? '').toLowerCase()) return NextResponse.json({ error: 'Dat is al je e-mailadres.' }, { status: 400 })
        const { data: bezet } = await admin.from('staff_members').select('id, auth_user_id').eq('email', nieuw).maybeSingle()
        if (bezet && (bezet as { auth_user_id: string | null }).auth_user_id !== user.id) return NextResponse.json({ error: 'Dat adres is al van een andere werknemer.' }, { status: 409 })
        const { error } = await admin.auth.admin.updateUserById(user.id, { email: nieuw, email_confirm: true })
        if (error) return NextResponse.json({ error: /already|exists|registered/i.test(error.message) ? 'Dat adres is al in gebruik als login.' : error.message }, { status: 400 })
        if (staff) await admin.from('staff_members').update({ email: nieuw, updated_at: new Date().toISOString() }).eq('id', (staff as { id: string }).id)
        await logAudit({ actorUserId: user.id, actorEmail: user.email ?? null, action: 'account.email', entityType: 'account', entityId: user.id, summary: `E-mailadres gewijzigd naar ${nieuw}`, ...requestMeta(req) })
        try { revalidatePath('/admin', 'layout') } catch { /* */ }
        return NextResponse.json({ ok: true, email: nieuw })
      }

      const nieuw = String(b.nieuwWachtwoord ?? '')
      const fout = wachtwoordFout(nieuw)
      if (fout) return NextResponse.json({ error: fout }, { status: 400 })
      if (nieuw === huidig) return NextResponse.json({ error: 'Kies een ander wachtwoord dan je huidige.' }, { status: 400 })
      const { error } = await admin.auth.admin.updateUserById(user.id, { password: nieuw })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      await logAudit({ actorUserId: user.id, actorEmail: user.email ?? null, action: 'account.wachtwoord', entityType: 'account', entityId: user.id, summary: 'Wachtwoord gewijzigd', ...requestMeta(req) })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Opslaan mislukt') }, { status: 500 })
  }
}
