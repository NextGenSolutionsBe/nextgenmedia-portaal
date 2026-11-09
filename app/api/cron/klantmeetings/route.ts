import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'
import { verwerkHerinneringen } from '@/lib/meetings/server'
import { cronToegang } from '@/lib/meetings/cron-toegang'
import { zorgVoorGsmMeldingen } from '@/lib/meetings/gsm-melding'
import { verwerkEvents } from '@/lib/events-server'
import { kopieerInstagramMedia, ontbrekendeMedia } from '@/lib/founders-media-server'
import { revalidatePath } from 'next/cache'
import { ruimOpleveringenOp } from '@/lib/opleveringen-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Herinneringsmails van meetings, elke vijf minuten. Daarna: de gsm-melding
 * (15 min vooraf) op komende afspraken die ze nog niet hebben, en Workshops &
 * events (herinnering 24 uur vooraf, hangende bevestigingen, gastenlijst in Google).
 *
 * Aangeroepen door pg_cron (job 'klantmeetings-herinneringen') met het geheim
 * uit cron_geheimen ('klantmeetings'); de Vercel-CRON_SECRET werkt als reserve.
 * Zonder geldig geheim gebeurt er niets.
 */
export async function POST(req: NextRequest) {
  const toegang = await cronToegang(req)
  if (toegang === 'onbereikbaar') {
    return NextResponse.json({ error: DATABANK_TIJDELIJK }, { status: 503, headers: { 'Retry-After': '30' } })
  }
  if (toegang === 'nee') return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  try {
    const admin = createAdminSupabaseClient()
    const telling = await verwerkHerinneringen(admin)
    // Los van de mails: een haperende Google-agenda mag de herinneringen niet tegenhouden.
    const gsm = await zorgVoorGsmMeldingen(admin).catch((e) => {
      console.error('[cron:klantmeetings:gsm]', e)
      return { ingesteld: 0, mislukt: 0, fout: true }
    })
    const events = await verwerkEvents(admin).catch((e) => {
      console.error('[cron:klantmeetings:events]', e)
      return { fout: 1 }
    })
    // Founders of Flanders: Instagram-video's die nog niet in de eigen opslag staan (hoogstens 2 per ronde).
    const founders = await (async () => {
      const { data } = await admin.from('founders_videos').select('id, embed, media_video_pad, media_status, media_bezig_sinds, media_opgehaald_op').not('embed', 'is', null)
      const ids = ontbrekendeMedia((data ?? []) as Record<string, unknown>[]).slice(0, 2)
      const r = await Promise.all(ids.map((id) => kopieerInstagramMedia(admin, id).catch(() => ({ ok: false }))))
      if (r.some((x) => x.ok)) revalidatePath('/portal/founders')
      return { opgehaald: r.filter((x) => x.ok).length, mislukt: r.filter((x) => !x.ok).length }
    })().catch((e) => { console.error('[cron:klantmeetings:founders]', e); return { fout: 1 } })
    // Opleveringen: bestanden die langer dan 3 dagen gedeeld zijn uit de opslag halen.
    const opleveringen = await ruimOpleveringenOp(admin).catch((e) => { console.error('[cron:klantmeetings:opleveringen]', e); return { fout: 1 } })
    return NextResponse.json({ ok: true, ...telling, gsm, events, founders, opleveringen })
  } catch (e) {
    console.error('[cron:klantmeetings]', e)
    return NextResponse.json({ ok: false, error: 'Herinneringen niet verwerkt' }, { status: 500 })
  }
}

export const GET = POST
