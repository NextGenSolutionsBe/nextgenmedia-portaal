'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Printer, Trash2, Eye, Pencil, Lock, Check, ChevronRight } from 'lucide-react'
import { actie, api, Markdown, vinkRegel, padVan, focusRing, Schakel, ApiFout, type BoomData } from './gedeeld'

type Doc = { id: string; titel: string; inhoud: string | null; space_id: string | null; map_id: string | null; lijst_id: string | null; prive: boolean; eigenaar_id: string | null; bijgewerkt_door: string | null; updated_at: string; created_at: string }

/** Een document als kladblok: lezen of schrijven, bewaart vanzelf, afdrukken als pdf. */
export function DocWeergave({ id, boom, onVerwijderd, onVernieuw }: { id: string; boom: BoomData; onVerwijderd: () => void; onVernieuw: () => void }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [titel, setTitel] = useState('')
  const [inhoud, setInhoud] = useState('')
  const [bewerk, setBewerk] = useState(false)
  const [status, setStatus] = useState<'bewaard' | 'bezig' | 'wijziging'>('bewaard')
  const versie = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const laatste = useRef({ titel: '', inhoud: '' })
  const mag = !!boom.rechten.aanpassen

  const laad = useCallback(async () => {
    try {
      const j = await api<{ doc: Doc }>(`/api/admin/agenda?doc=${id}`)
      setDoc(j.doc); setTitel(j.doc.titel); setInhoud(j.doc.inhoud ?? '')
      laatste.current = { titel: j.doc.titel, inhoud: j.doc.inhoud ?? '' }
      versie.current = j.doc.updated_at; setFout(null); setStatus('bewaard')
      setBewerk(!(j.doc.inhoud ?? '').trim() && mag)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [id, mag])
  useEffect(() => { setDoc(null); laad() }, [laad])

  const bewaar = useCallback(async (t: string, h: string) => {
    if (t === laatste.current.titel && h === laatste.current.inhoud) { setStatus('bewaard'); return }
    setStatus('bezig')
    try {
      const r = await actie<{ ok: true; versie: string }>({ actie: 'doc.wijzig', id, titel: t, inhoud: h, versie: versie.current })
      versie.current = r.versie; laatste.current = { titel: t, inhoud: h }
      setStatus('bewaard')
      if (t !== doc?.titel) onVernieuw()
    } catch (e) {
      setStatus('wijziging')
      toast.error(e instanceof Error ? e.message : 'Bewaren mislukt')
      if (e instanceof ApiFout && e.status === 409) laad()
    }
  }, [id, doc?.titel, onVernieuw, laad])

  // Bewaart 1 seconde na het typen, en meteen bij het verlaten.
  const plan = (t: string, h: string) => {
    setStatus('wijziging')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => bewaar(t, h), 1000)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    const weg = (e: BeforeUnloadEvent) => { if (status !== 'bewaard') { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', weg)
    return () => window.removeEventListener('beforeunload', weg)
  }, [status])

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
    const html = document.getElementById('agenda-doc-afdruk')?.innerHTML ?? ''
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    w.document.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>
      @page{margin:18mm}body{font-family:Archivo,Helvetica,Arial,sans-serif;color:#0f0f0f;font-size:11pt;line-height:1.55}
      h1{font-size:20pt;margin:0 0 4pt}.meta{font-family:'JetBrains Mono',monospace;font-size:8pt;color:#6e6e6e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:16pt}
      button{all:unset;display:inline-block;width:10pt;height:10pt;border:1px solid #4b4b4b;border-radius:2pt;margin-right:6pt;vertical-align:-1pt}
      a{color:#0f0f0f}p{margin:0 0 4pt}</style></head><body><h1>${esc(titel)}</h1>
      <div class="meta">NextGen Agency · ${esc(padVan(boom, doc?.lijst_id ?? null).join(' › ') || 'Agenda')} · ${new Date().toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })}</div>${html}</body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  if (fout) return <div className="card-base text-sm text-red-700">{fout}</div>
  if (!doc) return <div className="card-base flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const pad = doc.lijst_id ? padVan(boom, doc.lijst_id) : doc.map_id ? [boom.mappen.find((m) => m.id === doc.map_id)?.naam ?? ''] : doc.space_id ? [boom.spaces.find((s) => s.id === doc.space_id)?.naam ?? ''] : []
  return (
    <div className="card-base !p-0 overflow-hidden flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-100">
        <div className="flex-1 min-w-0 text-xs text-gray-500 flex items-center gap-1 truncate">{pad.map((p, n) => <span key={n} className="flex items-center gap-1">{p}{n < pad.length - 1 && <ChevronRight className="h-3 w-3" />}</span>)}</div>
        <span className="text-[11px] text-gray-400 flex items-center gap-1">{status === 'bezig' ? <><Loader2 className="h-3 w-3 animate-spin" />Bewaren…</> : status === 'wijziging' ? 'Niet bewaard' : <><Check className="h-3 w-3" />Bewaard</>}</span>
        {mag && <button type="button" onClick={() => { if (bewerk) bewaar(titel, inhoud); setBewerk(!bewerk) }} className={`btn-secondary !py-1 !px-2.5 !text-xs ${focusRing}`}>{bewerk ? <><Eye className="h-3.5 w-3.5" />Lezen</> : <><Pencil className="h-3.5 w-3.5" />Bewerken</>}</button>}
        <button type="button" onClick={druk} className={`btn-secondary !py-1 !px-2.5 !text-xs ${focusRing}`}><Printer className="h-3.5 w-3.5" />Afdrukken</button>
        {boom.rechten.verwijderen && <button type="button" onClick={verwijder} aria-label="Naar de prullenbak" className={`h-8 w-8 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600 flex items-center justify-center ${focusRing}`}><Trash2 className="h-4 w-4" /></button>}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 sm:px-10 py-8">
          <input value={titel} disabled={!mag} onChange={(e) => { setTitel(e.target.value); plan(e.target.value, inhoud) }} onBlur={() => bewaar(titel.trim() || 'Naamloos document', inhoud)}
            className="w-full text-3xl font-bold bg-transparent border-0 p-0 mb-2 focus:ring-0 focus:outline-none" aria-label="Titel" placeholder="Titel" />
          <div className="flex items-center gap-3 mb-6 text-xs text-gray-500">
            <span>Laatst aangepast {new Date(doc.updated_at).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' })}{doc.bijgewerkt_door ? ` door ${doc.bijgewerkt_door}` : ''}</span>
            {doc.eigenaar_id === boom.ik && <Schakel aan={doc.prive} onWissel={async () => { await actie({ actie: 'doc.wijzig', id, prive: !doc.prive, versie: versie.current }).then((r) => { versie.current = (r as { versie?: string }).versie ?? versie.current }); setDoc({ ...doc, prive: !doc.prive }); onVernieuw() }} label={<span className="flex items-center gap-1"><Lock className="h-3 w-3" />Privé</span>} />}
          </div>
          {bewerk ? (
            <textarea autoFocus value={inhoud} onChange={(e) => { setInhoud(e.target.value); plan(titel, e.target.value) }} onBlur={() => bewaar(titel, inhoud)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); bewaar(titel, inhoud) } }}
              className="w-full min-h-[60vh] text-[15px] leading-relaxed bg-transparent border-0 p-0 focus:ring-0 focus:outline-none resize-none font-[inherit]"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
              placeholder={'Schrijf maar. Koppen met #, lijstjes met -, afvinken met - [ ], vet met **zo**.'} aria-label="Inhoud" />
          ) : (
            <div onDoubleClick={() => mag && setBewerk(true)}>
              {inhoud.trim() ? <Markdown tekst={inhoud} onVink={mag ? (n) => { const t = vinkRegel(inhoud, n); setInhoud(t); bewaar(titel, t) } : undefined} /> : <p className="text-sm text-gray-400">Dit document is nog leeg.</p>}
            </div>
          )}
          {/* Voor het afdrukken: altijd de leesversie, ook tijdens het schrijven. */}
          <div id="agenda-doc-afdruk" className="hidden" aria-hidden><Markdown tekst={inhoud} /></div>
        </div>
      </div>
    </div>
  )
}
