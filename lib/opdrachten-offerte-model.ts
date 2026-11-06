/**
 * Projecten ↔ offertes: de regels (pure module, getest in tests/opdrachten-offertes.test.ts).
 *
 *  - Een offerte aangemaakt → een kaart in "Offerte gestuurd": de kaart van het
 *    project, anders de lopende kaart van die klant (Opvolging of Offerte, nog
 *    zonder contract), anders een nieuwe kaart.
 *  - Offerte bevestigd door de klant → de kaart schuift vanzelf naar Offerte
 *    geaccepteerd en er komt een taak: contract opmaken of het project in gang
 *    zetten. Dat beslist het team zelf. Zette iemand de kaart bewust terug,
 *    dan blijft ze daar met de groene label.
 *  - In gang zetten = naar In uitvoering (de offerte volstaat). Contract
 *    aanmaken = het contract hangt aan deze kaart en de kaart schuift vanzelf
 *    naar Contract verstuurd, daarna getekend.
 */

import { kolomVan, type KolomKey } from './opdrachten-kanban'

export type KaartKandidaat = { id: string; status: string; contract_id: string | null; created_at: string | null }

/**
 * Welke lopende kaart van de klant hoort bij een nieuwe offerte? De recentste
 * in Opvolging of Offerte zonder contract. Een kaart met een al geaccepteerde
 * offerte krijgt er geen tweede bij: dat is een nieuw project.
 */
export function kiesKaartVoorOfferte(kaarten: KaartKandidaat[]): string | null {
  const open = kaarten
    .filter((k) => !k.contract_id && (kolomVan(k.status) === 'potentieel' || kolomVan(k.status) === 'offerte'))
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  return open[0]?.id ?? null
}

/** Moet de kaart naar Offerte gestuurd? Enkel vanuit Opvolging; verder op het bord blijft ze staan. */
export const moetNaarOfferte = (status: string): boolean => kolomVan(status) === 'potentieel'

/**
 * Toont de kaart de groene label? Een bevestigde offerte op een kaart die nog
 * in Opvolging of Offerte gestuurd staat (bv. omdat iemand ze bewust terugzette).
 * In de kolom Offerte geaccepteerd zegt de kolom het al.
 */
export function offerteBevestigdLabel(offerteStatus: string | null | undefined, kolom: KolomKey): boolean {
  return offerteStatus === 'geaccepteerd' && (kolom === 'potentieel' || kolom === 'offerte')
}

/** Het blok "contract aanmaken of in gang zetten" in het kaartvenster: bevestigde offerte, nog vóór het contract. */
export function toonVolgendeStapNaOfferte(offerteStatus: string | null | undefined, kolom: KolomKey): boolean {
  return kolom === 'geaccepteerd' || offerteBevestigdLabel(offerteStatus, kolom)
}

/** n werkdagen na een dag (JJJJ-MM-DD), weekends overgeslagen. */
export function werkdagenLater(dag: string, n: number): string {
  const d = new Date(`${dag}T12:00:00Z`)
  let over = n
  while (over > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) over--
  }
  return d.toISOString().slice(0, 10)
}

/** De taak na een bevestigde offerte. */
export function contractTaak(o: { klant: string | null; titel: string; bedrag: number | null; door: string | null; op: string | null }): { omschrijving: string; notitie: string } {
  const klant = o.klant?.trim() || 'klant'
  const bedrag = o.bedrag ? ` (${o.bedrag.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })} excl. btw)` : ''
  const op = o.op ? new Date(o.op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' }) : null
  return {
    omschrijving: `Contract opmaken of in gang zetten – ${klant}`.slice(0, 200),
    notitie: [
      `Offerte "${o.titel}"${bedrag} bevestigd${o.door ? ` door ${o.door}` : ''}${op ? ` op ${op}` : ''}.`,
      'Beslis: volstaat de offerte, zet het project dan in gang op de kaart. Is er een contract nodig, maak het aan vanaf de kaart.',
    ].join('\n'),
  }
}

/** Aan wie de taak in ClickUp gaat: de verantwoordelijke van de kaart, anders wie de offerte maakte, anders Bram. */
export function taakVoorWie(verantwoordelijke: string | null | undefined, offerteDoor: string | null | undefined): { naam?: string; email?: string } {
  if (verantwoordelijke === 'Marco' || verantwoordelijke === 'Bram') return { naam: verantwoordelijke }
  if (offerteDoor && offerteDoor.includes('@')) return { email: offerteDoor }
  return { naam: 'Bram' }
}
