import type { Veld, FormulierInstellingen, FormulierStatus, LinkStatus, InzendingStatus } from '@/lib/formulieren/model'

export type Formulier = {
  id: string
  titel: string
  beschrijving: string | null
  dienst: string
  doel: string | null
  velden: Veld[]
  instellingen: FormulierInstellingen
  status: FormulierStatus
  created_at: string
  updated_at: string
  gearchiveerd_op: string | null
}

/** Wat in de builder bewerkbaar is (en dus "vuil" kan zijn). */
export type Concept = Pick<Formulier, 'titel' | 'beschrijving' | 'dienst' | 'doel' | 'velden' | 'instellingen' | 'status'>

export type Link = {
  id: string
  client_id: string | null
  token: string
  label: string | null
  verloopt_op: string | null
  ingetrokken_op: string | null
  eenmalig: boolean
  created_at: string
  klant_naam: string | null
  inzendingen: number
  status?: LinkStatus
}

export type Inzending = {
  id: string
  link_id: string | null
  client_id: string | null
  antwoorden: Record<string, unknown>
  velden_snapshot: Veld[] | null
  naam: string | null
  email: string | null
  status: InzendingStatus
  admin_notitie: string | null
  created_at: string
  klant_naam: string | null
  link_label: string | null
}

export const naarConcept = (f: Formulier): Concept => ({
  titel: f.titel, beschrijving: f.beschrijving, dienst: f.dienst, doel: f.doel, velden: f.velden, instellingen: f.instellingen, status: f.status,
})
