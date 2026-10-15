import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { safeMessage } from '@/lib/api-error'
import { sendEmail, baseUrl } from '@/lib/email'
import { eisPersoneel, audit } from '@/lib/personeel/server'
import { isUuid, tekst } from '@/lib/personeel/invoer'
import { internAccount } from '@/lib/personeel/koppeling'

export const dynamic = 'force-dynamic'

const BAN_DUUR = '876000h'

/**
 * POST { actie } — het werknemersaccount beheren vanuit het dossier.
 *  · aanmaken     unieke login op het e-mailadres van het dossier (nog geen mail)
 *  · uitnodigen   mail met een eenmalige link om zelf een wachtwoord te kiezen
 *  · reset        mail met een link om het wachtwoord opnieuw in te stellen
 *  · blokkeren    login onmiddellijk onbruikbaar (dossier blijft)
 *  · deblokkeren  login weer bruikbaar
 * Mails vertrekken enkel via deze knoppen, nooit vanzelf. Enkel voor wie de
 * instellingen van Personeel mag beheren.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('instellingen'); if (!g.ok) return g.response
    const { admin, persoon } = g
    const b = (await req.json().catch(() => ({}))) as { actie?: string; email?: string }
    const { data: p } = await admin.from('personeel').select('*').eq('id', id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Medewerker niet gevonden' }, { status: 404 })
    const log = (actie: string, nieuw?: unknown) => audit(admin, { personeel_id: id, entiteit: 'account', entiteit_id: id, actie, nieuw: nieuw ?? null, actor_email: persoon.email, actor_id: persoon.userId })

    if (b.actie === 'koppelen') {
      if (p.auth_user_id) return NextResponse.json({ error: 'Er is al een login gekoppeld.' }, { status: 409 })
      const { kandidaat } = await internAccount(admin, { auth_user_id: null, email: (tekst(b.email, 200) ?? p.email ?? '').toLowerCase() || null })
      if (!kandidaat?.auth_user_id) return NextResponse.json({ error: 'Geen bestaande werknemerslogin gevonden met dit e-mailadres.' }, { status: 404 })
      const { data: bezet } = await admin.from('personeel').select('id').eq('auth_user_id', kandidaat.auth_user_id).maybeSingle()
      if (bezet) return NextResponse.json({ error: 'Deze login hoort al bij een ander personeelsdossier.' }, { status: 409 })
      await admin.from('personeel').update({ auth_user_id: kandidaat.auth_user_id, email: kandidaat.email, account_status: 'actief', updated_at: new Date().toISOString() }).eq('id', id)
      await log('login_gekoppeld', { werknemer: kandidaat.email })
      return NextResponse.json({ ok: true })
    }

    if (b.actie === 'aanmaken') {
      if (p.auth_user_id) return NextResponse.json({ error: 'Deze medewerker heeft al een login.' }, { status: 409 })
      if (p.actief === false) return NextResponse.json({ error: 'Maak de medewerker eerst actief.' }, { status: 400 })
      const email = (tekst(b.email, 200) ?? p.email ?? '').toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return NextResponse.json({ error: 'Vul eerst een geldig e-mailadres in.' }, { status: 400 })
      // Een login die al voor iets anders dient (admin, interne medewerker, klant) koppelen we niet.
      const [{ data: staff }, { data: ander }] = await Promise.all([
        admin.from('staff_members').select('id').ilike('email', email).maybeSingle(),
        admin.from('personeel').select('id').ilike('email', email).neq('id', id).maybeSingle(),
      ])
      if (staff) return NextResponse.json({ error: 'Dit e-mailadres is al een interne login (Werknemers). Gebruik een ander adres.' }, { status: 409 })
      if (ander) return NextResponse.json({ error: 'Dit e-mailadres hoort al bij een ander personeelsdossier.' }, { status: 409 })
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password: randomBytes(24).toString('base64url'), email_confirm: true,
        user_metadata: { full_name: [p.voornaam, p.achternaam].filter(Boolean).join(' '), personeel_id: id },
      })
      if (error || !created.user) return NextResponse.json({ error: /already|exists|registered/i.test(error?.message ?? '') ? 'Dit e-mailadres is al in gebruik als login.' : `Login aanmaken mislukt: ${error?.message ?? 'onbekend'}` }, { status: 400 })
      const { error: upd } = await admin.from('personeel').update({ auth_user_id: created.user.id, email, account_status: 'uitgenodigd', updated_at: new Date().toISOString() }).eq('id', id)
      if (upd) { await admin.auth.admin.deleteUser(created.user.id).catch(() => {}); throw new Error(upd.message) }
      await log('login_aangemaakt', { email })
      return NextResponse.json({ ok: true })
    }

    if (b.actie === 'uitnodigen' || b.actie === 'reset') {
      if (!p.auth_user_id || !p.email) return NextResponse.json({ error: 'Maak eerst een login aan.' }, { status: 400 })
      if (p.account_status === 'geblokkeerd' || p.actief === false) return NextResponse.json({ error: 'Deblokkeer of activeer de medewerker eerst.' }, { status: 400 })
      const { data: link, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: p.email })
      const hash = link?.properties?.hashed_token
      if (error || !hash) return NextResponse.json({ error: `Link aanmaken mislukt: ${error?.message ?? 'onbekend'}` }, { status: 400 })
      const url = `${baseUrl()}/login/wachtwoord?token_hash=${encodeURIComponent(hash)}&type=recovery`
      const nieuw = b.actie === 'uitnodigen'
      const aanhef = `Dag ${p.voornaam},`
      const uitleg = nieuw
        ? 'Je hebt een persoonlijke login gekregen voor de NextGenMedia-werkomgeving. Daar klok je in en uit, geef je je beschikbaarheid door en zie je je planning en briefings. Kies via de knop hieronder een wachtwoord.'
        : 'Via de knop hieronder kies je een nieuw wachtwoord voor de NextGenMedia-werkomgeving.'
      const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#111"><p>${aanhef}</p><p>${uitleg}</p>
        <p style="margin:24px 0"><a href="${url}" style="background:#fff848;color:#111;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;display:inline-block">Wachtwoord kiezen</a></p>
        <p style="font-size:13px;color:#555">Werkt de knop niet? Kopieer deze link:<br><span style="word-break:break-all">${url}</span></p>
        <p style="font-size:13px;color:#555">De link is ongeveer een uur geldig en werkt één keer. Daarna log je in op ${baseUrl()}/login met ${p.email}.</p><p>Groeten<br>NextGenMedia</p></div>`
      const r = await sendEmail({ to: p.email, subject: nieuw ? 'Je login voor de NextGenMedia-werkomgeving' : 'Nieuw wachtwoord instellen', text: `${aanhef}\n\n${uitleg}\n\n${url}\n\nDe link is ongeveer een uur geldig en werkt één keer.\n\nGroeten\nNextGenMedia`, html })
      if (!r.ok) return NextResponse.json({ error: `Mail versturen mislukt: ${r.error ?? 'onbekend'}` }, { status: 502 })
      await admin.from('personeel').update({ uitnodiging_verzonden_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
      await log(nieuw ? 'uitnodiging_verstuurd' : 'wachtwoordreset_verstuurd', { email: p.email })
      return NextResponse.json({ ok: true })
    }

    if (b.actie === 'blokkeren' || b.actie === 'deblokkeren') {
      if (!p.auth_user_id) return NextResponse.json({ error: 'Er is nog geen login.' }, { status: 400 })
      const { gekoppeld } = await internAccount(admin, { auth_user_id: p.auth_user_id, email: null })
      if (gekoppeld) return NextResponse.json({ error: 'Dit is ook een interne werknemerslogin. Zet die (in)actief via Personeel → Accounts en rechten.' }, { status: 409 })
      const blok = b.actie === 'blokkeren'
      const { error } = await admin.auth.admin.updateUserById(p.auth_user_id, { ban_duration: blok ? BAN_DUUR : 'none' })
      if (error) throw new Error(error.message)
      await admin.from('personeel').update({ account_status: blok ? 'geblokkeerd' : 'actief', updated_at: new Date().toISOString() }).eq('id', id)
      await log(blok ? 'login_geblokkeerd' : 'login_gedeblokkeerd')
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
