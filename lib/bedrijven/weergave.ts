import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { leesVoorkeurRij } from '@/lib/instellingen/laden'
import { isBedrijfFilter, BEDRIJF_COOKIE, type BedrijfFilter } from './model'

/**
 * De eigen weergave Alles / Media / Solutions. Eerst de cookie (snel, geen
 * databank), anders de keuze in de voorkeuren (volgt je naar een ander
 * toestel), anders Alles.
 */
export const leesBedrijfFilter = cache(async (userId?: string | null): Promise<BedrijfFilter> => {
  try {
    const c = cookies().get(BEDRIJF_COOKIE)?.value
    if (isBedrijfFilter(c)) return c
  } catch { /* buiten een verzoek */ }
  if (userId) {
    const v = (await leesVoorkeurRij(userId)).bedrijfFilter
    if (isBedrijfFilter(v)) return v
  }
  return 'alles'
})
