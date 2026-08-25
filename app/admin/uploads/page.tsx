export const dynamic = 'force-dynamic'

import { FolderUp } from 'lucide-react'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { BUCKET, LOSSE_BESTANDEN } from '@/lib/client-uploads'
import { UploadsView, type AdminUpload } from './uploads-view'

/**
 * Wat klanten hebben aangeleverd — alle klanten in één lijst.
 *
 * De identiteits- en modulecontrole gebeurt centraal in de middleware
 * (pathToModule op /admin-paden), dus hier geen losse rolcheck: dat zou een
 * tweede plek zijn waar rechten geregeld worden.
 */
export default async function AdminUploadsPage() {
  const admin = createAdminSupabaseClient()

  const KOLOMMEN = 'id, client_id, titel, beschrijving, bestandspad, bestandsnaam, mimetype, grootte, status, admin_notitie, door_naam, door_email, created_at, map_id'

  const haal = (kolommen: string) => admin
    .from('client_uploads')
    .select(kolommen)
    .order('created_at', { ascending: false })
    .limit(500)

  // Zonder de kolom map_id (migratie nog niet gedraaid) valt de selectie terug.
  let { data, error } = await haal(KOLOMMEN)
  if (error && /map_id/i.test(error.message)) {
    ;({ data, error } = await haal(KOLOMMEN.replace(', map_id', '')))
  }

  const mistTabel = !!error && /client_uploads|does not exist|schema cache/i.test(error.message)

  let uploads: AdminUpload[] = []
  if (!error) {
    const { data: klantRijen } = await admin
      .from('clients').select('id, company_name').order('company_name')
    const naamVan = new Map(
      ((klantRijen ?? []) as { id: string; company_name: string | null }[])
        .map((c) => [c.id, c.company_name ?? '(zonder naam)']),
    )

    const { data: mapRijen } = await admin.from('client_upload_folders').select('id, naam')
    const mapNaam = new Map(
      ((mapRijen ?? []) as { id: string; naam: string }[]).map((m) => [m.id, m.naam]),
    )

    uploads = await Promise.all((data ?? []).map(async (r) => {
      const rij = r as unknown as Record<string, unknown>
      const { data: s } = await admin.storage
        .from(BUCKET).createSignedUrl(String(rij.bestandspad), 60 * 60)
      const { bestandspad: _weg, ...rest } = rij
      void _weg
      return {
        ...rest,
        client_naam: naamVan.get(String(rij.client_id)) ?? '(onbekende klant)',
        map_naam: rij.map_id ? mapNaam.get(String(rij.map_id)) ?? LOSSE_BESTANDEN : LOSSE_BESTANDEN,
        url: s?.signedUrl ?? null,
      } as AdminUpload
    }))
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FolderUp className="h-6 w-6" />Klantuploads
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Beeldmateriaal dat klanten zelf aanleverden, met hun eigen titel en toelichting.
        </p>
      </div>

      {mistTabel ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          De tabel voor klantuploads bestaat nog niet. Draai eerst
          <code className="mx-1 px-1.5 py-0.5 bg-amber-100 rounded">supabase/migrations/99999999_SYNC_ALL.sql</code>
          in Supabase.
        </p>
      ) : error ? (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          Kon de uploads niet laden.
        </p>
      ) : (
        <UploadsView initieel={uploads} />
      )}
    </div>
  )
}
