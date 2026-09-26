// Opdrachten op een lead — pure module, bruikbaar in client- én servercode.
//
// Een lead in de pipeline kan één of meer "opdrachten" dragen: een titel met
// een bedrag (excl. btw). Samen vormen ze de WAARDE van de lead, en die waarde
// telt per kolom op het bord op. Zo zie je per fase hoeveel er in de pijplijn
// zit. Dit vervangt de losse Opdrachten-pagina (tabel `opdrachten` blijft
// bestaan als archief; de migratie van 22 sep 2026 zette elke rij over naar
// een lead + opdracht).

export type LeadOpdracht = {
  id: string
  lead_id?: string
  titel: string
  bedrag_cents: number
  dienst?: string | null
  notitie?: string | null
  positie?: number | null
  created_at?: string
}

/** Wat het bord per lead meekrijgt (compact). */
export type OpdrachtKort = { id: string; titel: string; bedrag_cents: number }

/**
 * Bedrag in euro (zoals een mens het typt) → centen. Null bij onzin of negatief.
 *
 * Belgische notatie eerst: "3.250" is drieduizend tweehonderdvijftig, "3.250,50"
 * heeft een decimale komma. Zonder komma is een punt enkel een decimaalteken als
 * er geen groep van precies drie cijfers achter staat ("12.5" = 12,50).
 * Een euroteken, spaties en "EUR" mogen erbij staan.
 */
export function parseBedragCents(invoer: unknown): number | null {
  if (typeof invoer === 'number') return Number.isFinite(invoer) && invoer >= 0 ? Math.round(invoer * 100) : null
  if (typeof invoer !== 'string') return null
  let s = invoer.replace(/€|eur/gi, '').replace(/[\s ]/g, '')
  if (!s) return null
  if (s.startsWith('-')) return null
  if (!/^[0-9.,]+$/.test(s)) return null
  if (s.includes(',')) {
    // Komma = decimaal; punten = duizendtallen.
    if ((s.match(/,/g) ?? []).length > 1) return null
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes('.')) {
    const delen = s.split('.')
    const duizendtallen = delen.length > 1 && delen.slice(1).every((d) => d.length === 3)
    if (duizendtallen) s = delen.join('')
    else if (delen.length > 2) return null
  }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/** Som van de (actieve) opdrachten; negatieve of kapotte bedragen tellen niet. */
export function somOpdrachten(opdrachten: { bedrag_cents: number | null | undefined }[] | null | undefined): number {
  let som = 0
  for (const o of opdrachten ?? []) {
    const b = o.bedrag_cents
    if (typeof b === 'number' && Number.isFinite(b) && b > 0) som += Math.round(b)
  }
  return som
}

/**
 * De waarde van een lead. Heeft hij opdrachten, dan is het hun som — ook als die
 * 0 is (bewust: een opdracht zonder bedrag is een keuze). Zonder opdrachten
 * valt hij terug op de dealwaarde die bij "Gewonnen" werd ingevuld.
 */
export function leadWaardeCents(lead: {
  opdrachten?: { bedrag_cents: number | null | undefined }[] | null
  deal_waarde_cents?: number | null
}): number {
  if (lead.opdrachten && lead.opdrachten.length > 0) return somOpdrachten(lead.opdrachten)
  const d = lead.deal_waarde_cents
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.round(d) : 0
}

/** Aantal en waarde van een lijst leads (één kolom op het bord). */
export function kolomSamenvatting(leads: { waarde_cents?: number | null }[]): { aantal: number; waardeCents: number } {
  let waardeCents = 0
  for (const l of leads) {
    const w = l.waarde_cents
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) waardeCents += w
  }
  return { aantal: leads.length, waardeCents }
}

/** De balk boven het bord: open pijplijn, gewonnen en verloren. */
export function pipelineTotalen(leads: { stage_key: string; waarde_cents?: number | null }[]): {
  openCents: number; gewonnenCents: number; verlorenCents: number; openAantal: number
} {
  let openCents = 0, gewonnenCents = 0, verlorenCents = 0, openAantal = 0
  for (const l of leads) {
    const w = typeof l.waarde_cents === 'number' && Number.isFinite(l.waarde_cents) && l.waarde_cents > 0 ? l.waarde_cents : 0
    if (l.stage_key === 'gewonnen') gewonnenCents += w
    else if (l.stage_key === 'verloren') verlorenCents += w
    else if (l.stage_key === 'geen_interesse') continue // geen open pijplijn meer
    else { openCents += w; openAantal++ }
  }
  return { openCents, gewonnenCents, verlorenCents, openAantal }
}

/** "Website" of "Website +2" voor op de kaart. */
export function opdrachtSamenvatting(opdrachten: { titel: string }[] | null | undefined): string | null {
  const lijst = opdrachten ?? []
  if (lijst.length === 0) return null
  return lijst.length === 1 ? lijst[0].titel : `${lijst[0].titel} +${lijst.length - 1}`
}

/** Tijdlijnregel bij een opdracht: "Opdracht toegevoegd: Website — € 3.250". */
export function opdrachtRegel(actie: 'toegevoegd' | 'aangepast' | 'verwijderd', titel: string, bedragCents: number): string {
  return `Opdracht ${actie}: ${titel} — ${euroTekst(bedragCents)}`
}

export function euroTekst(cents: number): string {
  return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format((cents || 0) / 100)
}

/**
 * Hoe een status uit de oude Opdrachten-module op het bord terechtkomt.
 * SPIEGELT de CASE in de migratie (99999999_SYNC_ALL.sql, "Pipeline-opdrachten
 * + beltijd (22 sep 2026)") — pas ze samen aan.
 */
export const OUDE_STATUS_NAAR_FASE: Record<string, 'inbound' | 'opvolgen' | 'voorstel' | 'gewonnen' | 'verloren'> = {
  open: 'inbound',
  voorstel_gevraagd: 'opvolgen', voorstel_bezig: 'opvolgen', voorstel_klaar: 'opvolgen',
  voorstel_voorgelegd: 'voorstel', interesse: 'voorstel', contract_verstuurd: 'voorstel',
  geen_interesse: 'verloren', geannuleerd: 'verloren',
  getekend: 'gewonnen', bezig: 'gewonnen', wacht: 'gewonnen', opgeleverd: 'gewonnen',
  te_factureren: 'gewonnen', factuur_verstuurd: 'gewonnen', betaald: 'gewonnen', afgerond: 'gewonnen',
}

export type OpdrachtInvoer = { titel?: string; bedrag_cents?: number; dienst?: string | null; notitie?: string | null }

/**
 * Invoer uit een formulier/API-body controleren. `volledig` = nieuwe opdracht
 * (titel verplicht, bedrag mag leeg = 0); anders een gedeeltelijke wijziging.
 * Het bedrag mag als `bedrag` (euro, tekst of getal) of `bedrag_cents` komen.
 */
export function leesOpdrachtInvoer(b: Record<string, unknown>, volledig: boolean):
  { ok: true; invoer: OpdrachtInvoer } | { ok: false; error: string } {
  const invoer: OpdrachtInvoer = {}
  if (b.titel !== undefined || volledig) {
    const titel = String(b.titel ?? '').trim().slice(0, MAX_TITEL)
    if (!titel) return { ok: false, error: 'Geef de opdracht een titel.' }
    invoer.titel = titel
  }
  if (b.bedrag_cents !== undefined && b.bedrag_cents !== null && b.bedrag_cents !== '') {
    const n = Number(b.bedrag_cents)
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Het bedrag klopt niet.' }
    invoer.bedrag_cents = Math.round(n)
  } else if (b.bedrag !== undefined && b.bedrag !== null && String(b.bedrag).trim() !== '') {
    const c = parseBedragCents(b.bedrag)
    if (c === null) return { ok: false, error: 'Het bedrag klopt niet (bv. 3.250 of 3250,50).' }
    invoer.bedrag_cents = c
  } else if (volledig || b.bedrag !== undefined || b.bedrag_cents !== undefined) {
    invoer.bedrag_cents = 0
  }
  if (invoer.bedrag_cents !== undefined && invoer.bedrag_cents > MAX_BEDRAG_CENTS) {
    return { ok: false, error: 'Dat bedrag is wel erg hoog — controleer het even.' }
  }
  if (b.dienst !== undefined) invoer.dienst = String(b.dienst ?? '').trim().slice(0, 100) || null
  if (b.notitie !== undefined) invoer.notitie = String(b.notitie ?? '').trim().slice(0, MAX_NOTITIE) || null
  return { ok: true, invoer }
}

export const MAX_TITEL = 200
export const MAX_NOTITIE = 2000
/** Een typfout van boven de tien miljoen euro wil je niet stil bewaren. */
export const MAX_BEDRAG_CENTS = 1_000_000_000
