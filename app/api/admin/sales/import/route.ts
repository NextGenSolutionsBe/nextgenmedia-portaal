import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaff } from '@/lib/supabase/server'
import { createLead, getOrCreateSalesOrg } from '@/lib/sales/service'
import { listPipelines, defaultPipelineId } from '@/lib/sales/pipelines'
import {
  parseCsv, guessMapping, sanitizeMapping, applyMapping, IMPORT_FIELDS,
  type ColumnMapping, type ParsedTable,
} from '@/lib/sales/import'
import { parseXlsxMetVerborgen } from '@/lib/sales/xlsx'
import { schoonRijen } from '@/lib/sales/lead-schoon'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 2000

/**
 * POST (multipart) — stap 1: bestand analyseren.
 * We PARSEN het bestand, raden de kolommen en laten de AI de onduidelijke
 * gevallen invullen. Er wordt hier NIETS opgeslagen: de gebruiker ziet eerst
 * een voorbeeld en bevestigt. (Platformregel: AI stelt voor, mens bevestigt.)
 */
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const fd = await req.formData()
    const file = fd.get('file') as File | null
    if (!file || file.size === 0) return NextResponse.json({ error: 'Geen bestand' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Bestand te groot (max 5 MB)' }, { status: 400 })

    const name = (file.name ?? '').toLowerCase()
    let table: ParsedTable
    // Rijen die in Excel verborgen zijn (een actief filter, of handmatig).
    // Die nemen we NIET stilletjes mee: wat de gebruiker in Excel ziet, is wat
    // er geïmporteerd wordt. We melden wel hoeveel er buiten beeld bleven.
    let verborgenRijen = 0
    if (name.endsWith('.xlsx')) {
      // Eigen lezer, zonder externe bibliotheek — zie lib/sales/xlsx.ts.
      const s = parseXlsxMetVerborgen(Buffer.from(await file.arrayBuffer()))
      table = { headers: s.headers, rows: s.rows }
      verborgenRijen = s.verborgen.length
    } else if (name.endsWith('.xls')) {
      return NextResponse.json({
        error: 'Dit is het oude Excel-formaat (.xls). Open het en kies “Opslaan als” → .xlsx of CSV.',
      }, { status: 400 })
    } else {
      table = parseCsv(await file.text())
    }
    if (table.headers.length === 0) return NextResponse.json({ error: 'Geen kolommen gevonden in dit bestand.' }, { status: 400 })
    if (table.rows.length === 0) return NextResponse.json({ error: 'Het bestand bevat geen rijen.' }, { status: 400 })
    if (table.rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Maximaal ${MAX_ROWS} rijen per import. Splits het bestand op.` }, { status: 400 })
    }

    // Eerst zelf raden; dat is meteen de terugval als de AI niets bruikbaars geeft.
    let mapping = guessMapping(table.headers)
    let aiUsed = false

    const unmapped = table.headers.filter((h) => !mapping[h])
    if (unmapped.length > 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        const ai = await askAi(table.headers, table.rows.slice(0, 5))
        if (ai) {
          const cleaned = sanitizeMapping(ai, table.headers)
          // Alleen de kolommen die wij NIET herkenden door de AI laten invullen;
          // onze eigen regels zijn betrouwbaarder voor de standaardgevallen.
          const taken = new Set(Object.values(mapping).filter(Boolean))
          for (const h of unmapped) {
            const v = cleaned[h]
            if (v && !taken.has(v)) { mapping[h] = v; taken.add(v) }
          }
          aiUsed = true
        }
      } catch { /* AI is hulp, geen voorwaarde */ }
    }

    // Het voorbeeld toont de rijen zoals ze er ná de schoonmaak uitzien —
    // anders keurt de gebruiker data goed die er straks anders in komt.
    const geschoond = schoonRijen(applyMapping(table, mapping))
    return NextResponse.json({
      headers: table.headers,
      rowCount: table.rows.length,
      verborgenRijen,
      sample: table.rows.slice(0, 5),
      mapping,
      preview: geschoond.rijen.slice(0, 10),
      schoonVerslag: geschoond.verslag,
      fields: IMPORT_FIELDS,
      aiUsed,
      // De ingelezen tabel gaat terug mee, zodat stap 2 niets opnieuw hoeft te
      // uploaden en CSV en Excel daarna identiek behandeld worden.
      table,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** Claude de kolomkoppen laten duiden. Antwoord is strikt JSON. */
async function askAi(headers: string[], sample: string[][]): Promise<Record<string, string> | null> {
  const fields = IMPORT_FIELDS.map((f) => `${f.key} = ${f.label}`).join('\n')
  const rows = sample.map((r) => r.join(' | ')).join('\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.BLOG_AI_MODEL || 'claude-sonnet-5',
      max_tokens: 1000,
      system:
        'Je bent een data-analist. Je koppelt kolomkoppen uit een prospectlijst aan vaste velden. ' +
        'Antwoord UITSLUITEND met JSON: een object waarin elke kolomkop een veldsleutel krijgt, ' +
        'of een lege string als de kolom nergens bij past. Verzin nooit een veldsleutel die niet in de lijst staat.',
      messages: [{
        role: 'user',
        content:
          `Beschikbare velden:\n${fields}\n\n` +
          `Kolomkoppen:\n${headers.join(' | ')}\n\n` +
          `Enkele voorbeeldrijen (ter controle van de inhoud):\n${rows}\n\n` +
          'Geef het JSON-object.',
      }],
    }),
  })
  if (!res.ok) return null
  const json = await res.json() as { content?: { text?: string }[] }
  const text = json.content?.map((c) => c.text ?? '').join('') ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) as Record<string, string> } catch { return null }
}

/**
 * PUT — stap 2: de bevestigde import uitvoeren.
 * Ontdubbeling gebeurt in createLead: een bedrijf dat al in de pipeline staat
 * wordt overgeslagen en gerapporteerd, nooit dubbel aangemaakt.
 */
export async function PUT(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const salesClientId = (await getOrCreateSalesOrg()).id
    const pipelines = await listPipelines()
    const pipelineId = pipelines.find((p) => p.id === String(b.pipelineId ?? ''))?.id
      ?? await defaultPipelineId()
    const mapping = (b.mapping ?? {}) as ColumnMapping
    const table = (b.table ?? null) as ParsedTable | null
    if (!table?.headers?.length) return NextResponse.json({ error: 'Geen gegevens ontvangen' }, { status: 400 })
    const clean = sanitizeMapping(mapping, table.headers)
    if (!Object.values(clean).includes('company.name')) {
      return NextResponse.json({ error: 'Wijs minstens één kolom toe aan “Bedrijfsnaam”.' }, { status: 400 })
    }
    if (table.rows.length > MAX_ROWS) return NextResponse.json({ error: `Maximaal ${MAX_ROWS} rijen.` }, { status: 400 })

    // Dezelfde schoonmaak als in het voorbeeld: wat de gebruiker zag, is wat
    // er wordt opgeslagen. Kale getallen in telefoon/e-mail/website sneuvelen.
    const geschoond = schoonRijen(applyMapping(table, clean))
    let created = 0, duplicate = 0, skipped = 0
    const problems: string[] = []

    for (const [i, r] of geschoond.rijen.entries()) {
      const companyName = (r.company.name ?? '').trim()
      if (!companyName) { skipped++; continue }   // rij zonder bedrijf is onbruikbaar
      const res = await createLead({
        salesClientId,
        pipelineId,
        company: {
          name: companyName,
          website: r.company.website, sector: r.company.sector,
          employees: r.company.employees ? Number(String(r.company.employees).replace(/\D/g, '')) || undefined : undefined,
          city: r.company.city, region: r.company.region, country: r.company.country,
          phone: r.company.phone, linkedin: r.company.linkedin,
          email: r.company.email, werkklasse: r.company.werkklasse,
          activiteit: r.company.activiteit,
          ondernemingsnummer: r.company.ondernemingsnummer,
          prioriteit: r.company.prioriteit,
        },
        contact: {
          name: r.contact.name, role: r.contact.role, email: r.contact.email,
          phone: r.contact.phone, mobile: r.contact.mobile, linkedin: r.contact.linkedin,
        },
      })
      if (res.ok) created++
      else if (res.existingLeadId) duplicate++
      else { skipped++; if (problems.length < 10) problems.push(`Rij ${i + 2}: ${res.error}`) }
    }

    return NextResponse.json({
      ok: true, created, duplicate, skipped, problems,
      opgeschoond: geschoond.verslag.opgeschoond,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
