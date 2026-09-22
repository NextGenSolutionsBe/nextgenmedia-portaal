'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X, Copy, Inbox, Save, Printer, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ExportKnop } from '@/components/admin/export-knop'
import { AntwoordWeergave } from '@/components/formulieren/antwoord-weergave'
import { formulierInzendingenWerkmap } from '@/lib/excel/rapporten/formulieren'
import {
  INZENDING_STATUSSEN, INZENDING_STATUS_INFO, alsTekst, antwoordTekst, isAntwoordVeld, type InzendingStatus, type Veld,
} from '@/lib/formulieren/model'
import type { Formulier, Inzending } from './types'

const datumTijd = (s: string) => new Date(s).toLocaleString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Korte preview: de eerste twee ingevulde antwoorden die geen naam/e-mail zijn. */
function preview(i: Inzending, velden: Veld[]): string {
  const bron = (i.velden_snapshot && i.velden_snapshot.length ? i.velden_snapshot : velden).filter((v) => isAntwoordVeld(v.type) && v.type !== 'email' && v.type !== 'bestand')
  const delen: string[] = []
  for (const v of bron) {
    const t = antwoordTekst(v, i.antwoorden?.[v.id])
    if (!t || t === i.naam) continue
    delen.push(t)
    if (delen.length >= 2) break
  }
  return delen.join(' · ').slice(0, 140)
}

export function InzendingenTab({ formulier, onTellingGewijzigd }: { formulier: Formulier; onTellingGewijzigd: () => void }) {
  const [rijen, setRijen] = useState<Inzending[]>([])
  const [laden, setLaden] = useState(true)
  const [filter, setFilter] = useState<InzendingStatus | ''>('')
  const [open, setOpen] = useState<string | null>(null)

  const laad = useCallback(async () => {
    setLaden(true)
    try {
      const r = await fetch(`/api/admin/formulieren/${formulier.id}/inzendingen`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setRijen(j.inzendingen ?? [])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [formulier.id])
  useEffect(() => { laad() }, [laad])

  const zichtbaar = useMemo(() => rijen.filter((r) => !filter || r.status === filter), [rijen, filter])
  const tel = (s: InzendingStatus) => rijen.filter((r) => r.status === s).length

  const werkRijBij = (id: string, p: Partial<Inzending>) => setRijen((l) => l.map((r) => (r.id === id ? { ...r, ...p } : r)))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg overflow-x-auto">
          <button onClick={() => setFilter('')} className={cn('px-3 py-1.5 text-sm rounded-md font-medium whitespace-nowrap', !filter ? 'bg-white shadow-sm' : 'text-gray-500')}>Alle ({rijen.length})</button>
          {INZENDING_STATUSSEN.map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={cn('px-3 py-1.5 text-sm rounded-md font-medium whitespace-nowrap', filter === s ? 'bg-white shadow-sm' : 'text-gray-500')}>{INZENDING_STATUS_INFO[s].label} ({tel(s)})</button>
          ))}
        </div>
        <div className="ml-auto">
          <ExportKnop
            label="Exporteren naar Excel"
            werkmap={() => formulierInzendingenWerkmap({ titel: formulier.titel, dienst: formulier.dienst, velden: formulier.velden, inzendingen: zichtbaar, filter: filter ? INZENDING_STATUS_INFO[filter].label : undefined })}
          />
        </div>
      </div>

      {laden ? (
        <div className="card-base empty-state"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : zichtbaar.length === 0 ? (
        <div className="card-base empty-state">
          <Inbox className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">{rijen.length === 0 ? 'Nog geen inzendingen. Deel het formulier via het tabblad Delen.' : 'Geen inzendingen met deze status.'}</p>
        </div>
      ) : (
        <div className="card-base !p-0 overflow-hidden">
          <div className="table-wrap">
            <table className="w-full">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="table-th">Datum</th>
                  <th className="table-th">Klant / naam</th>
                  <th className="table-th hidden md:table-cell">E-mail</th>
                  <th className="table-th">Status</th>
                  <th className="table-th hidden lg:table-cell">Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {zichtbaar.map((r) => (
                  <tr key={r.id} onClick={() => setOpen(r.id)} className={cn('cursor-pointer hover:bg-gray-50', r.status === 'nieuw' && 'font-medium')}>
                    <td className="table-td whitespace-nowrap text-gray-600">{datumTijd(r.created_at)}</td>
                    <td className="table-td">
                      <div className="truncate max-w-[220px]">{r.naam ?? '—'}</div>
                      {r.klant_naam && <div className="text-xs text-gray-400 flex items-center gap-1"><Users className="h-3 w-3" />{r.klant_naam}</div>}
                    </td>
                    <td className="table-td hidden md:table-cell text-gray-600 truncate max-w-[220px]">{r.email ?? '—'}</td>
                    <td className="table-td"><span className={cn('status-badge', INZENDING_STATUS_INFO[r.status]?.kleur)}>{INZENDING_STATUS_INFO[r.status]?.label ?? r.status}</span></td>
                    <td className="table-td hidden lg:table-cell text-gray-500 text-xs font-normal truncate max-w-[320px]">{preview(r, formulier.velden)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <InzendingDetail
          formulierId={formulier.id} formulierTitel={formulier.titel} id={open}
          onClose={() => setOpen(null)}
          onGewijzigd={(p) => { werkRijBij(open, p); onTellingGewijzigd() }}
        />
      )}
    </div>
  )
}

type Detail = Inzending & { velden_snapshot: Veld[] }

function InzendingDetail({ formulierId, formulierTitel, id, onClose, onGewijzigd }: {
  formulierId: string; formulierTitel: string; id: string; onClose: () => void; onGewijzigd: (p: Partial<Inzending>) => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [bestanden, setBestanden] = useState<Record<string, string>>({})
  const [notitie, setNotitie] = useState('')
  const [bewaren, setBewaren] = useState(false)

  useEffect(() => {
    let weg = false
    ;(async () => {
      try {
        const r = await fetch(`/api/admin/formulieren/${formulierId}/inzendingen/${id}`, { cache: 'no-store' })
        const j = await r.json(); if (!r.ok) throw new Error(j.error)
        if (weg) return
        setD(j.inzending); setBestanden(j.bestanden ?? {}); setNotitie(j.inzending.admin_notitie ?? '')
        onGewijzigd({ status: j.inzending.status })   // "nieuw" → "gezien" bij openen
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); onClose() }
    })()
    return () => { weg = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulierId, id])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const patch = async (p: { status?: InzendingStatus; admin_notitie?: string }) => {
    setBewaren(true)
    try {
      const r = await fetch(`/api/admin/formulieren/${formulierId}/inzendingen/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setD((x) => (x ? { ...x, ...p } as Detail : x))
      onGewijzigd(p)
      toast.success(p.status ? `Status: ${INZENDING_STATUS_INFO[p.status].label}` : 'Notitie opgeslagen')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBewaren(false) }
  }

  const kopieer = async () => {
    if (!d) return
    const kop = [`${formulierTitel} — ingestuurd op ${datumTijd(d.created_at)}`, d.klant_naam ? `Klant: ${d.klant_naam}` : '', d.naam ? `Naam: ${d.naam}` : '', d.email ? `E-mail: ${d.email}` : ''].filter(Boolean).join('\n')
    try { await navigator.clipboard.writeText(`${kop}\n\n${alsTekst(d.velden_snapshot, d.antwoorden ?? {})}`); toast.success('Gekopieerd als tekst') } catch { toast.error('Kopiëren lukte niet') }
  }

  const print = () => {
    const el = document.getElementById('inzending-print')
    if (!el) return
    const w = window.open('', '_blank', 'width=800,height=900')
    if (!w) { toast.error('Pop-up geblokkeerd'); return }
    w.document.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${formulierTitel.replace(/</g, '&lt;')}</title><style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}img{max-height:80px}a{color:#111}h1{font-size:18px}</style></head><body><h1>${formulierTitel.replace(/</g, '&lt;')}</h1>${el.innerHTML}</body></html>`)
    w.document.close(); w.focus(); w.print()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px]" onClick={onClose}>
      <aside className="h-full w-full max-w-xl bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Inzending">
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <div className="font-semibold truncate">{d?.naam ?? 'Inzending'}</div>
            <div className="text-xs text-gray-500 truncate">{d ? datumTijd(d.created_at) : ''}{d?.klant_naam ? ` · ${d.klant_naam}` : ''}{d?.link_label ? ` · ${d.link_label}` : ''}</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 shrink-0" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>

        {!d ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {INZENDING_STATUSSEN.map((s) => (
                  <button key={s} disabled={bewaren} onClick={() => d.status !== s && patch({ status: s })} className={cn('px-2.5 py-1 text-xs rounded-md font-medium', d.status === s ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-800')}>{INZENDING_STATUS_INFO[s].label}</button>
                ))}
              </div>
              <div className="ml-auto flex gap-2">
                <button onClick={kopieer} className="btn-secondary text-xs px-3 py-1.5"><Copy className="h-3.5 w-3.5" />Kopieer als tekst</button>
                <button onClick={print} className="btn-secondary text-xs px-3 py-1.5"><Printer className="h-3.5 w-3.5" />Afdrukken</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              <div id="inzending-print">
                {d.email && <p className="text-xs text-gray-500 mb-3">E-mail: <a href={`mailto:${d.email}`} className="underline">{d.email}</a></p>}
                <AntwoordWeergave velden={d.velden_snapshot} antwoorden={d.antwoorden ?? {}} bestanden={bestanden} />
              </div>
              <div className="border-t border-gray-100 pt-4">
                <label className="block text-xs font-medium text-gray-600 mb-1">Interne notitie (niet zichtbaar voor de klant)</label>
                <textarea className="input-base" rows={3} value={notitie} maxLength={5000} onChange={(e) => setNotitie(e.target.value)} />
                <button disabled={bewaren || notitie === (d.admin_notitie ?? '')} onClick={() => patch({ admin_notitie: notitie })} className="btn-secondary text-xs mt-2">
                  {bewaren ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Notitie opslaan
                </button>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
