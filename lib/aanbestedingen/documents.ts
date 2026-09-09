import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { BdaClient } from '@/lib/aanbestedingen/bda'
import { extractText } from '@/lib/aanbestedingen/extract'

/**
 * Bestekdocumenten ophalen en er tekst uit halen.
 *
 * Dit is de duurste stap in tijd en bandbreedte — één bestek-archief was in de
 * test 21,5 MB — en tegelijk de goedkoopste in geld: er komt geen AI aan te
 * pas. Daarom zijn er twee vangnetten tegen dubbel werk:
 *
 *  1. Kennen we deze version_id al voor deze opdracht? Dan niets doen. Een
 *     nieuwe versie van een document krijgt een nieuwe version_id, dus dit is
 *     veilig: een gewijzigd bestek wordt wél opnieuw gelezen.
 *  2. Kennen we deze file_hash al ergens anders? Dan nemen we de tekst over
 *     zonder te downloaden. Standaardbijlagen (gedragscodes, huisstijlgidsen)
 *     komen bij tientallen opdrachten identiek terug.
 *
 * Mislukken doet dit nooit hard: een document dat we niet kunnen ophalen of
 * lezen krijgt een status en de rest gaat door.
 */

/** Boven deze grens bewaren we de tekst afgekapt. Puur om te voorkomen dat één
 *  uitzonderlijk archief de tabel opblaast; 1,5 miljoen tekens is ruim vier
 *  keer het grootste bestek dat we in de praktijk zagen. */
const MAX_TEKST = 1_500_000

export type DocumentenResultaat = {
  gevonden: number
  nieuw: number
  overgeslagen: number
  uit_cache: number
  onleesbaar: number
  niet_opgehaald: number
  tekens: number
}

type BestaandeRij = {
  version_id: string
  file_hash: string | null
  leesbaar: boolean
}

export async function haalDocumentenOp(
  filterId: string,
  referentienummer: string,
  workspaceId: string,
  client = new BdaClient(),
): Promise<DocumentenResultaat> {
  const admin = createAdminSupabaseClient()
  const uit: DocumentenResultaat = {
    gevonden: 0, nieuw: 0, overgeslagen: 0, uit_cache: 0,
    onleesbaar: 0, niet_opgehaald: 0, tekens: 0,
  }

  const docs = await client.documenten(workspaceId)
  uit.gevonden = docs.length
  if (docs.length === 0) return uit

  // Wat hebben we al voor déze opdracht?
  const { data: bestaandeRijen } = await admin
    .from('aanbesteding_documenten')
    .select('version_id, file_hash, leesbaar')
    .eq('filter_id', filterId)
    .eq('referentienummer', referentienummer)
  const bestaand = new Map(
    ((bestaandeRijen ?? []) as BestaandeRij[]).map((r) => [r.version_id, r]),
  )

  for (const doc of docs) {
    if (bestaand.has(doc.version_id)) {
      uit.overgeslagen++
      continue
    }

    const rij: Record<string, unknown> = {
      filter_id: filterId,
      referentienummer,
      version_id: doc.version_id,
      filename: doc.filename,
      file_hash: doc.file_hash || null,
      opgehaald_op: new Date().toISOString(),
    }

    // Vangnet 2: dezelfde inhoud kennen we misschien al van een andere opdracht.
    const hergebruikt = doc.file_hash ? await tekstUitCache(doc.file_hash) : null
    if (hergebruikt) {
      Object.assign(rij, hergebruikt, { status: `uit_cache (${hergebruikt.status})` })
      uit.uit_cache++
      uit.tekens += hergebruikt.char_count
      await bewaar(rij)
      continue
    }

    let bytes: Uint8Array | null = null
    try {
      bytes = await client.download(doc.version_id)
    } catch (e) {
      // Een storing bij één document mag de andere niet meenemen.
      bytes = null
      rij.status = `download_mislukt: ${e instanceof Error ? e.message : 'onbekend'}`
    }

    if (!bytes) {
      // 403/404 hoort erbij: niet elk document is publiek op te halen.
      rij.status ??= 'niet_op_te_halen'
      rij.leesbaar = false
      rij.size_bytes = 0
      uit.niet_opgehaald++
      await bewaar(rij)
      continue
    }

    const r = await extractText(doc.filename, bytes)
    Object.assign(rij, {
      doc_type: r.doc_type,
      size_bytes: bytes.byteLength,
      page_count: r.page_count,
      char_count: r.char_count,
      leesbaar: r.leesbaar,
      status: r.status,
      tekst: r.tekst.length > MAX_TEKST ? r.tekst.slice(0, MAX_TEKST) : r.tekst,
    })
    if (r.leesbaar) { uit.nieuw++; uit.tekens += r.char_count } else uit.onleesbaar++
    await bewaar(rij)
  }

  return uit
}

/** Tekst van een identiek bestand dat we al eerder lazen. */
async function tekstUitCache(fileHash: string) {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('aanbesteding_documenten')
    .select('doc_type, size_bytes, page_count, char_count, tekst, status')
    .eq('file_hash', fileHash)
    .eq('leesbaar', true)
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const d = data as {
    doc_type: string | null; size_bytes: number | null; page_count: number | null
    char_count: number | null; tekst: string | null; status: string | null
  }
  return {
    doc_type: d.doc_type, size_bytes: d.size_bytes ?? 0,
    page_count: d.page_count ?? 0, char_count: d.char_count ?? 0,
    tekst: d.tekst ?? '', leesbaar: true, status: d.status ?? 'ok',
  }
}

async function bewaar(rij: Record<string, unknown>) {
  const admin = createAdminSupabaseClient()
  const { error } = await admin
    .from('aanbesteding_documenten')
    .upsert(rij, { onConflict: 'filter_id,referentienummer,version_id' })
  // Bewust geen throw: het wegschrijven van één document mag de run niet
  // stilleggen. Wel luid loggen, anders mist niemand het.
  if (error) console.error('[aanbestedingen] document bewaren mislukt:', error.message)
}

/** Alle ingelezen tekst van één opdracht, in leesvolgorde. */
export async function tekstVanOpdracht(
  filterId: string, referentienummer: string,
): Promise<{ tekst: string; documenten: number; onleesbaar: string[] }> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('aanbesteding_documenten')
    .select('filename, tekst, leesbaar, status')
    .eq('filter_id', filterId)
    .eq('referentienummer', referentienummer)
    .order('filename')

  const rijen = (data ?? []) as {
    filename: string | null; tekst: string | null; leesbaar: boolean; status: string | null
  }[]
  const delen: string[] = []
  const onleesbaar: string[] = []
  for (const r of rijen) {
    if (r.leesbaar && r.tekst) delen.push(`===== ${r.filename ?? ''} =====\n${r.tekst}`)
    else onleesbaar.push(`${r.filename ?? '?'} (${r.status ?? 'onbekend'})`)
  }
  return { tekst: delen.join('\n\n'), documenten: delen.length, onleesbaar }
}
