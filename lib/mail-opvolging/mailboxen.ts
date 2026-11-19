import 'server-only'

/**
 * De mailboxen die de app leest, uit de omgevingsvariabelen (nooit in code of
 * in de databank). Eén mailbox:
 *   IMAP_HOST=mail.level27.eu  IMAP_USER=info@nextgenmedia.be  IMAP_PASSWORD=…
 * Meer mailboxen: IMAP_USER_2 / IMAP_PASSWORD_2 (en IMAP_HOST_2 als die
 * ergens anders staat), tot _5. IMAP_PORT is standaard 993 (SSL).
 */
export type Mailbox = { gebruiker: string; host: string; poort: number; wachtwoord: string }

export function mailboxen(): Mailbox[] {
  const uit: Mailbox[] = []
  const hostBasis = (process.env.IMAP_HOST ?? '').trim()
  const poortBasis = Number(process.env.IMAP_PORT ?? 993) || 993
  for (const s of ['', '_2', '_3', '_4', '_5']) {
    const gebruiker = (process.env[`IMAP_USER${s}`] ?? '').trim()
    const wachtwoord = process.env[`IMAP_PASSWORD${s}`] ?? ''
    const host = (process.env[`IMAP_HOST${s}`] ?? '').trim() || hostBasis
    const poort = Number(process.env[`IMAP_PORT${s}`] ?? poortBasis) || poortBasis
    if (gebruiker && wachtwoord && host) uit.push({ gebruiker: gebruiker.toLowerCase(), host, poort, wachtwoord })
  }
  return uit
}

/** Foutmelding zonder geheimen (een IMAP-server kan de gebruikersnaam terugsturen; het wachtwoord nooit tonen). */
export function veiligeFout(e: unknown, m?: Mailbox): string {
  let t = e instanceof Error ? e.message : String(e)
  const extra = (e as { responseText?: string; authenticationFailed?: boolean } | null)
  if (extra?.authenticationFailed) t = 'Aanmelden geweigerd: kijk de gebruikersnaam en het wachtwoord na.'
  else if (extra?.responseText) t = `${t}: ${extra.responseText}`
  if (m?.wachtwoord) t = t.split(m.wachtwoord).join('•••')
  return t.slice(0, 300)
}

/** De Inbox en de map Verzonden van een mailbox (namen verschillen per server). */
export function mapPaden(lijst: { path: string; specialUse?: string }[]): { inbox: string; verzonden: string | null } {
  const inbox = lijst.find((m) => m.specialUse === '\\Inbox')?.path ?? lijst.find((m) => m.path.toUpperCase() === 'INBOX')?.path ?? 'INBOX'
  const verzonden = lijst.find((m) => m.specialUse === '\\Sent')?.path
    ?? lijst.find((m) => /^(inbox[./])?(sent|sent items|sent messages|verzonden|verzonden items|verzonden berichten)$/i.test(m.path))?.path ?? null
  return { inbox, verzonden }
}
