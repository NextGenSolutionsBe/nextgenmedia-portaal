'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Play, Square, Pause, PlayCircle, Loader2, Paperclip, Plus, X, ChevronRight, CalendarDays } from 'lucide-react'
import { api, Chip, datumNl, uurNl, kortUur, dagLang, duur, dagVanIso, INP, LBL, LinksLijst, type LinkItem } from '@/components/personeel/ui'
import { SESSIE_STATUS, WERKSTATUS, type SessieStatus, type Werkstatus } from '@/lib/personeel/model'

type Pauze = { start: string; eind: string | null }
type Sessie = { id: string; start_at: string; eind_at: string | null; pauzes: Pauze[]; status: SessieStatus; project: string | null; taak: string | null; planning_id: string | null; klant?: string | null; verslag?: Record<string, string | null> }
type Blok = { id: string; datum: string; start_tijd: string; eind_tijd: string; project: string | null; taak: string | null; briefing: string | null; klant?: string | null; werkstatus: Werkstatus; status: string; locatie: string | null; thuiswerk: boolean }
type Me = { profiel: { voornaam: string }; actief: Sessie | null; planning: Blok[]; recent: Sessie[]; ongelezen: number; vandaag: string }

/** Seconden gewerkt (zonder pauzes), live. */
function secondenGewerkt(s: Sessie, nu: number): number {
  const eind = s.eind_at ? new Date(s.eind_at).getTime() : nu
  let pauze = 0
  for (const p of s.pauzes ?? []) pauze += Math.max(0, (p.eind ? new Date(p.eind).getTime() : nu) - new Date(p.start).getTime())
  return Math.max(0, Math.floor((eind - new Date(s.start_at).getTime() - pauze) / 1000))
}
const klok = (sec: number) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`

export function KlokClient() {
  const [me, setMe] = useState<Me | null>(null)
  const [bezig, setBezig] = useState(false)
  const [nu, setNu] = useState(() => Date.now())
  const [keuze, setKeuze] = useState<string>('')          // planning-id of '' (iets anders)
  const [vrij, setVrij] = useState({ project: '', taak: '' })
  const [uitklokken, setUitklokken] = useState(false)

  const laad = useCallback(async () => {
    try { setMe(await api<Me>('/api/team/me')) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])
  useEffect(() => { const t = setInterval(() => setNu(Date.now()), 1000); return () => clearInterval(t) }, [])
  // Terug naar de app (tabblad weer zichtbaar): de sessie loopt op de server door, dus even verversen.
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible') laad() }; document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f) }, [laad])

  const vandaagBlokken = (me?.planning ?? []).filter((p) => p.datum === me?.vandaag)
  useEffect(() => { if (!keuze && vandaagBlokken.length) setKeuze(vandaagBlokken[0].id) }, [vandaagBlokken.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const actie = async (a: 'in' | 'pauze' | 'hervat', extra?: Record<string, unknown>) => {
    setBezig(true)
    try {
      await api('/api/team/klok', { body: { actie: a, ...extra } })
      toast.success({ in: 'Ingeklokt — je timer loopt.', pauze: 'Pauze gestart.', hervat: 'Weer aan het werk.' }[a])
      await laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); await laad() } finally { setBezig(false) }
  }

  if (!me) return <div className="py-16 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
  const a = me.actief
  const inPauze = !!a?.pauzes?.some((p) => !p.eind)
  const komend = me.planning.filter((p) => p.datum > me.vandaag).slice(0, 3)

  return (
    <div className="space-y-5">
      {/* ── De grote knop ── */}
      <section className={`rounded-2xl p-5 text-center shadow-sm border ${a ? (inPauze ? 'bg-amber-50 border-amber-200' : 'bg-sky-50 border-sky-200') : 'bg-white border-gray-200'}`}>
        {a ? (
          <>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{inPauze ? 'Pauze — timer staat stil' : 'Timer actief'}</div>
            <div className="text-5xl font-bold tabular-nums my-2">{klok(secondenGewerkt(a, nu))}</div>
            <div className="text-sm text-gray-600">Sinds {uurNl(a.start_at)}{a.project || a.taak ? ` · ${[a.klant, a.project, a.taak].filter(Boolean).join(' · ')}` : ''}</div>
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button type="button" disabled={bezig} onClick={() => actie(inPauze ? 'hervat' : 'pauze')} className="btn-secondary h-14 justify-center text-base">
                {inPauze ? <><PlayCircle className="h-5 w-5" />Hervatten</> : <><Pause className="h-5 w-5" />Pauze</>}
              </button>
              <button type="button" disabled={bezig} onClick={() => setUitklokken(true)} className="h-14 rounded-xl bg-black text-white font-semibold text-base inline-flex items-center justify-center gap-2 hover:bg-gray-800">
                <Square className="h-5 w-5" />Uitklokken
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Niet ingeklokt</div>
            <div className="text-sm text-gray-600 mt-1 capitalize">{dagLang(me.vandaag)}</div>
            <div className="text-left mt-4 space-y-2">
              <div className={LBL}>Waaraan ga je werken?</div>
              {vandaagBlokken.map((p) => (
                <label key={p.id} className={`flex items-start gap-2 rounded-xl border p-3 cursor-pointer ${keuze === p.id ? 'border-black bg-gray-50' : 'border-gray-200'}`}>
                  <input type="radio" name="keuze" className="mt-1" checked={keuze === p.id} onChange={() => setKeuze(p.id)} />
                  <span className="min-w-0"><span className="block text-sm font-medium">{kortUur(p.start_tijd)}–{kortUur(p.eind_tijd)} · {p.taak ?? p.project ?? 'Werkblok'}</span><span className="block text-xs text-gray-500 truncate">{[p.klant, p.project].filter(Boolean).join(' · ') || 'Geen klant'}</span></span>
                </label>
              ))}
              <label className={`flex items-start gap-2 rounded-xl border p-3 cursor-pointer ${keuze === '' ? 'border-black bg-gray-50' : 'border-gray-200'}`}>
                <input type="radio" name="keuze" className="mt-1" checked={keuze === ''} onChange={() => setKeuze('')} />
                <span className="flex-1 space-y-2">
                  <span className="block text-sm font-medium">{vandaagBlokken.length ? 'Iets anders' : 'Project of taak (optioneel)'}</span>
                  {keuze === '' && (
                    <>
                      <input className={INP} placeholder="Project (bv. klant of campagne)" value={vrij.project} onChange={(e) => setVrij({ ...vrij, project: e.target.value })} />
                      <input className={INP} placeholder="Taak (bv. montage reels)" value={vrij.taak} onChange={(e) => setVrij({ ...vrij, taak: e.target.value })} />
                    </>
                  )}
                </span>
              </label>
            </div>
            <button type="button" disabled={bezig} onClick={() => actie('in', keuze ? { planning_id: keuze } : { project: vrij.project, taak: vrij.taak })}
              className="mt-5 w-full h-16 rounded-2xl bg-[#fff848] text-black text-lg font-bold inline-flex items-center justify-center gap-2 shadow-sm hover:brightness-95 disabled:opacity-60">
              {bezig ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-6 w-6" />}Inklokken
            </button>
          </>
        )}
      </section>

      {/* ── Vandaag en straks ── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Vandaag</h2><Link href="/team/planning" className="text-xs text-gray-500 inline-flex items-center gap-0.5">Planning<ChevronRight className="h-3 w-3" /></Link></div>
        {vandaagBlokken.length === 0 && <div className="text-sm text-gray-400 bg-white rounded-xl border border-gray-100 p-4">Vandaag niets ingepland.</div>}
        {vandaagBlokken.map((p) => <BlokKaart key={p.id} p={p} />)}
        {komend.length > 0 && <h2 className="text-sm font-semibold pt-2">Binnenkort</h2>}
        {komend.map((p) => <BlokKaart key={p.id} p={p} toonDag />)}
      </section>

      {/* ── Recent ── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Laatste sessies</h2><Link href="/team/uren" className="text-xs text-gray-500 inline-flex items-center gap-0.5">Alle uren<ChevronRight className="h-3 w-3" /></Link></div>
        {me.recent.length === 0 && <div className="text-sm text-gray-400 bg-white rounded-xl border border-gray-100 p-4">Nog geen sessies.</div>}
        {me.recent.map((s) => (
          <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center justify-between gap-2">
            <div className="min-w-0"><div className="text-sm font-medium">{datumNl(dagVanIso(s.start_at))} · {uurNl(s.start_at)}–{uurNl(s.eind_at)}</div><div className="text-xs text-gray-500 truncate">{s.taak ?? s.project ?? '—'}</div></div>
            <Chip cls={SESSIE_STATUS[s.status].chip}>{SESSIE_STATUS[s.status].label}</Chip>
          </div>
        ))}
      </section>

      {uitklokken && a && <UitklokFormulier sessie={a} planning={me.planning.find((p) => p.id === a.planning_id) ?? null} onSluit={() => setUitklokken(false)} onKlaar={async () => { setUitklokken(false); await laad() }} secondenNu={secondenGewerkt(a, nu)} />}
    </div>
  )
}

function BlokKaart({ p, toonDag }: { p: Blok; toonDag?: boolean }) {
  return (
    <Link href={`/team/planning?blok=${p.id}`} prefetch={false} className="block bg-white rounded-xl border border-blue-100 p-3 hover:border-blue-300">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold"><CalendarDays className="h-3.5 w-3.5 inline -mt-0.5 mr-1 text-blue-600" />{toonDag ? `${datumNl(p.datum)} · ` : ''}{kortUur(p.start_tijd)}–{kortUur(p.eind_tijd)}</div>
        <Chip cls={WERKSTATUS[p.werkstatus]?.chip ?? ''} klein>{WERKSTATUS[p.werkstatus]?.label ?? p.werkstatus}</Chip>
      </div>
      <div className="text-sm mt-0.5">{p.taak ?? p.project ?? 'Werkblok'}</div>
      <div className="text-xs text-gray-500">{[p.klant, p.project, p.thuiswerk ? 'Thuiswerk' : p.locatie].filter(Boolean).join(' · ')}</div>
      {p.briefing && <div className="text-xs text-gray-600 mt-1 line-clamp-2">{p.briefing}</div>}
    </Link>
  )
}

/** Uitklokken: exacte eindtijd komt van de server; hier enkel het werkverslag. */
function UitklokFormulier({ sessie, planning, onSluit, onKlaar, secondenNu }: { sessie: Sessie; planning: Blok | null; onSluit: () => void; onKlaar: () => void; secondenNu: number }) {
  const [v, setV] = useState({ project: sessie.project ?? '', taak: sessie.taak ?? '', content: '', goed: '', mis: '', todo: '', blokkades: '' })
  const [links, setLinks] = useState<LinkItem[]>([])
  const [nieuweLink, setNieuweLink] = useState('')
  const [werkstatus, setWerkstatus] = useState<Werkstatus | ''>(planning ? (planning.werkstatus === 'nog_te_starten' ? 'bezig' : planning.werkstatus) : '')
  const [bezig, setBezig] = useState(false)
  const [upload, setUpload] = useState(false)

  const voegLinkToe = () => {
    const u = nieuweLink.trim()
    if (!/^https?:\/\//i.test(u)) { toast.error('Een link begint met http:// of https://'); return }
    setLinks((l) => [...l, { naam: u, url: u }]); setNieuweLink('')
  }
  const uploaden = async (f: File | null) => {
    if (!f) return
    setUpload(true)
    try { const fd = new FormData(); fd.append('file', f); const r = await api<{ pad: string; naam: string }>('/api/team/bestand', { form: fd }); setLinks((l) => [...l, { naam: r.naam, pad: r.pad }]) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Uploaden mislukt') } finally { setUpload(false) }
  }
  const verstuur = async () => {
    if (!v.taak.trim() && !v.content.trim()) { toast.error('Vul kort in welke taak je deed of wat je bewerkte.'); return }
    setBezig(true)
    try {
      const r = await api<{ minuten: number }>('/api/team/klok', { body: { actie: 'uit', verslag: v, links, project: v.project, werkstatus: werkstatus || undefined } })
      toast.success(`Uitgeklokt — ${duur(r.minuten)} ingediend ter controle.`)
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Uitklokken mislukt') } finally { setBezig(false) }
  }
  const veld = (k: keyof typeof v, label: string, ph: string, rijen = 2) => (
    <div><label className={LBL}>{label}</label><textarea rows={rijen} className={INP} placeholder={ph} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onSluit}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div><div className="font-semibold">Uitklokken</div><div className="text-xs text-gray-500">{uurNl(sessie.start_at)} tot nu · {duur(Math.floor(secondenNu / 60))} gewerkt</div></div>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div><label className={LBL}>Aan welk project werkte je?</label><input className={INP} value={v.project} onChange={(e) => setV({ ...v, project: e.target.value })} placeholder="Project" /></div>
          <div><label className={LBL}>Welke taak voerde je uit? *</label><input className={INP} value={v.taak} onChange={(e) => setV({ ...v, taak: e.target.value })} placeholder="bv. montage van 3 reels" /></div>
          {veld('content', "Welke video's of content bewerkte je?", 'bv. Reel 1 (showroom), Reel 2 (testimonial)…')}
          {veld('goed', 'Wat ging goed?', '')}
          {veld('mis', 'Wat liep mis?', '')}
          {veld('todo', 'Wat moet nog gebeuren?', '')}
          {veld('blokkades', 'Blokkades of vragen', '')}
          {planning && (
            <div><label className={LBL}>Status van je werkblok</label>
              <select className={INP} value={werkstatus} onChange={(e) => setWerkstatus(e.target.value as Werkstatus)}>
                {(Object.keys(WERKSTATUS) as Werkstatus[]).map((w) => <option key={w} value={w}>{WERKSTATUS[w].label}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <label className={LBL}>Bestanden of links (optioneel)</label>
            <LinksLijst links={links} bestandUrl={(p) => `/api/team/bestand?pad=${encodeURIComponent(p)}`} />
            <div className="flex gap-2"><input className={INP} placeholder="https://…" value={nieuweLink} onChange={(e) => setNieuweLink(e.target.value)} /><button type="button" onClick={voegLinkToe} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Link</button></div>
            <label className="btn-secondary text-xs w-fit cursor-pointer">{upload ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}Bestand toevoegen<input type="file" className="hidden" onChange={(e) => uploaden(e.target.files?.[0] ?? null)} /></label>
          </div>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4">
          <button type="button" disabled={bezig} onClick={verstuur} className="w-full h-14 rounded-xl bg-black text-white font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {bezig ? <Loader2 className="h-5 w-5 animate-spin" /> : <Square className="h-5 w-5" />}Uitklokken en indienen
          </button>
        </div>
      </div>
    </div>
  )
}
