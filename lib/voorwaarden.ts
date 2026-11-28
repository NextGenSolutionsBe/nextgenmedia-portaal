// Algemene voorwaarden en privacyverklaring bij het ondertekenen van een
// contract. Puur (client- en serverveilig), zodat de tekenpagina, de server en
// het certificaat dezelfde teksten gebruiken.
//
// De klant vinkt beide aan bij elke ondertekening. De algemene voorwaarden
// gelden voor dat contract en voor elke toekomstige samenwerking. De server
// weigert te tekenen zonder beide vinkjes en bewaart wat er aanvaard werd
// (tekst, link, versie, tijdstip) bij de handtekening.

export const VOORWAARDEN_URL = 'https://nextgenmedia.be/algemene-voorwaarden'
/** De privacyverklaring staat als PDF op de app zelf (public/documenten). */
export const PRIVACY_PAD = '/documenten/privacyverklaring-nextgenmedia.pdf'
/** Datum waarop deze versie van de privacyverklaring in de app kwam. Pas aan als de PDF vervangen wordt. */
export const PRIVACY_VERSIE = '2026-11-02'

export const AKKOORD_VOORWAARDEN_TEKST = 'Ik ga akkoord met de algemene voorwaarden van NextGenMedia. Ze gelden voor dit contract en voor elke toekomstige samenwerking met NextGenMedia.'
export const AKKOORD_PRIVACY_TEKST = 'Ik ga akkoord met de privacyverklaring van NextGenMedia.'

export type AkkoordDetails = {
  voorwaarden: { tekst: string; url: string; op: string }
  privacy: { tekst: string; url: string; versie: string; op: string }
}

/** Beide vinkjes aan? Anders een duidelijke fout; er wordt dan niets getekend. */
export function controleerAkkoord(b: { akkoord_voorwaarden?: unknown; akkoord_privacy?: unknown }): { ok: true } | { ok: false; fout: string } {
  const v = b.akkoord_voorwaarden === true, p = b.akkoord_privacy === true
  if (v && p) return { ok: true }
  if (!v && !p) return { ok: false, fout: 'Vink aan dat je akkoord gaat met de algemene voorwaarden en de privacyverklaring.' }
  return { ok: false, fout: v ? 'Vink aan dat je akkoord gaat met de privacyverklaring.' : 'Vink aan dat je akkoord gaat met de algemene voorwaarden.' }
}

/** Wat we bij de handtekening bewaren als bewijs van het akkoord. */
export function akkoordDetails(op: string, basisUrl: string): AkkoordDetails {
  return {
    voorwaarden: { tekst: AKKOORD_VOORWAARDEN_TEKST, url: VOORWAARDEN_URL, op },
    privacy: { tekst: AKKOORD_PRIVACY_TEKST, url: `${basisUrl.replace(/\/$/, '')}${PRIVACY_PAD}`, versie: PRIVACY_VERSIE, op },
  }
}

const versieLabel = (v: string) => new Date(`${v}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })

/** Regels voor het certificaat en de ontvangstpagina. Leeg als er (bij oudere contracten) geen akkoord bewaard is. */
export function akkoordRegels(a: { voorwaardenOp?: string | null; privacyOp?: string | null; privacyVersie?: string | null }): [string, string][] {
  const r: [string, string][] = []
  if (a.voorwaardenOp) r.push(['Algemene voorwaarden', 'Aanvaard, ook voor toekomstige opdrachten (nextgenmedia.be/algemene-voorwaarden)'])
  if (a.privacyOp) r.push(['Privacyverklaring', `Aanvaard${a.privacyVersie ? ` (versie van ${versieLabel(a.privacyVersie)})` : ''}`])
  return r
}
