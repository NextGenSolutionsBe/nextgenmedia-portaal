// De pure kern van de .xlsx-lezer: XML → cellen. GEEN 'server-only', geen
// imports — dit is louter tekstverwerking en moet los testbaar zijn.
//
// Die testbaarheid is geen luxe. Deze code had een bug die maandenlang stil
// data verminkte: een lege cel MET opmaak wordt door Excel zelfsluitend
// geschreven (<c r="C2" s="3"/>), en de celregex met een gulzige [^>]* at de
// slash op, waarna het alternatief ">" meteen matchte en de VOLGENDE cel als
// binnenkant werd ingeslikt. Gevolg: bedrijfsnamen vielen weg en er doken kale
// indexcijfers op in telefoon- en e-mailkolommen — bewezen op de echte lijstbestanden.
//
// De fix is [^>]*? — lui. Dan krijgt "/>" de kans om te matchen zodra de
// attributen op zijn, en kan een cel nooit zijn buurman opslokken. Veilig,
// want attribuutwaarden kunnen geen ">" bevatten: het eerste sluitpunt dat de
// luie groep tegenkomt is altijd het echte einde van de tag.

export type Rij = { cellen: string[]; verborgen: boolean }

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
}

export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)
}

/** Kolomletters → index. 'A' = 0, 'Z' = 25, 'AA' = 26. */
export function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '')
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** De gedeelde tekstentabel: cellen met t="s" verwijzen hiernaar met een index. */
export function readSharedStrings(xml: string): string[] {
  const out: string[] = []
  // Eén <si> kan meerdere <t>-stukken hebben (bij gemengde opmaak); die horen
  // aan elkaar geplakt te worden tot één waarde.
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]))
    out.push(parts.join(''))
  }
  return out
}

/**
 * Werkblad-XML → rijen met celwaarden, inclusief of de rij in Excel verborgen
 * is. Verborgen rijen ontstaan door een actief filter of handmatig verbergen;
 * de AANROEPER beslist wat daarmee gebeurt — bij een leadimport wil je ze niet
 * stilletjes meenemen, want de gebruiker ziet ze in Excel ook niet.
 */
export function readSheet(xml: string, shared: string[]): Rij[] {
  const rows: Rij[] = []

  // OOK HIER lui ([^>]*?) mét het zelfsluitende alternatief. Excel schrijft een
  // rij die wel opmaak maar geen cellen heeft als <row r="2" ht="15"/> — met een
  // gulzige groep slokte die de VOLGENDE rij op, waardoor zichtbare rijen als
  // verborgen telden en andersom. Zelfde bugklasse als bij de cellen hieronder.
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const verborgen = /hidden="1"/.test(rowMatch[1])
    const inhoud = rowMatch[2] ?? ''
    const cells: string[] = []
    // LET OP: [^>]*? moet lui blijven — zie de toelichting bovenaan.
    for (const c of inhoud.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? ''
      const inner = c[2] ?? ''
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1]
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n'

      let value = ''
      if (type === 's') {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '')
        value = shared[idx] ?? ''
      } else if (type === 'inlineStr') {
        value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('')
      } else {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '')
        if (type === 'b') value = value === '1' ? 'waar' : value === '0' ? 'onwaar' : value
      }

      // Lege cellen worden in xlsx overgeslagen; met de celverwijzing (r="C2")
      // zetten we de waarde alsnog in de juiste kolom.
      const at = ref ? colIndex(ref) : cells.length
      // Excel gaat tot kolom XFD (16383). Alles daarboven is een vervalst
      // bestand dat ons gigabytes aan lege cellen zou laten alloceren.
      if (at > 16383 || at < 0) continue
      while (cells.length < at) cells.push('')
      cells[at] = value.trim()
    }
    rows.push({ cellen: cells, verborgen })
  }
  return rows
}
