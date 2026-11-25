'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronRight, Folder, List as ListIcon, FileText, Lock, MoreHorizontal, Plus, CalendarDays, Trash2, CheckCheck, Settings2, Mail, Search, Pencil, Palette, Building2, LockOpen, FolderPlus, ListPlus, FilePlus, ListChecks, Minimize2,
} from 'lucide-react'
import { Modal } from '@/app/admin/materiaal/dialogen'
import { zoekVeld } from '@/lib/zoekveld'
import { PersoonFoto } from '@/components/admin/persoon-foto'
import { actie, Popover, KleurKeuze, PersonenLijst, Schakel, MapIcoon, donkerder, kleurVanMap, focusRing, type BoomData, type AgMap } from './gedeeld'
import { KlantLijst } from './item-venster'

/** `alles` = All tasks: elke open taak uit alle spaces. */
export type Keuze = { soort: 'space' | 'map' | 'lijst' | 'doc' | 'alles'; id: string } | null
type Soort = 'space' | 'map' | 'lijst'

const OPEN_SLEUTEL = 'ngm-agenda-boom'

// ── Slepen in de boom: docs, lijsten en mappen verplaatsen, taken naar een lijst ──
type Sleepbaar = { soort: 'doc' | 'lijst' | 'map'; id: string; naam: string }
const SLEEP_TYPE = 'text/agenda-boom'
function zetSleep(e: React.DragEvent, s: Sleepbaar) {
  e.stopPropagation()
  e.dataTransfer.setData(SLEEP_TYPE, JSON.stringify(s))
  e.dataTransfer.effectAllowed = 'move'
}
/** Wat mag waarin: een doc overal, een lijst in een map of space, een map in een map of space, een taak in een lijst. */
function aanvaardt(doel: Soort, e: React.DragEvent): boolean {
  const t = e.dataTransfer.types
  if (t.includes('text/agenda-item')) return doel === 'lijst'
  return t.includes(SLEEP_TYPE)
}
async function laatVallen(e: React.DragEvent, doel: { soort: Soort; id: string; naam: string }, boom: BoomData, onVernieuw: () => void) {
  e.preventDefault()
  e.stopPropagation()
  const itemId = e.dataTransfer.getData('text/agenda-item')
  try {
    if (itemId) {
      if (doel.soort !== 'lijst') return
      await actie({ actie: 'item.wijzig', id: itemId, lijst_id: doel.id })
      onVernieuw()
      toast.success(`Taak verplaatst naar ${doel.naam}`)
      return
    }
    const ruw = e.dataTransfer.getData(SLEEP_TYPE)
    if (!ruw) return
    const s = JSON.parse(ruw) as Sleepbaar
    if (s.id === doel.id) return
    const sleutel = doel.soort === 'space' ? 'space_id' : doel.soort === 'map' ? 'map_id' : 'lijst_id'
    if (s.soort === 'doc') {
      const d = boom.docs.find((x) => x.id === s.id)
      await actie({ actie: 'doc.wijzig', id: s.id, naar: { [sleutel]: doel.id } })
      const terug = d ? (d.lijst_id ? { lijst_id: d.lijst_id } : d.map_id ? { map_id: d.map_id } : d.space_id ? { space_id: d.space_id } : null) : null
      onVernieuw()
      toast.success(`"${s.naam}" staat nu in ${doel.naam}`, terug ? { action: { label: 'Ongedaan maken', onClick: () => { actie({ actie: 'doc.wijzig', id: s.id, naar: terug }).then(onVernieuw).catch(() => toast.error('Terugzetten mislukt')) } } } : undefined)
      return
    }
    if (doel.soort === 'lijst') { toast.error('Een lijst of map kan niet in een lijst. Sleep ze naar een map of space.'); return }
    if (s.soort === 'lijst') {
      const l = boom.lijsten.find((x) => x.id === s.id)
      await actie({ actie: 'container.wijzig', soort: 'lijst', id: s.id, ...(doel.soort === 'map' ? { map_id: doel.id } : { space_id: doel.id, map_id: null }) })
      onVernieuw()
      const terug = l ? (l.map_id ? { map_id: l.map_id } : { space_id: l.space_id, map_id: null }) : null
      toast.success(`Lijst "${s.naam}" staat nu in ${doel.naam}`, terug ? { action: { label: 'Ongedaan maken', onClick: () => { actie({ actie: 'container.wijzig', soort: 'lijst', id: s.id, ...terug }).then(onVernieuw).catch(() => toast.error('Terugzetten mislukt')) } } } : undefined)
      return
    }
    if (s.soort === 'map') {
      const m = boom.mappen.find((x) => x.id === s.id)
      await actie({ actie: 'container.wijzig', soort: 'map', id: s.id, ...(doel.soort === 'map' ? { parent_id: doel.id } : { space_id: doel.id, parent_id: null }) })
      onVernieuw()
      const terug = m ? (m.parent_id ? { parent_id: m.parent_id } : { space_id: m.space_id, parent_id: null }) : null
      toast.success(`Map "${s.naam}" staat nu in ${doel.naam}`, terug ? { action: { label: 'Ongedaan maken', onClick: () => { actie({ actie: 'container.wijzig', soort: 'map', id: s.id, ...terug }).then(onVernieuw).catch(() => toast.error('Terugzetten mislukt')) } } } : undefined)
    }
  } catch (err) { toast.error(err instanceof Error ? err.message : 'Verplaatsen mislukt') }
}

export function Boom({ boom, keuze, groot = false, onKies, onVernieuw, onPaneel, onNieuwDoc, onVolledig }: {
  boom: BoomData; keuze: Keuze; groot?: boolean; onKies: (k: Keuze) => void; onVernieuw: () => void; onVolledig: () => void
  onPaneel: (p: 'klaar' | 'prullenbak' | 'instellingen' | 'mail') => void
  onNieuwDoc: (waar: { space_id?: string; map_id?: string; lijst_id?: string }) => void
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [naam, setNaam] = useState<null | { titel: string; waarde: string; onBewaar: (n: string) => Promise<void> }>(null)
  const [spaceVenster, setSpaceVenster] = useState<null | { id?: string }>(null)
  useEffect(() => { try { setOpen(new Set(JSON.parse(localStorage.getItem(OPEN_SLEUTEL) ?? '[]'))) } catch { /* */ } }, [])
  const wissel = (id: string) => setOpen((o) => {
    const n = new Set(o)
    if (n.has(id)) n.delete(id); else n.add(id)
    try { localStorage.setItem(OPEN_SLEUTEL, JSON.stringify([...n])) } catch { /* */ }
    return n
  })
  // De geselecteerde lijst of doc: de mappen erboven open.
  useEffect(() => {
    if (!keuze) return
    const extra: string[] = []
    const lijst = keuze.soort === 'lijst' ? boom.lijsten.find((l) => l.id === keuze.id) : null
    const doc = keuze.soort === 'doc' ? boom.docs.find((d) => d.id === keuze.id) : null
    let mapId = keuze.soort === 'map' ? boom.mappen.find((m) => m.id === keuze.id)?.parent_id ?? null : lijst?.map_id ?? doc?.map_id ?? (doc?.lijst_id ? boom.lijsten.find((l) => l.id === doc.lijst_id)?.map_id ?? null : null)
    if (doc?.lijst_id) extra.push(doc.lijst_id)
    for (let i = 0; mapId && i < 6; i++) { extra.push(mapId); mapId = boom.mappen.find((m) => m.id === mapId)?.parent_id ?? null }
    const spaceId = keuze.soort === 'space' ? null : lijst?.space_id ?? boom.mappen.find((m) => m.id === (keuze.soort === 'map' ? keuze.id : extra[extra.length - 1]))?.space_id ?? doc?.space_id
    if (spaceId) extra.push(spaceId)
    if (extra.some((e) => !open.has(e))) setOpen((o) => new Set([...o, ...extra]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keuze?.id])

  const z = q.trim().toLowerCase()
  const zoekt = z.length > 0
  const past = useMemo(() => {
    if (!zoekt) return null
    const ok = new Set<string>()
    const mapVan = new Map(boom.mappen.map((m) => [m.id, m]))
    const markeerOuders = (mapId: string | null, spaceId: string) => {
      for (let m = mapId ? mapVan.get(mapId) : undefined, i = 0; m && i < 6; m = m.parent_id ? mapVan.get(m.parent_id) : undefined, i++) ok.add(m.id)
      ok.add(spaceId)
    }
    for (const l of boom.lijsten) if (l.naam.toLowerCase().includes(z)) { ok.add(l.id); markeerOuders(l.map_id, l.space_id) }
    for (const m of boom.mappen) if (m.naam.toLowerCase().includes(z)) { ok.add(m.id); markeerOuders(m.parent_id, m.space_id) }
    for (const s of boom.spaces) if (s.naam.toLowerCase().includes(z)) ok.add(s.id)
    for (const d of boom.docs) if (d.titel.toLowerCase().includes(z)) {
      ok.add(d.id)
      const l = d.lijst_id ? boom.lijsten.find((x) => x.id === d.lijst_id) : null
      if (l) { ok.add(l.id); markeerOuders(l.map_id, l.space_id) }
      else if (d.map_id) { const m = mapVan.get(d.map_id); if (m) { ok.add(m.id); markeerOuders(m.parent_id, m.space_id) } }
      else if (d.space_id) ok.add(d.space_id)
    }
    return ok
  }, [zoekt, z, boom])
  const isOpen = (id: string) => zoekt || open.has(id)
  const toon = (id: string) => !past || past.has(id)

  const mag = boom.rechten
  const maak = (soort: Soort, extra: Record<string, unknown>, titel: string) => setNaam({
    titel, waarde: '',
    onBewaar: async (n) => {
      const r = await actie({ actie: 'container.nieuw', soort, naam: n, ...extra })
      onVernieuw()
      if (soort === 'lijst' && r.id) onKies({ soort: 'lijst', id: r.id })
      for (const k of ['space_id', 'map_id', 'parent_id'] as const) if (typeof extra[k] === 'string') setOpen((o) => new Set([...o, extra[k] as string]))
    },
  })

  const losseDocs = boom.docs.filter((d) => !d.space_id && !d.map_id && !d.lijst_id)

  return (
    <nav className="flex flex-col h-full min-h-0" aria-label="Spaces, mappen en lijsten">
      <div className="p-2 space-y-1.5">
        {/* Aan/uit: aan = de agenda over het hele scherm, nog eens klikken = terug. */}
        <button type="button" onClick={onVolledig} aria-pressed={groot} title={groot ? 'Terug naar het gewone scherm (Esc)' : 'De agenda over het hele scherm'}
          className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold ${groot ? 'bg-gray-900 text-white' : 'hover:bg-gray-100 text-gray-900'} ${focusRing}`}>
          <CalendarDays className="h-4 w-4" /><span className="flex-1 text-left">Volledige agenda</span>{groot && <Minimize2 className="h-3.5 w-3.5 opacity-80" />}
        </button>
        <div className="relative"><Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input {...zoekVeld()} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek klant, map, lijst…" className="input-base !py-1.5 !pl-8 text-sm" aria-label="Zoek in de boom" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-0">
        {!zoekt && (
          <button type="button" onClick={() => onKies({ soort: 'alles', id: '1' })} aria-pressed={keuze?.soort === 'alles'}
            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 mb-1 text-sm font-semibold ${keuze?.soort === 'alles' ? 'bg-gray-900 text-white' : 'text-gray-900 hover:bg-gray-100'} ${focusRing}`}>
            <span className={`h-5 w-5 shrink-0 rounded-md flex items-center justify-center ${keuze?.soort === 'alles' ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'}`}><ListChecks className="h-3 w-3" /></span>All tasks
          </button>
        )}
        {boom.spaces.filter((s) => toon(s.id)).map((s) => (
          <div key={s.id} className="mb-1">
            <Rij diepte={0} soort="space" id={s.id} naam={s.naam} kleur={s.kleur} eigenKleur={s.kleur} verantwoordelijke={s.verantwoordelijke_id ?? null} onToegang={() => setSpaceVenster({ id: s.id })} prive={s.prive || !!boom.leden[`space:${s.id}`]} open={isOpen(s.id)} onWissel={() => wissel(s.id)}
              gekozen={keuze?.soort === 'space' && keuze.id === s.id} onKies={() => onKies({ soort: 'space', id: s.id })} boom={boom} onVernieuw={onVernieuw}
              menu={{
                nieuweMap: mag.toevoegen ? () => maak('map', { space_id: s.id }, `Nieuwe map in ${s.naam}`) : undefined,
                nieuweLijst: mag.toevoegen ? () => maak('lijst', { space_id: s.id }, `Nieuwe lijst in ${s.naam}`) : undefined,
                nieuwDoc: mag.toevoegen ? () => onNieuwDoc({ space_id: s.id }) : undefined,
                hernoem: (n) => setNaam(n),
              }} />
            {isOpen(s.id) && (
              <div>
                {boom.mappen.filter((m) => m.space_id === s.id && !m.parent_id && toon(m.id)).map((m) => (
                  <MapTak key={m.id} m={m} diepte={1} boom={boom} keuze={keuze} isOpen={isOpen} toon={toon} wissel={wissel} onKies={onKies} maak={maak} setNaam={setNaam} onVernieuw={onVernieuw} onNieuwDoc={onNieuwDoc} />
                ))}
                {boom.lijsten.filter((l) => l.space_id === s.id && !l.map_id && toon(l.id)).map((l) => (
                  <LijstTak key={l.id} l={l} diepte={1} boom={boom} keuze={keuze} isOpen={isOpen} toon={toon} wissel={wissel} onKies={onKies} setNaam={setNaam} onVernieuw={onVernieuw} onNieuwDoc={onNieuwDoc} />
                ))}
                {boom.docs.filter((d) => d.space_id === s.id && !d.map_id && !d.lijst_id && toon(d.id)).map((d) => <DocRij key={d.id} d={d} diepte={1} gekozen={keuze?.soort === 'doc' && keuze.id === d.id} onKies={onKies} />)}
              </div>
            )}
          </div>
        ))}
        {mag.toevoegen && !zoekt && (
          <button type="button" onClick={() => setSpaceVenster({})} className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 ${focusRing}`}><Plus className="h-3.5 w-3.5" />Nieuwe space</button>
        )}
        {losseDocs.filter((d) => toon(d.id)).length > 0 && (
          <div className="mt-2">
            <div className="label-mono text-[10px] uppercase text-gray-400 px-2.5 py-1">Losse docs</div>
            {losseDocs.filter((d) => toon(d.id)).map((d) => <DocRij key={d.id} d={d} diepte={0} gekozen={keuze?.soort === 'doc' && keuze.id === d.id} onKies={onKies} />)}
          </div>
        )}
      </div>
      <div className="border-t border-gray-100 p-2 grid grid-cols-2 gap-1">
        <VoetKnop onClick={() => onPaneel('klaar')} icoon={<CheckCheck className="h-3.5 w-3.5" />}>Completed</VoetKnop>
        <VoetKnop onClick={() => onPaneel('prullenbak')} icoon={<Trash2 className="h-3.5 w-3.5" />}>Prullenbak</VoetKnop>
        {boom.isAdmin && <VoetKnop onClick={() => onPaneel('mail')} icoon={<Mail className="h-3.5 w-3.5" />} teller={boom.mailVoorstellen}>Uit de mail</VoetKnop>}
        <VoetKnop onClick={() => onPaneel('instellingen')} icoon={<Settings2 className="h-3.5 w-3.5" />}>Instellingen</VoetKnop>
      </div>
      {naam && <NaamVenster titel={naam.titel} waarde={naam.waarde} onSluit={() => setNaam(null)} onBewaar={async (n) => { await naam.onBewaar(n); setNaam(null) }} />}
      {spaceVenster && <SpaceVenster boom={boom} id={spaceVenster.id} onSluit={() => setSpaceVenster(null)} onKlaar={(id) => { setSpaceVenster(null); onVernieuw(); if (id) { setOpen((o) => new Set([...o, id])); onKies({ soort: 'space', id }) } }} />}
    </nav>
  )
}

function VoetKnop({ onClick, icoon, children, teller }: { onClick: () => void; icoon: React.ReactNode; children: React.ReactNode; teller?: number }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-100 ${focusRing}`}>
      {icoon}<span className="truncate">{children}</span>
      {!!teller && <span className="ml-auto min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{teller}</span>}
    </button>
  )
}

type NaamZetter = (n: { titel: string; waarde: string; onBewaar: (n: string) => Promise<void> }) => void
type Maak = (soort: Soort, extra: Record<string, unknown>, titel: string) => void

function MapTak({ m, diepte, boom, keuze, isOpen, toon, wissel, onKies, maak, setNaam, onVernieuw, onNieuwDoc }: {
  m: AgMap; diepte: number; boom: BoomData; keuze: Keuze; isOpen: (id: string) => boolean; toon: (id: string) => boolean; wissel: (id: string) => void
  onKies: (k: Keuze) => void; maak: Maak; setNaam: NaamZetter; onVernieuw: () => void; onNieuwDoc: (w: { map_id?: string; lijst_id?: string }) => void
}) {
  const mag = boom.rechten
  return (
    <div>
      <Rij diepte={diepte} soort="map" id={m.id} naam={m.naam} kleur={kleurVanMap(boom, m.id)} eigenKleur={m.kleur} prive={m.prive || !!boom.leden[`map:${m.id}`]} open={isOpen(m.id)} onWissel={() => wissel(m.id)}
        gekozen={keuze?.soort === 'map' && keuze.id === m.id} onKies={() => onKies({ soort: 'map', id: m.id })} boom={boom} onVernieuw={onVernieuw} klantId={m.client_id}
        menu={{
          nieuweMap: mag.toevoegen && diepte < 4 ? () => maak('map', { space_id: m.space_id, parent_id: m.id }, `Nieuwe map in ${m.naam}`) : undefined,
          nieuweLijst: mag.toevoegen ? () => maak('lijst', { space_id: m.space_id, map_id: m.id }, `Nieuwe lijst in ${m.naam}`) : undefined,
          nieuwDoc: mag.toevoegen ? () => onNieuwDoc({ map_id: m.id }) : undefined,
          hernoem: setNaam,
        }} />
      {isOpen(m.id) && (
        <div>
          {boom.mappen.filter((x) => x.parent_id === m.id && toon(x.id)).map((x) => (
            <MapTak key={x.id} m={x} diepte={diepte + 1} boom={boom} keuze={keuze} isOpen={isOpen} toon={toon} wissel={wissel} onKies={onKies} maak={maak} setNaam={setNaam} onVernieuw={onVernieuw} onNieuwDoc={onNieuwDoc} />
          ))}
          {boom.lijsten.filter((l) => l.map_id === m.id && toon(l.id)).map((l) => (
            <LijstTak key={l.id} l={l} diepte={diepte + 1} boom={boom} keuze={keuze} isOpen={isOpen} toon={toon} wissel={wissel} onKies={onKies} setNaam={setNaam} onVernieuw={onVernieuw} onNieuwDoc={onNieuwDoc} />
          ))}
          {boom.docs.filter((d) => d.map_id === m.id && !d.lijst_id && toon(d.id)).map((d) => <DocRij key={d.id} d={d} diepte={diepte + 1} gekozen={keuze?.soort === 'doc' && keuze.id === d.id} onKies={onKies} />)}
        </div>
      )}
    </div>
  )
}

function LijstTak({ l, diepte, boom, keuze, isOpen, toon, wissel, onKies, setNaam, onVernieuw, onNieuwDoc }: {
  l: BoomData['lijsten'][number]; diepte: number; boom: BoomData; keuze: Keuze; isOpen: (id: string) => boolean; toon: (id: string) => boolean; wissel: (id: string) => void
  onKies: (k: Keuze) => void; setNaam: NaamZetter; onVernieuw: () => void; onNieuwDoc: (w: { lijst_id?: string }) => void
}) {
  const docs = boom.docs.filter((d) => d.lijst_id === l.id && toon(d.id))
  return (
    <div>
      <Rij diepte={diepte} soort="lijst" id={l.id} naam={l.naam} kleur={l.kleur ?? kleurVanMap(boom, l.map_id)} eigenKleur={l.kleur} prive={l.prive || !!boom.leden[`lijst:${l.id}`]} open={isOpen(l.id)} onWissel={docs.length ? () => wissel(l.id) : undefined}
        gekozen={keuze?.soort === 'lijst' && keuze.id === l.id} onKies={() => onKies({ soort: 'lijst', id: l.id })} boom={boom} onVernieuw={onVernieuw} klantId={l.client_id}
        menu={{ nieuwDoc: boom.rechten.toevoegen ? () => onNieuwDoc({ lijst_id: l.id }) : undefined, hernoem: setNaam }} />
      {isOpen(l.id) && docs.map((d) => <DocRij key={d.id} d={d} diepte={diepte + 1} gekozen={keuze?.soort === 'doc' && keuze.id === d.id} onKies={onKies} />)}
    </div>
  )
}

function DocRij({ d, diepte, gekozen, onKies, sleep = true }: { d: BoomData['docs'][number]; diepte: number; gekozen: boolean; onKies: (k: Keuze) => void; sleep?: boolean }) {
  return (
    <button type="button" onClick={() => onKies({ soort: 'doc', id: d.id })} style={{ paddingLeft: 10 + diepte * 14 + 16 }}
      draggable={sleep} onDragStart={(e) => zetSleep(e, { soort: 'doc', id: d.id, naam: d.titel })} title={sleep ? 'Sleep naar een andere map of lijst' : undefined}
      className={`w-full flex items-center gap-2 rounded-lg pr-2 py-1.5 text-[13px] ${gekozen ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'} ${focusRing}`}>
      <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" /><span className="truncate">{d.titel}</span>{d.prive && <Lock className="h-3 w-3 shrink-0 opacity-60" />}
    </button>
  )
}

function Rij({ diepte, soort, id, naam, kleur, eigenKleur, prive, open, onWissel, gekozen, onKies, boom, onVernieuw, menu, klantId, verantwoordelijke, onToegang }: {
  diepte: number; soort: Soort; id: string; naam: string; kleur: string | null; eigenKleur: string | null; prive: boolean; open: boolean; onWissel?: () => void
  verantwoordelijke?: string | null; onToegang?: () => void
  gekozen: boolean; onKies: () => void; boom: BoomData; onVernieuw: () => void; klantId?: string | null
  menu: { nieuweMap?: () => void; nieuweLijst?: () => void; nieuwDoc?: () => void; hernoem: NaamZetter }
}) {
  const [menuOpen, setMenuOpen] = useState<null | 'menu' | 'kleur' | 'klant'>(null)
  const sluit = useCallback(() => setMenuOpen(null), [])
  const mag = boom.rechten
  const wijzig = async (velden: Record<string, unknown>, melding?: string) => {
    try { await actie({ actie: 'container.wijzig', soort, id, ...velden }); onVernieuw(); if (melding) toast.success(melding) } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const verwijder = async () => {
    setMenuOpen(null)
    const wat = soort === 'space' ? 'deze space' : soort === 'map' ? 'deze map' : 'deze lijst'
    if (!confirm(`"${naam}" naar de prullenbak? Alles wat erin zit verdwijnt mee uit de agenda. In de prullenbak kan je ${wat} met alles erin terugzetten.`)) return
    try {
      await actie({ actie: 'container.verwijder', soort, id })
      onVernieuw()
      toast.success('Naar de prullenbak', { action: { label: 'Ongedaan maken', onClick: () => { actie({ actie: 'container.herstel', soort, id }).then(onVernieuw).catch(() => toast.error('Terugzetten mislukt')) } } })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }
  const eigen = (boom.leden[`${soort}:${id}`] ?? [])
  const isEigenPrive = eigen.length === 1 && eigen[0] === boom.ik
  const [erboven, setErboven] = useState(false)
  const kanSlepen = mag.aanpassen && soort !== 'space'
  return (
    <div className={`group relative flex items-center rounded-lg ${erboven ? 'ring-2 ring-gray-900 bg-gray-100' : ''} ${gekozen ? 'bg-gray-900 text-white' : 'hover:bg-gray-100 text-gray-800'}`} style={{ paddingLeft: 4 + diepte * 14 }}
      draggable={kanSlepen} onDragStart={kanSlepen ? (e) => zetSleep(e, { soort: soort as 'map' | 'lijst', id, naam }) : undefined}
      onDragOver={mag.aanpassen ? (e) => { if (aanvaardt(soort, e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!erboven) setErboven(true) } } : undefined}
      onDragLeave={() => setErboven(false)}
      onDrop={mag.aanpassen ? (e) => { setErboven(false); void laatVallen(e, { soort, id, naam }, boom, onVernieuw) } : undefined}>
      <button type="button" onClick={onWissel} disabled={!onWissel} aria-label={open ? 'Dichtklappen' : 'Openklappen'} aria-expanded={onWissel ? open : undefined}
        className={`h-6 w-5 shrink-0 flex items-center justify-center rounded ${onWissel ? '' : 'invisible'} ${focusRing}`}>
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''} opacity-60`} />
      </button>
      <button type="button" onClick={onKies} className={`flex-1 min-w-0 flex items-center gap-2 py-1.5 pr-1 text-left ${soort === 'space' ? 'text-sm font-semibold' : 'text-[13px]'} ${focusRing} rounded`}>
        {soort === 'space'
          ? <span className="h-5 w-5 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold" style={{ background: kleur ?? '#272727', color: '#fff' }}>{naam.slice(0, 1).toUpperCase()}</span>
          : soort === 'map' ? <MapIcoon kleur={kleur} />
          : <ListIcon className="h-3.5 w-3.5 shrink-0" style={{ color: kleur ? donkerder(kleur, 0.35) : undefined }} />}
        <span className="truncate">{naam}</span>
        {prive && <Lock className="h-3 w-3 shrink-0 opacity-60" />}
        {verantwoordelijke && <span className="ml-auto shrink-0" title={`Verantwoordelijke: ${boom.personen.find((p) => p.id === verantwoordelijke)?.naam ?? ''}`}><PersoonFoto naam={boom.personen.find((p) => p.id === verantwoordelijke)?.naam ?? '?'} maat={18} /></span>}
      </button>
      {(mag.aanpassen || mag.toevoegen || mag.verwijderen) && (
        <div className="relative">
          <button type="button" onClick={() => setMenuOpen(menuOpen ? null : 'menu')} aria-label={`Menu ${naam}`}
            className={`h-6 w-6 mr-1 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 ${menuOpen ? 'opacity-100' : ''} ${gekozen ? 'hover:bg-white/20' : 'hover:bg-gray-200'} ${focusRing}`}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <Popover open={menuOpen === 'menu'} onSluit={sluit} uitlijnen="rechts" className="w-56 py-1 text-gray-800">
            {menu.nieuweLijst && <MenuKnop icoon={<ListPlus className="h-4 w-4" />} onClick={() => { sluit(); menu.nieuweLijst!() }}>Nieuwe lijst</MenuKnop>}
            {menu.nieuweMap && <MenuKnop icoon={<FolderPlus className="h-4 w-4" />} onClick={() => { sluit(); menu.nieuweMap!() }}>Nieuwe map</MenuKnop>}
            {menu.nieuwDoc && <MenuKnop icoon={<FilePlus className="h-4 w-4" />} onClick={() => { sluit(); menu.nieuwDoc!() }}>Nieuw document</MenuKnop>}
            {mag.aanpassen && <>
              <div className="my-1 border-t border-gray-100" />
              <MenuKnop icoon={<Pencil className="h-4 w-4" />} onClick={() => { sluit(); menu.hernoem({ titel: 'Naam aanpassen', waarde: naam, onBewaar: (n) => wijzig({ naam: n }) }) }}>Naam aanpassen</MenuKnop>
              <MenuKnop icoon={<Palette className="h-4 w-4" />} onClick={() => setMenuOpen('kleur')}>Kleur</MenuKnop>
              {soort !== 'space' && <MenuKnop icoon={<Building2 className="h-4 w-4" />} onClick={() => setMenuOpen('klant')}>{klantId ? 'Andere klant' : 'Koppelen aan een klant'}</MenuKnop>}
              {soort === 'space' && onToegang && <MenuKnop icoon={<Lock className="h-4 w-4" />} onClick={() => { sluit(); onToegang() }}>Verantwoordelijke en toegang</MenuKnop>}
              {soort !== 'space' && (isEigenPrive || !eigen.length) && <MenuKnop icoon={isEigenPrive ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />} onClick={() => { sluit(); wijzig({ prive: !isEigenPrive }, isEigenPrive ? 'Iedereen ziet dit weer.' : 'Enkel jij (en wie je je agenda deelt) ziet dit nu.') }}>{isEigenPrive ? 'Niet meer privé' : 'Privé maken (enkel ik)'}</MenuKnop>}
            </>}
            {mag.verwijderen && <><div className="my-1 border-t border-gray-100" /><MenuKnop icoon={<Trash2 className="h-4 w-4" />} gevaar onClick={verwijder}>Naar de prullenbak</MenuKnop></>}
          </Popover>
          <Popover open={menuOpen === 'kleur'} onSluit={sluit} uitlijnen="rechts" className="p-3 w-64">
            <KleurKeuze waarde={eigenKleur} onKies={(k) => { sluit(); wijzig({ kleur: k }) }} leeg="Automatisch" />
          </Popover>
          <Popover open={menuOpen === 'klant'} onSluit={sluit} uitlijnen="rechts">
            <KlantLijst boom={boom} gekozen={klantId ?? null} onKies={(k) => { sluit(); wijzig({ client_id: k }, k ? 'Gekoppeld aan de klant.' : 'Klant losgekoppeld.') }} />
          </Popover>
        </div>
      )}
    </div>
  )
}

function MenuKnop({ icoon, onClick, children, gevaar }: { icoon: React.ReactNode; onClick: () => void; children: React.ReactNode; gevaar?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm ${gevaar ? 'text-red-700 hover:bg-red-50' : 'hover:bg-gray-50'} ${focusRing}`}>{icoon}{children}</button>
  )
}

export function NaamVenster({ titel, waarde, onSluit, onBewaar }: { titel: string; waarde: string; onSluit: () => void; onBewaar: (n: string) => Promise<void> }) {
  const [v, setV] = useState(waarde)
  const [bezig, setBezig] = useState(false)
  const ok = async () => {
    const n = v.trim()
    if (!n) return
    setBezig(true)
    try { await onBewaar(n) } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(false) }
  }
  return (
    <Modal titel={titel} onSluit={onSluit} voet={<><button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button><button type="button" disabled={!v.trim() || bezig} onClick={ok} className="btn-primary">Bewaren</button></>}>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok() }} className="input-base" placeholder="Naam" aria-label="Naam" maxLength={200} />
    </Modal>
  )
}

/** Nieuwe space (of een bestaande aanpassen): naam, kleur, verantwoordelijke en wie er toegang heeft. */
function SpaceVenster({ boom, id, onSluit, onKlaar }: { boom: BoomData; id?: string; onSluit: () => void; onKlaar: (id: string | null) => void }) {
  const bestaand = id ? boom.spaces.find((s) => s.id === id) : null
  const leden0 = id ? boom.leden[`space:${id}`] ?? [] : []
  const [naam, setNaam] = useState(bestaand?.naam ?? '')
  const [kleur, setKleur] = useState<string | null>(bestaand?.kleur ?? null)
  const [verantwoordelijke, setVerantwoordelijke] = useState<string | null>(bestaand?.verantwoordelijke_id ?? boom.ik)
  const [prive, setPrive] = useState(bestaand ? leden0.length > 0 : false)
  const [leden, setLeden] = useState<string[]>(leden0.length ? leden0 : [boom.ik])
  const [bezig, setBezig] = useState(false)
  const mensen = boom.personen.filter((p) => p.actief && p.user_id)
  const bewaar = async () => {
    if (!naam.trim()) return
    setBezig(true)
    try {
      const velden = { naam: naam.trim(), kleur, verantwoordelijke_id: verantwoordelijke, prive, leden: prive ? [...new Set([...leden, ...(verantwoordelijke ? [verantwoordelijke] : [])])] : [] }
      if (id) { await actie({ actie: 'container.wijzig', soort: 'space', id, ...velden }); toast.success('Space aangepast.'); onKlaar(null) }
      else { const r = await actie({ actie: 'container.nieuw', soort: 'space', ...velden }); toast.success('Space aangemaakt.'); onKlaar(r.id ?? null) }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(false) }
  }
  return (
    <Modal titel={id ? 'Space aanpassen' : 'Nieuwe space'} onSluit={onSluit}
      voet={<><button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button><button type="button" disabled={!naam.trim() || bezig} onClick={bewaar} className="btn-primary">{id ? 'Bewaren' : 'Aanmaken'}</button></>}>
      <input autoFocus value={naam} onChange={(e) => setNaam(e.target.value)} className="input-base" placeholder="Naam van de space" aria-label="Naam" maxLength={200} />
      <div>
        <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Kleur</div>
        <KleurKeuze waarde={kleur} onKies={setKleur} leeg="Zwart" />
      </div>
      <div>
        <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Verantwoordelijke</div>
        <div className="flex flex-wrap gap-1.5">
          {mensen.slice().sort((a, b) => Number(boom.zaakvoerders.includes(b.id)) - Number(boom.zaakvoerders.includes(a.id)) || a.naam.localeCompare(b.naam)).map((p) => (
            <button key={p.id} type="button" onClick={() => setVerantwoordelijke(verantwoordelijke === p.id ? null : p.id)} aria-pressed={verantwoordelijke === p.id}
              className={`inline-flex items-center gap-1.5 rounded-full border pl-0.5 pr-2.5 py-0.5 text-xs ${verantwoordelijke === p.id ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 hover:border-gray-400'}`}>
              <PersoonFoto naam={p.naam} maat={22} />{p.naam.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Schakel aan={prive} onWissel={() => setPrive(!prive)} label={<span className="text-sm flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" />Privé</span>} />
        <p className="text-xs text-gray-500">{prive ? 'Enkel deze mensen zien de space en alles wat erin staat:' : 'Iedereen die de agenda gebruikt ziet deze space.'}</p>
        {prive && (
          <div className="rounded-xl border border-gray-100">
            <PersonenLijst vol personen={mensen} eerst={boom.zaakvoerders} ik={boom.ik} gekozen={[...new Set([...leden, ...(verantwoordelijke ? [verantwoordelijke] : [])])]}
              onWissel={(p) => { if (p === boom.ik) return; setLeden(leden.includes(p) ? leden.filter((x) => x !== p) : [...leden, p]) }} />
          </div>
        )}
      </div>
    </Modal>
  )
}
