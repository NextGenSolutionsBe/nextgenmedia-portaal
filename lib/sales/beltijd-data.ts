import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BeltijdSessie } from '@/lib/sales/beltijd'

/**
 * Beltijdsessies (tabel sales_beltijd) — het databankwerk. Rekenen gebeurt in
 * lib/sales/beltijd.ts. Vóór de migratie van 22 sep 2026 bestaat de tabel niet:
 * lezen geeft dan null (het scherm toont "nog niet actief"), schrijven meldt
 * dat de migratie nodig is.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any>

export const BELTIJD_KOLOMMEN = 'id, medewerker_id, medewerker_email, start_op, einde_op, duur_seconden, notitie, verwijderd_op, created_at'
export const BELTIJD_MIGRATIE_NODIG = 'Beltijd loggen werkt zodra de databankmigratie (22 sep 2026) gedraaid is.'

export function isBeltijdTabelFout(msg: string | null | undefined): boolean {
  return /sales_beltijd|does not exist|schema cache|relation|PGRST205|PGRST204/i.test(msg ?? '')
}

/** Sessies die starten in [van, tot), optioneel voor één medewerker. null = tabel ontbreekt. */
export async function laadBeltijd(admin: Admin, f: { van: Date; tot: Date; medewerkerId?: string }): Promise<BeltijdSessie[] | null> {
  const uit: BeltijdSessie[] = []
  const PAGINA = 1000
  for (let van = 0; van < 20_000; van += PAGINA) {
    let q = admin.from('sales_beltijd').select(BELTIJD_KOLOMMEN)
      .is('verwijderd_op', null)
      .gte('start_op', f.van.toISOString()).lt('start_op', f.tot.toISOString())
      .order('start_op', { ascending: false }).order('id', { ascending: true })
      .range(van, van + PAGINA - 1)
    if (f.medewerkerId) q = q.eq('medewerker_id', f.medewerkerId)
    const { data, error } = await q
    if (error) {
      if (isBeltijdTabelFout(error.message)) return null
      throw new Error(error.message)
    }
    const stuk = (data ?? []) as BeltijdSessie[]
    uit.push(...stuk)
    if (stuk.length < PAGINA) break
  }
  return uit
}

/** De lopende sessie van een medewerker (ongeacht wanneer ze startte). undefined = tabel ontbreekt. */
export async function laadLopendeSessie(admin: Admin, medewerkerId: string): Promise<BeltijdSessie | null | undefined> {
  const { data, error } = await admin.from('sales_beltijd').select(BELTIJD_KOLOMMEN)
    .eq('medewerker_id', medewerkerId).is('einde_op', null).is('verwijderd_op', null)
    .order('start_op', { ascending: false }).limit(1).maybeSingle()
  if (error) {
    if (isBeltijdTabelFout(error.message)) return undefined
    throw new Error(error.message)
  }
  return (data as BeltijdSessie | null) ?? null
}

/** Alle lopende sessies (voor "belt nu" op de accountkaarten). */
export async function laadAlleLopende(admin: Admin): Promise<BeltijdSessie[]> {
  const { data, error } = await admin.from('sales_beltijd').select(BELTIJD_KOLOMMEN)
    .is('einde_op', null).is('verwijderd_op', null).limit(500)
  if (error) return []
  return (data ?? []) as BeltijdSessie[]
}
