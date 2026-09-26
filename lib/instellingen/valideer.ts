// Validatie van de centrale instellingen — PUUR (geen server-imports), zodat
// dit ook in tests draait. Elke sleutel heeft één functie die een ruwe
// invoer omzet in een correcte waarde of een leesbare Nederlandse fout geeft.

import {
  ACTIES, ROLLEN, MODULES, moduleInfo, samenvoegen, MODULE_INSTELLINGEN_KEY,
  type Organisatie, type FacturatieInstellingen, type DocumentenInstellingen, type ModulesInstellingen, type RechtenInstellingen, type Actie, type Rol,
} from './model'

export type Validatie<T> = { ok: true; waarde: T } | { ok: false; fout: string }

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const tekst = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const getal = (v: unknown, terugval: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : terugval
}

/** Belgisch btw-nummer: BE + 10 cijfers, laatste twee = 97 − (eerste acht mod 97). */
export function isGeldigBtw(s: string): boolean {
  const cijfers = s.toUpperCase().replace(/[^0-9A-Z]/g, '')
  const m = /^BE(\d{10})$/.exec(cijfers)
  if (!m) return false
  const d = m[1]
  return 97 - (Number(d.slice(0, 8)) % 97) === Number(d.slice(8))
}

/** IBAN-controle (mod 97) — landonafhankelijk. */
export function isGeldigIban(s: string): boolean {
  const iban = s.toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const herschikt = iban.slice(4) + iban.slice(0, 4)
  const numeriek = herschikt.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let rest = 0
  for (const ch of numeriek) rest = (rest * 10 + Number(ch)) % 97
  return rest === 1
}

export function normaliseerIban(s: string): string {
  const iban = s.toUpperCase().replace(/\s+/g, '')
  return iban.replace(/(.{4})/g, '$1 ').trim()
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const KLEUR = /^#[0-9a-fA-F]{6}$/

export function valideerOrganisatie(ruw: unknown): Validatie<Organisatie> {
  const r = obj(ruw); if (!r) return { ok: false, fout: 'Ongeldige gegevens.' }
  const w: Organisatie = {
    vennootschapsnaam: tekst(r.vennootschapsnaam, 200), handelsnaam: tekst(r.handelsnaam, 200),
    ondernemingsnummer: tekst(r.ondernemingsnummer, 40), btw_nummer: tekst(r.btw_nummer, 40).toUpperCase(),
    maatschappelijke_zetel: tekst(r.maatschappelijke_zetel, 400), facturatieadres: tekst(r.facturatieadres, 400),
    email: tekst(r.email, 200).toLowerCase(), telefoon: tekst(r.telefoon, 40), website: tekst(r.website, 200),
    iban: tekst(r.iban, 60), bic: tekst(r.bic, 20).toUpperCase(),
    betalingstermijn_dagen: Math.round(getal(r.betalingstermijn_dagen, 30)),
    valuta: tekst(r.valuta, 3).toUpperCase() || 'EUR', tijdzone: tekst(r.tijdzone, 60) || 'Europe/Brussels', datumnotatie: tekst(r.datumnotatie, 20) || 'dd/mm/jjjj',
  }
  if (!w.vennootschapsnaam && !w.handelsnaam) return { ok: false, fout: 'Vul minstens een vennootschaps- of handelsnaam in.' }
  if (w.btw_nummer && !isGeldigBtw(w.btw_nummer)) return { ok: false, fout: 'Het btw-nummer is niet geldig (verwacht: BE 0xxx.xxx.xxx met een kloppend controlegetal).' }
  if (w.email && !EMAIL.test(w.email)) return { ok: false, fout: 'Het e-mailadres is niet geldig.' }
  if (w.website && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(w.website)) return { ok: false, fout: 'De website moet beginnen met http:// of https://.' }
  if (w.iban) { if (!isGeldigIban(w.iban)) return { ok: false, fout: 'Het IBAN is niet geldig.' }; w.iban = normaliseerIban(w.iban) }
  if (w.bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(w.bic)) return { ok: false, fout: 'De BIC moet 8 of 11 tekens tellen.' }
  if (w.betalingstermijn_dagen < 0 || w.betalingstermijn_dagen > 365) return { ok: false, fout: 'De betalingstermijn moet tussen 0 en 365 dagen liggen.' }
  if (!/^[A-Z]{3}$/.test(w.valuta)) return { ok: false, fout: 'De valuta is een code van drie letters (bv. EUR).' }
  return { ok: true, waarde: w }
}

export function valideerFacturatie(ruw: unknown): Validatie<FacturatieInstellingen> {
  const r = obj(ruw); if (!r) return { ok: false, fout: 'Ongeldige gegevens.' }
  const w: FacturatieInstellingen = {
    standaard_btw_pct: getal(r.standaard_btw_pct, 21), betalingstermijn_dagen: Math.round(getal(r.betalingstermijn_dagen, 30)),
    standaard_omschrijving: tekst(r.standaard_omschrijving, 500),
    factuurnummer_prefix: tekst(r.factuurnummer_prefix, 20), factuurnummer_volgend: Math.round(getal(r.factuurnummer_volgend, 1)),
    creditnota_prefix: tekst(r.creditnota_prefix, 20), creditnota_volgend: Math.round(getal(r.creditnota_volgend, 1)),
    betaalgegevens: tekst(r.betaalgegevens, 600), standaard_status: r.standaard_status === 'verstuurd' ? 'verstuurd' : 'te_versturen',
    clickup_sync_aan: r.clickup_sync_aan !== false,
    clickup_lijst_id: tekst(r.clickup_lijst_id, 40), clickup_lijst_pad: tekst(r.clickup_lijst_pad, 300),
    clickup_assignee_id: tekst(r.clickup_assignee_id, 40), clickup_assignee_naam: tekst(r.clickup_assignee_naam, 120),
    verantwoordelijke_naam: tekst(r.verantwoordelijke_naam, 120) || 'Bram Reinquin',
  }
  if (w.standaard_btw_pct < 0 || w.standaard_btw_pct > 100) return { ok: false, fout: 'Het btw-percentage moet tussen 0 en 100 liggen.' }
  if (w.betalingstermijn_dagen < 0 || w.betalingstermijn_dagen > 365) return { ok: false, fout: 'De betalingstermijn moet tussen 0 en 365 dagen liggen.' }
  if (w.factuurnummer_volgend < 1 || w.creditnota_volgend < 1) return { ok: false, fout: 'Het volgende nummer moet minstens 1 zijn.' }
  if (w.clickup_lijst_id && !/^\d+$/.test(w.clickup_lijst_id)) return { ok: false, fout: 'Een ClickUp lijst-id bestaat enkel uit cijfers.' }
  if (w.clickup_assignee_id && !/^\d+$/.test(w.clickup_assignee_id)) return { ok: false, fout: 'Een ClickUp gebruikers-id bestaat enkel uit cijfers.' }
  return { ok: true, waarde: w }
}

/** Toegestane bouwstenen van een bestandsnaam. */
export const BESTANDSNAAM_VELDEN = ['{type}', '{nummer}', '{datum}', '{klant}', '{jaar}'] as const

export function voorbeeldBestandsnaam(patroon: string): string {
  return patroon.replace('{type}', 'Bevestiging').replace('{nummer}', 'BEV-2026-012').replace('{datum}', '2026-09-14').replace('{klant}', 'Voorbeeld-BV').replace('{jaar}', '2026') + '.pdf'
}

export function valideerDocumenten(ruw: unknown, huidig: DocumentenInstellingen): Validatie<DocumentenInstellingen> {
  const r = obj(ruw); if (!r) return { ok: false, fout: 'Ongeldige gegevens.' }
  const w: DocumentenInstellingen = {
    // Het logo verandert enkel via de uploadroute; hier blijft het huidige pad staan.
    logo_path: huidig.logo_path,
    primaire_kleur: tekst(r.primaire_kleur, 7).toLowerCase(), secundaire_kleur: tekst(r.secundaire_kleur, 7).toLowerCase(),
    voettekst: tekst(r.voettekst, 400), contactregel: tekst(r.contactregel, 300),
    bestandsnaam_patroon: tekst(r.bestandsnaam_patroon, 80),
  }
  if (!KLEUR.test(w.primaire_kleur) || !KLEUR.test(w.secundaire_kleur)) return { ok: false, fout: 'Kleuren horen als hex-code (#rrggbb).' }
  if (!w.bestandsnaam_patroon) return { ok: false, fout: 'Het bestandsnaampatroon mag niet leeg zijn.' }
  if (!/^[A-Za-z0-9_\-{} .]+$/.test(w.bestandsnaam_patroon)) return { ok: false, fout: 'Het bestandsnaampatroon bevat tekens die niet in een bestandsnaam mogen.' }
  const onbekend = (w.bestandsnaam_patroon.match(/\{[^}]*\}/g) ?? []).filter((v) => !(BESTANDSNAAM_VELDEN as readonly string[]).includes(v))
  if (onbekend.length) return { ok: false, fout: `Onbekende bouwsteen in het patroon: ${onbekend.join(', ')}. Beschikbaar: ${BESTANDSNAAM_VELDEN.join(', ')}.` }
  if (!w.bestandsnaam_patroon.includes('{nummer}')) return { ok: false, fout: 'Het patroon moet {nummer} bevatten, anders zijn bestandsnamen niet uniek.' }
  return { ok: true, waarde: w }
}

/** De bevestigingstekst voor een essentieel tabblad (exact zoals afgesproken). */
export function bevestigingstekstVerbergen(label: string): string {
  return `Weet je zeker dat je het tabblad ${label} wilt verbergen? Het tabblad en de gegevens worden niet verwijderd. Je kunt het later opnieuw activeren via Instellingen.`
}

/**
 * Modules: zichtbaarheid + rollen + volgorde. Essentiële tabbladen die van
 * zichtbaar naar verborgen gaan, vragen een bevestiging (per sleutel);
 * Instellingen kan nooit verborgen worden (samenvoegen dwingt dat af).
 */
export function valideerModules(ruw: unknown, huidig: ModulesInstellingen, bevestigingen: string[]): Validatie<ModulesInstellingen> {
  const r = obj(ruw); if (!r) return { ok: false, fout: 'Ongeldige gegevens.' }
  const nieuw = samenvoegen({ modules: r }).modules
  if (r[MODULE_INSTELLINGEN_KEY] && obj(r[MODULE_INSTELLINGEN_KEY])?.zichtbaar === false) return { ok: false, fout: 'Het tabblad Instellingen kan niet verborgen worden.' }
  for (const m of MODULES) {
    const info = moduleInfo(m.key)
    if (info?.essentieel && huidig[m.key]?.zichtbaar && !nieuw[m.key]?.zichtbaar && !bevestigingen.includes(m.key)) {
      return { ok: false, fout: `Bevestig eerst dat je het tabblad ${m.label} wilt verbergen.` }
    }
  }
  return { ok: true, waarde: nieuw }
}

/** Rechten: elke actie vereist 'bekijken'; hoofdbeheerder blijft altijd alles. */
export function valideerRechten(ruw: unknown): Validatie<RechtenInstellingen> {
  const r = obj(ruw); if (!r) return { ok: false, fout: 'Ongeldige gegevens.' }
  const nieuw = samenvoegen({ rechten: r }).rechten
  for (const rol of ROLLEN.map((x) => x.key) as Rol[]) {
    if (rol === 'hoofdbeheerder') continue
    for (const k of Object.keys(nieuw[rol])) {
      const acties = nieuw[rol][k] as Actie[]
      if (acties.length && !acties.includes('bekijken')) nieuw[rol][k] = ['bekijken', ...acties]
      nieuw[rol][k] = ACTIES.map((a) => a.key).filter((a) => nieuw[rol][k].includes(a))
    }
  }
  return { ok: true, waarde: nieuw }
}

/** Welke velden verschillen tussen oud en nieuw (bovenste niveau)? Voor het logboek. */
export function verschillen(oud: unknown, nieuw: unknown): string[] {
  const a = obj(oud) ?? {}, b = obj(nieuw) ?? {}
  const sleutels = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...sleutels].filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)).sort()
}

/** Enkel de gewijzigde velden meenemen in het logboek (nooit het hele object). */
export function uittreksel(waarde: unknown, velden: string[]): Record<string, unknown> {
  const o = obj(waarde) ?? {}
  return Object.fromEntries(velden.map((k) => [k, o[k] ?? null]))
}
