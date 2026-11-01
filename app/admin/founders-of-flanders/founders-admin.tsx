'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Eye, EyeOff, Inbox, Loader2, Pencil, Plus, Trash2, ArrowRight , Youtube} from 'lucide-react'
import { Dialoog, Bevestig, INP } from '@/app/admin/instellingen/ui'
import { YoutubeVideo } from '@/components/media/youtube-video'
import { EmbedFrame } from '@/components/media/embed-frame'
import { herkenEmbed } from '@/lib/embeds'
import { youtubeId, youtubeKijkUrl } from '@/lib/youtube'
import { naarFoundersVideo, type FoundersVideo } from '@/lib/founders-of-flanders'

type Concept = { titel: string; ondernemer: string; bedrijf: string; beschrijving: string; youtube: string; formaat: 'liggend' | 'staand' }
const LBL = 'block text-xs font-medium text-gray-600 mb-1'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Mislukt')
  return j as T
}

export function FoundersAdmin({ magAanpassen }: { magAanpassen: boolean }) {
  const [videos, setVideos] = useState<FoundersVideo[] | null>(null)
  const [open, setOpen] = useState(0)
  const [kanaal, setKanaal] = useState<string>('')
  const [kanaalBezig, setKanaalBezig] = useState(false)
  const [bewerk, setBewerk] = useState<{ id: string | null; c: Concept } | null>(null)
  const [weg, setWeg] = useState<FoundersVideo | null>(null)
  const laad = useCallback(async () => {
    try { const j = await api<{ videos: FoundersVideo[]; open_aanvragen: number; kanaal: string | null }>('/api/admin/founders-of-flanders'); setVideos(j.videos.map((v) => naarFoundersVideo(v as unknown as Record<string, unknown>))); setOpen(j.open_aanvragen); setKanaal(j.kanaal ?? '') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setVideos([]) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const wissel = async (v: FoundersVideo, patch: Partial<FoundersVideo>) => {
    setVideos((l) => l?.map((x) => (x.id === v.id ? { ...x, ...patch } : x)) ?? l)
    try { await api(`/api/admin/founders-of-flanders/${v.id}`, { method: 'PATCH', body: JSON.stringify(patch) }) } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); laad() }
  }
  const schuif = async (i: number, r: -1 | 1) => {
    if (!videos) return
    const j = i + r
    if (j < 0 || j >= videos.length) return
    const n = [...videos]; [n[i], n[j]] = [n[j], n[i]]; setVideos(n)
    try { await Promise.all([api(`/api/admin/founders-of-flanders/${n[i].id}`, { method: 'PATCH', body: JSON.stringify({ volgorde: i + 1 }) }), api(`/api/admin/founders-of-flanders/${n[j].id}`, { method: 'PATCH', body: JSON.stringify({ volgorde: j + 1 }) })]) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); laad() }
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/aanvragen?soort=founders" className="card-base !p-4 flex items-center gap-3 hover:ring-2 hover:ring-gray-200">
        <Inbox className="h-5 w-5 text-gray-500 shrink-0" />
        <span className="flex-1 text-sm"><b>{open}</b> open founder-aanvra{open === 1 ? 'ag' : 'gen'} — beoordelen, offerte en planning bij Aanvragen</span>
        <ArrowRight className="h-4 w-4 text-gray-400" />
      </Link>
      <div className="card-base !p-4 space-y-2">
        <label className="text-sm font-medium flex items-center gap-2" htmlFor="f-kanaal"><Youtube className="h-4 w-4 text-red-600" />YouTube-kanaal van Founders of Flanders</label>
        <p className="text-xs text-gray-500">De klant ziet een knop “Bekijk alle video's op YouTube”. Op deze pagina staan enkel de video's die je hieronder zelf toevoegt; nieuwsbrieven staan hier nooit tussen.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input id="f-kanaal" className={INP} value={kanaal} onChange={(e) => setKanaal(e.target.value)} placeholder="https://www.youtube.com/@foundersofflanders" disabled={!magAanpassen} />
          {magAanpassen && <button type="button" disabled={kanaalBezig} className="btn-secondary shrink-0" onClick={async () => {
            setKanaalBezig(true)
            try { const j = await api<{ kanaal: string | null }>('/api/admin/founders-of-flanders', { method: 'PATCH', body: JSON.stringify({ kanaal }) }); setKanaal(j.kanaal ?? ''); toast.success(j.kanaal ? 'Kanaal bewaard.' : 'Kanaal weggehaald.') }
            catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setKanaalBezig(false) }
          }}>{kanaalBezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>}
        </div>
      </div>
      {magAanpassen && <button type="button" onClick={() => setBewerk({ id: null, c: { titel: '', ondernemer: '', bedrijf: '', beschrijving: '', youtube: '', formaat: 'liggend' } })} className="btn-primary"><Plus className="h-4 w-4" />Video toevoegen</button>}
      {videos === null ? <div className="card-base flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        : videos.length === 0 ? <div className="card-base text-sm text-gray-500">Nog geen voorbeeldvideo's. Zet een video op YouTube (mag “niet vermeld”) of plak de link van een Instagram-, Facebook- of LinkedIn-post.</div>
        : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {videos.map((v, i) => (
              <li key={v.id} className={`card-base !p-0 overflow-hidden flex flex-col ${v.zichtbaar ? '' : 'opacity-60'}`}>
                <div className={v.embed ? 'bg-gray-50 p-3' : v.formaat === 'staand' ? 'bg-gray-950 py-3' : ''}>
                  {v.embed ? <EmbedFrame e={v.embed} titel={v.titel} className="max-w-[260px]" />
                    : v.youtube_id ? <YoutubeVideo id={v.youtube_id} titel={v.titel} rond={v.formaat === 'staand' ? 'rounded-xl' : 'rounded-none'} staand={v.formaat === 'staand'} className={v.formaat === 'staand' ? 'max-w-[200px]' : ''} /> : null}
                </div>
                <div className="p-4 space-y-1 flex-1">
                  <p className="font-semibold">{v.titel}</p>
                  <p className="text-xs text-gray-500">{[v.ondernemer, v.bedrijf].filter(Boolean).join(' · ') || '—'}</p>
                  {v.beschrijving && <p className="text-sm text-gray-600 line-clamp-2">{v.beschrijving}</p>}
                </div>
                {magAanpassen && (
                  <div className="px-4 pb-4 flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setBewerk({ id: v.id, c: { titel: v.titel, ondernemer: v.ondernemer ?? '', bedrijf: v.bedrijf ?? '', beschrijving: v.beschrijving ?? '', youtube: v.embed ? v.embed.url : !v.youtube_id ? '' : v.formaat === 'staand' ? `https://www.youtube.com/shorts/${v.youtube_id}` : youtubeKijkUrl(v.youtube_id), formaat: v.formaat === 'staand' ? 'staand' : 'liggend' } })} className="btn-secondary !py-1.5 text-xs"><Pencil className="h-3.5 w-3.5" />Bewerken</button>
                    <button type="button" onClick={() => wissel(v, { zichtbaar: !v.zichtbaar })} className="btn-secondary !py-1.5 text-xs">{v.zichtbaar ? <><EyeOff className="h-3.5 w-3.5" />Verbergen</> : <><Eye className="h-3.5 w-3.5" />Tonen</>}</button>
                    <button type="button" onClick={() => schuif(i, -1)} disabled={i === 0} className="btn-secondary !py-1.5 !px-2 text-xs" aria-label="Naar voren"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => schuif(i, 1)} disabled={i === videos.length - 1} className="btn-secondary !py-1.5 !px-2 text-xs" aria-label="Naar achter"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => setWeg(v)} className="btn-secondary !py-1.5 !px-2 text-xs text-red-600 ml-auto" aria-label="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      {bewerk && <VideoDialoog start={bewerk} onSluit={() => setBewerk(null)} onKlaar={() => { setBewerk(null); laad() }} />}
      {weg && <Bevestig titel="Video verwijderen" tekst={`"${weg.titel}" verdwijnt uit de klantapp. De video zelf blijft op YouTube staan.`} bevestigLabel="Verwijderen" gevaarlijk
        onAnnuleer={() => setWeg(null)} onBevestig={async () => { try { await api(`/api/admin/founders-of-flanders/${weg.id}`, { method: 'DELETE' }); toast.success('Video verwijderd.'); setWeg(null); laad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } }} />}
    </div>
  )
}

function VideoDialoog({ start, onSluit, onKlaar }: { start: { id: string | null; c: Concept }; onSluit: () => void; onKlaar: () => void }) {
  const [c, setC] = useState<Concept>(start.c)
  const [bezig, setBezig] = useState(false)
  const id = youtubeId(c.youtube)
  // Geen YouTube? Dan misschien een social post (Instagram, Facebook, LinkedIn).
  const post = !id && c.youtube.trim() ? herkenEmbed(c.youtube, c.formaat === 'staand' ? 'staand' : undefined) : null
  const embed = post?.ok && post.embed.provider !== 'youtube' ? post.embed : null
  const geldig = !!id || !!embed
  const zet = (k: keyof Concept, w: string) => setC((x) => ({ ...x, [k]: w, ...(k === 'youtube' && /\/shorts\/|\/reels?\//.test(w) ? { formaat: 'staand' as const } : {}) }))
  const bewaar = async () => {
    setBezig(true)
    try {
      await api(start.id ? `/api/admin/founders-of-flanders/${start.id}` : '/api/admin/founders-of-flanders', { method: start.id ? 'PATCH' : 'POST', body: JSON.stringify(c) })
      toast.success(start.id ? 'Video bijgewerkt.' : 'Video toegevoegd. Klanten zien ze meteen.')
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel={start.id ? 'Video bewerken' : 'Video toevoegen'} onSluit={onSluit} breed>
      <div className="space-y-3">
        <div><label className={LBL} htmlFor="f-yt">YouTube-link of social post *</label><input id="f-yt" className={INP} value={c.youtube} onChange={(e) => zet('youtube', e.target.value)} placeholder="https://youtu.be/… of de link/embedcode van een Instagram-, Facebook- of LinkedIn-post" />
          <p className="text-[11px] text-gray-500 mt-1">YouTube (ook Shorts), of een post of reel van Instagram, Facebook of LinkedIn: plak de link of de embedcode.</p>
          {c.youtube && !geldig && <p className="text-xs text-red-700 mt-1">{post && !post.ok ? post.fout : 'Dit herkennen we niet als YouTube-video of social post.'}</p>}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-500">Formaat:</span>
          {(['liggend', 'staand'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={c.formaat === f} onClick={() => setC((x) => ({ ...x, formaat: f }))}
              className={`rounded-full border px-2.5 py-1 ${c.formaat === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:border-gray-400'}`}>{f === 'liggend' ? 'Liggend (16:9)' : 'Staand (reel / Short)'}</button>
          ))}
        </div>
        {id && <YoutubeVideo id={id} titel={c.titel || 'Voorbeeld'} staand={c.formaat === 'staand'} />}
        {embed && <EmbedFrame e={embed} titel={c.titel || 'Voorbeeld'} />}
        <div><label className={LBL} htmlFor="f-titel">Titel *</label><input id="f-titel" className={INP} value={c.titel} onChange={(e) => zet('titel', e.target.value)} placeholder="Bv. Van garage tot 20 medewerkers" /></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className={LBL} htmlFor="f-ond">Ondernemer</label><input id="f-ond" className={INP} value={c.ondernemer} onChange={(e) => zet('ondernemer', e.target.value)} /></div>
          <div><label className={LBL} htmlFor="f-bedrijf">Bedrijf</label><input id="f-bedrijf" className={INP} value={c.bedrijf} onChange={(e) => zet('bedrijf', e.target.value)} /></div>
        </div>
        <div><label className={LBL} htmlFor="f-besch">Korte beschrijving</label><textarea id="f-besch" rows={3} maxLength={800} className={INP} value={c.beschrijving} onChange={(e) => zet('beschrijving', e.target.value)} /></div>
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button>
          <button type="button" onClick={bewaar} disabled={bezig || !geldig} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
        </div>
      </div>
    </Dialoog>
  )
}
