'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Lock, Repeat } from 'lucide-react'
import { PersoonFoto } from '@/components/admin/persoon-foto'
import { plaatsVan, TZ, kortDag, type Item, type Persoon } from '@/lib/agenda/model'
import { beschikbaarMinuten, geplandMinuten, capaciteit, urenTekst, type Beschikbaarheid, type Bezet } from '@/lib/agenda/team'
import { weekdagVan } from '@/lib/agenda/reeksen'
import { vlak } from './kalender'
import { focusRing } from './gedeeld'

/**
 * Teamagenda (verbeterplan fase 3): op de dag een kolom per persoon, in de week een rij per
 * persoon met wat er gepland staat tegenover wat beschikbaar is. Wat je niet mag zien staat er
 * als "Bezet" (zonder titel). Beschikbaarheid is een lichte achtergrond.
 */

export type TeamData = { bezet: Bezet[]; beschikbaarheid: Beschikbaarheid[] }
type Props = {
  dagen: string[]; items: Item[]; team: TeamData; mensen: Persoon[]
  kleur: (i: Item) => string; onOpen: (i: Item) => void; onDag: (d: string) => void
}

/** Op wie staat het: de toegewezenen, anders de maker. */
const wieVan = (i: Item) => (i.toegewezen.length ? i.toegewezen : i.eigenaar_id ? [i.eigenaar_id] : [])
const minVan = (u: string) => { const [h, m] = u.split(':').map(Number); return h * 60 + m }
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const PX = 0.8 // 48 px per uur

function Cap({ gepland, beschikbaar, klein = false }: { gepland: number; beschikbaar: number; klein?: boolean }) {
  const c = capaciteit(gepland, beschikbaar)
  if (c.vol === null) return <span className="text-[11px] text-gray-500 tabular-nums">{urenTekst(gepland)} gepland</span>
  return (
    <span className={`flex items-center gap-1.5 ${klein ? '' : 'w-full'}`} title={c.over ? 'Meer gepland dan beschikbaar' : undefined}>
      <span className={`h-1.5 rounded-full bg-gray-100 overflow-hidden ${klein ? 'w-10' : 'flex-1'}`}><span className={`block h-full ${c.over ? 'bg-red-500' : 'bg-gray-800'}`} style={{ width: `${Math.min(100, c.vol)}%` }} /></span>
      <span className={`text-[11px] tabular-nums ${c.over ? 'text-red-700 font-semibold' : 'text-gray-600'}`}>{urenTekst(gepland)} / {urenTekst(beschikbaar)}</span>
    </span>
  )
}

function Blokje({ i, kleur, onOpen, compact = false }: { i: Item; kleur: string; onOpen: (i: Item) => void; compact?: boolean }) {
  const p = plaatsVan(i)
  const tijd = p?.soort === 'rooster' ? hhmm(p.vanMin) : null
  const vast = i.reeks?.soort === 'blok'
  return (
    <button type="button" data-item={i.bron === 'ag' ? i.id : undefined} onClick={() => onOpen(i)} title={`${tijd ? `${tijd} ` : ''}${i.titel}`}
      className={`w-full text-left rounded-md pl-1.5 pr-1 ${compact ? 'py-0.5 text-[11px]' : 'py-1 text-[12px]'} leading-tight flex items-center gap-1 min-w-0 hover:brightness-[0.97] ${i.status === 'klaar' ? 'opacity-60 line-through' : ''} ${focusRing}`}
      style={vlak(kleur)}>
      {vast ? <Lock className="h-3 w-3 shrink-0" /> : i.reeks ? <Repeat className="h-3 w-3 shrink-0" /> : null}
      {tijd && <span className="tabular-nums shrink-0 opacity-80">{tijd}</span>}
      <span className="truncate font-medium">{i.titel}</span>
    </button>
  )
}

/** Week (of werkweek): een rij per persoon, een kolom per dag, met de capaciteit van de week. */
export function TeamWeek({ dagen, items, team, mensen, kleur, onOpen, onDag }: Props) {
  const vandaagD = new Date().toLocaleDateString('sv-SE', { timeZone: TZ })
  const perPersoonDag = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const i of items) {
      const p = plaatsVan(i)
      if (!p) continue
      for (const d of dagen) {
        const raakt = p.soort === 'rooster' ? p.dag === d : p.van <= d && d <= p.tot
        if (!raakt) continue
        for (const w of wieVan(i)) m.set(`${w}:${d}`, [...(m.get(`${w}:${d}`) ?? []), i])
      }
    }
    for (const [k, l] of m) m.set(k, l.sort((a, b) => {
      const pa = plaatsVan(a), pb = plaatsVan(b)
      return (pa?.soort === 'rooster' ? pa.vanMin : -1) - (pb?.soort === 'rooster' ? pb.vanMin : -1) || a.titel.localeCompare(b.titel)
    }))
    return m
  }, [items, dagen])
  const bezetPer = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of team.bezet) {
      const p = plaatsVan({ start_op: b.start_op, eind_op: b.eind_op, heel_dag: false })
      if (p?.soort !== 'rooster') continue
      for (const w of b.personen) m.set(`${w}:${p.dag}`, (m.get(`${w}:${p.dag}`) ?? 0) + (p.totMin - p.vanMin))
    }
    return m
  }, [team.bezet])
  const heeftBeschikbaarheid = (p: string) => team.beschikbaarheid.some((b) => b.persoon_id === p)
  const werktOp = (p: string, d: string) => team.beschikbaarheid.some((b) => b.persoon_id === p && b.weekdag === weekdagVan(d))
  const cols = `minmax(150px, 190px) repeat(${dagen.length}, minmax(120px, 1fr))`

  return (
    <div className="card-base !p-0 overflow-auto h-full">
      <div className="grid min-w-max" style={{ gridTemplateColumns: cols }}>
        <div className="sticky left-0 top-0 z-20 bg-white border-b border-r border-gray-100 px-3 py-2 label-mono text-[10px] uppercase text-gray-500">Team</div>
        {dagen.map((d) => (
          <button key={d} type="button" onClick={() => onDag(d)} className={`sticky top-0 z-10 bg-white border-b border-l border-gray-100 px-2 py-2 text-left text-xs font-semibold capitalize hover:bg-gray-50 ${d === vandaagD ? 'text-gray-900' : 'text-gray-600'} ${focusRing}`}>
            {kortDag(d)}
          </button>
        ))}
        {mensen.map((p) => {
          const gepland = geplandMinuten(items, p.id, dagen, team.bezet)
          const beschikbaar = beschikbaarMinuten(team.beschikbaarheid, p.id, dagen)
          return (
            <div key={p.id} className="contents">
              <div className="sticky left-0 z-10 bg-white border-b border-r border-gray-100 px-3 py-2 flex flex-col gap-1.5 justify-center">
                <span className="flex items-center gap-2 min-w-0"><PersoonFoto naam={p.naam} maat={24} /><span className="text-sm font-semibold text-gray-900 truncate">{p.naam.split(' ')[0]}</span></span>
                <Cap gepland={gepland} beschikbaar={beschikbaar} />
              </div>
              {dagen.map((d) => {
                const lijst = perPersoonDag.get(`${p.id}:${d}`) ?? []
                const bezet = bezetPer.get(`${p.id}:${d}`) ?? 0
                const vrij = heeftBeschikbaarheid(p.id) && !werktOp(p.id, d)
                return (
                  <div key={d} className={`border-b border-l border-gray-100 p-1 space-y-0.5 min-h-[64px] ${vrij ? 'bg-[repeating-linear-gradient(135deg,#f8f8f8_0_6px,#ffffff_6px_12px)]' : ''}`}>
                    {lijst.slice(0, 6).map((i) => <Blokje key={`${i.bron}-${i.id}`} i={i} kleur={kleur(i)} onOpen={onOpen} compact />)}
                    {lijst.length > 6 && <button type="button" onClick={() => onDag(d)} className="text-[11px] text-gray-500 hover:text-gray-900 px-1">+{lijst.length - 6} meer</button>}
                    {bezet > 0 && <div className="rounded-md px-1.5 py-0.5 text-[11px] text-gray-500 bg-gray-100">Bezet · {urenTekst(bezet)}</div>}
                    {vrij && !lijst.length && !bezet && <div className="text-[11px] text-gray-400 px-1">Werkt niet</div>}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Dag: een kolom per persoon, met het uurrooster, beschikbaarheid als achtergrond en Bezet. */
export function TeamDag({ dagen, items, team, mensen, kleur, onOpen }: Props) {
  const d = dagen[0]
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 7.5 * 60 * PX }, [d])
  const wd = weekdagVan(d)
  const kolommen = useMemo(() => mensen.map((p) => {
    const mijn = items.filter((i) => wieVan(i).includes(p.id))
    const rooster: { i: Item; van: number; tot: number }[] = []
    const heleDag: Item[] = []
    for (const i of mijn) {
      const pl = plaatsVan(i)
      if (!pl) continue
      if (pl.soort === 'rooster') { if (pl.dag === d) rooster.push({ i, van: pl.vanMin, tot: pl.totMin }) } else if (pl.van <= d && d <= pl.tot) heleDag.push(i)
    }
    const bezet = team.bezet.filter((b) => b.personen.includes(p.id)).map((b) => plaatsVan({ start_op: b.start_op, eind_op: b.eind_op, heel_dag: false })).filter((x): x is { soort: 'rooster'; dag: string; vanMin: number; totMin: number } => x?.soort === 'rooster' && x.dag === d)
    // Naast elkaar leggen wat overlapt.
    const alle = [...rooster.map((r) => ({ ...r, bezet: false })), ...bezet.map((b) => ({ i: null as Item | null, van: b.vanMin, tot: b.totMin, bezet: true }))].sort((a, b) => a.van - b.van || b.tot - a.tot)
    // Per groep die elkaar overlapt: naast elkaar, elk blok zo breed als zijn groep toelaat.
    const geplaatst: ((typeof alle)[number] & { baan: number; banen: number })[] = []
    let groep: ((typeof alle)[number] & { baan: number })[] = [], groepEind = -1, banen: number[] = []
    const sluit = () => { const n = Math.max(1, banen.length); for (const g of groep) geplaatst.push({ ...g, banen: n }); groep = []; banen = [] }
    for (const x of alle) {
      if (groep.length && x.van >= groepEind) sluit()
      let n = banen.findIndex((e) => e <= x.van); if (n < 0) { n = banen.length; banen.push(x.tot) } else banen[n] = x.tot
      groep.push({ ...x, baan: n }); groepEind = Math.max(groepEind, x.tot)
    }
    sluit()
    const besch = team.beschikbaarheid.find((b) => b.persoon_id === p.id && b.weekdag === wd) ?? null
    return { p, geplaatst, heleDag, besch, gepland: geplandMinuten(items, p.id, [d], team.bezet), beschikbaar: beschikbaarMinuten(team.beschikbaarheid, p.id, [d]) }
  }), [mensen, items, team, d, wd])
  const cols = `52px repeat(${mensen.length}, minmax(150px, 1fr))`

  return (
    <div className="card-base !p-0 overflow-hidden h-full flex flex-col">
      <div className="overflow-x-auto flex-1 min-h-0 flex flex-col">
        <div className="min-w-max flex-1 min-h-0 flex flex-col">
          <div className="grid border-b border-gray-200 bg-white" style={{ gridTemplateColumns: cols }}>
            <div />
            {kolommen.map((k) => (
              <div key={k.p.id} className="border-l border-gray-100 px-2 py-2 space-y-1">
                <span className="flex items-center gap-2 min-w-0"><PersoonFoto naam={k.p.naam} maat={22} /><span className="text-sm font-semibold truncate">{k.p.naam.split(' ')[0]}</span></span>
                <Cap gepland={k.gepland} beschikbaar={k.beschikbaar} klein />
                {k.heleDag.length > 0 && <div className="space-y-0.5 pt-0.5">{k.heleDag.slice(0, 3).map((i) => <Blokje key={`${i.bron}-${i.id}`} i={i} kleur={kleur(i)} onOpen={onOpen} compact />)}{k.heleDag.length > 3 && <div className="text-[11px] text-gray-500">+{k.heleDag.length - 3} meer</div>}</div>}
              </div>
            ))}
          </div>
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
            <div className="grid relative" style={{ gridTemplateColumns: cols, height: 1440 * PX }}>
              <div className="relative">
                {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute right-1.5 text-[10px] text-gray-400 tabular-nums -translate-y-1/2" style={{ top: h * 60 * PX }}>{h ? `${String(h).padStart(2, '0')}:00` : ''}</div>)}
              </div>
              {kolommen.map((k) => (
                <div key={k.p.id} className="relative border-l border-gray-100">
                  {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: h * 60 * PX }} />)}
                  {k.besch && <div className="absolute left-0 right-0 bg-emerald-50/70" style={{ top: minVan(k.besch.van) * PX, height: (minVan(k.besch.tot) - minVan(k.besch.van)) * PX }} title={`Beschikbaar ${k.besch.van}–${k.besch.tot}`} />}
                  {k.geplaatst.map((x, n) => {
                    const stijl = { top: x.van * PX + 1, height: Math.max(18, (x.tot - x.van) * PX - 2), left: `calc(${(x.baan / x.banen) * 100}% + 2px)`, width: `calc(${100 / x.banen}% - 4px)` }
                    if (x.bezet || !x.i) return <div key={`b${n}`} className="absolute rounded-md bg-[repeating-linear-gradient(135deg,#eceff3_0_6px,#f6f7f9_6px_12px)] text-[11px] text-gray-500 px-1.5 py-0.5 overflow-hidden" style={stijl} title={`Bezet ${hhmm(x.van)}–${hhmm(x.tot)}`}>Bezet</div>
                    const i = x.i
                    return (
                      <button key={`${i.bron}-${i.id}`} type="button" data-item={i.bron === 'ag' ? i.id : undefined} onClick={() => onOpen(i)}
                        className={`absolute rounded-md px-1.5 py-0.5 text-left text-[12px] leading-tight overflow-hidden hover:brightness-[0.97] hover:z-[2] ${i.status === 'klaar' ? 'opacity-60' : ''} ${focusRing}`}
                        style={{ ...vlak(kleur(i)), ...stijl }} title={`${hhmm(x.van)}–${hhmm(x.tot)} ${i.titel}`}>
                        <span className="flex items-center gap-1 font-medium">{i.reeks?.soort === 'blok' && <Lock className="h-3 w-3 shrink-0" />}<span className={`truncate ${i.status === 'klaar' ? 'line-through' : ''}`}>{i.titel}</span></span>
                        {x.tot - x.van >= 45 && <span className="block text-[11px] opacity-75 tabular-nums">{hhmm(x.van)}–{hhmm(x.tot)}</span>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

