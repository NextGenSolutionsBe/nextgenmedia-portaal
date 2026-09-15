import 'server-only'
import { readZip } from '@/lib/zip'
import { parseXlsx } from '@/lib/sales/xlsx'

/**
 * Tekst uit bestekdocumenten halen. Kost geen AI-tokens: dit is puur lezen.
 *
 * PDF gaat via pdfjs-dist (van Mozilla, nul afhankelijkheden). DOCX en ZIP
 * doen we zelf met de gedeelde zip-lezer — een .docx is gewoon een ZIP met XML.
 *
 * Faalt nooit hard. Een onleesbaar document levert een nette status op, want
 * één kapotte bijlage mag een hele run niet stilleggen.
 */

/** Onder deze grenzen gaan we ervan uit dat het een scan is, geen tekst. */
const MIN_TEKENS_PER_PAGINA = 25
const MIN_TEKENS_TOTAAL = 40

export type ExtractResultaat = {
  tekst: string
  leesbaar: boolean
  status: string
  page_count: number
  char_count: number
  doc_type: string
}

const leeg = (status: string, doc_type: string): ExtractResultaat =>
  ({ tekst: '', leesbaar: false, status, page_count: 0, char_count: 0, doc_type })

// ── PDF ─────────────────────────────────────────────────────────────────────

async function extractPdf(data: Uint8Array): Promise<ExtractResultaat> {
  let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    // De legacy-build is degene die buiten een browser werkt.
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  } catch (e) {
    // Zonder deze regel is "pdf_lezer_ontbreekt" niet te onderscheiden van een
    // verkeerd geïnstalleerd pakket, en dat kost onnodig zoekwerk.
    console.error('[aanbestedingen] pdf-lezer laadt niet:', e instanceof Error ? e.message : e)
    return leeg('pdf_lezer_ontbreekt', 'pdf')
  }

  try {
    // LET OP — pdfjs WEIGERT een Node-Buffer ("Please provide binary data as
    // `Uint8Array`, rather than `Buffer`"), ook al is een Buffer er technisch
    // een. Alles wat uit een zip of een download komt is een Buffer, dus hier
    // altijd een schone kopie maken. Zonder dit faalt élke pdf.
    const schoon = new Uint8Array(data.byteLength)
    schoon.set(data)

    const doc = await pdfjs.getDocument({
      data: schoon,
      // Geen externe bestanden ophalen en geen worker: dit draait server-side
      // in één proces, en een lettertype ophalen van het internet hoort daar
      // niet bij.
      useSystemFonts: true,
      disableFontFace: true,
      // Stil. Bestekken zitten vol lettertypes die pdfjs niet mooi vindt
      // ("TT: undefined function"); dat zijn tientallen regels ruis per
      // document en het zegt niets over de tekst die we eruit halen.
      verbosity: 0,
    }).promise

    const delen: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      try {
        const pagina = await doc.getPage(p)
        const inhoud = await pagina.getTextContent()
        const regel = inhoud.items
          .map((i) => (typeof (i as { str?: unknown }).str === 'string' ? (i as { str: string }).str : ''))
          .join(' ')
        delen.push(regel)
      } catch {
        // Eén slechte pagina mag de rest niet meenemen.
      }
    }
    const paginas = doc.numPages
    // Geheugen vrijgeven; bestekken van honderden pagina's blijven anders hangen.
    await doc.cleanup()

    const tekst = delen.join('\n').replace(/[ \t]{2,}/g, ' ').trim()
    if (tekst.length < MIN_TEKENS_TOTAAL || (paginas > 0 && tekst.length / paginas < MIN_TEKENS_PER_PAGINA)) {
      // Waarschijnlijk een scan. We doen bewust GEEN OCR — te zwaar en te duur;
      // dit melden we zodat de gebruiker het zelf even bekijkt.
      return { tekst, leesbaar: false, status: 'onleesbaar_scan', page_count: paginas, char_count: tekst.length, doc_type: 'pdf' }
    }
    return { tekst, leesbaar: true, status: 'ok', page_count: paginas, char_count: tekst.length, doc_type: 'pdf' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/password/i.test(msg)) return leeg('pdf_versleuteld', 'pdf')
    // De reden meeloggen: "pdf_corrupt" zonder uitleg maakte een bibliotheek-
    // fout ononderscheidbaar van een echt kapot bestand, en dat kostte tijd.
    console.error('[aanbestedingen] pdf onleesbaar:', msg)
    return leeg('pdf_corrupt', 'pdf')
  }
}

// ── DOCX ────────────────────────────────────────────────────────────────────

const xmlOntsleutel = (s: string): string =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) =>
      ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[m] ?? m))

/**
 * Tekst uit een Word-document.
 *
 * LET OP — de tabellen moeten mee. De prijsinventaris en de meetstaat staan
 * bijna altijd in een tabel; die overslaan betekent dat je precies het stuk
 * mist waar de prijs uit moet komen.
 */
function extractDocx(data: Uint8Array): ExtractResultaat {
  let bestanden: Map<string, Buffer>
  try {
    bestanden = readZip(Buffer.from(data))
  } catch {
    return leeg('docx_corrupt', 'docx')
  }
  const xml = bestanden.get('word/document.xml')?.toString('utf8')
  if (!xml) return leeg('docx_corrupt', 'docx')

  const regels: string[] = []

  // Per tabelrij: de cellen samenvoegen met " | " zodat een prijsregel leesbaar
  // blijft ("Post | aantal | eenheidsprijs").
  const blokken = xml.split(/(?=<w:tbl[ >])/)
  for (const blok of blokken) {
    if (blok.startsWith('<w:tbl')) {
      const tabel = blok.slice(0, blok.indexOf('</w:tbl>') + 8)
      for (const rij of tabel.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
        const cellen: string[] = []
        for (const cel of rij[0].matchAll(/<w:tc[ >]([\s\S]*?)<\/w:tc>/g)) {
          const t = [...cel[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
            .map((m) => xmlOntsleutel(m[1])).join('').trim()
          if (t) cellen.push(t)
        }
        if (cellen.length) regels.push(cellen.join(' | '))
      }
      // De gewone alinea's ná de tabel binnen dit blok ook meenemen.
      const rest = blok.slice(blok.indexOf('</w:tbl>') + 8)
      regels.push(...alineas(rest))
    } else {
      regels.push(...alineas(blok))
    }
  }

  const tekst = regels.filter((r) => r.trim()).join('\n').trim()
  if (tekst.length < MIN_TEKENS_TOTAAL) return leeg('onleesbaar_leeg', 'docx')
  return { tekst, leesbaar: true, status: 'ok', page_count: 0, char_count: tekst.length, doc_type: 'docx' }
}

/**
 * Alinea's uit een stuk WordprocessingML.
 *
 * LET OP bij het aanpassen van de patronen hieronder: `<w:t[^>]*>` matcht ook
 * `<w:tbl>` en `<w:tc>`, waardoor er ruwe XML in de tekst belandt. Vandaar
 * `<w:t(?:\s[^>]*)?>` — enkel het echte tekstelement.
 */
function alineas(xml: string): string[] {
  const uit: string[] = []
  for (const p of xml.matchAll(/<w:p[ >]([\s\S]*?)<\/w:p>/g)) {
    const t = [...p[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((m) => xmlOntsleutel(m[1])).join('').trim()
    if (t) uit.push(t)
  }
  return uit
}

// ── ZIP ─────────────────────────────────────────────────────────────────────

async function extractZipBestand(data: Uint8Array): Promise<ExtractResultaat> {
  let bestanden: Map<string, Buffer>
  try {
    bestanden = readZip(Buffer.from(data))
  } catch {
    return leeg('zip_corrupt', 'zip')
  }

  const delen: string[] = []
  let paginas = 0
  let ietsLeesbaar = false
  const mislukt: string[] = []

  for (const [naam, inhoud] of bestanden) {
    if (naam.endsWith('/') || !/\.(pdf|docx|xlsx)$/i.test(naam)) continue
    const sub = await extractText(naam, inhoud)
    paginas += sub.page_count
    if (sub.leesbaar) {
      ietsLeesbaar = true
      delen.push(`===== ${naam} =====\n${sub.tekst}`)
    } else {
      // Niet stilzwijgend overslaan. Als net het bestek onleesbaar is en de
      // rest wel doorkomt, ziet "ok" er goed uit terwijl het belangrijkste
      // ontbreekt. Daarom benoemen we wat er niet gelukt is.
      mislukt.push(`${naam.split('/').pop()} (${sub.status})`)
    }
  }

  const tekst = delen.join('\n\n').trim()
  return {
    tekst,
    leesbaar: ietsLeesbaar,
    status: !ietsLeesbaar
      ? 'zip_geen_leesbare_bestanden'
      : mislukt.length
        ? `ok_deels: ${mislukt.join(', ')}`
        : 'ok',
    page_count: paginas,
    char_count: tekst.length,
    doc_type: 'zip',
  }
}

// ── XLSX (prijsinventaris) ──────────────────────────────────────────────────

function extractXlsx(data: Uint8Array): ExtractResultaat {
  try {
    const blad = parseXlsx(Buffer.from(data))
    const regels = [blad.headers.join(' | '), ...blad.rows.map((r) => r.join(' | '))]
    const tekst = regels.filter((r) => r.replace(/\|/g, '').trim()).join('\n').trim()
    if (tekst.length < MIN_TEKENS_TOTAAL) return leeg('onleesbaar_leeg', 'xlsx')
    return { tekst, leesbaar: true, status: 'ok', page_count: 0, char_count: tekst.length, doc_type: 'xlsx' }
  } catch {
    return leeg('xlsx_corrupt', 'xlsx')
  }
}

// ── Ingang ──────────────────────────────────────────────────────────────────

export async function extractText(filename: string, data: Uint8Array): Promise<ExtractResultaat> {
  const ext = (filename.includes('.') ? filename.split('.').pop() ?? '' : '').toLowerCase()
  switch (ext) {
    case 'pdf':  return await extractPdf(data)
    case 'docx': return extractDocx(data)
    case 'zip':  return await extractZipBestand(data)
    // De prijsinventaris en de meetstaat komen vaak als Excel mee. Die lezer
    // hebben we al staan voor de lead-import, dus die gebruiken we hier ook —
    // zonder dat blad mis je precies de posten waar de prijs uit moet komen.
    case 'xlsx': return extractXlsx(data)
    // Het oude Word-formaat en RTF laten we bewust liggen: zeldzaam in
    // bestekken, en een lezer ervoor weegt niet op tegen de opbrengst.
    case 'doc':
    case 'rtf':  return leeg('formaat_niet_ondersteund', ext)
    default:     return leeg('type_overgeslagen', ext || 'onbekend')
  }
}

// ── Relevante stukken kiezen (scheelt AI-kosten) ────────────────────────────

/**
 * Een bestek van 150 pagina's volledig naar de AI sturen is verspilling. We
 * nemen het begin plus vensters rond de trefwoorden die er echt toe doen.
 */
const TREFWOORDEN = [
  'voorwerp', 'selectie', 'selectiecriteria', 'kwalitatieve selectie',
  'uitsluiting', 'uitsluitingsgronden', 'toegangsrecht',
  'financiële en economische draagkracht', 'economische draagkracht',
  'technische bekwaamheid', 'technische en beroepsbekwaamheid', 'omzet',
  'referenties', 'referentie', 'gunningscriteri', 'prijs', 'inventaris',
  'prijsinventaris', 'prijslijst', 'meetstaat', 'offerte', 'in te dienen',
  'gevraagde documenten', 'bij te voegen', 'indieningsdatum', 'uiterste datum',
  'opening van de offertes', 'erkenning', 'attest',
]

export function relevanteDelen(tekst: string, maxTekens = 24_000): string {
  const bron = tekst ?? ''
  if (bron.length <= maxTekens) return bron

  const laag = bron.toLowerCase()
  const vensters: [number, number][] = [[0, Math.min(4_000, bron.length)]]

  for (const woord of TREFWOORDEN) {
    let vanaf = 0
    // Per trefwoord hoogstens drie plekken: anders vult één veelvoorkomend
    // woord als "prijs" het hele budget.
    for (let n = 0; n < 3; n++) {
      const i = laag.indexOf(woord, vanaf)
      if (i < 0) break
      vensters.push([Math.max(0, i - 300), Math.min(bron.length, i + 1_500)])
      vanaf = i + woord.length
    }
  }

  // Overlappende vensters samenvoegen, zodat er niets dubbel meegaat.
  vensters.sort((a, b) => a[0] - b[0])
  const samen: [number, number][] = []
  for (const v of vensters) {
    const laatste = samen[samen.length - 1]
    if (laatste && v[0] <= laatste[1]) laatste[1] = Math.max(laatste[1], v[1])
    else samen.push([...v] as [number, number])
  }

  const stukken: string[] = []
  let gebruikt = 0
  for (const [a, b] of samen) {
    if (gebruikt >= maxTekens) break
    const stuk = bron.slice(a, Math.min(b, a + (maxTekens - gebruikt)))
    stukken.push(stuk)
    gebruikt += stuk.length
  }
  return stukken.join('\n[…]\n')
}
