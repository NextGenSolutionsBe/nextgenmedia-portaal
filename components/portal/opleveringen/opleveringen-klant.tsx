'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft, Clock, Download, Film, Image as ImageIcon, FileText, Play, Plus, Trash2, CheckCircle2, RotateCcw, MessageSquare, Loader2, AlertTriangle, Timer,
} from 'lucide-react'
import { STATUS_INFO, grootteLabel, tijdLabel, bestandSoort, resterend, type FeedbackPunt } from '@/lib/opleveringen'
import { KijkVenster, TijdKnop } from '@/components/media/kijk-venster'
import type { KlantOplevering } from '@/lib/opleveringen-portaal'

type Versie = KlantOplevering['versies'][number]
type Bestand = Versie['bestanden'][number]

const datumLang = (iso: string | null) => iso ? new Date(iso).toLocaleString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : ''
const SoortIcoon = ({ mime, className = 'h-4 w-4' }: { mime: string | null; className?: string }) => {
  const s = bestandSoort(mime)
  return s === 'video' ? <Film className={className} /> : s === 'foto' ? <ImageIcon className={className} /> : <FileText className={className} />
}

async function haalLink(opleveringId: string, bestandId: string, download: boolean): Promise<string> {
  const r = await fetch(`/api/portal/opleveringen/${opleveringId}/bestanden/${bestandId}${download ? '?download=1' : ''}`, { cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Dit bestand is niet beschikbaar.')
  return j.url as string
}

export function OpleveringenKlant({ opleveringen, magDownloaden, magFeedback }: { opleveringen: KlantOplevering[]; magDownloaden: boolean; magFeedback: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('oplevering')
      if (id && opleveringen.some((o) => o.id === id)) setOpen(id)
      else if (opleveringen.length === 1) setOpen(opleveringen[0].id)
    } catch { /* niets */ }
  }, [opleveringen])
  const huidige = opleveringen.find((o) => o.id === open) ?? null

  if (huidige) return <Detail o={huidige} terug={opleveringen.length > 1 ? () => setOpen(null) : null} magDownloaden={magDownloaden} magFeedback={magFeedback} />

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Film className="h-6 w-6" />Opleveringen</h1>
        <p className="text-sm text-gray-600 mt-1">Bekijk je video&apos;s, download ze in volle kwaliteit en laat ons weten wat er anders moet. Bestanden blijven 3 dagen beschikbaar: download ze tijdig.</p>
      </div>
      {opleveringen.length === 0 ? <div className="card-base text-sm text-gray-500">Er staat nog niets klaar. Zodra we een video met je delen, vind je ze hier.</div> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {opleveringen.map((o) => {
            const laatste = [...o.versies].sort((a, b) => b.nummer - a.nummer)[0]
            const poster = laatste?.bestanden.find((b) => b.poster_url)?.poster_url ?? null
            return (
              <li key={o.id}>
                <button type="button" onClick={() => setOpen(o.id)} className="w-full text-left card-base !p-0 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="relative aspect-video bg-gray-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {poster ? <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : <Film className="absolute inset-0 m-auto h-8 w-8 text-white/30" />}
                    <span className="absolute inset-0 m-auto h-12 w-12 rounded-full bg-white/90 flex items-center justify-center"><Play className="h-5 w-5 translate-x-0.5" fill="currentColor" /></span>
                    {laatste && <span className="absolute left-2 top-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white">{laatste.label}</span>}
                  </div>
                  <div className="p-3 space-y-1">
                    <p className="font-semibold">{o.titel}</p>
                    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_INFO[o.status].kleur}`}>{STATUS_INFO[o.status].klant}</span>
                    {laatste && <p className={`text-xs flex items-center gap-1 ${laatste.beschikbaarheid.status === 'verlopen' ? 'text-gray-400' : laatste.beschikbaarheid.resterendMs < 86_400_000 ? 'text-red-700 font-semibold' : 'text-gray-600'}`}><Timer className="h-3.5 w-3.5" />{laatste.beschikbaarheid.tekst}</p>}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Detail({ o, terug, magDownloaden, magFeedback }: { o: KlantOplevering; terug: (() => void) | null; magDownloaden: boolean; magFeedback: boolean }) {
  const router = useRouter()
  const versies = [...o.versies].sort((a, b) => b.nummer - a.nummer)
  const [versieId, setVersieId] = useState(versies[0]?.id ?? '')
  const v = versies.find((x) => x.id === versieId) ?? versies[0]
  const video = v?.bestanden.find((b) => bestandSoort(b.mimetype) === 'video') ?? null
  const overige = v?.bestanden.filter((b) => b.id !== video?.id) ?? []
  const [kijk, setKijk] = useState<Bestand | null>(null)
  const [speelt, setSpeelt] = useState<{ url: string; start?: number } | null>(null)
  const [laadt, setLaadt] = useState(false)
  const speler = useRef<HTMLVideoElement>(null)
  const tijd = useRef(0)
  const beschikbaar = v?.beschikbaarheid.status === 'beschikbaar'
  const actief = magFeedback && o.actieve_versie_id === v?.id
  const fb = o.feedback.filter((f) => f.versie_id === v?.id)

  useEffect(() => { setSpeelt(null); tijd.current = 0 }, [versieId])

  const speel = async (start?: number) => {
    if (!video) return
    if (speelt && speler.current) { if (start !== undefined) speler.current.currentTime = start; void speler.current.play(); return }
    setLaadt(true)
    try { setSpeelt({ url: await haalLink(o.id, video.id, false), start }) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaadt(false) }
  }
  const download = async (b: Bestand) => {
    try { window.location.href = await haalLink(o.id, b.id, true) } catch (e) { toast.error(e instanceof Error ? e.message : 'Downloaden mislukt') }
  }

  if (!v) return null
  return (
    <div className="space-y-5 animate-fade-in pb-10">
      <div className="flex items-start gap-3">
        {terug && <button type="button" onClick={terug} aria-label="Terug naar alle opleveringen" className="h-10 w-10 shrink-0 rounded-xl border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></button>}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight">{o.titel}</h1>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_INFO[o.status].kleur}`}>{STATUS_INFO[o.status].klant}</span>
            <span className="text-xs text-gray-600">Revisierondes: {o.revisies.gebruikt} van {o.revisies.max} gebruikt</span>
          </div>
          {o.omschrijving && <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{o.omschrijving}</p>}
        </div>
      </div>

      {/* Versies */}
      {versies.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Versies">
          {versies.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === v.id} onClick={() => setVersieId(x.id)}
              className={`shrink-0 text-sm font-semibold px-3.5 py-2 rounded-xl border ${x.id === v.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>{x.label}</button>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
        <div className="space-y-4 min-w-0">
          {/* Beschikbaarheid */}
          {beschikbaar ? (
            <p className={`text-sm rounded-xl border px-3.5 py-2.5 flex items-center gap-2 ${v.beschikbaarheid.resterendMs < 86_400_000 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-white border-gray-200 text-gray-700'}`}>
              <Clock className="h-4 w-4 shrink-0" /><span>Beschikbaar tot {datumLang(v.beschikbaarheid.tot)} · nog {resterend(v.beschikbaarheid.resterendMs)}. Download je bestanden tijdig.</span>
            </p>
          ) : (
            <p className="text-sm rounded-xl border px-3.5 py-2.5 flex items-center gap-2 bg-gray-50 border-gray-200 text-gray-600">
              <AlertTriangle className="h-4 w-4 shrink-0" /><span>Deze bestanden zijn niet meer beschikbaar: we halen ze na 3 dagen uit de app. Nood aan een nieuwe link? Laat het ons weten.</span>
            </p>
          )}

          {/* Video */}
          {video && (
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
              {speelt ? (
                <video ref={speler} src={speelt.url} controls autoPlay playsInline preload="metadata" className="absolute inset-0 h-full w-full object-contain bg-black" aria-label={video.naam}
                  onLoadedMetadata={() => { if (speelt.start && speler.current) speler.current.currentTime = speelt.start }}
                  onTimeUpdate={() => { if (speler.current) tijd.current = speler.current.currentTime }} />
              ) : (
                <button type="button" disabled={!beschikbaar || laadt} onClick={() => speel()} className="group absolute inset-0 h-full w-full disabled:cursor-not-allowed" aria-label={`Video afspelen: ${video.naam}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {video.poster_url && <img src={video.poster_url} alt="" className={`absolute inset-0 h-full w-full object-cover ${beschikbaar ? '' : 'opacity-40 grayscale'}`} />}
                  <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-black/10" />
                  {beschikbaar && <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-16 rounded-full bg-white/95 text-gray-900 flex items-center justify-center shadow-xl group-hover:scale-110 transition">{laadt ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />}</span>}
                </button>
              )}
            </div>
          )}
          {video && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <p className="text-sm text-gray-600 flex-1 min-w-0 break-all sm:break-normal sm:truncate">{video.naam} · {grootteLabel(video.grootte)}{video.duur ? ` · ${tijdLabel(Number(video.duur))}` : ''}{video.breedte && video.hoogte ? ` · ${video.hoogte >= 2160 || video.breedte >= 3840 ? '4K' : `${video.breedte}×${video.hoogte}`}` : ''}</p>
              {magDownloaden && beschikbaar && <button type="button" onClick={() => download(video)} className="btn-primary justify-center"><Download className="h-4 w-4" />Downloaden in volle kwaliteit</button>}
            </div>
          )}

          {/* Andere bestanden */}
          {overige.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {overige.map((b) => (
                <li key={b.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-2">
                  <button type="button" disabled={!beschikbaar} onClick={() => setKijk(b)} className="relative h-14 w-20 shrink-0 rounded-lg bg-gray-900 overflow-hidden disabled:opacity-50" aria-label={`Bekijk ${b.naam}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {b.poster_url ? <img src={b.poster_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <SoortIcoon mime={b.mimetype} className="absolute inset-0 m-auto h-5 w-5 text-white/40" />}
                  </button>
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{b.naam}</p><p className="text-[11px] text-gray-500">{grootteLabel(b.grootte)}</p></div>
                  {magDownloaden && beschikbaar && <button type="button" onClick={() => download(b)} aria-label={`Download ${b.naam}`} className="h-9 w-9 shrink-0 rounded-lg hover:bg-gray-100 flex items-center justify-center"><Download className="h-4 w-4" /></button>}
                </li>
              ))}
            </ul>
          )}
          {magDownloaden && beschikbaar && v.bestanden.length > 1 && (
            <button type="button" onClick={async () => { for (const b of v.bestanden) { await download(b); await new Promise((r) => setTimeout(r, 1200)) } }} className="btn-secondary text-sm"><Download className="h-4 w-4" />Alles downloaden ({v.bestanden.length})</button>
          )}

          {v.bericht && (
            <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 mb-1">Bericht van NextGenMedia</p>
              <p className="text-sm whitespace-pre-line">{v.bericht}</p>
            </div>
          )}
        </div>

        {/* Feedback */}
        <aside className="space-y-4 min-w-0">
          {actief ? (
            <FeedbackFormulier o={o} v={v} huidigeTijd={() => (speelt ? tijd.current : null)} onVerstuurd={() => router.refresh()} />
          ) : (
            <StatusUitleg o={o} v={v} />
          )}
          {fb.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Jouw feedback op {v.label.toLowerCase()}</p>
              {fb.map((f) => (
                <div key={f.id} className={`rounded-xl border p-3 text-sm ${f.soort === 'goedkeuring' ? 'border-green-300 bg-green-50' : f.soort === 'revisie' ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
                  <p className="text-xs font-semibold flex items-center gap-1.5">
                    {f.soort === 'goedkeuring' ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : f.soort === 'revisie' ? <RotateCcw className="h-4 w-4 text-amber-700" /> : <MessageSquare className="h-4 w-4" />}
                    {f.soort === 'goedkeuring' ? 'Goedgekeurd' : f.soort === 'revisie' ? `Revisieronde ${f.ronde}` : 'Opmerking'}
                    <span className="font-normal text-gray-500">· {new Date(f.created_at).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                  {f.tekst && <p className="mt-1 whitespace-pre-line">{f.tekst}</p>}
                  {f.punten.length > 0 && <ul className="mt-2 space-y-1">{f.punten.map((p, i) => <li key={i} className="flex items-start gap-2"><TijdKnop sec={p.tijd} onKies={video && beschikbaar ? (s) => void speel(s) : undefined} /><span>{p.tekst}</span></li>)}</ul>}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {kijk && <KijkVenster titel={kijk.naam} soort={bestandSoort(kijk.mimetype)} haalUrl={() => haalLink(o.id, kijk.id, false)} onDownload={magDownloaden ? () => download(kijk) : undefined} onSluit={() => setKijk(null)} />}
    </div>
  )
}

function StatusUitleg({ o, v }: { o: KlantOplevering; v: Versie }) {
  const fb = o.feedback.filter((f) => f.versie_id === v.id)
  const tekst = fb.some((f) => f.soort === 'goedkeuring') ? 'Je keurde deze versie goed. Bedankt!'
    : fb.some((f) => f.soort === 'revisie') ? 'We werken je feedback uit. Je ziet de nieuwe versie hier zodra ze klaarstaat.'
    : v.is_finaal ? 'Dit is de finale versie. Download ze zeker binnen de 3 dagen.'
    : o.actieve_versie_id && o.actieve_versie_id !== v.id ? 'Er is een nieuwere versie. Geef je feedback daar.'
    : 'Feedback geven kan via een collega met de juiste rechten.'
  return <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">{tekst}</div>
}

function FeedbackFormulier({ o, v, huidigeTijd, onVerstuurd }: { o: KlantOplevering; v: Versie; huidigeTijd: () => number | null; onVerstuurd: () => void }) {
  const [punten, setPunten] = useState<FeedbackPunt[]>([])
  const [tekst, setTekst] = useState('')
  const [bezig, setBezig] = useState<string | null>(null)
  const [bevestig, setBevestig] = useState(false)
  const rondes = o.revisies
  const heeftVideo = v.bestanden.some((b) => bestandSoort(b.mimetype) === 'video')

  const stuur = async (soort: 'revisie' | 'goedkeuring' | 'opmerking') => {
    setBezig(soort)
    try {
      const r = await fetch(`/api/portal/opleveringen/${o.id}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versie_id: v.id, soort, tekst, punten }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Versturen mislukt')
      toast.success(soort === 'goedkeuring' ? 'Goedgekeurd. Bedankt!' : soort === 'revisie' ? `Revisieronde ${j.ronde} doorgestuurd. We gaan ermee aan de slag.` : 'Opmerking doorgestuurd.')
      setPunten([]); setTekst(''); setBevestig(false)
      onVerstuurd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Versturen mislukt') } finally { setBezig(null) }
  }
  const heeftInhoud = !!tekst.trim() || punten.some((p) => p.tekst.trim())

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      <div>
        <p className="font-semibold">Wat vind je van {v.label.toLowerCase()}?</p>
        <p className="text-xs text-gray-500 mt-0.5">{rondes.over > 0 ? `Je hebt nog ${rondes.over} van ${rondes.max} revisierondes. Bundel al je wijzigingen in één ronde.` : `Je ${rondes.max} revisierondes zijn opgebruikt. Je kan wel goedkeuren of een opmerking sturen.`}</p>
      </div>
      {heeftVideo && (
        <button type="button" onClick={() => setPunten((p) => [...p, { tijd: huidigeTijd(), tekst: '' }])} className="btn-secondary text-sm w-full justify-center">
          <Plus className="h-4 w-4" />Opmerking op dit moment in de video
        </button>
      )}
      {punten.length > 0 && (
        <ul className="space-y-2">
          {punten.map((p, i) => (
            <li key={i} className="flex items-start gap-2">
              {p.tijd !== null ? <TijdKnop sec={p.tijd} /> : <span className="shrink-0 text-xs text-gray-400 mt-1">algemeen</span>}
              <input className="input-base flex-1 !py-1.5" autoFocus value={p.tekst} maxLength={1000} onChange={(e) => setPunten((x) => x.map((y, j) => (j === i ? { ...y, tekst: e.target.value } : y)))} placeholder="Wat moet er anders?" aria-label="Opmerking" />
              <button type="button" onClick={() => setPunten((x) => x.filter((_, j) => j !== i))} aria-label="Opmerking weghalen" className="h-9 w-9 shrink-0 rounded-lg hover:bg-gray-100 text-gray-400 flex items-center justify-center"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      {heeftVideo && <p className="text-[11px] text-gray-500 -mt-1">Pauzeer de video op het juiste moment en klik op &quot;Opmerking op dit moment&quot;: we zien dan precies waar het over gaat.</p>}
      <textarea rows={3} className="input-base" value={tekst} onChange={(e) => setTekst(e.target.value)} maxLength={4000} placeholder="Algemene feedback, bv. muziek iets zachter, logo op het einde groter" aria-label="Algemene feedback" />
      <div className="grid gap-2">
        {rondes.over > 0 && (
          <button type="button" disabled={!!bezig || !heeftInhoud} onClick={() => stuur('revisie')} className="btn-primary justify-center">
            {bezig === 'revisie' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Revisie aanvragen (ronde {rondes.volgende} van {rondes.max})
          </button>
        )}
        {rondes.over === 0 && (
          <button type="button" disabled={!!bezig || !heeftInhoud} onClick={() => stuur('opmerking')} className="btn-secondary justify-center">
            {bezig === 'opmerking' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}Opmerking sturen
          </button>
        )}
        {!bevestig ? (
          <button type="button" disabled={!!bezig} onClick={() => setBevestig(true)} className="btn-secondary justify-center !border-green-600 !text-green-800 hover:!bg-green-50"><CheckCircle2 className="h-4 w-4" />Goedkeuren</button>
        ) : (
          <div className="rounded-xl border border-green-300 bg-green-50 p-3 space-y-2">
            <p className="text-sm">Ben je tevreden met {v.label.toLowerCase()}? Na goedkeuren bezorgen we de finale versie.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setBevestig(false)} className="btn-secondary text-sm flex-1 justify-center">Nog niet</button>
              <button type="button" disabled={!!bezig} onClick={() => stuur('goedkeuring')} className="btn-primary text-sm flex-1 justify-center !bg-green-700 !border-green-700">{bezig === 'goedkeuring' && <Loader2 className="h-4 w-4 animate-spin" />}Ja, goedkeuren</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
