// Ontdubbelen en zoeken (§4, §11). Pure module.

/**
 * Sleutel waarop we bedrijven ontdubbelen: de website-host als die er is,
 * anders de genormaliseerde naam. Zo herkennen we "Acme BV" en "acme bvba" met
 * dezelfde site als één bedrijf — nooit twee leads voor hetzelfde bedrijf bij
 * dezelfde klant.
 */
export function companyDedupeKey(name: string, website?: string | null): string {
  const host = websiteHost(website)
  if (host) return `web:${host}`
  return `name:${normalizeName(name)}`
}

/** Host uit een URL, zonder www en zonder pad. Lege/onzinnige input → null. */
export function websiteHost(website?: string | null): string | null {
  const raw = (website ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return host.includes('.') ? host : null
  } catch {
    return null
  }
}

// Rechtsvormen die niets zeggen over wélk bedrijf het is.
const LEGAL_FORMS = new Set([
  'bv', 'bvba', 'nv', 'vzw', 'commv', 'cv', 'cvba', 'sa', 'sprl', 'srl',
  'gcv', 'vof', 'ltd', 'limited', 'llc', 'inc', 'gmbh', 'ag', 'plc', 'bvi',
])

/** Bedrijfsnaam normaliseren: rechtsvormen, leestekens en spaties eruit. */
export function normalizeName(name: string): string {
  const base = (name ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accenten weg
    .replace(/\./g, '')                                  // "n.v." → "nv"

  const tokens = base.split(/[^a-z0-9]+/).filter(Boolean)
  const kept = tokens.filter((tk) => !LEGAL_FORMS.has(tk))
  // Bestaat de naam alleen uit een rechtsvorm, houd hem dan zoals hij is —
  // anders zouden twee zulke bedrijven dezelfde (lege) sleutel krijgen.
  return (kept.length ? kept : tokens).join('')
}

/**
 * Telefoonnummer tot enkel cijfers, met de Belgische landcode eraf zodat
 * "+32 470 12 34 56", "0470/12.34.56" en "470123456" allemaal hetzelfde
 * opleveren en dus op elkaar matchen (§4).
 */
export function normalizePhone(phone?: string | null): string {
  let d = (phone ?? '').replace(/\D+/g, '')
  if (!d) return ''
  if (d.startsWith('0032')) d = d.slice(4)
  else if (d.startsWith('32') && d.length > 9) d = d.slice(2)
  if (d.startsWith('0')) d = d.slice(1)
  return d
}

/** Matcht een zoekterm op een telefoonnummer, ongeacht schrijfwijze? */
export function phoneMatches(stored: string | null | undefined, query: string): boolean {
  const q = normalizePhone(query)
  if (!q) return false
  const s = normalizePhone(stored)
  return !!s && s.includes(q)
}

/** Ziet de zoekterm eruit als een telefoonnummer (i.p.v. een naam)? */
export function looksLikePhone(query: string): boolean {
  const digits = query.replace(/\D+/g, '')
  return digits.length >= 3 && digits.length / Math.max(1, query.trim().length) > 0.5
}

// ── Is dit bedrijf al KLANT? ─────────────────────────────────────────────────
//
// Naast de ontdubbeling hierboven, die kijkt of hetzelfde bedrijf al als lead
// in de pipeline staat. Deze controle kijkt of we het al als klant hebben — een
// ander soort fout. Een dubbele lead is rommelig; een bestaande klant koud
// opbellen met een verkooppraatje is gênant, en met gekochte lijsten gebeurt
// dat vanzelf als je er niets tegen doet.
//
// Het vullen van de index gebeurt in lib/sales/klanten.ts (die praat met de
// database); het herkennen staat hier, bij de rest van het ontdubbelwerk, en
// blijft daardoor puur en los testbaar.

export type KlantIndex = {
  /** Ontdubbelsleutels: 'web:<host>' of 'name:<genormaliseerd>'. */
  sleutels: Set<string>
  /** Enkel de genormaliseerde namen, voor bedrijven zonder website. */
  namen: Set<string>
}

/** Te korte namen blijven buiten de naam-index: "AB" of "3M" zou anders
 *  toevallig matchen op een heel ander bedrijf. */
const MIN_KLANTNAAM = 4

export const nieuweKlantIndex = (): KlantIndex => ({ sleutels: new Set(), namen: new Set() })

export const LEGE_KLANTINDEX: KlantIndex = nieuweKlantIndex()

/** Lidwoorden waarmee een handelsnaam kan beginnen. Dezelfde zaak heet in de
 *  ene lijst "De Goei Goesting" en in de andere "Goei Goesting". */
const LIDWOORDEN = ['de', 'het', 't', 'la', 'le', 'les', 'the']

/**
 * Eén klant aan de index toevoegen.
 *
 * Naast de naam zelf zetten we ook de variant ZONDER lidwoord in de index, en
 * omgekeerd niet: zo herkennen we de klant onder beide schrijfwijzen zonder
 * dat we aan normalizeName komen. Dat laatste zou de ontdubbeling van alle
 * leads raken en bedrijven kunnen samenvoegen die niets met elkaar te maken
 * hebben — dit blijft netjes beperkt tot de klantherkenning.
 */
export function voegKlantToe(index: KlantIndex, naam: string | null | undefined, website?: string | null): void {
  const n = (naam ?? '').trim()
  if (!n) return
  index.sleutels.add(companyDedupeKey(n, website ?? null))
  for (const variant of naamVarianten(n)) {
    if (variant.length >= MIN_KLANTNAAM) index.namen.add(variant)
  }
}

/** De genormaliseerde naam, plus die zonder leidend lidwoord. */
function naamVarianten(naam: string): string[] {
  const uit = [normalizeName(naam)]
  const woorden = naam.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (woorden.length > 1 && LIDWOORDEN.includes(woorden[0])) {
    uit.push(normalizeName(woorden.slice(1).join(' ')))
  }
  return uit
}

/**
 * Is dit bedrijf al klant?
 *
 * Twee wegen: dezelfde ontdubbelsleutel (website-host, anders de naam), of
 * exact dezelfde genormaliseerde naam. Dat laatste is nodig omdat een klant in
 * een gekochte lijst met een ander webadres kan staan — of zonder.
 *
 * Bewust GEEN deelmatch: "Dilien Metaalwerken" is niet "Metaalwerken Bartels",
 * en "GUY VERHEYEN" is niet "Verheyen NV". Liever een klant die je per ongeluk
 * belt dan honderden prospecten die je nooit belt omdat ze op een klant lijken.
 */
export function isBekendeKlant(index: KlantIndex, naam: string, website?: string | null): boolean {
  const n = (naam ?? '').trim()
  if (!n) return false
  if (index.sleutels.has(companyDedupeKey(n, website ?? null))) return true
  // Ook hier beide varianten proberen: staat de klant als "Goei Goesting" in
  // de index en komt er "De Goei Goesting" binnen, dan hoort dat te matchen.
  return naamVarianten(n).some((v) => v.length >= MIN_KLANTNAAM && index.namen.has(v))
}
