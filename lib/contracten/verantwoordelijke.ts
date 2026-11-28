// Verantwoordelijke van een contract — pure regels (client-safe, getest in tests/te-tekenen.test.ts).
//
// Elk contract hangt aan een projectkaart; de verantwoordelijke van die kaart is
// de verantwoordelijke van het contract (één plek, nooit twee). Die persoon volgt
// het contract op en tekent namens ons tegen. Gezamenlijke lead of nog niemand:
// dan staat het bij Marco én Bram, tot iemand kiest.

import { PROJECT_VERANTWOORDELIJKEN, projectVerantwoordelijke, type ProjectVerantwoordelijke } from '@/lib/opdrachten-kanban'

export const CONTRACT_VERANTWOORDELIJKEN = PROJECT_VERANTWOORDELIJKEN
export type ContractVerantwoordelijke = ProjectVerantwoordelijke
export const contractVerantwoordelijke = projectVerantwoordelijke

export const TEGENTEKENAARS = ['Marco', 'Bram', 'Chiara'] as const
export type Tegentekenaar = (typeof TEGENTEKENAARS)[number]
export const isTegentekenaar = (v: unknown): v is Tegentekenaar => TEGENTEKENAARS.includes(v as Tegentekenaar)

/** Wie moet dit contract namens ons tekenen? Gezamenlijke lead of nog niemand = Marco en Bram. */
export function wieTekentTegen(v: unknown): Tegentekenaar[] {
  const p = projectVerantwoordelijke(v)
  if (isTegentekenaar(p)) return [p]
  return ['Marco', 'Bram']
}
