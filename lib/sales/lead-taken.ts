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
