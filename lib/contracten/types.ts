/**
 * Contracttypes — pure logica (geen database, geen React).
 *
 * Contracttypes zijn sinds 23 sep 2026 DATA (tabel `contract_types`), geen vaste
 * lijst meer. Deze module bevat alles wat zowel de server (API-routes) als de
 * client (combobox, overzicht) nodig heeft: normaliseren, hoofdletterongevoelig
 * vergelijken, ontdubbelen en hernoemen.
 *
 * Afspraken:
 *  - Een contract heeft ALTIJD een type. Ontbreekt het, dan geldt `NIET_TOEGEWEZEN`
 *    ('Niet toegewezen'); de migratie zet dat ook echt in de databank.
 *  - Vergelijken gebeurt hoofdletterongevoelig op de genormaliseerde waarde
 *    (`typeSleutel`), zodat "overige" en "Overige" nooit naast elkaar bestaan.
 *  - "Overig(e)" met een eigen omschrijving wordt opgeslagen ALS de typewaarde
 *    zelf: `Overige — Sponsoring`. Er is dus bewust GEEN extra kolom
 *    `contract_type_toelichting`; één kolom (`contracts.contract_type`) blijft
 *    de enige bron, overal identiek (lijst, filters, detail, zoeken, export).
 */

/** Waarde voor een contract zonder gekozen type. */
export const NIET_TOEGEWEZEN = 'Niet toegewezen'

/** Maximale lengte van een typenaam (ook in de UI afgedwongen). */
export const MAX_TYPE_LENGTE = 60

/** Scheidingsteken tussen "Overige" en de eigen omschrijving. */
export const OVERIG_SCHEIDING = ' — '

/**
 * Startlijst voor de tabel: de historische `CONTRACT_TYPES` (die al in gebruik
 * zijn) plus de door NextGenMedia gevraagde set. Bijna-dubbels zijn bewust
 * samengevoegd op de bestaande schrijfwijze — zie `SAMENGEVOEGD`.
 */
export const SEED_CONTRACTTYPES: string[] = [
  'Klantcontract',
  'Websitecontract',
  'Social Media contract',
  'Brandingcontract',
  'Foto/videografiecontract',
  'Partnercontract',
  'Onderaannemerscontract',
  'Freelancecontract',
  'Samenwerkingsovereenkomst',
  'NDA / geheimhouding',
  'Overige',
  'Dienstverlening',
  'Socialmediamanagement',
  'Marketing',
  'Software of ontwikkeling',
  'Onderhoud',
  'Verhuur',
  'Algemene voorwaarden',
]

/**
 * Gevraagde naam → bestaande naam die al op contracten staat. Zo ontstaan er
 * geen twee types die hetzelfde betekenen.
 */
export const SAMENGEVOEGD: Record<string, string> = {
  overig: 'Overige',
  'geheimhouding/nda': 'NDA / geheimhouding',
  freelancer: 'Freelancecontract',
  samenwerking: 'Samenwerkingsovereenkomst',
}

/** Trim, spaties normaliseren en afkappen op `MAX_TYPE_LENGTE`. */
export function normaliseerType(waarde: unknown): string {
  if (waarde === null || waarde === undefined) return ''
  return String(waarde).replace(/\s+/g, ' ').trim().slice(0, MAX_TYPE_LENGTE).trim()
}

/** Sleutel om hoofdletterongevoelig te vergelijken/ontdubbelen. */
export function typeSleutel(waarde: unknown): string {
  return normaliseerType(waarde).toLowerCase()
}

/** Zijn twee typenamen dezelfde (hoofdletterongevoelig, na normaliseren)? */
export function gelijkType(a: unknown, b: unknown): boolean {
  const ka = typeSleutel(a)
  return ka !== '' && ka === typeSleutel(b)
}

/** De typewaarde van een contract, met 'Niet toegewezen' als terugval. */
export function typeVanContract(waarde: unknown): string {
  return normaliseerType(waarde) || NIET_TOEGEWEZEN
}

/** Is dit het 'Niet toegewezen'-type? Een lege waarde telt mee (dat ís de terugval). */
export function isNietToegewezen(waarde: unknown): boolean {
  return gelijkType(typeVanContract(waarde), NIET_TOEGEWEZEN)
}

/**
 * Ontdubbelen op hoofdletterongevoelige sleutel; de eerste schrijfwijze wint.
 * Lege waarden vallen weg. `SAMENGEVOEGD` wordt toegepast, zodat bv. 'Overig'
 * hetzelfde type is als 'Overige'.
 */
export function ontdubbelTypes(lijst: Array<string | null | undefined>): string[] {
  const uit: string[] = []
  const gezien = new Set<string>()
  for (const ruw of lijst) {
    const genormaliseerd = normaliseerType(ruw)
    if (!genormaliseerd) continue
    const naam = SAMENGEVOEGD[genormaliseerd.toLowerCase()] ?? genormaliseerd
    const sleutel = naam.toLowerCase()
    if (gezien.has(sleutel)) continue
    gezien.add(sleutel)
    uit.push(naam)
  }
  return uit
}

/** Volledige startlijst inclusief de types die al op contracten staan. */
export function seedLijst(inGebruik: Array<string | null | undefined> = []): string[] {
  return ontdubbelTypes([...SEED_CONTRACTTYPES, ...inGebruik, NIET_TOEGEWEZEN])
}

// ── "Overige" met eigen omschrijving ─────────────────────────────────────────

/** Hoort deze waarde bij de "Overig(e)"-familie (met of zonder omschrijving)? */
export function isOverig(waarde: unknown): boolean {
  const s = splitsOverig(waarde).basis.toLowerCase()
  return s === 'overig' || s === 'overige'
}

/** 'Overige' + omschrijving → één typewaarde. Zonder omschrijving blijft het 'Overige'. */
export function maakOverigType(basis: string, omschrijving: unknown): string {
  const b = normaliseerType(basis) || 'Overige'
  const o = normaliseerType(omschrijving)
  if (!o) return b
  return normaliseerType(`${b}${OVERIG_SCHEIDING}${o}`)
}

/** Splitst 'Overige — Sponsoring' terug in basis + omschrijving. */
export function splitsOverig(waarde: unknown): { basis: string; omschrijving: string } {
  const s = normaliseerType(waarde)
  const i = s.indexOf(OVERIG_SCHEIDING)
  if (i < 0) return { basis: s, omschrijving: '' }
  return { basis: s.slice(0, i).trim(), omschrijving: s.slice(i + OVERIG_SCHEIDING.length).trim() }
}

// ── Hernoemen ────────────────────────────────────────────────────────────────

export type TypeGebruik = { naam: string; aantal: number }

/** Telt per type hoeveel contracten het gebruiken (hoofdletterongevoelig gegroepeerd). */
export function telGebruik(
  contracten: Array<{ contract_type?: string | null }>,
  types: Array<string | null | undefined> = [],
): TypeGebruik[] {
  const namen = new Map<string, string>()
  const aantallen = new Map<string, number>()
  for (const naam of ontdubbelTypes(types)) {
    namen.set(naam.toLowerCase(), naam)
    aantallen.set(naam.toLowerCase(), 0)
  }
  for (const c of contracten) {
    const naam = typeVanContract(c.contract_type)
    const sleutel = naam.toLowerCase()
    if (!namen.has(sleutel)) namen.set(sleutel, naam)
    aantallen.set(sleutel, (aantallen.get(sleutel) ?? 0) + 1)
  }
  return [...namen.entries()].map(([sleutel, naam]) => ({ naam, aantal: aantallen.get(sleutel) ?? 0 }))
}

/**
 * Hernoemen: elk contract dat `van` gebruikt krijgt `naar`. Geeft de nieuwe
 * lijst plus het aantal gewijzigde contracten terug (pure functie — de route
 * gebruikt hetzelfde criterium voor de database-update).
 */
export function hernoemInContracten<T extends { contract_type?: string | null }>(
  contracten: T[],
  van: string,
  naar: string,
): { contracten: T[]; gewijzigd: number } {
  const nieuw = normaliseerType(naar)
  if (!nieuw || !normaliseerType(van)) return { contracten, gewijzigd: 0 }
  let gewijzigd = 0
  const uit = contracten.map((c) => {
    const huidig = typeVanContract(c.contract_type)
    if (!gelijkType(huidig, van)) return c
    if (huidig === nieuw) return c
    gewijzigd++
    return { ...c, contract_type: nieuw }
  })
  return { contracten: uit, gewijzigd }
}

/** Mag dit type hernoemd/toegevoegd worden? Geeft een Nederlandse fout of null. */
export function keurNaamGoed(naam: unknown, bestaande: Array<string | null | undefined> = [], huidig?: string | null): string | null {
  const n = normaliseerType(naam)
  if (!n) return 'Geef een naam voor het contracttype.'
  if (String(naam).replace(/\s+/g, ' ').trim().length > MAX_TYPE_LENGTE) return `Een contracttype mag maximaal ${MAX_TYPE_LENGTE} tekens lang zijn.`
  const botsing = bestaande.find((b) => gelijkType(b, n) && !(huidig && gelijkType(b, huidig)))
  if (botsing) return `Het contracttype "${normaliseerType(botsing)}" bestaat al.`
  return null
}
