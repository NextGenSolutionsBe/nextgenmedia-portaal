'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ListTodo, Plus, Loader2, Check, ExternalLink, X, RotateCcw, AlertTriangle } from 'lucide-react'
import { deadlineTekst } from '@/lib/sales/lead-taken'
import { MERK_STIJL } from '@/lib/merk-mail'

type Taak = {
  id: string; soort: 'team' | 'opdracht'; omschrijving: string; notitie: string | null; deadline: string | null; merk: string
  clickup_assignee_id: number | null; clickup_assignee_naam: string | null; clickup_url: string | null; clickup_status: string | null
  sync_status: 'wacht' | 'ok' | 'fout'; sync_fout: string | null; klant_naam?: string | null; created_by_email: string | null
  project: { id: string; titel: string; klant: string | null } | null
}
type Lid = { id: number; naam: string; email: string }
type Opties = { ingesteld: boolean; leden: Lid[]; lijsten: { merk: string; naam: string; ok: boolean; probleem: string | null }[]; ik: number | null }

const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const plusDagen = (n: number) => { const d = new Date(`${vandaag()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const voornaam = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0] || '—'
const MERKEN = [
  { key: 'nextgenmedia', label: 'NextGenMedia', kleur: MERK_STIJL.nextgenmedia.accent, tekst: '#111111' },
  { key: 'nextgensolutions', label: 'NextGenSolutions', kleur: MERK_STIJL.nextgensolutions.accent, tekst: '#ffffff' },
] as const

async function api<T>(init?: RequestInit, qs = ''): Promise<T> {
  const r = await fetch(`/api/admin/taken${qs}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j as T
}

/**
 * Taken in het Command Center: wie moet wat doen, en een taak toewijzen in een
 * paar klikken. Alles staat ook in ClickUp (lijst van NextGenMedia of
 * NextGenSolutions), toegewezen aan de gekozen persoon. Afvinken sluit de taak
 * in ClickUp.
 */
export function TakenBlok() {
  const [taken, setTaken] = useState<Taak[] | null>(null)
  const [statusFout, setStatusFout] = useState<string | null>(null)
  const [opties, setOpties] = useState<Opties | null>(null)
  const [wie, setWie] = useState<number | 'mij' | null>(null)
  const [nieuw, setNieuw] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)

  const laad = useCallback(async () => {
    try {
      const j = await api<{ taken: Taak[]; statusFout: string | null }>()
      setTaken(j.taken); setStatusFout(j.statusFout)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Taken laden mislukt'); setTaken([]) }
  }, [])
  useEffect(() => { void laad() }, [laad])
  useEffect(() => { api<Opties>(undefined, '?opties=1').then(setOpties).catch(() => setOpties(null)) }, [])

  const mensen = useMemo(() => {
    const m = new Map<number, string>()
    for (const t of taken ?? []) if (t.clickup_assignee_id) m.set(t.clickup_assignee_id, voornaam(t.clickup_assignee_naam))
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [taken])
  const ik = opties?.ik ?? null
  const zichtbaar = useMemo(() => (taken ?? []).filter((t) => wie === null || (wie === 'mij' ? t.clickup_assignee_id === ik : t.clickup_assignee_id === wie)), [taken, wie, ik])
  const vd = vandaag()

  const af = async (t: Taak) => {
    setBezig(t.id)
    try {
      await api({ method: 'PATCH', body: JSON.stringify({ taak_id: t.id, soort: t.soort, actie: 'af' }) })
      setTaken((l) => (l ?? []).filter((x) => x.id !== t.id))
      toast.success('Afgevinkt, ook in ClickUp.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Afvinken mislukt') } finally { setBezig(null) }
  }
  const opnieuw = async (t: Taak) => {
    setBezig(t.id)
    try {
      const j = await api<{ taak: Taak }>({ method: 'PATCH', body: JSON.stringify({ taak_id: t.id, soort: t.soort, actie: 'opnieuw' }) })
      setTaken((l) => (l ?? []).map((x) => (x.id === t.id ? { ...x, ...j.taak } : x)))
      if (j.taak.sync_status === 'ok') toast.success('Staat nu in ClickUp.'); else toast.error(j.taak.sync_fout ?? 'Nog niet in ClickUp')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const chip = (aan: boolean) => `text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${aan ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`

  return (
    <section className="card-base !p-4" aria-labelledby="taken-kop">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <ListTodo className="h-4 w-4 text-gray-500" />
        <h2 id="taken-kop" className="text-sm font-semibold text-gray-900">Taken</h2>
        <span className={`min-w-[1.75rem] text-center rounded-full px-2 py-0.5 text-xs font-bold ${zichtbaar.length ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'}`}>{taken === null ? '…' : zichtbaar.length}</span>
        <button type="button" onClick={() => setNieuw(true)} className="btn-primary text-xs h-8 ml-auto"><Plus className="h-3.5 w-3.5" />Taak toewijzen</button>
      </div>

      {(taken?.length ?? 0) > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
          <button type="button" onClick={() => setWie(null)} className={chip(wie === null)}>Iedereen</button>
          {ik && <button type="button" onClick={() => setWie('mij')} className={chip(wie === 'mij')}>Mijn taken</button>}
          {mensen.filter(([id]) => id !== ik).map(([id, naam]) => <button key={id} type="button" onClick={() => setWie(id)} className={chip(wie === id)}>{naam}</button>)}
        </div>
      )}

      {statusFout && <p className="text-[11px] text-amber-700 mb-2">{statusFout}</p>}

      {taken === null ? (
        <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
      ) : zichtbaar.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">{taken.length ? 'Niets voor deze persoon.' : 'Geen open taken. Wijs er een toe met de knop hierboven.'}</p>
      ) : (
        <ul className="divide-y divide-gray-100 -mx-1">
          {zichtbaar.slice(0, 12).map((t) => {
            const dl = deadlineTekst(t.deadline, vd)
            const merk = MERKEN.find((m) => m.key === t.merk) ?? MERKEN[0]
            const context = t.project ? [t.project.klant, t.project.titel].filter(Boolean).join(' – ') : t.klant_naam
            return (
              <li key={`${t.soort}-${t.id}`} className="flex items-start gap-2.5 px-1 py-2">
                <button type="button" onClick={() => af(t)} disabled={bezig === t.id || t.sync_status !== 'ok'} title={t.sync_status === 'ok' ? 'Afvinken (ook in ClickUp)' : 'Staat nog niet in ClickUp'}
                  className="mt-0.5 h-5 w-5 rounded-full border-2 border-gray-300 hover:border-emerald-500 hover:bg-emerald-50 flex items-center justify-center shrink-0 disabled:opacity-40 group">
                  {bezig === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 text-emerald-600 opacity-0 group-hover:opacity-100" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 leading-snug">{t.omschrijving}</p>
                  <p className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                    <span className="h-2 w-2 rounded-full shrink-0 ring-1 ring-black/10" style={{ background: merk.kleur }} title={merk.label} />
                    <span className="font-medium text-gray-700">{voornaam(t.clickup_assignee_naam)}</span>
                    <span className={dl.telaat ? 'text-red-700 font-medium' : dl.vandaag ? 'text-amber-700 font-medium' : ''}>· {dl.tekst}</span>
                    {context && (t.project
                      ? <Link href={`/admin/opdrachten?opdracht=${t.project.id}`} className="truncate max-w-[14rem] hover:text-black underline decoration-gray-300">· {context}</Link>
                      : <span className="truncate max-w-[14rem]">· {context}</span>)}
                  </p>
                  {t.sync_status === 'fout' && (
                    <p className="text-[11px] text-red-700 mt-0.5 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-px shrink-0" />{t.sync_fout ?? 'Niet in ClickUp'}
                      {t.soort === 'team' && <button type="button" onClick={() => opnieuw(t)} className="underline ml-1 inline-flex items-center gap-0.5"><RotateCcw className="h-3 w-3" />Opnieuw</button>}
                    </p>
                  )}
                </div>
                {t.clickup_url && <a href={t.clickup_url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-800 p-1" title="Openen in ClickUp"><ExternalLink className="h-3.5 w-3.5" /></a>}
              </li>
            )
          })}
        </ul>
      )}
      {zichtbaar.length > 12 && <p className="text-xs text-gray-500 mt-1">+ {zichtbaar.length - 12} andere taken in ClickUp.</p>}

      {nieuw && <TaakToewijzen opties={opties} onSluit={() => setNieuw(false)} onKlaar={(t) => { setNieuw(false); setTaken((l) => [t, ...(l ?? [])].sort((a, b) => String(a.deadline ?? '9999').localeCompare(String(b.deadline ?? '9999')))) }} />}
    </section>
  )
}

function TaakToewijzen({ opties, onSluit, onKlaar }: { opties: Opties | null; onSluit: () => void; onKlaar: (t: Taak) => void }) {
  const [omschrijving, setOmschrijving] = useState('')
  const [assignee, setAssignee] = useState<number | null>(null)
  const [merk, setMerk] = useState<'nextgenmedia' | 'nextgensolutions'>('nextgenmedia')
  const [deadline, setDeadline] = useState(plusDagen(1))
  const [notitie, setNotitie] = useState('')
  const [bezig, setBezig] = useState(false)
  const [sleutel] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000'))
  const lijst = opties?.lijsten.find((l) => l.merk === merk)

  // Zaakvoerders eerst, dan de rest van ClickUp. Dezelfde voornaam twee keer? Dan de volledige naam.
  const VOORAAN = ['bram', 'marco', 'chiara']
  const leden = [...(opties?.leden ?? [])].sort((a, b) => {
    const ia = VOORAAN.indexOf(voornaam(a.naam).toLowerCase()), ib = VOORAAN.indexOf(voornaam(b.naam).toLowerCase())
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.naam.localeCompare(b.naam)
  })
  const dubbel = new Set(leden.map((l) => voornaam(l.naam).toLowerCase()).filter((v, i, a) => a.indexOf(v) !== i))
  const label = (l: Lid) => (dubbel.has(voornaam(l.naam).toLowerCase()) ? l.naam : voornaam(l.naam))
  const snelkeuze = [
    { label: 'Vandaag', dag: plusDagen(0) }, { label: 'Morgen', dag: plusDagen(1) }, { label: 'Over een week', dag: plusDagen(7) },
  ]

  const bewaar = async () => {
    if (omschrijving.trim().length < 2) { toast.error('Wat moet er gebeuren?'); return }
    if (!assignee) { toast.error('Kies voor wie de taak is.'); return }
    setBezig(true)
    try {
      const j = await api<{ taak: Taak }>({ method: 'POST', body: JSON.stringify({ aanvraag_sleutel: sleutel, omschrijving, deadline, notitie, assignee_id: assignee, merk }) })
      if (j.taak.sync_status === 'ok') toast.success(`Taak voor ${voornaam(j.taak.clickup_assignee_naam)} staat in ClickUp.`)
      else toast.error(j.taak.sync_fout ?? 'Bewaard, maar nog niet in ClickUp.')
      onKlaar({ ...j.taak, soort: 'team', project: null })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toewijzen mislukt'); setBezig(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onSluit}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Taak toewijzen">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">Taak toewijzen</h3>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {!opties ? <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div> : !opties.ingesteld ? (
            <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">ClickUp is niet gekoppeld. Taken toewijzen kan pas als de ClickUp-sleutel ingesteld is.</p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="taak-wat">Wat moet er gebeuren?</label>
                <input id="taak-wat" className="input-base" value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} maxLength={200} placeholder="Bv. Offerte website Apex Fuel nakijken" autoFocus />
              </div>

              <div>
                <span className="block text-xs font-medium text-gray-600 mb-1">Voor wie?</span>
                <div className="flex flex-wrap gap-1.5">
                  {leden.map((l) => (
                    <button key={l.id} type="button" onClick={() => setAssignee(l.id)} aria-pressed={assignee === l.id}
                      className={`text-sm px-3 py-1.5 rounded-full border ${assignee === l.id ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                      {label(l)}{l.id === opties.ik ? ' (ik)' : ''}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-gray-600 mb-1">Voor welk bedrijf?</span>
                <div className="grid grid-cols-2 gap-2">
                  {MERKEN.map((m) => (
                    <button key={m.key} type="button" onClick={() => setMerk(m.key)} aria-pressed={merk === m.key}
                      className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold text-left transition ${merk === m.key ? 'shadow-sm' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}
                      style={merk === m.key ? { background: m.kleur, borderColor: m.kleur, color: m.tekst } : undefined}>
                      {m.label}
                    </button>
                  ))}
                </div>
                {lijst && !lijst.ok && <p className="text-[11px] text-red-700 mt-1">{lijst.probleem}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="taak-deadline">Deadline</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {snelkeuze.map((k) => (
                    <button key={k.label} type="button" onClick={() => setDeadline(k.dag)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${deadline === k.dag ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{k.label}</button>
                  ))}
                  <input id="taak-deadline" type="date" className="input-base !w-auto text-sm" min={plusDagen(0)} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="taak-notitie">Notitie <span className="text-gray-400 font-normal">(optioneel)</span></label>
                <textarea id="taak-notitie" rows={2} className="input-base" value={notitie} onChange={(e) => setNotitie(e.target.value)} maxLength={5000} placeholder="Extra uitleg of een link" />
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <span className="text-[11px] text-gray-500 mr-auto">Komt in ClickUp, toegewezen aan die persoon.</span>
          <button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button>
          <button type="button" onClick={bewaar} disabled={bezig || !opties?.ingesteld || !assignee || omschrijving.trim().length < 2 || (lijst ? !lijst.ok : false)} className="btn-primary">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Toewijzen
          </button>
        </div>
      </div>
    </div>
  )
}
