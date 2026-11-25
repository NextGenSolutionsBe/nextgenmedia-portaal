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
