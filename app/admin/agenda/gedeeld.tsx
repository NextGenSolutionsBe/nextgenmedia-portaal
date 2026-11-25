'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Search, X, Folder, List as ListIcon, ChevronRight, Plus } from 'lucide-react'
import { PersoonFoto, PersoonKnop } from '@/components/admin/persoon-foto'
import { zoekVeld } from '@/lib/zoekveld'
import type { Persoon, Label, Space, Map as AgMap, Lijst, DocKort, Item, KleurContext } from '@/lib/agenda/model'
import { PALET, mapKleur, isKleur } from '@/lib/agenda/model'

export const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1'

export type Klant = { id: string; naam: string; gearchiveerd: boolean }
export type ClickupBron = { id: string; sleutel: string; persoon_id: string | null; clickup_naam: string | null; actief: boolean; fase: string; volledig_op: string | null; laatste_sync_op: string | null; bezig_sinds: string | null; tellers: Record<string, number>; fout: string | null; eigen: boolean; gedeeld: boolean }
export type LijstMetStatus = Lijst & { statussen?: { status: string; kleur: string; type: string }[] | null }

export type BoomData = {
  ik: string; isAdmin: boolean
  spaces: Space[]; mappen: AgMap[]; lijsten: LijstMetStatus[]; docs: DocKort[]
  leden: Record<string, string[]>
  personen: Persoon[]; zaakvoerders: string[]; labels: Label[]; klanten: Klant[]; klantKleuren: Record<string, string>
  deelIkMet: string[]; zieIkVan: string[]
  clickup: ClickupBron[]
  mailVoorstellen: number
  meetings: boolean
  rechten: { toevoegen?: boolean; aanpassen?: boolean; verwijderen?: boolean; instellingen?: boolean }
}

export class ApiFout extends Error { constructor(msg: string, public status: number) { super(msg) } }
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiFout((j as { error?: string }).error ?? 'Er ging iets mis', res.status)
  return j as T
}
export const actie = <T = { ok: true; id?: string; versie?: string }>(body: Record<string, unknown>) => api<T>('/api/admin/agenda', body)

/** Kleurcontext voor kleurVan (klant via de map, labels, lijsten). */
export function kleurContext(b: BoomData): KleurContext {
  return {
    klantKleuren: b.klantKleuren,
    labels: Object.fromEntries(b.labels.map((l) => [l.id, l])),
    lijsten: Object.fromEntries(b.lijsten.map((l) => [l.id, l])),
    mappen: Object.fromEntries(b.mappen.map((m) => [m.id, m])),
  }
}

/** "NextGen Agency BV › Klanten › Verheyen › Content" */
export function padVan(b: BoomData, lijstId: string | null): string[] {
  if (!lijstId) return []
  const l = b.lijsten.find((x) => x.id === lijstId)
  if (!l) return []
  const pad: string[] = [l.naam]
  let m = l.map_id ? b.mappen.find((x) => x.id === l.map_id) : undefined
  for (let i = 0; m && i < 6; i++) { pad.unshift(m.naam); m = m.parent_id ? b.mappen.find((x) => x.id === m!.parent_id) : undefined }
  const s = b.spaces.find((x) => x.id === l.space_id)
  if (s) pad.unshift(s.naam)
  return pad
}

export const voornaam = (p: Persoon | undefined | null) => (p?.naam ?? '').split(/\s+/)[0] || 'Iemand'

/** Kleine ronde foto's van wie op een item staat. */
export function Avatars({ ids, personen, max = 3, maat = 18 }: { ids: string[]; personen: Map<string, Persoon>; max?: number; maat?: number }) {
  if (!ids.length) return null
  const toon = ids.slice(0, max)
  return (
    <span className="inline-flex -space-x-1.5 shrink-0" title={ids.map((i) => personen.get(i)?.naam ?? '?').join(', ')}>
      {toon.map((i) => <span key={i} className="rounded-full ring-2 ring-white inline-flex"><PersoonFoto naam={personen.get(i)?.naam ?? '?'} maat={maat} /></span>)}
      {ids.length > max && <span className="rounded-full ring-2 ring-white bg-gray-200 text-[9px] font-semibold text-gray-700 inline-flex items-center justify-center" style={{ width: maat, height: maat }}>+{ids.length - max}</span>}
    </span>
  )
}

/** Een keuzelijst die opent onder een knop en sluit bij een klik ernaast of Escape. */
export function Popover({ open, onSluit, children, className = '', uitlijnen = 'links' }: { open: boolean; onSluit: () => void; children: ReactNode; className?: string; uitlijnen?: 'links' | 'rechts' }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const klik = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onSluit() }
    const toets = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    const t = setTimeout(() => document.addEventListener('mousedown', klik), 0)
    document.addEventListener('keydown', toets)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', klik); document.removeEventListener('keydown', toets) }
  }, [open, onSluit])
  if (!open) return null
  // Op de gsm een blad onderaan over de volle breedte (een menu in een schuivende rij zou afgesneden worden).
  return (
    <>
      <div className="md:hidden fixed inset-0 z-40 bg-black/20" aria-hidden onMouseDown={onSluit} />
      <div ref={ref} className={`fixed md:absolute inset-x-2 bottom-2 md:inset-x-auto md:bottom-auto z-50 md:z-40 md:mt-1 ${uitlijnen === 'rechts' ? 'md:right-0' : 'md:left-0'} bg-white rounded-2xl md:rounded-xl border border-gray-200 shadow-2xl md:shadow-xl max-h-[75dvh] overflow-y-auto md:max-h-none md:overflow-visible ${className} max-md:!w-auto`}>{children}</div>
    </>
  )
}

/** Personen kiezen met foto en zoeken (meerdere). */
export function PersonenLijst({ personen, gekozen, onWissel, ik, eerst = [], vol = false }: { personen: Persoon[]; gekozen: string[]; onWissel: (id: string) => void; ik?: string; eerst?: string[]; vol?: boolean }) {
  const [q, setQ] = useState('')
  const rang = (p: Persoon) => (p.id === ik ? 0 : eerst.includes(p.id) ? 1 : p.user_id ? 2 : 3)
  const lijst = personen.filter((p) => p.actief && p.naam.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => rang(a) - rang(b) || a.naam.localeCompare(b.naam))
  return (
    <div className={`w-full ${vol ? '' : 'md:w-64'} p-2`}>
      <div className="relative mb-1.5"><Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input {...zoekVeld()} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek iemand…" className="input-base !py-1.5 !pl-8 text-sm" aria-label="Zoek iemand" />
      </div>
      <ul className="max-h-72 overflow-y-auto">
        {lijst.map((p) => {
          const aan = gekozen.includes(p.id)
          return (
            <li key={p.id}>
              <button type="button" role="checkbox" aria-checked={aan} onClick={() => onWissel(p.id)} className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-2 md:py-1.5 text-sm hover:bg-gray-50 ${aan ? 'bg-gray-50 font-semibold' : ''} ${focusRing}`}>
                <PersoonFoto naam={p.naam} maat={26} />
                <span className="flex-1 text-left truncate">{p.naam}{p.id === ik && <span className="text-gray-400"> (ik)</span>}</span>
                {aan && <Check className="h-4 w-4" />}
              </button>
            </li>
          )
        })}
        {!lijst.length && <li className="px-2 py-3 text-xs text-gray-500">Niemand gevonden.</li>}
      </ul>
    </div>
  )
}

export function KleurKeuze({ waarde, onKies, leeg = 'Geen' }: { waarde: string | null; onKies: (k: string | null) => void; leeg?: string }) {
  const kleuren = [...PALET, '#0f0f0f', '#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#818cf8', '#e879f9']
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => onKies(null)} className={`h-6 px-2 rounded-full border text-[11px] ${!waarde ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600'} ${focusRing}`}>{leeg}</button>
      {kleuren.map((k) => (
        <button key={k} type="button" onClick={() => onKies(k)} aria-label={`Kleur ${k}`} aria-pressed={waarde === k}
          className={`h-6 w-6 rounded-full border ${waarde === k ? 'ring-2 ring-gray-900 ring-offset-1' : 'border-black/10'} ${focusRing}`} style={{ background: k }} />
      ))}
      <label className="h-6 w-6 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-[10px] text-gray-500 cursor-pointer" title="Eigen kleur">
        <input type="color" className="sr-only" value={waarde ?? '#cccccc'} onChange={(e) => onKies(e.target.value)} />+
      </label>
    </div>
  )
}

export function Schakel({ aan, onWissel, label, disabled }: { aan: boolean; onWissel: () => void; label: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={aan} disabled={disabled} onClick={onWissel} className={`inline-flex items-center gap-2 text-sm disabled:opacity-50 ${focusRing} rounded`}>
      <span className={`relative h-5 w-9 rounded-full transition-colors ${aan ? 'bg-gray-900' : 'bg-gray-300'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${aan ? 'left-[18px]' : 'left-0.5'}`} /></span>
      {label}
    </button>
  )
}

/** Paneel dat rechts inschuift (op de gsm volledig scherm). */
export function Lade({ titel, onSluit, children, breed = false, maat, acties }: { titel: ReactNode; onSluit: () => void; children: ReactNode; breed?: boolean; maat?: 'groot'; acties?: ReactNode }) {
  useEffect(() => {
    const t = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input,textarea,select')) onSluit() }
    document.addEventListener('keydown', t)
    return () => document.removeEventListener('keydown', t)
  }, [onSluit])
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onSluit() }}>
      <div className={`bg-white h-full w-full ${maat === 'groot' ? 'sm:max-w-[min(1080px,92vw)] sm:rounded-l-2xl' : breed ? 'sm:max-w-3xl' : 'sm:max-w-xl'} shadow-2xl flex flex-col overflow-hidden`}>
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <div className="flex-1 min-w-0 text-sm text-gray-500 truncate">{titel}</div>
          {acties}
          <button type="button" onClick={onSluit} className={`h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 ${focusRing}`} aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

/** Eenvoudige markdown (koppen, vet, cursief, lijsten, afvinkvakjes, links) zonder HTML in te voegen. */
export function Markdown({ tekst, onVink }: { tekst: string; onVink?: (regel: number) => void }) {
  const regels = tekst.split('\n')
  const uit: ReactNode[] = []
  const inline = (t: string, k: string): ReactNode[] => {
    const delen: ReactNode[] = []
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g
    let laatste = 0, m: RegExpExecArray | null, i = 0
    while ((m = re.exec(t))) {
      if (m.index > laatste) delen.push(t.slice(laatste, m.index))
      const s = m[0]
      if (s.startsWith('**')) delen.push(<strong key={`${k}-${i++}`}>{s.slice(2, -2)}</strong>)
      else if (s.startsWith('*')) delen.push(<em key={`${k}-${i++}`}>{s.slice(1, -1)}</em>)
      else if (s.startsWith('[')) { const mm = s.match(/^\[([^\]]+)\]\(([^)]+)\)$/); delen.push(<a key={`${k}-${i++}`} href={mm?.[2]} target="_blank" rel="noopener noreferrer" className="underline">{mm?.[1]}</a>) }
      else delen.push(<a key={`${k}-${i++}`} href={s} target="_blank" rel="noopener noreferrer" className="underline break-all">{s}</a>)
      laatste = m.index + s.length
    }
    if (laatste < t.length) delen.push(t.slice(laatste))
    return delen
  }
  regels.forEach((r, n) => {
    const vink = r.match(/^\s*[-*] \[( |x|X)\] (.*)$/)
    if (vink) {
      const aan = vink[1].toLowerCase() === 'x'
      uit.push(
        <div key={n} className="flex items-start gap-2 py-0.5">
          <button type="button" disabled={!onVink} onClick={() => onVink?.(n)} className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center ${aan ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-400 bg-white'} ${focusRing}`} aria-label={aan ? 'Afgevinkt' : 'Afvinken'}>{aan && <Check className="h-3 w-3" />}</button>
          <span className={aan ? 'line-through text-gray-400' : ''}>{inline(vink[2], `v${n}`)}</span>
        </div>,
      )
      return
    }
    const kop = r.match(/^(#{1,3}) (.*)$/)
    if (kop) { uit.push(<div key={n} className={`font-bold mt-3 mb-1 ${kop[1].length === 1 ? 'text-lg' : kop[1].length === 2 ? 'text-base' : 'text-sm'}`}>{inline(kop[2], `k${n}`)}</div>); return }
    const lijst = r.match(/^\s*(?:[-*]|\d+\.) (.*)$/)
    if (lijst) { uit.push(<div key={n} className="flex gap-2 pl-1"><span className="text-gray-400">•</span><span>{inline(lijst[1], `l${n}`)}</span></div>); return }
    if (!r.trim()) { uit.push(<div key={n} className="h-2" />); return }
    uit.push(<p key={n}>{inline(r, `p${n}`)}</p>)
  })
  return <div className="text-sm text-gray-800 leading-relaxed break-words">{uit}</div>
}

/** Een afvinkvakje in een markdown-tekst omzetten. */
export function vinkRegel(tekst: string, regel: number): string {
  const r = tekst.split('\n')
  r[regel] = r[regel].replace(/\[( |x|X)\]/, (_, x: string) => (x.trim() ? '[ ]' : '[x]'))
  return r.join('\n')
}

export type { Persoon, Label, Space, AgMap, Lijst, DocKort, Item }

/** Een donkerdere tint van een kleur (rand of icoon op een lichte achtergrond). */
export function donkerder(hex: string, t = 0.3): string {
  if (!isKleur(hex)) return '#4b4b4b'
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x * (1 - t)))
  return `rgb(${c.join(',')})`
}

/** De kleur waarin een map overal verschijnt (boom, kalender, kiezers). */
export function kleurVanMap(b: BoomData, mapId: string | null): string | null {
  return mapKleur(mapId, { mappen: Object.fromEntries(b.mappen.map((m) => [m.id, m])), klantKleuren: b.klantKleuren })
}

/** Een gekleurd mapje: het hele icoon in de kleur van de map. */
export function MapIcoon({ kleur, maat = 16 }: { kleur: string | null; maat?: number }) {
  return <Folder className="shrink-0" style={{ width: maat, height: maat, fill: kleur ?? '#e5e7eb', color: kleur ? donkerder(kleur, 0.35) : '#9ca3af' }} aria-hidden />
}

/** "Verheyen nv › Contentkalender" met het gekleurde mapje (of enkel de map als de lijst zo heet). */
export function MapLabel({ boom, lijstId, leeg = 'Kies de map' }: { boom: BoomData; lijstId: string | null; leeg?: string }) {
  const l = lijstId ? boom.lijsten.find((x) => x.id === lijstId) : null
  if (!l) return <span className="text-gray-400">{leeg}</span>
  const m = l.map_id ? boom.mappen.find((x) => x.id === l.map_id) : null
  const kleur = l.kleur && isKleur(l.kleur) ? l.kleur : kleurVanMap(boom, l.map_id)
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      {m ? <MapIcoon kleur={kleur} /> : <ListIcon className="h-4 w-4 shrink-0 text-gray-500" />}
      <span className="truncate">{m ? (m.naam === l.naam ? m.naam : <>{m.naam} <span className="text-gray-400">›</span> {l.naam}</>) : l.naam}</span>
    </span>
  )
}

/**
 * Een map (klant) kiezen, gegroepeerd per space. Een map met één lijst kies je
 * in één klik; met meer lijsten klapt ze open en kies je de lijst.
 */
export function MapKiezer({ boom, gekozen, onKies, leeg = null, vol = false }: { boom: BoomData; gekozen: string | null; onKies: (lijstId: string | null) => void; leeg?: string | null; vol?: boolean }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(() => (gekozen ? boom.lijsten.find((l) => l.id === gekozen)?.map_id ?? null : null))
  const z = q.trim().toLowerCase()
  const lijstenVan = (mapId: string) => boom.lijsten.filter((l) => l.map_id === mapId)
  const past = (t: string) => !z || t.toLowerCase().includes(z)
  const diepte = (m: { parent_id: string | null }) => { let d = 0, p = m.parent_id; while (p && d < 5) { d++; p = boom.mappen.find((x) => x.id === p)?.parent_id ?? null } return d }
  // Mappen in boomvolgorde (submappen onder hun map).
  const geordend = (spaceId: string) => {
    const uit: typeof boom.mappen = []
    const voeg = (parent: string | null) => { for (const m of boom.mappen.filter((x) => x.space_id === spaceId && x.parent_id === parent)) { uit.push(m); voeg(m.id) } }
    voeg(null)
    return uit
  }
  return (
    <div className={`w-full ${vol ? '' : 'md:w-[22rem]'} p-2`}>
      <div className="relative mb-1.5"><Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input {...zoekVeld()} autoFocus={vol} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek een klant of map…" className="input-base !py-1.5 !pl-8 text-sm" aria-label="Zoek een map" />
      </div>
      <div className={`${vol ? 'max-h-[16rem]' : 'max-h-[22rem]'} overflow-y-auto`}>
        {leeg && <button type="button" onClick={() => onKies(null)} className="w-full text-left rounded-lg px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-50">{leeg}</button>}
        {boom.spaces.map((s) => {
          const mappen = geordend(s.id).filter((m) => past(`${s.naam} ${m.naam} ${lijstenVan(m.id).map((l) => l.naam).join(' ')}`))
          const los = boom.lijsten.filter((l) => l.space_id === s.id && !l.map_id && past(`${s.naam} ${l.naam}`))
          if (!mappen.length && !los.length) return null
          return (
            <div key={s.id} className="mb-1">
              <div className="label-mono text-[10px] uppercase text-gray-400 px-2 pt-2 pb-1">{s.naam}</div>
              {mappen.map((m) => {
                const ls = lijstenVan(m.id)
                const isOpen = open === m.id || (!!z && ls.length > 1)
                const kleur = kleurVanMap(boom, m.id)
                const bevat = ls.some((l) => l.id === gekozen)
                return (
                  <div key={m.id}>
                    <button type="button" disabled={!ls.length} onClick={() => (ls.length === 1 ? onKies(ls[0].id) : setOpen(isOpen ? null : m.id))}
                      style={{ paddingLeft: 8 + diepte(m) * 14 }}
                      className={`w-full flex items-center gap-2 rounded-lg pr-2 py-1.5 text-sm text-left hover:bg-gray-50 disabled:opacity-40 ${bevat ? 'bg-gray-50 font-semibold' : ''} ${focusRing}`}>
                      <MapIcoon kleur={kleur} />
                      <span className="flex-1 truncate">{m.naam}</span>
                      {ls.length > 1 && <ChevronRight className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                      {ls.length === 1 && gekozen === ls[0].id && <Check className="h-4 w-4" />}
                    </button>
                    {isOpen && ls.length > 1 && ls.map((l) => (
                      <button key={l.id} type="button" onClick={() => onKies(l.id)} style={{ paddingLeft: 30 + diepte(m) * 14 }}
                        className={`w-full flex items-center gap-2 rounded-lg pr-2 py-1.5 text-[13px] text-left hover:bg-gray-50 ${gekozen === l.id ? 'font-semibold' : ''} ${focusRing}`}>
                        <ListIcon className="h-3.5 w-3.5 shrink-0" style={{ color: kleur ? donkerder(kleur, 0.35) : undefined }} />
                        <span className="flex-1 truncate">{l.naam}</span>{gekozen === l.id && <Check className="h-4 w-4" />}
                      </button>
                    ))}
                  </div>
                )
              })}
              {los.map((l) => (
                <button key={l.id} type="button" onClick={() => onKies(l.id)} className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-left hover:bg-gray-50 ${gekozen === l.id ? 'bg-gray-50 font-semibold' : ''} ${focusRing}`}>
                  <ListIcon className="h-4 w-4 shrink-0 text-gray-500" /><span className="flex-1 truncate">{l.naam}</span>{gekozen === l.id && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Wie doet het (meerdere kan): de zaakvoerders en jezelf als knoppen met foto om
 * aan en uit te tikken, anderen als bolletje met een kruisje, en "Iemand anders"
 * om te zoeken.
 */
export function WieKiezer({ boom, gekozen, onWissel, disabled = false }: { boom: BoomData; gekozen: string[]; onWissel: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const sluit = useCallback(() => setOpen(false), [])
  const per = new Map(boom.personen.map((p) => [p.id, p]))
  const snel = [...new Set([boom.ik, ...boom.zaakvoerders])].filter((id) => per.get(id)?.actief)
  const anderen = gekozen.filter((id) => !snel.includes(id))
  const voornaam = (id: string) => (per.get(id)?.naam ?? 'Onbekend').split(' ')[0]
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {snel.map((id) => <PersoonKnop key={id} naam={per.get(id)?.naam ?? '?'} label={id === boom.ik ? `${voornaam(id)} (ik)` : voornaam(id)} rol="checkbox" klein aan={gekozen.includes(id)} disabled={disabled} onClick={() => onWissel(id)} />)}
      </div>
      {anderen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {anderen.map((id) => (
            <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 text-white pl-0.5 pr-1 py-0.5 text-xs">
              <PersoonFoto naam={per.get(id)?.naam ?? '?'} maat={20} />{per.get(id)?.naam ?? 'Onbekend'}
              {!disabled && <button type="button" onClick={() => onWissel(id)} aria-label={`${per.get(id)?.naam ?? 'Persoon'} weghalen`} className={`h-4 w-4 rounded-full hover:bg-white/20 flex items-center justify-center ${focusRing}`}><X className="h-3 w-3" /></button>}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="relative">
          <button type="button" onClick={() => setOpen(!open)} className={`inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 hover:underline ${focusRing}`}><Plus className="h-3.5 w-3.5" />Iemand anders</button>
          <Popover open={open} onSluit={sluit}><PersonenLijst personen={boom.personen} eerst={boom.zaakvoerders} ik={boom.ik} gekozen={gekozen} onWissel={onWissel} /></Popover>
        </div>
      )}
      <p className="text-[11px] text-gray-400">{gekozen.length > 1 ? `${gekozen.length} mensen samen` : 'Tik om aan of uit te zetten, meerdere kan.'}</p>
    </div>
  )
}
