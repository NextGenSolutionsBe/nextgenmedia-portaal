// Pipeline — taken bij een lead. Puur (geen server, geen ClickUp-aanroepen),
// zodat het scherm en de tests dezelfde regels gebruiken.

import { zoneNaarIso } from '@/lib/meetings/model'

export const MERKEN = [
  { key: 'nextgenmedia', naam: 'NextGen Media' },
  { key: 'nextgensolutions', naam: 'NextGen Solutions' },
] as const
export type Merk = (typeof MERKEN)[number]['key']
export const merkNaam = (k: string | null | undefined): string => MERKEN.find((m) => m.key === k)?.naam ?? (k ?? '')

export const MAX_OMSCHRIJVING = 200
export const MAX_NOTITIE = 5000

export type LeadTaakInvoer = { omschrijving?: unknown; deadline?: unknown; notitie?: unknown; assignee_id?: unknown; merk?: unknown }
export type GeldigeLeadTaak = { omschrijving: string; deadline: string; notitie: string | null; assigneeId: number; merk: Merk }

const isDag = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))

/** Vóór er iets naar ClickUp gaat. `vandaag` als JJJJ-MM-DD (Belgische tijd). */
export function valideerLeadTaak(b: LeadTaakInvoer, vandaag: string): { ok: true; waarde: GeldigeLeadTaak } | { ok: false; fout: string } {
  const omschrijving = String(b.omschrijving ?? '').trim().replace(/\s+/g, ' ')
  if (omschrijving.length < 2) return { ok: false, fout: 'Geef de taak een omschrijving.' }
  if (omschrijving.length > MAX_OMSCHRIJVING) return { ok: false, fout: `De omschrijving mag hoogstens ${MAX_OMSCHRIJVING} tekens hebben. Zet de rest in de notitie.` }
  if (!isDag(b.deadline)) return { ok: false, fout: 'Kies een deadline.' }
  if (b.deadline < vandaag) return { ok: false, fout: 'De deadline ligt in het verleden.' }
  const notitie = String(b.notitie ?? '').trim()
  if (notitie.length > MAX_NOTITIE) return { ok: false, fout: `De notitie mag hoogstens ${MAX_NOTITIE} tekens hebben.` }
  const assigneeId = Number(b.assignee_id)
  if (!Number.isInteger(assigneeId) || assigneeId <= 0) return { ok: false, fout: 'Kies aan wie in ClickUp de taak wordt toegewezen.' }
  const merk = MERKEN.find((m) => m.key === b.merk)?.key
  if (!merk) return { ok: false, fout: 'Kies de lijst: NextGen Media of NextGen Solutions.' }
  return { ok: true, waarde: { omschrijving, deadline: b.deadline, notitie: notitie || null, assigneeId, merk } }
}

/** De lead in de pipeline; opent meteen de leadfiche. */
export const leadLink = (basis: string, leadId: string): string => `${basis.replace(/\/$/, '')}/admin/sales/pipeline?lead=${encodeURIComponent(leadId)}`

/** Unieke referentie in de ClickUp-omschrijving, om een taak na een onduidelijke afloop terug te vinden. */
export const leadTaakMarker = (taakId: string): string => `ngm-leadtaak:${taakId}`

/** Taaknaam in ClickUp: de omschrijving, met het bedrijf erbij zodat je de lead herkent. */
export function leadTaakNaam(omschrijving: string, bedrijf: string | null): string {
  if (!bedrijf || omschrijving.toLowerCase().includes(bedrijf.toLowerCase())) return omschrijving
  return `${omschrijving} (${bedrijf})`
}

/** Middag op de deadlinedag (Brussel): blijft op dezelfde dag in elke tijdzone van het team. */
export const deadlineMs = (dag: string): number => Date.parse(zoneNaarIso(dag, '12:00'))

const md = (s: string): string => s.replace(/([\\`*_[\]<>#|])/g, '\\$1')

/** Omschrijving van de ClickUp-taak: link naar de lead bovenaan, dan de notitie. Platte tekst én Markdown. */
export function leadTaakOmschrijving(t: {
  link: string; bedrijf: string | null; contact: string | null; notitie: string | null; door: string | null; marker: string
}): { tekst: string; markdown: string } {
  const lead = t.bedrijf || 'Lead'
  const tekst = [
    `Lead in de pipeline: ${t.link}`,
    t.contact ? `Contactpersoon: ${t.contact}` : null,
    t.notitie ? `\nNotitie:\n${t.notitie}` : null,
    `\nAangemaakt${t.door ? ` door ${t.door}` : ''} vanuit de pipeline van NextGenMedia.`,
    `Ref: ${t.marker}`,
  ].filter((x) => x !== null).join('\n')
  const markdown = [
    `**Lead:** [${md(lead)}](${t.link})`,
    t.contact ? `**Contactpersoon:** ${md(t.contact)}` : null,
    t.notitie ? `\n**Notitie**\n\n${md(t.notitie)}` : null,
    `\n_Aangemaakt${t.door ? ` door ${md(t.door)}` : ''} vanuit de pipeline van NextGenMedia._`,
    `Ref: ${t.marker}`,
  ].filter((x) => x !== null).join('\n')
  return { tekst, markdown }
}

/** Hoe de status in de leadfiche oogt. ClickUp-type 'closed' of 'done' = afgerond. */
export function statusToon(t: { sync_status: string; clickup_status: string | null; clickup_status_type: string | null }): { label: string; toon: 'ok' | 'bezig' | 'fout' | 'neutraal' } {
  if (t.sync_status === 'fout') return { label: 'Niet in ClickUp', toon: 'fout' }
  if (t.sync_status === 'wacht') return { label: 'Bezig…', toon: 'bezig' }
  if (t.clickup_status_type === 'weg') return { label: 'Verwijderd in ClickUp', toon: 'neutraal' }
  const label = t.clickup_status ?? 'onbekend'
  return { label, toon: t.clickup_status_type === 'closed' || t.clickup_status_type === 'done' ? 'ok' : 'neutraal' }
}

// ── Taken bij een opdracht (opdrachtenbord) ──────────────────────────────────
// Zelfde soort ClickUp-taak als bij een lead, met een link naar de opdrachtkaart.

/** De kaart op het opdrachtenbord; opent meteen het kaartvenster. */
export const opdrachtLink = (basis: string, opdrachtId: string): string => `${basis.replace(/\/$/, '')}/admin/opdrachten?opdracht=${encodeURIComponent(opdrachtId)}`

export const opdrachtTaakMarker = (taakId: string): string => `ngm-opdrachttaak:${taakId}`

export function opdrachtTaakOmschrijving(t: {
  link: string; bedrijf: string | null; titel: string | null; contact: string | null; notitie: string | null; door: string | null; marker: string
}): { tekst: string; markdown: string } {
  const kaart = [t.bedrijf, t.titel].filter(Boolean).join(' – ') || 'Opdracht'
  const tekst = [
    `Opdracht: ${kaart}`,
    `Op het opdrachtenbord: ${t.link}`,
    t.contact ? `Contactpersoon: ${t.contact}` : null,
    t.notitie ? `\nNotitie:\n${t.notitie}` : null,
    `\nAangemaakt${t.door ? ` door ${t.door}` : ''} vanuit de opdrachten van NextGenMedia.`,
    `Ref: ${t.marker}`,
  ].filter((x) => x !== null).join('\n')
  const markdown = [
    `**Opdracht:** [${md(kaart)}](${t.link})`,
    t.contact ? `**Contactpersoon:** ${md(t.contact)}` : null,
    t.notitie ? `\n**Notitie**\n\n${md(t.notitie)}` : null,
    `\n_Aangemaakt${t.door ? ` door ${md(t.door)}` : ''} vanuit de opdrachten van NextGenMedia._`,
    `Ref: ${t.marker}`,
  ].filter((x) => x !== null).join('\n')
  return { tekst, markdown }
}

/**
 * Het ClickUp-lid dat bij een verantwoordelijke hoort: eerst op e-mailadres,
 * dan op naam ("Bram" → "Bram Reinquin"), dan op het begin van het e-mailadres
 * (bram@…). Enkel een eenduidige match; anders null (dan kiest de mens).
 */
export function kiesClickupLid(leden: { id: number; naam: string; email: string }[], wie: { email?: string | null; naam?: string | null }): number | null {
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()
  const email = norm(wie.email)
  if (email) {
    const m = leden.find((l) => norm(l.email) === email)
    if (m) return m.id
  }
  const naam = norm(wie.naam)
  if (!naam) return null
  const exact = leden.filter((l) => norm(l.naam) === naam)
  if (exact.length === 1) return exact[0].id
  const voornaam = naam.split(/\s+/)[0]
  const opNaam = leden.filter((l) => norm(l.naam).split(/\s+/)[0] === voornaam)
  if (opNaam.length === 1) return opNaam[0].id
  const opMail = leden.filter((l) => norm(l.email).split('@')[0].split(/[._-]/)[0] === voornaam)
  return opMail.length === 1 ? opMail[0].id : null
}

// ── Teamtaken (Command Center) ────────────────────────────────────────────────
// Taken die we aan elkaar toewijzen, los van een lead of project.

export const teamTaakMarker = (taakId: string): string => `ngm-teamtaak:${taakId}`

export function teamTaakOmschrijving(t: { link: string; klant: string | null; notitie: string | null; door: string | null; marker: string }): { tekst: string; markdown: string } {
  const tekst = [
    t.klant ? `Klant: ${t.klant}` : null,
    t.notitie ? `${t.klant ? '\n' : ''}Notitie:\n${t.notitie}` : null,
    `\nToegewezen${t.door ? ` door ${t.door}` : ''} vanuit het Command Center: ${t.link}`,
    `Ref: ${t.marker}`,
  ].filter((x) => x !== null).join('\n')
  const markdown = [
    t.klant ? `**Klant:** ${md(t.klant)}` : null,
    t.notitie ? `\n**Notitie**\n\n${md(t.notitie)}` : null,
    `\n_Toegewezen${t.door ? ` door ${md(t.door)}` : ''} vanuit het [Command Center](${t.link})._`,
    `Ref: ${t.marker}`,
  ].filter((x) => x !== null).join('\n')
  return { tekst, markdown }
}

/** Is de taak af? Afgevinkt in de app, of in ClickUp op een sluit- of klaarstatus gezet (of verwijderd). */
export function taakIsAf(t: { afgerond_op?: string | null; clickup_status_type?: string | null }): boolean {
  return !!t.afgerond_op || t.clickup_status_type === 'closed' || t.clickup_status_type === 'done' || t.clickup_status_type === 'weg'
}

/** "vandaag", "morgen", "over 3 dagen", "2 dagen te laat". */
export function deadlineTekst(deadline: string | null | undefined, vandaag: string): { tekst: string; telaat: boolean; vandaag: boolean } {
  if (!deadline) return { tekst: 'geen deadline', telaat: false, vandaag: false }
  const dagen = Math.round((Date.parse(`${deadline}T12:00:00Z`) - Date.parse(`${vandaag}T12:00:00Z`)) / 86_400_000)
  if (dagen < 0) return { tekst: `${-dagen} ${dagen === -1 ? 'dag' : 'dagen'} te laat`, telaat: true, vandaag: false }
  if (dagen === 0) return { tekst: 'vandaag', telaat: false, vandaag: true }
  if (dagen === 1) return { tekst: 'morgen', telaat: false, vandaag: false }
  return { tekst: `over ${dagen} dagen`, telaat: false, vandaag: false }
}
