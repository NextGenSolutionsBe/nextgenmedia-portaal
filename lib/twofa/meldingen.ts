import 'server-only'
import { sendEmail, baseUrl } from '@/lib/email'

/**
 * Beveiligingsmeldingen naar de eigen gebruiker bij een wijziging aan zijn
 * tweestapsverificatie. Bewust zonder enig geheim: geen codes, geen QR, geen
 * herstelcodes — enkel WAT er gebeurde, WANNEER, en wat te doen als je het niet
 * zelf was. Mislukt verzenden, dan breekt de actie niet.
 */
export type MeldingSoort = 'aangezet' | 'uitgezet' | 'herstelcodes' | 'opnieuw' | 'herstelcode_gebruikt' | 'admin_reset'

const ONDERWERP: Record<MeldingSoort, string> = {
  aangezet: 'Tweestapsverificatie ingeschakeld',
  uitgezet: 'Tweestapsverificatie uitgeschakeld',
  herstelcodes: 'Nieuwe herstelcodes aangemaakt',
  opnieuw: 'Authenticator-app opnieuw ingesteld',
  herstelcode_gebruikt: 'Ingelogd met een herstelcode',
  admin_reset: 'Je tweestapsverificatie werd gereset',
}

const UITLEG: Record<MeldingSoort, string> = {
  aangezet: 'Voor je account is tweestapsverificatie met een authenticator-app ingeschakeld. Vanaf nu vragen we bij het inloggen ook een code uit je app.',
  uitgezet: 'Voor je account is tweestapsverificatie uitgeschakeld. Je logt nu weer in met enkel je e-mailadres en wachtwoord.',
  herstelcodes: 'Voor je account zijn nieuwe herstelcodes aangemaakt. Je vorige herstelcodes werken niet meer.',
  opnieuw: 'Je authenticator-app werd opnieuw ingesteld. De vorige app en je vorige herstelcodes werken niet meer.',
  herstelcode_gebruikt: 'Er werd ingelogd op je account met een herstelcode. Die code werkt niet meer.',
  admin_reset: 'NextGenMedia heeft op jouw vraag de tweestapsverificatie van je account gereset. Je logt nu in met je e-mailadres en wachtwoord en kan daarna opnieuw een authenticator-app koppelen via Beveiliging.',
}

export async function stuurBeveiligingsmelding(email: string | null | undefined, soort: MeldingSoort): Promise<void> {
  if (!email) return
  const tijd = new Date().toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', dateStyle: 'long', timeStyle: 'short' })
  const text = [
    'Hallo,',
    '',
    UITLEG[soort],
    '',
    `Tijdstip: ${tijd}`,
    '',
    'Was jij dit niet? Wijzig dan meteen je wachtwoord en neem contact op met NextGenMedia via info@nextgenmedia.be.',
    '',
    `Beheer je beveiliging: ${baseUrl()}/portal/beveiliging`,
    '',
    'NextGenMedia',
  ].join('\n')
  try { await sendEmail({ to: email, subject: `NextGenMedia — ${ONDERWERP[soort]}`, text }) } catch { /* melding is bijzaak */ }
}
