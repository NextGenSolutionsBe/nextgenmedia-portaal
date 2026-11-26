/**
 * Opgemaakte documenten in de agenda (TipTap). De opmaak wordt bewaard als
 * JSON en enkel getoond via de editor (zelfde schema), nooit als ruwe HTML.
 * Voor het bewaren kijkt de server alles na: enkel gekende blokken en
 * opmaak, links enkel naar http(s), mailto of de app zelf, afbeeldingen enkel
 * uit de agenda (of https).
 */

export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; marks?: { type: string; attrs?: Record<string, unknown> }[]; text?: string }

/** Afbeelding in een document: `<doc-id>/<uuid>.<ext>` in de bucket agenda, onder docs/. */
export const BEELD_PAD = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/
export const BEELD_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
export const MAX_BEELD = 10 * 1024 * 1024
const BEELD_SRC = '/api/admin/agenda?docbeeld='

/** De lettertypes die je kan kiezen (de waarde gaat zo in de CSS). */
export const LETTERTYPES: { label: string; waarde: string | null }[] = [
  { label: 'Archivo', waarde: null },
  { label: 'JetBrains Mono', waarde: 'var(--font-mono), "JetBrains Mono", monospace' },
  { label: 'Serif', waarde: 'Georgia, "Times New Roman", serif' },
  { label: 'Arial', waarde: 'Arial, Helvetica, sans-serif' },
]

const KNOPEN: Record<string, string[]> = {
  doc: [], paragraph: ['textAlign'], text: [], heading: ['level', 'textAlign'], bulletList: [], orderedList: ['start', 'type'], listItem: [],
  taskList: [], taskItem: ['checked'], blockquote: [], horizontalRule: [], hardBreak: [], codeBlock: ['language'],
  table: [], tableRow: [], tableHeader: ['colspan', 'rowspan', 'colwidth', 'backgroundColor'], tableCell: ['colspan', 'rowspan', 'colwidth', 'backgroundColor'],
  image: ['src', 'alt', 'title', 'width', 'height'],
}
const MARKEN = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'highlight', 'textStyle'])
const KLEUR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i
const LETTER = new Set(LETTERTYPES.map((l) => l.waarde).filter(Boolean) as string[])

export function veiligeLink(href: unknown): string | null {
  if (typeof href !== 'string') return null
  const h = href.trim()
  if (/^(https?:\/\/|mailto:)/i.test(h) || /^\/(?!\/)/.test(h)) return h.slice(0, 2000)
  return null
}
export function veiligBeeld(src: unknown): string | null {
  if (typeof src !== 'string') return null
  if (src.startsWith(BEELD_SRC) && BEELD_PAD.test(src.slice(BEELD_SRC.length))) return src
  if (/^https:\/\/[^\s"'<>]+$/i.test(src) && src.length <= 2000) return src
  return null
}

function schoonAttrs(type: string, a: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!a) return undefined
  const uit: Record<string, unknown> = {}
  for (const k of KNOPEN[type] ?? []) {
    const v = a[k]
    if (v === undefined || v === null) continue
    if (k === 'level') { const n = Number(v); if ([1, 2, 3].includes(n)) uit.level = n }
    else if (k === 'textAlign') { if (['left', 'center', 'right', 'justify'].includes(String(v))) uit.textAlign = v }
    else if (k === 'checked') uit.checked = v === true
    else if (k === 'start' || k === 'colspan' || k === 'rowspan') { const n = Number(v); if (Number.isInteger(n) && n >= 1 && n <= 1000) uit[k] = n }
    else if (k === 'colwidth') { if (Array.isArray(v)) uit.colwidth = v.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n < 4000).slice(0, 50) }
    else if (k === 'width' || k === 'height') { const n = Number(v); if (Number.isFinite(n) && n > 0 && n < 5000) uit[k] = n }
    else if (k === 'backgroundColor') { if (typeof v === 'string' && KLEUR.test(v)) uit[k] = v }
    else if (k === 'src') { const s = veiligBeeld(v); if (s) uit.src = s }
    else if (typeof v === 'string') uit[k] = v.slice(0, 300)
  }
  return Object.keys(uit).length ? uit : undefined
}

function schoonMarken(m: DocNode['marks']): DocNode['marks'] {
  if (!Array.isArray(m)) return undefined
  const uit: NonNullable<DocNode['marks']> = []
  for (const x of m) {
    if (!x || typeof x !== 'object' || !MARKEN.has(x.type)) continue
    if (x.type === 'link') { const href = veiligeLink(x.attrs?.href); if (href) uit.push({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } }); continue }
    if (x.type === 'highlight') { const c = x.attrs?.color; uit.push(typeof c === 'string' && KLEUR.test(c) ? { type: 'highlight', attrs: { color: c } } : { type: 'highlight' }); continue }
    if (x.type === 'textStyle') {
      const attrs: Record<string, unknown> = {}
      if (typeof x.attrs?.color === 'string' && KLEUR.test(x.attrs.color)) attrs.color = x.attrs.color
      if (typeof x.attrs?.fontFamily === 'string' && LETTER.has(x.attrs.fontFamily)) attrs.fontFamily = x.attrs.fontFamily
      if (Object.keys(attrs).length) uit.push({ type: 'textStyle', attrs })
      continue
    }
    uit.push({ type: x.type })
  }
  return uit.length ? uit : undefined
}

function schoonNode(n: unknown, diepte: number): DocNode | null {
  if (!n || typeof n !== 'object' || diepte > 60) return null
  const o = n as DocNode
  if (typeof o.type !== 'string' || !(o.type in KNOPEN)) return null
  if (o.type === 'text') {
    if (typeof o.text !== 'string' || !o.text) return null
    const marks = schoonMarken(o.marks)
    return { type: 'text', text: o.text.slice(0, 100_000), ...(marks ? { marks } : {}) }
  }
  if (o.type === 'image' && !veiligBeeld(o.attrs?.src)) return null
  const attrs = schoonAttrs(o.type, o.attrs)
  const content = Array.isArray(o.content) ? o.content.map((c) => schoonNode(c, diepte + 1)).filter((c): c is DocNode => !!c) : undefined
  return { type: o.type, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) }
}

/** Een document zoals de editor het geeft, nagekeken. Ongeldig of te groot = null. */
export function schoonDocJson(json: unknown, _docId?: string): DocNode | null {
  if (!json || typeof json !== 'object' || (json as DocNode).type !== 'doc') return null
  try { if (JSON.stringify(json).length > 2_000_000) return null } catch { return null }
  const uit = schoonNode(json, 0)
  if (!uit) return null
  if (!uit.content?.length) uit.content = [{ type: 'paragraph' }]
  return uit
}

/** De gewone tekst van een document (voor zoeken en als ClickUp-tekst). */
export function tekstVanDoc(n: DocNode | null | undefined): string {
  if (!n) return ''
  if (n.type === 'text') return n.text ?? ''
  const binnen = (n.content ?? []).map(tekstVanDoc)
  const blok = ['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'tableRow'].includes(n.type)
  if (n.type === 'tableRow') return binnen.join(' | ') + '\n'
  if (n.type === 'hardBreak') return '\n'
  return binnen.join(blok || n.type === 'doc' ? '' : '') + (blok ? '\n' : '')
}

// ── Opgemaakte beschrijving van een taak (26 nov 2026) ──────────────────────
// De opmaak staat als JSON (ag_items.beschrijving_json); de tekst ernaast
// (ag_items.beschrijving) is markdown, zodat zoeken, de pdf, Dag afsluiten en
// het lezen zonder opmaak blijven werken. Markdown verliest enkel de kleuren.

const ontsnap = (t: string) => t.replace(/([\\`*_[\]])/g, '\\$1')

function inlineMd(nodes: DocNode[] | undefined): string {
  let uit = ''
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') { uit += '\n'; continue }
    if (n.type === 'image') { const src = typeof n.attrs?.src === 'string' ? n.attrs.src : ''; if (src) uit += `![${String(n.attrs?.alt ?? '')}](${src})`; continue }
    if (n.type !== 'text' || !n.text) continue
    const marks = new Set((n.marks ?? []).map((m) => m.type))
    const code = marks.has('code')
    let t = code ? `\`${n.text.replace(/`/g, '')}\`` : ontsnap(n.text)
    if (!code) {
      // Spaties aan de rand vallen buiten de tekens (anders leest markdown "** vet**" niet als vet).
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t)!
      let kern = m[2]
      if (kern) {
        if (marks.has('strike')) kern = `~~${kern}~~`
        if (marks.has('italic')) kern = `*${kern}*`
        if (marks.has('bold')) kern = `**${kern}**`
      }
      t = m[1] + kern + m[3]
    }
    const link = (n.marks ?? []).find((m) => m.type === 'link')
    if (link && typeof link.attrs?.href === 'string') t = `[${t}](${link.attrs.href})`
    uit += t
  }
  return uit
}

const inspringen = (t: string, n: number) => t.split('\n').map((r, i) => (i === 0 || !r ? r : ' '.repeat(n) + r)).join('\n')

function blokMd(n: DocNode): string {
  switch (n.type) {
    case 'paragraph': {
      const t = inlineMd(n.content)
      return /^(#{1,6}\s|>|[-+*]\s|\d+[.)]\s)/.test(t) ? `\\${t}` : t
    }
    case 'heading': return `${'#'.repeat(Math.min(3, Math.max(1, Number(n.attrs?.level) || 1)))} ${inlineMd(n.content)}`
    case 'bulletList': return (n.content ?? []).map((li) => `- ${inspringen(itemMd(li), 2)}`).join('\n')
    case 'orderedList': {
      const start = Number(n.attrs?.start) || 1
      return (n.content ?? []).map((li, i) => `${start + i}. ${inspringen(itemMd(li), 3)}`).join('\n')
    }
    case 'taskList': return (n.content ?? []).map((li) => `- [${li.attrs?.checked === true ? 'x' : ' '}] ${inspringen(itemMd(li), 2)}`).join('\n')
    case 'blockquote': return (n.content ?? []).map(blokMd).join('\n\n').split('\n').map((r) => `> ${r}`).join('\n')
    case 'horizontalRule': return '---'
    case 'codeBlock': return `\`\`\`\n${(n.content ?? []).map((c) => c.text ?? '').join('')}\n\`\`\``
    case 'image': return inlineMd([n])
    case 'table': {
      const rijen = (n.content ?? []).map((r) => (r.content ?? []).map((cel) => (cel.content ?? []).map((b) => (b.type === 'paragraph' || b.type === 'heading' ? inlineMd(b.content) : blokMd(b))).join(' ').replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()))
      if (!rijen.length) return ''
      const breed = Math.max(...rijen.map((r) => r.length))
      const rij = (r: string[]) => `| ${[...r, ...Array(breed - r.length).fill('')].join(' | ')} |`
      return [rij(rijen[0]), `| ${Array(breed).fill('---').join(' | ')} |`, ...rijen.slice(1).map(rij)].join('\n')
    }
    default: return (n.content ?? []).map(blokMd).filter(Boolean).join('\n\n')
  }
}

function itemMd(li: DocNode): string {
  return (li.content ?? []).map(blokMd).join('\n')
}

/** De opmaak als markdown (de tekst naast de opmaak). */
export function markdownVanDoc(doc: DocNode | null | undefined): string {
  if (!doc) return ''
  return (doc.content ?? []).map(blokMd).filter((b) => b.trim() !== '').join('\n\n').trim()
}

/** Gewone tekst als alinea's (enkel **vet** wordt herkend, een enkele regelovergang blijft een regel). */
function alineasUit(tekst: string): DocNode[] {
  return tekst.split(/\n{2,}/).map((a) => a.trim()).filter(Boolean).map((a) => {
    const content: DocNode[] = []
    a.split('\n').forEach((regel, i) => {
      if (i) content.push({ type: 'hardBreak' })
      const delen = regel.split(/(\*\*[^*]+\*\*)/)
      for (const d of delen) {
        if (!d) continue
        const vet = /^\*\*([^*]+)\*\*$/.exec(d)
        content.push(vet ? { type: 'text', text: vet[1], marks: [{ type: 'bold' }] } : { type: 'text', text: d })
      }
    })
    return { type: 'paragraph', ...(content.length ? { content } : {}) }
  })
}

/**
 * De tekst werd buiten de editor aangepast (bv. een notitie bij Dag afsluiten).
 * Kwam er enkel iets onderaan bij, dan zetten we dat ook onder de opmaak, zodat
 * markeringen en tabellen blijven. Anders null: dan geldt de tekst.
 */
export function vulDocAan(doc: DocNode | null | undefined, oudeTekst: string | null | undefined, nieuweTekst: string | null | undefined): DocNode | null {
  if (!doc || doc.type !== 'doc') return null
  const oud = (oudeTekst ?? '').trimEnd()
  const nieuw = nieuweTekst ?? ''
  if (!nieuw.startsWith(oud)) return null
  const extra = nieuw.slice(oud.length).trim()
  if (!extra) return doc
  return { ...doc, content: [...(doc.content ?? []), ...alineasUit(extra)] }
}
