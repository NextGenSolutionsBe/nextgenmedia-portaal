'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronLeft, ChevronRight, ChevronDown, Loader2, Plus, Printer, PanelLeft, Search, Tag, Building2, Eye, EyeOff, Mail, X, Users, List as ListIcon, Maximize2, Minimize2, Layers, Check, Mic, MoonStar,
  CalendarRange, Repeat,
} from 'lucide-react'
import { PersoonFoto } from '@/components/admin/persoon-foto'
import { zoekVeld } from '@/lib/zoekveld'
import {
  vandaag, verschuif, bereikVan, dagenVan, kleurVan, klantVan, herkomstVan, mapKleur, kortDag, dag as dagVan, uur as uurVan, KLEUR_VOLGENS, WEERGAVEN, isWeergave,
  type Item, type Weergave, type KleurVolgens,
} from '@/lib/agenda/model'
import { PlanVenster, DetailVenster, AnnuleerVenster, api as meetingApi, type Opties, type Meeting } from '@/app/admin/meetings/meetings-client'
import { Modal } from '@/app/admin/materiaal/dialogen'
import { api, actie, kleurContext, padVan, Popover, PersonenLijst, focusRing, type BoomData } from './gedeeld'
import { Kalender, type Verplaatsing, type NieuwMoment } from './kalender'
import { useVeeg } from './veeg'
import { TeamDag, TeamWeek, type TeamData } from './team'
import { ReeksFormulier, ReeksVenster, teamActie } from './reeks'
import { WeekPlannen } from './week-plannen'
import { VeegSpoor } from './veeg-spoor'
import { Boom, type Keuze } from './boom'
import { ItemVenster, KlantLijst, voorladen } from './item-venster'
import { LijstWeergave, wanneer } from './lijst'
import { DocWeergave } from './doc'
import { NieuwVenster, AfgevinktPaneel, PrullenbakPaneel, MailPaneel, InstellingenPaneel } from './extra'
import { InspreekVenster } from './inspreken'
import { DagAfsluiten } from './dag-afsluiten'
import { NaarVandaag } from './naar-vandaag'

type Modus = Weergave | 'lijst'
type Paneel = null | 'klaar' | 'prullenbak' | 'instellingen' | 'mail'
type MeetingVenster =
  | null
  | { soort: 'plan'; wat: 'algemeen' | 'klant'; m: NieuwMoment }
  | { soort: 'detail'; id: string }
  | { soort: 'wijzig'; meeting: Meeting }
  | { soort: 'annuleer'; meeting: Meeting }

const VOORKEUR = 'ngm-agenda-voorkeur'
// `kleurMap`: de kleurkeuze sinds de mapkleuren (de oude `kleur` stond standaard op klant).
type Voorkeur = { modus?: Modus; personen?: string[]; spaces?: string[]; kleurMap?: KleurVolgens; klaar?: boolean; boom?: boolean }
const leesVoorkeur = (): Voorkeur => { try { return JSON.parse(localStorage.getItem(VOORKEUR) ?? '{}') as Voorkeur } catch { return {} } }
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Kort, voor een smal scherm: "wo 25 nov", "23 – 29 nov", "nov 2026". */
function periodeKort(w: Weergave, d: string): string {
  const f = (x: string, o: Intl.DateTimeFormatOptions) => new Date(`${x}T12:00:00Z`).toLocaleDateString('nl-BE', { ...o, timeZone: 'UTC' })
  if (w === 'dag') return f(d, { weekday: 'short', day: 'numeric', month: 'short' })
  if (w === 'maand') return f(`${d.slice(0, 7)}-15`, { month: 'short', year: 'numeric' })
  const dagen = dagenVan(w, d)
  return `${Number(dagen[0].slice(8))} – ${f(dagen[dagen.length - 1], { day: 'numeric', month: 'short' })}`
}

function periodeTitel(w: Weergave, d: string): string {
  if (w === 'dag') return new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  if (w === 'maand') return new Date(`${d.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const dagen = dagenVan(w, d)
  const a = new Date(`${dagen[0]}T12:00:00Z`), b = new Date(`${dagen[dagen.length - 1]}T12:00:00Z`)
  const zelfdeMaand = a.getUTCMonth() === b.getUTCMonth()
  return `${a.getUTCDate()}${zelfdeMaand ? '' : ` ${a.toLocaleDateString('nl-BE', { month: 'short', timeZone: 'UTC' })}`} – ${b.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`
}

export function AgendaApp({ metTopbalk = true }: { metTopbalk?: boolean }) {
  const [boom, setBoom] = useState<BoomData | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [keuze, setKeuze] = useState<Keuze>(null)
  const [modus, setModus] = useState<Modus>('week')
  const [datum, setDatum] = useState(vandaag())
  const [personen, setPersonen] = useState<string[]>([])
  const [labels, setLabels] = useState<string[]>([])
  const [klant, setKlant] = useState<string | null>(null)
  const [toonKlaar, setToonKlaar] = useState(false)
  const [kleurVolgens, setKleurVolgens] = useState<KleurVolgens>('map')
  const [toonBoom, setToonBoom] = useState(true)
  const [items, setItems] = useState<Item[] | null>(null)
  const [laden, setLaden] = useState(false)
  const [lijstItems, setLijstItems] = useState<Item[] | null>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)
  // Wat de kalender al van de geopende taak weet: het venster toont dat meteen.
  const [voorlopig, setVoorlopig] = useState<Item | null>(null)
  const laatstVerplaatst = useRef(new Map<string, number>())
  const [nieuw, setNieuw] = useState<NieuwMoment | null>(null)
  const [inspreek, setInspreek] = useState(false)
  const [afsluiten, setAfsluiten] = useState(false)
  // Teamagenda (verbeterplan fase 3): kolom per persoon (dag) of rij per persoon (week). Nooit standaard aan.
  const [team, setTeam] = useState(false)
  const [teamData, setTeamData] = useState<TeamData>({ bezet: [], beschikbaarheid: [] })
  const [weekPlannen, setWeekPlannen] = useState(false)
  const [reeksItem, setReeksItem] = useState<Item | null>(null)
  const [nieuweReeks, setNieuweReeks] = useState<null | { dag?: string; van?: string; tot?: string }>(null)
  const [instellingenTab, setInstellingenTab] = useState<'beschikbaarheid' | 'abonnement' | 'verschillen' | undefined>(undefined)
  const [paneel, setPaneel] = useState<Paneel>(null)
  const [mv, setMv] = useState<MeetingVenster>(null)
  const [opties, setOpties] = useState<Opties | null>(null)
  const [pop, setPop] = useState<null | 'personen' | 'labels' | 'klant' | 'zoek' | 'spaces'>(null)
  const [spaces, setSpaces] = useState<string[]>([])
  // Groot scherm: de kalender over het hele scherm, ook over de zijbalk van de app.
  const [groot, setGroot] = useState(false)
  const sluitPop = useCallback(() => setPop(null), [])
  const geladen = useRef(false)
  // De zwevende knoppen rechtsboven (meldingen, Nieuw): de bovenbalk laat er plaats voor, gemeten want hun plek hangt af van de schermbreedte.
  const balkRef = useRef<HTMLDivElement>(null)
  const [ruimteRechts, setRuimteRechts] = useState(0)
  useEffect(() => {
    if (!metTopbalk || groot) { setRuimteRechts(0); return }
    const meet = () => {
      const balk = balkRef.current, knoppen = document.querySelector('[data-zwevende-knoppen]')
      if (!balk || !knoppen || window.innerWidth < 768) { setRuimteRechts(0); return }
      const b = balk.getBoundingClientRect(), k = knoppen.getBoundingClientRect()
      setRuimteRechts(k.bottom > b.top && k.top < b.bottom ? Math.max(0, Math.round(b.right - k.left + 12)) : 0)
    }
    meet()
    const t = setTimeout(meet, 400)
    window.addEventListener('resize', meet)
    return () => { clearTimeout(t); window.removeEventListener('resize', meet) }
  }, [metTopbalk, boom, toonBoom, groot])
  useEffect(() => {
    if (!groot) return
    const oud = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = oud }
  }, [groot])

  // Opzij vegen over de kalender = vorige of volgende periode: met de vinger op de gsm en met
  // twee vingers op de touchpad van een laptop (veeg.ts). De kalender schuift mee en verspringt dan.
  // Als element in de state: de kalender verschijnt pas na het laden van de boom.
  const [inhoud, setInhoud] = useState<HTMLDivElement | null>(null)
  useVeeg(inhoud, { actief: modus !== 'lijst' && keuze?.soort !== 'doc', stap: (n) => setDatum((d) => verschuif(weergave, d, n)) })
  // Een taak al laden zodra de muis er even op blijft (of de vinger erop drukt): openen is dan meteen klaar.
  useEffect(() => {
    const el = inhoud
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const idVan = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-item]')?.dataset.item ?? null : null)
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const id = idVan(e.target)
      if (timer) clearTimeout(timer)
      timer = id ? setTimeout(() => { void voorladen(id).catch(() => null) }, 90) : null
    }
    const neer = (e: PointerEvent) => { const id = idVan(e.target); if (id) void voorladen(id).catch(() => null) }
    el.addEventListener('pointerover', over)
    el.addEventListener('pointerdown', neer)
    return () => { if (timer) clearTimeout(timer); el.removeEventListener('pointerover', over); el.removeEventListener('pointerdown', neer) }
  }, [inhoud])

  // ── Voorkeuren en adresbalk ────────────────────────────────────────────────
  useEffect(() => {
    const v = leesVoorkeur()
    const smal = window.innerWidth < 768
    if (v.modus && isWeergave(v.modus)) setModus(v.modus); else if (smal) setModus('dag')
    if (Array.isArray(v.spaces)) setSpaces(v.spaces)
    if (v.kleurMap) setKleurVolgens(v.kleurMap)
    if (typeof v.klaar === 'boolean') setToonKlaar(v.klaar)
    // Zelf gekozen = onthouden; anders enkel open op een groot scherm, zodat de kalender op een laptop de ruimte krijgt.
    setToonBoom(smal ? false : typeof v.boom === 'boolean' ? v.boom : window.innerWidth >= 1600)
    const q = new URLSearchParams(window.location.search)
    for (const s of ['lijst', 'map', 'space', 'doc'] as const) { const id = q.get(s); if (id) setKeuze({ soort: s, id }) }
    if (q.get('alles')) setKeuze({ soort: 'alles', id: '1' })
    if (q.get('item')) setOpenItem(q.get('item'))
    if (q.get('datum') && /^\d{4}-\d{2}-\d{2}$/.test(q.get('datum')!)) setDatum(q.get('datum')!)
    if (q.get('paneel') === 'mail') setPaneel('mail')
    if (q.get('afsluiten')) setAfsluiten(true)
    geladen.current = true
  }, [])
  const bewaarVoorkeur = (v: Voorkeur) => { try { localStorage.setItem(VOORKEUR, JSON.stringify({ ...leesVoorkeur(), ...v })) } catch { /* */ } }
  useEffect(() => {
    if (!geladen.current) return
    const q = new URLSearchParams()
    if (keuze) q.set(keuze.soort, keuze.id)
    if (openItem) q.set('item', openItem)
    if (datum !== vandaag()) q.set('datum', datum)
    const url = `${window.location.pathname}${q.toString() ? `?${q}` : ''}`
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url)
  }, [keuze, openItem, datum])

  // ── Laden ──────────────────────────────────────────────────────────────────
  const laadBoom = useCallback(async () => {
    try { setBoom(await api<BoomData>('/api/admin/agenda?boom=1')); setFout(null) } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laadBoom() }, [laadBoom])
  // Bij het openen altijd eerst je eigen agenda (taken en meetings); collega's door op hun naam te klikken.
  const eigenGezet = useRef(false)
  useEffect(() => { if (boom && !eigenGezet.current) { eigenGezet.current = true; setPersonen([boom.ik]) } }, [boom])

  const weergave: Weergave = modus === 'lijst' ? 'week' : modus
  const bereik = useMemo(() => bereikVan(weergave, datum), [weergave, datum])
  const vraag = useRef(0)
  // Wat al geladen is per periode: een periode die je al zag (of die naast de huidige voorgeladen werd)
  // staat meteen in beeld, ververst op de achtergrond. Zo toont het vegen de volgende week al.
  const voorraad = useRef(new Map<string, { items: Item[]; t: number }>())
  const [voorraadVersie, setVoorraadVersie] = useState(0)
  // Voor welke periode de geladen lijst geldt (net na het vegen is dat nog even de vorige).
  const [itemsVan, setItemsVan] = useState('')
  const sleutelVan = (b: { van: string; tot: string }) => `${b.van}|${b.tot}`
  const bewaarVoorraad = (k: string, l: Item[]) => {
    voorraad.current.set(k, { items: l, t: Date.now() })
    if (voorraad.current.size > 12) voorraad.current.delete(voorraad.current.keys().next().value as string)
  }
  const laadItems = useCallback(async () => {
    const n = ++vraag.current
    const k = sleutelVan(bereik)
    const al = !team ? voorraad.current.get(k) : undefined
    if (al) { setItems(al.items); setItemsVan(k) }
    setLaden(!al)
    try {
      const j = await api<{ items: Item[] } & Partial<TeamData>>(`/api/admin/agenda?van=${encodeURIComponent(bereik.van)}&tot=${encodeURIComponent(bereik.tot)}${team ? '&team=1' : ''}`)
      if (!team) bewaarVoorraad(k, j.items)
      if (n === vraag.current) { setItems(j.items); setItemsVan(k); if (team) setTeamData({ bezet: j.bezet ?? [], beschikbaarheid: j.beschikbaarheid ?? [] }) }
    } catch (e) { if (n === vraag.current) toast.error(e instanceof Error ? e.message : 'Agenda laden mislukt') } finally { if (n === vraag.current) setLaden(false) }
    // De vorige en volgende periode alvast laden (voor het vegen), enkel als ze er nog niet (vers) zijn.
    if (!team && n === vraag.current) {
      for (const m of [1, -1]) {
        const b = bereikVan(weergave, verschuif(weergave, datum, m))
        const kb = sleutelVan(b), c = voorraad.current.get(kb)
        if (c && Date.now() - c.t < 45_000) continue
        api<{ items: Item[] }>(`/api/admin/agenda?van=${encodeURIComponent(b.van)}&tot=${encodeURIComponent(b.tot)}`)
          .then((j) => { bewaarVoorraad(kb, j.items); setVoorraadVersie((v) => v + 1) }).catch(() => null)
      }
    }
  }, [bereik, team, weergave, datum]) // eslint-disable-line react-hooks/exhaustive-deps
  // Wat je hier aanpast (verplaatsen, afvinken), staat ook in de voorraad van deze periode.
  useEffect(() => { if (items && !team && itemsVan === sleutelVan(bereik)) bewaarVoorraad(itemsVan, items) }, [items]) // eslint-disable-line react-hooks/exhaustive-deps
  const burenItems = useCallback((d: string) => voorraad.current.get(sleutelVan(bereikVan(weergave, d)))?.items ?? [], [weergave, voorraadVersie]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (modus !== 'lijst') laadItems() }, [laadItems, modus])

  const container = keuze && keuze.soort !== 'doc' ? keuze : null
  const laadLijst = useCallback(async () => {
    if (!container) { setLijstItems(null); return }
    try { const j = await api<{ items: Item[] }>(`/api/admin/agenda?container=${container.soort}&id=${container.id}`); setLijstItems(j.items) } catch (e) { toast.error(e instanceof Error ? e.message : 'Lijst laden mislukt') }
  }, [container?.soort, container?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLijstItems(null); if (container && modus === 'lijst') laadLijst() }, [laadLijst, modus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Een lijst, map of space opent in de kalender (de lijst is een keuze); terug naar de volledige agenda = kalender.
  const vorigeKeuze = useRef<string | null>(null)
  useEffect(() => {
    const sleutel = keuze ? `${keuze.soort}:${keuze.id}` : null
    if (sleutel === vorigeKeuze.current) return
    vorigeKeuze.current = sleutel
    if (!keuze && modus === 'lijst') setModus(leesVoorkeur().modus && leesVoorkeur().modus !== 'lijst' ? leesVoorkeur().modus as Weergave : 'week')
  }, [keuze]) // eslint-disable-line react-hooks/exhaustive-deps

  // All tasks = alles van iedereen, als lijst. Ga je er weg, dan komt je eigen filter terug.
  const personenVoorAlles = useRef<string[] | null>(null)
  useEffect(() => {
    if (keuze?.soort === 'alles') {
      if (personenVoorAlles.current === null) { personenVoorAlles.current = personen; setPersonen([]) }
      if (modus !== 'lijst') setModus('lijst')
    } else if (personenVoorAlles.current !== null) { setPersonen(personenVoorAlles.current); personenVoorAlles.current = null }
  }, [keuze?.soort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Terug naar het venster = vers laden (iemand anders kan iets aangepast hebben).
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible') { if (modus === 'lijst') laadLijst(); else laadItems() } }
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [modus, laadItems, laadLijst])

  const vernieuw = useCallback(() => { laadBoom(); if (modus === 'lijst') laadLijst(); else laadItems() }, [laadBoom, laadItems, laadLijst, modus])

  // ── Filteren ───────────────────────────────────────────────────────────────
  const ctx = useMemo(() => (boom ? kleurContext(boom) : null), [boom])
  const personenMap = useMemo(() => new Map((boom?.personen ?? []).map((p) => [p.id, p])), [boom])
  const lijstenVanKeuze = useMemo(() => {
    if (!boom || !container) return null
    if (container.soort === 'alles') {
      const sp = new Map(boom.spaces.map((x, n) => [x.id, n]))
      return [...boom.lijsten].sort((a, b) => (sp.get(a.space_id) ?? 99) - (sp.get(b.space_id) ?? 99) || padVan(boom, a.id).join(' › ').localeCompare(padVan(boom, b.id).join(' › '), 'nl')).map((l) => l.id)
    }
    if (container.soort === 'lijst') return [container.id]
    if (container.soort === 'space') return boom.lijsten.filter((l) => l.space_id === container.id).map((l) => l.id)
    const onder = new Set([container.id])
    for (let i = 0; i < 5; i++) for (const m of boom.mappen) if (m.parent_id && onder.has(m.parent_id)) onder.add(m.id)
    return boom.lijsten.filter((l) => l.map_id && onder.has(l.map_id)).map((l) => l.id)
  }, [boom, container])
  /** `metKlaar`: afgevinkte altijd meegeven (de lijstweergave toont ze ingeklapt onderaan). */
  const filter = useCallback((l: Item[], metKlaar = false, zonderPersonen = false) => {
    const inLijst = lijstenVanKeuze && container?.soort !== 'alles' ? new Set(lijstenVanKeuze) : null
    const spaceVan = new Map((boom?.lijsten ?? []).map((x) => [x.id, x.space_id]))
    return l.filter((i) =>
      // Completed verdwijnt uit de kalender (wit), tenzij je Completed aanzet.
      (metKlaar || toonKlaar || i.status !== 'klaar') &&
      (!spaces.length || (!!i.lijst_id && spaces.includes(spaceVan.get(i.lijst_id) ?? ''))) &&
      (zonderPersonen || !personen.length || i.toegewezen.some((p) => personen.includes(p)) || (!i.toegewezen.length && !!i.eigenaar_id && personen.includes(i.eigenaar_id) && i.bron === 'reeks')) &&
      (!labels.length || i.labels.some((x) => labels.includes(x))) &&
      (!klant || (ctx && klantVan(i, ctx) === klant)) &&
      (!inLijst || (i.lijst_id && inLijst.has(i.lijst_id))))
  }, [toonKlaar, personen, labels, klant, ctx, lijstenVanKeuze, spaces, boom, container?.soort])
  const zichtbaar = useMemo(() => filter(items ?? []), [filter, items])
  // In de teamweergave staat iedereen in een eigen kolom: daar filteren we niet op personen.
  const teamZichtbaar = useMemo(() => (team ? filter(items ?? [], false, true) : []), [team, filter, items])
  const kleur = useCallback((i: Item) => (ctx ? kleurVan(i, ctx, kleurVolgens) : '#e5e7eb'), [ctx, kleurVolgens])
  // Label op elk blok: bij welke klant of map het hoort ("TM Technics").
  const herkomstCtx = useMemo(() => (ctx && boom ? { ...ctx, klanten: Object.fromEntries(boom.klanten.map((k) => [k.id, k.naam])), leden: boom.leden } : null), [ctx, boom])
  const herkomst = useCallback((i: Item) => {
    const h = herkomstCtx ? herkomstVan(i, herkomstCtx) : null
    return h ? { naam: h.naam, kleur: h.mapId && herkomstCtx ? mapKleur(h.mapId, herkomstCtx) : null } : null
  }, [herkomstCtx])

  // ── Acties op items ────────────────────────────────────────────────────────
  const pasLokaalAan = (id: string, velden: Partial<Item>) => {
    // Een meeting uit de Meeting Inplanner verschuift hier niet, afvinken wel.
    setItems((l) => l?.map((x) => (x.id === id && (x.bron === 'ag' || !('start_op' in velden)) ? { ...x, ...velden } : x)) ?? null)
    setLijstItems((l) => l?.map((x) => (x.id === id ? { ...x, ...velden } : x)) ?? null)
  }
  const wisselKlaar = async (i: Item) => {
    if (!boom?.rechten.aanpassen) return
    // Een keer van een herhalende taak afvinken: die keer wordt een gewone (afgevinkte) taak.
    if (i.bron === 'reeks') {
      if (i.reeks?.soort !== 'taak') return
      try { await teamActie({ actie: 'reeks.keer', id: i.id, klaar: true }); toast.success(`Completed: ${i.titel}`); vernieuw() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
      return
    }
    const status = i.status === 'klaar' ? 'open' : 'klaar'
    // Een meeting uit de Meeting Inplanner: enkel het vinkje in de agenda (de meeting zelf verandert niet).
    const zet = (s: 'open' | 'klaar') => (i.bron === 'meeting' ? actie({ actie: 'meeting.klaar', id: i.id, klaar: s === 'klaar' }) : actie({ actie: 'item.wijzig', id: i.id, status: s }))
    pasLokaalAan(i.id, { status, afgerond_op: status === 'klaar' ? new Date().toISOString() : null })
    try {
      await zet(status)
      const terug = () => { pasLokaalAan(i.id, { status: i.status, afgerond_op: i.afgerond_op }); zet(i.status).catch(() => toast.error('Terugzetten mislukt')) }
      toast.success(status === 'klaar' ? `Completed: ${i.titel}` : `Terug open: ${i.titel}`, { action: { label: 'Ongedaan maken', onClick: terug } })
    } catch (e) { pasLokaalAan(i.id, { status: i.status, afgerond_op: i.afgerond_op }); toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const verplaats = async (i: Item, v: Verplaatsing) => {
    // Wat je net naar een dag sleepte, komt onderaan bij die dag (tot je de agenda herlaadt).
    laatstVerplaatst.current.set(i.id, Date.now())
    const oud = { start_op: i.start_op, eind_op: i.eind_op, heel_dag: i.heel_dag, ...('deadline_op' in v ? { deadline_op: i.deadline_op } : {}) }
    pasLokaalAan(i.id, v)
    try {
      await actie({ actie: 'item.wijzig', id: i.id, ...v })
      const wanneerTekst = !v.start_op && v.deadline_op ? `deadline ${kortDag(dagVan(v.deadline_op))} ${uurVan(v.deadline_op)}`
        : v.heel_dag || !v.start_op ? kortDag(dagVan(v.eind_op ?? v.start_op ?? new Date().toISOString())) : `${kortDag(dagVan(v.start_op))} ${uurVan(v.start_op)}`
      toast.success(`Verplaatst naar ${wanneerTekst}`, { action: { label: 'Ongedaan maken', onClick: () => { pasLokaalAan(i.id, oud); actie({ actie: 'item.wijzig', id: i.id, ...oud }).catch(() => toast.error('Terugzetten mislukt')) } } })
    } catch (e) { pasLokaalAan(i.id, oud); toast.error(e instanceof Error ? e.message : 'Verplaatsen mislukt') }
  }
  const open = (i: Item) => {
    // Een shoot open je in de Shoot planner (met de weg terug naar de agenda).
    if (i.bron === 'shoot') { window.location.assign(`/admin/shoots/${i.id}?terug=agenda`); return }
    if (i.bron === 'reeks') { setReeksItem(i); return }
    if (i.bron === 'meeting') { laadOpties(); setMv({ soort: 'detail', id: i.id }) } else { setVoorlopig(i); setOpenItem(i.id) }
  }
  const laadOpties = useCallback(() => { if (!opties) meetingApi<Opties>('/api/admin/meetings?opties=1').then(setOpties).catch(() => toast.error('De Meeting Inplanner kon niet laden.')) }, [opties])

  const nieuwDoc = async (waar: { space_id?: string; map_id?: string; lijst_id?: string }) => {
    try { const r = await actie({ actie: 'doc.nieuw', titel: 'Nieuw document', ...waar }); await laadBoom(); if (r.id) setKeuze({ soort: 'doc', id: r.id }) } catch (e) { toast.error(e instanceof Error ? e.message : 'Aanmaken mislukt') }
  }

  // ── Sneltoetsen: ← → vorige/volgende, T vandaag, D/W/M weergave ─────────────
  useEffect(() => {
    const t = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.closest?.('input,textarea,select,[contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey || openItem || nieuw || inspreek || afsluiten || paneel || mv) return
      if (e.key === 'Escape' && groot && !pop) { setGroot(false); return }
      if (modus === 'lijst' || keuze?.soort === 'doc') return
      if (e.key === 'ArrowLeft') setDatum((d) => verschuif(weergave, d, -1))
      else if (e.key === 'ArrowRight') setDatum((d) => verschuif(weergave, d, 1))
      else if (e.key.toLowerCase() === 't') setDatum(vandaag())
      else if (e.key.toLowerCase() === 'd') kiesModus('dag')
      else if (e.key.toLowerCase() === 'w') kiesModus('week')
      else if (e.key.toLowerCase() === 'm') kiesModus('maand')
      else if (e.key.toLowerCase() === 'p') kiesModus('planning')
    }
    document.addEventListener('keydown', t)
    return () => document.removeEventListener('keydown', t)
  }) // eslint-disable-line react-hooks/exhaustive-deps
  const kiesModus = (m: Modus) => { setModus(m); if (m !== 'lijst') bewaarVoorkeur({ modus: m }) }

  if (fout) return <div className="card-base text-sm text-red-700">{fout}</div>
  if (!boom) return <div className="card-base flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>

  // Ik eerst, dan de zaakvoerders, dan de rest met een account.
  const rang = (id: string) => (id === boom.ik ? 0 : boom.zaakvoerders.includes(id) ? 1 : 2)
  const mensen = boom.personen.filter((p) => p.actief && p.user_id).sort((a, b) => rang(a.id) - rang(b.id) || a.naam.localeCompare(b.naam))
  const titelKeuze = keuze && keuze.soort !== 'doc'
    ? keuze.soort === 'alles' ? ['All tasks'] : (keuze.soort === 'lijst' ? padVan(boom, keuze.id) : keuze.soort === 'map' ? [boom.mappen.find((m) => m.id === keuze.id)?.naam ?? 'Map'] : [boom.spaces.find((s) => s.id === keuze.id)?.naam ?? 'Space'])
    : null
  // Teamweergave: de gekozen mensen (vanaf twee), anders iedereen met een account.
  const teamMensen = personen.length > 1 ? mensen.filter((p) => personen.includes(p.id)) : mensen
  const teamProps = { dagen: dagenVan(weergave, datum), items: teamZichtbaar, team: teamData, mensen: teamMensen, kleur, onOpen: open, onDag: (d: string) => { setDatum(d); kiesModus('dag') } }
  const filterTeller = (personen.length ? 1 : 0) + (labels.length ? 1 : 0) + (klant ? 1 : 0) + (spaces.length ? 1 : 0)
  const printUrl = `/api/admin/agenda/print?dag=${modus === 'dag' ? datum : vandaag()}${personen.length ? `&personen=${personen.join(',')}` : ''}${toonKlaar ? '&klaar=1' : ''}`

  // Niet onthouden: de agenda opent altijd op je eigen taken en meetings.
  const zetPersonen = (n: string[]) => setPersonen(n)
  const hoogte = metTopbalk
    ? 'h-[calc(100dvh-92px)] md:h-[calc(100dvh-72px)] md:-mt-16'
    : 'h-[calc(100dvh-80px)] md:h-[calc(100dvh-60px)]'
  const zetSpaces = (n: string[]) => { setSpaces(n); bewaarVoorkeur({ spaces: n }) }
  const naarGroot = (aan: boolean) => { setGroot(aan); if (aan && window.innerWidth < 1600) setToonBoom(false) }

  return (
    <div className={groot ? 'fixed inset-0 z-[60] bg-[#ececec] p-2 md:p-4 flex gap-3' : `volle-breedte flex gap-3 ${hoogte} min-h-[520px]`}>
      {/* Boom: vast op de computer, als lade op de gsm */}
      {toonBoom && (
        <>
          <div className="md:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setToonBoom(false)} aria-hidden />
          <aside className="fixed md:static inset-y-0 left-0 z-50 md:z-auto w-[86vw] max-w-[320px] md:w-60 shrink-0 bg-white md:card-base md:!p-0 overflow-hidden flex flex-col shadow-xl md:shadow-none">
            <Boom boom={boom} keuze={keuze} groot={groot} onVernieuw={vernieuw} onNieuwDoc={nieuwDoc}
              onVolledig={() => { if (groot) { naarGroot(false); return } setKeuze(null); if (modus === 'lijst') kiesModus('week'); naarGroot(true) }}
              onKies={(k) => { setKeuze(k); if (window.innerWidth < 768) setToonBoom(false) }} onPaneel={(p) => { setPaneel(p); if (window.innerWidth < 768) setToonBoom(false) }} />
          </aside>
        </>
      )}

      <section className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
        {/* Bovenbalk (op de computer naast de zwevende knoppen rechtsboven) */}
        <div ref={balkRef} className="flex flex-wrap items-center gap-2 md:min-h-[44px]" style={ruimteRechts ? { paddingRight: ruimteRechts } : undefined}>
          <button type="button" onClick={() => { setToonBoom(!toonBoom); bewaarVoorkeur({ boom: !toonBoom }) }} aria-label={toonBoom ? 'Mappen verbergen' : 'Mappen tonen'} title={toonBoom ? 'Mappen verbergen' : 'Mappen tonen'} className={`order-1 h-9 w-9 shrink-0 rounded-lg border border-gray-200 bg-white flex items-center justify-center hover:border-gray-400 ${focusRing}`}><PanelLeft className="h-4 w-4" /></button>
          {/* Op de gsm enkel een titel als je een map of lijst koos (de knoppen hebben de plaats nodig). */}
          <div className={`min-w-0 md:flex-none md:mr-2 md:order-2 ${titelKeuze ? 'order-0 w-full md:w-auto' : 'hidden md:block'}`}>
            <h1 className="text-xl font-bold text-gray-900 truncate">{titelKeuze ? titelKeuze[titelKeuze.length - 1] : keuze?.soort === 'doc' ? 'Document' : 'Agenda'}</h1>
            {titelKeuze && titelKeuze.length > 1 && <div className="text-xs text-gray-500 truncate">{titelKeuze.slice(0, -1).join(' › ')}</div>}
          </div>
          {keuze?.soort !== 'doc' && boom.rechten.toevoegen && (
            <button type="button" onClick={() => setNieuw({ dag: modus === 'lijst' ? vandaag() : datum < vandaag() && weergave !== 'dag' ? vandaag() : datum, heelDag: true })} aria-label="Nieuwe taak" className={`order-4 md:order-6 btn-primary !py-2 !px-2.5 md:!px-3.5 !text-sm shrink-0 ${focusRing}`}><Plus className="h-4 w-4" /><span className="hidden xl:inline">Nieuwe taak</span></button>
          )}
          {keuze?.soort !== 'doc' && boom.rechten.aanpassen && (
            <button type="button" onClick={() => setAfsluiten(true)} aria-label="Dag afsluiten" title="Alles wat nog open staat afgaan: gedaan, naar morgen of een andere dag" className={`order-4 md:order-6 h-9 shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 md:px-3 text-sm font-semibold hidden md:inline-flex items-center gap-1.5 hover:border-gray-400 ${focusRing}`}><MoonStar className="h-4 w-4" /><span className="hidden 2xl:inline">Dag afsluiten</span></button>
          )}
          {keuze?.soort !== 'doc' && boom.rechten.aanpassen && (
            <button type="button" onClick={() => setWeekPlannen(true)} aria-label="Week plannen" title="Je open taken over de week verdelen" className={`order-4 md:order-6 h-9 shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 md:px-3 text-sm font-semibold hidden md:inline-flex items-center gap-1.5 hover:border-gray-400 ${focusRing}`}><CalendarRange className="h-4 w-4" /><span className="hidden 2xl:inline">Week plannen</span></button>
          )}
          {keuze?.soort !== 'doc' && boom.rechten.toevoegen && (
            <button type="button" onClick={() => setInspreek(true)} aria-label="Taak inspreken" title="Taak inspreken" className={`order-4 md:order-6 h-9 w-9 shrink-0 rounded-lg border border-gray-200 bg-white hidden md:flex items-center justify-center hover:border-gray-400 ${focusRing}`}><Mic className="h-4 w-4" /></button>
          )}
          {keuze?.soort !== 'doc' && (
            <div className="order-2 flex-1 md:order-3 md:flex-1 md:min-w-[240px] flex items-center gap-1.5 min-w-0">
              {modus !== 'lijst' && (
                <>
                  <button type="button" onClick={() => setDatum(vandaag())} className={`btn-secondary !py-1.5 !px-3 !text-sm shrink-0 hidden md:inline-flex ${focusRing}`}>Vandaag</button>
                  <button type="button" onClick={() => setDatum(verschuif(weergave, datum, -1))} aria-label="Vorige" className={`h-9 w-9 shrink-0 rounded-lg hover:bg-white hidden md:flex items-center justify-center ${focusRing}`}><ChevronLeft className="h-5 w-5" /></button>
                  <button type="button" onClick={() => setDatum(verschuif(weergave, datum, 1))} aria-label="Volgende" className={`h-9 w-9 shrink-0 rounded-lg hover:bg-white hidden md:flex items-center justify-center ${focusRing}`}><ChevronRight className="h-5 w-5" /></button>
                  <span className="text-[15px] font-semibold text-gray-900 capitalize truncate"><span className="2xl:hidden">{periodeKort(weergave, datum)}</span><span className="hidden 2xl:inline">{periodeTitel(weergave, datum)}</span></span>
                  {/* Gsm: terug naar vandaag als je weggeveegd bent. */}
                  {!dagenVan(weergave, datum).includes(vandaag()) && <button type="button" onClick={() => setDatum(vandaag())} className={`md:hidden shrink-0 rounded-full border border-gray-200 bg-white px-2.5 h-7 text-xs font-semibold text-gray-800 ${focusRing}`}>Vandaag</button>}
                  {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400 shrink-0" />}
                </>
              )}
            </div>
          )}
          {keuze?.soort !== 'doc' && (
            <button type="button" onClick={() => naarGroot(!groot)} title={groot ? 'Terug naar het gewone scherm (Esc)' : 'Volledige agenda'} aria-label={groot ? 'Volledige agenda uitzetten' : 'Volledige agenda'} aria-pressed={groot}
              className={`order-3 md:order-5 h-9 shrink-0 rounded-lg border hidden md:flex items-center justify-center gap-1.5 ${groot ? 'px-3 bg-gray-900 text-white border-gray-900 text-sm font-semibold' : 'w-9 bg-white border-gray-200 hover:border-gray-400'} ${focusRing}`}>
              {groot ? <><Minimize2 className="h-4 w-4" />Volledige agenda</> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
          {keuze?.soort !== 'doc' && (
            <div className="order-3 md:order-5 flex shrink-0 rounded-lg border border-gray-200 bg-white p-0.5" role="tablist" aria-label="Weergave">
              {container && <Tab aan={modus === 'lijst'} onClick={() => kiesModus('lijst')}><ListIcon className="h-3.5 w-3.5" /><span className="hidden sm:inline">Lijst</span></Tab>}
              {/* Breed scherm: alle weergaven als tabbladen; anders één keuzelijst (zoals in ClickUp). */}
              <span className="hidden 2xl:contents">
                {WEERGAVEN.map((w) => <Tab key={w.key} aan={modus === w.key} onClick={() => kiesModus(w.key)}>{w.label}</Tab>)}
              </span>
              <select value={modus === 'lijst' ? 'lijst' : modus} onChange={(e) => kiesModus(e.target.value as Modus)} aria-label="Weergave"
                className={`2xl:hidden rounded-md bg-gray-900 text-white text-sm font-semibold pl-2.5 pr-7 py-1 border-0 ${focusRing}`}>
                {modus === 'lijst' && <option value="lijst">Lijst</option>}
                {WEERGAVEN.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Filters: op de gsm één rij om opzij te schuiven */}
        {keuze?.soort !== 'doc' && (
          <div className="flex items-center gap-1.5 overflow-x-auto md:overflow-visible md:flex-wrap -mx-4 px-4 md:mx-0 md:px-0 pb-0.5 [&>*]:shrink-0">
            <div className="relative">
              <button type="button" onClick={() => setPop(pop === 'personen' ? null : 'personen')} aria-expanded={pop === 'personen'}
                className={`inline-flex items-center gap-1.5 rounded-full border h-8 ${personen.length ? 'pl-1 pr-2.5 bg-gray-900 text-white border-gray-900' : 'px-3 bg-white border-gray-200 text-gray-700 hover:border-gray-400'} text-xs ${focusRing}`}>
                {personen.length ? (
                  <>
                    <span className="inline-flex -space-x-1.5">{personen.slice(0, 3).map((p) => <span key={p} className="rounded-full ring-2 ring-gray-900 inline-flex"><PersoonFoto naam={personenMap.get(p)?.naam ?? '?'} maat={22} /></span>)}</span>
                    <span>{personen.length === 1 ? (personen[0] === boom.ik ? 'Mijn agenda' : personenMap.get(personen[0])?.naam.split(' ')[0]) : `${personen.length} personen`}</span>
                  </>
                ) : <><Users className="h-3.5 w-3.5" />Iedereen</>}
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </button>
              <Popover open={pop === 'personen'} onSluit={sluitPop}>
                <div className="p-2 pb-0 flex gap-1.5">
                  <button type="button" onClick={() => zetPersonen([])} aria-pressed={!personen.length} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold ${!personen.length ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 hover:border-gray-400'}`}>Iedereen</button>
                  <button type="button" onClick={() => zetPersonen([boom.ik])} aria-pressed={personen.length === 1 && personen[0] === boom.ik} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold ${personen.length === 1 && personen[0] === boom.ik ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 hover:border-gray-400'}`}>Mijn agenda</button>
                </div>
                <PersonenLijst personen={boom.personen} eerst={boom.zaakvoerders} ik={boom.ik} gekozen={personen} onWissel={(p) => zetPersonen(personen.includes(p) ? personen.filter((x) => x !== p) : [...personen, p])} />
              </Popover>
            </div>
            <Chip aan={team} onClick={() => { const nu = !team; setTeam(nu); if (nu && (modus === 'maand' || modus === 'lijst')) kiesModus('week') }}><Users className="h-3.5 w-3.5" />Team</Chip>
            {boom.rechten.toevoegen && <Chip aan={false} onClick={() => setNieuweReeks({ dag: modus === 'dag' ? datum : vandaag() })}><Repeat className="h-3.5 w-3.5" />Vast blok</Chip>}
            {boom.rechten.aanpassen && <NaarVandaag boom={boom} onVernieuw={vernieuw} gsm />}
            {boom.rechten.aanpassen && <button type="button" onClick={() => setWeekPlannen(true)} className={`md:hidden inline-flex items-center gap-1.5 rounded-full border h-8 px-3 bg-white border-gray-200 text-gray-700 text-xs ${focusRing}`}><CalendarRange className="h-3.5 w-3.5" />Week plannen</button>}
            {boom.rechten.aanpassen && <button type="button" onClick={() => setAfsluiten(true)} className={`md:hidden inline-flex items-center gap-1.5 rounded-full border h-8 px-3 bg-white border-gray-200 text-gray-700 text-xs ${focusRing}`}><MoonStar className="h-3.5 w-3.5" />Dag afsluiten</button>}
            {boom.rechten.toevoegen && <button type="button" onClick={() => setInspreek(true)} aria-label="Taak inspreken" className={`md:hidden inline-flex items-center gap-1.5 rounded-full border h-8 px-3 bg-white border-gray-200 text-gray-700 text-xs ${focusRing}`}><Mic className="h-3.5 w-3.5" />Inspreken</button>}
            <div className="relative">
              <Chip aan={labels.length > 0} onClick={() => setPop(pop === 'labels' ? null : 'labels')}><Tag className="h-3.5 w-3.5" />{labels.length ? `${labels.length} label${labels.length > 1 ? 's' : ''}` : 'Labels'}<ChevronDown className="h-3.5 w-3.5 opacity-70" /></Chip>
              <Popover open={pop === 'labels'} onSluit={sluitPop}>
                <div className="w-full md:w-56 p-2 max-h-72 overflow-y-auto">
                  {boom.labels.map((l) => (
                    <button key={l.id} type="button" role="checkbox" aria-checked={labels.includes(l.id)} onClick={() => setLabels(labels.includes(l.id) ? labels.filter((x) => x !== l.id) : [...labels, l.id])} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
                      <span className="h-3 w-3 rounded-full" style={{ background: l.kleur }} /><span className="flex-1 text-left">{l.naam}</span>{labels.includes(l.id) && <span className="text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              </Popover>
            </div>
            <div className="relative">
              <Chip aan={!!klant} onClick={() => setPop(pop === 'klant' ? null : 'klant')}><Building2 className="h-3.5 w-3.5" /><span className="max-w-[10rem] truncate">{klant ? boom.klanten.find((k) => k.id === klant)?.naam ?? 'Klant' : 'Klant'}</span><ChevronDown className="h-3.5 w-3.5 opacity-70" /></Chip>
              <Popover open={pop === 'klant'} onSluit={sluitPop}><KlantLijst boom={boom} gekozen={klant} onKies={(k) => { setKlant(k); sluitPop() }} /></Popover>
            </div>
            <div className="relative">
              <Chip aan={spaces.length > 0} onClick={() => setPop(pop === 'spaces' ? null : 'spaces')}><Layers className="h-3.5 w-3.5" /><span className="max-w-[10rem] truncate">{spaces.length === 1 ? boom.spaces.find((x) => x.id === spaces[0])?.naam ?? 'Space' : spaces.length ? `${spaces.length} spaces` : 'Spaces'}</span><ChevronDown className="h-3.5 w-3.5 opacity-70" /></Chip>
              <Popover open={pop === 'spaces'} onSluit={sluitPop}>
                <div className="w-full md:w-64 p-2">
                  <button type="button" onClick={() => zetSpaces([])} className={`w-full text-left rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50 ${!spaces.length ? 'font-semibold' : 'text-gray-600'}`}>Alle spaces</button>
                  {boom.spaces.map((x) => {
                    const aan = spaces.includes(x.id)
                    const v = x.verantwoordelijke_id ? personenMap.get(x.verantwoordelijke_id) : null
                    return (
                      <button key={x.id} type="button" role="checkbox" aria-checked={aan} onClick={() => zetSpaces(aan ? spaces.filter((y) => y !== x.id) : [...spaces, x.id])} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
                        <span className="h-5 w-5 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold text-white" style={{ background: x.kleur ?? '#272727' }}>{x.naam.slice(0, 1).toUpperCase()}</span>
                        <span className="flex-1 text-left truncate">{x.naam}</span>
                        {v && <PersoonFoto naam={v.naam} maat={18} />}
                        {aan && <Check className="h-4 w-4" />}
                      </button>
                    )
                  })}
                </div>
              </Popover>
            </div>
            <Chip aan={toonKlaar} onClick={() => { setToonKlaar(!toonKlaar); bewaarVoorkeur({ klaar: !toonKlaar }) }}>{toonKlaar ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}Completed</Chip>
            {filterTeller > 0 && <button type="button" onClick={() => { setLabels([]); setKlant(null); zetPersonen([]); zetSpaces([]) }} className="text-xs text-gray-500 hover:underline inline-flex items-center gap-0.5"><X className="h-3 w-3" />Wis filters</button>}
            <span className="flex-1 hidden md:block" />
            <label className="text-xs text-gray-500 flex items-center gap-1.5">Kleur
              <select value={kleurVolgens} onChange={(e) => { setKleurVolgens(e.target.value as KleurVolgens); bewaarVoorkeur({ kleurMap: e.target.value as KleurVolgens }) }} className="input-base !py-1 !px-2 !text-xs w-auto" aria-label="Kleur volgens">
                {KLEUR_VOLGENS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
            {boom.rechten.aanpassen && <NaarVandaag boom={boom} onVernieuw={vernieuw} />}
            <a href={printUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 rounded-full border h-8 px-3 bg-white border-gray-200 text-gray-700 hover:border-gray-400 text-xs ${focusRing}`} title="Takenlijst als pdf om af te drukken"><Printer className="h-3.5 w-3.5" />{modus === 'dag' && datum !== vandaag() ? 'Takenlijst' : 'Takenlijst vandaag'}</a>
            <Zoeken boom={boom} open={pop === 'zoek'} onOpen={() => setPop('zoek')} onSluit={sluitPop} onKies={(i) => { sluitPop(); open(i) }} />
          </div>
        )}

        {boom.isAdmin && boom.mailVoorstellen > 0 && keuze?.soort !== 'doc' && (
          <button type="button" onClick={() => setPaneel('mail')} className={`flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-left hover:border-gray-400 ${focusRing}`}>
            <Mail className="h-4 w-4" /><span className="flex-1"><strong>{boom.mailVoorstellen} uitnodiging{boom.mailVoorstellen > 1 ? 'en' : ''}</strong> uit de mail om in te plannen</span><ChevronRight className="h-4 w-4 text-gray-400" />
          </button>
        )}

        {/* Inhoud: op de gsm van rand tot rand; opzij vegen = vorige of volgende week (dag, maand). */}
        <div ref={setInhoud} className="flex-1 min-h-0 max-md:-mx-4 overscroll-x-none touch-pan-y touch-pinch-zoom relative overflow-hidden">
          {keuze?.soort === 'doc' ? (
            <DocWeergave key={keuze.id} id={keuze.id} boom={boom} onVernieuw={laadBoom} onVerwijderd={() => { setKeuze(null); laadBoom() }} onOpenItem={(id) => setOpenItem(id)} />
          ) : modus === 'lijst' && lijstenVanKeuze ? (
            <div className="h-full overflow-y-auto pb-6">
              <LijstWeergave lijstIds={lijstenVanKeuze} items={lijstItems ? filter(lijstItems, true) : null} alles={container?.soort === 'alles'}
                boom={boom} personen={personenMap} laden magToevoegen={!!boom.rechten.toevoegen}
                onOpen={open} onKlaar={wisselKlaar} onToegevoegd={laadLijst} onDoc={(id) => setKeuze({ soort: 'doc', id })} />
            </div>
          ) : team && weergave !== 'maand' ? (
            // Teamagenda: op de dag een kolom per persoon, anders een rij per persoon met de capaciteit.
            (weergave === 'dag' ? <TeamDag {...teamProps} /> : <TeamWeek {...teamProps} />)
          ) : (
            // Carrousel: de vorige en volgende periode staan ernaast, zodat vegen meeschuift.
            <VeegSpoor weergave={weergave} datum={datum} render={(d, huidig) => (
              <Kalender weergave={weergave} datum={d} items={huidig && itemsVan === sleutelVan(bereik) ? zichtbaar : filter(burenItems(d))} kleur={kleur} herkomst={herkomst} personen={personenMap}
                magAanpassen={!!boom.rechten.aanpassen} magToevoegen={!!boom.rechten.toevoegen} laatst={laatstVerplaatst.current}
                onOpen={open} onKlaar={wisselKlaar} onVerplaats={verplaats} onNieuw={setNieuw}
                onDag={(x) => { setDatum(x); kiesModus('dag') }} />
            )} />
          )}
        </div>
      </section>

      {/* Vensters */}
      {openItem && (
        <ItemVenster key={openItem} id={openItem} boom={boom} voorlopig={voorlopig?.id === openItem ? voorlopig : null} onSluit={() => setOpenItem(null)} onOpen={(id) => setOpenItem(id)}
          onDoc={(id) => { setOpenItem(null); setKeuze({ soort: 'doc', id }) }}
          onGewijzigd={() => { if (modus === 'lijst') laadLijst(); else laadItems() }}
          onVerwijderd={(id) => { setOpenItem(null); setItems((l) => l?.filter((x) => x.id !== id) ?? null); setLijstItems((l) => l?.filter((x) => x.id !== id) ?? null) }} />
      )}
      {afsluiten && <DagAfsluiten boom={boom} onSluit={() => { setAfsluiten(false); if (new URLSearchParams(window.location.search).get('afsluiten')) window.history.replaceState(null, '', window.location.pathname) }} onVernieuw={vernieuw} />}
      {nieuw && (
        <NieuwVenster m={nieuw} boom={boom} standaardLijst={keuze?.soort === 'lijst' ? keuze.id : keuze?.soort === 'map' ? boom.lijsten.find((l) => l.map_id === keuze.id)?.id ?? null : null} magMeeting={boom.meetings}
          onSluit={() => setNieuw(null)}
          onTaak={(id) => { setNieuw(null); vernieuw(); setOpenItem(id) }}
          onMeeting={(wat) => { laadOpties(); setMv({ soort: 'plan', wat, m: nieuw }); setNieuw(null) }} />
      )}
      {mv && !opties && <Modal titel="Meeting Inplanner" onSluit={() => setMv(null)}><div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div></Modal>}
      {mv?.soort === 'plan' && opties && (
        <PlanVenster opties={opties} bestaand={null} soort={mv.wat} controleerVrij
          voorinvul={{ dag: mv.m.dag, uur: hhmm(mv.m.vanMin ?? 600), duur: Math.max(15, (mv.m.totMin ?? (mv.m.vanMin ?? 600) + 60) - (mv.m.vanMin ?? 600)) }}
          onSluit={() => setMv(null)} onOpen={(id) => setMv({ soort: 'detail', id })}
          onKlaar={(m, melding) => { if (melding) toast.success(melding); laadItems(); setMv({ soort: 'detail', id: m.id }) }} />
      )}
      {mv?.soort === 'detail' && opties && (
        <DetailVenster id={mv.id} opties={opties} onSluit={() => setMv(null)} onVeranderd={laadItems}
          onWijzig={(m) => setMv({ soort: 'wijzig', meeting: m })} onAnnuleer={(m) => setMv({ soort: 'annuleer', meeting: m })} />
      )}
      {mv?.soort === 'wijzig' && opties && (
        <PlanVenster opties={opties} bestaand={mv.meeting} controleerVrij onSluit={() => setMv({ soort: 'detail', id: mv.meeting.id })}
          onOpen={(id) => setMv({ soort: 'detail', id })} onKlaar={(m, melding) => { if (melding) toast.success(melding); laadItems(); setMv({ soort: 'detail', id: m.id }) }} />
      )}
      {mv?.soort === 'annuleer' && (
        <AnnuleerVenster m={mv.meeting} onSluit={() => setMv({ soort: 'detail', id: mv.meeting.id })} onKlaar={(m) => { toast.success('Meeting geannuleerd.'); laadItems(); setMv({ soort: 'detail', id: m.id }) }} />
      )}
      {inspreek && (
        <InspreekVenster boom={boom} onSluit={() => setInspreek(false)} onToegevoegd={(id) => { setInspreek(false); vernieuw(); setOpenItem(id) }} />
      )}
      {paneel === 'klaar' && <AfgevinktPaneel boom={boom} onSluit={() => setPaneel(null)} onOpen={(i) => setOpenItem(i.id)} onVernieuw={vernieuw} />}
      {paneel === 'prullenbak' && <PrullenbakPaneel boom={boom} onSluit={() => setPaneel(null)} onVernieuw={vernieuw} />}
      {paneel === 'mail' && <MailPaneel boom={boom} onSluit={() => setPaneel(null)} onVernieuw={vernieuw} onOpenItem={(id) => { setPaneel(null); setOpenItem(id) }} />}
      {paneel === 'instellingen' && <InstellingenPaneel boom={boom} startTab={instellingenTab} onSluit={() => { setPaneel(null); setInstellingenTab(undefined) }} onVernieuw={vernieuw} onOpenItem={(id) => setOpenItem(id)} />}
      {weekPlannen && <WeekPlannen boom={boom} onSluit={() => setWeekPlannen(false)} onVernieuw={vernieuw} />}
      {reeksItem && <ReeksVenster item={reeksItem} boom={boom} onSluit={() => setReeksItem(null)} onVernieuw={vernieuw} onOpenItem={(id) => { setReeksItem(null); setOpenItem(id) }} />}
      {nieuweReeks && <ReeksFormulier boom={boom} standaard={nieuweReeks} onSluit={() => setNieuweReeks(null)} onBewaard={() => { setNieuweReeks(null); vernieuw() }} />}
    </div>
  )
}

function Tab({ aan, onClick, children }: { aan: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={aan} onClick={onClick} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] ${aan ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'} ${focusRing}`}>{children}</button>
}
function Chip({ aan, onClick, children }: { aan: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={aan} className={`inline-flex items-center gap-1.5 rounded-full border h-8 px-3 text-xs ${aan ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`}>{children}</button>
}

/** Zoeken in alle taken en afspraken (titel). */
function Zoeken({ boom, open, onOpen, onSluit, onKies }: { boom: BoomData; open: boolean; onOpen: () => void; onSluit: () => void; onKies: (i: Item) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Item[] | null>(null)
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return }
    const t = setTimeout(() => { api<{ items: Item[] }>(`/api/admin/agenda?zoek=${encodeURIComponent(q.trim())}`).then((j) => setRes(j.items)).catch(() => setRes([])) }, 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="relative">
      <Chip aan={open} onClick={open ? onSluit : onOpen}><Search className="h-3.5 w-3.5" />Zoeken</Chip>
      <Popover open={open} onSluit={onSluit} uitlijnen="rechts">
        <div className="w-full md:w-80 p-2">
          <input {...zoekVeld()} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek een taak of afspraak…" className="input-base !py-1.5 text-sm" aria-label="Zoek een taak of afspraak" />
          <ul className="max-h-80 overflow-y-auto mt-1.5">
            {res?.map((i) => (
              <li key={i.id}><button type="button" onClick={() => onKies(i)} className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-gray-50">
                <div className={`text-sm truncate ${i.status === 'klaar' ? 'line-through text-gray-400' : ''}`}>{i.titel}</div>
                <div className="text-[11px] text-gray-500 truncate">{wanneer(i)}{i.lijst_id ? ` · ${padVan(boom, i.lijst_id).slice(-2).join(' › ')}` : ''}</div>
              </button></li>
            ))}
            {res && !res.length && <li className="px-2 py-3 text-xs text-gray-500">Niets gevonden.</li>}
          </ul>
        </div>
      </Popover>
    </div>
  )
}

