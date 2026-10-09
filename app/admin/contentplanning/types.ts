import type { ActiviteitRitme, CpInstellingen, Link, Reeks, Ritme } from '@/lib/contentplanning/model'

export type Taak = {
  id: string; cyclus_id: string | null; client_id: string | null; onderdeel: string; titel: string; reeks: Reeks | null
  werkdatum: string | null; deadline: string | null; startmoment: string | null; verantwoordelijke: string | null
  status: string; sjabloon_sleutel: string | null; volgorde: number; created_by: string | null; updated_at: string
}
export type Klant = { id: string; company_name: string; batch_id: string | null; contact_name: string | null; email: string | null }
export type Contactpersoon = { naam: string; rol: string | null; email: string | null; telefoon: string | null }
export type CpKlant = {
  client_id: string; actief: boolean; ritme: Ritme | null; verantwoordelijke: string | null; goedkeuring_werkdagen: number | null
  activiteiten: Record<string, ActiviteitRitme>; contactpersonen: Contactpersoon[]; links: Link[]; afspraken: string | null
}
export type Cyclus = { id: string; client_id: string; maand: string; status: 'actief' | 'gepauzeerd' | 'gearchiveerd'; instellingen: { ritme?: Ritme | null; activiteiten?: Record<string, ActiviteitRitme>; batch_id?: string | null } }
export type Notitie = {
  id: string; soort: 'afspraak' | 'cyclus' | 'herinnering'; client_id: string | null; taak_id: string | null; cyclus_id: string | null; batch_id: string | null
  reeks: Reeks | null; maand: string | null; tekst: string; herinner_op: string | null; afgevinkt_op: string | null; vastgepind: boolean; auteur: string | null; created_at: string; updated_at: string
}
export type Batch = { id: string; name: string; color: string; start_month: number; sort_order: number }
export type Check = { routine_key: string; datum: string; door: string | null }
export type CpData = {
  instellingen: CpInstellingen; batches: Batch[]; klanten: Klant[]; cpKlanten: CpKlant[]; cycli: Cyclus[]; taken: Taak[]
  notities: Notitie[]; checks: Check[]; faseAanpassingen: Record<string, string[]>; mensen: string[]
  kan: { aanpassen: boolean; beheren: boolean }; ik: string | null
  /** Klantenbatches: ✓ (actief) / ✗ per klant, maand en reeks; geen rij = nog niet beslist. */
  bord: BordCel[]
  /** Klanten met de dienst social media (de rijen van het bord). */
  socialKlanten: string[]
}
export type BordCel = { client_id: string; maand: string; reeks: Reeks; actief: boolean; door: string | null; updated_at: string }
export type Weergave = 'dag' | 'batches' | 'reeksen' | 'week' | 'maand' | 'bord'
export type Filters = { klant: string; verantwoordelijke: string; reeks: string; batch: string; nogOpen: boolean; zoek: string }
export const LEGE_FILTERS: Filters = { klant: '', verantwoordelijke: '', reeks: '', batch: '', nogOpen: false, zoek: '' }

/** Eén manier om iets te bewaren; geeft het antwoord terug of gooit met een leesbare fout. */
export type Doe = (actie: string, body?: Record<string, unknown>, opts?: { stil?: boolean; melding?: string }) => Promise<Record<string, unknown> | null>
export const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
export const maandNaam = (ym: string) => `${MAANDEN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
export const datumNl = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—')
export const datumLang = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
export const vandaagBE = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
