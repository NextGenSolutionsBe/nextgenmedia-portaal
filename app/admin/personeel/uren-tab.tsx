'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Check, X, MessageSquareWarning, Pencil, Plus, RotateCcw, Square, ChevronDown, StickyNote, Trash2 } from 'lucide-react'
import { Dialoog } from '@/app/admin/instellingen/ui'
import { api, Chip, datumNl, uurNl, duur, dagVanIso, euro, naarLokaal, vanLokaal, INP, LBL, LinksLijst, type LinkItem } from '@/components/personeel/ui'
import { SESSIE_STATUS, type SessieStatus } from '@/lib/personeel/model'

type Pauze = { start: string; eind: string | null }
type Sessie = {
  id: string; personeel_id: string; medewerker: string; start_at: string; eind_at: string | null; pauzes: Pauze[]; status: SessieStatus
  project: string | null; taak: string | null; klant: string | null; client_id: string | null; verslag: Record<string, string | null>; links: LinkItem[]
  admin_opmerking: string | null; correctie_vraag: string | null; beoordeeld_door: string | null; beoordeeld_op: string | null; minuten: number
  kost_bedrag?: number | null; kost_per_uur?: number | null; bron?: string; opdracht_id?: string | null
}
type Actie = 'goedkeuren' | 'afkeuren' | 'correctie' | 'corrigeren' | 'heropenen' | 'stoppen' | 'opmerking' | 'verwijderen'

const VERSLAG: [string, string][] = [['project', 'Project'], ['taak', 'Taak'], ['content', "Video's/content"], ['goed', 'Wat ging goed'], ['mis', 'Wat liep mis'], ['todo', 'Nog te doen'], ['blokkades', 'Blokkades/vragen']]

/** Urencontrole: bekijken, corrigeren (met reden), goedkeuren, afkeuren of een correctie vragen. */
export function UrenTab({ personeelId }: { personeelId?: string }) {
  const [status, setStatus] = useState('open')
  const [lijst, setLijst] = useState<Sessie[] | null>(null)
  const [fin, setFin] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [dialoog, setDialoog] = useState<{ actie: Actie; s: Sessie } | null>(null)
  const [nieuw, setNieuw] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)

  const laad = useCallback(async () => {
    const q = new URLSearchParams({ ...(status ? { status } : {}), ...(personeelId ? { personeel_id: personeelId } : {}) })
    try { const j = await api<{ sessies: Sessie[]; magFinancieel: boolean }>(`/api/admin/personeel/sessies?${q}`); setLijst(j.sessies); setFin(j.magFinancieel) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [status, personeelId])
  useEffect(() => { laad() }, [laad])

  const snel = async (s: Sessie) => {
    setBezig(s.id)
    try {
      const r = await api<{ zonderTarief?: boolean }>(`/api/admin/personeel/sessies/${s.id}`, { body: { actie: 'goedkeuren' } })
      toast.success(r.zonderTarief ? 'Goedgekeurd — let op: nog geen tarief, kost telt aan € 0.' : 'Goedgekeurd en geboekt.')
      await laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 overflow-x-auto">
          {[['open', 'Te behandelen'], ['ingediend', 'Ingediend'], ['correctie_gevraagd', 'Correctie gevraagd'], ['goedgekeurd', 'Goedgekeurd'], ['afgekeurd', 'Afgekeurd'], ['', 'Alles']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setStatus(k)} className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap ${status === k ? 'bg-black text-white' : 'text-gray-600 hover:bg-white'}`}>{l}</button>
          ))}
        </div>
        <button type="button" onClick={() => setNieuw(true)} className="btn-secondary text-xs ml-auto"><Plus className="h-3.5 w-3.5" />Uren registreren</button>
      </div>

      {lijst === null ? <div className="py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        : lijst.length === 0 ? <div className="card-base text-center py-10 text-sm text-gray-400">Geen urenregistraties voor deze selectie.</div> : (
          <div className="space-y-2">
            {lijst.map((s) => {
              const st = SESSIE_STATUS[s.status]
              return (
                <div key={s.id} className="card-base p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="flex-1 min-w-[220px] text-left">
                      <div className="text-sm font-semibold">{!personeelId && `${s.medewerker} · `}{datumNl(dagVanIso(s.start_at))} {uurNl(s.start_at)}–{s.eind_at ? uurNl(s.eind_at) : 'loopt'} <span className="text-gray-500 font-normal">({duur(s.minuten)})</span></div>
                      <div className="text-xs text-gray-500">{[s.klant, s.project, s.taak].filter(Boolean).join(' · ') || 'Geen project'}{(s.pauzes ?? []).length ? ` · ${(s.pauzes ?? []).length} pauze${s.pauzes.length === 1 ? '' : 's'}` : ''}{s.bron === 'admin' ? ' · manueel geregistreerd' : ''}</div>
                    </button>
                    {fin && s.status === 'goedgekeurd' && <span className="text-xs text-gray-600 tabular-nums">{euro(s.kost_bedrag ?? 0)}</span>}
                    <Chip cls={st.chip}>{st.label}</Chip>
                    <div className="flex gap-1">
                      {['ingediend', 'correctie_gevraagd', 'afgekeurd'].includes(s.status) && s.eind_at && <button type="button" disabled={bezig === s.id} onClick={() => snel(s)} className="btn-primary text-xs h-7 px-2" title="Goedkeuren">{bezig === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Goedkeuren</button>}
                      {s.status === 'actief' && <button type="button" onClick={() => setDialoog({ actie: 'stoppen', s })} className="btn-secondary text-xs h-7 px-2" title="Vergeten sessie afsluiten"><Square className="h-3 w-3" />Afsluiten</button>}
                      <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="btn-secondary text-xs h-7 px-2" aria-label="Details"><ChevronDown className={`h-3 w-3 transition-transform ${open === s.id ? 'rotate-180' : ''}`} /></button>
                    </div>
                  </div>
                  {s.correctie_vraag && s.status === 'correctie_gevraagd' && <div className="mt-2 text-xs rounded bg-orange-50 text-orange-900 px-2 py-1">Gevraagde correctie: {s.correctie_vraag}</div>}
                  {open === s.id && (
                    <div className="mt-3 border-t border-gray-100 pt-3 grid md:grid-cols-2 gap-4 text-sm">
                      <div className="space-y-1.5">
                        {VERSLAG.filter(([k]) => s.verslag?.[k]).map(([k, l]) => <div key={k}><div className="text-[11px] text-gray-500">{l}</div><div className="whitespace-pre-wrap">{s.verslag[k]}</div></div>)}
                        {!VERSLAG.some(([k]) => s.verslag?.[k]) && <div className="text-xs text-gray-400">Geen werkverslag.</div>}
                        <LinksLijst links={s.links} bestandUrl={(p) => `/api/admin/personeel/bestand?pad=${encodeURIComponent(p)}`} />
                      </div>
                      <div className="space-y-2">
                        {(s.pauzes ?? []).length > 0 && <div className="text-xs text-gray-600">Pauzes: {s.pauzes.map((p) => `${uurNl(p.start)}–${p.eind ? uurNl(p.eind) : '…'}`).join(', ')}</div>}
                        {s.admin_opmerking && <div className="text-xs rounded bg-gray-50 px-2 py-1"><StickyNote className="h-3 w-3 inline -mt-0.5 mr-1" />{s.admin_opmerking}</div>}
                        {s.beoordeeld_door && <div className="text-[11px] text-gray-400">Beoordeeld door {s.beoordeeld_door}{s.beoordeeld_op ? ` op ${datumNl(dagVanIso(s.beoordeeld_op))}` : ''}</div>}
                        {fin && s.status === 'goedgekeurd' && <div className="text-[11px] text-gray-500">Vastgelegde kostprijs: {euro(s.kost_per_uur ?? 0)}/u → {euro(s.kost_bedrag ?? 0)}</div>}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {s.status !== 'actief' && <button type="button" onClick={() => setDialoog({ actie: 'corrigeren', s })} className="btn-secondary text-xs"><Pencil className="h-3 w-3" />Corrigeren</button>}
                          {['ingediend', 'goedgekeurd', 'afgekeurd'].includes(s.status) && <button type="button" onClick={() => setDialoog({ actie: 'correctie', s })} className="btn-secondary text-xs"><MessageSquareWarning className="h-3 w-3" />Correctie vragen</button>}
                          {!['afgekeurd', 'actief'].includes(s.status) && <button type="button" onClick={() => setDialoog({ actie: 'afkeuren', s })} className="btn-secondary text-xs text-red-600"><X className="h-3 w-3" />Afkeuren</button>}
                          {s.status === 'goedgekeurd' && <button type="button" onClick={() => setDialoog({ actie: 'heropenen', s })} className="btn-secondary text-xs"><RotateCcw className="h-3 w-3" />Goedkeuring terugdraaien</button>}
                          <button type="button" onClick={() => setDialoog({ actie: 'opmerking', s })} className="btn-secondary text-xs"><StickyNote className="h-3 w-3" />Interne opmerking</button>
                          <button type="button" onClick={() => setDialoog({ actie: 'verwijderen', s })} className="btn-secondary text-xs text-red-600"><Trash2 className="h-3 w-3" />Verwijderen</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      {dialoog && <ActieDialoog actie={dialoog.actie} s={dialoog.s} onSluit={() => setDialoog(null)} onKlaar={async () => { setDialoog(null); await laad() }} />}
      {nieuw && <NieuweSessie personeelId={personeelId} onSluit={() => setNieuw(false)} onKlaar={async () => { setNieuw(false); await laad() }} />}
    </div>
  )
}

function ActieDialoog({ actie, s, onSluit, onKlaar }: { actie: Actie; s: Sessie; onSluit: () => void; onKlaar: () => void }) {
  const [reden, setReden] = useState(actie === 'opmerking' ? s.admin_opmerking ?? '' : '')
  const [start, setStart] = useState(naarLokaal(s.start_at))
  const [eind, setEind] = useState(naarLokaal(s.eind_at ?? new Date().toISOString()))
  const [pauzes, setPauzes] = useState((s.pauzes ?? []).map((p) => ({ start: naarLokaal(p.start), eind: naarLokaal(p.eind ?? s.eind_at ?? new Date().toISOString()) })))
  const [project, setProject] = useState(s.project ?? '')
  const [taak, setTaak] = useState(s.taak ?? '')
  const [klant, setKlant] = useState(s.client_id ?? '')
  const [opdracht, setOpdracht] = useState(s.opdracht_id ?? '')
  const [keuzes, setKeuzes] = useState<{ klanten: { id: string; company_name: string }[]; opdrachten: { id: string; titel: string; client_id: string | null }[] } | null>(null)
  useEffect(() => {
    if (actie !== 'corrigeren') return
    const d = dagVanIso(s.start_at)
    api<{ klanten: { id: string; company_name: string }[]; opdrachten: { id: string; titel: string; client_id: string | null }[] }>(`/api/admin/personeel/planning?van=${d}&tot=${d}&personeel_id=${s.personeel_id}`)
      .then((r) => setKeuzes({ klanten: r.klanten, opdrachten: r.opdrachten })).catch(() => setKeuzes({ klanten: [], opdrachten: [] }))
  }, [actie, s.start_at, s.personeel_id])
  const [bezig, setBezig] = useState(false)
  const titel = { goedkeuren: 'Goedkeuren', afkeuren: 'Uren afkeuren', correctie: 'Correctie vragen aan de medewerker', corrigeren: 'Sessie corrigeren', heropenen: 'Goedkeuring terugdraaien', stoppen: 'Vergeten sessie afsluiten', opmerking: 'Interne opmerking', verwijderen: 'Uren verwijderen' }[actie]
  const verplicht = actie !== 'opmerking'
  const verstuur = async () => {
    if (verplicht && !reden.trim()) { toast.error(actie === 'correctie' ? 'Schrijf wat er aangepast moet worden.' : 'Geef een reden.'); return }
    setBezig(true)
    if (actie === 'verwijderen') {
      try {
        await api(`/api/admin/personeel/sessies/${s.id}?reden=${encodeURIComponent(reden)}`, { method: 'DELETE' })
        toast.success(s.status === 'goedgekeurd' ? 'Uren verwijderd — de kost in Financiën is herberekend.' : 'Uren verwijderd.'); onKlaar()
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
      return
    }
    try {
      const body: Record<string, unknown> = { actie, reden, vraag: reden, opmerking: reden }
      if (actie === 'corrigeren') {
        body.start_at = vanLokaal(start); body.eind_at = vanLokaal(eind); body.project = project; body.taak = taak
        if (keuzes) { body.client_id = klant || null; body.opdracht_id = opdracht || null }
        body.pauzes = pauzes.map((p) => ({ start: vanLokaal(p.start), eind: vanLokaal(p.eind) }))
      }
      if (actie === 'stoppen') body.eind_at = vanLokaal(eind)
      await api(`/api/admin/personeel/sessies/${s.id}`, { body })
      toast.success('Bewaard — de wijziging staat in het logboek.'); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel={titel} onSluit={onSluit} breed={actie === 'corrigeren'}>
      <div className="space-y-3">
        <div className="text-xs text-gray-500">{s.medewerker} · {datumNl(dagVanIso(s.start_at))} {uurNl(s.start_at)}–{s.eind_at ? uurNl(s.eind_at) : 'loopt'}</div>
        {actie === 'corrigeren' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={LBL}>Begin</label><input type="datetime-local" className={INP} value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div><label className={LBL}>Einde</label><input type="datetime-local" className={INP} value={eind} onChange={(e) => setEind(e.target.value)} /></div>
              <div><label className={LBL}>Project</label><input className={INP} value={project} onChange={(e) => setProject(e.target.value)} /></div>
              <div><label className={LBL}>Taak</label><input className={INP} value={taak} onChange={(e) => setTaak(e.target.value)} /></div>
              <div><label className={LBL}>Klant</label><select className={INP} value={klant} disabled={!keuzes} onChange={(e) => { setKlant(e.target.value); setOpdracht('') }}><option value="">Geen klant</option>{(keuzes?.klanten ?? []).map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}</select></div>
              <div><label className={LBL}>Opdracht</label><select className={INP} value={opdracht} disabled={!keuzes} onChange={(e) => setOpdracht(e.target.value)}><option value="">—</option>{(keuzes?.opdrachten ?? []).filter((o) => !klant || o.client_id === klant).map((o) => <option key={o.id} value={o.id}>{o.titel}</option>)}</select></div>
            </div>
            <div className="space-y-1.5">
              <div className={LBL}>Pauzes</div>
              {pauzes.map((p, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input type="datetime-local" className={INP} value={p.start} onChange={(e) => setPauzes((l) => l.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                  <input type="datetime-local" className={INP} value={p.eind} onChange={(e) => setPauzes((l) => l.map((x, j) => (j === i ? { ...x, eind: e.target.value } : x)))} />
                  <button type="button" onClick={() => setPauzes((l) => l.filter((_, j) => j !== i))} className="h-9 w-9 shrink-0 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 flex items-center justify-center"><X className="h-4 w-4" /></button>
                </div>
              ))}
              <button type="button" onClick={() => setPauzes((l) => [...l, { start, eind: start }])} className="btn-secondary text-xs"><Plus className="h-3 w-3" />Pauze</button>
            </div>
          </>
        )}
        {actie === 'stoppen' && <div><label className={LBL}>Einduur</label><input type="datetime-local" className={INP} value={eind} onChange={(e) => setEind(e.target.value)} /></div>}
        <div><label className={LBL}>{actie === 'correctie' ? 'Wat moet de medewerker aanpassen? *' : actie === 'opmerking' ? 'Opmerking (nooit zichtbaar voor de medewerker)' : 'Reden *'}</label><textarea rows={3} className={INP} value={reden} onChange={(e) => setReden(e.target.value)} /></div>
        {actie === 'verwijderen' && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">Deze registratie ({duur(s.minuten)}) wordt definitief verwijderd. {s.status === 'goedgekeurd' ? 'Ze was goedgekeurd: de personeelskost van die maand in Financiën wordt meteen herberekend.' : 'Ze telde nog niet mee in de kosten.'} De medewerker krijgt een melding; alles blijft in het logboek.</p>}
        {actie !== 'opmerking' && actie !== 'verwijderen' && <p className="text-[11px] text-gray-500">De oorspronkelijke en nieuwe waarden, de reden, het tijdstip en jouw naam komen in het logboek.{actie === 'corrigeren' || actie === 'heropenen' || actie === 'afkeuren' ? ' Was de sessie goedgekeurd, dan wordt de kost in Financiën automatisch gecorrigeerd (met een nieuwe versie).' : ''}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button><button type="button" disabled={bezig} onClick={verstuur} className={actie === 'afkeuren' || actie === 'verwijderen' ? 'btn-danger' : 'btn-primary'}>{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{actie === 'verwijderen' ? 'Definitief verwijderen' : 'Bevestigen'}</button></div>
      </div>
    </Dialoog>
  )
}

function NieuweSessie({ personeelId, onSluit, onKlaar }: { personeelId?: string; onSluit: () => void; onKlaar: () => void }) {
  const [mensen, setMensen] = useState<{ id: string; voornaam: string; achternaam: string | null }[]>([])
  const [f, setF] = useState({ personeel_id: personeelId ?? '', start: '', eind: '', project: '', taak: '', reden: '' })
  const [bezig, setBezig] = useState(false)
  useEffect(() => { if (!personeelId) api<{ medewerkers: { id: string; voornaam: string; achternaam: string | null }[] }>('/api/admin/personeel/planning').then((j) => setMensen(j.medewerkers)).catch(() => {}) }, [personeelId])
  const bewaar = async () => {
    setBezig(true)
    try { await api('/api/admin/personeel/sessies', { body: { personeel_id: f.personeel_id, start_at: vanLokaal(f.start), eind_at: vanLokaal(f.eind), project: f.project, taak: f.taak, reden: f.reden } }); toast.success('Uren geregistreerd (status: ingediend).'); onKlaar() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel="Uren registreren" onSluit={onSluit}>
      <div className="grid grid-cols-2 gap-3">
        {!personeelId && <div className="col-span-2"><label className={LBL}>Medewerker *</label><select className={INP} value={f.personeel_id} onChange={(e) => setF({ ...f, personeel_id: e.target.value })}><option value="">Kies…</option>{mensen.map((m) => <option key={m.id} value={m.id}>{[m.voornaam, m.achternaam].filter(Boolean).join(' ')}</option>)}</select></div>}
        <div><label className={LBL}>Begin *</label><input type="datetime-local" className={INP} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
        <div><label className={LBL}>Einde *</label><input type="datetime-local" className={INP} value={f.eind} onChange={(e) => setF({ ...f, eind: e.target.value })} /></div>
        <div><label className={LBL}>Project</label><input className={INP} value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} /></div>
        <div><label className={LBL}>Taak</label><input className={INP} value={f.taak} onChange={(e) => setF({ ...f, taak: e.target.value })} /></div>
        <div className="col-span-2"><label className={LBL}>Reden *</label><input className={INP} value={f.reden} onChange={(e) => setF({ ...f, reden: e.target.value })} placeholder="bv. vergeten in te klokken" /></div>
      </div>
      <div className="flex justify-end gap-2 pt-4"><button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button><button type="button" disabled={bezig} onClick={bewaar} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Registreren</button></div>
    </Dialoog>
  )
}
