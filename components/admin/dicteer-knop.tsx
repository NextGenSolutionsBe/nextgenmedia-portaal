'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Mic, Square } from 'lucide-react'
import { TAAL, ruwNetjes, vervangLaatste, voegToe } from '@/lib/dicteren'

// De spraakherkenning van de browser (Chrome, Edge, Safari). Geen eigen types
// in TypeScript, dus een smal type voor wat we gebruiken.
type Resultaat = { isFinal: boolean; 0: { transcript: string } }
type Herkenner = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  onresult: ((e: { resultIndex: number; results: ArrayLike<Resultaat> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void; stop: () => void; abort: () => void
}
type HerkennerKlasse = new () => Herkenner

function herkennerKlasse(): HerkennerKlasse | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: HerkennerKlasse; webkitSpeechRecognition?: HerkennerKlasse }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * Microfoon naast een tekstvak: klik, spreek, klik opnieuw. De browser zet de
 * spraak om (live zichtbaar), de ruwe tekst komt meteen in het vak en wordt
 * daarna vervangen door een opgekuiste versie (leestekens, cijfers, namen uit
 * de context, zonder "euh"). Met "Ruwe versie" zet je de originele terug.
 * Niets wordt geplaatst of bewaard: dat blijft de knop van het formulier.
 *
 * `zet` is de setter van het tekstvak (bv. setTekst uit useState).
 */
export function DicteerKnop({ zet, context, klein, onBezig }: {
  zet: (f: (oud: string) => string) => void
  /** Waar de notitie bij hoort, zodat namen juist geschreven worden (bv. "Kilowot · sociale media"). */
  context?: string | null
  klein?: boolean
  onBezig?: (bezig: boolean) => void
}) {
  const [stand, setStand] = useState<'uit' | 'luistert' | 'kuist'>('uit')
  const [live, setLive] = useState('')
  const rec = useRef<Herkenner | null>(null)
  const stukken = useRef<string[]>([])
  const tussen = useRef('')
  const stoppen = useRef(false)
  const afgerond = useRef(false)

  useEffect(() => () => { stoppen.current = true; rec.current?.abort() }, [])
  useEffect(() => { onBezig?.(stand !== 'uit') }, [stand, onBezig])

  const afronden = async () => {
    if (afgerond.current) return
    afgerond.current = true
    rec.current = null
    const ruw = [...stukken.current, tussen.current].join(' ').replace(/\s+/g, ' ').trim()
    setLive('')
    if (!ruw) { setStand('uit'); toast.info('Er werd niets herkend. Spreek iets dichter bij de microfoon.'); return }
    // Meteen de ruwe tekst in het vak: er gaat nooit iets verloren.
    const r = ruwNetjes(ruw)
    zet((oud) => voegToe(oud, r))
    setStand('kuist')
    try {
      const res = await fetch('/api/admin/dicteren', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tekst: ruw, context: context ?? null }) })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.opgekuist && typeof j.tekst === 'string' && j.tekst !== r) {
        const netjes = j.tekst as string
        zet((oud) => vervangLaatste(oud, r, netjes))
        toast.success('Ingesproken tekst toegevoegd.', { action: { label: 'Ruwe versie', onClick: () => zet((oud) => vervangLaatste(oud, netjes, r)) } })
      }
    } catch { /* de ruwe tekst staat er al */ } finally { setStand('uit') }
  }

  const start = () => {
    const K = herkennerKlasse()
    if (!K) { toast.error('Spraak werkt in Chrome, Edge en Safari. In deze browser nog niet.'); return }
    stukken.current = []; tussen.current = ''; stoppen.current = false; afgerond.current = false
    const h = new K()
    h.lang = TAAL; h.continuous = true; h.interimResults = true; h.maxAlternatives = 1
    h.onresult = (e) => {
      let t = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const woord = res[0]?.transcript ?? ''
        if (res.isFinal) stukken.current.push(woord.trim())
        else t += woord
      }
      tussen.current = t.trim()
      setLive([...stukken.current, tussen.current].join(' ').trim())
    }
    h.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      stoppen.current = true
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast.error('Geen toegang tot de microfoon. Sta de microfoon toe voor deze site (slotje links van het adres).')
      else if (e.error === 'audio-capture') toast.error('Geen microfoon gevonden.')
      else if (e.error === 'network') toast.error('De spraakherkenning is niet bereikbaar. Kijk je internetverbinding na.')
      else toast.error('Spraakherkenning gestopt.')
    }
    h.onend = () => {
      // Chrome stopt vanzelf na een stilte: herstarten zolang je niet zelf stopte.
      if (!stoppen.current && rec.current === h) {
        if (tussen.current) { stukken.current.push(tussen.current); tussen.current = '' }
        try { h.start(); return } catch { /* opnieuw starten lukte niet: afronden */ }
      }
      void afronden()
    }
    rec.current = h
    try { h.start(); setStand('luistert') } catch { toast.error('De microfoon kon niet starten.'); rec.current = null }
  }

  const stop = () => {
    stoppen.current = true
    const h = rec.current
    if (!h) return
    try { h.stop() } catch { void afronden() }
    // Vangnet als de browser geen onend meer stuurt.
    setTimeout(() => { if (!afgerond.current) void afronden() }, 2500)
  }

  const maat = klein ? 'h-7 w-7' : 'h-8 w-8'
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <button type="button" onClick={stand === 'luistert' ? stop : start} disabled={stand === 'kuist'}
        title={stand === 'luistert' ? 'Stoppen' : 'Inspreken'} aria-label={stand === 'luistert' ? 'Stoppen met inspreken' : 'Notitie inspreken'} aria-pressed={stand === 'luistert'}
        className={`${maat} shrink-0 rounded-full flex items-center justify-center transition ${stand === 'luistert' ? 'bg-red-600 text-white animate-pulse' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}>
        {stand === 'kuist' ? <Loader2 className="h-4 w-4 animate-spin" /> : stand === 'luistert' ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
      </button>
      {stand === 'luistert' && <span className="text-[11px] text-red-700 truncate max-w-[220px]" aria-live="polite">{live ? `…${live.slice(-60)}` : 'Aan het luisteren…'}</span>}
      {stand === 'kuist' && <span className="text-[11px] text-gray-500">Netjes maken…</span>}
    </span>
  )
}
