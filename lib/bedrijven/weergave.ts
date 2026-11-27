import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { leesVoorkeurRij } from '@/lib/instellingen/laden'
import { isBedrijfFilter, BEDRIJF_COOKIE, type BedrijfFilter } from './model'
import { getStaffRow, getUserRole } from '@/lib/supabase/server'
import { vastBedrijf } from '@/lib/team/rollen'

/**
 * Is deze werknemer beperkt tot één bedrijf (fase 4)? Dan is dat altijd de
 * weergave, wat de cookie of de voorkeur ook zegt. Hoofdbeheerders nooit.
 */
export const vastBedrijfVan = cache(async (userId?: string | null): Promise<BedrijfFilter | null> => {
  if (!userId) return null
  if ((await getUserRole(userId)) === 'admin') return null
  return vastBedrijf((await getStaffRow(userId))?.bedrijven ?? null)
})

/**
 * De eigen weergave Alles / Media / Solutions. Eerst de cookie (snel, geen
 * databank), anders de keuze in de voorkeuren (volgt je naar een ander
 * toestel), anders Alles.
 */
export const leesBedrijfFilter = cache(async (userId?: string | null): Promise<BedrijfFilter> => {
  const vast = await vastBedrijfVan(userId)
  if (vast) return vast
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
