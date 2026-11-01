'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Plus, Loader2, X, Upload, Film, Image as ImageIcon, FileText, Trash2, Download, Eye, Send, Clock, CheckCircle2, RotateCcw, Archive, MessageSquare, Lock, Timer,
} from 'lucide-react'
import { KlantKiezer, type KlantOptie } from '@/components/admin/klant-kiezer'
import { MailComposer } from '@/components/admin/mail-composer'
import { KijkVenster, TijdKnop } from '@/components/media/kijk-venster'
import { laadOpleveringBestandOp, type Voortgang } from '@/lib/oplevering-upload'
import {
  STATUS_INFO, versieLabel, beschikbaarheid, grootteLabel, tijdLabel, bestandSoort, type OpleveringStatus,
} from '@/lib/opleveringen'
import type { OpleveringVolledig } from '@/lib/opleveringen-server'

type Klant = { id: string; company_name: string; contact_name?: string | null; email?: string | null }
type Opdracht = { id: string; titel: string; client_id: string | null; status: string }
type Bestand = OpleveringVolledig['versies'][number]['bestanden'][number]

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j as T
}
const datumTijd = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const SoortIcoon = ({ mime, className = 'h-4 w-4' }: { mime: string | null; className?: string }) => {
  const s = bestandSoort(mime)
  return s === 'video' ? <Film className={className} /> : s === 'foto' ? <ImageIcon className={className} /> : <FileText className={className} />
}

export function OpleveringenAdmin({ magToevoegen, magAanpassen, magVerwijderen }: { magToevoegen: boolean; magAanpassen: boolean; magVerwijderen: boolean }) {
  const [lijst, setLijst] = useState<OpleveringVolledig[] | null>(null)
  const [klanten, setKlanten] = useState<Klant[]>([])
  const [opdrachten, setOpdrachten] = useState<Opdracht[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const [filter, setFilter] = useState<OpleveringStatus | 'alle'>('alle')
  const [archief, setArchief] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [nieuw, setNieuw] = useState(false)

  const laad = useCallback(async () => {
    try {
      const j = await api<{ opleveringen: OpleveringVolledig[]; klanten: Klant[]; opdrachten: Opdracht[]; hint?: string }>(`/api/admin/opleveringen${archief ? '?archief=1' : ''}`)
      setLijst(j.opleveringen); setKlanten(j.klanten); setOpdrachten(j.opdrachten); setHint(j.hint ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setLijst([]) }
  }, [archief])
  useEffect(() => { void laad() }, [laad])
  useEffect(() => {
    try { const id = new URLSearchParams(window.location.search).get('oplevering'); if (id) setOpen(id) } catch { /* niets */ }
  }, [])

  const zichtbaar = useMemo(() => (lijst ?? []).filter((o) => filter === 'alle' || o.status === filter), [lijst, filter])
  const telling = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of lijst ?? []) m.set(o.status, (m.get(o.status) ?? 0) + 1)
    return m
  }, [lijst])
  const huidige = open ? (lijst ?? []).find((o) => o.id === open) ?? null : null
  const chip = (actief: boolean) => `text-xs font-semibold px-3 py-1.5 rounded-xl border whitespace-nowrap ${actief ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:bg-gray-50'}`

  return (
    <div className="space-y-4">
      {hint && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{hint}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        {magToevoegen && <button type="button" onClick={() => setNieuw(true)} className="btn-primary"><Plus className="h-4 w-4" />Nieuwe oplevering</button>}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button type="button" onClick={() => setFilter('alle')} className={chip(filter === 'alle')}>Alles ({lijst?.length ?? 0})</button>
          {(['revisie_gevraagd', 'wacht_op_klant', 'concept', 'goedgekeurd', 'finaal'] as OpleveringStatus[]).map((s) => (
            <button key={s} type="button" onClick={() => setFilter(s)} className={chip(filter === s)}>{STATUS_INFO[s].team} ({telling.get(s) ?? 0})</button>
          ))}
        </div>
        <label className="ml-auto text-xs text-gray-600 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-gray-900" checked={archief} onChange={(e) => setArchief(e.target.checked)} />Toon archief</label>
      </div>

      {lijst === null ? <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        : zichtbaar.length === 0 ? (
          <div className="card-base text-center py-12 text-sm text-gray-500">
            <Film className="h-8 w-8 mx-auto text-gray-300 mb-2" />
            {lijst.length === 0 ? 'Nog geen opleveringen. Maak er een aan, laad de video op en deel ze met de klant.' : 'Niets met deze filter.'}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {zichtbaar.map((o) => <OpleveringKaart key={o.id} o={o} onOpen={() => setOpen(o.id)} />)}
          </ul>
        )}

      {nieuw && <NieuweOplevering klanten={klanten} opdrachten={opdrachten} onSluit={() => setNieuw(false)} onKlaar={(id) => { setNieuw(false); void laad().then(() => setOpen(id)) }} />}
      {open && (huidige ? <Detail key={huidige.id} o={huidige} opdrachten={opdrachten} mag={{ toevoegen: magToevoegen, aanpassen: magAanpassen, verwijderen: magVerwijderen }} onVernieuw={laad} onSluit={() => setOpen(null)} />
        : lijst && <DetailLaden id={open} onSluit={() => setOpen(null)} onGevonden={laad} />)}
    </div>
  )
}

function DetailLaden({ id, onSluit, onGevonden }: { id: string; onSluit: () => void; onGevonden: () => void }) {
  // Een gearchiveerde oplevering uit een link: archief tonen kan via het vinkje; hier enkel melden.
  useEffect(() => { void onGevonden() }, [onGevonden])
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onSluit}>
      <aside className="w-full sm:max-w-2xl h-full bg-white shadow-2xl p-6 text-sm text-gray-500" onClick={(e) => e.stopPropagation()}>
        <p>Oplevering {id.slice(0, 8)} niet gevonden in deze lijst. Staat ze in het archief? Vink dan "Toon archief" aan.</p>
        <button type="button" onClick={onSluit} className="btn-secondary mt-4">Sluiten</button>
      </aside>
    </div>
  )
}

function OpleveringKaart({ o, onOpen }: { o: OpleveringVolledig; onOpen: () => void }) {
  const laatste = [...o.versies].sort((a, b) => b.nummer - a.nummer)[0]
  const gedeeld = [...o.versies].filter((v) => v.gepubliceerd_op).sort((a, b) => b.nummer - a.nummer)[0]
  const poster = laatste?.bestanden.find((b) => b.poster_url)?.poster_url ?? gedeeld?.bestanden.find((b) => b.poster_url)?.poster_url ?? null
  const b = gedeeld ? beschikbaarheid(gedeeld) : null
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full text-left card-base !p-0 overflow-hidden hover:shadow-md transition-shadow">
        <div className="relative aspect-video bg-gray-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {poster ? <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : <Film className="absolute inset-0 m-auto h-8 w-8 text-white/30" />}
          <span className={`absolute left-2 top-2 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_INFO[o.status].kleur}`}>{STATUS_INFO[o.status].team}</span>
          {laatste && <span className="absolute right-2 top-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white">{versieLabel(laatste)}{!laatste.gepubliceerd_op ? ' · concept' : ''}</span>}
        </div>
        <div className="p-3 space-y-1">
          <p className="font-semibold leading-snug">{o.titel}</p>
          <p className="text-xs text-gray-500">{o.klant_naam ?? 'Klant'}</p>
          <div className="flex items-center justify-between gap-2 text-[11px] text-gray-600 pt-1">
            <span>Revisies {o.revisies.gebruikt}/{o.revisies.max}</span>
            {b && <span className={`flex items-center gap-1 ${b.status === 'verlopen' ? 'text-gray-400' : b.resterendMs < 86_400_000 ? 'text-red-700 font-semibold' : ''}`}><Timer className="h-3 w-3" />{b.tekst}</span>}
          </div>
        </div>
      </button>
    </li>
  )
}

function NieuweOplevering({ klanten, opdrachten, onSluit, onKlaar }: { klanten: Klant[]; opdrachten: Opdracht[]; onSluit: () => void; onKlaar: (id: string) => void }) {
  const [klant, setKlant] = useState('')
  const [titel, setTitel] = useState('')
  const [omschrijving, setOmschrijving] = useState('')
  const [opdracht, setOpdracht] = useState('')
  const [max, setMax] = useState(2)
  const [bezig, setBezig] = useState(false)
  const [lokaal, setLokaal] = useState<KlantOptie[]>(klanten.map((k) => ({ id: k.id, company_name: k.company_name, contact_name: k.contact_name ?? null, email: k.email ?? null })))
  const vanKlant = opdrachten.filter((x) => x.client_id === klant)
  const maak = async () => {
    setBezig(true)
    try {
      const j = await api<{ id: string }>('/api/admin/opleveringen', { method: 'POST', body: JSON.stringify({ client_id: klant, titel, omschrijving, opdracht_id: opdracht || null, max_revisies: max }) })
      toast.success('Oplevering aangemaakt. Laad nu de video op.')
      onKlaar(j.id)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onSluit}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Nieuwe oplevering">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold flex items-center gap-2"><Film className="h-4 w-4" />Nieuwe oplevering</h3>
          <button type="button" onClick={onSluit} aria-label="Sluiten" className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><p className="text-xs font-medium text-gray-600 mb-1">Klant *</p>
            <KlantKiezer id="oplevering-klant" klanten={lokaal} waarde={klant} onKies={(k) => { setKlant(k?.id ?? ''); setOpdracht('') }} onNieuw={(k) => setLokaal((l) => [...l, k])} bron="oplevering" />
          </div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="op-titel">Titel *</label>
            <input id="op-titel" className="input-base" value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} placeholder="Bv. Aftermovie zomerfeest 2026" /></div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="op-omschr">Omschrijving <span className="text-gray-400">optioneel, de klant ziet dit</span></label>
            <textarea id="op-omschr" rows={2} className="input-base" value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} maxLength={4000} /></div>
          {vanKlant.length > 0 && (
            <div><label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="op-opdracht">Hoort bij opdracht <span className="text-gray-400">optioneel</span></label>
              <select id="op-opdracht" className="input-base" value={opdracht} onChange={(e) => setOpdracht(e.target.value)}>
                <option value="">Geen</option>{vanKlant.map((x) => <option key={x.id} value={x.id}>{x.titel}</option>)}
              </select></div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600" htmlFor="op-max">Revisierondes</label>
            <input id="op-max" type="number" min={0} max={10} className="input-base !w-20" value={max} onChange={(e) => setMax(Math.max(0, Math.min(10, Number(e.target.value) || 0)))} />
          </div>
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onSluit} className="btn-secondary">Annuleer</button>
          <button type="button" onClick={maak} disabled={bezig || !klant || !titel.trim()} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Aanmaken</button>
        </div>
      </div>
    </div>
  )
}

type Upload = { id: string; naam: string; grootte: number; voortgang: Voortgang | null; fout: string | null; stop: AbortController }

function Detail({ o, opdrachten, mag, onVernieuw, onSluit }: { o: OpleveringVolledig; opdrachten: Opdracht[]; mag: { toevoegen: boolean; aanpassen: boolean; verwijderen: boolean }; onVernieuw: () => Promise<void>; onSluit: () => void }) {
  const versies = [...o.versies].sort((a, b) => b.nummer - a.nummer)
  const concept = versies.find((v) => !v.gepubliceerd_op) ?? null
  const laatsteGedeeld = versies.find((v) => v.gepubliceerd_op) ?? null
  const [uploads, setUploads] = useState<Upload[]>([])
  const [bericht, setBericht] = useState(concept?.bericht ?? '')
  const [finaal, setFinaal] = useState(concept?.is_finaal ?? false)
  const [bezig, setBezig] = useState<string | null>(null)
  const [kijk, setKijk] = useState<{ b: Bestand; tijd?: number | null } | null>(null)
  const [vraagWeg, setVraagWeg] = useState(false)
  const [net, setNet] = useState<string | null>(null)
  const kiezer = useRef<HTMLInputElement>(null)
  const opdracht = opdrachten.find((x) => x.id === o.opdracht_id)
  const bezigMetUpload = uploads.some((u) => !u.fout && u.voortgang?.fase !== 'afronden' && u.voortgang !== null) || uploads.some((u) => u.voortgang === null && !u.fout)

  useEffect(() => { setBericht(concept?.bericht ?? ''); setFinaal(concept?.is_finaal ?? false) }, [concept?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !kijk) onSluit() }
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc)
  }, [kijk, onSluit])
  // Niet weg terwijl er opgeladen wordt.
  useEffect(() => {
    if (!uploads.some((u) => !u.fout && u.voortgang?.fase !== 'afronden')) return
    const w = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', w); return () => window.removeEventListener('beforeunload', w)
  }, [uploads])

  const doe = async (sleutel: string, fn: () => Promise<unknown>, ok?: string) => {
    setBezig(sleutel)
    try { await fn(); if (ok) toast.success(ok); await onVernieuw() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const voegToe = async (files: FileList | File[]) => {
    let doel = concept?.id
    if (!doel) { try { doel = (await api<{ id: string }>(`/api/admin/opleveringen/${o.id}/versies`, { method: 'POST', body: JSON.stringify({}) })).id } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); return } }
    const lijst = Array.from(files)
    const nieuwe: Upload[] = lijst.map((f) => ({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, naam: f.name, grootte: f.size, voortgang: null, fout: null, stop: new AbortController() }))
    setUploads((u) => [...u, ...nieuwe])
    // Eén voor één: zo gaat de bandbreedte naar één bestand en is elk bestand sneller klaar.
    for (let i = 0; i < lijst.length; i++) {
      const u = nieuwe[i]
      try {
        await laadOpleveringBestandOp({ opleveringId: o.id, versieId: doel!, bestand: lijst[i], signaal: u.stop.signal, onVoortgang: (g) => setUploads((x) => x.map((y) => (y.id === u.id ? { ...y, voortgang: g } : y))) })
        setUploads((x) => x.filter((y) => y.id !== u.id))
        await onVernieuw()
      } catch (e) {
        const fout = (e as Error)?.name === 'AbortError' ? 'Gestopt' : e instanceof Error ? e.message : 'Opladen mislukt'
        setUploads((x) => x.map((y) => (y.id === u.id ? { ...y, fout } : y)))
      }
    }
  }

  const publiceer = () => doe('publiceer', async () => {
    if (!concept) return
    await api(`/api/admin/opleveringen/${o.id}/versies/${concept.id}`, { method: 'PATCH', body: JSON.stringify({ bericht, is_finaal: finaal, publiceer: true }) })
    setNet(concept.id)
  }, 'Gedeeld. De klant ziet de versie nu in de klantapp, 3 dagen lang.')

  const urlVoor = (b: Bestand, download = false) => api<{ url: string }>(`/api/admin/opleveringen/bestanden/${b.id}${download ? '?download=1' : ''}`).then((j) => j.url)
  const download = async (b: Bestand) => { try { window.location.href = await urlVoor(b, true) } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } }
  const portaalLink = typeof window !== 'undefined' ? `${window.location.origin}/portal/opleveringen?oplevering=${o.id}` : ''
  const mailVersie = versies.find((v) => v.id === net) ?? laatsteGedeeld

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onSluit}>
      <aside className="w-full sm:max-w-2xl h-full bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={o.titel}
        onDragOver={(e) => { if (mag.toevoegen) e.preventDefault() }} onDrop={(e) => { if (!mag.toevoegen) return; e.preventDefault(); if (e.dataTransfer.files.length) void voegToe(e.dataTransfer.files) }}>
        <header className="px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_INFO[o.status].kleur}`}>{STATUS_INFO[o.status].team}</span>
              <h2 className="text-xl font-semibold mt-1.5 leading-tight">{o.titel}</h2>
              <p className="text-sm text-gray-500">{o.klant_naam}{opdracht ? ` · opdracht: ${opdracht.titel}` : ''}</p>
            </div>
            <button type="button" onClick={onSluit} aria-label="Sluiten" className="h-9 w-9 rounded-lg hover:bg-gray-100 flex items-center justify-center shrink-0"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
            <span className="rounded-lg bg-gray-100 px-2.5 py-1">Revisierondes: <b>{o.revisies.gebruikt}</b> van {o.revisies.max} gebruikt</span>
            {mag.aanpassen && <button type="button" onClick={() => doe('extra', () => api(`/api/admin/opleveringen/${o.id}`, { method: 'PATCH', body: JSON.stringify({ extra_ronde: true }) }), 'Extra revisieronde gegeven.')} className="underline text-gray-600">+ extra ronde geven</button>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Concept: opladen en delen */}
          {mag.toevoegen && (
            <section className="rounded-2xl border-2 border-dashed border-gray-300 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-semibold">{concept ? `${versieLabel({ nummer: concept.nummer, is_finaal: finaal })} · concept` : laatsteGedeeld ? `Volgende versie: ${versieLabel({ nummer: laatsteGedeeld.nummer + 1, is_finaal: finaal })}` : 'Eerste versie'}</p>
                <label className="text-xs flex items-center gap-1.5 cursor-pointer"><input type="checkbox" className="h-4 w-4 accent-gray-900" checked={finaal} onChange={(e) => setFinaal(e.target.checked)} />Dit is de finale versie</label>
              </div>
              <button type="button" onClick={() => kiezer.current?.click()} className="w-full rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 py-6 text-sm text-gray-700 flex flex-col items-center gap-1.5">
                <Upload className="h-6 w-6" /><span className="font-semibold">Bestanden kiezen of hierheen slepen</span>
                <span className="text-xs text-gray-500">Video&apos;s (ook 4K), foto&apos;s of andere bestanden. Grote bestanden gaan in stukjes en hervatten na een onderbreking. MP4 speelt in elke browser af.</span>
              </button>
              <input ref={kiezer} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void voegToe(e.target.files); e.target.value = '' }} />
              {uploads.length > 0 && (
                <ul className="space-y-2">
                  {uploads.map((u) => {
                    const pct = u.voortgang && u.voortgang.totaal ? Math.round((u.voortgang.geladen / u.voortgang.totaal) * 100) : 0
                    return (
                      <li key={u.id} className="rounded-xl border border-gray-200 p-2.5 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="truncate flex-1 min-w-0 font-medium">{u.naam}</span>
                          <span className="text-xs text-gray-500 shrink-0">{grootteLabel(u.grootte)}</span>
                          {!u.fout && <button type="button" onClick={() => u.stop.abort()} className="text-xs text-gray-500 hover:text-red-600 shrink-0">Stop</button>}
                          {u.fout && <button type="button" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))} aria-label="Weghalen" className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>}
                        </div>
                        {u.fout ? <p className="text-xs text-red-700 mt-1">{u.fout}</p> : (
                          <>
                            <div className="mt-1.5 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-gray-900 transition-all" style={{ width: `${u.voortgang?.fase === 'voorbereiden' || !u.voortgang ? 2 : pct}%` }} /></div>
                            <p className="text-[11px] text-gray-500 mt-1">{!u.voortgang || u.voortgang.fase === 'voorbereiden' ? 'Voorbereiden (miniatuur maken)…' : u.voortgang.fase === 'afronden' ? 'Afronden…' : `${pct}% · ${grootteLabel(u.voortgang.geladen)} van ${grootteLabel(u.voortgang.totaal)}`}</p>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {concept && concept.bestanden.length > 0 && <BestandLijst bestanden={concept.bestanden} onKijk={(b) => setKijk({ b })} onDownload={download} onWeg={mag.verwijderen ? (b) => doe(`weg-${b.id}`, () => api(`/api/admin/opleveringen/bestanden/${b.id}`, { method: 'DELETE' }), 'Bestand verwijderd.') : undefined} />}
              {concept && (
                <>
                  <div><label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="op-bericht">Bericht voor de klant <span className="text-gray-400">optioneel</span></label>
                    <textarea id="op-bericht" rows={2} className="input-base" value={bericht} onChange={(e) => setBericht(e.target.value)} maxLength={4000} placeholder={concept.nummer > 1 ? 'Bv. Muziek zachter gezet en het logo op het einde groter.' : 'Bv. Hier is de eerste versie. Laat ons weten wat je ervan vindt.'} /></div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={publiceer} disabled={bezig === 'publiceer' || bezigMetUpload || !concept.bestanden.some((b) => b.status === 'klaar')} className="btn-primary">{bezig === 'publiceer' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Delen met de klant</button>
                    <span className="text-xs text-gray-500">Vanaf dan 3 dagen beschikbaar. De klant krijgt geen automatische mail.</span>
                    {mag.verwijderen && concept.nummer > 1 && <button type="button" onClick={() => doe('conceptweg', () => api(`/api/admin/opleveringen/${o.id}/versies/${concept.id}`, { method: 'DELETE' }), 'Concept verwijderd.')} className="text-xs text-red-600 underline ml-auto">Concept weggooien</button>}
                  </div>
                </>
              )}
            </section>
          )}

          {/* Klant verwittigen na het delen */}
          {mailVersie?.gepubliceerd_op && beschikbaarheid(mailVersie).status === 'beschikbaar' && (
            <section className={`rounded-xl border p-3 flex items-center gap-3 flex-wrap ${net ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
              <p className="text-sm flex-1 min-w-0">{net ? 'Gedeeld. Laat het de klant weten met een mail (je ziet eerst een voorbeeld).' : `${mailVersie.label} staat klaar voor de klant.`}</p>
              <MailComposer label="Klant verwittigen" className="btn-secondary text-sm" context={{ type: 'oplevering', titel: o.titel, versieLabel: mailVersie.label, link: portaalLink, clientId: o.client_id, clientName: o.klant_naam, verlooptOp: beschikbaarheid(mailVersie).tot }} />
            </section>
          )}

          {/* Versies en feedback */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Versies en feedback</h3>
            {versies.filter((v) => v.gepubliceerd_op).length === 0 && <p className="text-sm text-gray-500">Nog niets gedeeld.</p>}
            {versies.filter((v) => v.gepubliceerd_op).map((v) => {
              const b = beschikbaarheid(v)
              const fb = o.feedback.filter((f) => f.versie_id === v.id)
              return (
                <article key={v.id} className="rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${v.is_finaal ? 'bg-[#166534] text-white' : 'bg-gray-900 text-white'}`}>{v.label}</span>
                    <span className="text-xs text-gray-500">gedeeld {datumTijd(v.gepubliceerd_op)}{v.gepubliceerd_door ? ` door ${v.gepubliceerd_door}` : ''}</span>
                    <span className={`ml-auto text-xs flex items-center gap-1 ${b.status === 'verlopen' ? 'text-gray-400' : b.resterendMs < 86_400_000 ? 'text-red-700 font-semibold' : 'text-gray-700'}`}><Clock className="h-3.5 w-3.5" />{b.status === 'verlopen' ? 'Bestanden weggehaald' : b.tekst}</span>
                    {mag.aanpassen && b.status === 'beschikbaar' && <button type="button" onClick={() => doe(`verleng-${v.id}`, () => api(`/api/admin/opleveringen/${o.id}/versies/${v.id}`, { method: 'PATCH', body: JSON.stringify({ verleng: true }) }), 'Nog 3 dagen beschikbaar.')} className="text-xs underline text-gray-600">+3 dagen</button>}
                  </div>
                  <div className="p-4 space-y-3">
                    {v.bericht && <p className="text-sm text-gray-700 whitespace-pre-line">{v.bericht}</p>}
                    <BestandLijst bestanden={v.bestanden} verlopen={b.status === 'verlopen'} onKijk={(x) => setKijk({ b: x })} onDownload={download} />
                    {fb.length > 0 && (
                      <ul className="space-y-2">
                        {fb.map((f) => (
                          <li key={f.id} className={`rounded-xl border p-3 text-sm ${f.soort === 'goedkeuring' ? 'border-green-300 bg-green-50' : f.soort === 'revisie' ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
                            <p className="text-xs font-semibold flex items-center gap-1.5">
                              {f.soort === 'goedkeuring' ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : f.soort === 'revisie' ? <RotateCcw className="h-4 w-4 text-amber-700" /> : <MessageSquare className="h-4 w-4" />}
                              {f.soort === 'goedkeuring' ? 'Goedgekeurd' : f.soort === 'revisie' ? `Revisieronde ${f.ronde}` : 'Opmerking'} · {f.door_naam ?? 'Klant'} · {datumTijd(f.created_at)}
                            </p>
                            {f.tekst && <p className="mt-1 whitespace-pre-line">{f.tekst}</p>}
                            {f.punten.length > 0 && (
                              <ul className="mt-2 space-y-1">
                                {f.punten.map((p, i) => {
                                  const video = v.bestanden.find((x) => bestandSoort(x.mimetype) === 'video')
                                  return <li key={i} className="flex items-start gap-2"><TijdKnop sec={p.tijd} onKies={video && b.status === 'beschikbaar' ? (s) => setKijk({ b: video, tijd: s }) : undefined} /><span>{p.tekst}</span></li>
                                })}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              )
            })}
          </section>

          {o.omschrijving && <section><h3 className="text-sm font-semibold mb-1">Omschrijving</h3><p className="text-sm text-gray-700 whitespace-pre-line">{o.omschrijving}</p></section>}
        </div>

        <footer className="p-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500 flex items-center gap-1"><Lock className="h-3 w-3" />Enkel deze klant ziet de bestanden, met links die na enkele uren vervallen.</span>
          {mag.aanpassen && <button type="button" onClick={() => doe('archief', () => api(`/api/admin/opleveringen/${o.id}`, { method: 'PATCH', body: JSON.stringify({ archiveer: !o.gearchiveerd_op }) }), o.gearchiveerd_op ? 'Uit het archief gehaald.' : 'Gearchiveerd.').then(onSluit)} className="btn-secondary text-sm ml-auto"><Archive className="h-4 w-4" />{o.gearchiveerd_op ? 'Uit archief' : 'Archiveren'}</button>}
          {mag.verwijderen && <button type="button" onClick={() => setVraagWeg(true)} className="h-10 w-10 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50" aria-label="Oplevering verwijderen"><Trash2 className="h-4 w-4" /></button>}
        </footer>
      </aside>

      {kijk && (
        <div onClick={(e) => e.stopPropagation()}>
          <KijkVenster titel={kijk.b.naam} soort={bestandSoort(kijk.b.mimetype)} startTijd={kijk.tijd ?? null} haalUrl={() => urlVoor(kijk.b)} onDownload={() => download(kijk.b)} onSluit={() => setKijk(null)} />
        </div>
      )}
      {vraagWeg && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); setVraagWeg(false) }}>
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full space-y-3" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Oplevering verwijderen">
            <h3 className="font-semibold">Oplevering verwijderen?</h3>
            <p className="text-sm text-gray-600">&quot;{o.titel}&quot; verdwijnt met alle versies, feedback en bestanden. De klant ziet ze niet meer.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setVraagWeg(false)} className="btn-secondary">Annuleer</button>
              <button type="button" onClick={() => doe('weg', () => api(`/api/admin/opleveringen/${o.id}`, { method: 'DELETE' }), 'Verwijderd.').then(onSluit)} className="btn-primary !bg-red-600 !border-red-600">Verwijderen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BestandLijst({ bestanden, verlopen = false, onKijk, onDownload, onWeg }: { bestanden: Bestand[]; verlopen?: boolean; onKijk: (b: Bestand) => void; onDownload: (b: Bestand) => void; onWeg?: (b: Bestand) => void }) {
  if (!bestanden.length) return null
  return (
    <ul className="space-y-2">
      {bestanden.map((b) => (
        <li key={b.id} className="flex items-center gap-3 rounded-xl border border-gray-200 p-2">
          <div className="relative h-14 w-24 shrink-0 rounded-lg bg-gray-900 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {b.poster_url ? <img src={b.poster_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <SoortIcoon mime={b.mimetype} className="absolute inset-0 m-auto h-5 w-5 text-white/40" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{b.naam}</p>
            <p className="text-[11px] text-gray-500">
              {grootteLabel(b.grootte)}{b.duur ? ` · ${tijdLabel(Number(b.duur))}` : ''}{b.breedte && b.hoogte ? ` · ${b.breedte}×${b.hoogte}` : ''}
              {b.status !== 'klaar' ? ' · wordt opgeladen' : ''}{b.downloads ? ` · ${b.downloads}× gedownload` : ''}
            </p>
          </div>
          {!verlopen && b.status === 'klaar' && (
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => onKijk(b)} aria-label={`Bekijk ${b.naam}`} className="h-9 w-9 rounded-lg hover:bg-gray-100 flex items-center justify-center"><Eye className="h-4 w-4" /></button>
              <button type="button" onClick={() => onDownload(b)} aria-label={`Download ${b.naam}`} className="h-9 w-9 rounded-lg hover:bg-gray-100 flex items-center justify-center"><Download className="h-4 w-4" /></button>
              {onWeg && <button type="button" onClick={() => onWeg(b)} aria-label={`Verwijder ${b.naam}`} className="h-9 w-9 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 flex items-center justify-center"><Trash2 className="h-4 w-4" /></button>}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
