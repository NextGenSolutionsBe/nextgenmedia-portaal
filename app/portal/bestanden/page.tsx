export const dynamic = 'force-dynamic'

import { FolderUp } from 'lucide-react'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalView, sessionCan } from '@/lib/portal-auth'
import { BUCKET } from '@/lib/client-uploads'
import { Uploader, type Bestaand } from './uploader'

/**
 * De aanleverplek voor klanten: foto's en video's insturen met een titel en een
 * beschrijving erbij.
 *
 * Bewust een eigen scherm en niet iets onder Social Media. Materiaal wordt
 * meestal aangeleverd lang voordat duidelijk is bij welke post het hoort — en
 * soms hoort het bij niets. Zou dit onder de contentkalender hangen, dan moest
 * een klant eerst een post aanwijzen voordat hij een foto kwijt kon.
 */
export default async function PortalBestandenPage() {
  const session = await requirePortalView('files')
  const magUploaden = sessionCan(session, 'files', 'upload')

  let uploads: Bestaand[] = []
  let hint: string | null = null

  const admin = createAdminSupabaseClient()
  const { data, error } = await admin
    .from('client_uploads')
    .select('id, titel, beschrijving, bestandspad, bestandsnaam, mimetype, grootte, status, door_naam, created_at')
    .eq('client_id', session.clientId)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    hint = /client_uploads|does not exist|schema cache/i.test(error.message)
      ? 'Deze module is nog niet klaar voor gebruik — de migratie moet nog draaien.'
      : null
  } else {
    // Privébucket: per bestand een tijdelijke link, nooit een vast adres.
    uploads = await Promise.all((data ?? []).map(async (r) => {
      const rij = r as Record<string, unknown>
      const { data: s } = await admin.storage
        .from(BUCKET).createSignedUrl(String(rij.bestandspad), 60 * 60)
      const { bestandspad: _weg, ...rest } = rij
      void _weg
      return { ...rest, url: s?.signedUrl ?? null } as Bestaand
    }))
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FolderUp className="h-6 w-6" />Bestanden
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Stuur ons foto&apos;s en video&apos;s door. Vertel er kort bij wat we zien — dan weten we
          waarvoor we het kunnen gebruiken.
        </p>
      </div>

      {hint ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{hint}</p>
      ) : (
        <Uploader initieel={uploads} magUploaden={magUploaden} />
      )}
    </div>
  )
}
