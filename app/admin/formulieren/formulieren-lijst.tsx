'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Search, Loader2, ClipboardPen, X, FileText, LayoutTemplate, Sparkles, Archive, Send, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DIENSTEN, dienstLabel, FORMULIER_STATUS_INFO, SJABLONEN, isAntwoordVeld, type FormulierStatus,
} from '@/lib/formulieren/model'
import { AiVoorstelPaneel } from '@/components/formulieren/ai-voorstel'

type Rij = {
  id: string; titel: string; dienst: string; doel: string | null; status: FormulierStatus
  created_at: string; updated_at: string; gearchiveerd_op: string | null
  aantal_velden: number; inzendingen: number; nieuw: number; laatste_inzending: string | null; actieve_links: number
}

const datum = (s: string | null) => (s ? new Date(s).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

export function FormulierenLijst({ klantId }: { klantId: string | null }) {
  const router = useRouter()
  const [rijen, setRijen] = useState<Rij[]>([])
  const [laden, setLaden] = useState(true)
  const [hint, setHint] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [dienst, setDienst] = useState('')
  const [status, setStatus] = useState<FormulierStatus | ''>('')
  const [archief, setArchief] = useState(false)
  const [nieuw, setNieuw] = useState(false)
  const [klantNaam, setKlantNaam] = useState<string | null>(null)

  const laad = useCallback(async () => {
    setLaden(true); setHint(null)
    try {
      const r = await fetch(`/api/admin/formulieren${archief ? '?archief=1' : ''}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) { if (j.code === 'migratie') setHint(j.error); else throw new Error(j.error); setRijen([]); return }
      setRijen(j.formulieren ?? [])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [archief])
  useEffect(() => { laad() }, [laad])

  useEffect(() => {
    if (!klantId) return
    fetch('/api/admin/clients-list').then((r) => r.json()).then((j) => {
      const k = (j.clients ?? []).find((c: { id: string }) => c.id === klantId)
      setKlantNaam(k?.company_name ?? null)
    }).catch(() => {})
  }, [klantId])

  const zichtbaar = useMemo(() => {
    const naald = q.trim().toLowerCase()
    return rijen.filter((r) =>
      (!dienst || r.dienst === dienst) && (!status || r.status === status) &&
      (!naald || `${r.titel} ${r.doel ?? ''}`.toLowerCase().includes(naald)))
  }, [rijen, q, dienst, status])

  const doelHref = (id: string) => `/admin/formulieren/${id}${klantId ? `?tab=delen&klant=${klantId}` : ''}`
  const totaalNieuw = rijen.reduce((s, r) => s + r.nieuw, 0)

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardPen className="h-6 w-6" />Formulieren</h1>
          <p className="text-sm text-gray-500 mt-0.5">Intakeformulieren voor huisstijl, grafisch ontwerp en meer — deel een link, ontvang de antwoorden hier.</p>
        </div>
        <div className="page-header-actions">
          <button onClick={() => setNieuw(true)} className="btn-primary"><Plus className="h-4 w-4" />Nieuw formulier</button>
        </div>
      </div>

      {klantId && (
        <div className="rounded-xl border border-[#fff848] bg-[#fff848]/15 px-4 py-3 text-sm flex items-center gap-2 flex-wrap">
          <Send className="h-4 w-4 shrink-0" />
          <span className="flex-1 min-w-[12rem]">Kies een formulier om naar <strong>{klantNaam ?? 'deze klant'}</strong> te sturen — je komt meteen bij <em>Delen</em> met de klant ingevuld.</span>
          <Link href="/admin/formulieren" className="text-xs text-gray-600 underline">Annuleren</Link>
        </div>
      )}

      {hint && <div className="card-base text-sm text-amber-800 bg-amber-50 border-amber-200">{hint}</div>}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input-base pl-9" placeholder="Zoeken op titel of doel…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input-base w-auto" value={dienst} onChange={(e) => setDienst(e.target.value)} aria-label="Dienst">
          <option value="">Alle diensten</option>
          {DIENSTEN.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <select className="input-base w-auto" value={status} onChange={(e) => setStatus(e.target.value as FormulierStatus | '')} aria-label="Status">
          <option value="">Alle statussen</option>
          {Object.entries(FORMULIER_STATUS_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={() => setArchief((a) => !a)} className={cn('btn-secondary', archief && 'ring-2 ring-gray-300')}><Archive className="h-4 w-4" />{archief ? 'Archief' : 'Archief tonen'}</button>
      </div>

      {totaalNieuw > 0 && !archief && (
        <div className="text-sm text-gray-600 flex items-center gap-1.5"><Inbox className="h-4 w-4" /><strong>{totaalNieuw}</strong> nieuwe inzending{totaalNieuw === 1 ? '' : 'en'} om te bekijken</div>
      )}

      {laden ? (
        <div className="card-base empty-state"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : zichtbaar.length === 0 ? (
        <div className="card-base empty-state">
          <ClipboardPen className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">{rijen.length === 0 ? (archief ? 'Geen gearchiveerde formulieren.' : 'Nog geen formulieren. Start met een sjabloon of laat AI de velden voorstellen.') : 'Geen formulieren voor deze filter.'}</p>
          {rijen.length === 0 && !archief && <button onClick={() => setNieuw(true)} className="btn-primary mt-4"><Plus className="h-4 w-4" />Nieuw formulier</button>}
        </div>
      ) : (
        <div className="card-base !p-0 overflow-hidden">
          <div className="table-wrap">
            <table className="w-full">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="table-th">Formulier</th>
                  <th className="table-th hidden sm:table-cell">Dienst</th>
                  <th className="table-th">Status</th>
                  <th className="table-th text-right">Inzendingen</th>
                  <th className="table-th hidden md:table-cell">Laatste inzending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {zichtbaar.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(doelHref(r.id))}>
                    <td className="table-td">
                      <Link href={doelHref(r.id)} className="font-medium text-gray-900 hover:underline" onClick={(e) => e.stopPropagation()}>{r.titel}</Link>
                      <div className="text-xs text-gray-400">{r.doel ? `${r.doel} · ` : ''}{r.aantal_velden} velden · {r.actieve_links} link{r.actieve_links === 1 ? '' : 's'}</div>
                    </td>
                    <td className="table-td hidden sm:table-cell"><span className="status-badge bg-gray-100 text-gray-700">{dienstLabel(r.dienst)}</span></td>
                    <td className="table-td"><span className={cn('status-badge', FORMULIER_STATUS_INFO[r.status]?.kleur)}>{FORMULIER_STATUS_INFO[r.status]?.label ?? r.status}</span></td>
                    <td className="table-td text-right tabular">
                      {r.inzendingen}
                      {r.nieuw > 0 && <span className="ml-2 status-badge bg-[#fff848] text-black">{r.nieuw} nieuw</span>}
                    </td>
                    <td className="table-td hidden md:table-cell text-gray-500">{datum(r.laatste_inzending)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {nieuw && <NieuwDialoog onClose={() => setNieuw(false)} onGemaakt={(id) => router.push(doelHref(id))} />}
    </div>
  )
}

function NieuwDialoog({ onClose, onGemaakt }: { onClose: () => void; onGemaakt: (id: string) => void }) {
  const [modus, setModus] = useState<'leeg' | 'sjabloon' | 'ai'>('sjabloon')
  const [titel, setTitel] = useState('')
  const [dienst, setDienst] = useState('algemeen')
  const [bezig, setBezig] = useState(false)

  const maak = async (body: Record<string, unknown>) => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/formulieren', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Formulier aangemaakt (concept)')
      onGemaakt(j.id)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Aanmaken mislukt') } finally { setBezig(false) }
  }

  const tabs = [
    { key: 'sjabloon' as const, label: 'Sjabloon', icon: LayoutTemplate },
    { key: 'ai' as const, label: 'Met AI', icon: Sparkles },
    { key: 'leeg' as const, label: 'Leeg', icon: FileText },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Nieuw formulier">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl modal-panel">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 className="font-semibold flex items-center gap-2"><Plus className="h-4 w-4" />Nieuw formulier</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setModus(t.key)} className={cn('px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 font-medium', modus === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-800')}>
                <t.icon className="h-4 w-4" />{t.label}
              </button>
            ))}
          </div>

          {modus === 'sjabloon' && (
            <div className="grid sm:grid-cols-3 gap-3">
              {SJABLONEN.map((s) => (
                <button key={s.key} disabled={bezig} onClick={() => maak({ sjabloon: s.key })} className="text-left rounded-xl border border-gray-200 p-4 hover:border-gray-900 hover:bg-[#fff848]/10 transition-colors disabled:opacity-50">
                  <div className="font-semibold text-sm text-gray-900">{s.titel}</div>
                  <div className="text-xs text-gray-500 mt-1 line-clamp-3">{s.beschrijving}</div>
                  <div className="text-[11px] text-gray-400 mt-2">{dienstLabel(s.dienst)} · {s.velden.filter((v) => isAntwoordVeld(v.type)).length} vragen</div>
                </button>
              ))}
            </div>
          )}

          {modus === 'ai' && (
            <AiVoorstelPaneel acties={(v, ctx) => (
              <button disabled={bezig} onClick={() => maak({ titel: v.titel, beschrijving: v.beschrijving, velden: v.velden, dienst: ctx.dienst, doel: ctx.doel })} className="btn-primary">
                {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Formulier aanmaken met dit voorstel
              </button>
            )} />
          )}

          {modus === 'leeg' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Titel</label>
                <input className="input-base" value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="bv. Intake website" maxLength={200} autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Voor welke dienst?</label>
                <select className="input-base" value={dienst} onChange={(e) => setDienst(e.target.value)}>
                  {DIENSTEN.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>
              <button disabled={bezig} onClick={() => maak({ titel, dienst })} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Leeg formulier aanmaken</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
