import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { BUCKET, isVideo } from '@/lib/client-uploads'
import type { MapRij } from './mappen-overzicht'

/**
 * Het laadwerk achter de bestandenmodule, los van de pagina's.
 *
 * Beide schermen (overzicht en één map) hebben dezelfde gegevens nodig. Zou
 * elk scherm zijn eigen query hebben, dan lopen ze uit elkaar zodra er een
 * kolom bijkomt.
 *
 * Alles hier is bestand tegen een nog niet gedraaide migratie: ontbreekt de
 * tabel of de kolom `map_id`, dan valt het terug op "geen mappen" in plaats van
 * de pagina te laten crashen.
 */

const MIST_TABEL = /client_uploads|client_upload_folders|does not exist|schema cache/i
const MIST_MAP = /map_id/i

type UploadRij = {
  id: string
  map_id: string | null
  status: string
  bestandspad: string
  mimetype: string | null
}

export type Overzicht = {
  mappen: MapRij[]
  losAantal: number
  losVoorbeeld: string | null
  /** Tabel of kolom ontbreekt: de migratie moet nog draaien. */
  nogNietKlaar: boolean
}

/** Tijdelijke link; de bucket is privé, dus er bestaat geen vast adres. */
async function link(
  admin: ReturnType<typeof createAdminSupabaseClient>, pad: string,
): Promise<string | null> {
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(pad, 60 * 60)
  return data?.signedUrl ?? null
}

/** Eerste afbeelding uit een reeks, als kaartvoorbeeld. Video's slaan we over:
 *  daar valt geen miniatuur uit te halen zonder het bestand te verwerken. */
async function voorbeeldVan(
  admin: ReturnType<typeof createAdminSupabaseClient>, rijen: UploadRij[],
): Promise<string | null> {
  const eerste = rijen.find((r) => !isVideo(r.mimetype))
  return eerste ? link(admin, eerste.bestandspad) : null
}

export async function laadOverzicht(clientId: string): Promise<Overzicht> {
  const admin = createAdminSupabaseClient()
  const leeg: Overzicht = { mappen: [], losAantal: 0, losVoorbeeld: null, nogNietKlaar: true }

  const { data: mapData, error: mapFout } = await admin
    .from('client_upload_folders')
    .select('id, naam, beschrijving, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (mapFout && MIST_TABEL.test(mapFout.message)) return leeg

  const { data: uploadData, error: uploadFout } = await admin
    .from('client_uploads')
    .select('id, map_id, status, bestandspad, mimetype')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(2000)

  if (uploadFout) {
    if (MIST_TABEL.test(uploadFout.message) || MIST_MAP.test(uploadFout.message)) return leeg
    throw new Error(uploadFout.message)
  }

  const uploads = (uploadData ?? []) as UploadRij[]
  const perMap = new Map<string, UploadRij[]>()
  const los: UploadRij[] = []
  for (const u of uploads) {
    if (u.map_id) {
      const lijst = perMap.get(u.map_id) ?? []
      lijst.push(u)
      perMap.set(u.map_id, lijst)
    } else los.push(u)
  }

  const mappen: MapRij[] = await Promise.all(
    ((mapData ?? []) as { id: string; naam: string; beschrijving: string | null }[]).map(async (m) => {
      const eigen = perMap.get(m.id) ?? []
      return {
        id: m.id,
        naam: m.naam,
        beschrijving: m.beschrijving,
        aantal: eigen.length,
        nieuw: eigen.filter((u) => u.status === 'nieuw').length,
        voorbeeld: await voorbeeldVan(admin, eigen),
      }
    }),
  )

  return {
    mappen,
    losAantal: los.length,
    losVoorbeeld: await voorbeeldVan(admin, los),
    nogNietKlaar: false,
  }
}

/** Alleen naam en id, voor het verplaatsmenu op een bestandskaart. */
export async function laadMapKeuzes(clientId: string): Promise<{ id: string; naam: string }[]> {
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin
    .from('client_upload_folders')
    .select('id, naam')
    .eq('client_id', clientId)
    .order('naam')
  if (error) return []
  return (data ?? []) as { id: string; naam: string }[]
}
