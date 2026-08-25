export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, Files, Folder } from 'lucide-react'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalView, sessionCan } from '@/lib/portal-auth'
import { BUCKET, LOSSE_BESTANDEN } from '@/lib/client-uploads'
import { Uploader, type Bestaand } from '../uploader'
import { laadMapKeuzes } from '../data'

/**
 * Eén map — of de verzamelplek voor bestanden zonder map ("los").
 *
 * Bewust hetzelfde scherm voor beide: losse bestanden gedragen zich verder
 * precies als een map, en een tweede variant zou alleen maar uit elkaar lopen.
 */
export default async function PortalMapPage({ params }: { params: Promise<{ map: string }> }) {
  const { map } = await params
  const session = await requirePortalView('files')
  const magUploaden = sessionCan(session, 'files', 'upload')
  const admin = createAdminSupabaseClient()

  const isLos = map === 'los'
  let naam = LOSSE_BESTANDEN
  let beschrijving: string | null = null

  if (!isLos) {
    // De filter op client_id is de beveiliging: zonder dat opent een gegokt id
    // de map van een andere klant.
    const { data } = await admin
      .from('client_upload_folders')
      .select('id, naam, beschrijving')
      .eq('id', map).eq('client_id', session.clientId)
      .maybeSingle()
    if (!data) notFound()
    naam = data.naam
    beschrijving = data.beschrijving
  }

  let vraag = admin
    .from('client_uploads')
    .select('id, titel, beschrijving, bestandspad, bestandsnaam, mimetype, grootte, status, created_at, map_id')
    .eq('client_id', session.clientId)
    .order('created_at', { ascending: false })
    .limit(500)
  vraag = isLos ? vraag.is('map_id', null) : vraag.eq('map_id', map)

  const { data, error } = await vraag
  if (error && !/map_id|does not exist|schema cache/i.test(error.message)) throw new Error(error.message)

  const uploads: Bestaand[] = await Promise.all(((data ?? []) as Record<string, unknown>[]).map(async (rij) => {
    const { data: s } = await admin.storage
      .from(BUCKET).createSignedUrl(String(rij.bestandspad), 60 * 60)
    const { bestandspad: _weg, ...rest } = rij
    void _weg
    return { ...rest, url: s?.signedUrl ?? null } as Bestaand
  }))

  const mappen = await laadMapKeuzes(session.clientId)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <Link
          href="/portal/bestanden"
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-black mb-2"
        >
          <ChevronLeft className="h-3.5 w-3.5" />Alle mappen
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          {isLos ? <Files className="h-6 w-6" /> : <Folder className="h-6 w-6" />}
          {naam}
        </h1>
        {beschrijving && <p className="text-sm text-gray-500 mt-0.5">{beschrijving}</p>}
        {isLos && (
          <p className="text-sm text-gray-500 mt-0.5">
            Bestanden die (nog) in geen enkele map staan. Verplaatsen kan met het mapicoontje.
          </p>
        )}
      </div>

      <Uploader
        mapId={isLos ? null : map}
        initieel={uploads}
        magUploaden={magUploaden}
        mappen={mappen}
      />
    </div>
  )
}
