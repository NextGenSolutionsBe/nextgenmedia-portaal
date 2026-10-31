'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  Loader2, X, FileText, Sparkles, Paperclip, CalendarDays, MapPin, UserRound, ExternalLink, RotateCcw, Check, Ban, Upload, Info, Save,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  STATUS, SCOPE_LABEL, OFFERTE_LABEL, CONSULTANCY_TARIEF, antwoordRegels, timingTekst, vindType,
  type AanvraagSoort, type AanvraagStatus, type Scope, type OfferteStatus,
} from '@/lib/aanvragen/model'

/**
 * Admin — Aanvragen uit het klantportaal. Diensten en consultancy apart.
 * Per aanvraag: beoordelen (aanvaarden of afwijzen), scope binnen of buiten het
 * contract, een offerte koppelen die de klant kan aanvaarden of weigeren, en
 * intern opvolgen en inplannen. Overal herkenbaar als aanvraag, nooit als boeking.
 */

type Rij = {
  id: string; client_id: string; klant: string; soort: AanvraagSoort; type: string; type_label: string; wat: string; status: AanvraagStatus
  scope: Scope | null; offerte_status: OfferteStatus | null; expert_naam: string | null; toegewezen_naam: string | null
  periode_van: string | null; periode_tot: string | null; deadline: string | null; aantal_bestanden: number; created_at: string; clickup_status: string
}
type Detail = {
  aanvraag: Rij & {
    briefing: string | null; aandachtspunten: string | null; antwoorden: Record<string, unknown>; voorkeursdagen: string[]; tijdstippen: string[]; locatie: string | null
    expert_id: string | null; toegewezen_id: string | null; planning_datum: string | null; planning_notitie: string | null; reden_klant: string | null; interne_notitie: string | null
    scope_notitie: string | null; offerte_titel: string | null; offerte_notitie: string | null; offerte_verstuurd_op: string | null; offerte_beslist_op: string | null
    offerte_beslist_door: string | null; offerte_reden: string | null; clickup_task_id: string | null; clickup_url: string | null; clickup_fout: string | null
    team_mail_status?: 'ok' | 'fout' | null; team_mail_fout?: string | null
    ingediend_door_naam: string | null; ingediend_door_email: string | null; status_gewijzigd_op: string | null
  }
  bestanden: { id: string; bestandsnaam: string; grootte: number | null; url: string | null }[]
  offerte_link: string | null
  context: { diensten: string[]; contracten: { id: string; title: string | null; status: string | null }[]; binnen_scope_deze_maand: number }
  team: { id: string; naam: string }[]
}

const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15 focus:border-gray-900'
const LBL = 'block text-[11px] font-medium text-gray-500 mb-0.5'
const datum = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })
const FILTERS = [['open', 'Open'], ['ontvangen', 'Nieuw'], ['offerte', 'Offerte'], ['afgesloten', 'Afgesloten'], ['alles', 'Alles']] as const
const AFGESLOTEN: AanvraagStatus[] = ['afgerond', 'afgewezen', 'ingetrokken']

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j as T
}

export function AanvragenAdmin({ magAanpassen }: { magAanpassen: boolean }) {
  const zoek = useSearchParams()
  const router = useRouter()
  const [soort, setSoort] = useState<AanvraagSoort>(zoek.get('soort') === 'consultancy' ? 'consultancy' : 'dienst')
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('open')
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [alle, setAlle] = useState<Rij[]>([])
  const [open, setOpen] = useState<string | null>(zoek.get('aanvraag'))
  // Vanuit de klantfiche: enkel de aanvragen van die klant.
  const [klant, setKlant] = useState<string | null>(zoek.get('klant'))

  const laad = useCallback(async () => {
    try { const j = await api<{ aanvragen: Rij[] }>('/api/admin/aanvragen'); setAlle(j.aanvragen); setRijen(j.aanvragen) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setRijen([]) }
  }, [])
  useEffect(() => { laad() }, [laad])
  // Na een actie enkel die ene rij bijwerken, niet de hele lijst opnieuw laden.
  const werkBij = useCallback((a: Partial<Rij> & { id: string }) => {
    const pas = (l: Rij[]) => l.map((r) => (r.id === a.id ? { ...r, ...a, klant: r.klant, aantal_bestanden: r.aantal_bestanden } : r))
    setAlle(pas); setRijen((l) => (l ? pas(l) : l))
  }, [])
  // Deep link (?aanvraag=): naar het juiste tabblad.
  useEffect(() => { const a = alle.find((x) => x.id === open); if (a && a.soort !== soort) setSoort(a.soort) }, [alle, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const lijst = useMemo(() => (rijen ?? []).filter((r) => r.soort === soort && (!klant || r.client_id === klant)).filter((r) =>
    filter === 'alles' ? true : filter === 'open' ? !AFGESLOTEN.includes(r.status) : filter === 'afgesloten' ? AFGESLOTEN.includes(r.status) : r.status === filter), [rijen, soort, filter, klant])
  const telOpen = (s: AanvraagSoort) => alle.filter((r) => r.soort === s && (!klant || r.client_id === klant) && !AFGESLOTEN.includes(r.status)).length
  const klantNaam = klant ? alle.find((r) => r.client_id === klant)?.klant ?? 'deze klant' : null
  const kiesOpen = (id: string | null) => { setOpen(id); router.replace(`/admin/aanvragen${id ? `?aanvraag=${id}` : `?soort=${soort}`}`, { scroll: false }) }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex gap-1.5" role="tablist">
          {(['dienst', 'consultancy'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={soort === s} onClick={() => setSoort(s)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border ${soort === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
              {s === 'dienst' ? <FileText className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}{s === 'dienst' ? 'Dienstenaanvragen' : 'Consultancy-aanvragen'}
              <span className={`rounded-full px-1.5 text-[11px] ${soort === s ? 'bg-white/20' : 'bg-gray-100'}`}>{telOpen(s)}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map(([k, l]) => <button key={k} type="button" onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-full text-xs font-medium border ${filter === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>{l}</button>)}
        </div>
      </div>
      {klantNaam && <p className="text-xs"><span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5">Enkel {klantNaam}<button type="button" onClick={() => { setKlant(null); router.replace(`/admin/aanvragen?soort=${soort}`, { scroll: false }) }} aria-label="Filter op klant wissen" className="hover:text-black"><X className="h-3 w-3" /></button></span></p>}
      {soort === 'consultancy' && <p className="text-xs text-gray-500 flex items-center gap-1"><Info className="h-3.5 w-3.5" />Tarief zoals de klant het ziet: {CONSULTANCY_TARIEF}. Duur en eventuele offerte bepalen wij.</p>}

      <div className="card-base !p-0 overflow-hidden">
        {rijen === null ? <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          : lijst.length === 0 ? <p className="p-6 text-sm text-gray-500 text-center">Geen aanvragen in deze weergave.</p>
          : (
            <ul className="divide-y divide-gray-100">
              {lijst.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => kiesOpen(r.id)} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{r.klant}</span>
                        <span className="text-sm text-gray-600">· {r.type_label}</span>
                      </div>
                      <p className="text-xs text-gray-600 truncate">{r.wat}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                        <span>{datum(r.created_at)}</span>
                        {r.expert_naam && <span>voorkeur {r.expert_naam}</span>}
                        {r.toegewezen_naam && <span>opvolging {r.toegewezen_naam}</span>}
                        {r.deadline && <span>deadline {datum(r.deadline)}</span>}
                        {r.aantal_bestanden > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{r.aantal_bestanden}</span>}
                        {r.clickup_status === 'fout' && <span className="text-red-600">ClickUp mislukt</span>}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS[r.status].chip}`}>{STATUS[r.status].team}</span>
                      {r.scope && <span className="text-[10px] text-gray-500">{SCOPE_LABEL[r.scope]}</span>}
                      {r.offerte_status && <span className="text-[10px] text-violet-700">Offerte: {OFFERTE_LABEL[r.offerte_status].toLowerCase()}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
      {open && <DetailPaneel id={open} magAanpassen={magAanpassen} onSluit={() => kiesOpen(null)} onVeranderd={werkBij} />}
    </div>
  )
}

function DetailPaneel({ id, magAanpassen, onSluit, onVeranderd }: { id: string; magAanpassen: boolean; onSluit: () => void; onVeranderd: (a: Partial<Rij> & { id: string }) => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const laad = useCallback(async () => {
    try { setD(await api<Detail>(`/api/admin/aanvragen/${id}`)) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); onSluit() }
  }, [id, onSluit])
  useEffect(() => { setD(null); laad() }, [laad])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; if (e.key === 'Escape' && !(el && /INPUT|TEXTAREA|SELECT/.test(el.tagName))) onSluit() }
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc)
  }, [onSluit])

  /**
   * Een actie toont het resultaat meteen (optimistisch); het antwoord van de
   * server zet het daarna definitief. Enkel een offerte (tijdelijke links) of
   * ClickUp opnieuw herlaadt het detail. Mislukt het, dan springt het terug.
   */
  const actie = async (sleutel: string, body: Record<string, unknown>, ok: string) => {
    if (!d) return
    const vorig = d
    const v: Partial<Detail['aanvraag']> = {}
    if (body.actie === 'status') v.status = body.status as AanvraagStatus
    if (body.actie === 'scope') { v.scope = (body.scope as Scope | null) ?? null; v.scope_notitie = String(body.notitie ?? '').trim() || null }
    if (body.actie === 'toewijzen') { v.toegewezen_id = (body.personeel_id as string | null) || null; v.toegewezen_naam = d.team.find((t) => t.id === body.personeel_id)?.naam ?? null }
    if (body.actie === 'planning') { v.planning_datum = (body.datum as string | null) || null; if (body.datum) v.status = 'ingepland' }
    if (body.actie === 'notitie') v.interne_notitie = String(body.tekst ?? '').trim() || null
    if (Object.keys(v).length) setD({ ...d, aanvraag: { ...d.aanvraag, ...v } })
    setBezig(sleutel)
    try {
      const j = await api<{ aanvraag: Partial<Detail['aanvraag']> & { id: string } }>(`/api/admin/aanvragen/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      toast.success(ok)
      if (['offerte', 'offerte_intrekken', 'clickup_opnieuw'].includes(String(body.actie))) await laad()
      else setD((x) => (x ? { ...x, aanvraag: { ...x.aanvraag, ...j.aanvraag } } : x))
      onVeranderd(j.aanvraag)
    } catch (e) { setD(vorig); toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={(e) => { if (e.target === e.currentTarget) onSluit() }}>
      <aside className="h-full w-full sm:max-w-xl bg-white shadow-2xl flex flex-col" aria-label="Aanvraag">
        {!d ? <div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div> : (
          <>
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-500">{d.aanvraag.soort === 'dienst' ? 'Dienstenaanvraag' : 'Consultancy aanvraag'}</p>
                <h2 className="font-semibold text-lg leading-snug">{d.aanvraag.type_label}</h2>
                <p className="text-sm text-gray-600"><Link href={`/admin/clients/${d.aanvraag.client_id}`} className="underline underline-offset-2">{d.aanvraag.klant}</Link> · {datum(d.aanvraag.created_at)}{d.aanvraag.ingediend_door_naam || d.aanvraag.ingediend_door_email ? ` · ${d.aanvraag.ingediend_door_naam ?? d.aanvraag.ingediend_door_email}` : ''}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS[d.aanvraag.status].chip}`}>{STATUS[d.aanvraag.status].team}</span>
                <button type="button" onClick={onSluit} aria-label="Sluiten" className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">Aanvraag van de klant, geen bevestigde opdracht of boeking. Timing en expert zijn voorkeuren.</p>
              <Aanvraaginhoud d={d} />
              {magAanpassen ? <Beoordeling d={d} bezig={bezig} actie={actie} /> : <p className="text-xs text-gray-500">Je mag deze aanvraag bekijken, niet aanpassen.</p>}
              {magAanpassen && <Offerte d={d} bezig={bezig} actie={actie} />}
              {magAanpassen && <Opvolging d={d} bezig={bezig} actie={actie} />}
              <section className="text-xs text-gray-600 space-y-1">
                <h3 className="text-[11px] font-bold text-gray-400">ClickUp</h3>
                {d.aanvraag.clickup_url ? <a href={d.aanvraag.clickup_url} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">Taak openen in de lijst “Aanvragen”<ExternalLink className="h-3 w-3" /></a>
                  : <p className={d.aanvraag.clickup_status === 'fout' ? 'text-red-700' : ''}>{d.aanvraag.clickup_status === 'fout' ? `Niet in ClickUp: ${d.aanvraag.clickup_fout ?? 'onbekende fout'}` : 'Nog niet in ClickUp.'}</p>}
                {d.aanvraag.clickup_status === 'fout' && magAanpassen && <button type="button" disabled={!!bezig} onClick={() => actie('cu', { actie: 'clickup_opnieuw' }, 'ClickUp opnieuw geprobeerd.')} className="btn-secondary !py-1 text-xs"><RotateCcw className="h-3.5 w-3.5" />Opnieuw</button>}
                {d.aanvraag.team_mail_status === 'ok' && <p>Melding verstuurd naar info@nextgenmedia.be.</p>}
                {d.aanvraag.team_mail_status === 'fout' && <p className="text-red-700">Melding naar info@nextgenmedia.be niet verstuurd: {d.aanvraag.team_mail_fout ?? 'onbekende fout'}</p>}
              </section>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

function Aanvraaginhoud({ d }: { d: Detail }) {
  const a = d.aanvraag
  const t = vindType(a.soort, a.type)
  const regels = antwoordRegels(a.soort, a.type, a.antwoorden)
  const timing = timingTekst(a)
  return (
    <section className="space-y-3 text-sm">
      <div><p className={LBL}>{t?.watLabel ?? 'Wat'}</p><p className="whitespace-pre-wrap break-words">{a.wat}</p></div>
      {regels.length > 0 && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">{regels.map((r) => <div key={r.label} className="contents"><dt className="text-gray-500">{r.label}</dt><dd>{r.waarde}</dd></div>)}</dl>}
      {a.briefing && <div><p className={LBL}>{a.soort === 'consultancy' ? 'Doel' : 'Briefing'}</p><p className="whitespace-pre-wrap break-words">{a.briefing}</p></div>}
      {a.aandachtspunten && <div><p className={LBL}>Aandachtspunten</p><p className="whitespace-pre-wrap break-words">{a.aandachtspunten}</p></div>}
      <div className="text-[13px] space-y-0.5">
        {timing.length ? timing.map((x) => <p key={x} className="flex gap-1.5"><CalendarDays className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gray-400" />{x}</p>) : <p className="flex gap-1.5 text-gray-500"><CalendarDays className="h-3.5 w-3.5 mt-0.5 shrink-0" />Geen timingvoorkeur</p>}
        {a.locatie && <p className="flex gap-1.5"><MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gray-400" />{a.locatie}</p>}
        <p className="flex gap-1.5"><UserRound className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gray-400" />Expertvoorkeur: {a.expert_naam ?? 'geen voorkeur, stel zelf voor'}</p>
      </div>
      {d.bestanden.length > 0 && (
        <div><p className={LBL}>Bestanden en referenties</p>
          <ul className="space-y-1">{d.bestanden.map((b) => <li key={b.id}>{b.url ? <a href={b.url} target="_blank" rel="noreferrer" className="text-[13px] underline underline-offset-2 inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" />{b.bestandsnaam}</a> : <span className="text-[13px] text-gray-500">{b.bestandsnaam}</span>}</li>)}</ul>
        </div>
      )}
    </section>
  )
}

type Actie = (sleutel: string, body: Record<string, unknown>, ok: string) => Promise<void>

function Beoordeling({ d, bezig, actie }: { d: Detail; bezig: string | null; actie: Actie }) {
  const a = d.aanvraag
  const [afwijzen, setAfwijzen] = useState(false)
  const [reden, setReden] = useState(a.reden_klant ?? '')
  const [scopeNotitie, setScopeNotitie] = useState(a.scope_notitie ?? '')
  const dicht = a.status === 'ingetrokken'
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-bold text-gray-400">Beoordeling</h3>
      {dicht ? <p className="text-sm text-gray-600">De klant trok deze aanvraag in.</p> : (
        <div className="flex flex-wrap gap-1.5">
          {a.status === 'ontvangen' && <button type="button" disabled={!!bezig} onClick={() => actie('s', { actie: 'status', status: 'in_behandeling' }, 'In behandeling.')} className="btn-secondary !py-1.5 text-xs">In behandeling nemen</button>}
          {['ontvangen', 'in_behandeling'].includes(a.status) && <button type="button" disabled={!!bezig} onClick={() => actie('s', { actie: 'status', status: 'aanvaard' }, 'Aanvraag aanvaard. Nog in te plannen.')} className="btn-primary !py-1.5 text-xs"><Check className="h-3.5 w-3.5" />Aanvaarden</button>}
          {!['afgewezen', 'afgerond'].includes(a.status) && <button type="button" disabled={!!bezig} onClick={() => setAfwijzen(true)} className="btn-secondary !py-1.5 text-xs text-red-700"><Ban className="h-3.5 w-3.5" />Afwijzen</button>}
          {['aanvaard', 'ingepland'].includes(a.status) && <button type="button" disabled={!!bezig} onClick={() => actie('s', { actie: 'status', status: 'afgerond' }, 'Afgerond.')} className="btn-secondary !py-1.5 text-xs">Afgerond</button>}
          {['afgewezen', 'afgerond'].includes(a.status) && <button type="button" disabled={!!bezig} onClick={() => actie('s', { actie: 'status', status: 'in_behandeling' }, 'Heropend.')} className="btn-secondary !py-1.5 text-xs"><RotateCcw className="h-3.5 w-3.5" />Heropenen</button>}
        </div>
      )}
      {afwijzen && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
          <label className="block"><span className={LBL}>Reden voor de klant (optioneel, de klant ziet dit)</span><textarea rows={2} className={INP} value={reden} onChange={(e) => setReden(e.target.value)} placeholder="Bv. valt buiten wat we aanbieden; we verwijzen je graag door." /></label>
          <div className="flex gap-2"><button type="button" disabled={!!bezig} onClick={async () => { await actie('s', { actie: 'status', status: 'afgewezen', reden_klant: reden }, 'Aanvraag afgewezen.'); setAfwijzen(false) }} className="btn-danger !py-1.5 text-xs">Afwijzen</button><button type="button" onClick={() => setAfwijzen(false)} className="btn-secondary !py-1.5 text-xs">Annuleer</button></div>
        </div>
      )}
      {a.status === 'afgewezen' && a.reden_klant && <p className="text-xs text-gray-600">Reden voor de klant: {a.reden_klant}</p>}

      <div className="rounded-lg border border-gray-200 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm font-medium">Scope</span>
          <div className="flex gap-1">
            {([['binnen', 'Binnen contract'], ['buiten', 'Buiten contract'], ['', 'Nog niet bepaald']] as const).map(([k, l]) => (
              <button key={k} type="button" disabled={!!bezig} onClick={() => actie('sc', { actie: 'scope', scope: k || null, notitie: scopeNotitie }, 'Scope bewaard.')}
                className={`px-2 py-1 rounded-lg text-xs border ${(a.scope ?? '') === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>{l}</button>
            ))}
          </div>
        </div>
        <input className={INP} value={scopeNotitie} onChange={(e) => setScopeNotitie(e.target.value)} onBlur={() => { if (scopeNotitie !== (a.scope_notitie ?? '')) actie('sc', { actie: 'scope', scope: a.scope, notitie: scopeNotitie }, 'Scopenotitie bewaard.') }} placeholder="Bv. 1 ad-hoc shoot per maand inbegrepen in het socialmediacontract" aria-label="Scopenotitie" />
        <div className="text-[11px] text-gray-500 space-y-0.5">
          <p>Lopende diensten: {d.context.diensten.length ? d.context.diensten.join(', ') : 'geen'}</p>
          {d.context.contracten.length > 0 && <p>Contracten: {d.context.contracten.map((c) => `${c.title ?? 'Contract'}${c.status ? ` (${c.status})` : ''}`).join(' · ')}</p>}
          <p>Al binnen scope deze maand voor “{a.type_label}”: {d.context.binnen_scope_deze_maand}</p>
        </div>
      </div>
    </section>
  )
}

function Offerte({ d, bezig, actie }: { d: Detail; bezig: string | null; actie: Actie }) {
  const a = d.aanvraag
  const [titel, setTitel] = useState(`Offerte ${a.type_label}`)
  const [notitie, setNotitie] = useState('')
  const [url, setUrl] = useState('')
  const [pdf, setPdf] = useState<{ pad: string; naam: string } | null>(null)
  const [laden, setLaden] = useState(false)
  const afgesloten = ['afgewezen', 'ingetrokken', 'afgerond'].includes(a.status)

  async function kiesPdf(f: File | null) {
    if (!f) return
    setLaden(true)
    try {
      const s = await api<{ pad: string; token: string; bucket: string }>(`/api/admin/aanvragen/${a.id}/offerte`, { method: 'POST', body: JSON.stringify({ mimetype: f.type, grootte: f.size }) })
      const { error } = await createClient().storage.from(s.bucket).uploadToSignedUrl(s.pad, s.token, f, { contentType: 'application/pdf' })
      if (error) throw new Error(error.message)
      setPdf({ pad: s.pad, naam: f.name }); setUrl('')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally { setLaden(false) }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-bold text-gray-400">Offerte</h3>
      {a.offerte_status ? (
        <div className={`rounded-lg border p-3 space-y-1.5 text-sm ${a.offerte_status === 'open' ? 'border-violet-200 bg-violet-50' : 'border-gray-200'}`}>
          <p className="font-medium flex items-center gap-1.5"><FileText className="h-4 w-4" />{a.offerte_titel}</p>
          <p className="text-xs text-gray-600">{OFFERTE_LABEL[a.offerte_status]}{a.offerte_verstuurd_op ? ` · gekoppeld op ${datum(a.offerte_verstuurd_op)}` : ''}{a.offerte_beslist_op ? ` · beslist op ${datum(a.offerte_beslist_op)}${a.offerte_beslist_door ? ` door ${a.offerte_beslist_door}` : ''}` : ''}</p>
          {a.offerte_reden && <p className="text-xs text-gray-700">Reden van de klant: {a.offerte_reden}</p>}
          {a.offerte_notitie && <p className="text-xs text-gray-700 whitespace-pre-wrap">{a.offerte_notitie}</p>}
          <div className="flex gap-2 flex-wrap">
            {d.offerte_link && <a href={d.offerte_link} target="_blank" rel="noreferrer" className="btn-secondary !py-1 text-xs"><ExternalLink className="h-3.5 w-3.5" />Openen</a>}
            {a.offerte_status === 'open' && <button type="button" disabled={!!bezig} onClick={() => actie('oi', { actie: 'offerte_intrekken' }, 'Offerte ingetrokken.')} className="btn-secondary !py-1 text-xs">Intrekken</button>}
          </div>
          {a.offerte_status === 'geweigerd' && !afgesloten && <p className="text-xs text-gray-600">Je kan een nieuwe offerte koppelen hieronder.</p>}
        </div>
      ) : null}
      {(!a.offerte_status || a.offerte_status === 'geweigerd') && !afgesloten && (
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <p className="text-xs text-gray-600">Voor werk buiten de scope. De app rekent niets uit: de prijs staat in je offerte. De klant opent ze in de klantapp en aanvaardt of weigert.</p>
          <label className="block"><span className={LBL}>Titel</span><input className={INP} value={titel} onChange={(e) => setTitel(e.target.value)} /></label>
          <div className="grid sm:grid-cols-2 gap-2 items-end">
            <label className="btn-secondary text-xs justify-center cursor-pointer">{laden ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{pdf ? pdf.naam : 'PDF opladen'}<input type="file" accept="application/pdf" className="sr-only" onChange={(e) => { kiesPdf(e.target.files?.[0] ?? null); e.target.value = '' }} /></label>
            <label className="block"><span className={LBL}>of link naar de offerte</span><input className={INP} value={url} onChange={(e) => { setUrl(e.target.value); if (e.target.value) setPdf(null) }} placeholder="https://" disabled={!!pdf} /></label>
          </div>
          <label className="block"><span className={LBL}>Toelichting voor de klant (optioneel)</span><textarea rows={2} className={INP} value={notitie} onChange={(e) => setNotitie(e.target.value)} /></label>
          <button type="button" disabled={!!bezig || laden || (!pdf && !url.trim())} onClick={() => actie('o', { actie: 'offerte', titel, notitie, pad: pdf?.pad ?? null, bestandsnaam: pdf?.naam ?? null, url: pdf ? null : url }, 'Offerte gekoppeld. De klant ziet ze in de klantapp.')} className="btn-primary !py-1.5 text-xs"><FileText className="h-3.5 w-3.5" />Offerte koppelen</button>
        </div>
      )}
    </section>
  )
}

function Opvolging({ d, bezig, actie }: { d: Detail; bezig: string | null; actie: Actie }) {
  const a = d.aanvraag
  const [planDatum, setPlanDatum] = useState(a.planning_datum ?? '')
  const [planNotitie, setPlanNotitie] = useState(a.planning_notitie ?? '')
  const [notitie, setNotitie] = useState(a.interne_notitie ?? '')
  const kanPlannen = ['aanvaard', 'ingepland'].includes(a.status)
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-bold text-gray-400">Opvolging (intern)</h3>
      <label className="block"><span className={LBL}>Wie volgt op (bevestigd){a.expert_naam ? ` · voorkeur klant: ${a.expert_naam}` : ''}</span>
        <select className={INP} value={a.toegewezen_id ?? ''} disabled={!!bezig} onChange={(e) => actie('t', { actie: 'toewijzen', personeel_id: e.target.value || null }, 'Opvolging bewaard.')}>
          <option value="">Nog niemand</option>
          {d.team.map((p) => <option key={p.id} value={p.id}>{p.naam}{p.id === a.expert_id ? ' (voorkeur klant)' : ''}</option>)}
        </select>
      </label>
      <div className="rounded-lg border border-gray-200 p-3 space-y-2">
        <p className="text-sm font-medium">Intern inplannen</p>
        {!kanPlannen && <p className="text-xs text-gray-500">Kan pas nadat de aanvraag aanvaard is (of de klant de offerte aanvaardde).</p>}
        <div className="grid grid-cols-[auto_1fr] gap-2 items-end">
          <label className="block"><span className={LBL}>Datum</span><input type="date" className={INP} value={planDatum} disabled={!kanPlannen} onChange={(e) => setPlanDatum(e.target.value)} /></label>
          <label className="block"><span className={LBL}>Notitie</span><input className={INP} value={planNotitie} disabled={!kanPlannen} onChange={(e) => setPlanNotitie(e.target.value)} placeholder="Bv. shoot met Arthur, 2 uur" /></label>
        </div>
        <button type="button" disabled={!!bezig || !kanPlannen} onClick={() => actie('p', { actie: 'planning', datum: planDatum || null, notitie: planNotitie }, planDatum ? 'Ingepland.' : 'Planning gewist.')} className="btn-secondary !py-1.5 text-xs"><CalendarDays className="h-3.5 w-3.5" />{planDatum ? 'Inplannen' : 'Planning wissen'}</button>
      </div>
      <label className="block"><span className={LBL}>Interne notitie (nooit zichtbaar voor de klant)</span><textarea rows={3} className={INP} value={notitie} onChange={(e) => setNotitie(e.target.value)} /></label>
      <button type="button" disabled={!!bezig || notitie === (a.interne_notitie ?? '')} onClick={() => actie('n', { actie: 'notitie', tekst: notitie }, 'Notitie bewaard.')} className="btn-secondary !py-1.5 text-xs"><Save className="h-3.5 w-3.5" />Notitie bewaren</button>
    </section>
  )
}
