// Kantoor — samenwerking tussen bedrijven. Pure module: geen imports, ook
// bruikbaar in clientcomponenten, en daardoor los testbaar.
//
// Twee vormen van samenwerking, met dezelfde structuur maar een andere
// geldstroom:
//
//  ONDERAANNEMING  ik heb de klant en factureer hem; jij doet het werk en
//                  krijgt een vergoeding van mij.
//  DOORVERWIJZING  jij brengt de klant aan; ik sluit de deal, factureer de
//                  klant en betaal jou een percentage.
//
// In beide gevallen: één partij FACTUREERT de eindklant (krijgt `totaal`), de
// andere ONTVANGT een interne vergoeding. Dat maakt het rekenwerk identiek —
// alleen wie welke rol heeft verschilt.

export type Soort = 'onderaanneming' | 'doorverwijzing'
export type OpdrachtStatus = 'lopend' | 'afgerond' | 'geannuleerd'

export type Bedrijf = {
  id: string
  naam: string
  is_eigen: boolean
  email?: string | null
  actief?: boolean
}

export type KantoorOpdracht = {
  id: string
  soort: Soort
  factureert_id: string
  ontvangt_id: string
  titel: string
  omschrijving: string | null
  klant_naam: string | null
  totaal_cents: number
  vergoeding_cents: number
  vergoeding_pct: number | null
  bedragen_zichtbaar: boolean
  status: OpdrachtStatus
  afgerond_op: string | null
  created_at: string
  /** Door de API meegeleverd, niet in de tabel. */
  factureert_naam?: string
  ontvangt_naam?: string
}

export const SOORTEN: { key: Soort; label: string; uitleg: string }[] = [
  {
    key: 'onderaanneming', label: 'Onderaanneming',
    uitleg: 'Eén bedrijf heeft de klant en factureert hem; het andere doet het werk voor een vergoeding.',
  },
  {
    key: 'doorverwijzing', label: 'Doorverwijzing',
    uitleg: 'Eén bedrijf brengt de klant aan; het andere sluit de deal en betaalt een percentage door.',
  },
]

export const STATUSSEN: { key: OpdrachtStatus; label: string; badge: string }[] = [
  { key: 'lopend',      label: 'Lopend',      badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'afgerond',    label: 'Afgerond',    badge: 'bg-green-50 text-green-700 border-green-200' },
  { key: 'geannuleerd', label: 'Geannuleerd', badge: 'bg-gray-50 text-gray-400 border-gray-200 line-through' },
]

/**
 * Standaard voor "mag de tegenpartij de bedragen zien".
 *
 * Bij onderaanneming UIT: daar zit onze marge in, en die hoort niet
 * standaard op tafel te liggen bij wie het werk uitvoert. Bij doorverwijzing
 * AAN: het percentage is daar per definitie afgeleid van het totaal, dus
 * zonder dat cijfer kan de doorverwijzer zijn eigen vergoeding niet nakijken.
 */
export function standaardZichtbaar(soort: Soort): boolean {
  return soort === 'doorverwijzing'
}

/** Wat de facturerende partij overhoudt. */
export function margeCents(o: Pick<KantoorOpdracht, 'totaal_cents' | 'vergoeding_cents'>): number {
  return Math.max(0, o.totaal_cents - o.vergoeding_cents)
}

/** Percentage → centen. Rondt af op de cent, want daar wordt mee betaald. */
export function pctNaarCents(totaalCents: number, pct: number): number {
  if (!Number.isFinite(totaalCents) || !Number.isFinite(pct)) return 0
  return Math.max(0, Math.min(totaalCents, Math.round((totaalCents * pct) / 100)))
}

export const euro = (cents: number): string =>
  (cents / 100).toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })

// ── Zichtbaarheid ───────────────────────────────────────────────────────────
//
// DIT IS HET GEVOELIGE DEEL. Een opdracht heeft twee partijen met een
// verschillend belang: wie factureert kent het totaal en zijn marge; de
// tegenpartij hoort dat alleen te zien wanneer dat zo afgesproken is.
// Alles wat naar de browser gaat loopt daarom eerst door `voorBedrijf()` —
// niet door de UI, want een verborgen veld is geen geheim veld.

export type ZichtbareOpdracht = Omit<KantoorOpdracht, 'totaal_cents' | 'vergoeding_pct'> & {
  /** null = dit bedrijf mag het totaal niet zien. */
  totaal_cents: number | null
  vergoeding_pct: number | null
  /** null = marge onbekend voor dit bedrijf. */
  marge_cents: number | null
  /** Wat DIT bedrijf aan deze opdracht overhoudt. */
  mijn_bedrag_cents: number
  /** Krijgt dit bedrijf betaald (true) of moet het betalen (false)? */
  ik_ontvang: boolean
  /** Naam van de tegenpartij, vanuit dit bedrijf gezien. */
  tegenpartij_naam: string
}

/**
 * Eén opdracht, gefilterd op wat `bedrijfId` mag zien.
 *
 * Geeft null terug als het bedrijf niets met deze opdracht te maken heeft —
 * dan hoort de rij niet in zijn lijst. Zo kan Small Steps Big Impact nooit
 * zien wat NextGenMedia met Fully Booked afspreekt.
 */
export function voorBedrijf(
  o: KantoorOpdracht, bedrijfId: string, alleenEigenBedrijven = false,
): ZichtbareOpdracht | null {
  const factureert = o.factureert_id === bedrijfId
  const ontvangt = o.ontvangt_id === bedrijfId
  if (!factureert && !ontvangt) return null

  // Wie factureert kent het totaal sowieso: hij stuurt die factuur zelf.
  // Voor de tegenpartij hangt het af van wat er bij de opdracht is afgesproken.
  // `alleenEigenBedrijven` = de interne adminweergave: daar zien we alles.
  const magTotaalZien = factureert || o.bedragen_zichtbaar || alleenEigenBedrijven

  const { totaal_cents, vergoeding_pct, ...rest } = o
  return {
    ...rest,
    totaal_cents: magTotaalZien ? totaal_cents : null,
    vergoeding_pct: magTotaalZien ? vergoeding_pct : null,
    marge_cents: magTotaalZien ? margeCents(o) : null,
    mijn_bedrag_cents: factureert ? margeCents(o) : o.vergoeding_cents,
    ik_ontvang: ontvangt,
    tegenpartij_naam: (factureert ? o.ontvangt_naam : o.factureert_naam) ?? 'Onbekend',
  }
}

// ── Cijfers ─────────────────────────────────────────────────────────────────

export type Samenvatting = {
  /** Wat dit bedrijf verdiend heeft aan afgeronde opdrachten. */
  verdiendCents: number
  /** Wat er nog openstaat: lopende opdrachten. */
  openCents: number
  aantalLopend: number
  aantalAfgerond: number
  /** Per tegenpartij: wat we voor elkaar opleverden. */
  perPartner: { naam: string; verdiendCents: number; openCents: number; aantal: number }[]
}

export function samenvatting(rijen: ZichtbareOpdracht[]): Samenvatting {
  const perPartner = new Map<string, { naam: string; verdiendCents: number; openCents: number; aantal: number }>()
  let verdiendCents = 0, openCents = 0, aantalLopend = 0, aantalAfgerond = 0

  for (const o of rijen) {
    if (o.status === 'geannuleerd') continue
    const p = perPartner.get(o.tegenpartij_naam)
      ?? { naam: o.tegenpartij_naam, verdiendCents: 0, openCents: 0, aantal: 0 }
    p.aantal++
    if (o.status === 'afgerond') {
      verdiendCents += o.mijn_bedrag_cents
      p.verdiendCents += o.mijn_bedrag_cents
      aantalAfgerond++
    } else {
      openCents += o.mijn_bedrag_cents
      p.openCents += o.mijn_bedrag_cents
      aantalLopend++
    }
    perPartner.set(o.tegenpartij_naam, p)
  }

  return {
    verdiendCents, openCents, aantalLopend, aantalAfgerond,
    perPartner: [...perPartner.values()].sort((a, b) =>
      (b.verdiendCents + b.openCents) - (a.verdiendCents + a.openCents)),
  }
}

/** Maand (YYYY-MM, Brussel) waarin een afgeronde opdracht boekt. */
export function boekMaand(afgerondOp: string | null): string | null {
  if (!afgerondOp) return null
  const d = new Date(afgerondOp)
  if (Number.isNaN(d.getTime())) return null
  // Brussel, niet UTC: een opdracht die hier op 1 maart 00:30 afgerond wordt,
  // hoort in maart — in UTC zou dat nog februari zijn.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit',
  }).format(d).slice(0, 7)
}
