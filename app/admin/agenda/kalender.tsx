'use client'

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Check, Flag, Video, MapPin, Plus, Lock, RotateCcw, Clock } from 'lucide-react'
import {
  plaatsVan, dagenVan, legUit, vandaag, plusDagen, zoneNaarIso, dag, uur, kortDag, enkelDeadline, deadlineLabel,
  type Item, type Weergave, type Persoon,
} from '@/lib/agenda/model'
import { Avatars, focusRing } from './gedeeld'

const PX_MIN = 1 // 60 px per uur
const SNAP = 15
const DAGNAAM = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
const DAGNAAM_LANG = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag']
const weekdag = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7

/** Rustige kleur zoals ClickUp: een licht vlak met links een streep in de volle kleur, altijd donkere tekst. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const mix = (a: [number, number, number], b: [number, number, number], t: number) => `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',')})`
/** Completed: doorzichtig lichtgroen met fijne lichtgrijze streepjes, zodat je in één oogopslag ziet wat al gedaan is. */
export const KLAAR_STIJL: React.CSSProperties = {
  background: 'repeating-linear-gradient(135deg, rgba(134, 214, 160, 0.26) 0px, rgba(134, 214, 160, 0.26) 6px, rgba(150, 156, 152, 0.24) 6px, rgba(150, 156, 152, 0.24) 7.5px)',
  borderLeft: '3px solid #4caf73',
  color: '#2b4a36',
}
const isKlaar = (i: Item) => i.status === 'klaar'
/** Afvinken kan bij taken en bij meetings (ook die uit de Meeting Inplanner). */
const kanAfvinken = (i: Item) => i.bron === 'ag' || i.bron === 'meeting'
const stijlVan = (i: Item, kleur: string) => (isKlaar(i) ? KLAAR_STIJL : vlak(kleur))

export function vlak(kleur: string): React.CSSProperties {
  const c = rgb(/^#[0-9a-f]{6}$/i.test(kleur) ? kleur : '#e5e7eb')
  const licht = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.6
  return {
    background: mix(c, [255, 255, 255], licht ? 0.45 : 0.86),
    borderLeft: `3px solid ${licht ? mix(c, [0, 0, 0], 0.28) : `rgb(${c.join(',')})`}`,
    color: '#1a1a1a',
  }
}

export type Verplaatsing = { start_op: string | null; eind_op: string | null; heel_dag: boolean; deadline_op?: string | null }
export type NieuwMoment = { dag: string; vanMin?: number; totMin?: number; heelDag: boolean }

type Props = {
  weergave: Weergave
  datum: string
  items: Item[]
  kleur: (i: Item) => string
  personen: Map<string, Persoon>
  magAanpassen: boolean
  magToevoegen: boolean
  onOpen: (i: Item) => void
  onKlaar: (i: Item) => void
  onVerplaats: (i: Item, v: Verplaatsing) => void
  onNieuw: (m: NieuwMoment) => void
  onDag: (d: string) => void
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const snap = (min: number) => Math.max(0, Math.min(1440, Math.round(min / SNAP) * SNAP))
const isoOp = (d: string, min: number) => (min >= 1440 ? zoneNaarIso(plusDagen(d, 1), '00:00') : zoneNaarIso(d, hhmm(min)))
const verschuifDagen = (iso: string | null, n: number) => (iso ? zoneNaarIso(plusDagen(dag(iso), n), uur(iso)) : null)
const dagenTussen = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
const sleepbaar = (i: Item, mag: boolean) => mag && i.bron === 'ag'
/** Een taak met enkel een deadline naar een andere dag: de deadline schuift mee, het uur blijft. */
const deadlineVerschoven = (i: Item, n: number): Verplaatsing => ({ start_op: null, eind_op: verschuifDagen(i.eind_op, n), deadline_op: verschuifDagen(i.deadline_op, n), heel_dag: false })

/**
 * De deadline als duidelijk label: zwart met een klokje, rood als ze voorbij is.
 * `lang` = "Deadline 17:00"; anders kort ("17:00", of "vr 17:00" op een andere dag).
 */
export function DeadlineLabel({ i, opDag, lang = false, klein = false }: { i: Pick<Item, 'deadline_op' | 'status'>; opDag?: string; lang?: boolean; klein?: boolean }) {
  if (!i.deadline_op) return null
  const l = deadlineLabel(i.deadline_op, opDag)
  const kort = l.tekst.replace(/^Deadline /, '')
  const laat = l.teLaat && i.status !== 'klaar'
  return (
    <span title={`${l.tekst}${laat ? ' (voorbij)' : ''}`}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded font-semibold tabular-nums leading-none whitespace-nowrap ${klein ? 'h-[19px] px-1.5 text-[11.5px]' : 'h-[22px] px-2 text-[12.5px]'} ${i.status === 'klaar' ? 'bg-black/10 text-current' : laat ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`}>
      <Clock className={klein ? 'h-3 w-3' : 'h-3.5 w-3.5'} />{lang ? l.tekst : kort}
    </span>
  )
}

export function Kalender(p: Props) {
  if (p.weergave === 'maand') return <Maand {...p} />
  return <Rooster {...p} />
}

// ── Een item als blokje ─────────────────────────────────────────────────────

function Vinkje({ i, onKlaar, klein }: { i: Item; onKlaar: (i: Item) => void; klein?: boolean }) {
  if (!kanAfvinken(i)) return null
  const aan = i.status === 'klaar'
  return (
    <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onKlaar(i) }} aria-label={aan ? 'Terug open zetten' : 'Afvinken'}
      className={`shrink-0 ${klein ? 'h-3.5 w-3.5' : 'h-4 w-4'} rounded-full border flex items-center justify-center ${aan ? 'bg-[#3f9a64] border-[#3f9a64] text-white' : 'border-current bg-white/60'} ${focusRing}`}>
      {aan && <Check className="h-2.5 w-2.5" />}
    </button>
  )
}

/** Bij hoveren: snel completen (of terug open zetten). */
function SnelKlaar({ i, onKlaar, tekst, onder = false }: { i: Item; onKlaar: (i: Item) => void; tekst: boolean; onder?: boolean }) {
  if (!kanAfvinken(i)) return null
  const klaar = i.status === 'klaar'
  return (
    <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onKlaar(i) }}
      title={klaar ? 'Terug open zetten' : 'Complete'} aria-label={klaar ? 'Terug open zetten' : 'Complete'}
      className={`absolute ${onder ? 'bottom-1' : 'top-1/2 -translate-y-1/2'} right-1 z-[3] hidden group-hover:inline-flex focus:inline-flex items-center gap-1 h-[22px] px-2 rounded-md text-[12px] font-semibold shadow-sm ${klaar ? 'bg-white text-gray-900 border border-gray-200' : 'bg-[#2f7a4b] text-white'} ${focusRing}`}>
      {klaar ? <RotateCcw className="h-3 w-3" /> : <Check className="h-3 w-3" />}{tekst && (klaar ? 'Heropen' : 'Complete')}
    </button>
  )
}

function Chip({ i, kleur, onOpen, onKlaar, personen, tijd, sleep, opDag, lang, magKlaar }: { i: Item; kleur: string; onOpen: (i: Item) => void; onKlaar: (i: Item) => void; personen: Map<string, Persoon>; tijd?: string | null; sleep: boolean; opDag?: string; lang?: boolean; magKlaar: boolean }) {
  const klaar = isKlaar(i)
  const dl = enkelDeadline(i)
  return (
    <div draggable={sleep} onDragStart={(e) => { e.dataTransfer.setData('text/agenda-item', i.id); e.dataTransfer.effectAllowed = 'move' }}
      onClick={() => onOpen(i)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(i) }}
      className={`group relative flex items-center gap-1.5 rounded-lg pl-2 pr-1 h-[30px] text-[13px] font-medium leading-none cursor-pointer select-none shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:brightness-[0.97] ${focusRing}`}
      style={stijlVan(i, kleur)} title={i.titel}>
      <Vinkje i={i} onKlaar={onKlaar} klein />
      {i.urgent && !klaar && <Flag className="h-3.5 w-3.5 shrink-0 text-red-600 fill-red-600" />}
      {(i.meet_url || i.bron === 'meeting') && <Video className="h-3.5 w-3.5 shrink-0 opacity-70" />}
      {dl ? <DeadlineLabel i={i} opDag={opDag ?? dag(i.deadline_op!)} lang={lang} klein /> : tijd && <span className="shrink-0 tabular-nums opacity-75">{tijd}</span>}
      <span className={`truncate flex-1 ${klaar ? 'line-through decoration-1 opacity-80' : ''}`}>{i.titel}</span>
      {!dl && i.deadline_op && <DeadlineLabel i={i} opDag={opDag} klein />}
      {i.prive && <Lock className="h-2.5 w-2.5 shrink-0 opacity-60" />}
      {/* Bij een deadline in de week gaat de plaats naar de titel; wie het doet staat in de taak. */}
      {!(dl && !lang) && <span className="hidden sm:inline-flex group-hover:invisible"><Avatars ids={i.toegewezen} personen={personen} max={2} maat={20} /></span>}
      {magKlaar && <SnelKlaar i={i} onKlaar={onKlaar} tekst={false} />}
    </div>
  )
}

// ── Dag en week ─────────────────────────────────────────────────────────────

type Sleep =
  | { soort: 'nieuw'; dag: string; van: number; tot: number; x: number; y: number }
  | { soort: 'verplaats'; item: Item; dagIndex: number; van: number; duur: number; grijpMin: number; x: number; y: number; bewogen: boolean }
  | { soort: 'rek'; item: Item; dag: string; van: number; tot: number; y: number; bewogen: boolean }

function Rooster({ weergave, datum, items, kleur, personen, magAanpassen, magToevoegen, onOpen, onKlaar, onVerplaats, onNieuw, onDag }: Props) {
  const dagen = useMemo(() => dagenVan(weergave, datum), [weergave, datum])
  const kolommenRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sleep, setSleep] = useState<Sleep | null>(null)
  const [nu, setNu] = useState(() => Date.now())
  const [alleDag, setAlleDag] = useState(false)
  useEffect(() => { const t = setInterval(() => setNu(Date.now()), 60_000); return () => clearInterval(t) }, [])

  // Items per dag: rooster (met uur) en de rij "hele dag" (zonder uur of over meerdere dagen).
  const { rooster, balken, banen } = useMemo(() => {
    const rooster = new Map<string, { item: Item; vanMin: number; totMin: number }[]>()
    const bal: { item: Item; van: number; tot: number }[] = []
    const eerste = dagen[0], laatste = dagen[dagen.length - 1]
    for (const i of items) {
      const p = plaatsVan(i)
      if (!p) continue
      if (p.soort === 'rooster') {
        if (p.dag < eerste || p.dag > laatste) continue
        rooster.set(p.dag, [...(rooster.get(p.dag) ?? []), { item: i, vanMin: p.vanMin, totMin: p.totMin }])
      } else {
        if (p.tot < eerste || p.van > laatste) continue
        bal.push({ item: i, van: Math.max(0, dagenTussen(eerste, p.van)), tot: Math.min(dagen.length - 1, dagenTussen(eerste, p.tot)) })
      }
    }
    // Balken in banen leggen (langste eerst), zoals een maandkalender.
    bal.sort((a, b) => a.van - b.van || (b.tot - b.van) - (a.tot - a.van) || Number(a.item.status === 'klaar') - Number(b.item.status === 'klaar') || a.item.titel.localeCompare(b.item.titel))
    const banenEind: number[] = []
    const balken = bal.map((b) => {
      let baan = banenEind.findIndex((e) => e < b.van)
      if (baan < 0) { baan = banenEind.length; banenEind.push(b.tot) } else banenEind[baan] = b.tot
      return { ...b, baan }
    })
    return { rooster, balken, banen: banenEind.length }
  }, [items, dagen])

  // Bij een andere week of dag: naar 07:30, of vroeger als er dan al iets staat.
  const gescrold = useRef<string | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    const sleutel = `${weergave}:${dagen[0]}`
    if (!el || gescrold.current === sleutel) return
    let vroegst = 450
    for (const [, l] of rooster) for (const b of l) vroegst = Math.min(vroegst, b.vanMin)
    el.scrollTop = Math.max(0, (vroegst - 20) * PX_MIN)
    if (items.length) gescrold.current = sleutel
  }, [weergave, dagen, rooster, items.length])

  const MAX_BANEN = weergave === 'dag' ? 6 : 3
  const toonBanen = alleDag ? banen : Math.min(banen, MAX_BANEN)
  const verborgenPerDag = useMemo(() => {
    const m = new Map<number, number>()
    if (alleDag) return m
    for (const b of balken) if (b.baan >= MAX_BANEN) for (let d = b.van; d <= b.tot; d++) m.set(d, (m.get(d) ?? 0) + 1)
    return m
  }, [balken, alleDag, MAX_BANEN])

  // Pointer → dag en minuut in het rooster.
  const positie = (x: number, y: number): { dagIndex: number; min: number } | null => {
    const el = kolommenRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const breedte = r.width / dagen.length
    const dagIndex = Math.max(0, Math.min(dagen.length - 1, Math.floor((x - r.left) / breedte)))
    return { dagIndex, min: (y - r.top) / PX_MIN }
  }

  const startNieuw = (e: RPointerEvent, d: string) => {
    if (!magToevoegen || e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-blok]')) return
    const pos = positie(e.clientX, e.clientY)
    if (!pos) return
    const van = Math.min(1440 - SNAP, Math.floor(pos.min / SNAP) * SNAP)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setSleep({ soort: 'nieuw', dag: d, van, tot: van + SNAP, x: e.clientX, y: e.clientY })
  }
  const startVerplaats = (e: RPointerEvent, item: Item, dagIndex: number, van: number, tot: number) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const pos = positie(e.clientX, e.clientY)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setSleep({ soort: 'verplaats', item, dagIndex, van, duur: tot - van, grijpMin: pos ? pos.min - van : 0, x: e.clientX, y: e.clientY, bewogen: false })
  }
  const startRek = (e: RPointerEvent, item: Item, d: string, van: number, tot: number) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setSleep({ soort: 'rek', item, dag: d, van, tot, y: e.clientY, bewogen: false })
  }
  const beweeg = (e: RPointerEvent) => {
    if (!sleep) return
    const pos = positie(e.clientX, e.clientY)
    if (!pos) return
    if (sleep.soort === 'nieuw') setSleep({ ...sleep, tot: Math.max(sleep.van + SNAP, Math.min(1440, Math.ceil(pos.min / SNAP) * SNAP)) })
    if (sleep.soort === 'verplaats') {
      const ver = Math.abs(e.clientX - sleep.x) + Math.abs(e.clientY - sleep.y) > 4
      if (!ver && !sleep.bewogen) return
      const van = Math.max(0, Math.min(1440 - sleep.duur, snap(pos.min - sleep.grijpMin)))
      setSleep({ ...sleep, dagIndex: pos.dagIndex, van, bewogen: true })
    }
    if (sleep.soort === 'rek') {
      if (Math.abs(e.clientY - sleep.y) < 3 && !sleep.bewogen) return
      setSleep({ ...sleep, tot: Math.max(sleep.van + SNAP, Math.min(1440, snap(pos.min))), bewogen: true })
    }
  }
  const los = () => {
    const s = sleep
    setSleep(null)
    if (!s) return
    if (s.soort === 'nieuw') {
      const klik = s.tot - s.van <= SNAP
      onNieuw({ dag: s.dag, vanMin: s.van, totMin: klik ? Math.min(1440, s.van + 60) : s.tot, heelDag: false })
    }
    if (s.soort === 'verplaats') {
      if (!s.bewogen) { onOpen(s.item); return }
      const d = dagen[s.dagIndex]
      onVerplaats(s.item, { start_op: isoOp(d, s.van), eind_op: isoOp(d, s.van + s.duur), heel_dag: false })
    }
    if (s.soort === 'rek' && s.bewogen) onVerplaats(s.item, { start_op: s.item.start_op ?? isoOp(s.dag, s.van), eind_op: isoOp(s.dag, s.tot), heel_dag: false })
  }

  // Een blokje uit de rij "hele dag" naar het rooster of naar een andere dag slepen.
  const dropOpRooster = (e: React.DragEvent, d: string) => {
    const id = e.dataTransfer.getData('text/agenda-item')
    const item = items.find((x) => x.id === id)
    if (!item) return
    e.preventDefault()
    const pos = positie(e.clientX, e.clientY)
    const van = pos ? Math.min(1440 - 60, snap(pos.min)) : 540
    onVerplaats(item, { start_op: isoOp(d, van), eind_op: isoOp(d, van + 60), heel_dag: false })
  }
  const dropOpDag = (e: React.DragEvent, d: string) => {
    const id = e.dataTransfer.getData('text/agenda-item')
    const item = items.find((x) => x.id === id)
    if (!item) return
    e.preventDefault()
    const p = plaatsVan(item)
    const van = p ? (p.soort === 'dag' ? p.van : p.dag) : d
    const n = dagenTussen(van, d)
    if (enkelDeadline(item)) { if (n) onVerplaats(item, deadlineVerschoven(item, n)); return }
    if (!n && item.heel_dag) return
    if (item.heel_dag) onVerplaats(item, { start_op: verschuifDagen(item.start_op, n), eind_op: verschuifDagen(item.eind_op, n), heel_dag: true })
    else onVerplaats(item, { start_op: item.start_op ? zoneNaarIso(d, '04:00') : null, eind_op: zoneNaarIso(d, '04:00'), heel_dag: true })
  }

  const vandaagD = vandaag()
  const nuMin = (() => { const t = new Date(nu); return dag(t.toISOString()) === vandaagD ? Number(uur(t.toISOString()).slice(0, 2)) * 60 + Number(uur(t.toISOString()).slice(3)) : -1 })()
  const cols = `60px repeat(${dagen.length}, minmax(0, 1fr))`

  return (
    <div className="card-base !p-0 overflow-hidden h-full">
     {/* Op een smal scherm schuift de week opzij; elke dag blijft leesbaar breed. */}
     <div className="h-full overflow-x-auto overscroll-x-contain">
      <div className={`h-full flex flex-col min-h-0 ${weergave === 'week' ? 'min-w-[956px] md:min-w-0' : ''}`}>
      {/* Kop met de dagen */}
      <div className="grid border-b border-gray-200 bg-white" style={{ gridTemplateColumns: cols }}>
        <div />
        {dagen.map((d) => {
          const wd = weekdag(d)
          return (
            <button key={d} type="button" onClick={() => onDag(d)} className={`py-2.5 px-2 border-l border-gray-100 hover:bg-gray-50 flex items-center gap-2 ${weergave === 'dag' ? 'justify-start pl-4' : 'justify-center'} ${focusRing}`}>
              <span className={`h-8 min-w-8 px-1 rounded-full flex items-center justify-center text-[15px] font-bold ${d === vandaagD ? 'bg-gray-900 text-white' : 'text-gray-900'}`}>{Number(d.slice(8))}</span>
              <span className="text-left leading-tight">
                <span className={`block text-[13px] font-semibold ${d === vandaagD ? 'text-gray-900' : 'text-gray-700'}`}><span className="hidden lg:inline">{DAGNAAM_LANG[wd]}</span><span className="lg:hidden capitalize">{DAGNAAM[wd]}</span></span>
                {weergave === 'dag' && <span className="block text-[11px] text-gray-500">{new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>}
              </span>
            </button>
          )
        })}
      </div>

      {/* Hele dag: taken zonder uur en wat over meerdere dagen loopt */}
      {(balken.length > 0 || magToevoegen) && (
        <div className="grid border-b border-gray-200 bg-gray-50/60" style={{ gridTemplateColumns: cols }}>
          <div className="label-mono text-[9px] text-gray-400 uppercase px-2 pt-2.5 leading-tight">Hele<br />dag</div>
          <div className="relative" style={{ gridColumn: `2 / span ${dagen.length}` }}>
           <div className={alleDag ? 'max-h-[38vh] overflow-y-auto' : ''}>
            <div className="relative">
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${dagen.length}, minmax(0, 1fr))` }}>
              {dagen.map((d, n) => (
                <div key={d} className="border-l border-gray-100 group relative" onDragOver={(e) => { if (magAanpassen) e.preventDefault() }} onDrop={(e) => dropOpDag(e, d)}
                  onDoubleClick={() => magToevoegen && onNieuw({ dag: d, heelDag: true })}>
                  {magToevoegen && <button type="button" onClick={() => onNieuw({ dag: d, heelDag: true })} aria-label={`Taak op ${kortDag(d)}`} className={`absolute right-1 bottom-1 h-5 w-5 rounded-md bg-white border border-gray-200 text-gray-500 opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center z-10 ${focusRing}`}><Plus className="h-3 w-3" /></button>}
                  {verborgenPerDag.get(n) ? <button type="button" onClick={() => setAlleDag(true)} className="absolute left-1.5 bottom-1 text-[12px] font-semibold text-gray-700 hover:underline z-10">+{verborgenPerDag.get(n)} meer</button> : null}
                </div>
              ))}
            </div>
            <div className="relative grid gap-y-1 py-2 px-1 pointer-events-none" style={{ gridTemplateColumns: `repeat(${dagen.length}, minmax(0, 1fr))`, gridAutoRows: '30px', minHeight: magToevoegen ? 44 : undefined, paddingBottom: verborgenPerDag.size ? 24 : undefined }}>
              {balken.filter((b) => b.baan < toonBanen).map((b) => (
                <div key={`${b.item.bron}-${b.item.id}`} className="pointer-events-auto px-1 min-w-0" style={{ gridColumn: `${b.van + 1} / ${b.tot + 2}`, gridRow: b.baan + 1 }}>
                  <Chip i={b.item} kleur={kleur(b.item)} onOpen={onOpen} onKlaar={onKlaar} personen={personen} sleep={sleepbaar(b.item, magAanpassen)} magKlaar={magAanpassen} opDag={dagen[b.van]} lang={weergave === 'dag'} />
                </div>
              ))}
            </div>
            </div>
           </div>
            {alleDag && banen > MAX_BANEN && <button type="button" onClick={() => setAlleDag(false)} className="absolute right-3 -bottom-0.5 translate-y-full z-10 rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:border-gray-400 shadow-sm">Minder tonen</button>}
          </div>
        </div>
      )}

      {/* Uurrooster */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 relative">
        <div className="grid relative" style={{ gridTemplateColumns: cols, height: 1440 * PX_MIN }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => h > 0 && <div key={h} className="absolute right-2 -translate-y-1/2 text-[12px] tabular-nums text-gray-500" style={{ top: h * 60 * PX_MIN }}>{String(h).padStart(2, '0')}:00</div>)}
          </div>
          <div ref={kolommenRef} className="relative grid" style={{ gridColumn: `2 / span ${dagen.length}`, gridTemplateColumns: `repeat(${dagen.length}, minmax(0, 1fr))` }}
            onPointerMove={beweeg} onPointerUp={los} onPointerCancel={() => setSleep(null)}>
            {/* lijnen */}
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: h * 60 * PX_MIN }} />)}
              {Array.from({ length: 24 }, (_, h) => <div key={`h${h}`} className="absolute left-0 right-0 border-t border-dashed border-gray-50" style={{ top: (h * 60 + 30) * PX_MIN }} />)}
            </div>
            {dagen.map((d, n) => {
              const blokken = legUit(rooster.get(d) ?? [])
              return (
                <div key={d} className={`relative border-l border-gray-100 ${d === vandaagD ? 'bg-gray-50/50' : ''} ${magToevoegen ? 'cursor-crosshair' : ''}`}
                  onPointerDown={(e) => startNieuw(e, d)} onDragOver={(e) => { if (magAanpassen) e.preventDefault() }} onDrop={(e) => dropOpRooster(e, d)}>
                  {blokken.map((b) => {
                    const i = b.item
                    const bezig = sleep && sleep.soort !== 'nieuw' && sleep.item.id === i.id && sleep.bewogen
                    const kl = kleur(i)
                    const hoogte = Math.max(22, (b.totMin - b.vanMin) * PX_MIN - 2)
                    const sl = sleepbaar(i, magAanpassen)
                    const klaar = isKlaar(i)
                    return (
                      <div key={`${i.bron}-${i.id}`} data-blok role="button" tabIndex={0}
                        onPointerDown={(e) => (sl ? startVerplaats(e, i, n, b.vanMin, b.totMin) : undefined)}
                        onClick={() => { if (!sl) onOpen(i) }} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(i) }}
                        className={`group absolute rounded-lg pl-2 pr-1.5 py-1 overflow-hidden text-[13.5px] leading-snug shadow-[0_1px_3px_rgba(0,0,0,0.08)] cursor-pointer select-none hover:brightness-[0.97] hover:z-[2] ${bezig ? 'opacity-30' : ''} ${focusRing}`}
                        style={{ ...stijlVan(i, kl), top: b.vanMin * PX_MIN + 1, height: hoogte, left: `calc(${(b.kolom / b.kolommen) * 100}% + 3px)`, width: `calc(${100 / b.kolommen}% - 6px)`, touchAction: sl ? 'none' : undefined }}
                        title={`${hhmm(b.vanMin)}–${hhmm(b.totMin)} ${i.titel}`}>
                        <div className="flex items-start gap-1">
                          <span className="mt-px"><Vinkje i={i} onKlaar={onKlaar} klein /></span>
                          {i.urgent && !klaar && <Flag className="h-3.5 w-3.5 mt-px shrink-0 text-red-600 fill-red-600" />}
                          <span className={`font-semibold ${klaar ? 'line-through decoration-1 opacity-80' : ''} ${hoogte < 34 ? 'truncate' : hoogte < 70 ? 'line-clamp-2' : 'line-clamp-3'}`}>{i.titel}</span>
                          {i.deadline_op && hoogte < 50 && <span className="ml-auto"><DeadlineLabel i={i} opDag={d} klein /></span>}
                        </div>
                        {i.deadline_op && hoogte >= 50 && <div className="mt-0.5 overflow-hidden"><DeadlineLabel i={i} opDag={d} lang={weergave === 'dag'} klein /></div>}
                        {hoogte >= 34 && (
                          <div className={`flex items-center gap-1 mt-0.5 tabular-nums text-[12px] ${klaar ? 'text-[#2b4a36]/80' : 'text-gray-600'}`}>
                            {(i.meet_url || i.bron === 'meeting') && <Video className="h-3 w-3 shrink-0" />}
                            {i.locatie && !i.meet_url && <MapPin className="h-3 w-3 shrink-0" />}
                            <span className="truncate">{hhmm(b.vanMin)}–{hhmm(b.totMin)}</span>
                            <span className="flex-1" />
                            {hoogte >= 50 && <span className={sl ? 'group-hover:invisible' : ''}><Avatars ids={i.toegewezen} personen={personen} max={3} maat={20} /></span>}
                          </div>
                        )}
                        {sl && <div onPointerDown={(e) => startRek(e, i, d, b.vanMin, b.totMin)} className="absolute left-0 right-0 bottom-0 h-1.5 cursor-ns-resize" aria-hidden />}
                        {/* Onderaan rechts (waar de foto's staan), zodat de titel leesbaar en klikbaar blijft. */}
                        {magAanpassen && <SnelKlaar i={i} onKlaar={onKlaar} onder={hoogte >= 34} tekst={b.kolommen === 1 && hoogte >= 34} />}
                      </div>
                    )
                  })}
                  {/* Wat je nu sleept */}
                  {sleep?.soort === 'nieuw' && sleep.dag === d && (
                    <div className="absolute left-0.5 right-0.5 rounded-md bg-gray-900/80 text-white text-[11px] px-1.5 py-1 pointer-events-none z-20" style={{ top: sleep.van * PX_MIN, height: Math.max(12, (sleep.tot - sleep.van) * PX_MIN) }}>{hhmm(sleep.van)}–{hhmm(sleep.tot)}</div>
                  )}
                  {sleep?.soort === 'verplaats' && sleep.bewogen && sleep.dagIndex === n && (
                    <div className="absolute left-0.5 right-0.5 rounded-md border-2 border-gray-900 bg-white/80 text-[11px] px-1.5 py-1 pointer-events-none z-20 font-semibold" style={{ top: sleep.van * PX_MIN, height: Math.max(18, sleep.duur * PX_MIN) }}>{hhmm(sleep.van)}–{hhmm(sleep.van + sleep.duur)} {sleep.item.titel}</div>
                  )}
                  {sleep?.soort === 'rek' && sleep.bewogen && sleep.dag === d && (
                    <div className="absolute left-0.5 right-0.5 rounded-md border-2 border-gray-900 bg-white/60 text-[11px] px-1.5 py-1 pointer-events-none z-20" style={{ top: sleep.van * PX_MIN, height: (sleep.tot - sleep.van) * PX_MIN }}>tot {hhmm(sleep.tot)}</div>
                  )}
                  {d === vandaagD && nuMin >= 0 && (
                    <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nuMin * PX_MIN }}>
                      <div className="h-px bg-red-500" /><div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      </div>
     </div>
    </div>
  )
}

// ── Maand ───────────────────────────────────────────────────────────────────

function Maand({ datum, items, kleur, personen, magAanpassen, magToevoegen, onOpen, onKlaar, onVerplaats, onNieuw, onDag }: Props) {
  const dagen = useMemo(() => dagenVan('maand', datum), [datum])
  const maand = datum.slice(0, 7)
  const perDag = useMemo(() => {
    const m = new Map<string, Item[]>()
    const eerste = dagen[0], laatste = dagen[dagen.length - 1]
    for (const i of items) {
      const p = plaatsVan(i)
      if (!p) continue
      const van = p.soort === 'rooster' ? p.dag : p.van, tot = p.soort === 'rooster' ? p.dag : p.tot
      if (tot < eerste || van > laatste) continue
      for (let d = van < eerste ? eerste : van, n = 0; d <= tot && d <= laatste && n < 45; d = plusDagen(d, 1), n++) m.set(d, [...(m.get(d) ?? []), i])
    }
    // Hele dag eerst, dan op uur, afgevinkt onderaan.
    for (const [, l] of m) l.sort((a, b) => Number(isKlaar(a)) - Number(isKlaar(b)) || Number(!a.heel_dag) - Number(!b.heel_dag) || (a.start_op ?? a.eind_op ?? '').localeCompare(b.start_op ?? b.eind_op ?? ''))
    return m
  }, [items, dagen])
  const vandaagD = vandaag()
  const drop = (e: React.DragEvent, d: string) => {
    const item = items.find((x) => x.id === e.dataTransfer.getData('text/agenda-item'))
    if (!item) return
    e.preventDefault()
    const p = plaatsVan(item)
    const van = p ? (p.soort === 'dag' ? p.van : p.dag) : d
    const n = dagenTussen(van, d)
    if (!n) return
    if (enkelDeadline(item)) { onVerplaats(item, deadlineVerschoven(item, n)); return }
    onVerplaats(item, { start_op: verschuifDagen(item.start_op, n), eind_op: verschuifDagen(item.eind_op, n), heel_dag: item.heel_dag })
  }
  return (
    <div className="card-base !p-0 overflow-hidden flex flex-col h-full min-h-0">
      <div className="grid grid-cols-7 border-b border-gray-200">
        {DAGNAAM.map((d, n) => <div key={d} className="text-[12px] font-semibold text-gray-600 text-center py-2.5 border-l first:border-l-0 border-gray-100"><span className="hidden lg:inline">{DAGNAAM_LANG[n]}</span><span className="lg:hidden capitalize">{d}</span></div>)}
      </div>
      <div className="grid grid-cols-7 flex-1 min-h-0 overflow-y-auto auto-rows-[minmax(76px,auto)] sm:auto-rows-[minmax(132px,auto)]">
        {dagen.map((d) => {
          const l = perDag.get(d) ?? []
          const toon = l.slice(0, 4)
          return (
            <div key={d} className={`group relative border-l border-t border-gray-100 p-1 sm:p-1.5 min-w-0 ${d.slice(0, 7) !== maand ? 'bg-gray-50/70' : ''}`}
              onDragOver={(e) => { if (magAanpassen) e.preventDefault() }} onDrop={(e) => drop(e, d)}>
              <div className="flex items-center justify-between mb-0.5">
                <button type="button" onClick={() => onDag(d)} className={`h-7 min-w-7 px-1 rounded-full text-[13px] font-bold ${d === vandaagD ? 'bg-gray-900 text-white' : d.slice(0, 7) !== maand ? 'text-gray-400' : 'text-gray-800'} hover:ring-1 hover:ring-gray-300 ${focusRing}`}>{Number(d.slice(8))}</button>
                {magToevoegen && <button type="button" onClick={() => onNieuw({ dag: d, heelDag: true })} aria-label={`Nieuw op ${kortDag(d)}`} className={`h-5 w-5 rounded-md text-gray-500 hover:bg-gray-100 opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center ${focusRing}`}><Plus className="h-3 w-3" /></button>}
              </div>
              {/* Gsm: bolletjes per item, tikken = die dag openen. */}
              {l.length > 0 && (
                <button type="button" onClick={() => onDag(d)} className="sm:hidden w-full flex flex-wrap gap-1 px-1 pt-0.5" aria-label={`${l.length} items op ${kortDag(d)}`}>
                  {l.slice(0, 6).map((i) => <span key={`${i.bron}-${i.id}`} className="h-2 w-2 rounded-full" style={{ background: (stijlVan(i, kleur(i)).borderLeft as string).replace('3px solid ', '') }} />)}
                  {l.length > 6 && <span className="text-[10px] leading-none font-semibold text-gray-600">+{l.length - 6}</span>}
                </button>
              )}
              <div className="hidden sm:block space-y-1">
                {toon.map((i) => {
                  const p = plaatsVan(i)
                  return <Chip key={`${i.bron}-${i.id}`} i={i} kleur={kleur(i)} onOpen={onOpen} onKlaar={onKlaar} personen={personen} sleep={sleepbaar(i, magAanpassen)} tijd={p?.soort === 'rooster' ? hhmm(p.vanMin) : null} opDag={d} magKlaar={magAanpassen} />
                })}
                {l.length > toon.length && <button type="button" onClick={() => onDag(d)} className="text-[12px] font-semibold text-gray-700 hover:underline px-1">+{l.length - toon.length} meer</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
