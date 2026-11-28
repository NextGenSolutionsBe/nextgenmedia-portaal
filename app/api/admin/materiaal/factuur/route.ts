import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { vandaagBE } from '@/lib/materiaal/model'
import { kanFactuurLezen, leesMateriaalFactuur } from '@/lib/materiaal/factuur-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Factuur van een toestel (privébucket documenten, materiaal/facturen/…).
 *  POST { actie: 'upload', naam, grootte } → ondertekende uploadlink (de browser laadt rechtstreeks op)
 *  POST { actie: 'lezen', pad }            → de AI leest de factuur: enkel een voorstel, niets wordt bewaard
 *  GET  ?item_id=…                         → de factuur van een toestel bekijken (kortlevende link)
 * Opladen en lezen: wie materiaal beheert. Bekijken: wie Materiaalbeheer mag zien.
 */
const BUCKET = 'documenten'
const UUID = /^[0-9a-f-]{36}$/i
const FACTUUR_PAD = /^materiaal\/facturen\/[0-9a-f-]{36}\/[^/]{1,200}$/i
const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const veiligeNaam = (naam: string) => naam.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'factuur'
const fout = (tekst: string, status = 400) => NextResponse.json({ error: tekst }, { status })

export async function POST(req: NextRequest) {
  if (!(await magIk('materiaal', 'instellingen'))) return fout('Enkel wie materiaal beheert, kan een factuur toevoegen.', 403)
  const b = (await req.json().catch(() => ({}))) as { actie?: unknown; naam?: unknown; grootte?: unknown; pad?: unknown }
  const admin = createAdminSupabaseClient()
  if (b.actie === 'upload') {
    const naam = String(b.naam ?? '')
    const contentType = TYPES[(naam.split('.').pop() ?? '').toLowerCase()]
    if (!contentType) return fout('Kies een foto (jpg, png) of een pdf van de factuur.')
    const grootte = Number(b.grootte)
    if (!Number.isFinite(grootte) || grootte <= 0) return fout('Leeg bestand.')
    if (grootte > 25 * 1024 * 1024) return fout('Het bestand is groter dan 25 MB.')
    const pad = `materiaal/facturen/${randomUUID()}/${veiligeNaam(naam)}`
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(pad)
    if (error || !data?.token) { safeMessage(error, 'materiaal.factuur.upload'); return fout('Opladen lukte niet. Probeer opnieuw.', 500) }
    return NextResponse.json({ pad, token: data.token, bucket: BUCKET, contentType })
  }
  if (b.actie === 'lezen') {
    const pad = typeof b.pad === 'string' ? b.pad : ''
    if (!FACTUUR_PAD.test(pad) || pad.includes('..')) return fout('Ongeldige factuur.')
    const mime = TYPES[(pad.split('.').pop() ?? '').toLowerCase()]
    if (!mime || !kanFactuurLezen(mime)) return fout('Dit formaat kan de AI niet lezen. Neem een foto of kies een pdf.')
    try {
      const { data, error } = await admin.storage.from(BUCKET).download(pad)
      if (error || !data) return fout('De factuur is (nog) niet opgeladen. Probeer opnieuw.', 404)
      const buf = Buffer.from(await data.arrayBuffer())
      if (buf.byteLength > 20 * 1024 * 1024) return fout('Het bestand is te groot om te lezen. Vul de gegevens zelf in.')
      const { data: cats } = await admin.from('materiaal_categorieen').select('naam').order('volgorde')
      const namen = ((cats ?? []) as { naam: string }[]).map((c) => c.naam)
      return NextResponse.json(await leesMateriaalFactuur(buf.toString('base64'), mime, namen, vandaagBE()))
    } catch (e) {
      safeMessage(e, 'materiaal.factuur.lezen') // volledig in de serverlog
      return fout('De factuur lezen lukte niet. Vul de gegevens zelf in.', 502)
    }
  }
  return fout('Onbekende actie.')
}

export async function GET(req: NextRequest) {
  const [bekijken, uitlenen, beheren] = await Promise.all([magIk('materiaal', 'bekijken'), magIk('materiaal', 'goedkeuren'), magIk('materiaal', 'instellingen')])
  if (!bekijken && !uitlenen && !beheren) return fout('Geen toegang.', 403)
  const id = req.nextUrl.searchParams.get('item_id') ?? ''
  if (!UUID.test(id)) return fout('Ongeldig id.')
  const admin = createAdminSupabaseClient()
  const { data: item } = await admin.from('materiaal_items').select('factuur_pad').eq('id', id).maybeSingle()
  const pad = (item as { factuur_pad?: string | null } | null)?.factuur_pad
  if (!pad || !FACTUUR_PAD.test(pad)) return fout('Geen factuur bij dit toestel.', 404)
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(pad, 120)
  if (!data?.signedUrl) return fout('De factuur is niet gevonden.', 404)
  return NextResponse.redirect(data.signedUrl)
}
