import 'server-only'
import type { OpleveringVolledig } from '@/lib/opleveringen-server'
import { beschikbaarheid } from '@/lib/opleveringen'

/**
 * Wat de klant van een oplevering te zien krijgt: geen opslagpaden, enkel
 * namen, groottes, miniaturen en of de bestanden nog beschikbaar zijn.
 * Kijken en downloaden gaat via een link die pas bij de klik gemaakt wordt.
 */
export function voorKlant(o: OpleveringVolledig, nu: Date = new Date()) {
  return {
    id: o.id, titel: o.titel, omschrijving: o.omschrijving, status: o.status, revisies: o.revisies,
    actieve_versie_id: o.actieve_versie_id, updated_at: o.updated_at,
    versies: o.versies.map((v) => ({
      id: v.id, nummer: v.nummer, label: v.label, is_finaal: v.is_finaal, bericht: v.bericht, gepubliceerd_op: v.gepubliceerd_op,
      beschikbaarheid: beschikbaarheid(v, nu),
      bestanden: v.bestanden.map((b) => ({ id: b.id, naam: b.naam, mimetype: b.mimetype, grootte: b.grootte, duur: b.duur, breedte: b.breedte, hoogte: b.hoogte, poster_url: b.poster_url })),
    })),
    feedback: o.feedback.map((f) => ({ id: f.id, versie_id: f.versie_id, soort: f.soort, ronde: f.ronde, tekst: f.tekst, punten: f.punten, door_naam: f.door_naam, created_at: f.created_at })),
  }
}
export type KlantOplevering = ReturnType<typeof voorKlant>
