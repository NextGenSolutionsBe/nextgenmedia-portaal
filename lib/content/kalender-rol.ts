// Rol in de contentplanning per klant — pure regels (getest in tests/kalender-rol.test.ts).
//
// Eén instelling per klant (clients.kalender_rol). Leeg = "Standaard": precies de
// werking van vóór de rollen (bekijken + goedkeuren of een aanpassing vragen voor
// wat NextGenMedia ter goedkeuring stuurt, plus het oude kalenderbeheer als dat
// aan stond). Bestaande klanten merken dus niets tot NextGenMedia een rol kiest.
//
// De rol is het plafond voor ALLE gebruikers van die klant. Subaccounts houden
// daarbovenop hun eigen portaalrechten (social_media.view / feedback /
// approve_scripts / edit): wat een subaccount niet mag, mag het ook in een
// ruimere rol niet. De eigenaar heeft alle portaalrechten, dus voor hem geldt de rol.
//
// Deze module beslist; de interface (knoppen) en de portaalroutes (servercontrole)
// lezen allebei hieruit, zodat ze nooit uit elkaar lopen.

import { magKalenderBeheren, klantOvergangen as oudeOvergangen, type BeheerConfig, type Status } from './kalender-beheer'

export const KALENDER_ROLLEN = ['geen', 'bekijken', 'feedback', 'meewerken', 'beheren'] as const
export type KalenderRol = (typeof KALENDER_ROLLEN)[number]
export type RolOfStandaard = KalenderRol | 'standaard'
export const isKalenderRol = (v: unknown): v is KalenderRol => typeof v === 'string' && (KALENDER_ROLLEN as readonly string[]).includes(v)

/** Labels en uitleg. `uitleg` is voor NextGenMedia (instellingen), `klant` voor het portaal. */
export const ROL_INFO: Record<RolOfStandaard, { label: string; uitleg: string; klant: string }> = {
  standaard: {
    label: 'Standaard (zoals voorheen)',
    uitleg: 'Bekijken, en content die NextGenMedia ter goedkeuring stuurt goedkeuren of een aanpassing vragen. Zo werkte het portaal tot nu toe.',
    klant: '',
  },
  geen: {
    label: 'Geen toegang',
    uitleg: 'De klant ziet de contentkalender niet en kan hem niet openen.',
    klant: '',
  },
  bekijken: {
    label: 'Alleen bekijken',
    uitleg: 'Ziet alle items en hun inhoud, maar kan niets aanpassen, toevoegen of goedkeuren.',
    klant: 'Je kan de planning bekijken. Aanpassen of goedkeuren doet NextGenMedia.',
  },
  feedback: {
    label: 'Feedback geven',
    uitleg: 'Bekijkt alles en plaatst opmerkingen bij items. Kan geen content, datums of statussen wijzigen.',
    klant: 'Je kan de planning bekijken en bij elk item een opmerking plaatsen.',
  },
  meewerken: {
    label: 'Meewerken',
    uitleg: 'Plaatst opmerkingen, maakt items aan en past tekst, caption, kanalen en voorgestelde datum aan zolang een item niet goedgekeurd is. Legt items ter goedkeuring voor, maar keurt niet goed en plant niet in.',
    klant: 'Je kan items aanmaken en aanpassen tot ze goedgekeurd zijn, en ze ter goedkeuring voorleggen. Goedkeuren en inplannen doet NextGenMedia.',
  },
  beheren: {
    label: 'Contentplanning beheren',
    uitleg: 'Beheert de kalender zelf: items aanmaken, aanpassen en verwijderen, publicatiedatums kiezen, goedkeuren of een aanpassing vragen, inplannen en als gepubliceerd markeren. Geeft geen toegang tot andere klantgegevens of beheer buiten de kalender.',
    klant: 'Je beheert de planning zelf: aanmaken, aanpassen, goedkeuren, inplannen en als gepubliceerd markeren.',
  },
}

export const ROL_VOLGORDE: RolOfStandaard[] = ['standaard', 'geen', 'bekijken', 'feedback', 'meewerken', 'beheren']

export type Verwijderen = 'nooit' | 'eigen_concepten' | 'altijd'

/** Wat één gebruiker van een klant in de kalender mag. Serialiseerbaar (gaat mee naar de interface). */
export type KalenderRechten = {
  rol: RolOfStandaard
  /** De kalender openen en items bekijken. */
  bekijken: boolean
  /** Een opmerking plaatsen bij een item (zonder statuswijziging). */
  opmerkingen: boolean
  aanmaken: boolean
  /** Statussen waarin de klant de inhoud (tekst, caption, kanalen, datum, …) mag aanpassen. */
  bewerkbaar: Status[]
  verwijderen: Verwijderen
  /** Goedkeuren (→ approved) via de review, vanuit deze statussen. */
  goedkeuren: Status[]
  /** Aanpassing vragen (→ changes_requested, met reden) via de review, vanuit deze statussen. */
  afkeuren: Status[]
  /** Planningsknoppen: van status → naar statussen. */
  overgangen: Partial<Record<Status, Status[]>>
  /** Statussen die bij het aanmaken gekozen mogen worden. */
  startStatussen: Status[]
}

/** Individuele portaalrechten op social_media. De eigenaar heeft ze allemaal. */
export type Gebruiker = { isOwner: boolean; perms: { view?: boolean; edit?: boolean; feedback?: boolean; approve_scripts?: boolean } }

const ALLE: Status[] = ['draft', 'ready_for_review', 'approved', 'changes_requested', 'scheduled', 'published']
/** Statussen waarin een item op een beslissing van de klant wacht. */
const BEOORDEELBAAR: Status[] = ['ready_for_review', 'changes_requested']
/** Zolang een item niet goedgekeurd is, mag een meewerkende klant de inhoud aanpassen. */
const VOOR_GOEDKEURING: Status[] = ['draft', 'ready_for_review', 'changes_requested']

const MEEWERKEN: Partial<Record<Status, Status[]>> = {
  draft: ['ready_for_review'],
  changes_requested: ['ready_for_review'],
}
const BEHEREN: Record<Status, Status[]> = {
  draft: ['ready_for_review', 'approved', 'scheduled'],
  ready_for_review: ['draft'],
  changes_requested: ['ready_for_review', 'draft'],
  approved: ['scheduled', 'published', 'draft'],
  scheduled: ['published', 'approved'],
  published: ['scheduled'],
}

const NIETS: Omit<KalenderRechten, 'rol'> = {
  bekijken: false, opmerkingen: false, aanmaken: false, bewerkbaar: [], verwijderen: 'nooit',
  goedkeuren: [], afkeuren: [], overgangen: {}, startStatussen: [],
}

export function kalenderRechten(rol: KalenderRol | null | undefined, oudBeheer: BeheerConfig | null | undefined, g: Gebruiker): KalenderRechten {
  const r: RolOfStandaard = isKalenderRol(rol) ? rol : 'standaard'
  const p = g.isOwner ? { view: true, edit: true, feedback: true, approve_scripts: true } : g.perms
  if (!p.view || r === 'geen') return { rol: r, ...NIETS }

  // Goedkeuren vraagt approve_scripts, een aanpassing vragen vraagt feedback,
  // al de rest (voorleggen, inplannen, publiceren, terug naar concept) vraagt edit.
  const magNaar = (naar: Status) => naar === 'approved' ? !!p.approve_scripts : naar === 'changes_requested' ? !!p.feedback : !!p.edit
  const filter = (m: Partial<Record<Status, Status[]>>) => {
    const uit: Partial<Record<Status, Status[]>> = {}
    for (const [van, naar] of Object.entries(m) as [Status, Status[]][]) { const ok = naar.filter(magNaar); if (ok.length) uit[van] = ok }
    return uit
  }
  const basis: KalenderRechten = { rol: r, ...NIETS, bekijken: true }

  switch (r) {
    case 'bekijken':
      return basis
    case 'feedback':
      return { ...basis, opmerkingen: !!p.feedback }
    case 'meewerken':
      return {
        ...basis, opmerkingen: !!p.feedback,
        aanmaken: !!p.edit, bewerkbaar: p.edit ? VOOR_GOEDKEURING : [], verwijderen: p.edit ? 'eigen_concepten' : 'nooit',
        overgangen: filter(MEEWERKEN), startStatussen: p.edit ? ['draft', 'ready_for_review'] : [],
      }
    case 'beheren': {
      const overgangen = filter(BEHEREN)
      return {
        ...basis, opmerkingen: !!p.feedback,
        aanmaken: !!p.edit, bewerkbaar: p.edit ? ALLE : [], verwijderen: p.edit ? 'altijd' : 'nooit',
        goedkeuren: p.approve_scripts ? BEOORDEELBAAR : [], afkeuren: p.feedback ? BEOORDEELBAAR : [],
        overgangen, startStatussen: p.edit ? ['draft', ...(overgangen.draft ?? []).filter((s) => s !== 'approved')] : [],
      }
    }
    default: {
      // Standaard = de werking van vóór de rollen, ongewijzigd.
      const standaard: KalenderRechten = { ...basis, goedkeuren: p.approve_scripts ? BEOORDEELBAAR : [], afkeuren: p.feedback ? BEOORDEELBAAR : [] }
      if (!magKalenderBeheren(oudBeheer, { isOwner: g.isOwner, kanEdit: !!p.edit })) return standaard
      const overgangen: Partial<Record<Status, Status[]>> = {}
      for (const s of ALLE) { const n = oudeOvergangen(s); if (n.length) overgangen[s] = n }
      return { ...standaard, aanmaken: true, bewerkbaar: ALLE, verwijderen: 'altijd', overgangen, startStatussen: ['draft', 'scheduled'] }
    }
  }
}

export const magBewerken = (r: KalenderRechten, item: { status: string }) => r.bewerkbaar.includes(item.status as Status)
export const magVerwijderen = (r: KalenderRechten, item: { status: string; klant_aangemaakt_op?: string | null }) =>
  r.verwijderen === 'altijd' || (r.verwijderen === 'eigen_concepten' && !!item.klant_aangemaakt_op && item.status === 'draft')
export const statusOvergangen = (r: KalenderRechten, van: string): Status[] => r.overgangen[van as Status] ?? []
export const magOvergang = (r: KalenderRechten, van: string, naar: string) => statusOvergangen(r, van).includes(naar as Status)
export const magBeoordelen = (r: KalenderRechten, van: string, besluit: 'approved' | 'changes_requested') =>
  (besluit === 'approved' ? r.goedkeuren : r.afkeuren).includes(van as Status)
/** Kan de klant ergens goedkeuren? (aftelklok en "wacht op jouw goedkeuring" enkel dan tonen) */
export const kanGoedkeuren = (r: KalenderRechten) => r.goedkeuren.length > 0

/** Knoptekst voor een planningsovergang in het portaal. */
export function overgangLabel(van: string, naar: Status): string {
  if (naar === 'ready_for_review') return 'Ter goedkeuring voorleggen'
  if (naar === 'published') return 'Gepubliceerd markeren'
  if (naar === 'scheduled') return van === 'published' ? 'Terug naar ingepland' : 'Inplannen'
  if (naar === 'approved') return van === 'draft' ? 'Goedkeuren' : 'Uit planning halen'
  if (naar === 'draft') return 'Terug naar concept'
  return naar
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeesClient = { from: (t: string) => any }
/**
 * Rol van één klant, altijd op zijn eigen id; null = Standaard (ook vóór de
 * migratie of bij een onbekende waarde — nooit meer rechten dan voorheen).
 */
export async function leesKalenderRol(db: LeesClient, clientId: string): Promise<KalenderRol | null> {
  const { data, error } = await db.from('clients').select('kalender_rol').eq('id', clientId).maybeSingle()
  if (error) return null
  const rol = (data as { kalender_rol?: unknown } | null)?.kalender_rol
  return isKalenderRol(rol) ? rol : null
}

/** Opmerking bij een item: 1 tot 2000 tekens. Gooit een leesbare fout. */
export function opmerkingTekst(invoer: unknown): string {
  const t = String(invoer ?? '').trim()
  if (!t) throw new Error('Schrijf eerst een opmerking.')
  if (t.length > 2000) throw new Error('Een opmerking is maximaal 2000 tekens.')
  return t
}
