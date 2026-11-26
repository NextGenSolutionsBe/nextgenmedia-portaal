'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, RotateCcw, CheckSquare, CalendarDays, Video, UserRound, Aperture, Check, Trash2, Plus, Search, ExternalLink, AlertTriangle, Users, Mail, Lock, ListTree, RefreshCw, Link2, X,
} from 'lucide-react'
import { Modal } from '@/app/admin/materiaal/dialogen'
import { PersoonFoto } from '@/components/admin/persoon-foto'
import { zoekVeld } from '@/lib/zoekveld'
import { dag, uur, kortDag, plusDagen, vandaag, zoneNaarIso, snelleDeadlines, type Item } from '@/lib/agenda/model'
import { actie, api, padVan, Popover, PersonenLijst, KleurKeuze, Schakel, Avatars, MapKiezer, MapLabel, WieKiezer, LabelKeuze, labelVoorstel, focusRing, type BoomData } from './gedeeld'
import { wanneer } from './lijst'
import { DicteerKnop } from '@/components/admin/dicteer-knop'

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

// ── Nieuw: wat wil je plannen? ──────────────────────────────────────────────

export type NieuwKeuze = { dag: string; vanMin?: number; totMin?: number; heelDag: boolean }

export function NieuwVenster({ m, boom, standaardLijst, onSluit, onTaak, onMeeting, magMeeting }: {
  m: NieuwKeuze; boom: BoomData; standaardLijst: string | null
  onSluit: () => void; onTaak: (id: string) => void
  onMeeting: (soort: 'algemeen' | 'klant') => void
  magMeeting: boolean
}) {
  const [stap, setStap] = useState<'kies' | 'taak'>(m.heelDag || (!magMeeting && !boom.shoots) ? 'taak' : 'kies')
  // De dag van de taak: start op de aangeklikte dag, met één klik een andere.
  const [opDag, setOpDag] = useState(m.dag)
  const [titel, setTitel] = useState('')
  const [notitie, setNotitie] = useState('')
  const [lijst, setLijst] = useState<string | null>(standaardLijst)
  const [wie, setWie] = useState<string[]>([boom.ik])
  const [prive, setPrive] = useState(false)
  const [soort, setSoort] = useState<'taak' | 'meeting'>(m.heelDag ? 'taak' : 'meeting')
  const [open, setOpen] = useState<null | 'lijst'>(null)
  // Deadline: geen, een snelle keuze of zelf datum en uur.
  const [deadline, setDeadline] = useState<string | null>(null)
  const [eigenDl, setEigenDl] = useState(false)
  const [dlDag, setDlDag] = useState(m.dag)
  const [dlUur, setDlUur] = useState('17:00')
  // Zolang je de deadline niet zelf koos, volgt haar datum de dag van de taak.
  useEffect(() => { if (!eigenDl) setDlDag(opDag) }, [opDag, eigenDl])
  const deadlineIso = eigenDl ? (dlDag && dlUur ? zoneNaarIso(dlDag, dlUur) : null) : deadline
  const metDeadline = soort === 'taak' && !!deadlineIso
  // Label: een voorstel uit de titel en de map, tot je zelf iets kiest.
  const voorstel = useMemo(() => labelVoorstel(boom, { titel, lijst_id: lijst, soort }), [boom, titel, lijst, soort])
  const [labels, setLabels] = useState<string[]>([])
  const [labelsGekozen, setLabelsGekozen] = useState(false)
  useEffect(() => { if (!labelsGekozen) setLabels(voorstel ? [voorstel.id] : []) }, [voorstel, labelsGekozen])
  const [bezig, setBezig] = useState(false)
  const [mapNodig, setMapNodig] = useState(false)
  const sluitPop = useCallback(() => setOpen(null), [])
  const wanneerTekst = m.heelDag ? `${kortDag(opDag)}, hele dag` : `${kortDag(opDag)}, ${hhmm(m.vanMin ?? 540)}–${hhmm(m.totMin ?? 600)}`
  const maak = async () => {
    if (!titel.trim()) return
    // Elke taak hoort bij een map (klant): zo krijgt ze ook de kleur van die map.
    if (!lijst) { setMapNodig(true); setOpen('lijst'); return }
    setBezig(true)
    try {
      const start = m.heelDag ? null : zoneNaarIso(opDag, hhmm(m.vanMin ?? 540))
      const eind = m.heelDag ? zoneNaarIso(opDag, '00:00') : (m.totMin ?? 600) >= 1440 ? zoneNaarIso(plusDagen(opDag, 1), '00:00') : zoneNaarIso(opDag, hhmm(m.totMin ?? 600))
      // Een taak van een hele dag met een deadline op die dag: enkel de deadline
      // (staat bovenaan die dag). Valt de deadline later, dan blijft de taak op de gekozen dag.
      const enkelDl = metDeadline && m.heelDag && !!deadlineIso && dag(deadlineIso) === opDag
      const r = await actie({
        actie: 'item.nieuw', titel: titel.trim(), soort, start_op: enkelDl ? null : start, eind_op: enkelDl ? null : eind, heel_dag: enkelDl ? false : m.heelDag,
        deadline_op: metDeadline ? deadlineIso : null, lijst_id: lijst, toegewezen: wie, prive, labels,
        ...(notitie.trim() ? { beschrijving: notitie.trim() } : {}),
      })
      toast.success(soort === 'meeting' ? 'Afspraak in de agenda gezet.' : 'Taak toegevoegd.')
      if (r.id) onTaak(r.id)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }
  // Een shoot plan je in de Shoot planner (klant, locaties, programma); dag en uur gaan mee.
  const shootLink = `/admin/shoots/nieuw?datum=${opDag}${m.heelDag ? '' : `&van=${hhmm(m.vanMin ?? 540)}&tot=${hhmm(Math.min(m.totMin ?? 600, 1439))}`}&terug=agenda`
  if (stap === 'kies') {
    return (
      <Modal titel="Wat wil je plannen?" sub={wanneerTekst} onSluit={onSluit}>
        <div className="grid gap-2">
          <Keuze icoon={<CheckSquare className="h-4 w-4" />} titel="Taak of afspraak in de agenda" tekst="Enkel in onze agenda: zonder uitnodiging of mail. Bv. een shoot voorbereiden, een blok focuswerk, tandarts." onClick={() => setStap('taak')} />
          {boom.shoots && (
            <a href={shootLink} className={`card-base !p-3 text-left hover:border-gray-400 block ${focusRing}`}>
              <div className="font-medium flex items-center gap-2"><Aperture className="h-4 w-4" />Contentshoot</div>
              <div className="text-xs text-gray-600 mt-0.5">In de Shoot planner, met deze dag en dit uur al ingevuld: klant, locatie, programma, wie erbij is en de shotlist. Staat daarna ook in de agenda.</div>
            </a>
          )}
          {magMeeting && <>
            <Keuze icoon={<CalendarDays className="h-4 w-4" />} titel="Algemene afspraak met Google Meet" tekst="Via de Meeting Inplanner: Google Agenda, Meet-link, uitnodiging en herinnering. Stagebespreking, verzekering, overleg." onClick={() => onMeeting('algemeen')} />
            <Keuze icoon={<Video className="h-4 w-4" />} titel="Meeting met een klant" tekst="Online of op locatie, gekoppeld aan de klant: uitnodiging, mail en herinnering zoals altijd." onClick={() => onMeeting('klant')} />
            <a href={`/admin/meetings?tab=agenda`} className={`card-base !p-3 text-left hover:border-gray-400 block ${focusRing}`}>
              <div className="font-medium flex items-center gap-2"><UserRound className="h-4 w-4" />Verkoopafspraak met een lead<ExternalLink className="h-3.5 w-3.5 text-gray-400" /></div>
              <div className="text-xs text-gray-600 mt-0.5">Opent Calendar in de Meeting Inplanner, met setter, merk en uitkomst zoals altijd.</div>
            </a>
          </>}
        </div>
      </Modal>
    )
  }
  return (
    <Modal titel={m.heelDag ? 'Nieuwe taak' : 'Nieuw in de agenda'} sub={wanneerTekst} onSluit={onSluit}
      voet={<><button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button><button type="button" disabled={!titel.trim() || bezig} onClick={maak} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Toevoegen</button></>}>

      <input autoFocus value={titel} onChange={(e) => setTitel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') maak() }} className="input-base text-base" placeholder={m.heelDag ? 'Wat moet er gebeuren?' : 'Waarover gaat het?'} aria-label="Titel" maxLength={500} />
      {boom.shoots && <a href={shootLink} className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-black underline underline-offset-2"><Aperture className="h-3.5 w-3.5" />Is het een contentshoot? Plan ze in de Shoot planner</a>}
      {!m.heelDag && (
        <div className="flex gap-1.5">
          {(['meeting', 'taak'] as const).map((s) => <button key={s} type="button" onClick={() => setSoort(s)} aria-pressed={soort === s} className={`rounded-full border px-3 py-1 text-xs ${soort === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700'}`}>{s === 'meeting' ? 'Afspraak' : 'Taak met uur'}</button>)}
        </div>
      )}
      <DagKeuze dag={opDag} onKies={setOpDag} />
      <div>
        <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Voor welke map (klant)?</div>
        <div className="relative">
          <button type="button" onClick={() => setOpen(open === 'lijst' ? null : 'lijst')} className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm hover:border-gray-400 ${mapNodig && !lijst ? 'border-red-400 bg-red-50/40' : 'border-gray-200'} ${focusRing}`}>
            <MapLabel boom={boom} lijstId={lijst} leeg="Kies de map, bv. Group Cé of Pitch Please" />
          </button>
        </div>
        {open === 'lijst' && <div className="mt-1.5 rounded-xl border border-gray-200"><MapKiezer vol boom={boom} gekozen={lijst} onKies={(l) => { setLijst(l); setMapNodig(false); sluitPop() }} /></div>}
        {mapNodig && !lijst && <p className="text-xs text-red-700 mt-1">Kies eerst bij welke map deze taak hoort.</p>}
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="label-mono text-[10px] uppercase text-gray-500">Notities</div>
          <DicteerKnop zet={setNotitie} context={titel || null} klein />
        </div>
        <textarea value={notitie} onChange={(e) => setNotitie(e.target.value)} rows={notitie.split('\n').length > 2 ? 5 : 2} maxLength={20000}
          className="input-base text-sm" placeholder="Typ of spreek in wat erbij hoort (optioneel)" aria-label="Notities" />
      </div>
      {soort === 'taak' && (
        <div>
          <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Deadline</div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => { setDeadline(null); setEigenDl(false) }} aria-pressed={!deadlineIso} className={`rounded-full border px-2.5 py-1 text-xs ${!deadlineIso ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`}>Geen</button>
            {snelleDeadlines().map((x) => {
              const aan = !eigenDl && deadline === x.iso
              return <button key={x.label} type="button" onClick={() => { setDeadline(x.iso); setEigenDl(false) }} aria-pressed={aan} className={`rounded-full border px-2.5 py-1 text-xs ${aan ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`}>{x.label}</button>
            })}
            <button type="button" onClick={() => setEigenDl(true)} aria-pressed={eigenDl} className={`rounded-full border px-2.5 py-1 text-xs ${eigenDl ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`}>Zelf kiezen</button>
          </div>
          {eigenDl && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              <input type="date" value={dlDag} onChange={(e) => setDlDag(e.target.value)} className="input-base !py-1 !px-2 text-sm !w-[9.5rem]" aria-label="Datum deadline" />
              <input type="time" step={300} value={dlUur} onChange={(e) => setDlUur(e.target.value)} className="input-base !py-1 !px-2 text-sm !w-[6.5rem]" aria-label="Uur deadline" />
            </div>
          )}
          {metDeadline && m.heelDag && deadlineIso && dag(deadlineIso) !== opDag && <p className="text-[11px] text-gray-500 mt-1">De taak staat op {kortDag(opDag)}, met de deadline erbij.</p>}
        </div>
      )}
      <div>
        <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Wie</div>
        <WieKiezer boom={boom} gekozen={wie} onWissel={(p) => setWie(wie.includes(p) ? wie.filter((x) => x !== p) : [...wie, p])} />
      </div>
      <div>
        <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Label</div>
        <LabelKeuze boom={boom} gekozen={labels} voorstel={voorstel} onZet={(l) => { setLabels(l); setLabelsGekozen(true) }} />
      </div>
      <Schakel aan={prive} onWissel={() => setPrive(!prive)} label={<span className="text-sm flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" />Privé (enkel jij en wie je je agenda deelt)</span>} />
    </Modal>
  )
}

/** Welke dag: vandaag, morgen en de dagen erna met één klik, of zelf een datum. */
export function DagKeuze({ dag: gekozen, onKies, label = 'Welke dag?' }: { dag: string; onKies: (d: string) => void; label?: string }) {
  const v = vandaag()
  const dagen = Array.from({ length: 7 }, (_, n) => plusDagen(v, n))
  const naam = (d: string, n: number) => n === 0 ? 'Vandaag' : n === 1 ? 'Morgen' : new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
  const elders = !dagen.includes(gekozen)
  return (
    <div>
      <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {dagen.map((d, n) => {
          const aan = d === gekozen
          return <button key={d} type="button" onClick={() => onKies(d)} aria-pressed={aan} className={`rounded-full border px-2.5 py-1 text-xs ${aan ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`}>{naam(d, n)}</button>
        })}
        <input type="date" value={gekozen} onChange={(e) => { if (e.target.value) onKies(e.target.value) }} aria-label="Andere dag"
          className={`input-base !py-1 !px-2 text-xs !w-[9.5rem] ${elders ? '!border-gray-900 font-semibold' : ''}`} />
      </div>
    </div>
  )
}

function Keuze({ icoon, titel, tekst, onClick }: { icoon: React.ReactNode; titel: string; tekst: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`card-base !p-3 text-left hover:border-gray-400 ${focusRing}`}>
      <div className="font-medium flex items-center gap-2">{icoon}{titel}</div>
      <div className="text-xs text-gray-600 mt-0.5">{tekst}</div>
    </button>
  )
}

// ── Afgevinkt ───────────────────────────────────────────────────────────────

export function AfgevinktPaneel({ boom, onSluit, onOpen, onVernieuw }: { boom: BoomData; onSluit: () => void; onOpen: (i: Item) => void; onVernieuw: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [volgende, setVolgende] = useState<string | null>(null)
  const [persoon, setPersoon] = useState<string>('')
  const [zoek, setZoek] = useState('')
  const [q, setQ] = useState('')
  const [laden, setLaden] = useState(false)
  // Zoeken wacht even tot je stopt met typen.
  useEffect(() => { const t = setTimeout(() => setQ(zoek.trim().length >= 2 ? zoek.trim() : ''), 300); return () => clearTimeout(t) }, [zoek])
  const personen = useMemo(() => new Map(boom.personen.map((p) => [p.id, p])), [boom.personen])
  const laad = useCallback(async (na: string | null) => {
    setLaden(true)
    try {
      const p = new URLSearchParams({ klaar: '1' })
      if (persoon) p.set('persoon', persoon)
      if (q) p.set('q', q)
      if (na) p.set('na', na)
      const j = await api<{ items: Item[]; volgende: string | null }>(`/api/admin/agenda?${p}`)
      setItems((x) => (na ? [...(x ?? []), ...j.items] : j.items)); setVolgende(j.volgende)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [persoon, q])
  useEffect(() => { setItems(null); laad(null) }, [laad])
  const heropen = async (i: Item) => {
    try { await actie({ actie: 'item.wijzig', id: i.id, status: 'open' }); setItems((x) => x?.filter((y) => y.id !== i.id) ?? null); onVernieuw(); toast.success('Terug open gezet.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  // Per dag van afvinken.
  const perDag = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const i of items ?? []) { const d = i.afgerond_op ? dag(i.afgerond_op) : 'onbekend'; m.set(d, [...(m.get(d) ?? []), i]) }
    return [...m]
  }, [items])
  const mensen = boom.personen.filter((p) => p.actief && p.user_id)
  return (
    <Modal titel="Completed" sub="Alles wat klaar is, met wanneer het completed werd. Niets verdwijnt." onSluit={onSluit} breed>
      <div className="relative">
        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input {...zoekVeld()} autoFocus value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek een taak op naam…" className="input-base !pl-9" aria-label="Zoek in wat completed is" />
        {zoek && <button type="button" onClick={() => setZoek('')} aria-label="Zoeken wissen" className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg hover:bg-gray-100 flex items-center justify-center"><X className="h-3.5 w-3.5" /></button>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setPersoon('')} aria-pressed={!persoon} className={`rounded-full border px-3 py-1 text-xs ${!persoon ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200'}`}>Iedereen</button>
        {mensen.map((p) => (
          <button key={p.id} type="button" onClick={() => setPersoon(p.id)} aria-pressed={persoon === p.id} className={`inline-flex items-center gap-1 rounded-full border pl-0.5 pr-2.5 py-0.5 text-xs ${persoon === p.id ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200'}`}><PersoonFoto naam={p.naam} maat={20} />{p.naam.split(' ')[0]}</button>
        ))}
      </div>
      {!items && <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {items && !items.length && <p className="text-sm text-gray-500 py-6 text-center">{q ? `Niets completed met "${q}" in de naam.` : 'Nog niets completed.'}</p>}
      {laden && items && <div className="flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>}
      {perDag.map(([d, l]) => (
        <div key={d}>
          <div className="label-mono text-[10px] uppercase text-gray-500 mb-1">{d === 'onbekend' ? 'Onbekend' : d === vandaag() ? 'Vandaag' : d === plusDagen(vandaag(), -1) ? 'Gisteren' : new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {l.map((i) => (
              <li key={i.id} className="flex items-center gap-2.5 px-3 py-2">
                <Check className="h-4 w-4 text-gray-900 shrink-0" />
                <button type="button" onClick={() => onOpen(i)} className="flex-1 min-w-0 text-left">
                  <div className="text-sm truncate">{i.titel}</div>
                  <div className="text-[11px] text-gray-500 truncate">{i.afgerond_op ? uur(i.afgerond_op) : ''}{i.afgerond_door ? ` · door ${i.afgerond_door}` : ''}{i.lijst_id ? ` · ${padVan(boom, i.lijst_id).slice(-2).join(' › ')}` : ''}</div>
                </button>
                <Avatars ids={i.toegewezen} personen={personen} max={3} maat={18} />
                {boom.rechten.aanpassen && <button type="button" onClick={() => heropen(i)} className={`text-xs text-gray-600 hover:underline shrink-0 ${focusRing}`}>Heropenen</button>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {volgende && <button type="button" disabled={laden} onClick={() => laad(volgende)} className="btn-secondary w-full">{laden && <Loader2 className="h-4 w-4 animate-spin" />}Meer laden</button>}
    </Modal>
  )
}

// ── Prullenbak ──────────────────────────────────────────────────────────────

type Weg = { id: string; naam?: string; titel?: string; verwijderd_op: string | null; verwijderd_door: string | null; soort?: string }
export function PrullenbakPaneel({ boom, onSluit, onVernieuw }: { boom: BoomData; onSluit: () => void; onVernieuw: () => void }) {
  const [d, setD] = useState<{ spaces: Weg[]; mappen: Weg[]; lijsten: Weg[]; items: Weg[]; docs: Weg[] } | null>(null)
  const laad = useCallback(() => { api<typeof d>('/api/admin/agenda?prullenbak=1').then(setD).catch((e) => toast.error(e instanceof Error ? e.message : 'Laden mislukt')) }, [])
  useEffect(() => { laad() }, [laad])
  const zetTerug = async (body: Record<string, unknown>) => {
    try { await actie(body); toast.success('Teruggezet.'); laad(); onVernieuw() } catch (e) { toast.error(e instanceof Error ? e.message : 'Terugzetten mislukt') }
  }
  const groepen: { titel: string; rijen: Weg[]; body: (w: Weg) => Record<string, unknown> }[] = d ? [
    { titel: 'Spaces', rijen: d.spaces, body: (w) => ({ actie: 'container.herstel', soort: 'space', id: w.id }) },
    { titel: 'Mappen', rijen: d.mappen, body: (w) => ({ actie: 'container.herstel', soort: 'map', id: w.id }) },
    { titel: 'Lijsten', rijen: d.lijsten, body: (w) => ({ actie: 'container.herstel', soort: 'lijst', id: w.id }) },
    { titel: 'Taken en afspraken', rijen: d.items, body: (w) => ({ actie: 'item.herstel', id: w.id }) },
    { titel: 'Documenten', rijen: d.docs, body: (w) => ({ actie: 'doc.herstel', id: w.id }) },
  ] : []
  const leeg = d && groepen.every((g) => !g.rijen.length)
  return (
    <Modal titel="Prullenbak" sub="Wat je verwijdert, staat hier. Terugzetten zet ook alles wat erin zat terug." onSluit={onSluit} breed>
      {!d && <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {leeg && <p className="text-sm text-gray-500 py-6 text-center">De prullenbak is leeg.</p>}
      {groepen.filter((g) => g.rijen.length).map((g) => (
        <div key={g.titel}>
          <div className="label-mono text-[10px] uppercase text-gray-500 mb-1">{g.titel}</div>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {g.rijen.map((w) => (
              <li key={w.id} className="flex items-center gap-2.5 px-3 py-2">
                <Trash2 className="h-4 w-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{w.naam ?? w.titel}</div>
                  <div className="text-[11px] text-gray-500">{w.verwijderd_op ? new Date(w.verwijderd_op).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' }) : ''}{w.verwijderd_door ? ` · door ${w.verwijderd_door}` : ''}</div>
                </div>
                {boom.rechten.verwijderen && <button type="button" onClick={() => zetTerug(g.body(w))} className={`btn-secondary !py-1 !px-2.5 !text-xs shrink-0 ${focusRing}`}><RotateCcw className="h-3.5 w-3.5" />Terugzetten</button>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Modal>
  )
}

// ── Uitnodigingen uit de mail ───────────────────────────────────────────────

type Voorstel = {
  id: string; mailbox: string; van: string; van_naam: string | null; onderwerp: string | null; ontvangen_op: string; titel: string; start_op: string | null; eind_op: string | null
  locatie: string | null; meet_url: string | null; platform: string | null; deelnemers: { naam: string | null; email: string }[] | null; organisator: { naam: string | null; email: string | null } | null
  beschrijving: string | null; bron: 'ics' | 'ai'; status: 'voorstel' | 'ingepland' | 'genegeerd'; item_id: string | null; geannuleerd: boolean; vervangt_item_id: string | null; beslist_door: string | null; beslist_op: string | null
}
const PLATFORM: Record<string, string> = { teams: 'Microsoft Teams', meet: 'Google Meet', zoom: 'Zoom', webex: 'Webex' }

export function MailPaneel({ boom, onSluit, onVernieuw, onOpenItem }: { boom: BoomData; onSluit: () => void; onVernieuw: () => void; onOpenItem: (id: string) => void }) {
  const [lijst, setLijst] = useState<Voorstel[] | null>(null)
  const laad = useCallback(() => { api<{ voorstellen: Voorstel[] }>('/api/admin/agenda?mail=1').then((j) => setLijst(j.voorstellen)).catch((e) => toast.error(e instanceof Error ? e.message : 'Laden mislukt')) }, [])
  useEffect(() => { laad() }, [laad])
  const open = (lijst ?? []).filter((v) => v.status === 'voorstel')
  const beslist = (lijst ?? []).filter((v) => v.status !== 'voorstel')
  return (
    <Modal titel="Uitnodigingen uit de mail" sub="Teams-, Meet- en Zoom-uitnodigingen uit de mailbox. Niets komt in de agenda zonder jouw klik." onSluit={onSluit} breed>
      {!lijst && <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {lijst && !open.length && <p className="text-sm text-gray-500 py-4 text-center">Geen nieuwe uitnodigingen. De mailbox wordt elk uur nagekeken.</p>}
      {open.map((v) => <VoorstelKaart key={v.id} v={v} boom={boom} onKlaar={(itemId) => { laad(); onVernieuw(); if (itemId) onOpenItem(itemId) }} />)}
      {beslist.length > 0 && (
        <div>
          <div className="label-mono text-[10px] uppercase text-gray-500 mb-1">Eerder beslist</div>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {beslist.map((v) => (
              <li key={v.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1 min-w-0 truncate">{v.titel}</span>
                <span className="text-[11px] text-gray-500 shrink-0">{v.status === 'ingepland' ? 'Ingepland' : 'Genegeerd'}{v.beslist_door ? ` door ${v.beslist_door}` : ''}</span>
                {v.status === 'ingepland' && v.item_id && <button type="button" onClick={() => onOpenItem(v.item_id!)} className="text-xs underline shrink-0">Openen</button>}
                {v.status === 'genegeerd' && <button type="button" onClick={() => actie({ actie: 'mail.terug', id: v.id }).then(laad).catch(() => toast.error('Mislukt'))} className="text-xs underline shrink-0">Terugzetten</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}

function VoorstelKaart({ v, boom, onKlaar }: { v: Voorstel; boom: BoomData; onKlaar: (itemId: string | null) => void }) {
  const [plan, setPlan] = useState(false)
  const [titel, setTitel] = useState(v.titel)
  const [wie, setWie] = useState<string[]>([boom.ik])
  const [lijst, setLijst] = useState<string | null>(null)
  const [open, setOpen] = useState<null | 'wie' | 'lijst'>(null)
  const [meer, setMeer] = useState(false)
  const [bezig, setBezig] = useState(false)
  const sluitPop = useCallback(() => setOpen(null), [])
  const doe = async (body: Record<string, unknown>, melding: string) => {
    setBezig(true)
    try { const r = await actie(body); toast.success(melding); onKlaar(body.actie === 'mail.plan' ? r.id ?? null : null) } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  const tijd = v.start_op ? `${kortDag(dag(v.start_op))}, ${uur(v.start_op)}${v.eind_op ? `–${uur(v.eind_op)}` : ''}` : 'Geen tijdstip'
  const verleden = v.start_op && Date.parse(v.eind_op ?? v.start_op) < Date.now()
  return (
    <div className={`rounded-xl border p-4 space-y-2 ${v.geannuleerd ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
      {v.geannuleerd && <div className="text-xs font-semibold text-red-700 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Geannuleerd door de organisator</div>}
      {v.vervangt_item_id && !v.geannuleerd && <div className="text-xs font-semibold text-amber-700 flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5" />Gewijzigd: nieuw tijdstip of nieuwe gegevens voor een afspraak die al in de agenda staat</div>}
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0"><Video className="h-4 w-4" /></div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900">{v.titel}</div>
          <div className="text-sm text-gray-700">{tijd}{verleden && <span className="text-gray-400"> · voorbij</span>}</div>
          <div className="text-xs text-gray-500 mt-0.5 truncate">{v.platform ? PLATFORM[v.platform] ?? v.platform : 'Uitnodiging'} · van {v.organisator?.naam ?? v.van_naam ?? v.van}{v.bron === 'ai' && ' · tijd gelezen uit de tekst, kijk ze even na'}</div>
        </div>
      </div>
      {!!v.deelnemers?.length && <div className="text-xs text-gray-600 flex items-start gap-1.5"><Users className="h-3.5 w-3.5 mt-px shrink-0" /><span>{v.deelnemers.slice(0, 8).map((d) => d.naam ?? d.email).join(', ')}{v.deelnemers.length > 8 && ` en ${v.deelnemers.length - 8} anderen`}</span></div>}
      {v.locatie && <div className="text-xs text-gray-600">{v.locatie}</div>}
      {v.beschrijving && (
        <div className="text-xs text-gray-600 whitespace-pre-line">{meer ? v.beschrijving : v.beschrijving.slice(0, 220)}{v.beschrijving.length > 220 && <button type="button" onClick={() => setMeer(!meer)} className="ml-1 underline">{meer ? 'minder' : '… meer'}</button>}</div>
      )}
      {v.meet_url && <a href={v.meet_url} target="_blank" rel="noopener noreferrer" className="text-xs underline inline-flex items-center gap-1 break-all"><Link2 className="h-3 w-3" />Link naar de meeting</a>}
      <div className="text-[11px] text-gray-400 flex items-center gap-1"><Mail className="h-3 w-3" />{v.onderwerp} · {new Date(v.ontvangen_op).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Brussels' })} · {v.mailbox}</div>
      {plan && !v.geannuleerd && (
        <div className="rounded-lg bg-gray-50 p-3 space-y-2">
          <input value={titel} onChange={(e) => setTitel(e.target.value)} className="input-base !py-1.5 text-sm" aria-label="Titel in de agenda" />
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <button type="button" onClick={() => setOpen(open === 'wie' ? null : 'wie')} className="btn-secondary !py-1 !px-2.5 !text-xs"><Users className="h-3.5 w-3.5" />{wie.map((p) => boom.personen.find((x) => x.id === p)?.naam.split(' ')[0]).join(', ') || 'Niemand'}</button>
              <Popover open={open === 'wie'} onSluit={sluitPop}><PersonenLijst personen={boom.personen} ik={boom.ik} gekozen={wie} onWissel={(p) => setWie(wie.includes(p) ? wie.filter((x) => x !== p) : [...wie, p])} /></Popover>
            </div>
            <div className="relative">
              <button type="button" onClick={() => setOpen(open === 'lijst' ? null : 'lijst')} className="btn-secondary !py-1 !px-2.5 !text-xs max-w-[260px]"><MapLabel boom={boom} lijstId={lijst} leeg="Map kiezen" /></button>
              <Popover open={open === 'lijst'} onSluit={sluitPop}><MapKiezer boom={boom} gekozen={lijst} leeg="Enkel in de agenda (geen map)" onKies={(l) => { setLijst(l); sluitPop() }} /></Popover>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 justify-end pt-1">
        <button type="button" disabled={bezig} onClick={() => doe({ actie: 'mail.negeer', id: v.id }, 'Genegeerd.')} className="btn-secondary !py-1.5 !text-xs"><X className="h-3.5 w-3.5" />Negeren</button>
        {v.geannuleerd
          ? <button type="button" disabled={bezig} onClick={() => doe({ actie: 'mail.plan', id: v.id }, 'Uit de agenda gehaald (staat in de prullenbak).')} className="btn-danger !py-1.5 !text-xs"><Trash2 className="h-3.5 w-3.5" />Uit de agenda halen</button>
          : v.vervangt_item_id
            ? <button type="button" disabled={bezig} onClick={() => doe({ actie: 'mail.plan', id: v.id }, 'Afspraak bijgewerkt.')} className="btn-primary !py-1.5 !text-xs"><Check className="h-3.5 w-3.5" />Afspraak bijwerken</button>
            : plan
              ? <button type="button" disabled={bezig || !titel.trim()} onClick={() => doe({ actie: 'mail.plan', id: v.id, titel: titel.trim(), toegewezen: wie, lijst_id: lijst }, 'In de agenda gezet.')} className="btn-primary !py-1.5 !text-xs">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}In de agenda zetten</button>
              : <button type="button" onClick={() => setPlan(true)} className="btn-primary !py-1.5 !text-xs"><Plus className="h-3.5 w-3.5" />Inplannen</button>}
      </div>
    </div>
  )
}

// ── Instellingen ────────────────────────────────────────────────────────────

export function InstellingenPaneel({ boom, onSluit, onVernieuw }: { boom: BoomData; onSluit: () => void; onVernieuw: () => void }) {
  const [tab, setTab] = useState<'labels' | 'klanten' | 'delen' | 'clickup'>(boom.rechten.instellingen ? 'labels' : 'delen')
  const tabs = [
    ...(boom.rechten.instellingen ? [{ k: 'labels' as const, l: 'Labels' }, { k: 'klanten' as const, l: 'Kleur per klant' }] : []),
    { k: 'delen' as const, l: 'Mijn agenda delen' }, { k: 'clickup' as const, l: 'ClickUp' },
  ]
  return (
    <Modal titel="Instellingen agenda" onSluit={onSluit} breed>
      <div className="flex gap-1 border-b border-gray-100 -mt-1 pb-2 overflow-x-auto">
        {tabs.map((t) => <button key={t.k} type="button" onClick={() => setTab(t.k)} aria-pressed={tab === t.k} className={`shrink-0 rounded-full px-3 py-1 text-sm ${tab === t.k ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>{t.l}</button>)}
      </div>
      {tab === 'labels' && <Labels boom={boom} onVernieuw={onVernieuw} />}
      {tab === 'klanten' && <KlantKleuren boom={boom} onVernieuw={onVernieuw} />}
      {tab === 'delen' && <Delen boom={boom} onVernieuw={onVernieuw} />}
      {tab === 'clickup' && <Clickup boom={boom} onVernieuw={onVernieuw} />}
    </Modal>
  )
}

function Labels({ boom, onVernieuw }: { boom: BoomData; onVernieuw: () => void }) {
  const [nieuw, setNieuw] = useState('')
  const [kleurOpen, setKleurOpen] = useState<string | null>(null)
  const bewaar = async (body: Record<string, unknown>) => { try { await actie({ actie: 'label.bewaar', ...body }); onVernieuw() } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Labels zoals shoot, lead of teamvergadering. Kies in de agenda &quot;Kleur volgens label&quot; om ze in die kleur te zien.</p>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
        {boom.labels.map((l) => (
          <li key={l.id} className="flex items-center gap-2 px-3 py-2">
            <div className="relative">
              <button type="button" onClick={() => setKleurOpen(kleurOpen === l.id ? null : l.id)} className={`h-6 w-6 rounded-full border border-black/10 ${focusRing}`} style={{ background: l.kleur }} aria-label={`Kleur van ${l.naam}`} />
              <Popover open={kleurOpen === l.id} onSluit={() => setKleurOpen(null)} className="p-3 w-64"><KleurKeuze waarde={l.kleur} onKies={(k) => { setKleurOpen(null); if (k) bewaar({ id: l.id, naam: l.naam, kleur: k }) }} leeg="—" /></Popover>
            </div>
            <input defaultValue={l.naam} onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== l.naam) bewaar({ id: l.id, naam: n, kleur: l.kleur }) }} className="flex-1 bg-transparent border-0 p-1 text-sm focus:ring-0 focus:outline-none" aria-label="Naam van het label" />
            <button type="button" onClick={async () => { if (!confirm(`Label "${l.naam}" verwijderen? Taken verliezen dit label.`)) return; try { await actie({ actie: 'label.verwijder', id: l.id }); onVernieuw() } catch { toast.error('Verwijderen mislukt') } }} className={`h-7 w-7 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 flex items-center justify-center ${focusRing}`} aria-label={`${l.naam} verwijderen`}><Trash2 className="h-3.5 w-3.5" /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={nieuw} onChange={(e) => setNieuw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && nieuw.trim()) { bewaar({ naam: nieuw.trim(), kleur: '#c7d2fe' }); setNieuw('') } }} className="input-base !py-1.5 text-sm" placeholder="Nieuw label" aria-label="Nieuw label" />
        <button type="button" disabled={!nieuw.trim()} onClick={() => { bewaar({ naam: nieuw.trim(), kleur: '#c7d2fe' }); setNieuw('') }} className="btn-primary !py-1.5 shrink-0"><Plus className="h-4 w-4" />Toevoegen</button>
      </div>
    </div>
  )
}

function KlantKleuren({ boom, onVernieuw }: { boom: BoomData; onVernieuw: () => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const lijst = boom.klanten.filter((k) => !k.gearchiveerd && k.naam.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(!!boom.klantKleuren[b.id]) - Number(!!boom.klantKleuren[a.id]) || a.naam.localeCompare(b.naam))
  const zet = async (client_id: string, kleur: string | null) => { setOpen(null); try { await actie({ actie: 'klantkleur', client_id, kleur }); onVernieuw() } catch { toast.error('Bewaren mislukt') } }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Taken van een klant (of uit de map van die klant) krijgen deze kleur als je kleurt volgens klant.</p>
      <div className="relative"><Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" /><input {...zoekVeld()} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek een klant…" className="input-base !py-1.5 !pl-8 text-sm" aria-label="Zoek een klant" /></div>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 max-h-[50vh] overflow-y-auto">
        {lijst.slice(0, 150).map((k) => (
          <li key={k.id} className="flex items-center gap-2 px-3 py-1.5">
            <div className="relative">
              <button type="button" onClick={() => setOpen(open === k.id ? null : k.id)} className={`h-6 w-6 rounded-full border ${boom.klantKleuren[k.id] ? 'border-black/10' : 'border-dashed border-gray-300'} ${focusRing}`} style={{ background: boom.klantKleuren[k.id] ?? 'transparent' }} aria-label={`Kleur van ${k.naam}`} />
              <Popover open={open === k.id} onSluit={() => setOpen(null)} className="p-3 w-64"><KleurKeuze waarde={boom.klantKleuren[k.id] ?? null} onKies={(c) => zet(k.id, c)} leeg="Automatisch" /></Popover>
            </div>
            <span className="text-sm flex-1 truncate">{k.naam}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Delen({ boom, onVernieuw }: { boom: BoomData; onVernieuw: () => void }) {
  const [gekozen, setGekozen] = useState<string[]>(boom.deelIkMet)
  const [bezig, setBezig] = useState(false)
  const collega = boom.personen.filter((p) => p.actief && p.user_id && p.id !== boom.ik)
  const bewaar = async (nieuw: string[]) => {
    setGekozen(nieuw); setBezig(true)
    try { await actie({ actie: 'delen', kijkers: nieuw }); onVernieuw() } catch { toast.error('Bewaren mislukt'); setGekozen(boom.deelIkMet) } finally { setBezig(false) }
  }
  const zie = boom.zieIkVan.map((id) => boom.personen.find((p) => p.id === id)?.naam).filter(Boolean)
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Je privélijsten (enkel jij als lid) en je privé-afspraken zie je standaard alleen zelf. Duid aan wie ze ook mag zien. Zij kunnen ze bekijken en aanpassen, net als jij.</p>
      <ul className="grid sm:grid-cols-2 gap-2">
        {collega.map((p) => {
          const aan = gekozen.includes(p.id)
          return (
            <li key={p.id}><button type="button" role="checkbox" aria-checked={aan} disabled={bezig} onClick={() => bewaar(aan ? gekozen.filter((x) => x !== p.id) : [...gekozen, p.id])}
              className={`w-full flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${aan ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'} ${focusRing}`}>
              <PersoonFoto naam={p.naam} maat={28} /><span className="flex-1 text-left">{p.naam}</span>{aan && <Check className="h-4 w-4" />}
            </button></li>
          )
        })}
      </ul>
      {zie.length > 0 && <p className="text-xs text-gray-500">Jij ziet de privé-agenda van: {zie.join(', ')}.</p>}
    </div>
  )
}

function Clickup({ boom, onVernieuw }: { boom: BoomData; onVernieuw: () => void }) {
  const [token, setToken] = useState('')
  const [bezig, setBezig] = useState<null | 'koppel' | 'nu' | 'ontkoppel'>(null)
  const eigen = boom.clickup.find((b) => b.eigen && b.actief)
  const doe = async (body: Record<string, unknown>, wat: 'koppel' | 'nu' | 'ontkoppel', melding: string) => {
    setBezig(wat)
    try { await actie(body); toast.success(melding); setToken(''); onVernieuw() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  const tijd = (t: string | null) => (t ? new Date(t).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Brussels' }) : 'nog niet')
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">De agenda neemt alles uit ClickUp over en houdt het elke 5 minuten bij: nieuwe en aangepaste taken, mappen, lijsten en docs. Wat je hier in de app aanpast, blijft staan.</p>
      <ul className="space-y-2">
        {boom.clickup.map((b) => {
          const p = b.persoon_id ? boom.personen.find((x) => x.id === b.persoon_id) : null
          return (
            <li key={b.id} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                {p && <PersoonFoto naam={p.naam} maat={22} />}
                <span className="font-medium">{b.gedeeld ? 'Gedeeld account' : 'Eigen account'}{b.clickup_naam ? ` · ${b.clickup_naam}` : ''}</span>
                <span className="ml-auto text-xs text-gray-500">{!b.actief ? 'Uitgeschakeld' : b.bezig_sinds ? 'Bezig…' : b.volledig_op ? 'Bijgewerkt' : 'Eerste keer ophalen…'}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">Laatst bijgewerkt {tijd(b.laatste_sync_op)}{b.tellers?.totaal_bewaard ? ` · ${b.tellers.totaal_bewaard.toLocaleString('nl-BE')} taken overgenomen` : ''}{b.tellers?.totaal_docs ? ` · ${b.tellers.totaal_docs} docs` : ''}</div>
              {b.fout && <div className="text-xs text-red-700 mt-1">{b.fout}</div>}
            </li>
          )
        })}
      </ul>
      <div className="rounded-xl bg-gray-50 p-4 space-y-2">
        <div className="font-semibold text-sm">Je eigen privélijsten mee overnemen</div>
        <p className="text-xs text-gray-600">ClickUp toont privélijsten enkel aan de eigenaar. Koppel je eigen account, dan komen ook jouw privélijsten (bv. &quot;Bram privé&quot;) in de agenda, enkel zichtbaar voor jou. In ClickUp: klik op je profielfoto → Settings → Apps → API Token → Generate, en plak het hier. Het token blijft op de server en wordt nooit getoond.</p>
        {eigen ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Gekoppeld als <strong>{eigen.clickup_naam ?? 'jij'}</strong></span>
            <button type="button" disabled={!!bezig} onClick={() => doe({ actie: 'clickup.nu' }, 'nu', 'Opgehaald.')} className="btn-secondary !py-1 !text-xs">{bezig === 'nu' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Nu ophalen</button>
            <button type="button" disabled={!!bezig} onClick={() => { if (confirm('Je ClickUp-account loskoppelen? Wat al overgenomen is, blijft staan.')) doe({ actie: 'clickup.ontkoppel' }, 'ontkoppel', 'Losgekoppeld.') }} className="text-xs underline text-gray-600">Loskoppelen</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="pk_…" className="input-base !py-1.5 text-sm font-mono" aria-label="Persoonlijk ClickUp-token" />
            <button type="button" disabled={!token.trim() || !!bezig} onClick={() => doe({ actie: 'clickup.koppel', token: token.trim() }, 'koppel', 'Gekoppeld. Je privélijsten komen binnen enkele minuten binnen.')} className="btn-primary !py-1.5 shrink-0">{bezig === 'koppel' && <Loader2 className="h-4 w-4 animate-spin" />}Koppelen</button>
          </div>
        )}
      </div>
      {boom.isAdmin && <button type="button" disabled={!!bezig} onClick={() => doe({ actie: 'clickup.nu', alle: true }, 'nu', 'Bijgewerkt.')} className="btn-secondary !py-1.5 !text-xs">{bezig === 'nu' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Gedeeld account nu bijwerken</button>}
    </div>
  )
}

export { wanneer }
