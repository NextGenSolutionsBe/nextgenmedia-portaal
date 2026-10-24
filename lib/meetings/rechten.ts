import 'server-only'
import { magIk, type IngelogdePersoon } from '@/lib/instellingen/laden'

/**
 * Rechten in de Meeting Inplanner. De module is gedeeld: wie "Meeting
 * Inplanner" heeft, beheert alle meetings; wie enkel "Verkoop" heeft (setters),
 * werkt met de verkoopagenda en de klantboekingen — net als vroeger in
 * Appointment setting. Zo verandert niemands toegang door de verhuis.
 */
export type PlannerRechten = {
  persoon: IngelogdePersoon | null
  meetings: { bekijken: boolean; toevoegen: boolean; aanpassen: boolean }
  verkoop: { bekijken: boolean; toevoegen: boolean; aanpassen: boolean }
}

export async function plannerRechten(): Promise<PlannerRechten> {
  const [mb, mt, ma, vb, vt, va] = await Promise.all([
    magIk('meetings', 'bekijken'), magIk('meetings', 'toevoegen'), magIk('meetings', 'aanpassen'),
    magIk('sales', 'bekijken'), magIk('sales', 'toevoegen'), magIk('sales', 'aanpassen'),
  ])
  return {
    persoon: mb ?? mt ?? ma ?? vb ?? vt ?? va ?? null,
    meetings: { bekijken: !!(mb || mt || ma), toevoegen: !!mt, aanpassen: !!ma },
    verkoop: { bekijken: !!(vb || vt || va), toevoegen: !!vt, aanpassen: !!va },
  }
}

/** Mag deze gebruiker deze meeting zien of aanpassen? Klantboekingen horen ook bij Verkoop. */
export function magMeeting(r: PlannerRechten, m: { bron?: string | null }, actie: 'bekijken' | 'aanpassen'): boolean {
  if (r.meetings[actie]) return true
  return m.bron === 'klantboeking' && r.verkoop[actie]
}
