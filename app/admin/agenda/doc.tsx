'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import type { Editor } from '@tiptap/react'
import { Loader2, Printer, Trash2, Lock, Check, ChevronRight, Users, ChevronDown } from 'lucide-react'
import { PersoonFoto } from '@/components/admin/persoon-foto'
import type { DocNode } from '@/lib/agenda/doc-opmaak'
import { actie, api, padVan, focusRing, Schakel, ApiFout, Popover, PersonenLijst, type BoomData } from './gedeeld'

// De editor laadt pas als je een document opent (hij is groot).
const RijkeEditor = dynamic(() => import('./rijke-editor').then((m) => m.RijkeEditor), {
  ssr: false, loading: () => <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>,
})

type Doc = { id: string; titel: string; inhoud: string | null; inhoud_json?: DocNode | null; space_id: string | null; map_id: string | null; lijst_id: string | null; prive: boolean; eigenaar_id: string | null; kijkers: string[] | null; item_id?: string | null; bijgewerkt_door: string | null; updated_at: string; created_at: string }

/** Een document zoals in ClickUp: titels, lijsten, markeren, tabellen, afbeeldingen. Bewaart vanzelf, afdrukken als pdf. */
export function DocWeergave({ id, boom, onVerwijderd, onVernieuw, onOpenItem }: { id: string; boom: BoomData; onVerwijderd: () => void; onVernieuw: () => void; onOpenItem?: (id: string) => void }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [titel, setTitel] = useState('')
  const [status, setStatus] = useState<'bewaard' | 'bezig' | 'wijziging'>('bewaard')
  const [sleutel, setSleutel] = useState(0)
  const versie = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Wat nog bewaard moet worden: de titel en (als ze veranderde) de inhoud.
  const wacht = useRef<{ titel: string; json?: DocNode; tekst?: string } | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const mag = !!boom.rechten.aanpassen

  const laad = useCallback(async () => {
    try {
      const j = await api<{ doc: Doc }>(`/api/admin/agenda?doc=${id}`)
      setDoc(j.doc); setTitel(j.doc.titel)
      versie.current = j.doc.updated_at; setFout(null); setStatus('bewaard'); wacht.current = null
      setSleutel((n) => n + 1)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [id])
  useEffect(() => { setDoc(null); laad() }, [laad])

  const bewaar = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const w = wacht.current
    if (!w) return
    wacht.current = null
    setStatus('bezig')
    try {
      const body: Record<string, unknown> = { actie: 'doc.wijzig', id, titel: w.titel.trim() || 'Naamloos document', versie: versie.current }
      if (w.json) { body.inhoud_json = w.json; body.inhoud = (w.tekst ?? '').slice(0, 500_000) }
      const r = await actie<{ ok: true; versie: string }>(body)
      versie.current = r.versie
      setStatus(wacht.current ? 'wijziging' : 'bewaard')
      if (w.titel !== doc?.titel) onVernieuw()
    } catch (e) {
      // Niet verloren: de wijziging blijft wachten tot de volgende poging.
      wacht.current = { ...w, ...(wacht.current ?? {}) }
      setStatus('wijziging')
      toast.error(e instanceof Error ? e.message : 'Bewaren mislukt')
      if (e instanceof ApiFout && e.status === 409) { wacht.current = null; laad() }
    }
  }, [id, doc?.titel, onVernieuw, laad])

  // Bewaart 1 seconde na het typen, en meteen bij het verlaten.
  const plan = useCallback((w: { titel?: string; json?: DocNode; tekst?: string }) => {
    wacht.current = { titel: w.titel ?? wacht.current?.titel ?? titelRef.current, ...(wacht.current?.json ? { json: wacht.current.json, tekst: wacht.current.tekst } : {}), ...(w.json ? { json: w.json, tekst: w.tekst } : {}) }
    setStatus('wijziging')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void bewaar() }, 1000)
  }, [bewaar])
  const titelRef = useRef(titel)
  titelRef.current = titel
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    const weg = (e: BeforeUnloadEvent) => { if (status !== 'bewaard') { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', weg)
    return () => window.removeEventListener('beforeunload', weg)
  }, [status])
  // Een ander document openen: wat nog wacht eerst bewaren.
  useEffect(() => () => { if (wacht.current) void bewaar() }, [bewaar])

  const verwijder = async () => {
    if (!doc || !confirm(`"${doc.titel}" naar de prullenbak? Je kan het daar terugzetten.`)) return
    try {
      await actie({ actie: 'doc.verwijder', id })
      toast.success('Naar de prullenbak', { action: { label: 'Ongedaan maken', onClick: () => { actie({ actie: 'doc.herstel', id }).then(onVernieuw).catch(() => toast.error('Terugzetten mislukt')) } } })
      onVerwijderd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }

  const druk = () => {
    const w = window.open('', '_blank', 'width=820,height=900')
    if (!w) { toast.error('Je browser blokkeerde het afdrukvenster.'); return }
    // De HTML komt uit de editor zelf (enkel gekende opmaak), niet uit vrije tekst.
    const html = editorRef.current?.getHTML() ?? ''
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    w.document.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><base href="${esc(window.location.origin)}/"><title>${esc(titel)}</title><style>${AFDRUK_CSS}</style></head><body><h1 class="doc-titel">${esc(titel)}</h1>
      <div class="meta">NextGen Agency · ${esc(padVan(boom, doc?.lijst_id ?? null).join(' › ') || 'Agenda')} · ${new Date().toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })}</div><div class="ag-doc">${html}</div></body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 500)
  }

  if (fout) return <div className="card-base text-sm text-red-700">{fout}</div>
  if (!doc) return <div className="card-base flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const pad = doc.lijst_id ? padVan(boom, doc.lijst_id) : doc.map_id ? [boom.mappen.find((m) => m.id === doc.map_id)?.naam ?? ''] : doc.space_id ? [boom.spaces.find((s) => s.id === doc.space_id)?.naam ?? ''] : []
  return (
    <div className="card-base !p-0 overflow-hidden flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-100">
        {doc.item_id && onOpenItem && <button type="button" onClick={() => onOpenItem(doc.item_id!)} className={`btn-secondary !py-1 !px-2.5 !text-xs shrink-0 ${focusRing}`}><ChevronRight className="h-3.5 w-3.5 rotate-180" />Naar de taak</button>}
        <div className="flex-1 min-w-0 text-xs text-gray-500 flex items-center gap-1 truncate">{pad.map((p, n) => <span key={n} className="flex items-center gap-1">{p}{n < pad.length - 1 && <ChevronRight className="h-3 w-3" />}</span>)}</div>
        <span className="text-[11px] text-gray-400 flex items-center gap-1">{status === 'bezig' ? <><Loader2 className="h-3 w-3 animate-spin" />Bewaren…</> : status === 'wijziging' ? 'Niet bewaard' : <><Check className="h-3 w-3" />Bewaard</>}</span>
        <button type="button" onClick={druk} className={`btn-secondary !py-1 !px-2.5 !text-xs ${focusRing}`}><Printer className="h-3.5 w-3.5" />Afdrukken</button>
        {boom.rechten.verwijderen && <button type="button" onClick={verwijder} aria-label="Naar de prullenbak" className={`h-8 w-8 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600 flex items-center justify-center ${focusRing}`}><Trash2 className="h-4 w-4" /></button>}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-10 pt-4 pb-16">
          <input value={titel} disabled={!mag} onChange={(e) => { setTitel(e.target.value); plan({ titel: e.target.value }) }} onBlur={() => { void bewaar() }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editorRef.current?.commands.focus('start') } }}
            className="w-full text-3xl font-bold bg-transparent border-0 p-0 mt-4 mb-2 focus:ring-0 focus:outline-none" aria-label="Titel" placeholder="Titel" />
          <div className="flex flex-wrap items-center gap-3 mb-5 text-xs text-gray-500">
            <span>Laatst aangepast {new Date(doc.updated_at).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' })}{doc.bijgewerkt_door ? ` door ${doc.bijgewerkt_door}` : ''}</span>
            <WieZietDit doc={doc} boom={boom} mag={mag} versie={versie} onDoc={(d) => { setDoc((x) => (x ? { ...x, prive: d.prive, kijkers: d.kijkers, eigenaar_id: d.eigenaar_id, updated_at: d.updated_at } : d)); onVernieuw() }} />
          </div>
          <div onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void bewaar() } }} onBlur={() => { if (wacht.current) void bewaar() }}>
            <RijkeEditor key={`${doc.id}:${sleutel}`} docId={doc.id} json={doc.inhoud_json ?? null} markdown={doc.inhoud ?? ''} mag={mag}
              onKlaar={(e) => { editorRef.current = e }}
              onWijzig={(json, tekst) => plan({ json, tekst })} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Opmaak voor het afdrukken (zelfde als in de app). */
const AFDRUK_CSS = `@page{margin:18mm}body{font-family:Archivo,Helvetica,Arial,sans-serif;color:#0f0f0f;font-size:11pt;line-height:1.55}
.doc-titel{font-size:22pt;margin:0 0 4pt}.meta{font-family:'JetBrains Mono',monospace;font-size:8pt;color:#6e6e6e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:16pt}
h1{font-size:17pt;margin:14pt 0 6pt}h2{font-size:14pt;margin:12pt 0 5pt}h3{font-size:12pt;margin:10pt 0 4pt}p{margin:0 0 5pt}
ul,ol{padding-left:18pt;margin:0 0 6pt}ul[data-type="taskList"]{list-style:none;padding-left:2pt}ul[data-type="taskList"] li{display:flex;gap:6pt}
ul[data-type="taskList"] li>label{flex:none}li[data-checked="true"]>div{text-decoration:line-through;color:#888}
blockquote{border-left:3px solid #ccc;margin:6pt 0;padding-left:10pt;color:#444}hr{border:0;border-top:1px solid #ddd;margin:12pt 0}
table{border-collapse:collapse;width:100%;margin:8pt 0}td,th{border:1px solid #ccc;padding:4pt 6pt;vertical-align:top;text-align:left}th{background:#f3f3f3}
img{max-width:100%;border-radius:6pt}mark{padding:0 1pt;border-radius:2pt}a{color:#0f0f0f}code{font-family:'JetBrains Mono',monospace;font-size:9.5pt;background:#f3f3f3;padding:0 2pt}
pre{background:#f3f3f3;padding:6pt 8pt;border-radius:4pt;white-space:pre-wrap}`

/** Wie ziet dit doc? Iedereen die de map of lijst ziet, of privé: de eigenaar en wie je toevoegt. */
function WieZietDit({ doc, boom, mag, versie, onDoc }: { doc: Doc; boom: BoomData; mag: boolean; versie: React.MutableRefObject<string | null>; onDoc: (d: Doc) => void }) {
  const [open, setOpen] = useState(false)
  const [bezig, setBezig] = useState(false)
  const sluit = useCallback(() => setOpen(false), [])
  const personen = new Map(boom.personen.map((p) => [p.id, p]))
  const kijkers = doc.kijkers ?? []
  const waar = doc.lijst_id ? padVan(boom, doc.lijst_id).join(' › ') : doc.map_id ? boom.mappen.find((m) => m.id === doc.map_id)?.naam : doc.space_id ? boom.spaces.find((x) => x.id === doc.space_id)?.naam : null
  const leden = doc.lijst_id ? boom.leden[`lijst:${doc.lijst_id}`] : doc.map_id ? boom.leden[`map:${doc.map_id}`] : doc.space_id ? boom.leden[`space:${doc.space_id}`] : undefined
  const zet = async (velden: { prive?: boolean; kijkers?: string[] }) => {
    setBezig(true)
    try {
      const r = await actie<{ ok: true; versie: string }>({ actie: 'doc.wijzig', id: doc.id, versie: versie.current, ...velden })
      versie.current = r.versie ?? versie.current
      // De server zet de eigenaar en jezelf erbij als dat nodig is: lees het doc opnieuw.
      const j = await api<{ doc: Doc }>(`/api/admin/agenda?doc=${doc.id}`)
      versie.current = j.doc.updated_at
      onDoc(j.doc)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const eigenaar = doc.eigenaar_id ? personen.get(doc.eigenaar_id) : null
  const zichtbaarVoor = doc.prive ? [doc.eigenaar_id, ...kijkers].filter((x): x is string => !!x) : leden ?? []
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full border h-8 pl-2 pr-2.5 text-xs ${doc.prive ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`}>
        {doc.prive ? <Lock className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
        {doc.prive ? 'Privé' : leden?.length ? `${leden.length} personen` : 'Iedereen'}
        {zichtbaarVoor.length > 0 && <span className="inline-flex -space-x-1.5 ml-0.5">{zichtbaarVoor.slice(0, 4).map((p) => <span key={p} className={`rounded-full ring-2 inline-flex ${doc.prive ? 'ring-gray-900' : 'ring-white'}`}><PersoonFoto naam={personen.get(p)?.naam ?? '?'} maat={20} /></span>)}</span>}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>
      <Popover open={open} onSluit={sluit}>
        <div className="w-full md:w-80 p-3 space-y-3 text-gray-800">
          <div className="font-semibold text-sm">Wie ziet dit document?</div>
          <Schakel aan={doc.prive} disabled={!mag || bezig} onWissel={() => zet({ prive: !doc.prive })} label={<span className="text-sm flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" />Privé</span>} />
          {!doc.prive ? (
            <p className="text-xs text-gray-600">{leden?.length
              ? <>Enkel wie toegang heeft tot {waar ?? 'deze plek'}: {leden.map((p) => personen.get(p)?.naam.split(' ')[0]).filter(Boolean).join(', ')}.</>
              : <>Iedereen die de agenda gebruikt{waar ? ` en ${waar} ziet` : ''}.</>}</p>
          ) : (
            <>
              <div className="text-xs text-gray-600">Enkel deze mensen zien het:</div>
              <ul className="space-y-1">
                {eigenaar && <li className="flex items-center gap-2 text-sm"><PersoonFoto naam={eigenaar.naam} maat={22} /><span className="flex-1">{eigenaar.naam}</span><span className="text-[11px] text-gray-500">eigenaar</span></li>}
              </ul>
              {mag && (
                <div className="rounded-xl border border-gray-100 -mx-1">
                  <PersonenLijst vol personen={boom.personen.filter((p) => p.id !== doc.eigenaar_id && p.user_id)} eerst={boom.zaakvoerders} ik={boom.ik} gekozen={kijkers}
                    onWissel={(p) => zet({ kijkers: kijkers.includes(p) ? kijkers.filter((x) => x !== p) : [...kijkers, p] })} />
                </div>
              )}
            </>
          )}
          {bezig && <div className="text-xs text-gray-500 flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Bewaren…</div>}
        </div>
      </Popover>
    </div>
  )
}
