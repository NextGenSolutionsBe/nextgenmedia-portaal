// Interne notities op een opdrachtkaart (server). Twee soorten: wat iemand van
// het team schrijft, en korte systeemregels bij een verplaatsing ("Naar
// Offerte gestuurd (per mail)"). Samen vormen ze de tijdlijn van de kaart.
// Nooit zichtbaar voor de klant.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type Notitie = {
  id: string
  opdracht_id: string
  tekst: string
  soort: 'notitie' | 'systeem'
  auteur_user_id: string | null
  auteur_email: string | null
  auteur_naam: string | null
  created_at: string
}

export type Auteur = { id: string | null; email: string | null; naam: string | null }

const MIST = /opdracht_notities|does not exist|schema cache/i

/** Notitie toevoegen. Lukt het niet (bv. vóór de migratie), dan geeft dit null en gaat de rest gewoon door. */
export async function voegNotitieToe(admin: Admin, opdrachtId: string, tekst: string, soort: Notitie['soort'], auteur: Auteur | null): Promise<Notitie | null> {
  const t = tekst.trim().slice(0, 4000)
  if (!t) return null
  const { data, error } = await admin.from('opdracht_notities').insert({
    opdracht_id: opdrachtId, tekst: t, soort,
    auteur_user_id: auteur?.id ?? null, auteur_email: auteur?.email ?? null, auteur_naam: auteur?.naam ?? null,
  }).select('*').single()
  if (error) { if (!MIST.test(error.message)) console.warn('[opdracht_notities] toevoegen mislukt:', error.message); return null }
  return data as Notitie
}

/** Alle notities van één kaart, nieuwste eerst. */
export async function notitiesVan(admin: Admin, opdrachtId: string): Promise<Notitie[]> {
  const { data, error } = await admin.from('opdracht_notities').select('*').eq('opdracht_id', opdrachtId).order('created_at', { ascending: false }).limit(300)
  if (error) { if (MIST.test(error.message)) return []; throw new Error(error.message) }
  return (data ?? []) as Notitie[]
}

/** Per kaart het aantal notities en de laatste die iemand schreef (voor op het bord). */
export async function notitieSamenvatting(admin: Admin, ids: string[]): Promise<Map<string, { aantal: number; laatste: Pick<Notitie, 'tekst' | 'auteur_naam' | 'auteur_email' | 'created_at'> | null }>> {
  const uit = new Map<string, { aantal: number; laatste: Pick<Notitie, 'tekst' | 'auteur_naam' | 'auteur_email' | 'created_at'> | null }>()
  if (!ids.length) return uit
  const rijen: Notitie[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await admin.from('opdracht_notities').select('opdracht_id, tekst, soort, auteur_naam, auteur_email, created_at')
      .in('opdracht_id', ids.slice(i, i + 150)).order('created_at', { ascending: false }).limit(5000)
    if (error) { if (MIST.test(error.message)) return uit; throw new Error(error.message) }
    rijen.push(...((data ?? []) as Notitie[]))
  }
  for (const r of rijen) {
    const s = uit.get(r.opdracht_id) ?? { aantal: 0, laatste: null }
    if (r.soort === 'notitie') {
      s.aantal++
      if (!s.laatste) s.laatste = { tekst: r.tekst, auteur_naam: r.auteur_naam, auteur_email: r.auteur_email, created_at: r.created_at }
    }
    uit.set(r.opdracht_id, s)
  }
  return uit
}
