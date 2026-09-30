'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Ban, Trash2, RefreshCw, CalendarCheck, CalendarPlus, Users, Link2, Send } from 'lucide-react'
import { Dialoog } from '@/app/admin/instellingen/ui'
import { WeekKalender, WeekNavigatie, maandagVan, plusDagen, tint, type WkItem, type WkSelectie } from '@/components/personeel/week-kalender'
import { api, Chip, datumNl, dagLang, kortUur, vandaagBE, INP, LBL, type LinkItem } from '@/components/personeel/ui'
import { WERKSTATUS, PRIORITEITEN, type BeschikbaarheidStatus, type Werkstatus } from '@/lib/personeel/model'
import { bevestigingVan, binnenBeschikbaarheid, BEVESTIGING_INFO, TELT_ALS_BESCHIKBAAR } from '@/lib/personeel/planning'

type Mw = { id: string; voornaam: string; achternaam: string | null; actief: boolean; kleur: string | null; type?: string | null }
type Beschikbaar = { id: string; personeel_id: string; datum: string; start_tijd: string; eind_tijd: string; opmerking: string | null; status: BeschikbaarheidStatus }
type Werkblok = {
  id: string; personeel_id: string; datum: string; start_tijd: string; eind_tijd: string; client_id: string | null; opdracht_id: string | null; project: string | null; taak: string | null
  verwachte_duur_min: number | null; deadline: string | null; prioriteit: string | null; briefing: string | null; links: LinkItem[]; deliverables: string | null; locatie: string | null; thuiswerk: boolean
  status: string; werkstatus: Werkstatus; voortgang: string | null; groep_id?: string | null
  bevestiging: string | null; bevestiging_reden: string | null; clickup_task_id: string | null; clickup_status: string | null; clickup_toegewezen: string | null; clickup_fout: string | null
}
type Data = {
  planning: Werkblok[]; beschikbaarheid: Beschikbaar[]
  medewerkers: Mw[]; klanten: { id: string; company_name: string }[]; opdrachten: { id: string; titel: string; client_id: string | null }[]
}
const naamVan = (m?: Mw) => (m ? [m.voornaam, m.achternaam].filter(Boolean).join(' ') : '—')
/** Standaardkleuren zolang er geen eigen kleur gekozen is (op volgorde van de lijst). */
const PALET = ['#a855f7', '#3b82f6', '#f97316', '#10b981', '#ef4444', '#eab308', '#06b6d4', '#ec4899']

type Inboeking = { datum: string; start: string; eind: string; personen: string[] }

/**
 * Planning voor admins: één algemene kalender met de beschikbaarheid van
 * iedereen, elk in een eigen kleur. Sleep over een dag om een tijdvak te kiezen
 * en boek wie dan vrij is in (één of meerdere mensen tegelijk). Elke persoon
 * krijgt een mail met alle details en bevestigt; pas dan gaat het naar ClickUp
 * (bestaande taak → toegevoegd, anders een nieuwe taak met de toegewezenen).
 */
export function PlanningTab({ personeelId }: { personeelId?: string }) {
  const vandaag = vandaagBE()
  const [maandag, setMaandag] = useState(maandagVan(vandaag))
  const [data, setData] = useState<Data | null>(null)
  const [verborgen, setVerborgen] = useState<Set<string>>(new Set())
  const [modus, setModus] = useState<'inboeken' | 'beschikbaarheid'>('inboeken')
  const [voorWie, setVoorWie] = useState(personeelId ?? '')
  const [blok, setBlok] = useState<Partial<Werkblok> | null>(null)
  const [inboeken, setInboeken] = useState<Inboeking | null>(null)
  const [bewerk, setBewerk] = useState<Beschikbaar | null>(null)

  const laad = useCallback(async () => {
    const q = new URLSearchParams({ van: maandag, tot: plusDagen(maandag, 6), ...(personeelId ? { personeel_id: personeelId } : {}) })
    try { setData(await api<Data>(`/api/admin/personeel/planning?${q}`)) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [maandag, personeelId])
  useEffect(() => { laad() }, [laad])

  const actief = useMemo(() => (data?.medewerkers ?? []).filter((m) => m.actief && (!personeelId || m.id === personeelId)), [data, personeelId])
  const kleurVan = useMemo(() => {
    const m = new Map<string, string>()
    ;(data?.medewerkers ?? []).forEach((x, i) => m.set(x.id, x.kleur || PALET[i % PALET.length]))
    return m
  }, [data])
  const mw = useMemo(() => new Map((data?.medewerkers ?? []).map((m) => [m.id, m])), [data])
  useEffect(() => { if (!voorWie && actief[0]) setVoorWie(actief[0].id) }, [actief, voorWie])

  const zetKleur = async (id: string, kleur: string) => {
    setData((d) => d ? { ...d, medewerkers: d.medewerkers.map((m) => (m.id === id ? { ...m, kleur } : m)) } : d)
    try { await api(`/api/admin/personeel/${id}`, { method: 'PATCH', body: { kleur } }) } catch (e) { toast.error(e instanceof Error ? e.message : 'Kleur bewaren mislukt') }
  }

  const items = useMemo<WkItem[]>(() => {
    if (!data) return []
    const uit: WkItem[] = []
    for (const b of data.beschikbaarheid) {
      if (verborgen.has(b.personeel_id) || !(TELT_ALS_BESCHIKBAAR as readonly string[]).includes(b.status)) continue
      const m = mw.get(b.personeel_id)
      uit.push({
        id: `b${b.id}`, datum: b.datum, start: kortUur(b.start_tijd), eind: kortUur(b.eind_tijd), laan: b.personeel_id, kleur: kleurVan.get(b.personeel_id) ?? '#9ca3af',
        soort: 'beschikbaar', titel: m?.voornaam ?? 'Beschikbaar', sub: b.opmerking,
        onClick: () => modus === 'beschikbaarheid' ? setBewerk(b) : setInboeken({ datum: b.datum, start: kortUur(b.start_tijd), eind: kortUur(b.eind_tijd), personen: [b.personeel_id] }),
      })
    }
    for (const p of data.planning) {
      if (verborgen.has(p.personeel_id) || p.status === 'geannuleerd') continue
      const bev = bevestigingVan(p)
      uit.push({
        id: `p${p.id}`, datum: p.datum, start: kortUur(p.start_tijd), eind: kortUur(p.eind_tijd), laan: p.personeel_id, kleur: kleurVan.get(p.personeel_id) ?? '#374151',
        soort: 'werkblok', titel: `${mw.get(p.personeel_id)?.voornaam ?? ''} · ${p.taak ?? p.project ?? 'Werkblok'}`, sub: p.locatie,
        status: bev, onClick: () => setBlok(p),
      })
    }
    return uit
  }, [data, verborgen, kleurVan, mw, modus])

  const kies = async (s: WkSelectie) => {
    if (modus === 'beschikbaarheid') {
      if (!voorWie) { toast.error('Kies eerst voor wie je beschikbaarheid invult.'); return }
      try {
        await api('/api/admin/personeel/beschikbaarheid', { body: { personeel_id: voorWie, datum: s.datum, start: s.start, eind: s.eind } })
        toast.success(`${mw.get(voorWie)?.voornaam ?? 'Medewerker'} beschikbaar op ${dagLang(s.datum)}, ${s.start}–${s.eind}.`)
        await laad()
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
      return
    }
    setInboeken({ datum: s.datum, start: s.start, eind: s.eind, personen: s.laan ? [s.laan] : [] })
  }

  const wacht = (data?.planning ?? []).filter((p) => p.status !== 'geannuleerd' && bevestigingVan(p) === 'te_bevestigen').sort((a, b) => (a.datum + a.start_tijd).localeCompare(b.datum + b.start_tijd))
  const nee = (data?.planning ?? []).filter((p) => p.status !== 'geannuleerd' && bevestigingVan(p) === 'geweigerd')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WeekNavigatie maandag={maandag} onMaandag={setMaandag} vandaag={vandaag} />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
            <button type="button" onClick={() => setModus('inboeken')} className={`px-2.5 py-1.5 rounded-md font-medium inline-flex items-center gap-1 ${modus === 'inboeken' ? 'bg-black text-white' : 'text-gray-600'}`}><Users className="h-3.5 w-3.5" />Inboeken</button>
            <button type="button" onClick={() => setModus('beschikbaarheid')} className={`px-2.5 py-1.5 rounded-md font-medium inline-flex items-center gap-1 ${modus === 'beschikbaarheid' ? 'bg-black text-white' : 'text-gray-600'}`}><CalendarPlus className="h-3.5 w-3.5" />Beschikbaarheid invullen</button>
          </div>
          {modus === 'beschikbaarheid' && !personeelId && (
            <select className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" value={voorWie} onChange={(e) => setVoorWie(e.target.value)} aria-label="Voor wie">
              {actief.map((m) => <option key={m.id} value={m.id}>{naamVan(m)}</option>)}
            </select>
          )}
          {modus === 'inboeken' && <button type="button" onClick={() => setInboeken({ datum: vandaag, start: '10:00', eind: '17:00', personen: personeelId ? [personeelId] : [] })} className="btn-primary text-sm"><Plus className="h-4 w-4" />Inboeken</button>}
        </div>
      </div>

      {/* Wie is wie: kleur per persoon (klik op het bolletje om te wijzigen), aan/uit */}
      {!personeelId && actief.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {actief.map((m) => {
            const uit = verborgen.has(m.id)
            const k = kleurVan.get(m.id) ?? '#9ca3af'
            return (
              <span key={m.id} className={`inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2.5 py-0.5 text-xs ${uit ? 'opacity-40' : ''}`} style={{ borderColor: k, background: tint(k, 0.08) }}>
                <label className="relative h-5 w-5 rounded-full cursor-pointer shrink-0" style={{ background: k }} title={`Kleur van ${m.voornaam} wijzigen`}>
                  <input type="color" value={k} onChange={(e) => zetKleur(m.id, e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label={`Kleur van ${m.voornaam}`} />
                </label>
                <button type="button" onClick={() => setVerborgen((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })} className="font-medium">{naamVan(m)}</button>
              </span>
            )
          })}
        </div>
      )}

      <p className="text-xs text-gray-500">
        {modus === 'inboeken'
          ? 'Sleep over een dag om een tijdvak te kiezen (of klik op iemands beschikbaarheid) en boek in wie dan vrij is. Gestreept = wacht op bevestiging.'
          : `Sleep over een dag om beschikbaarheid in te vullen voor ${mw.get(voorWie)?.voornaam ?? '…'}. Klik op een blok om het aan te passen of te verwijderen.`}
      </p>

      {!data ? <div className="py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        : <WeekKalender maandag={maandag} items={items} lanen={actief.map((m) => m.id)} vandaag={vandaag} onSelectie={kies} />}

      {(wacht.length > 0 || nee.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {wacht.length > 0 && (
            <div className="card-base p-3">
              <div className="text-sm font-semibold mb-2">Wacht op bevestiging ({wacht.length})</div>
              <ul className="space-y-1 text-sm">{wacht.map((p) => (
                <li key={p.id}><button type="button" onClick={() => setBlok(p)} className="flex items-center gap-2 w-full text-left hover:bg-gray-50 rounded px-1 py-0.5">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: kleurVan.get(p.personeel_id) }} />
                  <span className="font-medium">{mw.get(p.personeel_id)?.voornaam}</span>
                  <span className="text-gray-600 truncate">{datumNl(p.datum)} {kortUur(p.start_tijd)}–{kortUur(p.eind_tijd)} · {p.taak ?? p.project ?? 'Werkblok'}</span>
                </button></li>
              ))}</ul>
            </div>
          )}
          {nee.length > 0 && (
            <div className="card-base p-3 border-red-100">
              <div className="text-sm font-semibold mb-2 text-red-700">Kan niet ({nee.length})</div>
              <ul className="space-y-1 text-sm">{nee.map((p) => (
                <li key={p.id}><button type="button" onClick={() => setBlok(p)} className="w-full text-left hover:bg-gray-50 rounded px-1 py-0.5">
                  <span className="font-medium">{mw.get(p.personeel_id)?.voornaam}</span> <span className="text-gray-600">{datumNl(p.datum)} {kortUur(p.start_tijd)}–{kortUur(p.eind_tijd)}</span>
                  {p.bevestiging_reden && <span className="block text-xs text-gray-500">“{p.bevestiging_reden}”</span>}
                </button></li>
              ))}</ul>
            </div>
          )}
        </div>
      )}

      {inboeken && data && <InboekDialoog start={inboeken} data={data} actief={actief} kleurVan={kleurVan} onSluit={() => setInboeken(null)} onKlaar={async () => { setInboeken(null); await laad() }} />}
      {bewerk && <BeschikbaarheidDialoog b={bewerk} naam={naamVan(mw.get(bewerk.personeel_id))} onSluit={() => setBewerk(null)} onKlaar={async () => { setBewerk(null); await laad() }} />}
      {blok && data && <WerkblokDialoog w={blok} data={data} onSluit={() => setBlok(null)} onKlaar={async () => { setBlok(null); await laad() }} />}
    </div>
  )
}

const UREN = Array.from({ length: (23 - 6) * 4 + 1 }, (_, i) => { const m = 6 * 60 + i * 15; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })
const tijdOpties = (huidig: string) => (UREN.includes(huidig) ? UREN : [...UREN, huidig].sort())

/**
 * Inboeken: wie is vrij op dit moment? Kies één of meerdere mensen en vul in wat
 * er moet gebeuren. Iedereen krijgt een mail met alle details en bevestigt zelf.
 */
function InboekDialoog({ start, data, actief, kleurVan, onSluit, onKlaar }: { start: Inboeking; data: Data; actief: Mw[]; kleurVan: Map<string, string>; onSluit: () => void; onKlaar: () => void }) {
  const [datum, setDatum] = useState(start.datum)
  const [van, setVan] = useState(start.start)
  const [tot, setTot] = useState(start.eind)
  const [gekozen, setGekozen] = useState<Set<string>>(new Set(start.personen))
  const [v, setV] = useState<Record<string, unknown>>({ prioriteit: 'normaal', thuiswerk: false, links: [] })
  const [bestaandeTaak, setBestaandeTaak] = useState('')
  const [bezig, setBezig] = useState(false)
  const zet = (k: string, x: unknown) => setV((o) => ({ ...o, [k]: x }))

  // Vrij = volledig binnen een eigen beschikbaarheid én geen ander werkblok op dat moment.
  const status = (pid: string): { vrij: boolean; reden: string } => {
    const aanbod = data.beschikbaarheid.filter((b) => b.personeel_id === pid && b.datum === datum)
    if (!binnenBeschikbaarheid({ datum, start_tijd: van, eind_tijd: tot }, aanbod)) {
      const tekst = aanbod.filter((b) => (TELT_ALS_BESCHIKBAAR as readonly string[]).includes(b.status)).map((b) => `${kortUur(b.start_tijd)}–${kortUur(b.eind_tijd)}`).join(', ')
      return { vrij: false, reden: tekst ? `vrij ${tekst}` : 'niet beschikbaar' }
    }
    const bezet = data.planning.find((p) => p.personeel_id === pid && p.datum === datum && p.status !== 'geannuleerd' && bevestigingVan(p) !== 'geweigerd' && kortUur(p.start_tijd) < tot && van < kortUur(p.eind_tijd))
    return bezet ? { vrij: false, reden: `al ingeboekt ${kortUur(bezet.start_tijd)}–${kortUur(bezet.eind_tijd)}` } : { vrij: true, reden: '' }
  }
  const zichtbaar = actief.map((m) => ({ m, ...status(m.id) }))
  const kiesbaar = [...gekozen].filter((id) => zichtbaar.find((x) => x.m.id === id)?.vrij)

  const boekIn = async () => {
    if (!String(v.taak ?? '').trim()) { toast.error('Vul in wat er moet gebeuren.'); return }
    if (!kiesbaar.length) { toast.error('Kies minstens één persoon die op dat moment vrij is.'); return }
    setBezig(true)
    const groep = crypto.randomUUID()
    const ok: string[] = [], mis: string[] = []
    for (const pid of kiesbaar) {
      const naam = actief.find((m) => m.id === pid)?.voornaam ?? 'Medewerker'
      try {
        const r = await api<{ waarschuwing?: string | null }>('/api/admin/personeel/planning', { body: {
          ...v, personeel_id: pid, datum, start_tijd: van, eind_tijd: tot, groep_id: groep,
          ...(bestaandeTaak.trim() ? { clickup_bestaande_taak: bestaandeTaak.trim() } : {}),
        } })
        if (r.waarschuwing) toast.warning(`${naam}: ${r.waarschuwing}`)
        ok.push(naam)
      } catch (e) { mis.push(`${naam}: ${e instanceof Error ? e.message : 'mislukt'}`) }
    }
    setBezig(false)
    if (ok.length) toast.success(`${ok.join(' en ')} ${ok.length === 1 ? 'krijgt' : 'krijgen'} een mail om te bevestigen.`)
    if (mis.length) { mis.forEach((m) => toast.error(m)); if (!ok.length) return }
    onKlaar()
  }

  return (
    <Dialoog titel="Inboeken" onSluit={onSluit} breed>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div><label className={LBL}>Dag</label><input type="date" className={INP} value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
          <div><label className={LBL}>Van</label><select className={INP} value={van} onChange={(e) => setVan(e.target.value)}>{tijdOpties(van).map((u) => <option key={u}>{u}</option>)}</select></div>
          <div><label className={LBL}>Tot</label><select className={INP} value={tot} onChange={(e) => setTot(e.target.value)}>{tijdOpties(tot).map((u) => <option key={u}>{u}</option>)}</select></div>
        </div>

        <div>
          <div className={LBL}>Wie boek je in? <span className="font-normal text-gray-400">— enkel wie op dat moment vrij is</span></div>
          <div className="flex flex-wrap gap-1.5">
            {zichtbaar.map(({ m, vrij, reden }) => {
              const aan = gekozen.has(m.id) && vrij
              const k = kleurVan.get(m.id) ?? '#9ca3af'
              return (
                <button key={m.id} type="button" disabled={!vrij}
                  onClick={() => setGekozen((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-left ${aan ? 'text-white' : 'bg-white'} ${vrij ? '' : 'opacity-50 cursor-not-allowed'}`}
                  style={aan ? { background: k, borderColor: k } : { borderColor: k }}>
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: aan ? '#fff' : k }} />
                  <span className="font-medium">{m.voornaam}</span>
                  {!vrij && <span className="text-[10px]">({reden})</span>}
                </button>
              )
            })}
          </div>
        </div>

        <Details v={v} zet={zet} data={data} />

        <div>
          <label className={LBL}><Link2 className="h-3 w-3 inline mr-1" />Bestaande ClickUp-taak <span className="font-normal text-gray-400">— optioneel, bv. de contentshoot</span></label>
          <input className={INP} value={bestaandeTaak} onChange={(e) => setBestaandeTaak(e.target.value)} placeholder="https://app.clickup.com/t/…" />
          <p className="text-[11px] text-gray-500 mt-1">Zodra iemand bevestigt, wordt die aan deze taak toegevoegd. Leeg = één nieuwe taak in &quot;Planning medewerkers&quot; voor deze inboeking, met iedereen die bevestigt als toegewezene.</p>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button>
          <button type="button" disabled={bezig || !kiesbaar.length} onClick={boekIn} className="btn-primary">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {kiesbaar.length > 1 ? `${kiesbaar.length} mensen inboeken` : 'Inboeken'}
          </button>
        </div>
      </div>
    </Dialoog>
  )
}

/** Beschikbaarheid van een medewerker aanpassen of verwijderen (admin). */
function BeschikbaarheidDialoog({ b, naam, onSluit, onKlaar }: { b: Beschikbaar; naam: string; onSluit: () => void; onKlaar: () => void }) {
  const [start, setStart] = useState(kortUur(b.start_tijd))
  const [eind, setEind] = useState(kortUur(b.eind_tijd))
  const [bezig, setBezig] = useState(false)
  const doe = async (methode: 'PATCH' | 'DELETE') => {
    setBezig(true)
    try {
      await api(`/api/admin/personeel/beschikbaarheid/${b.id}`, methode === 'PATCH' ? { method: 'PATCH', body: { start, eind } } : { method: 'DELETE' })
      toast.success(methode === 'PATCH' ? 'Aangepast.' : 'Verwijderd.'); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel={`Beschikbaarheid — ${naam}`} onSluit={onSluit}>
      <div className="space-y-3">
        <div className="text-sm text-gray-700">{dagLang(b.datum)}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LBL}>Van</label><select className={INP} value={start} onChange={(e) => setStart(e.target.value)}>{tijdOpties(start).map((u) => <option key={u}>{u}</option>)}</select></div>
          <div><label className={LBL}>Tot</label><select className={INP} value={eind} onChange={(e) => setEind(e.target.value)}>{tijdOpties(eind).map((u) => <option key={u}>{u}</option>)}</select></div>
        </div>
        <div className="flex justify-between gap-2">
          <button type="button" disabled={bezig} onClick={() => doe('DELETE')} className="btn-secondary text-red-600"><Trash2 className="h-4 w-4" />Verwijderen</button>
          <button type="button" disabled={bezig} onClick={() => doe('PATCH')} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Opslaan</button>
        </div>
      </div>
    </Dialoog>
  )
}

/** Gedeelde velden: klant, project, taak, briefing, locatie… */
function Details({ v, zet, data }: { v: Record<string, unknown>; zet: (k: string, w: unknown) => void; data: Data }) {
  const opdr = data.opdrachten.filter((o) => !v.client_id || o.client_id === v.client_id)
  const links = (v.links as LinkItem[] | undefined) ?? []
  return (
    <div className="grid grid-cols-2 gap-3">
      <div><label className={LBL}>Klant</label><select className={INP} value={String(v.client_id ?? '')} onChange={(e) => zet('client_id', e.target.value || null)}><option value="">Geen klant</option>{data.klanten.map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}</select></div>
      <div><label className={LBL}>Opdracht (project)</label><select className={INP} value={String(v.opdracht_id ?? '')} onChange={(e) => { const o = data.opdrachten.find((x) => x.id === e.target.value); zet('opdracht_id', e.target.value || null); if (o && !v.project) zet('project', o.titel) }}><option value="">—</option>{opdr.map((o) => <option key={o.id} value={o.id}>{o.titel}</option>)}</select></div>
      <div><label className={LBL}>Project (vrij)</label><input className={INP} value={String(v.project ?? '')} onChange={(e) => zet('project', e.target.value)} /></div>
      <div><label className={LBL}>Wat moet er gebeuren? *</label><input className={INP} value={String(v.taak ?? '')} onChange={(e) => zet('taak', e.target.value)} /></div>
      <div><label className={LBL}>Verwachte duur (min)</label><input type="number" min={0} className={INP} value={String(v.verwachte_duur_min ?? '')} onChange={(e) => zet('verwachte_duur_min', e.target.value)} /></div>
      <div><label className={LBL}>Deadline</label><input type="date" className={INP} value={String(v.deadline ?? '')} onChange={(e) => zet('deadline', e.target.value)} /></div>
      <div><label className={LBL}>Prioriteit</label><select className={INP} value={String(v.prioriteit ?? 'normaal')} onChange={(e) => zet('prioriteit', e.target.value)}>{PRIORITEITEN.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
      <div><label className={LBL}>Locatie</label><div className="flex gap-2 items-center"><input className={INP} value={String(v.locatie ?? '')} onChange={(e) => zet('locatie', e.target.value)} disabled={!!v.thuiswerk} placeholder="bv. kantoor Hasselt" /><label className="text-xs whitespace-nowrap flex items-center gap-1"><input type="checkbox" checked={!!v.thuiswerk} onChange={(e) => zet('thuiswerk', e.target.checked)} />Thuiswerk</label></div></div>
      <div className="col-span-2"><label className={LBL}>Briefing</label><textarea rows={4} className={INP} value={String(v.briefing ?? '')} onChange={(e) => zet('briefing', e.target.value)} /></div>
      <div className="col-span-2"><label className={LBL}>Concrete deliverables</label><textarea rows={2} className={INP} value={String(v.deliverables ?? '')} onChange={(e) => zet('deliverables', e.target.value)} /></div>
      <div className="col-span-2"><label className={LBL}>Links (één per regel)</label><textarea rows={2} className={INP} value={links.map((l) => l.url ?? '').filter(Boolean).join('\n')} onChange={(e) => zet('links', e.target.value.split('\n').map((u) => u.trim()).filter(Boolean).map((u) => ({ naam: u, url: u })))} placeholder="https://drive.google.com/…" /></div>
    </div>
  )
}

function WerkblokDialoog({ w, data, onSluit, onKlaar }: { w: Partial<Werkblok>; data: Data; onSluit: () => void; onKlaar: () => void }) {
  const [v, setV] = useState<Record<string, unknown>>({ ...w })
  const [bezig, setBezig] = useState(false)
  const bestaand = !!w.id
  const zet = (k: string, x: unknown) => setV((o) => ({ ...o, [k]: x }))
  const bewaar = async () => {
    setBezig(true)
    try {
      const body = { ...v, verwachte_duur_min: v.verwachte_duur_min === '' ? null : v.verwachte_duur_min }
      const r = bestaand ? await api<{ waarschuwing?: string | null }>(`/api/admin/personeel/planning/${w.id}`, { method: 'PATCH', body }) : await api<{ waarschuwing?: string | null }>('/api/admin/personeel/planning', { body })
      if (r.waarschuwing) toast.warning(r.waarschuwing)
      toast.success(bestaand ? 'Werkblok bijgewerkt.' : 'Ingepland — de medewerker krijgt een melding.'); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  const annuleer = async () => {
    const reden = prompt('Reden van de annulering (de medewerker ziet dit):') ?? ''
    setBezig(true)
    try { await api(`/api/admin/personeel/planning/${w.id}?reden=${encodeURIComponent(reden)}`, { method: 'DELETE' }); toast.success('Werkblok geannuleerd.'); onKlaar() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  const verwijder = async () => {
    if (!confirm('Dit werkblok definitief verwijderen? Dit kan niet ongedaan gemaakt worden. Gelogde uren blijven bewaard.')) return
    setBezig(true)
    try { await api(`/api/admin/personeel/planning/${w.id}?definitief=1`, { method: 'DELETE' }); toast.success('Werkblok verwijderd.'); onKlaar() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  const naarClickup = async () => {
    setBezig(true)
    try {
      const r = await api<{ status: string; toegewezen: string | null }>(`/api/admin/personeel/planning/${w.id}`, { body: { actie: 'clickup' } })
      toast.success(r.status === 'toegewezen' ? `In ClickUp, toegewezen aan ${r.toegewezen}.` : 'In ClickUp gezet, zonder toegewezen persoon (niet gevonden in de werkruimte).'); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  // Wanneer is deze medewerker vrij? De komende 6 weken, om aan te klikken.
  const [vrij, setVrij] = useState<Beschikbaar[] | null>(null)
  const pid = String(v.personeel_id ?? '')
  useEffect(() => {
    if (bestaand || !pid) { setVrij(null); return }
    const van = vandaagBE(), tot = new Date(Date.now() + 42 * 86400000).toISOString().slice(0, 10)
    let weg = false
    api<Data>(`/api/admin/personeel/planning?van=${van}&tot=${tot}&personeel_id=${pid}`)
      .then((d) => { if (!weg) setVrij(d.beschikbaarheid.filter((b) => (TELT_ALS_BESCHIKBAAR as readonly string[]).includes(b.status))) })
      .catch(() => { if (!weg) setVrij([]) })
    return () => { weg = true }
  }, [pid, bestaand])
  const bev = bevestigingVan(w)
  return (
    <Dialoog titel={bestaand ? 'Werkblok' : 'Medewerker inplannen'} onSluit={onSluit} breed>
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2 sm:col-span-1"><label className={LBL}>Medewerker *</label><select className={INP} value={String(v.personeel_id ?? '')} onChange={(e) => zet('personeel_id', e.target.value)} disabled={bestaand}><option value="">Kies…</option>{data.medewerkers.filter((m) => m.actief || m.id === v.personeel_id).map((m) => <option key={m.id} value={m.id}>{naamVan(m)}</option>)}</select></div>
          <div><label className={LBL}>Datum *</label><input type="date" className={INP} value={String(v.datum ?? '')} onChange={(e) => zet('datum', e.target.value)} /></div>
          <div><label className={LBL}>Van *</label><input type="time" className={INP} value={kortUur(String(v.start_tijd ?? ''))} onChange={(e) => zet('start_tijd', e.target.value)} /></div>
          <div><label className={LBL}>Tot *</label><input type="time" className={INP} value={kortUur(String(v.eind_tijd ?? ''))} onChange={(e) => zet('eind_tijd', e.target.value)} /></div>
        </div>
        {!bestaand && pid && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
            <div className="text-xs font-semibold text-gray-600 mb-1.5 flex items-center gap-1"><CalendarCheck className="h-3.5 w-3.5" />Wanneer is {naamVan(data.medewerkers.find((m) => m.id === pid)).split(' ')[0]} vrij?</div>
            {vrij === null ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              : vrij.length === 0 ? <div className="text-xs text-amber-800">Geen beschikbaarheid opgegeven voor de komende weken. Inplannen kan pas wanneer de medewerker aangeeft vrij te zijn.</div>
              : <div className="flex flex-wrap gap-1.5">{vrij.map((b) => {
                  const actief = v.datum === b.datum && kortUur(String(v.start_tijd ?? '')) >= kortUur(b.start_tijd) && kortUur(String(v.eind_tijd ?? '')) <= kortUur(b.eind_tijd)
                  return <button key={b.id} type="button" onClick={() => setV((o) => ({ ...o, datum: b.datum, start_tijd: kortUur(b.start_tijd), eind_tijd: kortUur(b.eind_tijd) }))} className={`rounded-full border px-2.5 py-1 text-xs ${actief ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:border-gray-400'}`}>{datumNl(b.datum)} · {kortUur(b.start_tijd)}–{kortUur(b.eind_tijd)}{b.status !== 'ingediend' ? ' (deels ingepland)' : ''}</button>
                })}</div>}
            <div className="text-[11px] text-gray-500 mt-1.5">Kies een moment; je kunt de uren daarna binnen dat venster inkorten. De medewerker krijgt een e-mail en bevestigt in de app — pas dan komt het in ClickUp.</div>
          </div>
        )}
        {bestaand && w.status !== 'geannuleerd' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Chip cls={BEVESTIGING_INFO[bev].kleur}>{BEVESTIGING_INFO[bev].label}</Chip>
            {bev === 'geweigerd' && w.bevestiging_reden && <span className="text-gray-600">“{w.bevestiging_reden}”</span>}
            {bev === 'bevestigd' && (
              w.clickup_status === 'toegewezen' ? <Chip cls="bg-green-50 text-green-800 border-green-200">ClickUp · {w.clickup_toegewezen}</Chip>
              : w.clickup_status === 'zonder_toegewezene' ? <Chip cls="bg-gray-50 text-gray-700 border-gray-200">ClickUp · niemand toegewezen</Chip>
              : w.clickup_status === 'fout' ? <Chip cls="bg-red-50 text-red-700 border-red-200">ClickUp mislukt{w.clickup_fout ? `: ${w.clickup_fout.slice(0, 80)}` : ''}</Chip>
              : <Chip cls="bg-gray-50 text-gray-600 border-gray-200">Nog niet in ClickUp</Chip>
            )}
            {bev === 'bevestigd' && w.clickup_status !== 'toegewezen' && <button type="button" disabled={bezig} onClick={naarClickup} className="btn-secondary text-xs"><RefreshCw className="h-3.5 w-3.5" />{w.clickup_task_id ? 'Opnieuw toewijzen in ClickUp' : 'Naar ClickUp'}</button>}
          </div>
        )}
        <Details v={v} zet={zet} data={data} />
        {bestaand && (
          <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
            <div><label className={LBL}>Status</label><select className={INP} value={String(v.werkstatus ?? 'nog_te_starten')} onChange={(e) => zet('werkstatus', e.target.value)}>{(Object.keys(WERKSTATUS) as Werkstatus[]).map((s) => <option key={s} value={s}>{WERKSTATUS[s].label}</option>)}</select></div>
            <div><div className={LBL}>Voortgang van de medewerker</div><div className="text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-2 min-h-[38px]">{w.voortgang || '—'}</div></div>
          </div>
        )}
        {w.status === 'geannuleerd' && <div className="text-xs text-red-700">Dit werkblok is geannuleerd.</div>}
        <div className="flex justify-between gap-2 pt-1">
          {bestaand ? (
            <div className="flex gap-2">
              {w.status !== 'geannuleerd' && <button type="button" disabled={bezig} onClick={annuleer} className="btn-secondary text-red-600"><Ban className="h-4 w-4" />Annuleren</button>}
              <button type="button" disabled={bezig} onClick={verwijder} className="btn-secondary text-red-600" title="Definitief verwijderen"><Trash2 className="h-4 w-4" /><span className="hidden sm:inline">Verwijderen</span></button>
            </div>
          ) : <span />}
          <div className="flex gap-2"><button type="button" onClick={onSluit} className="btn-secondary">Sluiten</button><button type="button" disabled={bezig || !v.personeel_id} onClick={bewaar} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{bestaand ? 'Bewaren' : 'Inplannen'}</button></div>
        </div>
      </div>
    </Dialoog>
  )
}

