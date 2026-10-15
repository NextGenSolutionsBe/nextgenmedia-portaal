export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Folder } from 'lucide-react'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { UploadsView } from '../uploads-view'
import { NIET_TOEGEWEZEN, isUuid, laadKlanten, laadMappen, laadTelling, laadUploads } from '../laad'

/**
 * De map van één klant: alles wat die aanleverde, plus wat wij er zelf in
 * zetten. Zelfde raster, filters, selectie, ZIP en fotoviewer als vroeger —
 * enkel beperkt tot deze klant.
 *
 * Het speciale pad /admin/uploads/niet-toegewezen toont bestanden waarvan de
 * klant niet (meer) bestaat, met een knop om ze alsnog aan een klant te hangen.
 *
 * Toegang: middleware (module 'uploads' op prefix /admin/uploads).
 */
export default async function KlantMapPage({ params }: { params: { clientId: string } }) {
  const id = String(params.clientId ?? '').trim()
  const isWees = id === NIET_TOEGEWEZEN
  if (!isWees && !isUuid(id)) notFound()

  const admin = createAdminSupabaseClient()
  const klanten = await laadKlanten(admin)
  const naamVan = new Map(klanten.map((k) => [k.id, k.naam]))
  const klantKeuze = klanten.filter((k) => !k.archived_at).map((k) => ({ id: k.id, naam: k.naam }))

  let klantNaam: string
  let filter: { clientId: string } | { clientIds: string[] }
  let mappen: { id: string; naam: string }[] = []

  if (isWees) {
    klantNaam = 'Niet toegewezen'
    const { perKlant } = await laadTelling(admin)
    filter = { clientIds: [...perKlant.keys()].filter((c) => !naamVan.has(c)) }
  } else {
    const klant = klanten.find((k) => k.id === id)
    if (!klant) notFound()
    klantNaam = klant.naam
    filter = { clientId: id }
    mappen = await laadMappen(admin, id)
  }

  const { uploads, error } = await laadUploads(admin, filter, naamVan)
  const mistTabel = !!error && /client_uploads|does not exist|schema cache/i.test(error.message)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <Link href="/admin/uploads" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-black mb-2">
          <ArrowLeft className="h-4 w-4" />Alle klantmappen
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          {isWees
            ? <AlertTriangle className="h-6 w-6 text-amber-600" />
            : <Folder className="h-6 w-6" />}
          {klantNaam}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {isWees
            ? 'Bestanden waarvan de klant niet meer bestaat. Koppel ze aan een klant, of verwijder ze.'
            : `${uploads.length} bestand${uploads.length === 1 ? '' : 'en'}${uploads.length >= 500 ? ' (de 500 jongste)' : ''}`}
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
        <UploadsView
          initieel={uploads}
          clientId={isWees ? null : id}
          klantNaam={klantNaam}
          mappen={mappen}
          klantKeuze={isWees ? klantKeuze : undefined}
        />
      )}
    </div>
  )
}
