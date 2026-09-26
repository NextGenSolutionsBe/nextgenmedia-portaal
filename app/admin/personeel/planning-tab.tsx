'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Check, X, Clock, Ban, Trash2, RefreshCw, CalendarCheck } from 'lucide-react'
import { Dialoog } from '@/app/admin/instellingen/ui'
import { Kalender, kalenderBereik, sessieSoort, beschikbaarheidSoort, type KalItem, type Weergave } from '@/components/personeel/kalender'
import { api, Chip, datumNl, kortUur, uurNl, dagVanIso, vandaagBE, INP, LBL, type LinkItem } from '@/components/personeel/ui'
import { WERKSTATUS, PRIORITEITEN, type BeschikbaarheidStatus, type Werkstatus } from '@/lib/personeel/model'
import { bevestigingVan, BEVESTIGING_INFO, TELT_ALS_BESCHIKBAAR } from '@/lib/personeel/planning'

type Mw = { id: string; voornaam: string; achternaam: string | null; actief: boolean }
type Beschikbaar = { id: string; personeel_id: string; datum: string; start_tijd: string; eind_tijd: string; opmerking: string | null; status: BeschikbaarheidStatus; voorstel_start: string | null; voorstel_eind: string | null }
type Werkblok = {
  id: string; personeel_id: string; datum: string; start_tijd: string; eind_tijd: string; client_id: string | null; opdracht_id: string | null; project: string | null; taak: string | null
  verwachte_duur_min: number | null; deadline: string | null; prioriteit: string | null; briefing: string | null; links: LinkItem[]; deliverables: string | null; locatie: string | null; thuiswerk: boolean
  status: string; werkstatus: Werkstatus; voortgang: string | null
  bevestiging: string | null; bevestiging_reden: string | null; clickup_task_id: string | null; clickup_status: string | null; clickup_toegewezen: string | null; clickup_fout: string | null
}
type Data = {
  planning: Werkblok[]; beschikbaarheid: Beschikbaar[]; sessies: { id: string; personeel_id: string; start_at: string; eind_at: string | null; status: string; taak: string | null; project: string | null }[]
  medewerkers: Mw[]; klanten: { id: string; company_name: string }[]; opdrachten: { id: string; titel: string; client_id: string | null }[]
}
const naamVan = (m?: Mw) => (m ? [m.voornaam, m.achternaam].filter(Boolean).join(' ') : '—')

/** Planning voor admins: alle kalenders, beschikbaarheden behandelen en rechtstreeks inplannen. */
export function PlanningTab({ personeelId }: { personeelId?: string }) {
  const [weergave, setWeergave] = useState<Weergave>('week')
  const [anker, setAnker] = useState(vandaagBE())
  const [filter, setFilter] = useState(personeelId ?? '')
  const [data, setData] = useState<Data | null>(null)
  const [beslis, setBeslis] = useState<Beschikbaar | null>(null)
  const [blok, setBlok] = useState<Partial<Werkblok> | null>(null)

  const bereik = kalenderBereik(weergave, anker)
  const laad = useCallback(async () => {
    const q = new URLSearchParams({ van: bereik.van, tot: bereik.tot, ...(filter ? { personeel_id: filter } : {}) })
    try { setData(await api<Data>(`/api/admin/personeel/planning?${q}`)) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [bereik.van, bereik.tot, filter])
  useEffect(() => { laad() }, [laad])

  const mw = useMemo(() => new Map((data?.medewerkers ?? []).map((m) => [m.id, m])), [data])
  const kort = (pid: string) => (filter ? '' : `${mw.get(pid)?.voornaam ?? ''} · `)
  const items = useMemo<KalItem[]>(() => {
    if (!data) return []
    const uit: KalItem[] = []
    for (const p of data.planning) uit.push({ id: `p${p.id}`, datum: p.datum, start: kortUur(p.start_tijd), eind: kortUur(p.eind_tijd), titel: `${kort(p.personeel_id)}${p.taak ?? p.project ?? 'Werkblok'}`, sub: WERKSTATUS[p.werkstatus]?.label, soort: p.status === 'geannuleerd' || bevestigingVan(p) === 'geweigerd' ? 'planning_afgewezen' : bevestigingVan(p) === 'te_bevestigen' ? 'planning_te_bevestigen' : 'planning', onClick: () => setBlok(p) })
    for (const b of data.beschikbaarheid) { const s = beschikbaarheidSoort(b.status); if (s) uit.push({ id: `b${b.id}`, datum: b.datum, start: kortUur(b.start_tijd), eind: kortUur(b.eind_tijd), titel: `${kort(b.personeel_id)}beschikbaar`, sub: b.opmerking, soort: s, onClick: b.status === 'ingediend' ? () => setBeslis(b) : (TELT_ALS_BESCHIKBAAR as readonly string[]).includes(b.status) ? () => setBlok({ personeel_id: b.personeel_id, datum: b.datum, start_tijd: kortUur(b.start_tijd), eind_tijd: kortUur(b.eind_tijd), prioriteit: 'normaal', thuiswerk: false, links: [] }) : undefined }) }
    for (const s of data.sessies) uit.push({ id: `s${s.id}`, datum: dagVanIso(s.start_at), start: uurNl(s.start_at), eind: s.eind_at ? uurNl(s.eind_at) : '…', titel: `${kort(s.personeel_id)}${s.taak ?? s.project ?? 'sessie'}`, soort: sessieSoort(s.status) })
    return uit
  }, [data, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (data?.beschikbaarheid ?? []).filter((b) => b.status === 'ingediend').sort((a, b) => a.datum.localeCompare(b.datum))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!personeelId && <select className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Alle medewerkers</option>{(data?.medewerkers ?? []).filter((m) => m.actief).map((m) => <option key={m.id} value={m.id}>{naamVan(m)}</option>)}</select>}
        <button type="button" onClick={() => setBlok({ personeel_id: filter || undefined, datum: anker, start_tijd: '10:00', eind_tijd: '17:00', prioriteit: 'normaal', thuiswerk: false, links: [] })} className="btn-primary text-sm ml-auto"><Plus className="h-4 w-4" />Inplannen</button>
      </div>

      {open.length > 0 && (
        <div className="card-base p-3 border-amber-200 bg-amber-50/40">
          <div className="text-sm font-semibold text-amber-900 mb-2">Beschikbaarheden te behandelen ({open.length})</div>
          <div className="space-y-1.5">
            {open.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2 bg-white rounded-lg border border-amber-100 px-3 py-2 text-sm">
                <span className="font-medium">{naamVan(mw.get(b.personeel_id))}</span>
                <span>{datumNl(b.datum)} · {kortUur(b.start_tijd)}–{kortUur(b.eind_tijd)}</span>
                {b.opmerking && <span className="text-xs text-gray-500">“{b.opmerking}”</span>}
                {b.voorstel_start && <Chip cls="bg-blue-50 text-blue-800 border-blue-200" klein>Voorstel {kortUur(b.voorstel_start)}–{kortUur(b.voorstel_eind)} verstuurd</Chip>}
                <button type="button" onClick={() => setBeslis(b)} className="btn-secondary text-xs ml-auto">Behandelen</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!data ? <div className="py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        : <Kalender items={items} weergave={weergave} anker={anker} onWeergave={setWeergave} onAnker={setAnker} />}

      {beslis && data && <BeslisDialoog b={beslis} naam={naamVan(mw.get(beslis.personeel_id))} data={data} onSluit={() => setBeslis(null)} onKlaar={async () => { setBeslis(null); await laad() }} />}
      {blok && data && <WerkblokDialoog w={blok} data={data} onSluit={() => setBlok(null)} onKlaar={async () => { setBlok(null); await laad() }} />}
    </div>
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
      <div><label className={LBL}>Taak</label><input className={INP} value={String(v.taak ?? '')} onChange={(e) => zet('taak', e.target.value)} /></div>
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

function BeslisDialoog({ b, naam, data, onSluit, onKlaar }: { b: Beschikbaar; naam: string; data: Data; onSluit: () => void; onKlaar: () => void }) {
  const [soort, setSoort] = useState<'goedkeuren' | 'gedeeltelijk' | 'afwijzen' | 'voorstel'>('goedkeuren')
  const [start, setStart] = useState(kortUur(b.start_tijd)), [eind, setEind] = useState(kortUur(b.eind_tijd))
  const [reden, setReden] = useState('')
  const [v, setV] = useState<Record<string, unknown>>({ prioriteit: 'normaal', thuiswerk: false, links: [] })
  const [bezig, setBezig] = useState(false)
  const verstuur = async () => {
    setBezig(true)
    try {
      const r = await api<{ waarschuwing?: string | null }>(`/api/admin/personeel/beschikbaarheid/${b.id}`, { body: { soort, start, eind, reden, ...(soort === 'goedkeuren' || soort === 'gedeeltelijk' ? v : {}) } })
      if (r.waarschuwing) toast.warning(r.waarschuwing)
      toast.success({ goedkeuren: 'Goedgekeurd en ingepland.', gedeeltelijk: 'Deels goedgekeurd en ingepland.', afwijzen: 'Afgewezen.', voorstel: 'Voorstel verstuurd.' }[soort]); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel={`Beschikbaarheid — ${naam}`} onSluit={onSluit} breed>
      <div className="space-y-3">
        <div className="text-sm">{datumNl(b.datum)} · beschikbaar van <b>{kortUur(b.start_tijd)}</b> tot <b>{kortUur(b.eind_tijd)}</b>{b.opmerking ? <span className="text-gray-500"> — “{b.opmerking}”</span> : null}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([['goedkeuren', 'Volledig goedkeuren', Check], ['gedeeltelijk', 'Deel goedkeuren', Clock], ['voorstel', 'Andere uren voorstellen', Clock], ['afwijzen', 'Afwijzen', X]] as const).map(([k, l, Icon]) => (
            <button key={k} type="button" onClick={() => setSoort(k)} className={`rounded-lg border px-2 py-2 text-xs font-medium flex items-center justify-center gap-1 ${soort === k ? 'border-black bg-gray-900 text-white' : 'border-gray-200 hover:bg-gray-50'}`}><Icon className="h-3.5 w-3.5" />{l}</button>
          ))}
        </div>
        {(soort === 'gedeeltelijk' || soort === 'voorstel') && (
          <div className="grid grid-cols-2 gap-2"><div><label className={LBL}>Van</label><input type="time" className={INP} value={start} onChange={(e) => setStart(e.target.value)} /></div><div><label className={LBL}>Tot</label><input type="time" className={INP} value={eind} onChange={(e) => setEind(e.target.value)} /></div></div>
        )}
        {(soort === 'goedkeuren' || soort === 'gedeeltelijk') && <><div className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1">Werkblok</div><Details v={v} zet={(k, w) => setV((x) => ({ ...x, [k]: w }))} data={data} /></>}
        <div><label className={LBL}>{soort === 'afwijzen' ? 'Reden (zichtbaar voor de medewerker)' : 'Bericht voor de medewerker (optioneel)'}</label><input className={INP} value={reden} onChange={(e) => setReden(e.target.value)} /></div>
        <div className="flex justify-end gap-2"><button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button><button type="button" disabled={bezig} onClick={verstuur} className={soort === 'afwijzen' ? 'btn-danger' : 'btn-primary'}>{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bevestigen</button></div>
      </div>
    </Dialoog>
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

