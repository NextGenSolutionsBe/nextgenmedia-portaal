/**
 * Wie krijgt de mail "nieuwe oplevering"? Pure regels (getest in
 * tests/opleveringen-ontvangers.test.ts).
 *
 * Elke gebruiker met een account bij de klant (hoofdaccount en subaccounts)
 * kan gekozen worden, plus het algemene e-mailadres van de klant. Wie
 * Opleveringen niet mag zien in de klantapp (of gedeactiveerd is), staat in
 * de lijst maar kan niet gekozen worden: de knop in de mail opent de klantapp.
 */
import { can, fullPermissions, metStandaard, type Permissions } from '@/lib/portal-permissions'

export type OntvangerSoort = 'eigenaar' | 'gebruiker' | 'klantadres'
export type Ontvanger = {
  email: string
  naam: string | null
  soort: OntvangerSoort
  /** Kan de mail krijgen (heeft toegang tot Opleveringen in de klantapp). */
  kan: boolean
  /** Waarom niet, als `kan` false is. */
  reden: string | null
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
export const isEmail = (v: unknown): v is string => typeof v === 'string' && EMAIL.test(v.trim())

/** Zoals de klantapp: lege rechten = alles, anders de rechten met de standaard-aan-modules erbij. */
function rechtenVan(p: unknown): Permissions {
  return p && typeof p === 'object' && Object.keys(p as object).length > 0 ? metStandaard(p as Permissions) : fullPermissions()
}

export function ontvangersVan(inv: {
  klantEmail?: string | null
  eigenaar?: { email: string | null; naam: string | null } | null
  gebruikers?: { email: string | null; name: string | null; active: boolean | null; permissions: unknown }[]
}): Ontvanger[] {
  const uit: Ontvanger[] = []
  const voeg = (o: Ontvanger) => {
    const k = o.email.trim().toLowerCase()
    const al = uit.find((x) => x.email.toLowerCase() === k)
    // Hetzelfde adres twee keer: één regel, met de naam en de toegang van het account.
    if (al) {
      if (!al.naam && o.naam) al.naam = o.naam
      if (al.soort === 'klantadres' && o.soort !== 'klantadres') { al.soort = o.soort; al.kan = o.kan; al.reden = o.reden }
      return
    }
    uit.push({ ...o, email: o.email.trim() })
  }
  if (inv.eigenaar && isEmail(inv.eigenaar.email)) voeg({ email: inv.eigenaar.email, naam: inv.eigenaar.naam, soort: 'eigenaar', kan: true, reden: null })
  for (const g of inv.gebruikers ?? []) {
    if (!isEmail(g.email)) continue
    const actief = g.active !== false
    const toegang = can(rechtenVan(g.permissions), 'opleveringen', 'view')
    voeg({
      email: g.email, naam: g.name?.trim() || null, soort: 'gebruiker', kan: actief && toegang,
      reden: !actief ? 'Account gedeactiveerd' : !toegang ? 'Geen toegang tot Opleveringen' : null,
    })
  }
  if (isEmail(inv.klantEmail)) voeg({ email: inv.klantEmail, naam: null, soort: 'klantadres', kan: true, reden: null })
  return uit
}

/** "Alle gebruikers": iedereen met een account die de oplevering kan bekijken. */
export const alleGebruikers = (lijst: Ontvanger[]): string[] => lijst.filter((o) => o.kan && o.soort !== 'klantadres').map((o) => o.email)

/** Zonder keuze: het algemene adres van de klant (zoals vroeger), anders het hoofdaccount, anders niemand. */
export function standaardKeuze(lijst: Ontvanger[]): string[] {
  const klant = lijst.find((o) => o.soort === 'klantadres' && o.kan) ?? lijst.find((o) => o.soort === 'eigenaar' && o.kan)
  return klant ? [klant.email] : []
}

/** Extra adressen uit een vrij veld (komma, puntkomma of nieuwe regel); ongeldige vallen weg. */
export function extraAdressen(tekst: string): { geldig: string[]; ongeldig: string[] } {
  const delen = tekst.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)
  return { geldig: delen.filter((x) => isEmail(x)), ongeldig: delen.filter((x) => !isEmail(x)) }
}

/** Voornaam voor de aanhef: het eerste woord van de naam. */
export const voornaamVan = (naam: string | null | undefined): string | null => naam?.trim().split(/\s+/)[0] || null

/** De aanhef per ontvanger: [voornaam] wordt de gegeven naam, of valt weg ("Beste,"). */
export function metAanhef(tekst: string, aanhef: string | null | undefined): string {
  const v = aanhef?.trim()
  return v ? tekst.replace(/\[voornaam\]/gi, v) : tekst.replace(/[ \t]*\[voornaam\]/gi, '')
}

/** Wie staat er na "Beste": de voornaam van een account, de klantnaam bij het algemene adres, anders niets. */
export const aanhefVoor = (o: { soort: OntvangerSoort | 'extra'; naam: string | null }, klantNaam: string | null | undefined): string | null =>
  o.soort === 'klantadres' ? (klantNaam?.trim() || null) : o.soort === 'extra' ? null : voornaamVan(o.naam)

/** Kleine, vaste hash van een e-mailadres: maakt per ontvanger een eigen verzendsleutel. */
export function adresSleutel(basis: string, email: string): string {
  let h = 2166136261
  for (const c of email.trim().toLowerCase()) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return `${basis.slice(0, 50)}-${h.toString(36)}`
}
