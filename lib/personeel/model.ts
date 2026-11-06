// Personeel — het pure model: soorten medewerkers, statussen, kleuren en
// labels. Geen databank, geen server: scherm, API én tests lezen dezelfde bron.
//
// Twee omgevingen gebruiken dit model:
//  · /admin/personeel — beheer (dossiers, uren, planning, kosten)
//  · /team            — de persoonlijke omgeving van de medewerker zelf
// De werknemersomgeving krijgt NOOIT financiële velden (zie rechten.ts).

export type MedewerkerType = 'werknemer' | 'student' | 'freelancer' | 'onderaannemer' | 'andere'
export const MEDEWERKER_TYPES: { key: MedewerkerType; label: string; kleur: string }[] = [
  { key: 'werknemer', label: 'Werknemer', kleur: 'bg-blue-100 text-blue-800' },
  { key: 'student', label: 'Student', kleur: 'bg-violet-100 text-violet-800' },
  { key: 'freelancer', label: 'Freelancer', kleur: 'bg-amber-100 text-amber-800' },
  { key: 'onderaannemer', label: 'Onderaannemer', kleur: 'bg-orange-100 text-orange-800' },
  { key: 'andere', label: 'Andere', kleur: 'bg-gray-100 text-gray-700' },
]
export const typeLabel = (t: string | null | undefined) => MEDEWERKER_TYPES.find((x) => x.key === t)?.label ?? 'Andere'
export const typeKleur = (t: string | null | undefined) => MEDEWERKER_TYPES.find((x) => x.key === t)?.kleur ?? 'bg-gray-100 text-gray-700'
export const isMedewerkerType = (t: unknown): t is MedewerkerType => MEDEWERKER_TYPES.some((x) => x.key === t)

export type AccountStatus = 'geen' | 'uitgenodigd' | 'actief' | 'geblokkeerd'
export const ACCOUNT_LABEL: Record<AccountStatus, string> = { geen: 'Geen login', uitgenodigd: 'Uitgenodigd', actief: 'Login actief', geblokkeerd: 'Geblokkeerd' }

// ── Werksessies (inklokken) ──────────────────────────────────────────────────
export type SessieStatus = 'actief' | 'ingediend' | 'goedgekeurd' | 'afgekeurd' | 'correctie_gevraagd'
export const SESSIE_STATUS: Record<SessieStatus, { label: string; chip: string; stip: string }> = {
  actief: { label: 'Actief', chip: 'bg-sky-100 text-sky-800 border-sky-200', stip: 'bg-sky-500' },
  ingediend: { label: 'Ingediend', chip: 'bg-amber-100 text-amber-800 border-amber-200', stip: 'bg-amber-500' },
  goedgekeurd: { label: 'Goedgekeurd', chip: 'bg-green-100 text-green-800 border-green-200', stip: 'bg-green-600' },
  afgekeurd: { label: 'Afgekeurd', chip: 'bg-red-100 text-red-700 border-red-200', stip: 'bg-red-500' },
  correctie_gevraagd: { label: 'Correctie gevraagd', chip: 'bg-orange-100 text-orange-800 border-orange-200', stip: 'bg-orange-500' },
}
export const isSessieStatus = (s: unknown): s is SessieStatus => typeof s === 'string' && s in SESSIE_STATUS

// ── Beschikbaarheid ──────────────────────────────────────────────────────────
export type BeschikbaarheidStatus = 'ingediend' | 'goedgekeurd' | 'gedeeltelijk' | 'afgewezen' | 'ingetrokken'
export const BESCHIKBAARHEID_STATUS: Record<BeschikbaarheidStatus, { label: string; chip: string }> = {
  ingediend: { label: 'Ingediend', chip: 'bg-amber-100 text-amber-800 border-amber-200' },
  goedgekeurd: { label: 'Goedgekeurd', chip: 'bg-green-100 text-green-800 border-green-200' },
  gedeeltelijk: { label: 'Gedeeltelijk goedgekeurd', chip: 'bg-teal-100 text-teal-800 border-teal-200' },
  afgewezen: { label: 'Afgewezen', chip: 'bg-red-100 text-red-700 border-red-200' },
  ingetrokken: { label: 'Ingetrokken', chip: 'bg-gray-100 text-gray-500 border-gray-200' },
}

// ── Planning (werkblokken) ───────────────────────────────────────────────────
export type PlanningStatus = 'gepland' | 'geannuleerd'
export type Werkstatus = 'nog_te_starten' | 'bezig' | 'klaar_voor_controle' | 'afgerond' | 'geblokkeerd'
export const WERKSTATUS: Record<Werkstatus, { label: string; chip: string }> = {
  nog_te_starten: { label: 'Nog te starten', chip: 'bg-gray-100 text-gray-700 border-gray-200' },
  bezig: { label: 'Bezig', chip: 'bg-sky-100 text-sky-800 border-sky-200' },
  klaar_voor_controle: { label: 'Klaar voor controle', chip: 'bg-amber-100 text-amber-800 border-amber-200' },
  afgerond: { label: 'Afgerond', chip: 'bg-green-100 text-green-800 border-green-200' },
  geblokkeerd: { label: 'Geblokkeerd', chip: 'bg-red-100 text-red-700 border-red-200' },
}
export const isWerkstatus = (s: unknown): s is Werkstatus => typeof s === 'string' && s in WERKSTATUS
export const PRIORITEITEN = ['laag', 'normaal', 'hoog', 'dringend'] as const
export type Prioriteit = (typeof PRIORITEITEN)[number]

// ── Kalenderkleuren (admin én werknemer, overal dezelfde) ───────────────────
export type KalenderSoort = 'beschikbaar_ingediend' | 'planning_te_bevestigen' | 'planning' | 'planning_afgewezen' | 'sessie_actief' | 'uren_ingediend' | 'uren_goedgekeurd' | 'afwezig'
export const KALENDER_KLEUR: Record<KalenderSoort, { label: string; blok: string; stip: string }> = {
  beschikbaar_ingediend: { label: 'Beschikbaarheid ingediend', blok: 'bg-amber-50 border-amber-300 text-amber-900 border-dashed', stip: 'bg-amber-400' },
  planning_te_bevestigen: { label: 'Ingepland — wacht op bevestiging', blok: 'bg-violet-50 border-violet-400 text-violet-900 border-dashed', stip: 'bg-violet-500' },
  planning: { label: 'Ingepland en bevestigd', blok: 'bg-blue-50 border-blue-400 text-blue-900', stip: 'bg-blue-500' },
  planning_afgewezen: { label: 'Afgewezen', blok: 'bg-red-50 border-red-300 text-red-800 line-through', stip: 'bg-red-400' },
  sessie_actief: { label: 'Werksessie actief', blok: 'bg-sky-100 border-sky-500 text-sky-900', stip: 'bg-sky-500' },
  uren_ingediend: { label: 'Uren ingediend', blok: 'bg-orange-50 border-orange-300 text-orange-900', stip: 'bg-orange-400' },
  uren_goedgekeurd: { label: 'Uren goedgekeurd', blok: 'bg-green-50 border-green-500 text-green-900', stip: 'bg-green-600' },
  afwezig: { label: 'Afwezigheid of verlof', blok: 'bg-gray-100 border-gray-300 text-gray-600', stip: 'bg-gray-400' },
}

// ── Documenten ───────────────────────────────────────────────────────────────
export const DOCUMENT_MAPPEN: { key: string; label: string }[] = [
  { key: 'overeenkomst', label: 'Arbeids- of studentenovereenkomst' },
  { key: 'identiteit', label: 'Identiteitsdocumenten' },
  { key: 'werk', label: 'Werkdocumenten' },
  { key: 'payroll', label: 'Dimona- of payrollgegevens' },
  { key: 'attesten', label: 'Attesten' },
  { key: 'facturen', label: 'Facturen (freelance/onderaanneming)' },
  { key: 'overig', label: 'Overige documenten' },
]
export const mapLabel = (k: string) => DOCUMENT_MAPPEN.find((m) => m.key === k)?.label ?? 'Overige documenten'
export const isDocumentMap = (k: unknown): k is string => DOCUMENT_MAPPEN.some((m) => m.key === k)

// ── Notificaties ─────────────────────────────────────────────────────────────
export type MeldingEvent =
  | 'beschikbaarheid_ingediend' | 'planning_goedgekeurd' | 'planning_gewijzigd' | 'planning_afgewezen' | 'planning_bevestigd'
  | 'werkblok_binnenkort' | 'vergeten_uitklokken' | 'uren_te_controleren' | 'correctie_gevraagd'
  | 'uren_goedgekeurd' | 'uren_afgekeurd' | 'documenten'
export const MELDING_EVENTS: { key: MeldingEvent; label: string; voor: 'admin' | 'medewerker' | 'beide' }[] = [
  { key: 'beschikbaarheid_ingediend', label: 'Medewerker dient beschikbaarheid in', voor: 'admin' },
  { key: 'planning_goedgekeurd', label: 'Planning goedgekeurd', voor: 'medewerker' },
  { key: 'planning_gewijzigd', label: 'Planning gewijzigd', voor: 'medewerker' },
  { key: 'planning_afgewezen', label: 'Planning/beschikbaarheid afgewezen', voor: 'medewerker' },
  { key: 'planning_bevestigd', label: 'Medewerker bevestigt of weigert een inplanning', voor: 'admin' },
  { key: 'werkblok_binnenkort', label: 'Werkblok begint binnenkort', voor: 'medewerker' },
  { key: 'vergeten_uitklokken', label: 'Vergeten uit te klokken', voor: 'beide' },
  { key: 'uren_te_controleren', label: 'Urenregistratie klaar voor controle', voor: 'admin' },
  { key: 'correctie_gevraagd', label: 'Admin vraagt een correctie', voor: 'medewerker' },
  { key: 'uren_goedgekeurd', label: 'Uren goedgekeurd', voor: 'medewerker' },
  { key: 'uren_afgekeurd', label: 'Uren afgekeurd', voor: 'medewerker' },
  { key: 'documenten', label: 'Verplichte documenten ontbreken of vervallen', voor: 'admin' },
]
export type MeldingInstellingen = Record<MeldingEvent, { inapp: boolean; email: boolean }>
export function standaardMeldingInstellingen(): MeldingInstellingen {
  const uit = {} as MeldingInstellingen
  for (const e of MELDING_EVENTS) uit[e.key] = { inapp: true, email: e.voor !== 'admin' }
  return uit
}
export function normaliseerMeldingInstellingen(ruw: unknown): MeldingInstellingen {
  const std = standaardMeldingInstellingen()
  if (!ruw || typeof ruw !== 'object') return std
  for (const e of MELDING_EVENTS) {
    const r = (ruw as Record<string, unknown>)[e.key] as { inapp?: unknown; email?: unknown } | undefined
    if (r && typeof r === 'object') std[e.key] = { inapp: r.inapp !== false, email: r.email === true }
  }
  return std
}

/** Na zoveel uur zonder uitklokken geldt een sessie als "vergeten". */
export const VERGETEN_NA_UUR = 10
