'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ListTodo, Plus, Loader2, ExternalLink, RotateCcw, X, Check } from 'lucide-react'
import { MERKEN, MAX_NOTITIE, MAX_OMSCHRIJVING, merkNaam, statusToon } from '@/lib/sales/lead-taken'

/**
 * Leadfiche — taken in ClickUp. "Taak toevoegen" maakt een gewone ClickUp-taak
 * (deadline, geen agenda-item) in de lijst van NextGen Media of NextGen
 * Solutions, toegewezen aan het gekozen lid, met een link terug naar deze lead.
 * De lijst toont de status zoals ClickUp ze nu heeft.
 */

type Taak = {
  id: string; omschrijving: string; notitie: string | null; deadline: string | null; merk: string
  clickup_assignee_naam: string | null; clickup_task_id: string | null; clickup_url: string | null
  clickup_status: string | null; clickup_status_kleur: string | null; clickup_status_type: string | null
  sync_status: 'wacht' | 'ok' | 'fout'; sync_fout: string | null; created_at: string; created_by_email: string | null
}
type Opties = { ingesteld: boolean; leden: { id: number; naam: string }[]; lijsten: { merk: string; naam: string; ok: boolean }[]; ik: number | null }

const nieuweSleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '')
const datum = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j as T
}

export function LeadTaken({ leadId, standaardMerk, onGewijzigd }: { leadId: string; standaardMerk: string | null; onGewijzigd: () => void }) {
  const [taken, setTaken] = useState<Taak[] | null>(null)
  const [statusFout, setStatusFout] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)

  const laad = useCallback(async () => {
    try {
      const j = await api<{ taken: Taak[]; statusFout: string | null }>(`/api/admin/sales/leads/${leadId}/taken`)
      setTaken(j.taken); setStatusFout(j.statusFout)
    } catch (e) { setTaken([]); setStatusFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [leadId])
  useEffect(() => { setTaken(null); laad() }, [laad])

  const opnieuw = async (t: Taak) => {
    setBezig(t.id)
    try {
      const j = await api<{ taak: Taak }>(`/api/admin/sales/leads/${leadId}/taken`, { method: 'PATCH', body: JSON.stringify({ taak_id: t.id, actie: 'opnieuw' }) })
      if (j.taak.sync_status === 'ok') toast.success('Taak staat nu in ClickUp.')
      else toast.error(j.taak.sync_fout ?? 'Nog steeds niet gelukt.')
      await laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] text-gray-400 font-bold flex items-center gap-1"><ListTodo className="h-3 w-3" />Taken</h3>
        {!open && <button type="button" onClick={() => setOpen(true)} className="btn-secondary !py-1 !px-2 text-xs"><Plus className="h-3.5 w-3.5" />Taak toevoegen</button>}
      </div>
      {open && <NieuweTaak leadId={leadId} standaardMerk={standaardMerk} onSluit={() => setOpen(false)} onKlaar={() => { setOpen(false); laad(); onGewijzigd() }} />}
      {statusFout && <p className="text-[11px] text-amber-700 mb-1.5">{statusFout}</p>}
      {taken === null ? (
        <div className="py-2 text-center text-gray-300"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
      ) : taken.length === 0 ? (
        !open && <p className="text-xs text-gray-400">Nog geen taken.</p>
      ) : (
        <ul className="space-y-1.5">
          {taken.map((t) => {
            const s = statusToon(t)
            const telaat = t.deadline && t.deadline < vandaag() && s.toon !== 'ok' && t.sync_status === 'ok'
            return (
              <li key={t.id} className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13px] font-medium break-words ${s.toon === 'ok' ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{t.omschrijving}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {t.deadline && <span className={telaat ? 'text-red-600 font-medium' : ''}>deadline {datum(t.deadline)}{telaat ? ' (te laat)' : ''}</span>}
                      {t.clickup_assignee_naam && <> · {t.clickup_assignee_naam}</>}
                      {' · '}{merkNaam(t.merk)}
                    </p>
                    {t.notitie && <p className="text-[12px] text-gray-700 whitespace-pre-wrap break-words mt-1">{t.notitie}</p>}
                    {t.sync_status === 'fout' && t.sync_fout && <p className="text-[11px] text-red-700 mt-1">{t.sync_fout}</p>}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium ${s.toon === 'fout' ? 'border-red-200 bg-red-50 text-red-700' : s.toon === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-gray-200 bg-white text-gray-700'}`}>
                      {t.clickup_status_kleur && t.sync_status === 'ok' && <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: t.clickup_status_kleur }} />}
                      {s.label}
                    </span>
                    {t.clickup_url && t.sync_status === 'ok' && (
                      <a href={t.clickup_url} target="_blank" rel="noreferrer" className="text-[11px] underline underline-offset-2 inline-flex items-center gap-0.5 text-gray-600 hover:text-black">ClickUp<ExternalLink className="h-3 w-3" /></a>
                    )}
                    {t.sync_status === 'fout' && (
                      <button type="button" onClick={() => opnieuw(t)} disabled={bezig === t.id} className="text-[11px] underline inline-flex items-center gap-0.5">
                        {bezig === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}Opnieuw
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function NieuweTaak({ leadId, standaardMerk, onSluit, onKlaar }: { leadId: string; standaardMerk: string | null; onSluit: () => void; onKlaar: () => void }) {
  const [opties, setOpties] = useState<Opties | null>(null)
  const [optieFout, setOptieFout] = useState<string | null>(null)
  const [omschrijving, setOmschrijving] = useState('')
  const [deadline, setDeadline] = useState('')
  const [notitie, setNotitie] = useState('')
  const [lid, setLid] = useState<string>('')
  const [merk, setMerk] = useState<string>(MERKEN.some((m) => m.key === standaardMerk) ? (standaardMerk as string) : 'nextgenmedia')
  const [sleutel] = useState(nieuweSleutel)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  useEffect(() => {
    api<Opties>(`/api/admin/sales/leads/${leadId}/taken?opties=1`)
      .then((o) => { setOpties(o); if (o.ik) setLid(String(o.ik)) })
      .catch((e) => setOptieFout(e instanceof Error ? e.message : 'ClickUp-leden niet te laden'))
  }, [leadId])

  const lijst = opties?.lijsten.find((l) => l.merk === merk)
  const probleem = omschrijving.trim().length < 2 ? 'Geef de taak een omschrijving.' : !deadline ? 'Kies een deadline.' : deadline < vandaag() ? 'De deadline ligt in het verleden.'
    : !lid ? 'Kies aan wie de taak wordt toegewezen.' : lijst && !lijst.ok ? `Voor ${lijst.naam} is nog geen ClickUp-lijst ingesteld.` : null

  async function bewaar() {
    if (probleem) { setFout(probleem); return }
    setBezig(true); setFout(null)
    try {
      const j = await api<{ taak: Taak }>(`/api/admin/sales/leads/${leadId}/taken`, {
        method: 'POST', body: JSON.stringify({ aanvraag_sleutel: sleutel, omschrijving, deadline, notitie, assignee_id: Number(lid), merk }),
      })
      if (j.taak.sync_status === 'ok') toast.success(`Taak staat in ClickUp (${merkNaam(merk)}).`)
      else toast.error(`Taak bewaard, maar niet in ClickUp: ${j.taak.sync_fout ?? 'onbekende fout'}. Probeer opnieuw vanuit de lijst.`)
      onKlaar()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }

  const lbl = 'block text-[11px] font-medium text-gray-500 mb-0.5'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5 mb-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Taak toevoegen</span>
        <button type="button" onClick={onSluit} aria-label="Sluiten" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>
      <label className="block"><span className={lbl}>Taakomschrijving</span>
        <input className="input-base text-sm" autoFocus value={omschrijving} maxLength={MAX_OMSCHRIJVING} onChange={(e) => setOmschrijving(e.target.value)} placeholder="Bv. Offerte opmaken voor de website" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className={lbl}>Deadline</span>
          <input type="date" className="input-base text-sm" value={deadline} min={vandaag()} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <label className="block"><span className={lbl}>Toewijzen aan (ClickUp)</span>
          <select className="input-base text-sm" value={lid} onChange={(e) => setLid(e.target.value)} disabled={!opties}>
            <option value="">{opties ? 'Kies…' : 'Laden…'}</option>
            {opties?.leden.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
          </select>
        </label>
      </div>
      <div>
        <span className={lbl}>Lijst in ClickUp</span>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Lijst in ClickUp">
          {MERKEN.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={merk === m.key} onClick={() => setMerk(m.key)}
              className={`px-2 py-1.5 text-xs font-semibold rounded-lg border ${merk === m.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{m.naam}</button>
          ))}
        </div>
      </div>
      <label className="block"><span className={lbl}>Notitie <span className="font-normal text-gray-400">(extra uitleg, optioneel)</span></span>
        <textarea rows={3} className="input-base text-sm" value={notitie} maxLength={MAX_NOTITIE} onChange={(e) => setNotitie(e.target.value)} placeholder="Wat moet er gebeuren, wat weten we al?" />
      </label>
      <p className="text-[11px] text-gray-500">Wordt een gewone taak in ClickUp (geen agenda-item), met een link naar deze lead.</p>
      {optieFout && <p className="text-xs text-red-700">{optieFout}</p>}
      {opties && !opties.ingesteld && <p className="text-xs text-red-700">ClickUp is niet gekoppeld; een taak aanmaken lukt nu niet.</p>}
      {fout && <p className="text-xs text-red-700" role="alert">{fout}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={bewaar} disabled={bezig || !opties?.ingesteld} className="btn-primary text-xs">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Taak aanmaken</button>
        <button type="button" onClick={onSluit} className="btn-secondary text-xs">Annuleer</button>
      </div>
    </div>
  )
}
