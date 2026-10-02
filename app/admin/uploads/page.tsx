export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { FolderUp } from 'lucide-react'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { MappenView, type KlantMap } from './mappen-view'
import { NIET_TOEGEWEZEN, isUuid, laadKlanten, laadTelling } from './laad'

/**
 * Klantuploads als mappen: één map per klant, zoals een gedeelde schijf.
 *
 * Elke niet-gearchiveerde klant krijgt een map, ook zonder bestanden — zo
 * bestaat de map "automatisch" zodra de klant bestaat en hoeft niemand iets
 * aan te maken. De inhoud staat op /admin/uploads/[clientId].
 *
 * De identiteits- en modulecontrole gebeurt centraal in de middleware
 * (pathToModule op /admin-paden), dus hier geen losse rolcheck.
 */
export default async function AdminUploadsPage({
  searchParams,
}: {
  searchParams?: { client?: string }
}) {
  // Oude diepe links (?client=<id>) blijven werken: rechtstreeks de map in.
  const oud = String(searchParams?.client ?? '').trim()
  if (oud && isUuid(oud)) redirect(`/admin/uploads/${oud}`)

  const admin = createAdminSupabaseClient()
  const [klanten, telling] = await Promise.all([laadKlanten(admin), laadTelling(admin)])

  const mistTabel = !!telling.error && /client_uploads|does not exist|schema cache/i.test(telling.error.message)

  const mappen: KlantMap[] = klanten
    .filter((k) => !k.archived_at)
    .map((k) => {
      const t = telling.perKlant.get(k.id)
      return { id: k.id, naam: k.naam, aantal: t?.aantal ?? 0, laatste: t?.laatste ?? null }
    })

  // Bestanden waarvan de klant niet (meer) bestaat. Hoort niet voor te komen
  // (client_id is verplicht en cascadeert), maar als het toch gebeurt moet
  // het materiaal ergens zichtbaar zijn in plaats van stil te verdwijnen.
  const bekend = new Set(klanten.map((k) => k.id))
  let wees: KlantMap | null = null
  for (const [clientId, t] of telling.perKlant) {
    if (bekend.has(clientId)) continue
    if (!wees) wees = { id: NIET_TOEGEWEZEN, naam: 'Niet toegewezen', aantal: 0, laatste: null }
    wees.aantal += t.aantal
    if (t.laatste && (!wees.laatste || t.laatste > wees.laatste)) wees.laatste = t.laatste
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FolderUp className="h-6 w-6" />Klantuploads
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Eén map per klant met alles wat die aanleverde — en wat wij er zelf bij zetten.
        </p>
      </div>

      {mistTabel ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          De tabel voor klantuploads bestaat nog niet. Draai eerst
          <code className="mx-1 px-1.5 py-0.5 bg-amber-100 rounded">supabase/migrations/99999999_SYNC_ALL.sql</code>
          in Supabase.
        </p>
      ) : telling.error ? (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          Kon de uploads niet laden.
        </p>
      ) : (
        <MappenView mappen={mappen} wees={wees} />
      )}
    </div>
  )
}
