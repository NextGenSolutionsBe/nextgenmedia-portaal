'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowDown, ArrowUp, ChevronLeft, Eye, Globe, ImagePlus, Loader2, Mail, Pencil, Plus, Save, Trash2, X, Type, Heading2, Image as ImageIcon,
  Images, Youtube, Quote, MousePointerClick, Star, EyeOff,
} from 'lucide-react'
import { INP, Bevestig } from '@/app/admin/instellingen/ui'
import { ArtikelWeergave } from '@/components/nieuws/artikel-weergave'
import { YoutubeVideo } from '@/components/media/youtube-video'
import { laadAfbeeldingOp } from '@/lib/marketing-upload'
import { publiekeUrl } from '@/lib/marketing-media'
import { youtubeId, youtubeKijkUrl } from '@/lib/youtube'
import { BLOK_TYPES, CATEGORIEEN, leestijd, nieuwBlok, type Blok, type BlokType, type Categorie, type Nieuwsbrief } from '@/lib/nieuwsbrieven'
import { MailDialoog } from './mail-dialoog'

type Concept = { titel: string; categorie: Categorie; samenvatting: string; cover_pad: string | null; cover_youtube: string; blokken: Blok[]; uitgelicht: boolean }
const LBL = 'block text-xs font-medium text-gray-600 mb-1'
const UPLOAD = '/api/admin/nieuwsbrieven/upload'
const ICOON: Record<BlokType, React.ElementType> = { tekst: Type, kop: Heading2, afbeelding: ImageIcon, galerij: Images, video: Youtube, citaat: Quote, knop: MousePointerClick }
const nieuwId = () => Math.random().toString(36).slice(2, 10)
const naarConcept = (n: Nieuwsbrief): Concept => ({
  titel: n.titel, categorie: n.categorie, samenvatting: n.samenvatting ?? '', cover_pad: n.cover_pad,
  cover_youtube: n.cover_youtube_id ? youtubeKijkUrl(n.cover_youtube_id) : '', blokken: n.blokken ?? [], uitgelicht: n.uitgelicht,
})
// Voor de server: video-blokken met een link worden een id.
const naarServer = (c: Concept) => ({
  ...c, cover_youtube_id: c.cover_youtube.trim() || null, cover_youtube: undefined,
  blokken: c.blokken.map((b) => (b.type === 'video' ? { ...b, youtube: b.youtube_id } : b)),
})

export function NieuwsbriefEditor({ id, magAanpassen, magVerwijderen }: { id: string; magAanpassen: boolean; magVerwijderen: boolean }) {
  const router = useRouter()
  const [n, setN] = useState<Nieuwsbrief | null>(null)
  const [c, setC] = useState<Concept | null>(null)
  const [weergave, setWeergave] = useState<'bewerk' | 'voorbeeld'>('bewerk')
  const [bezig, setBezig] = useState<string | null>(null)
  const [mail, setMail] = useState(false)
  const [weg, setWeg] = useState(false)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/nieuwsbrieven/${id}`, { cache: 'no-store' }); const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setN(j.nieuwsbrief); setC(naarConcept(j.nieuwsbrief))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); router.push('/admin/nieuwsbrieven') }
  }, [id, router])
  useEffect(() => { laad() }, [laad])

  const gewijzigd = !!n && !!c && JSON.stringify(naarConcept(n)) !== JSON.stringify(c)
  // Niet stil weggaan met wijzigingen.
  useEffect(() => {
    const voor = (e: BeforeUnloadEvent) => { if (gewijzigd) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', voor); return () => window.removeEventListener('beforeunload', voor)
  }, [gewijzigd])

  const actie = async (soort: 'bewaar' | 'publiceer' | 'depubliceer') => {
    if (!c) return
    setBezig(soort)
    try {
      const r = await fetch(`/api/admin/nieuwsbrieven/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(soort === 'depubliceer' ? { actie: soort } : { actie: soort, ...naarServer(c) }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setN(j.nieuwsbrief); setC(naarConcept(j.nieuwsbrief))
      toast.success(soort === 'publiceer' ? 'Gepubliceerd. Klanten zien het nu in hun klantapp.' : soort === 'depubliceer' ? 'Offline gehaald.' : 'Bewaard.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const voorbeeld = useMemo(() => c && n ? {
    titel: c.titel, categorie: c.categorie, samenvatting: c.samenvatting || null, cover_url: publiekeUrl(c.cover_pad), cover_youtube_id: youtubeId(c.cover_youtube),
    blokken: c.blokken.filter((b) => (b.type === 'video' ? !!youtubeId(b.youtube_id) : true)).map((b) => (b.type === 'video' ? { ...b, youtube_id: youtubeId(b.youtube_id)! } : b)),
    gepubliceerd_op: n.gepubliceerd_op, leestijd: leestijd({ blokken: c.blokken, samenvatting: c.samenvatting }), auteur_naam: n.auteur_naam,
  } : null, [c, n])

  if (!n || !c || !voorbeeld) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
  const zet = <K extends keyof Concept>(k: K, w: Concept[K]) => setC((x) => (x ? { ...x, [k]: w } : x))
  const zetBlok = (bid: string, patch: Partial<Blok>) => setC((x) => (x ? { ...x, blokken: x.blokken.map((b) => (b.id === bid ? { ...b, ...patch } as Blok : b)) } : x))
  const voegToe = (type: BlokType) => setC((x) => (x ? { ...x, blokken: [...x.blokken, nieuwBlok(type, nieuwId())] } : x))
  const schuif = (i: number, r: -1 | 1) => setC((x) => { if (!x) return x; const l = [...x.blokken]; const j = i + r; if (j < 0 || j >= l.length) return x; [l[i], l[j]] = [l[j], l[i]]; return { ...x, blokken: l } })
  const verwijderBlok = (bid: string) => setC((x) => (x ? { ...x, blokken: x.blokken.filter((b) => b.id !== bid) } : x))
  const gepubliceerd = n.status === 'gepubliceerd'
  const alleenLezen = !magAanpassen

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Kopbalk */}
      <div className="sticky top-14 z-20 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-2.5 bg-white/95 backdrop-blur border-b border-gray-200 flex flex-wrap items-center gap-2">
        <Link href="/admin/nieuwsbrieven" className="btn-secondary !px-2" aria-label="Terug naar nieuwsbrieven" onClick={(e) => { if (gewijzigd && !confirm('Je hebt wijzigingen die nog niet bewaard zijn. Toch weggaan?')) e.preventDefault() }}><ChevronLeft className="h-4 w-4" /></Link>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${gepubliceerd ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{gepubliceerd ? 'Gepubliceerd' : 'Concept'}</span>
        {gewijzigd && <span className="text-xs text-amber-700">Niet bewaard</span>}
        <div className="flex gap-1.5 lg:hidden ml-auto" role="tablist">
          <button type="button" role="tab" aria-selected={weergave === 'bewerk'} onClick={() => setWeergave('bewerk')} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${weergave === 'bewerk' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200'}`}><Pencil className="h-3.5 w-3.5 inline mr-1" />Bewerken</button>
          <button type="button" role="tab" aria-selected={weergave === 'voorbeeld'} onClick={() => setWeergave('voorbeeld')} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${weergave === 'voorbeeld' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200'}`}><Eye className="h-3.5 w-3.5 inline mr-1" />Voorbeeld</button>
        </div>
        {magAanpassen && (
          <div className="flex flex-wrap gap-1.5 w-full sm:w-auto sm:ml-auto lg:ml-auto">
            <button type="button" onClick={() => actie('bewaar')} disabled={!!bezig || !gewijzigd} className="btn-secondary !py-1.5 text-xs">{bezig === 'bewaar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Bewaren</button>
            {gepubliceerd
              ? <>
                  {gewijzigd && <button type="button" onClick={() => actie('publiceer')} disabled={!!bezig} className="btn-primary !py-1.5 text-xs"><Globe className="h-3.5 w-3.5" />Wijzigingen publiceren</button>}
                  <button type="button" onClick={() => actie('depubliceer')} disabled={!!bezig} className="btn-secondary !py-1.5 text-xs"><EyeOff className="h-3.5 w-3.5" />Offline halen</button>
                  <button type="button" onClick={() => setMail(true)} disabled={!!bezig || gewijzigd} title={gewijzigd ? 'Bewaar of publiceer eerst je wijzigingen' : undefined} className="btn-primary !py-1.5 text-xs"><Mail className="h-3.5 w-3.5" />Per mail versturen</button>
                </>
              : <button type="button" onClick={() => actie('publiceer')} disabled={!!bezig} className="btn-primary !py-1.5 text-xs">{bezig === 'publiceer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}Publiceren</button>}
            {magVerwijderen && !gepubliceerd && <button type="button" onClick={() => setWeg(true)} className="btn-secondary !py-1.5 !px-2 text-xs text-red-600" aria-label="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        )}
      </div>
      {n.mail_verstuurd_op && <p className="text-xs text-gray-500 flex items-center gap-1"><Mail className="h-3.5 w-3.5" />Gemaild naar {n.mail_aantal ?? 0} ontvangers, laatst op {new Date(n.mail_verstuurd_op).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>}

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        {/* Bewerken */}
        <fieldset disabled={alleenLezen} className={`space-y-4 ${weergave === 'bewerk' ? '' : 'hidden lg:block'}`}>
          <section className="card-base space-y-3">
            <div><label className={LBL} htmlFor="nb-titel">Titel</label><input id="nb-titel" className={`${INP} text-base font-semibold`} value={c.titel} maxLength={160} onChange={(e) => zet('titel', e.target.value)} placeholder="Bv. Zo kreeg Bakkerij Peeters 3x meer bereik" /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className={LBL} htmlFor="nb-cat">Categorie</label>
                <select id="nb-cat" className={INP} value={c.categorie} onChange={(e) => zet('categorie', e.target.value as Categorie)}>{CATEGORIEEN.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></div>
              <label className="flex items-center gap-2 text-sm sm:pt-6 cursor-pointer"><input type="checkbox" checked={c.uitgelicht} onChange={(e) => zet('uitgelicht', e.target.checked)} /><Star className="h-4 w-4 text-amber-500" />Uitgelicht bovenaan de feed</label>
            </div>
            <div><label className={LBL} htmlFor="nb-sam">Korte intro <span className="font-normal text-gray-400">(staat in de feed en bovenaan het artikel)</span></label><textarea id="nb-sam" rows={2} maxLength={400} className={INP} value={c.samenvatting} onChange={(e) => zet('samenvatting', e.target.value)} placeholder="Eén of twee zinnen die zin geven om verder te lezen." /></div>
            <CoverInvoer c={c} zet={zet} />
          </section>

          {c.blokken.map((b, i) => {
            const I = ICOON[b.type]
            return (
              <section key={b.id} className="card-base !p-4 space-y-2.5">
                <div className="flex items-center gap-2">
                  <I className="h-4 w-4 text-gray-500" />
                  <span className="text-xs font-semibold text-gray-600 flex-1">{BLOK_TYPES.find((t) => t.type === b.type)?.label}</span>
                  <button type="button" onClick={() => schuif(i, -1)} disabled={i === 0} className="h-7 w-7 rounded-lg hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center" aria-label="Blok omhoog"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => schuif(i, 1)} disabled={i === c.blokken.length - 1} className="h-7 w-7 rounded-lg hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center" aria-label="Blok omlaag"><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => verwijderBlok(b.id)} className="h-7 w-7 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center" aria-label="Blok verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <BlokInvoer b={b} zet={(p) => zetBlok(b.id, p)} />
              </section>
            )
          })}

          {magAanpassen && (
            <section className="rounded-2xl border border-dashed border-gray-300 p-3">
              <p className="text-xs font-medium text-gray-600 mb-2 flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Blok toevoegen</p>
              <div className="flex flex-wrap gap-1.5">
                {BLOK_TYPES.map((t) => { const I = ICOON[t.type]; return <button key={t.type} type="button" onClick={() => voegToe(t.type)} className="btn-secondary !py-1.5 text-xs"><I className="h-3.5 w-3.5" />{t.label}</button> })}
              </div>
            </section>
          )}
        </fieldset>

        {/* Voorbeeld zoals de klant het ziet */}
        <div className={`lg:sticky lg:top-32 ${weergave === 'voorbeeld' ? '' : 'hidden lg:block'}`}>
          <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Eye className="h-3.5 w-3.5" />Zo zien klanten het</p>
          <div className="card-base lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto"><ArtikelWeergave a={voorbeeld} /></div>
        </div>
      </div>

      {mail && <MailDialoog id={id} onSluit={() => setMail(false)} onVerstuurd={laad} />}
      {weg && <Bevestig titel="Nieuwsbrief verwijderen" tekst={`"${n.titel}" verdwijnt definitief.`} bevestigLabel="Verwijderen" gevaarlijk onAnnuleer={() => setWeg(false)}
        onBevestig={async () => { try { const r = await fetch(`/api/admin/nieuwsbrieven/${id}`, { method: 'DELETE' }); const j = await r.json(); if (!r.ok) throw new Error(j.error); toast.success('Verwijderd.'); router.push('/admin/nieuwsbrieven') } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } }} />}
    </div>
  )
}

function Opladen({ meerdere = false, label, onKlaar }: { meerdere?: boolean; label: string; onKlaar: (paden: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [bezig, setBezig] = useState(0)
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} disabled={bezig > 0} className="btn-secondary !py-1.5 text-xs">{bezig > 0 ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Bezig ({bezig})</> : <><ImagePlus className="h-3.5 w-3.5" />{label}</>}</button>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple={meerdere} className="sr-only" onChange={async (e) => {
        const lijst = Array.from(e.target.files ?? []); e.target.value = ''
        if (!lijst.length) return
        setBezig(lijst.length)
        const paden: string[] = []
        for (const f of lijst) {
          try { paden.push((await laadAfbeeldingOp(UPLOAD, f)).pad) } catch (err) { toast.error(`${f.name}: ${err instanceof Error ? err.message : 'opladen mislukt'}`) }
          setBezig((n) => n - 1)
        }
        if (paden.length) onKlaar(paden)
      }} />
    </>
  )
}

function CoverInvoer({ c, zet }: { c: Concept; zet: <K extends keyof Concept>(k: K, w: Concept[K]) => void }) {
  const url = publiekeUrl(c.cover_pad)
  const vid = youtubeId(c.cover_youtube)
  return (
    <div className="space-y-2">
      <p className={LBL}>Cover <span className="font-normal text-gray-400">(foto, of een YouTube-video)</span></p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && !vid && <img src={url} alt="" className="w-full aspect-[16/9] object-cover rounded-xl bg-gray-100" />}
      {vid && <YoutubeVideo id={vid} titel="Covervideo" rond="rounded-xl" />}
      <div className="flex flex-wrap items-center gap-2">
        <Opladen label={c.cover_pad ? 'Andere coverfoto' : 'Coverfoto opladen'} onKlaar={(p) => zet('cover_pad', p[0])} />
        {c.cover_pad && <button type="button" onClick={() => zet('cover_pad', null)} className="text-xs text-gray-500 underline">Foto weghalen</button>}
      </div>
      <input className={INP} value={c.cover_youtube} onChange={(e) => zet('cover_youtube', e.target.value)} placeholder="Of plak een YouTube-link als covervideo" aria-label="YouTube-link als covervideo" />
      {c.cover_youtube && !vid && <p className="text-xs text-red-700">Dit is geen YouTube-link die we herkennen.</p>}
    </div>
  )
}

function BlokInvoer({ b, zet }: { b: Blok; zet: (p: Partial<Blok>) => void }) {
  switch (b.type) {
    case 'tekst':
      return (
        <>
          <textarea rows={Math.min(16, Math.max(5, b.tekst.split('\n').length + 1))} className={`${INP} leading-relaxed`} value={b.tekst} onChange={(e) => zet({ tekst: e.target.value })} placeholder="Schrijf je tekst. Een witregel begint een nieuwe alinea." />
          <p className="text-[11px] text-gray-400">**vet**, *cursief*, [tekst](https://link) en een lijstje met “- ” vooraan.</p>
        </>
      )
    case 'kop': return <input className={`${INP} font-semibold`} value={b.tekst} maxLength={160} onChange={(e) => zet({ tekst: e.target.value })} placeholder="Tussenkop" />
    case 'afbeelding': {
      const url = publiekeUrl(b.pad)
      return (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url && <img src={url} alt="" className="w-full max-h-72 object-cover rounded-xl bg-gray-100" />}
          <Opladen label={b.pad ? 'Andere foto' : 'Foto opladen'} onKlaar={(p) => zet({ pad: p[0] })} />
          <input className={INP} value={b.onderschrift} maxLength={300} onChange={(e) => zet({ onderschrift: e.target.value })} placeholder="Onderschrift (optioneel)" />
        </div>
      )
    }
    case 'galerij':
      return (
        <div className="space-y-2">
          {b.paden.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {b.paden.map((p) => (
                <div key={p} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={publiekeUrl(p) ?? ''} alt="" className="w-full aspect-square object-cover rounded-lg bg-gray-100" />
                  <button type="button" onClick={() => zet({ paden: b.paden.filter((x) => x !== p) })} className="absolute right-1 top-1 h-6 w-6 rounded-full bg-white/90 flex items-center justify-center shadow" aria-label="Foto weghalen"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}
          {b.paden.length < 12 && <Opladen meerdere label="Foto's toevoegen" onKlaar={(p) => zet({ paden: [...b.paden, ...p].slice(0, 12) })} />}
          <p className="text-[11px] text-gray-400">Tot 12 foto's. Grote foto's worden automatisch verkleind.</p>
        </div>
      )
    case 'video': {
      const vid = youtubeId(b.youtube_id)
      return (
        <div className="space-y-2">
          <input className={INP} value={b.youtube_id && vid === b.youtube_id ? youtubeKijkUrl(b.youtube_id) : b.youtube_id} onChange={(e) => zet({ youtube_id: e.target.value })} placeholder="YouTube-link of embedcode" />
          {b.youtube_id && !vid && <p className="text-xs text-red-700">Dit is geen YouTube-link die we herkennen.</p>}
          {vid && <YoutubeVideo id={vid} titel={b.onderschrift || 'Video'} rond="rounded-xl" />}
          <input className={INP} value={b.onderschrift} maxLength={300} onChange={(e) => zet({ onderschrift: e.target.value })} placeholder="Onderschrift (optioneel)" />
        </div>
      )
    }
    case 'citaat':
      return (
        <div className="space-y-2">
          <textarea rows={3} className={INP} value={b.tekst} maxLength={1000} onChange={(e) => zet({ tekst: e.target.value })} placeholder="Wat zei de klant?" />
          <input className={INP} value={b.wie} maxLength={160} onChange={(e) => zet({ wie: e.target.value })} placeholder="Wie zei het? Bv. Ann Peeters, zaakvoerder" />
        </div>
      )
    case 'knop':
      return (
        <div className="grid sm:grid-cols-2 gap-2">
          <input className={INP} value={b.tekst} maxLength={60} onChange={(e) => zet({ tekst: e.target.value })} placeholder="Knoptekst, bv. Bekijk de website" />
          <input className={INP} value={b.url} onChange={(e) => zet({ url: e.target.value })} placeholder="https://…" />
        </div>
      )
  }
}
