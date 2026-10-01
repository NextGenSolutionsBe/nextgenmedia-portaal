'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Hourglass, Plus, Loader2, Pencil, Trash2, X, Check, CheckCheck } from 'lucide-react'
import { MailComposer } from '@/components/admin/mail-composer'
import { dagenTot, maandLabel, maandenTekst, vandaagBrussel, type Tellingen } from '@/lib/content/deadline-model'

type Rij = {
  id: string; client_id: string; maanden: string[]; deadline: string; status: 'open' | 'afgerond'; notitie: string | null
  auto_goedgekeurd: number; afgerond_op: string | null; klant: string | null; tellingen: Tellingen; laatsteMail: string | null
}

const datum = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })
const datumTijd = (s: string) => new Date(s).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** De komende maanden (en de huidige) om aan te duiden. */
function maandKeuzes(extra: string[] = []): string[] {
  const n = new Date()
  const uit: string[] = []
  for (let i = -1; i <= 6; i++) {
    const d = new Date(Date.UTC(n.getFullYear(), n.getMonth() + i, 1))
    uit.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return [...new Set([...uit, ...extra])].sort()
}

/**
 * Goedkeuringsdeadlines van de contentkalender.
 *  · Alle klanten: één overzicht om deadlines te bewaken (dagen resterend, wat
 *    nog bij de klant staat, wanneer laatst gemaild).
 *  · Deze klant: deadline(s) zetten voor één of meerdere maanden, aanpassen,
 *    verwijderen, en manueel een herinnering mailen (met voorbeeld).
 * Er wordt nooit automatisch goedgekeurd: na de deadline drukken wij zelf op
 * "Alles goedkeuren" (wat nog bij de klant staat → goedgekeurd).
 */
export function GoedkeuringDeadlines({ clientId, onKiesKlant }: { clientId?: string; onKiesKlant?: (id: string) => void }) {
  const [tab, setTab] = useState<'alle' | 'klant'>('alle')
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [nieuw, setNieuw] = useState(false)
  const [bewerk, setBewerk] = useState<Rij | null>(null)
  const [keurt, setKeurt] = useState<string | null>(null)
  const vandaag = vandaagBrussel()

  const laad = useCallback(async () => {
    try {
      const q = tab === 'klant' && clientId ? `?client_id=${clientId}` : ''
      const r = await fetch(`/api/admin/social-content/deadlines${q}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setRijen(j.deadlines ?? [])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setRijen([]) }
  }, [tab, clientId])
  useEffect(() => { laad() }, [laad])
  useEffect(() => { if (!clientId && tab === 'klant') setTab('alle') }, [clientId, tab])

  // Overzicht: open deadlines eerst (vroegste bovenaan), daarna de recent verwerkte.
  const zichtbaar = useMemo(() => {
    const lijst = rijen ?? []
    const open = lijst.filter((r) => r.status === 'open')
    const klaar = lijst.filter((r) => r.status === 'afgerond').sort((a, b) => b.deadline.localeCompare(a.deadline)).slice(0, tab === 'alle' ? 10 : 20)
    return [...open, ...klaar]
  }, [rijen, tab])
  const openAantal = (rijen ?? []).filter((r) => r.status === 'open').length

  const verwijder = async (r: Rij) => {
    if (!confirm(`Deadline van ${datum(r.deadline)} (${maandenTekst(r.maanden)}) verwijderen? Al goedgekeurde content blijft goedgekeurd.`)) return
    try {
      const res = await fetch(`/api/admin/social-content/deadlines?id=${r.id}`, { method: 'DELETE' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Deadline verwijderd.'); laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }

  const allesGoedkeuren = async (r: Rij) => {
    const n = r.tellingen.bij_klant
    const vroeg = dagenTot(r.deadline, vandaag) >= 0
    const vraag = `${n} item(s) van ${r.klant ?? 'deze klant'} (${maandenTekst(r.maanden)}) goedkeuren en de deadline afronden?`
      + (r.tellingen.feedback ? `\n\n${r.tellingen.feedback} item(s) met feedback blijven staan.` : '')
      + (vroeg ? '\n\nLet op: de deadline is nog niet verstreken.' : '')
    if (!confirm(vraag)) return
    setKeurt(r.id)
    try {
      const res = await fetch('/api/admin/social-content/deadlines', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, actie: 'alles_goedkeuren' }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(`${j.aantal} item(s) goedgekeurd — deadline afgerond.`); laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Goedkeuren mislukt') } finally { setKeurt(null) }
  }

  return (
    <div className="card-base">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Hourglass className="h-4 w-4 text-amber-600" />Goedkeuringsdeadlines</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
            <button type="button" onClick={() => setTab('alle')} className={`px-2.5 py-1 rounded-md font-medium ${tab === 'alle' ? 'bg-black text-white' : 'text-gray-600'}`}>Alle klanten{tab === 'alle' && openAantal ? ` (${openAantal} open)` : ''}</button>
            <button type="button" disabled={!clientId} onClick={() => setTab('klant')} className={`px-2.5 py-1 rounded-md font-medium disabled:opacity-40 ${tab === 'klant' ? 'bg-black text-white' : 'text-gray-600'}`}>Deze klant</button>
          </div>
          {clientId && <button type="button" onClick={() => { setTab('klant'); setNieuw(true) }} className="btn-primary text-sm"><Plus className="h-4 w-4" />Deadline zetten</button>}
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-3">Tegen welke datum moet de klant welke maand(en) goedkeuren? De klant ziet een aftelklok in het portaal. Er gebeurt niets automatisch: een herinnering mail je zelf (met voorbeeld), en na de deadline keur je met “Alles goedkeuren” goed wat nog bij de klant staat — feedback en concepten blijven staan.</p>

      {(nieuw || bewerk) && clientId && (
        <DeadlineFormulier clientId={bewerk?.client_id ?? clientId} rij={bewerk} onSluit={() => { setNieuw(false); setBewerk(null) }} onKlaar={() => { setNieuw(false); setBewerk(null); laad() }} />
      )}

      {rijen === null ? <div className="py-6 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        : zichtbaar.length === 0 ? <p className="text-sm text-gray-400 py-2">{tab === 'klant' ? 'Nog geen deadlines voor deze klant.' : 'Geen open deadlines.'}</p>
        : (
          <ul className="divide-y divide-gray-100">
            {zichtbaar.map((r) => {
              const n = dagenTot(r.deadline, vandaag)
              const open = r.status === 'open'
              const kleur = !open ? 'bg-gray-100 text-gray-600' : n < 0 ? 'bg-purple-100 text-purple-700' : n <= 1 ? 'bg-red-100 text-red-700' : n <= 3 ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-700'
              const label = !open ? `Afgerond · ${r.auto_goedgekeurd} goedgekeurd` : n > 1 ? `nog ${n} dagen` : n === 1 ? 'nog 1 dag' : n === 0 ? 'vandaag laatste dag' : 'verstreken — klaar om goed te keuren'
              return (
                <li key={r.id} className="py-2.5 flex items-start gap-3 flex-wrap sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      {tab === 'alle' && r.klant && (onKiesKlant
                        ? <button type="button" onClick={() => onKiesKlant(r.client_id)} className="hover:underline">{r.klant}</button>
                        : <span>{r.klant}</span>)}
                      <span className="text-gray-700">{maandenTekst(r.maanden)}</span>
                      <span className="text-gray-400">→ {datum(r.deadline)}</span>
                      <span className={`status-badge ${kleur}`}>{label}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5 flex gap-x-3 gap-y-0.5 flex-wrap">
                      <span className={r.tellingen.bij_klant ? 'text-amber-700 font-medium' : ''}>{r.tellingen.bij_klant} bij klant</span>
                      <span>{r.tellingen.feedback} feedback</span>
                      <span>{r.tellingen.goedgekeurd} goedgekeurd</span>
                      {r.tellingen.concept > 0 && <span>{r.tellingen.concept} nog in concept</span>}
                      <span>{r.laatsteMail ? `laatst gemaild ${datumTijd(r.laatsteMail)}` : 'nog niet gemaild'}</span>
                      {r.notitie && <span className="italic">“{r.notitie}”</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    {open && (
                      <button type="button" disabled={keurt === r.id} onClick={() => allesGoedkeuren(r)} className={`${n < 0 ? 'btn-primary' : 'btn-secondary'} text-xs`} title="Wat nog bij de klant staat goedkeuren en de deadline afronden">
                        {keurt === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}Alles goedkeuren{r.tellingen.bij_klant ? ` (${r.tellingen.bij_klant})` : ''}
                      </button>
                    )}
                    {open && <MailComposer context={{ type: 'client', clientId: r.client_id, kind: 'goedkeuring', deadlineId: r.id }} label="Herinnering" className="btn-secondary text-xs" />}
                    {open && <button type="button" onClick={() => setBewerk(r)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600" title="Aanpassen" aria-label="Aanpassen"><Pencil className="h-3.5 w-3.5" /></button>}
                    <button type="button" onClick={() => verwijder(r)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500" title="Verwijderen" aria-label="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
    </div>
  )
}

function DeadlineFormulier({ clientId, rij, onSluit, onKlaar }: { clientId: string; rij: Rij | null; onSluit: () => void; onKlaar: () => void }) {
  const [maanden, setMaanden] = useState<string[]>(rij?.maanden ?? [])
  const [deadline, setDeadline] = useState(rij?.deadline ?? '')
  const [notitie, setNotitie] = useState(rij?.notitie ?? '')
  const [bezig, setBezig] = useState(false)
  const keuzes = maandKeuzes(rij?.maanden)
  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/social-content/deadlines', {
        method: rij ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rij ? { id: rij.id, maanden, deadline, notitie } : { client_id: clientId, maanden, deadline, notitie }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(rij ? 'Deadline aangepast.' : 'Deadline gezet — de klant ziet de aftelklok.'); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 mb-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{rij ? 'Deadline aanpassen' : 'Nieuwe deadline'}</div>
        <button type="button" onClick={onSluit} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-200" aria-label="Sluiten"><X className="h-4 w-4" /></button>
      </div>
      <div>
        <div className="text-xs font-medium text-gray-600 mb-1">Welke maand(en)?</div>
        <div className="flex flex-wrap gap-1.5">
          {keuzes.map((m) => {
            const aan = maanden.includes(m)
            return <button key={m} type="button" onClick={() => setMaanden((l) => (aan ? l.filter((x) => x !== m) : [...l, m]))} className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${aan ? 'bg-black text-white border-black' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>{aan && <Check className="h-3 w-3 inline mr-0.5 -mt-0.5" />}{maandLabel(m)}</button>
          })}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Goedgekeurd tegen (deze dag telt nog mee)</label>
          <input type="date" className="input-base" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notitie (intern, optioneel)</label>
          <input className="input-base" value={notitie} onChange={(e) => setNotitie(e.target.value)} maxLength={1000} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button>
        <button type="button" disabled={bezig || !maanden.length || !deadline} onClick={bewaar} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{rij ? 'Opslaan' : 'Deadline zetten'}</button>
      </div>
    </div>
  )
}
