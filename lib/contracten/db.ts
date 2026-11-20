import 'server-only'
import { seedLijst, ontdubbelTypes, normaliseerType, typeSleutel, typeVanContract } from './types'

/**
 * Serverlaag voor de contracttypes. De tabel `contract_types` bestaat pas na de
 * migratie, dus ELKE lezing valt stil terug op de startlijst + de types die al
 * op contracten staan. Zo werkt het scherm ook vóór de migratie.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Admin = { from: (t: string) => any }

export type ContracttypeRij = { id: string | null; naam: string; actief: boolean; volgorde: number; aantal: number }

/** Herkent "tabel/kolom bestaat nog niet" zodat we stil kunnen terugvallen. */
export function ontbreekt(message: unknown): boolean {
  return /does not exist|schema cache|Could not find/i.test(String(message ?? ''))
}

async function leesTabel(admin: Admin): Promise<Array<{ id: string; naam: string; actief: boolean; volgorde: number }> | null> {
  try {
    const { data, error } = await admin.from('contract_types').select('id, naam, actief, volgorde').order('volgorde').order('naam')
    if (error) return null   // tabel bestaat nog niet (of is onleesbaar) → terugval
    return (data ?? []) as Array<{ id: string; naam: string; actief: boolean; volgorde: number }>
  } catch { return null }
}

/** Alle contracttypes die op contracten staan (leeg → 'Niet toegewezen'). */
export async function typesInGebruik(admin: Admin): Promise<string[]> {
  try {
    const { data } = await admin.from('contracts').select('contract_type').limit(5000)
    return ((data ?? []) as Array<{ contract_type: string | null }>).map((c) => typeVanContract(c.contract_type))
  } catch { return [] }
}

/** De volledige lijst types met gebruikstelling — altijd gevuld, ook vóór de migratie. */
export async function lijstTypes(admin: Admin): Promise<{ types: ContracttypeRij[]; tabelAanwezig: boolean }> {
  const [rijen, gebruikt] = await Promise.all([leesTabel(admin), typesInGebruik(admin)])
  const telling = new Map<string, number>()
  for (const g of gebruikt) telling.set(typeSleutel(g), (telling.get(typeSleutel(g)) ?? 0) + 1)

  if (rijen === null) {
    const namen = seedLijst(gebruikt)
    return {
      tabelAanwezig: false,
      types: namen.map((naam, i) => ({ id: null, naam, actief: true, volgorde: i, aantal: telling.get(typeSleutel(naam)) ?? 0 })),
    }
  }

  const uit: ContracttypeRij[] = rijen
    .filter((r) => normaliseerType(r.naam))
    .map((r) => ({ id: r.id, naam: normaliseerType(r.naam), actief: r.actief !== false, volgorde: r.volgorde ?? 0, aantal: telling.get(typeSleutel(r.naam)) ?? 0 }))

  // Types die wél op een contract staan maar (nog) geen rij hebben — bv. een
  // "Overige — <omschrijving>" — horen toch in de filters thuis.
  const bekend = new Set(uit.map((r) => typeSleutel(r.naam)))
  let volgorde = uit.reduce((m, r) => Math.max(m, r.volgorde), 0)
  for (const naam of ontdubbelTypes(gebruikt)) {
    if (bekend.has(typeSleutel(naam))) continue
    bekend.add(typeSleutel(naam))
    uit.push({ id: null, naam, actief: true, volgorde: ++volgorde, aantal: telling.get(typeSleutel(naam)) ?? 0 })
  }
  return { types: uit, tabelAanwezig: true }
}

/** Enkel de namen die in een keuzelijst horen (actief of nog in gebruik). */
export async function typeNamen(admin: Admin): Promise<string[]> {
  const { types } = await lijstTypes(admin)
  return ontdubbelTypes(types.filter((t) => t.actief || t.aantal > 0).map((t) => t.naam))
}
