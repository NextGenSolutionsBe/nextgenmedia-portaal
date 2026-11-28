'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronLeft, ChevronRight, ListPlus, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { NieuweTaak } from '@/components/admin/clickup-taken'
import { NaarBody } from '@/components/admin/naar-body'
import {
  OVERLEG_AGENDA, DOEL_STATUS, kleurVan, kwartaalVan, volgendKwartaal, beloftesPerPersoon, maandagVan, CIJFERS,
  type Actiepunt, type AgendaKey, type Belofte, type Stem, type ScorecardInstellingen, type Week,
} from '@/lib/ritme/model'
import { DOMEINEN, domeinLabel, isEigenaar, eindUur } from '@/lib/werking/instellingen'

const TABS = [['scorecard', 'Scorecard'], ['overleg', 'Weekoverleg'], ['doelen', 'Kwartaaldoelen'], ['beslissingen', 'Beslissingen'], ['beloftes', 'Beloftes']] as const
type Tab = (typeof TABS)[number][0]
const MENSEN = ['Marco', 'Bram', 'Chiara']
const EUR = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const dagKort = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) : '')
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const plusDagen = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

async function api<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Mislukt')
  return j as T
}

/**
 * Ritme van de zaakvoerders (verbeterplan fase 7): tabblad bij het Command
 * Center. Scorecard (13 weken, eigenaar en doel per cijfer), weekoverleg met
 * vaste agenda, kwartaaldoelen, beslissingen (twee van de drie) en beloftes.
 */
export function RitmeClient({ start }: { start?: string }) {
  const [tab, setTab] = useState<Tab>(TABS.some(([k]) => k === start) ? (start as Tab) : 'scorecard')
  return (
    <div className="space-y-4">
      <div className="flex gap-1 flex-wrap">{TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-black text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>{l}</button>)}</div>
      {tab === 'scorecard' && <Scorecard />}
      {tab === 'overleg' && <Weekoverleg />}
      {tab === 'doelen' && <Kwartaaldoelen />}
      {tab === 'beslissingen' && <Beslissingen />}
      {tab === 'beloftes' && <Beloftes />}
    </div>
  )
}

// ── Scorecard ──────────────────────────────────────────────────────────────

type ScRij = { key: string; label: string; euro: boolean; uitleg: string; waarden: number[]; eigenaar: string | null; doel: number | null; aan: boolean }

export function Scorecard({ compact = false }: { compact?: boolean }) {
  const [d, setD] = useState<{ weken: Week[]; rijen: ScRij[]; instellingen: ScorecardInstellingen } | null>(null)
  const [bewerk, setBewerk] = useState(false)
  const laad = useCallback(() => { api<{ weken: Week[]; rijen: ScRij[]; instellingen: ScorecardInstellingen }>('/api/admin/ritme?deel=scorecard').then(setD).catch((e) => toast.error(e.message)) }, [])
  useEffect(() => { laad() }, [laad])
  if (!d) return <div className="card-base py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const rijen = d.rijen.filter((r) => r.aan)
  const toon = (r: ScRij, v: number) => (r.euro ? EUR(v) : v.toLocaleString('nl-BE'))
  const laatste = d.weken.length - 1
  return (
    <section className="card-base space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="font-semibold">Scorecard</h2>
        <span className="text-xs text-gray-500">Per week, vanzelf uit de app. Groen = doel gehaald.</span>
        {!compact && <button type="button" onClick={() => setBewerk(true)} className="btn-secondary text-xs ml-auto"><Pencil className="h-3.5 w-3.5" />Eigenaars en doelen</button>}
      </div>
      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-xs min-w-[760px]">
          <thead><tr className="text-gray-500 border-b border-gray-200">
            <th className="text-left font-medium px-2 py-1.5">Cijfer</th><th className="text-left font-medium px-2">Eigenaar</th><th className="text-right font-medium px-2">Doel</th>
            {d.weken.map((w, i) => <th key={w.van} className={`text-right font-medium px-1.5 ${i === laatste ? 'text-gray-900' : ''}`} title={`${dagKort(w.van)} – ${dagKort(w.tot)}`}>{w.label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {rijen.map((r) => (
              <tr key={r.key}>
                <td className="px-2 py-1.5 font-medium" title={r.uitleg}>{r.label}</td>
                <td className="px-2 text-gray-600">{r.eigenaar ?? '—'}</td>
                <td className="px-2 text-right tabular-nums text-gray-600">{r.doel ? toon(r, r.doel) : '—'}</td>
                {r.waarden.map((v, i) => {
                  const k = kleurVan(v, r.doel, i === laatste)
                  return <td key={i} className={`px-1.5 text-right tabular-nums ${k === 'groen' ? 'text-[#166534] font-semibold' : k === 'rood' ? 'text-red-700' : ''}`}>{k === 'rood' ? '▼ ' : ''}{toon(r, v)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bewerk && <ScorecardInstellen inst={d.instellingen} onSluit={() => setBewerk(false)} onBewaard={() => { setBewerk(false); laad() }} />}
    </section>
  )
}

function ScorecardInstellen({ inst, onSluit, onBewaard }: { inst: ScorecardInstellingen; onSluit: () => void; onBewaard: () => void }) {
  const [v, setV] = useState(inst)
  const [bezig, setBezig] = useState(false)
  const zet = (k: string, p: Partial<ScorecardInstellingen[keyof ScorecardInstellingen]>) => setV((x) => ({ ...x, [k]: { ...x[k as keyof ScorecardInstellingen], ...p } }))
  return (
    <Venster titel="Eigenaars en doelen per week" onSluit={onSluit}>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {CIJFERS.map((c) => (
          <div key={c.key} className="grid grid-cols-[1fr_110px_100px_auto] gap-2 items-center text-sm">
            <span className={v[c.key].aan ? '' : 'text-gray-400'}>{c.label}</span>
            <input className="input-base !py-1.5" list="ritme-mensen" value={v[c.key].eigenaar ?? ''} onChange={(e) => zet(c.key, { eigenaar: e.target.value || null })} placeholder="Eigenaar" aria-label={`Eigenaar ${c.label}`} />
            <input className="input-base !py-1.5" inputMode="decimal" value={v[c.key].doel ?? ''} onChange={(e) => zet(c.key, { doel: Number(e.target.value.replace(',', '.')) || null })} placeholder="Doel" aria-label={`Doel ${c.label}`} />
            <input type="checkbox" checked={v[c.key].aan} onChange={(e) => zet(c.key, { aan: e.target.checked })} aria-label={`${c.label} tonen`} />
          </div>
        ))}
      </div>
      <datalist id="ritme-mensen">{MENSEN.map((m) => <option key={m} value={m} />)}</datalist>
      <button type="button" disabled={bezig} onClick={async () => { setBezig(true); try { await api('/api/admin/ritme', { actie: 'scorecard.instellingen', instellingen: v }); toast.success('Bewaard.'); onBewaard() } catch (e) { toast.error((e as Error).message) } finally { setBezig(false) } }} className="btn-primary w-full justify-center">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
    </Venster>
  )
}

// ── Weekoverleg ────────────────────────────────────────────────────────────

type Moment = { dag: number; van: string; duur_min: number; reeks_id: string | null }
const DAG_LANG = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag']
type Overleg = { week: string; notities: Partial<Record<AgendaKey, string>>; acties: Actiepunt[]; aanwezig: string[]; afgesloten_op: string | null; bijgewerkt_door: string | null }

function Weekoverleg() {
  const [week, setWeek] = useState(maandagVan(vandaag()))
  const [d, setD] = useState<{ overleg: Overleg; vorige: Overleg | null; metTaak: string[]; moment?: Moment } | null>(null)
  const [zetBezig, setZetBezig] = useState(false)
  const [notities, setNotities] = useState<Partial<Record<AgendaKey, string>>>({})
  const [vuil, setVuil] = useState(false)
  const [taakVoor, setTaakVoor] = useState<Actiepunt | null>(null)
  const laad = useCallback(() => {
    api<{ overleg: Overleg; vorige: Overleg | null; metTaak: string[]; moment?: Moment }>(`/api/admin/ritme?deel=overleg&week=${week}`).then((x) => { setD(x); setNotities(x.overleg.notities); setVuil(false) }).catch((e) => toast.error(e.message))
  }, [week])
  useEffect(() => { laad() }, [laad])
  const post = async (b: Record<string, unknown>, ok?: string) => {
    try { const j = await api<{ overleg: Overleg }>('/api/admin/ritme', { week, ...b }); setD((x) => (x ? { ...x, overleg: j.overleg } : x)); if (ok) toast.success(ok); return true } catch (e) { toast.error((e as Error).message); return false }
  }
  if (!d) return <div className="card-base py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const o = d.overleg
  const vorigeOpen = (d.vorige?.acties ?? []).filter((a) => !a.klaar)
  const m = d.moment
  const zetVast = async () => {
    setZetBezig(true)
    try { const j = await api<{ nieuw: boolean }>('/api/admin/ritme', { actie: 'overleg.vast_moment' }); toast.success(j.nieuw ? 'Het weekoverleg staat vast in jullie agenda.' : 'Het vaste moment is aangepast.'); laad() } catch (e) { toast.error((e as Error).message) } finally { setZetBezig(false) }
  }
  return (
    <div className="space-y-3">
      {m && (
        <div className="card-base flex items-center gap-2 flex-wrap text-sm">
          <span className="text-gray-700">{m.reeks_id ? 'Vast moment' : 'Voorstel'}: <b>{DAG_LANG[m.dag - 1]} {m.van}–{eindUur(m.van, m.duur_min)}</b>, Marco, Bram en Chiara</span>
          <span className="flex-1" />
          <button type="button" disabled={zetBezig} onClick={zetVast} className={m.reeks_id ? 'btn-secondary text-xs' : 'btn-primary text-xs'}>{zetBezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{m.reeks_id ? 'Opnieuw vastzetten' : 'Vast moment instellen'}</button>
        </div>
      )}
      <div className="card-base flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setWeek(plusDagen(week, -7))} className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center" aria-label="Vorige week"><ChevronLeft className="h-4 w-4" /></button>
        <span className="font-semibold text-sm">Week van {dagKort(week)}</span>
        <button type="button" onClick={() => setWeek(plusDagen(week, 7))} className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center" aria-label="Volgende week"><ChevronRight className="h-4 w-4" /></button>
        <div className="flex gap-1 ml-2">{MENSEN.map((m) => { const aan = o.aanwezig.includes(m); return <button key={m} type="button" aria-pressed={aan} onClick={() => post({ actie: 'overleg.bewaar', aanwezig: aan ? o.aanwezig.filter((x) => x !== m) : [...o.aanwezig, m] })} className={`rounded-full px-2.5 py-0.5 text-xs border ${aan ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>{m}</button> })}</div>
        <span className="flex-1" />
        {o.afgesloten_op ? <span className="text-xs text-[#166534]">Afgesloten {dagKort(o.afgesloten_op)}</span> : null}
        <button type="button" onClick={() => post({ actie: 'overleg.bewaar', afsluiten: !o.afgesloten_op }, o.afgesloten_op ? 'Weer open.' : 'Overleg afgesloten.')} className="btn-secondary text-xs">{o.afgesloten_op ? 'Weer openen' : 'Overleg afsluiten'}</button>
      </div>

      {vorigeOpen.length > 0 && (
        <div className="card-base">
          <div className="label-mono text-gray-500 mb-1">Open beloftes van vorige keer</div>
          <ul className="text-sm space-y-1">{vorigeOpen.map((a) => <li key={a.id} className="flex items-start gap-2"><span className="flex-1">{a.tekst} <span className="text-gray-500">· {a.wie}{a.aan_wie ? ` aan ${a.aan_wie}` : ''}{a.tegen ? ` · tegen ${dagKort(a.tegen)}` : ''}</span></span></li>)}</ul>
        </div>
      )}

      <div className="card-base space-y-3">
        {OVERLEG_AGENDA.map((a) => a.key === 'scorecard'
          ? <details key={a.key}><summary className="cursor-pointer text-sm font-semibold">{a.label} <span className="text-gray-400 font-normal">· {a.min} min</span></summary><div className="mt-2"><Scorecard compact /></div></details>
          : (
            <label key={a.key} className="block">
              <span className="text-sm font-semibold">{a.label} <span className="text-gray-400 font-normal">· {a.min} min</span></span>
              <textarea className="input-base mt-1" rows={a.key === 'problemen' ? 5 : 2} value={notities[a.key] ?? ''} onChange={(e) => { setNotities({ ...notities, [a.key]: e.target.value }); setVuil(true) }} />
            </label>
          ))}
        <div className="flex justify-end"><button type="button" disabled={!vuil} onClick={async () => { if (await post({ actie: 'overleg.bewaar', notities }, 'Notities bewaard.')) setVuil(false) }} className="btn-primary text-sm">Notities bewaren</button></div>
      </div>

      <div className="card-base space-y-2">
        <h3 className="font-semibold text-sm">Afspraken en beloftes</h3>
        <ul className="divide-y divide-gray-100">
          {o.acties.map((a) => {
            const taak = d.metTaak.includes(a.id)
            return (
              <li key={a.id} className="py-2 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={!!a.klaar} onChange={(e) => post({ actie: 'overleg.actie_wijzig', id: a.id, klaar: e.target.checked })} aria-label={`${a.tekst} afvinken`} />
                <span className={`flex-1 ${a.klaar ? 'line-through text-gray-400' : ''}`}>{a.tekst}<span className="block text-xs text-gray-500">{a.wie}{a.aan_wie ? ` belooft aan ${a.aan_wie}` : ''}{a.tegen ? ` · tegen ${dagKort(a.tegen)}` : ''}{taak ? ' · taak gemaakt' : ''}</span></span>
                {!taak && !a.klaar && <button type="button" onClick={() => setTaakVoor(a)} className="text-xs inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"><ListPlus className="h-3.5 w-3.5" />Taak</button>}
                <button type="button" onClick={() => post({ actie: 'overleg.actie_wijzig', id: a.id, weg: true })} className="h-7 w-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400" aria-label="Weghalen"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            )
          })}
        </ul>
        <NieuwActiepunt onToevoegen={(b) => post({ actie: 'overleg.actie', ...b }, 'Toegevoegd.')} />
      </div>

      {taakVoor && (
        <Venster titel="Taak maken" onSluit={() => setTaakVoor(null)}>
          <NieuweTaak basis="/api/admin/taken" waarbij="opvolging" standaardMerk={null} kader={false} voorstellen={[taakVoor.tekst]} standaardDeadline={taakVoor.tegen}
            extra={{ opvolg_ref: `overleg:${taakVoor.id}`, ...(taakVoor.aan_wie ? { beloofd_aan: taakVoor.aan_wie } : {}) }}
            onSluit={() => setTaakVoor(null)} onKlaar={() => { setTaakVoor(null); laad() }} />
        </Venster>
      )}
    </div>
  )
}

function NieuwActiepunt({ onToevoegen }: { onToevoegen: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [v, setV] = useState({ tekst: '', wie: '', aan_wie: '', tegen: '' })
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_110px_120px_140px_auto] items-center">
      <input className="input-base" value={v.tekst} onChange={(e) => setV({ ...v, tekst: e.target.value })} placeholder="Wat?" aria-label="Wat" />
      <input className="input-base" list="ritme-mensen-2" value={v.wie} onChange={(e) => setV({ ...v, wie: e.target.value })} placeholder="Wie?" aria-label="Wie" />
      <input className="input-base" list="ritme-mensen-2" value={v.aan_wie} onChange={(e) => setV({ ...v, aan_wie: e.target.value })} placeholder="Aan wie?" aria-label="Aan wie" />
      <input type="date" className="input-base" value={v.tegen} onChange={(e) => setV({ ...v, tegen: e.target.value })} aria-label="Tegen wanneer" />
      <button type="button" onClick={async () => { if (await onToevoegen(v)) setV({ tekst: '', wie: '', aan_wie: '', tegen: '' }) }} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Toevoegen</button>
      <datalist id="ritme-mensen-2">{MENSEN.map((m) => <option key={m} value={m} />)}</datalist>
    </div>
  )
}

// ── Kwartaaldoelen ─────────────────────────────────────────────────────────

type Doel = { id: string; kwartaal: string; titel: string; bedrijf: string | null; eigenaar: string; status: string; notitie: string | null }
const STATUS_KLEUR: Record<string, string> = { op_schema: 'bg-green-50 text-[#166534] border-green-200', achter: 'bg-red-50 text-red-700 border-red-200', af: 'bg-gray-900 text-white border-gray-900', niet_gehaald: 'bg-gray-100 text-gray-500 border-gray-200' }
const BEDRIJF: Record<string, string> = { nextgenmedia: 'NextGenMedia', nextgensolutions: 'NextGenSolutions' }

function Kwartaaldoelen() {
  const [kw, setKw] = useState(kwartaalVan(vandaag()))
  const [lijst, setLijst] = useState<Doel[] | null>(null)
  const [bewerk, setBewerk] = useState<Doel | 'nieuw' | null>(null)
  const laad = useCallback(() => { api<{ doelen: Doel[] }>(`/api/admin/ritme?deel=doelen&kwartaal=${kw}`).then((j) => setLijst(j.doelen)).catch((e) => toast.error(e.message)) }, [kw])
  useEffect(() => { laad() }, [laad])
  const vorigKw = (k: string) => { const [j, q] = [Number(k.slice(0, 4)), Number(k.slice(6))]; return q === 1 ? `${j - 1}-Q4` : `${j}-Q${q - 1}` }
  const perEigenaar = new Map<string, Doel[]>()
  for (const d of lijst ?? []) perEigenaar.set(d.eigenaar, [...(perEigenaar.get(d.eigenaar) ?? []), d])
  return (
    <div className="card-base space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setKw(vorigKw(kw))} className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center" aria-label="Vorig kwartaal"><ChevronLeft className="h-4 w-4" /></button>
        <span className="font-semibold text-sm">{kw.replace('-', ' ')}</span>
        <button type="button" onClick={() => setKw(volgendKwartaal(kw))} className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center" aria-label="Volgend kwartaal"><ChevronRight className="h-4 w-4" /></button>
        <span className="flex-1" />
        <button type="button" onClick={() => setBewerk('nieuw')} className="btn-primary text-sm"><Plus className="h-4 w-4" />Doel</button>
      </div>
      {!lijst ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : !lijst.length ? <p className="text-sm text-gray-500">Nog geen doelen voor dit kwartaal.</p> : (
        [...perEigenaar.entries()].map(([wie, l]) => (
          <div key={wie}>
            <div className="label-mono text-gray-500 mb-1">{wie}</div>
            <ul className="space-y-1">{l.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <span className={`text-[11px] border rounded-full px-2 py-0.5 shrink-0 ${STATUS_KLEUR[d.status] ?? ''}`}>{DOEL_STATUS.find((s) => s.key === d.status)?.label}</span>
                <button type="button" onClick={() => setBewerk(d)} className="flex-1 text-left hover:underline">{d.titel}{d.bedrijf ? <span className="text-xs text-gray-500"> · {BEDRIJF[d.bedrijf]}</span> : null}</button>
              </li>
            ))}</ul>
          </div>
        ))
      )}
      {bewerk && <DoelVenster d={bewerk === 'nieuw' ? null : bewerk} kwartaal={kw} onSluit={() => setBewerk(null)} onBewaard={() => { setBewerk(null); laad() }} />}
    </div>
  )
}

function DoelVenster({ d, kwartaal, onSluit, onBewaard }: { d: Doel | null; kwartaal: string; onSluit: () => void; onBewaard: () => void }) {
  const [v, setV] = useState({ titel: d?.titel ?? '', eigenaar: d?.eigenaar ?? '', bedrijf: d?.bedrijf ?? '', status: d?.status ?? 'op_schema', notitie: d?.notitie ?? '' })
  const [bezig, setBezig] = useState(false)
  const doe = async (b: Record<string, unknown>) => { setBezig(true); try { await api('/api/admin/ritme', b); toast.success('Bewaard.'); onBewaard() } catch (e) { toast.error((e as Error).message) } finally { setBezig(false) } }
  return (
    <Venster titel={d ? 'Doel aanpassen' : 'Nieuw kwartaaldoel'} onSluit={onSluit}>
      <input className="input-base" value={v.titel} onChange={(e) => setV({ ...v, titel: e.target.value })} placeholder="Bv. 5 nieuwe retainerklanten bij Media" aria-label="Doel" autoFocus />
      <div className="grid grid-cols-2 gap-2">
        <input className="input-base" list="ritme-mensen-3" value={v.eigenaar} onChange={(e) => setV({ ...v, eigenaar: e.target.value })} placeholder="Eigenaar" aria-label="Eigenaar" />
        <select className="input-base" value={v.bedrijf} onChange={(e) => setV({ ...v, bedrijf: e.target.value })} aria-label="Bedrijf"><option value="">Beide bedrijven</option><option value="nextgenmedia">NextGenMedia</option><option value="nextgensolutions">NextGenSolutions</option></select>
      </div>
      <div className="flex gap-1 flex-wrap">{DOEL_STATUS.map((s) => <button key={s.key} type="button" onClick={() => setV({ ...v, status: s.key })} className={`rounded-full px-2.5 py-1 text-xs border ${v.status === s.key ? 'bg-black text-white border-black' : 'border-gray-200'}`}>{s.label}</button>)}</div>
      <textarea className="input-base" rows={3} value={v.notitie} onChange={(e) => setV({ ...v, notitie: e.target.value })} placeholder="Notitie (optioneel)" aria-label="Notitie" />
      <datalist id="ritme-mensen-3">{MENSEN.map((m) => <option key={m} value={m} />)}</datalist>
      <div className="flex gap-2">
        {d && <button type="button" disabled={bezig} onClick={() => { if (confirm('Doel archiveren?')) void doe({ actie: 'doel.archiveer', id: d.id }) }} className="btn-secondary text-sm">Archiveren</button>}
        <button type="button" disabled={bezig} onClick={() => doe({ actie: d ? 'doel.wijzig' : 'doel.nieuw', id: d?.id, kwartaal: d?.kwartaal ?? kwartaal, ...v })} className="btn-primary flex-1 justify-center">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
      </div>
    </Venster>
  )
}

// ── Beslissingen ───────────────────────────────────────────────────────────

type Beslissing = { id: string; titel: string; toelichting: string | null; bedrijf: string | null; voorgesteld_door: string | null; status: 'open' | 'aangenomen' | 'verworpen'; beslist_op: string | null; created_at: string; domein?: string | null; eigenaar?: string | null; stemmen: { auth_user_id: string; naam: string | null; stem: Stem }[] }
const UITSLAG: Record<string, string> = { open: 'Open', aangenomen: 'Aangenomen', verworpen: 'Verworpen' }
type Domeinen = Record<string, string>

function statusTekst(b: Beslissing): string {
  if (!b.eigenaar) return UITSLAG[b.status]
  if (b.status === 'open') return `Wacht op ${b.eigenaar}`
  return b.status === 'aangenomen' ? `Beslist door ${b.eigenaar}` : `${b.eigenaar}: niet doen`
}

function Beslissingen() {
  const [lijst, setLijst] = useState<Beslissing[] | null>(null)
  const [ik, setIk] = useState<string | null>(null)
  const [domeinen, setDomeinen] = useState<Domeinen>({})
  const [nieuw, setNieuw] = useState(false)
  const laad = useCallback(() => { api<{ beslissingen: Beslissing[]; ik: string | null; domeinen: Domeinen }>('/api/admin/ritme?deel=beslissingen').then((j) => { setLijst(j.beslissingen); setIk(j.ik); setDomeinen(j.domeinen ?? {}) }).catch((e) => toast.error(e.message)) }, [])
  useEffect(() => { laad() }, [laad])
  const stem = async (id: string, s: Stem) => { try { await api('/api/admin/ritme', { actie: 'beslissing.stem', id, stem: s }); laad() } catch (e) { toast.error((e as Error).message) } }
  const beslis = async (id: string, besluit: 'ja' | 'nee') => { try { await api('/api/admin/ritme', { actie: 'beslissing.beslis', id, besluit }); laad() } catch (e) { toast.error((e as Error).message) } }
  return (
    <div className="card-base space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Beslissingen</h2><button type="button" onClick={() => setNieuw(true)} className="btn-primary text-sm"><Plus className="h-4 w-4" />Beslissing</button></div>
      <p className="text-xs text-gray-500">Binnen één domein beslist de eigenaar. Over meerdere domeinen: twee van de drie.</p>
      {!lijst ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : !lijst.length ? <p className="text-sm text-gray-500">Nog geen beslissingen.</p> : (
        <ul className="divide-y divide-gray-100">
          {lijst.map((b) => (
            <li key={b.id} className="py-2.5 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] border rounded-full px-2 py-0.5 ${b.status === 'aangenomen' ? 'bg-green-50 text-[#166534] border-green-200' : b.status === 'verworpen' ? 'bg-red-50 text-red-700 border-red-200' : 'border-gray-200 text-gray-600'}`}>{statusTekst(b)}</span>
                <span className="font-medium text-sm flex-1">{b.titel}</span>
                <span className="text-xs text-gray-500">{domeinLabel(b.domein)} · {b.voorgesteld_door} · {dagKort(b.created_at)}</span>
              </div>
              {b.toelichting && <p className="text-sm text-gray-700 whitespace-pre-wrap">{b.toelichting}</p>}
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {!b.eigenaar && b.stemmen.map((s) => <span key={s.auth_user_id} className="rounded-full border border-gray-200 px-2 py-0.5">{s.naam}: {s.stem}</span>)}
                {!b.eigenaar && b.status === 'open' && (['voor', 'tegen', 'onthouding'] as Stem[]).map((s) => <button key={s} type="button" onClick={() => stem(b.id, s)} className="btn-secondary !py-1 text-xs">{s === 'voor' ? <Check className="h-3 w-3" /> : null}{s[0].toUpperCase() + s.slice(1)}</button>)}
                {b.eigenaar && b.status === 'open' && isEigenaar(b.eigenaar, ik) && (<>
                  <button type="button" onClick={() => beslis(b.id, 'ja')} className="btn-secondary !py-1 text-xs"><Check className="h-3 w-3" />Beslist</button>
                  <button type="button" onClick={() => beslis(b.id, 'nee')} className="btn-secondary !py-1 text-xs"><X className="h-3 w-3" />Niet doen</button>
                </>)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {nieuw && <BeslissingVenster ik={ik} domeinen={domeinen} onSluit={() => setNieuw(false)} onBewaard={() => { setNieuw(false); laad() }} />}
    </div>
  )
}

function BeslissingVenster({ ik, domeinen, onSluit, onBewaard }: { ik: string | null; domeinen: Domeinen; onSluit: () => void; onBewaard: () => void }) {
  const [v, setV] = useState({ titel: '', toelichting: '', bedrijf: '', domein: 'meerdere' })
  const [bezig, setBezig] = useState(false)
  const eigenaar = v.domein !== 'meerdere' ? domeinen[v.domein] ?? null : null
  const zelf = !!eigenaar && isEigenaar(eigenaar, ik)
  const knop = zelf ? 'Beslissen' : eigenaar ? `Voorleggen aan ${eigenaar}` : 'Ter stemming voorleggen'
  return (
    <Venster titel="Beslissing" onSluit={onSluit}>
      <input className="input-base" value={v.titel} onChange={(e) => setV({ ...v, titel: e.target.value })} placeholder="Wat beslissen we?" aria-label="Beslissing" autoFocus />
      <textarea className="input-base" rows={4} value={v.toelichting} onChange={(e) => setV({ ...v, toelichting: e.target.value })} placeholder="Toelichting (waarom, wat kost het, wat als we het niet doen)" aria-label="Toelichting" />
      <select className="input-base" value={v.domein} onChange={(e) => setV({ ...v, domein: e.target.value })} aria-label="Domein">
        {DOMEINEN.map((d) => <option key={d.key} value={d.key}>{d.label}{domeinen[d.key] ? ` · ${domeinen[d.key]}` : ''}</option>)}
        <option value="meerdere">Meerdere domeinen · stemming</option>
      </select>
      <select className="input-base" value={v.bedrijf} onChange={(e) => setV({ ...v, bedrijf: e.target.value })} aria-label="Bedrijf"><option value="">Beide bedrijven</option><option value="nextgenmedia">NextGenMedia</option><option value="nextgensolutions">NextGenSolutions</option></select>
      <p className="text-xs text-gray-500">{zelf ? 'Dit is jouw domein: het wordt meteen bewaard als beslist, zonder stemming.' : eigenaar ? `${eigenaar} beslist hierover.` : 'Twee van de drie stemmen beslissen.'}</p>
      <button type="button" disabled={bezig} onClick={async () => { setBezig(true); try { await api('/api/admin/ritme', { actie: 'beslissing.nieuw', ...v }); toast.success(zelf ? 'Beslist.' : 'Voorgelegd.'); onBewaard() } catch (e) { toast.error((e as Error).message) } finally { setBezig(false) } }} className="btn-primary w-full justify-center">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{knop}</button>
    </Venster>
  )
}

// ── Beloftes ───────────────────────────────────────────────────────────────

function Beloftes() {
  const [d, setD] = useState<{ beloftes: Belofte[]; vandaag: string } | null>(null)
  useEffect(() => { api<{ beloftes: Belofte[]; vandaag: string }>('/api/admin/ritme?deel=beloftes').then(setD).catch((e) => toast.error(e.message)) }, [])
  if (!d) return <div className="card-base py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const groepen = beloftesPerPersoon(d.beloftes, d.vandaag)
  return (
    <div className="card-base space-y-3">
      <h2 className="font-semibold">Beloftes per persoon</h2>
      <p className="text-xs text-gray-500">Wie wat beloofde, aan wie en tegen wanneer: uit het weekoverleg en uit taken met "beloofd aan".</p>
      {!groepen.length ? <p className="text-sm text-gray-500">Geen open beloftes.</p> : groepen.map((g) => (
        <div key={g.wie}>
          <div className="flex items-baseline gap-2"><span className="font-semibold text-sm">{g.wie}</span><span className="text-xs text-gray-500">{g.open} open{g.teLaat ? ` · ${g.teLaat} te laat` : ''}</span></div>
          <ul className="mt-1 space-y-0.5">{g.lijst.map((b) => <li key={b.id} className="text-sm flex gap-2"><span className="flex-1">{b.wat} <span className="text-gray-500">· aan {b.aan_wie}</span></span>{b.tegen && <span className={`text-xs shrink-0 ${b.teLaat ? 'text-red-700 font-semibold' : 'text-gray-500'}`}>{b.teLaat ? 'te laat · ' : ''}{dagKort(b.tegen)}</span>}</li>)}</ul>
        </div>
      ))}
    </div>
  )
}

// ── Bouwsteen ──────────────────────────────────────────────────────────────

function Venster({ titel, onSluit, children }: { titel: string; onSluit: () => void; children: React.ReactNode }) {
  return (
    <NaarBody>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onSluit}>
        <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titel}>
          <div className="flex items-center justify-between"><h3 className="font-semibold">{titel}</h3><button type="button" onClick={onSluit} aria-label="Sluiten" className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"><X className="h-4 w-4" /></button></div>
          {children}
        </div>
      </div>
    </NaarBody>
  )
}
