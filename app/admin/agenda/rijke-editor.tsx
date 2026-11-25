'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TextStyle, Color, FontFamily } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import { Placeholder } from '@tiptap/extensions'
import { marked } from 'marked'
import {
  Bold, Italic, Underline, Strikethrough, Highlighter, Baseline, List, ListOrdered, ListChecks, Quote, Minus, Link2, ImagePlus, Table2,
  AlignLeft, AlignCenter, AlignRight, Undo2, Redo2, Loader2, Rows3, Columns3, Trash2, X, ChevronDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { LETTERTYPES, BEELD_TYPES, MAX_BEELD, type DocNode } from '@/lib/agenda/doc-opmaak'
import { actie, focusRing } from './gedeeld'

const MARKEER = [
  { naam: 'Geel', kleur: '#fef08a' }, { naam: 'Groen', kleur: '#bbf7d0' }, { naam: 'Blauw', kleur: '#bfdbfe' },
  { naam: 'Roze', kleur: '#fbcfe8' }, { naam: 'Oranje', kleur: '#fed7aa' }, { naam: 'Grijs', kleur: '#e5e7eb' },
]
const TEKSTKLEUR = [
  { naam: 'Grijs', kleur: '#6b6b6b' }, { naam: 'Rood', kleur: '#dc2626' }, { naam: 'Oranje', kleur: '#ea580c' },
  { naam: 'Groen', kleur: '#16a34a' }, { naam: 'Blauw', kleur: '#2563eb' }, { naam: 'Paars', kleur: '#7c3aed' },
]

/**
 * Oude documenten (en wat uit ClickUp komt) zijn markdown: één keer omzetten
 * naar opmaak. De editor leest enkel wat hij kent (geen scripts of eigen HTML).
 */
export function markdownNaarHtml(md: string): string {
  if (!md.trim()) return ''
  const html = marked.parse(md, { gfm: true, breaks: true, async: false }) as string
  if (typeof window === 'undefined') return html
  // Afvinklijstjes ("- [ ] …") als afvinklijst van de editor.
  const d = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  d.querySelectorAll('li > input[type="checkbox"], li > p > input[type="checkbox"]').forEach((cb) => {
    const li = cb.closest('li')!
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', (cb as HTMLInputElement).hasAttribute('checked') ? 'true' : 'false')
    li.parentElement?.setAttribute('data-type', 'taskList')
    cb.remove()
  })
  return d.body.firstElementChild?.innerHTML ?? html
}

type Props = {
  docId: string
  json: DocNode | null
  markdown: string
  mag: boolean
  onWijzig: (json: DocNode, tekst: string) => void
  onKlaar?: (e: Editor) => void
}

/** De editor van een document: zoals ClickUp, met een balk bovenaan. */
export function RijkeEditor({ docId, json, markdown, mag, onWijzig, onKlaar }: Props) {
  const opladen = useRef<(f: File) => Promise<void>>(async () => undefined)
  const editor = useEditor({
    immediatelyRender: false,
    editable: mag,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: !mag, autolink: true, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto'], HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      }),
      TextStyle, Color, FontFamily,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList, TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ allowBase64: false }),
      Placeholder.configure({ placeholder: mag ? 'Schrijf hier. Tip: # + spatie = titel, - = lijstje, 1. = nummering, [ ] = afvinklijst.' : 'Dit document is nog leeg.' }),
    ],
    content: json ?? markdownNaarHtml(markdown),
    editorProps: {
      attributes: { class: 'focus:outline-none', 'aria-label': 'Inhoud van het document' },
      // Een foto plakken of erin slepen: meteen opladen.
      handlePaste: (_v, e) => {
        const f = [...(e.clipboardData?.files ?? [])].filter((x) => x.type.startsWith('image/'))
        if (!f.length || !mag) return false
        f.forEach((x) => void opladen.current(x))
        return true
      },
      handleDrop: (_v, e) => {
        const f = [...((e as DragEvent).dataTransfer?.files ?? [])].filter((x) => x.type.startsWith('image/'))
        if (!f.length || !mag) return false
        e.preventDefault()
        f.forEach((x) => void opladen.current(x))
        return true
      },
    },
    onUpdate: ({ editor: e }) => onWijzig(e.getJSON() as DocNode, e.getText({ blockSeparator: '\n' })),
  })

  const [beeldBezig, setBeeldBezig] = useState(0)
  opladen.current = async (file: File) => {
    if (!editor) return
    if (!BEELD_TYPES[file.type]) { toast.error('Enkel foto\'s: png, jpg, gif of webp.'); return }
    if (file.size > MAX_BEELD) { toast.error('De afbeelding is groter dan 10 MB.'); return }
    setBeeldBezig((n) => n + 1)
    try {
      const r = await actie<{ pad: string; token: string; bucket: string; src: string }>({ actie: 'doc.beeld', id: docId, type: file.type, grootte: file.size })
      const { error } = await createClient().storage.from(r.bucket).uploadToSignedUrl(r.pad, r.token, file, { contentType: file.type })
      if (error) throw new Error(error.message)
      editor.chain().focus().setImage({ src: r.src, alt: file.name.replace(/\.[^.]+$/, '') }).run()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally { setBeeldBezig((n) => n - 1) }
  }

  useEffect(() => { if (editor) editor.setEditable(mag) }, [editor, mag])
  useEffect(() => { if (editor) onKlaar?.(editor) }, [editor, onKlaar])

  if (!editor) return <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  return (
    <div className="ag-doc">
      {mag && <Balk editor={editor} onBeeld={(f) => opladen.current(f)} beeldBezig={beeldBezig > 0} />}
      <EditorContent editor={editor} />
    </div>
  )
}

// ── De balk ─────────────────────────────────────────────────────────────────

function Balk({ editor, onBeeld, beeldBezig }: { editor: Editor; onBeeld: (f: File) => void; beeldBezig: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      stijl: e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      letter: (e.getAttributes('textStyle').fontFamily as string | undefined) ?? '',
      vet: e.isActive('bold'), schuin: e.isActive('italic'), onder: e.isActive('underline'), door: e.isActive('strike'),
      markeer: e.isActive('highlight'), kleur: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      bullets: e.isActive('bulletList'), nummers: e.isActive('orderedList'), vinken: e.isActive('taskList'),
      citaat: e.isActive('blockquote'), link: e.isActive('link'), tabel: e.isActive('table'),
      links: e.isActive({ textAlign: 'left' }), midden: e.isActive({ textAlign: 'center' }), rechts: e.isActive({ textAlign: 'right' }),
      terug: e.can().undo(), vooruit: e.can().redo(),
    }),
  })
  const [open, setOpen] = useState<null | 'markeer' | 'kleur' | 'link'>(null)
  const [url, setUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const c = () => editor.chain().focus()
  const zetStijl = (v: string) => {
    if (v === 'p') c().setParagraph().run()
    else c().toggleHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run()
  }
  const zetLink = () => {
    const u = url.trim()
    if (!u) { c().extendMarkRange('link').unsetLink().run(); setOpen(null); return }
    const href = /^(https?:\/\/|mailto:)/i.test(u) ? u : /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(u) ? `mailto:${u}` : `https://${u}`
    c().extendMarkRange('link').setLink({ href }).run()
    setOpen(null)
  }

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-4 rounded-xl border border-gray-200 bg-white/95 backdrop-blur px-1.5 py-1 shadow-sm">
      <div className="flex flex-wrap items-center gap-0.5">
        <select value={s.stijl} onChange={(e) => zetStijl(e.target.value)} aria-label="Stijl" className="h-8 w-[7.2rem] rounded-lg border-0 bg-transparent pl-2 pr-7 text-sm hover:bg-gray-100 focus:ring-0 cursor-pointer">
          <option value="p">Tekst</option><option value="h1">Titel</option><option value="h2">Ondertitel</option><option value="h3">Kop</option>
        </select>
        <select value={s.letter} onChange={(e) => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())} aria-label="Lettertype" className="h-8 w-[8.4rem] rounded-lg border-0 bg-transparent pl-2 pr-7 text-sm hover:bg-gray-100 focus:ring-0 cursor-pointer">
          {LETTERTYPES.map((l) => <option key={l.label} value={l.waarde ?? ''}>{l.label}</option>)}
        </select>
        <Streep />
        <Knop aan={s.vet} label="Vet (Ctrl+B)" onClick={() => c().toggleBold().run()}><Bold className="h-4 w-4" /></Knop>
        <Knop aan={s.schuin} label="Schuin (Ctrl+I)" onClick={() => c().toggleItalic().run()}><Italic className="h-4 w-4" /></Knop>
        <Knop aan={s.onder} label="Onderlijnen (Ctrl+U)" onClick={() => c().toggleUnderline().run()}><Underline className="h-4 w-4" /></Knop>
        <Knop aan={s.door} label="Doorstrepen" onClick={() => c().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Knop>
        <div className="relative">
          <Knop aan={s.markeer} label="Markeren" onClick={() => setOpen(open === 'markeer' ? null : 'markeer')}><Highlighter className="h-4 w-4" /><ChevronDown className="h-3 w-3 -ml-0.5" /></Knop>
          {open === 'markeer' && (
            <Kleuren kleuren={MARKEER} onKies={(k) => { c().toggleHighlight({ color: k }).run(); setOpen(null) }} onGeen={() => { c().unsetHighlight().run(); setOpen(null) }} geen="Niet markeren" />
          )}
        </div>
        <div className="relative">
          <Knop aan={!!s.kleur} label="Tekstkleur" onClick={() => setOpen(open === 'kleur' ? null : 'kleur')}><Baseline className="h-4 w-4" style={s.kleur ? { color: s.kleur } : undefined} /><ChevronDown className="h-3 w-3 -ml-0.5" /></Knop>
          {open === 'kleur' && (
            <Kleuren kleuren={TEKSTKLEUR} tekst onKies={(k) => { c().setColor(k).run(); setOpen(null) }} onGeen={() => { c().unsetColor().run(); setOpen(null) }} geen="Zwart" />
          )}
        </div>
        <Streep />
        <Knop aan={s.bullets} label="Lijstje met bolletjes" onClick={() => c().toggleBulletList().run()}><List className="h-4 w-4" /></Knop>
        <Knop aan={s.nummers} label="Genummerde lijst (1, 2, 3)" onClick={() => c().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Knop>
        <Knop aan={s.vinken} label="Afvinklijst" onClick={() => c().toggleTaskList().run()}><ListChecks className="h-4 w-4" /></Knop>
        <Knop aan={s.citaat} label="Citaat of samenvatting" onClick={() => c().toggleBlockquote().run()}><Quote className="h-4 w-4" /></Knop>
        <Knop label="Scheidingslijn" onClick={() => c().setHorizontalRule().run()}><Minus className="h-4 w-4" /></Knop>
        <Streep />
        <Knop aan={s.links} label="Links uitlijnen" onClick={() => c().setTextAlign('left').run()}><AlignLeft className="h-4 w-4" /></Knop>
        <Knop aan={s.midden} label="Centreren" onClick={() => c().setTextAlign('center').run()}><AlignCenter className="h-4 w-4" /></Knop>
        <Knop aan={s.rechts} label="Rechts uitlijnen" onClick={() => c().setTextAlign('right').run()}><AlignRight className="h-4 w-4" /></Knop>
        <Streep />
        <div className="relative">
          <Knop aan={s.link} label="Link" onClick={() => { setUrl((editor.getAttributes('link').href as string | undefined) ?? ''); setOpen(open === 'link' ? null : 'link') }}><Link2 className="h-4 w-4" /></Knop>
          {open === 'link' && (
            <div className="absolute left-0 top-full mt-1 z-20 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-xl flex gap-1.5">
              <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); zetLink() } if (e.key === 'Escape') setOpen(null) }}
                placeholder="https://…" className="input-base !py-1 text-sm flex-1" aria-label="Adres van de link" />
              <button type="button" onClick={zetLink} className="btn-primary !py-1 !px-2.5 !text-xs">{url.trim() ? 'Zet' : 'Weg'}</button>
            </div>
          )}
        </div>
        <Knop label="Afbeelding" onClick={() => fileRef.current?.click()}>{beeldBezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}</Knop>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden"
          onChange={(e) => { [...(e.target.files ?? [])].forEach(onBeeld); e.target.value = '' }} />
        <Knop aan={s.tabel} label="Tabel" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className="h-4 w-4" /></Knop>
        <span className="flex-1" />
        <Knop label="Ongedaan maken (Ctrl+Z)" disabled={!s.terug} onClick={() => c().undo().run()}><Undo2 className="h-4 w-4" /></Knop>
        <Knop label="Opnieuw" disabled={!s.vooruit} onClick={() => c().redo().run()}><Redo2 className="h-4 w-4" /></Knop>
      </div>
      {s.tabel && (
        <div className="flex flex-wrap items-center gap-1 border-t border-gray-100 mt-1 pt-1 text-xs">
          <span className="label-mono text-[10px] uppercase text-gray-500 px-1.5">Tabel</span>
          <TekstKnop onClick={() => c().addRowAfter().run()}><Rows3 className="h-3.5 w-3.5" />Rij erbij</TekstKnop>
          <TekstKnop onClick={() => c().addColumnAfter().run()}><Columns3 className="h-3.5 w-3.5" />Kolom erbij</TekstKnop>
          <TekstKnop onClick={() => c().deleteRow().run()}><X className="h-3.5 w-3.5" />Rij weg</TekstKnop>
          <TekstKnop onClick={() => c().deleteColumn().run()}><X className="h-3.5 w-3.5" />Kolom weg</TekstKnop>
          <TekstKnop onClick={() => c().toggleHeaderRow().run()}>Kopregel aan/uit</TekstKnop>
          <TekstKnop onClick={() => c().mergeOrSplit().run()}>Cellen samenvoegen/splitsen</TekstKnop>
          <TekstKnop gevaar onClick={() => c().deleteTable().run()}><Trash2 className="h-3.5 w-3.5" />Tabel weg</TekstKnop>
        </div>
      )}
      {open && <div className="fixed inset-0 z-[9]" aria-hidden onMouseDown={() => setOpen(null)} />}
    </div>
  )
}

function Knop({ aan = false, label, onClick, disabled, children }: { aan?: boolean; label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={aan}
      className={`h-8 min-w-[30px] px-1 rounded-lg inline-flex items-center justify-center gap-0.5 disabled:opacity-30 ${aan ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'} ${focusRing}`}>
      {children}
    </button>
  )
}
function TekstKnop({ onClick, children, gevaar = false }: { onClick: () => void; children: React.ReactNode; gevaar?: boolean }) {
  return <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${gevaar ? 'text-red-700 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'} ${focusRing}`}>{children}</button>
}
const Streep = () => <span className="mx-0.5 h-5 w-px bg-gray-200" aria-hidden />

function Kleuren({ kleuren, onKies, onGeen, geen, tekst = false }: { kleuren: { naam: string; kleur: string }[]; onKies: (k: string) => void; onGeen: () => void; geen: string; tekst?: boolean }) {
  return (
    <div className="absolute left-0 top-full mt-1 z-20 rounded-xl border border-gray-200 bg-white p-2 shadow-xl w-48">
      <div className="grid grid-cols-6 gap-1.5">
        {kleuren.map((k) => (
          <button key={k.kleur} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onKies(k.kleur)} title={k.naam} aria-label={k.naam}
            className={`h-6 w-6 rounded-md border border-black/10 flex items-center justify-center text-[11px] font-bold ${focusRing}`} style={tekst ? { color: k.kleur } : { background: k.kleur }}>
            {tekst ? 'A' : ''}
          </button>
        ))}
      </div>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onGeen} className="mt-2 w-full text-left text-xs text-gray-600 hover:underline">{geen}</button>
    </div>
  )
}
