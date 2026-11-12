'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ListTodo, Plus, Loader2, ExternalLink, RotateCcw, X, Check, UserRound } from 'lucide-react'
import { MERKEN, MAX_NOTITIE, MAX_OMSCHRIJVING, merkNaam, statusToon } from '@/lib/sales/lead-taken'

/**
 * Taken in ClickUp, bij een lead (leadfiche) of een opdracht (kaartvenster).
 * "Taak toevoegen" maakt een gewone ClickUp-taak (deadline, geen agenda-item)
 * in de lijst van NextGen Media of NextGen Solutions, toegewezen aan de
 * verantwoordelijke, met een link terug naar de lead of de opdracht. De lijst
 * toont status en verantwoordelijke zoals ClickUp ze nu heeft; de
 * verantwoordelijke wijzigen past ook ClickUp aan.
 */

type Taak = {
  id: string; omschrijving: string; notitie: string | null; deadline: string | null; merk: string
  clickup_assignee_naam: string | null; clickup_task_id: string | null; clickup_url: string | null
  clickup_status: string | null; clickup_status_kleur: string | null; clickup_status_type: string | null
  sync_status: 'wacht' | 'ok' | 'fout'; sync_fout: string | null; created_at: string; created_by_email: string | null
}
type Opties = { ingesteld: boolean; leden: { id: number; naam: string }[]; lijsten: { merk: string; naam: string; ok: boolean; probleem: string | null }[]; ik: number | null; standaard?: number | null }
type Taak2 = Taak & { clickup_assignee_id: number | null }

const nieuweSleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '')
const datum = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j as T
}

/** Leadfiche: taken bij deze lead. */
export function LeadTaken({ leadId, standaardMerk, onGewijzigd }: { leadId: string; standaardMerk: string | null; onGewijzigd: () => void }) {
  return <ClickupTaken api={`/api/admin/sales/leads/${leadId}/taken`} waarbij="lead" standaardMerk={standaardMerk} onGewijzigd={onGewijzigd} />
}

export function ClickupTaken({ api: basis, waarbij, standaardMerk, onGewijzigd, titel = 'Taken' }: { api: string; waarbij: 'lead' | 'opdracht'; standaardMerk: string | null; onGewijzigd?: () => void; titel?: string }) {
  const [taken, setTaken] = useState<Taak2[] | null>(null)
  const [opties, setOpties] = useState<Opties | null>(null)
  const [wijzig, setWijzig] = useState<string | null>(null)
  const [statusFout, setStatusFout] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)

  const laad = useCallback(async () => {
    try {
      const j = await api<{ taken: Taak2[]; statusFout: string | null }>(basis)
      setTaken(j.taken); setStatusFout(j.statusFout)
    } catch (e) { setTaken([]); setStatusFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [basis])
  useEffect(() => { setTaken(null); laad() }, [laad])

  const opnieuw = async (t: Taak) => {
    setBezig(t.id)
    try {
      const j = await api<{ taak: Taak }>(basis, { method: 'PATCH', body: JSON.stringify({ taak_id: t.id, actie: 'opnieuw' }) })
      if (j.taak.sync_status === 'ok') toast.success('Taak staat nu in ClickUp.')
      else toast.error(j.taak.sync_fout ?? 'Nog steeds niet gelukt.')
      await laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  // Verantwoordelijke wijzigen: de ClickUp-leden pas laden als iemand erop klikt.
  const openWijzig = async (t: Taak2) => {
    setWijzig(t.id)
    if (!opties) {
      try { setOpties(await api<Opties>(`${basis}?opties=1`)) } catch (e) { toast.error(e instanceof Error ? e.message : 'ClickUp-leden niet te laden'); setWijzig(null) }
    }
  }
  const zetVerantwoordelijke = async (t: Taak2, lid: string) => {
    if (!lid || Number(lid) === t.clickup_assignee_id) { setWijzig(null); return }
    setBezig(t.id)
    try {
      const j = await api<{ taak: Taak2 }>(basis, { method: 'PATCH', body: JSON.stringify({ taak_id: t.id, actie: 'verantwoordelijke', assignee_id: Number(lid) }) })
      setTaken((l) => (l ?? []).map((x) => (x.id === t.id ? j.taak : x)))
      toast.success(j.taak.sync_status === 'ok' ? `${j.taak.clickup_assignee_naam} staat nu ook in ClickUp op de taak.` : `Verantwoordelijke is nu ${j.taak.clickup_assignee_naam}.`)
      setWijzig(null); onGewijzigd?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] text-gray-400 font-bold flex items-center gap-1"><ListTodo className="h-3 w-3" />{titel}</h3>
        {!open && <button type="button" onClick={() => setOpen(true)} className="btn-secondary !py-1 !px-2 text-xs"><Plus className="h-3.5 w-3.5" />Taak toevoegen</button>}
      </div>
      {open && <NieuweTaak basis={basis} waarbij={waarbij} standaardMerk={standaardMerk} onSluit={() => setOpen(false)} onKlaar={() => { setOpen(false); laad(); onGewijzigd?.() }} />}
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
                      {' · '}{merkNaam(t.merk)}
                    </p>
                    {wijzig === t.id ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <select autoFocus className="input-base !py-1 text-xs max-w-[14rem]" aria-label="Verantwoordelijke" disabled={!opties || bezig === t.id}
                          defaultValue={t.clickup_assignee_id ? String(t.clickup_assignee_id) : ''} onChange={(e) => zetVerantwoordelijke(t, e.target.value)}>
                          <option value="">{opties ? 'Kies…' : 'Laden…'}</option>
                          {opties?.leden.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
                        </select>
                        {bezig === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : <button type="button" onClick={() => setWijzig(null)} className="text-[11px] underline text-gray-500">Annuleer</button>}
                      </div>
                    ) : (
                      <button type="button" onClick={() => openWijzig(t)} title="Verantwoordelijke wijzigen (ook in ClickUp)"
                        className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-gray-700 hover:text-black rounded px-1 -mx-1 hover:bg-white">
                        <UserRound className="h-3 w-3" />{t.clickup_assignee_naam || 'Nog niemand'}<span className="text-gray-400 underline underline-offset-2">wijzig</span>
                      </button>
                    )}
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

function NieuweTaak({ basis, waarbij, standaardMerk, onSluit, onKlaar }: { basis: string; waarbij: 'lead' | 'opdracht'; standaardMerk: string | null; onSluit: () => void; onKlaar: () => void }) {
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
    api<Opties>(`${basis}?opties=1`)
      .then((o) => { setOpties(o); const st = o.standaard ?? o.ik; if (st) setLid(String(st)) })
      .catch((e) => setOptieFout(e instanceof Error ? e.message : 'ClickUp-leden niet te laden'))
  }, [basis])

  const lijst = opties?.lijsten.find((l) => l.merk === merk)
  const probleem = omschrijving.trim().length < 2 ? 'Geef de taak een omschrijving.' : !deadline ? 'Kies een deadline.' : deadline < vandaag() ? 'De deadline ligt in het verleden.'
    : !lid ? 'Kies wie verantwoordelijk is.' : lijst && !lijst.ok ? lijst.probleem : null

  async function bewaar() {
    if (probleem) { setFout(probleem); return }
    setBezig(true); setFout(null)
    try {
      const j = await api<{ taak: Taak }>(basis, {
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
        <label className="block"><span className={lbl}>Verantwoordelijke</span>
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
      {lijst && !lijst.ok && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5" role="alert">{lijst.probleem}</p>}
      <label className="block"><span className={lbl}>Notitie <span className="font-normal text-gray-400">(extra uitleg, optioneel)</span></span>
        <textarea rows={3} className="input-base text-sm" value={notitie} maxLength={MAX_NOTITIE} onChange={(e) => setNotitie(e.target.value)} placeholder="Wat moet er gebeuren, wat weten we al?" />
      </label>
      <p className="text-[11px] text-gray-500">Wordt een gewone taak in ClickUp (geen agenda-item), toegewezen aan de verantwoordelijke, met een link naar deze {waarbij === 'lead' ? 'lead' : 'opdracht'}.</p>
      {optieFout && <p className="text-xs text-red-700">{optieFout}</p>}
      {opties && !opties.ingesteld && <p className="text-xs text-red-700">ClickUp is niet gekoppeld; een taak aanmaken lukt nu niet.</p>}
      {fout && <p className="text-xs text-red-700" role="alert">{fout}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={bewaar} disabled={bezig || !opties?.ingesteld || (!!lijst && !lijst.ok)} className="btn-primary text-xs">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Taak aanmaken</button>
        <button type="button" onClick={onSluit} className="btn-secondary text-xs">Annuleer</button>
      </div>
    </div>
  )
}
