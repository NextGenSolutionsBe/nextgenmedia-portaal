import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { signedUrlMap } from '@/lib/supabase/server'
import { BUCKET, LOSSE_BESTANDEN } from '@/lib/client-uploads'
import type { AdminUpload } from './uploads-view'

/**
 * Laden van klantuploads voor de admin — één plek voor de klantmap én de
 * map "Niet toegewezen", zodat de terugval zonder kolom map_id (migratie nog
 * niet gedraaid) en het tekenen van links niet twee keer geschreven staan.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any>

const KOLOMMEN = 'id, client_id, titel, beschrijving, bestandspad, bestandsnaam, mimetype, grootte, status, admin_notitie, door_naam, door_email, created_at, map_id'

export const MIST_TABEL = /client_uploads|does not exist|schema cache/i

export type Klant = { id: string; naam: string; archived_at: string | null }

/** Alle klanten, met archiefdatum als de kolom bestaat. */
export async function laadKlanten(admin: Admin): Promise<Klant[]> {
  type Rij = { id: string; company_name: string | null; archived_at?: string | null }
  let { data, error } = await admin.from('clients').select('id, company_name, archived_at').order('company_name')
  if (error && /archived_at/i.test(error.message)) {
    const terugval = await admin.from('clients').select('id, company_name').order('company_name')
    data = terugval.data as unknown as typeof data
  }
  return ((data ?? []) as unknown as Rij[])
    .map((c) => ({ id: c.id, naam: c.company_name ?? '(zonder naam)', archived_at: c.archived_at ?? null }))
}

/**
 * Per klant: aantal bestanden en de jongste upload. Enkel twee kolommen,
 * zodat dit ook met duizenden bestanden een lichte vraag blijft.
 */
export async function laadTelling(admin: Admin): Promise<{
  perKlant: Map<string, { aantal: number; laatste: string | null }>
  error: { message: string } | null
}> {
  const perKlant = new Map<string, { aantal: number; laatste: string | null }>()
  const { data, error } = await admin
    .from('client_uploads').select('client_id, created_at')
    .order('created_at', { ascending: false }).limit(20000)
  if (error) return { perKlant, error }
  for (const r of (data ?? []) as { client_id: string; created_at: string }[]) {
    const huidig = perKlant.get(r.client_id)
    if (huidig) huidig.aantal++
    else perKlant.set(r.client_id, { aantal: 1, laatste: r.created_at })
  }
  return { perKlant, error: null }
}

/**
 * Uploads van één klant (of van een lijst client_id's die nergens meer bij
 * horen), met mapnaam en getekende link. Nieuwste eerst, hooguit 500.
 */
export async function laadUploads(
  admin: Admin,
  filter: { clientId: string } | { clientIds: string[] },
  naamVan: Map<string, string>,
): Promise<{ uploads: AdminUpload[]; error: { message: string } | null }> {
  const haal = (kolommen: string) => {
    let vraag = admin.from('client_uploads').select(kolommen)
    vraag = 'clientId' in filter ? vraag.eq('client_id', filter.clientId) : vraag.in('client_id', filter.clientIds)
    return vraag.order('created_at', { ascending: false }).limit(500)
  }

  if ('clientIds' in filter && filter.clientIds.length === 0) return { uploads: [], error: null }

  let { data, error } = await haal(KOLOMMEN)
  if (error && /map_id/i.test(error.message)) {
    ;({ data, error } = await haal(KOLOMMEN.replace(', map_id', '')))
  }
  if (error) return { uploads: [], error }

  const rijen = (data ?? []) as unknown as Record<string, unknown>[]
  const mapIds = [...new Set(rijen.map((r) => r.map_id).filter(Boolean))] as string[]
  const mapNaam = new Map<string, string>()
  if (mapIds.length > 0) {
    const { data: mapRijen } = await admin.from('client_upload_folders').select('id, naam').in('id', mapIds)
    for (const m of (mapRijen ?? []) as { id: string; naam: string }[]) mapNaam.set(m.id, m.naam)
  }

  const urls = await signedUrlMap(admin, BUCKET, rijen.map((r) => String(r.bestandspad)), 60 * 60)

  const uploads = rijen.map((rij) => {
    const { bestandspad: _weg, ...rest } = rij
    void _weg
    return {
      ...rest,
      map_id: rij.map_id ? String(rij.map_id) : null,
      client_naam: naamVan.get(String(rij.client_id)) ?? '(onbekende klant)',
      map_naam: rij.map_id ? mapNaam.get(String(rij.map_id)) ?? LOSSE_BESTANDEN : LOSSE_BESTANDEN,
      url: urls.get(String(rij.bestandspad)) ?? null,
    } as AdminUpload
  })
  return { uploads, error: null }
}

/** Mappen van één klant, voor de mapkeuze bij het uploaden. */
export async function laadMappen(admin: Admin, clientId: string): Promise<{ id: string; naam: string }[]> {
  const { data } = await admin.from('client_upload_folders').select('id, naam').eq('client_id', clientId).order('naam')
  return ((data ?? []) as { id: string; naam: string }[])
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/** Vaste route-naam voor de map met bestanden zonder bestaande klant. */
export const NIET_TOEGEWEZEN = 'niet-toegewezen'
