import { validateBtw } from '@/lib/btw'

/**
 * Snel een klant aanmaken, bv. tijdens het opmaken van een contract. Enkel de
 * basis: geen login, geen diensten. Die vul je later aan in de klantfiche
 * (portaaltoegang loopt via uitgenodigde gebruikers). Pure module: geen
 * server-imports, los te testen.
 */

export type SnelleKlant = {
  company_name: string
  contact_name: string | null
  email: string | null
  telefoon: string | null
  btw_nummer: string | null
  adres_straat: string | null
  adres_postcode: string | null
  adres_gemeente: string | null
}

export type BestaandeKlant = { id: string; company_name: string; email?: string | null; btw_nummer?: string | null; archived_at?: string | null }
export type Dubbel = { id: string; company_name: string; reden: 'btw' | 'naam' | 'email'; gearchiveerd: boolean }

const tekst = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  return s || null
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function valideerSnelleKlant(b: Record<string, unknown>): { ok: true; waarde: SnelleKlant } | { ok: false; fout: string } {
  const company_name = tekst(b.company_name, 120)
  if (!company_name || company_name.length < 2) return { ok: false, fout: 'Vul de bedrijfsnaam in.' }
  const email = tekst(b.email, 200)?.toLowerCase() ?? null
  if (email && !EMAIL.test(email)) return { ok: false, fout: 'Dit e-mailadres klopt niet.' }
  const btw = validateBtw(tekst(b.btw_nummer, 20))
  if (!btw.ok) return { ok: false, fout: btw.error ?? 'Ongeldig btw-nummer.' }
  const telefoon = tekst(b.telefoon, 40)
  if (telefoon && !/^[+0-9 ()./-]{6,}$/.test(telefoon)) return { ok: false, fout: 'Dit telefoonnummer klopt niet.' }
  return {
    ok: true,
    waarde: {
      company_name, contact_name: tekst(b.contact_name, 120), email, telefoon, btw_nummer: btw.value || null,
      adres_straat: tekst(b.adres_straat, 200), adres_postcode: tekst(b.adres_postcode, 12), adres_gemeente: tekst(b.adres_gemeente, 120),
    },
  }
}

/** Naam zonder rechtsvorm, leestekens en hoofdletters: "Bakkerij Peeters BV" = "bakkerij peeters". */
export function naamSleutel(naam: string): string {
  return naam.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/[,'’"&()/-]/g, ' ')
    .replace(/\b(bv|bvba|nv|vzw|vof|commv|cv|srl|sa|sprl|asbl|ltd|gmbh)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

/**
 * Bestaat deze klant al? Zelfde btw-nummer weegt het zwaarst, dan dezelfde
 * naam (zonder rechtsvorm), dan hetzelfde e-mailadres. Actieve klanten gaan
 * voor gearchiveerde.
 */
export function zoekDubbel(k: Pick<SnelleKlant, 'company_name' | 'email' | 'btw_nummer'>, lijst: BestaandeKlant[]): Dubbel | null {
  const sleutel = naamSleutel(k.company_name)
  const kandidaten: Dubbel[] = []
  for (const c of lijst) {
    const gearchiveerd = !!c.archived_at
    if (k.btw_nummer && c.btw_nummer && c.btw_nummer.replace(/[^0-9A-Z]/gi, '').toUpperCase() === k.btw_nummer) kandidaten.push({ id: c.id, company_name: c.company_name, reden: 'btw', gearchiveerd })
    else if (sleutel && naamSleutel(c.company_name) === sleutel) kandidaten.push({ id: c.id, company_name: c.company_name, reden: 'naam', gearchiveerd })
    else if (k.email && c.email && c.email.toLowerCase() === k.email) kandidaten.push({ id: c.id, company_name: c.company_name, reden: 'email', gearchiveerd })
  }
  const rang = { btw: 0, naam: 1, email: 2 }
  kandidaten.sort((a, b) => Number(a.gearchiveerd) - Number(b.gearchiveerd) || rang[a.reden] - rang[b.reden])
  return kandidaten[0] ?? null
}

/** Een actieve klant met hetzelfde btw-nummer is dezelfde onderneming: dan nooit een tweede. */
export const magTochNieuw = (d: Dubbel): boolean => d.gearchiveerd || d.reden !== 'btw'

type MetContact = { contact_name?: string | null; email?: string | null }

/**
 * Ondertekenaar invullen met de contactpersoon van de gekozen klant. Wat je zelf
 * typte blijft staan; wat automatisch van de vorige klant kwam, schuift mee.
 */
export function vulOndertekenaar(huidig: { naam: string | null; email: string | null }, vorige: MetContact | null | undefined, nieuw: MetContact | null): { naam: string; email: string } {
  const vervang = (nu: string | null, oud: string | null | undefined, nieuwe: string | null | undefined) => (!nu || (!!oud && nu === oud) ? nieuwe ?? '' : nu)
  return { naam: vervang(huidig.naam, vorige?.contact_name, nieuw?.contact_name), email: vervang(huidig.email, vorige?.email, nieuw?.email) }
}
