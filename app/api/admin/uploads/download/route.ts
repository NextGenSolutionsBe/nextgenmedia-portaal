import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, signedUrlMap } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { BUCKET, LOSSE_BESTANDEN } from '@/lib/client-uploads'
import { zipPad, uniekeNaam } from '@/lib/zip-browser'

export const dynamic = 'force-dynamic'

const MAX_IDS = 2000
const GELDIG_SECONDEN = 2 * 60 * 60   // ruim genoeg voor een grote download

/**
 * POST { ids: string[] } — alles wat nodig is om de gekozen klantuploads in de
 * browser tot één ZIP te maken: per bestand een verse getekende link en het pad
 * in het archief (Klant/Map/bestandsnaam, dubbele namen genummerd).
 *
 * De ZIP zelf wordt bewust NIET op de server gebouwd: klantmateriaal loopt
 * snel in de honderden MB, en een serverfunctie is hier na 60 seconden en
 * 4,5 MB antwoord klaar. De browser haalt de bestanden rechtstreeks uit de
 * opslag en pakt ze in (lib/zip-browser.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json().catch(() => ({})) as { ids?: unknown }
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map((x) => String(x)).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))]
    if (ids.length === 0) return NextResponse.json({ error: 'Geen bestanden gekozen.' }, { status: 400 })
    if (ids.length > MAX_IDS) return NextResponse.json({ error: `Kies hooguit ${MAX_IDS} bestanden per keer.` }, { status: 400 })

    const admin = createAdminSupabaseClient()
    type Rij = { id: string; client_id: string; bestandspad: string; bestandsnaam: string; mimetype: string | null; grootte: number | null; map_id: string | null; created_at: string }
    const rijen: Rij[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin.from('client_uploads')
        .select('id, client_id, bestandspad, bestandsnaam, mimetype, grootte, map_id, created_at')
        .in('id', ids.slice(i, i + 200))
      if (error) throw new Error(error.message)
      rijen.push(...((data ?? []) as Rij[]))
    }
    // Zelfde volgorde als het scherm (nieuwste eerst), zodat de ZIP leesbaar blijft.
    rijen.sort((a, c) => c.created_at.localeCompare(a.created_at))

    const [{ data: klanten }, { data: mappen }] = await Promise.all([
      admin.from('clients').select('id, company_name').in('id', [...new Set(rijen.map((r) => r.client_id))]),
      admin.from('client_upload_folders').select('id, naam').in('id', [...new Set(rijen.map((r) => r.map_id).filter(Boolean))] as string[]),
    ])
    const klantNaam = new Map(((klanten ?? []) as { id: string; company_name: string | null }[]).map((k) => [k.id, k.company_name ?? 'Onbekende klant']))
    const mapNaam = new Map(((mappen ?? []) as { id: string; naam: string }[]).map((m) => [m.id, m.naam]))

    const urls = await signedUrlMap(admin, BUCKET, rijen.map((r) => r.bestandspad), GELDIG_SECONDEN)
    const gebruikt = new Set<string>()
    const bestanden = rijen.map((r) => ({
      id: r.id,
      pad: uniekeNaam(gebruikt, zipPad([klantNaam.get(r.client_id) ?? 'Onbekende klant', r.map_id ? (mapNaam.get(r.map_id) ?? LOSSE_BESTANDEN) : LOSSE_BESTANDEN], r.bestandsnaam)),
      url: urls.get(r.bestandspad) ?? null,
      grootte: r.grootte,
      mimetype: r.mimetype,
    }))

    const meta = requestMeta(req)
    await logAudit({
      action: 'upload.bulk_download', entityType: 'client_upload', entityId: null,
      summary: `Klantuploads gebundeld gedownload: ${bestanden.length} bestand(en), ${[...klantNaam.values()].join(', ').slice(0, 200)}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent, metadata: { aantal: bestanden.length, ontbrekend: bestanden.filter((x) => !x.url).length },
    })

    return NextResponse.json({ bestanden, totaal: bestanden.reduce((s, x) => s + (Number(x.grootte) || 0), 0), geldigSeconden: GELDIG_SECONDEN })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
