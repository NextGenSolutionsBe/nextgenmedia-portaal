'use client'

import { useEffect } from 'react'

/**
 * Register van niet-opgeslagen wijzigingen op de huidige pagina. Formulieren
 * melden zich aan met een vlag en (als dat kan) een opslaanfunctie; de
 * vorige/volgende-navigatie vraagt dit register vóór ze van contract wisselt.
 * Puur in het geheugen van de pagina — niets wordt bewaard.
 */

export type Inzending = { naam: string; vuil: boolean; opslaan?: () => Promise<boolean> }

const register = new Map<string, Inzending>()
const luisteraars = new Set<() => void>()
const verwittig = () => { for (const l of luisteraars) l() }

export function meldVuil(id: string, inzending: Inzending | null): void {
  if (inzending) register.set(id, inzending); else register.delete(id)
  verwittig()
}

/** Alle onderdelen met niet-opgeslagen wijzigingen. */
export function vuileInzendingen(): Inzending[] { return [...register.values()].filter((i) => i.vuil) }
export const heeftVuil = (): boolean => vuileInzendingen().length > 0

export function luisterNaarVuil(cb: () => void): () => void { luisteraars.add(cb); return () => { luisteraars.delete(cb) } }

/** Alles opslaan wat opgeslagen kan worden; false zodra één opslag mislukt of onmogelijk is. */
export async function slaAllesOp(): Promise<boolean> {
  for (const i of vuileInzendingen()) {
    if (!i.opslaan) return false
    if (!(await i.opslaan())) return false
  }
  return true
}

/** Hook voor formulieren: meld of er iets openstaat en hoe het bewaard wordt. */
export function useVuilMelder(id: string, naam: string, vuil: boolean, opslaan?: () => Promise<boolean>): void {
  useEffect(() => { meldVuil(id, { naam, vuil, opslaan }) }, [id, naam, vuil, opslaan])
  useEffect(() => () => { meldVuil(id, null) }, [id])
}
