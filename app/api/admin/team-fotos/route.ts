import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { BUCKET } from '@/lib/personeel/server'
import { safeMessage } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

/**
 * Profielfoto's uit Personeel, voor het kiezen van een persoon (Bram, Marco,
 * Chiara …) overal in de app. Enkel voornaam, achternaam en een kortlevende
 * link naar de foto van actieve medewerkers met een foto; niets anders uit het
 * dossier. Elke interne gebruiker (admin of actief teamlid).
 */
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('personeel').select('voornaam, achternaam, profielfoto_pad').eq('actief', true).not('profielfoto_pad', 'is', null).limit(200)
    if (error) throw new Error(error.message)
    const rijen = (data ?? []) as { voornaam: string; achternaam: string | null; profielfoto_pad: string }[]
    const { data: urls } = rijen.length ? await admin.storage.from(BUCKET).createSignedUrls(rijen.map((r) => r.profielfoto_pad), 6 * 3600) : { data: [] }
    const url = new Map(((urls ?? []) as { path: string | null; signedUrl: string }[]).map((u) => [u.path ?? '', u.signedUrl]))
    const leden = rijen
      .map((r) => ({ voornaam: r.voornaam, achternaam: r.achternaam, foto: url.get(r.profielfoto_pad) ?? null }))
      .filter((l) => l.foto)
    return NextResponse.json({ leden }, { headers: { 'Cache-Control': 'private, max-age=1800' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'team-fotos') }, { status: 500 }) }
}
