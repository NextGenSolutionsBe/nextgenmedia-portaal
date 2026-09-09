import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, isActiveStaff } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { generateCode, hashCode, CODE_TTL_MS, RESEND_COOLDOWN_MS, twoFactorRequired } from '@/lib/two-factor'
import { requestMeta } from '@/lib/audit'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Heeft dit account tweestapsverificatie nodig?
 * Enkel interne accounts (admin + actieve werknemer), en enkel als het niet
 * uitdrukkelijk uitgezet is voor dat account (login_settings).
 */
async function needsTwoFactor(userId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
  const internal = data?.role === 'admin' ? true : await isActiveStaff(userId)
  if (!internal) return false
  return await twoFactorRequired(admin, userId)
}

// POST — stuur een nieuwe inlogcode naar het e-mailadres van de ingelogde
// interne gebruiker. Vereist een geldige wachtwoord-sessie (stap 1).
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    if (!(await needsTwoFactor(user.id))) {
      return NextResponse.json({ error: 'Niet van toepassing' }, { status: 403 })
    }
    if (!user.email) return NextResponse.json({ error: 'Geen e-mailadres bekend' }, { status: 400 })

    // Rem per IP: voorkomt dat iemand met een gestolen wachtwoord (of een script)
    // eindeloos codes laat versturen — zowel mailbom als brute-force-aanloop.
    const ip = clientIp(req)
    const rl = await rateLimit(`2fa-send:${ip}`, { limit: 10, windowSec: 15 * 60 })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      )
    }

    const admin = createAdminSupabaseClient()

    // Te snel opnieuw? Niet spammen — en zo blijft de mailbox bruikbaar.
    const { data: last } = await admin
      .from('login_codes').select('created_at')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (last?.created_at) {
      const elapsed = Date.now() - new Date(last.created_at).getTime()
      if (elapsed < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)
        return NextResponse.json({ error: `Wacht nog ${wait} seconden voor een nieuwe code.` }, { status: 429 })
      }
    }

    // Oude, nog openstaande codes ongeldig maken: er is er altijd maar één geldig.
    await admin.from('login_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('user_id', user.id).is('consumed_at', null)

    const code = generateCode()
    const meta = requestMeta(req)
    const { error: insErr } = await admin.from('login_codes').insert({
      user_id: user.id,
      code_hash: await hashCode(code),          // enkel de hash, nooit de code zelf
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      ip: meta.ip ?? null,
    })
    if (insErr) throw new Error(insErr.message)

    const minutes = Math.round(CODE_TTL_MS / 60000)
    const bodyText = [
      `Je inlogcode is: ${code}`,
      '',
      `Deze code is ${minutes} minuten geldig en kan één keer gebruikt worden.`,
      'Heb je zelf niet geprobeerd in te loggen? Wijzig dan meteen je wachtwoord en laat het ons weten.',
    ].join('\n')

    const res = await sendEmail({
      to: user.email,
      subject: `Inlogcode ${code} — NextGenMedia`,
      text: buildEmailText({ bodyText }),
      html: buildEmailHtml({ bodyText }),
    })
    if (!res.ok) {
      // Fout van de mailprovider letterlijk doorgeven — dit is precies waar een
      // niet-geverifieerd afzenderdomein of een geblokkeerd adres zichtbaar wordt.
      return NextResponse.json({ error: `De code kon niet verstuurd worden: ${res.error ?? 'onbekende fout bij de mailprovider'}` }, { status: 502 })
    }

    // Het e-mailadres gemaskeerd terugsturen, zodat de gebruiker ziet waar de
    // code heen ging zonder het volledige adres te tonen.
    const [name, domain] = user.email.split('@')
    const masked = `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`
    return NextResponse.json({ ok: true, sentTo: masked })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
