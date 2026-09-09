import 'server-only'
import { cache } from 'react'
import { createAdminSupabaseClient, getSessionUser, getUserRole } from '@/lib/supabase/server'
import type { Bedrijf } from '@/lib/kantoor/model'

/**
 * Wie ben je in het Kantoor, en namens welk bedrijf handel je?
 *
 * Twee soorten gebruikers:
 *  · ons eigen team (admin) — mag alles zien en handelt namens een van onze
 *    eigen bedrijven;
 *  · een partner — is lid van één of meer bedrijven en ziet uitsluitend de
 *    opdrachten waar dat bedrijf partij in is.
 *
 * Eén account kan bij MEERDERE bedrijven horen: info@nextgenmedia.be hoort bij
 * NextGenMedia én NextGenSolutions en switcht bovenaan. Daarom geeft dit een
 * lijst terug, niet één bedrijf.
 *
 * Net als de rest van het platform loopt dit via de service-role: RLS is de
 * tweede laag, deze resolver is de poort (zie CLAUDE.md).
 */

export type KantoorSessie = {
  userId: string
  email: string | null
  /** Ons eigen team: ziet alles, ook de marges van andere bedrijven. */
  isAdmin: boolean
  /** Bedrijven waarvoor deze gebruiker mag handelen. */
  bedrijven: Bedrijf[]
}

export const resolveKantoorSessie = cache(async (): Promise<KantoorSessie | null> => {
  const user = await getSessionUser()
  if (!user) return null

  const admin = createAdminSupabaseClient()
  const isAdmin = (await getUserRole(user.id)) === 'admin'

  try {
    if (isAdmin) {
      // Ons team handelt namens de eigen bedrijven.
      const { data } = await admin.from('kantoor_bedrijven')
        .select('id, naam, is_eigen, email, actief')
        .eq('is_eigen', true).eq('actief', true).order('naam')
      return { userId: user.id, email: user.email ?? null, isAdmin: true, bedrijven: (data ?? []) as Bedrijf[] }
    }

    // Partner: lidmaatschappen ophalen. Koppelen gebeurt op auth_user_id, en
    // anders op e-mailadres — dan is de uitnodiging aanvaard maar de rij nog
    // niet gekoppeld. Die koppeling zetten we hieronder meteen recht.
    const { data: leden } = await admin.from('kantoor_leden')
      .select('id, bedrijf_id, auth_user_id, actief, kantoor_bedrijven ( id, naam, is_eigen, email, actief )')
      .or(`auth_user_id.eq.${user.id},email.eq.${user.email ?? ''}`)
      .eq('actief', true)

    type Rij = {
      id: string; bedrijf_id: string; auth_user_id: string | null
      kantoor_bedrijven: Bedrijf | null
    }
    const rijen = (leden ?? []) as unknown as Rij[]
    if (rijen.length === 0) return null

    // Eenmalig het account aan de uitnodiging koppelen, zodat een latere
    // e-mailwijziging de toegang niet stilletjes afbreekt.
    for (const r of rijen) {
      if (!r.auth_user_id) {
        await admin.from('kantoor_leden').update({ auth_user_id: user.id }).eq('id', r.id)
      }
    }

    const bedrijven = rijen
      .map((r) => r.kantoor_bedrijven)
      .filter((b): b is Bedrijf => !!b && b.actief !== false)

    if (bedrijven.length === 0) return null
    return { userId: user.id, email: user.email ?? null, isAdmin: false, bedrijven }
  } catch {
    // Tabellen nog niet gemigreerd → geen kantoortoegang, geen stukke app.
    return null
  }
})

/**
 * Mag deze sessie namens `bedrijfId` handelen?
 *
 * Elke schrijfactie loopt hierlangs. Zonder deze controle zou een partner met
 * een aangepast verzoek een opdracht kunnen aanmaken namens een bedrijf waar
 * hij niets mee te maken heeft.
 */
export function magHandelenAls(sessie: KantoorSessie | null, bedrijfId: string): boolean {
  if (!sessie) return false
  return sessie.bedrijven.some((b) => b.id === bedrijfId)
}

/** Het actieve bedrijf: uit de keuze, anders het eerste waar je bij hoort. */
export function actiefBedrijf(sessie: KantoorSessie, gekozenId?: string | null): Bedrijf | null {
  if (gekozenId) {
    const gekozen = sessie.bedrijven.find((b) => b.id === gekozenId)
    if (gekozen) return gekozen
  }
  return sessie.bedrijven[0] ?? null
}
