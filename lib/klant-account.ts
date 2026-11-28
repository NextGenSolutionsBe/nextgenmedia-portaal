// Klantaccount: de welkomstmail en de activatielink — pure regels (client-safe,
// getest in tests/klant-account.test.ts).
//
// De klant krijgt nooit een wachtwoord per mail. Hij krijgt een persoonlijke
// link (7 dagen geldig, werkt tot hij een wachtwoord koos). Daar kiest hij zelf
// zijn wachtwoord en kan hij meteen tweestapsverificatie instellen met een
// authenticator-app (QR-code).

export const ACTIVATIE_DAGEN = 7
export const MIN_WACHTWOORD = 10

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function geldigEmail(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  return EMAIL.test(s) ? s : null
}

/** Is de token-vorm plausibel (43 tekens base64url = 32 bytes)? */
export function tokenVorm(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return /^[A-Za-z0-9_-]{40,64}$/.test(s) ? s : null
}

/** Wachtwoordregels voor klanten: minstens 10 tekens, niet enkel cijfers, niet het e-mailadres. */
export function controleerNieuwWachtwoord(w: string, email?: string | null): string | null {
  if (w.length < MIN_WACHTWOORD) return `Kies een wachtwoord van minstens ${MIN_WACHTWOORD} tekens.`
  if (/^\d+$/.test(w)) return 'Gebruik niet enkel cijfers.'
  if (email && w.toLowerCase() === email.toLowerCase()) return 'Kies iets anders dan je e-mailadres.'
  return null
}

export type ActivatieStatus = 'geldig' | 'verlopen' | 'gebruikt' | 'onbekend'

export function activatieStatus(rij: { verloopt_op: string; gebruikt_op: string | null } | null, nu: Date = new Date()): ActivatieStatus {
  if (!rij) return 'onbekend'
  if (rij.gebruikt_op) return 'gebruikt'
  if (Date.parse(rij.verloopt_op) <= nu.getTime()) return 'verlopen'
  return 'geldig'
}

/** De standaardtekst van de welkomstmail (aanpasbaar in de MailComposer). */
export function welkomstMail(p: { klant: string; contact: string | null; email: string }): { onderwerp: string; tekst: string; knop: string } {
  const voornaam = (p.contact ?? '').trim().split(/\s+/)[0] || ''
  return {
    onderwerp: `Je account voor de klantapp van NextGenMedia`,
    tekst: [
      `Dag${voornaam ? ` ${voornaam}` : ''},`,
      '',
      `Je account voor de klantapp van NextGenMedia staat klaar. Daar vind je alles voor ${p.klant}: contracten, offertes, je contentkalender, opleveringen en bestanden.`,
      '',
      `Je logt in met ${p.email}. Via de knop hieronder kies je zelf je wachtwoord. Meteen daarna kan je tweestapsverificatie aanzetten: je scant een QR-code met Google Authenticator of een andere authenticator-app. Dat raden we aan, maar het mag ook later.`,
      '',
      `De link is ${ACTIVATIE_DAGEN} dagen geldig en werkt tot je een wachtwoord koos. Verlopen? Laat het ons weten en we sturen een nieuwe.`,
      '',
      'Met vriendelijke groet,',
      'NextGenMedia',
    ].join('\n'),
    knop: 'Wachtwoord kiezen',
  }
}
