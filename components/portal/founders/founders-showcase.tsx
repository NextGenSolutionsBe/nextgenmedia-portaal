'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, CircleCheck, Clapperboard, Loader2, X } from 'lucide-react'
import { YoutubeVideo } from '@/components/media/youtube-video'
import { MijnAanvragen } from '@/components/portal/aanvragen/aanvraag-module'
import type { FoundersVideo } from '@/lib/founders-of-flanders'

const INP = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15 focus:border-gray-900'
const LBL = 'block text-xs font-medium text-gray-700 mb-1'
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const sleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '')

export function FoundersShowcase({ videos, magAanvragen }: { videos: FoundersVideo[]; magAanvragen: boolean }) {
  const [open, setOpen] = useState(false)
  const [ververs, setVervers] = useState(0)
  const [uitgelicht, ...rest] = videos
  const Cta = ({ groot = false }: { groot?: boolean }) => magAanvragen
    ? <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center justify-center gap-2 rounded-xl bg-white text-gray-900 font-semibold shadow-lg hover:bg-gray-100 transition ${groot ? 'px-6 py-3.5 text-base' : 'px-5 py-3 text-sm'}`}>Vraag nu jouw founder video aan<ArrowRight className="h-4 w-4" /></button>
    : null

  return (
    <div className="space-y-8 animate-fade-in pb-24 sm:pb-0">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gray-950 text-white px-6 py-10 sm:px-10 sm:py-14">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
        <div className="relative max-w-2xl space-y-4">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-white/80"><Clapperboard className="h-3.5 w-3.5" />Founders of Flanders</p>
          <h1 className="text-3xl sm:text-4xl font-semibold leading-tight">Jouw verhaal als ondernemer, in één sterke video.</h1>
          <p className="text-white/75 text-sm sm:text-base">Hoe je begon, waar je voor staat en waar je naartoe wil. Wij maken er een video van die mensen tot het einde bekijken. Bekijk hieronder hoe dat eruitziet bij andere ondernemers.</p>
          <div className="pt-2"><Cta groot /></div>
        </div>
      </section>

      {/* Voorbeelden */}
      {videos.length === 0 ? (
        <div className="card-base text-sm text-gray-500">De eerste voorbeeldvideo's komen hier binnenkort.</div>
      ) : (
        <section className="space-y-4" aria-labelledby="voorbeelden">
          <h2 id="voorbeelden" className="text-lg font-semibold">Voorbeelden</h2>
          {uitgelicht && <VideoKaart v={uitgelicht} groot />}
          {rest.length > 0 && <div className="grid gap-5 sm:grid-cols-2">{rest.map((v) => <VideoKaart key={v.id} v={v} />)}</div>}
        </section>
      )}

      {magAanvragen && (
        <section className="rounded-3xl border border-gray-200 bg-white p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <h2 className="text-lg font-semibold">Klaar om jouw verhaal te vertellen?</h2>
            <p className="text-sm text-gray-600 mt-1">Laat ons weten wie je bent en wanneer het past. Wij komen terug met een voorstel en offerte.</p>
          </div>
          <button type="button" onClick={() => setOpen(true)} className="btn-primary !py-3 justify-center shrink-0">Vraag nu jouw founder video aan<ArrowRight className="h-4 w-4" /></button>
        </section>
      )}

      {magAanvragen && (
        <section className="space-y-3" aria-labelledby="mijn-founders">
          <h2 id="mijn-founders" className="text-base font-semibold">Mijn founder-aanvragen</h2>
          <MijnAanvragen soort="founders" ververs={ververs} leeg="Je hebt nog geen founder video aangevraagd." />
        </section>
      )}

      {/* Op gsm blijft de knop onderaan in beeld. */}
      {magAanvragen && !open && (
        <div className="sm:hidden fixed inset-x-4 bottom-4 z-30">
          <button type="button" onClick={() => setOpen(true)} className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gray-900 text-white font-semibold py-3.5 shadow-2xl">Vraag nu jouw founder video aan<ArrowRight className="h-4 w-4" /></button>
        </div>
      )}
      {open && <AanvraagVenster onSluit={() => setOpen(false)} onVerstuurd={() => setVervers((n) => n + 1)} />}
    </div>
  )
}

function VideoKaart({ v, groot = false }: { v: FoundersVideo; groot?: boolean }) {
  return (
    <article className={`group ${groot ? 'grid lg:grid-cols-[1.6fr_1fr] gap-5 items-center' : 'space-y-3'}`}>
      <YoutubeVideo id={v.youtube_id} titel={v.titel} className="shadow-sm" />
      <div className="space-y-1">
        <h3 className={`${groot ? 'text-xl sm:text-2xl' : 'text-base'} font-semibold leading-snug`}>{v.titel}</h3>
        {(v.ondernemer || v.bedrijf) && <p className="text-sm text-gray-500">{[v.ondernemer, v.bedrijf].filter(Boolean).join(' · ')}</p>}
        {v.beschrijving && <p className={`text-sm text-gray-600 ${groot ? '' : 'line-clamp-3'}`}>{v.beschrijving}</p>}
      </div>
    </article>
  )
}

function AanvraagVenster({ onSluit, onVerstuurd }: { onSluit: () => void; onVerstuurd: () => void }) {
  const [wat, setWat] = useState('')
  const [wie, setWie] = useState('')
  const [datum, setDatum] = useState('')
  const [locatie, setLocatie] = useState('')
  const [opmerking, setOpmerking] = useState('')
  const [key] = useState(sleutel)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [klaar, setKlaar] = useState(false)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    window.addEventListener('keydown', esc); document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = '' }
  }, [onSluit])

  const verstuur = async () => {
    if (wat.trim().length < 5) { setFout('Vertel kort over jezelf en je bedrijf.'); return }
    if (!datum) { setFout('Kies een gewenste datum.'); return }
    setBezig(true); setFout(null)
    try {
      const r = await fetch('/api/portal/aanvragen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aanvraag_sleutel: key, soort: 'founders', type: 'founder_video', wat, antwoorden: { wie }, periode_van: datum, locatie: locatie || null, aandachtspunten: opmerking, expert_id: null, bestanden: [] }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Versturen mislukt')
      setKlaar(true); onVerstuurd()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Versturen mislukt'); toast.error('Versturen mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onSluit() }}>
      <div role="dialog" aria-modal aria-labelledby="founder-titel" className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="founder-titel" className="text-lg font-semibold">{klaar ? 'Aanvraag ontvangen' : 'Jouw founder video aanvragen'}</h2>
            {!klaar && <p className="text-sm text-gray-500">Geen boeking: wij komen terug met een voorstel, offerte en planning.</p>}
          </div>
          <button type="button" onClick={onSluit} aria-label="Sluiten" className="h-9 w-9 rounded-xl hover:bg-gray-100 flex items-center justify-center shrink-0"><X className="h-4 w-4" /></button>
        </div>
        {klaar ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm text-gray-700"><CircleCheck className="h-5 w-5 text-green-600" />Bedankt! We bekijken je aanvraag en nemen contact op.</p>
            <p className="text-sm text-gray-600">De status en een eventuele offerte volg je op deze pagina bij “Mijn founder-aanvragen”.</p>
            <button type="button" onClick={onSluit} className="btn-primary w-full justify-center">Sluiten</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div><label className={LBL} htmlFor="f-wat">Wat is jouw verhaal? *</label><textarea id="f-wat" rows={4} className={INP} value={wat} maxLength={3000} onChange={(e) => setWat(e.target.value)} placeholder="Bv. hoe je begon, wat je bedrijf anders maakt en waar je naartoe wil." /></div>
            <div><label className={LBL} htmlFor="f-wie">Wie staat er in beeld?</label><input id="f-wie" className={INP} value={wie} maxLength={200} onChange={(e) => setWie(e.target.value)} placeholder="Bv. ik als zaakvoerder en mijn vennoot" /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className={LBL} htmlFor="f-datum">Gewenste datum *</label><input id="f-datum" type="date" min={vandaag()} className={INP} value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
              <div><label className={LBL} htmlFor="f-loc">Locatie <span className="font-normal text-gray-500">(optioneel)</span></label><input id="f-loc" className={INP} value={locatie} maxLength={300} onChange={(e) => setLocatie(e.target.value)} placeholder="Straat, gemeente" /></div>
            </div>
            <div><label className={LBL} htmlFor="f-opm">Nog iets dat we moeten weten? <span className="font-normal text-gray-500">(optioneel)</span></label><textarea id="f-opm" rows={2} className={INP} value={opmerking} maxLength={3000} onChange={(e) => setOpmerking(e.target.value)} /></div>
            {fout && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{fout}</p>}
            <button type="button" onClick={verstuur} disabled={bezig} className="btn-primary w-full justify-center !py-3">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Aanvraag versturen</button>
          </div>
        )}
      </div>
    </div>
  )
}
