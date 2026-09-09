'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, Plus, X, Trash2, Check, AlertTriangle, CalendarClock, Search, ClipboardList,
} from 'lucide-react'
import {
  STATUSSEN, statusInfo, sorteer, isTeLaat, isVandaag, deadlineTekst,
  OPEN_STATUSSEN, type Opdracht, type OpdrachtStatus,
} from '@/lib/opdrachten'

type Klant = { id: string; naam: string }

/**
 * Opdrachten: werk dat binnenkomt en opgevolgd moet worden.
 *
 * De lijst is bewust één scherm zonder tabbladen: alles wat nog aandacht
 * vraagt staat bovenaan, te laat eerst. Wie een opdracht afvinkt ziet hem naar
 * beneden zakken in plaats van verdwijnen — zo blijft zichtbaar wat er deze
 * week gebeurd is.
 */
export function OpdrachtenClient() {
  const [rijen, setRijen] = useState<Opdracht[]>([])
  const [klanten, setKlanten] = useState<Klant[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const [laden, setLaden] = useState(true)
  const [q, setQ] = useState('')
  const [toonAfgerond, setToonAfgerond] = useState(false)
  const [nieuw, setNieuw] = useState(false)
  const [bewerken, setBewerken] = useState<Opdracht | null>(null)

  const laad = useCallback(async () => {
    setLaden(true)
    try {
      const res = await fetch('/api/admin/opdrachten')
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setRijen(j.opdrachten ?? [])
      setKlanten(j.klanten ?? [])
      setHint(j.hint ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const zichtbaar = useMemo(() => {
    const naald = q.trim().toLowerCase()
    return rijen
      .filter((o) => toonAfgerond || OPEN_STATUSSEN.includes(o.status))
      .filter((o) => !naald || [o.titel, o.omschrijving, o.klant_naam, o.wie]
        .some((v) => (v ?? '').toLowerCase().includes(naald)))
      .sort(sorteer)
  }, [rijen, q, toonAfgerond])

  const teLaat = rijen.filter((o) => isTeLaat(o)).length
  const vandaag = rijen.filter((o) => isVandaag(o)).length
  const open = rijen.filter((o) => OPEN_STATUSSEN.includes(o.status)).length

  const zetStatus = async (o: Opdracht, status: OpdrachtStatus) => {
    // Meteen tonen; bij een fout draaien we terug. Statussen wisselen doe je
    // vaak achter elkaar, en dan is wachten op de server hinderlijk.
    const vorige = rijen
    setRijen((p) => p.map((x) => (x.id === o.id ? { ...x, status } : x)))
    try {
      const res = await fetch('/api/admin/opdrachten', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: o.id, status }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
    } catch (e) {
      setRijen(vorige)
      toast.error(e instanceof Error ? e.message : 'Bijwerken mislukt')
    }
  }

  const verwijder = async (o: Opdracht) => {
    if (!confirm(`"${o.titel}" verwijderen?\n\nIs de opdracht gewoon klaar, zet hem dan op Afgerond — dan blijft hij terugvindbaar.`)) return
    try {
      const res = await fetch(`/api/admin/opdrachten?id=${o.id}`, { method: 'DELETE' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setRijen((p) => p.filter((x) => x.id !== o.id))
      toast.success('Verwijderd.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />Opdrachten
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Werk dat binnenkomt en opgevolgd moet worden — een shoot, een voorstel dat de deur uit is,
            iets waar je op de klant wacht.
          </p>
        </div>
        <button onClick={() => setNieuw(true)} className="btn-primary text-sm">
          <Plus className="h-4 w-4" />Nieuwe opdracht
        </button>
      </div>

      {hint && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{hint}</p>
      )}

      {/* Wat vraagt aandacht? Eén regel, geen dashboard. */}
      {(teLaat > 0 || vandaag > 0) && (
        <div className="flex gap-2 flex-wrap">
          {teLaat > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700">
              <AlertTriangle className="h-4 w-4" />
              {teLaat} {teLaat === 1 ? 'opdracht is' : 'opdrachten zijn'} te laat
            </span>
          )}
          {vandaag > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800">
              <CalendarClock className="h-4 w-4" />{vandaag} vandaag af te ronden
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input className="input-base pl-8 w-64" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Titel, klant of wie…" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" className="h-4 w-4 rounded border-gray-300 accent-[#fff848]"
            checked={toonAfgerond} onChange={(e) => setToonAfgerond(e.target.checked)} />
          Toon afgerond
        </label>
        <span className="text-sm text-gray-500 ml-auto">{open} open</span>
      </div>

      {laden ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : zichtbaar.length === 0 ? (
        <div className="card-base text-center py-12 text-gray-500">
          <ClipboardList className="h-8 w-8 mx-auto text-gray-300 mb-2" />
          <p className="text-sm">
            {rijen.length === 0
              ? 'Nog geen opdrachten. Voeg er een toe zodra er werk binnenkomt.'
              : 'Niets gevonden met deze filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {zichtbaar.map((o) => (
            <OpdrachtRij key={o.id} o={o} onStatus={zetStatus}
              onOpen={() => setBewerken(o)} onVerwijder={() => verwijder(o)} />
          ))}
        </div>
      )}

      {(nieuw || bewerken) && (
        <OpdrachtDialoog
          bestaand={bewerken}
          klanten={klanten}
          onClose={() => { setNieuw(false); setBewerken(null) }}
          onOpgeslagen={() => { setNieuw(false); setBewerken(null); laad() }}
        />
      )}
    </div>
  )
}

function OpdrachtRij({ o, onStatus, onOpen, onVerwijder }: {
  o: Opdracht
  onStatus: (o: Opdracht, s: OpdrachtStatus) => void
  onOpen: () => void
  onVerwijder: () => void
}) {
  const info = statusInfo(o.status)
  const laat = isTeLaat(o)
  const nu = isVandaag(o)
  const tekst = deadlineTekst(o.deadline)

  return (
    <div className={`card-base p-3 flex items-start gap-3 ${laat ? 'border-red-200 bg-red-50/40' : ''}`}>
      {/* Afvinken zonder de dialoog te openen: dat is de handeling die het
          vaakst gebeurt. */}
      <button
        onClick={() => onStatus(o, o.status === 'afgerond' ? 'open' : 'afgerond')}
        title={o.status === 'afgerond' ? 'Heropenen' : 'Afronden'}
        className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
          o.status === 'afgerond'
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-gray-300 hover:border-gray-400 bg-white'}`}>
        {o.status === 'afgerond' && <Check className="h-3.5 w-3.5" />}
      </button>

      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-medium text-sm ${o.status === 'afgerond' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
            {o.titel}
          </span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${info.badge}`}>
            {info.label}
          </span>
          {laat && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
              {tekst}
            </span>
          )}
          {nu && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
              vandaag
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {o.klant_naam && <span>{o.klant_naam}</span>}
          {o.wie && <span>· {o.wie}</span>}
          {o.deadline && !laat && !nu && <span>· {o.deadline} ({tekst})</span>}
          {o.omschrijving && <span className="truncate max-w-md">· {o.omschrijving}</span>}
        </div>
      </button>

      <div className="flex items-center gap-1 shrink-0">
        <select
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
          value={o.status}
          onChange={(e) => onStatus(o, e.target.value as OpdrachtStatus)}
          title="Status wijzigen">
          {STATUSSEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button onClick={onVerwijder} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"
          title="Verwijderen">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function OpdrachtDialoog({ bestaand, klanten, onClose, onOpgeslagen }: {
  bestaand: Opdracht | null
  klanten: Klant[]
  onClose: () => void
  onOpgeslagen: () => void
}) {
  const [titel, setTitel] = useState(bestaand?.titel ?? '')
  const [omschrijving, setOmschrijving] = useState(bestaand?.omschrijving ?? '')
  const [clientId, setClientId] = useState(bestaand?.client_id ?? '')
  const [klantVrij, setKlantVrij] = useState(bestaand?.klant_vrij ?? '')
  const [status, setStatus] = useState<OpdrachtStatus>(bestaand?.status ?? 'open')
  const [deadline, setDeadline] = useState(bestaand?.deadline ?? '')
  const [wie, setWie] = useState(bestaand?.wie ?? '')
  const [bezig, setBezig] = useState(false)

  const bewaar = async () => {
    if (!titel.trim()) { toast.error('Geef de opdracht een titel'); return }
    setBezig(true)
    try {
      const body = {
        ...(bestaand ? { id: bestaand.id } : {}),
        titel: titel.trim(), omschrijving, status, deadline, wie,
        client_id: clientId || null,
        klant_vrij: clientId ? null : klantVrij,
      }
      const res = await fetch('/api/admin/opdrachten', {
        method: bestaand ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(bestaand ? 'Opgeslagen.' : 'Opdracht toegevoegd.')
      onOpgeslagen()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  const gekozenStatus = STATUSSEN.find((s) => s.key === status)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-gray-400" />
            {bestaand ? 'Opdracht bewerken' : 'Nieuwe opdracht'}
          </h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Wat moet er gebeuren?</label>
            <input className="input-base" value={titel} onChange={(e) => setTitel(e.target.value)}
              placeholder="Contentshoot 13 september" autoFocus maxLength={200} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Voor welke klant?</label>
            <select className="input-base" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— geen klant uit de lijst —</option>
              {klanten.map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}
            </select>
            {!clientId && (
              <input className="input-base mt-1.5" value={klantVrij} onChange={(e) => setKlantVrij(e.target.value)}
                placeholder="Of tik een naam — bv. een prospect die nog geen klant is" maxLength={120} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Deadline</label>
              <input type="date" className="input-base" value={deadline}
                onChange={(e) => setDeadline(e.target.value)} min="2020-01-01" max="2099-12-31" />
              <p className="text-[11px] text-gray-500 mt-1">
                Leeg = geen datum. Staat de datum in het verleden en is de opdracht nog open, dan zie je
                een rood bolletje in het menu.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Wie pakt dit op?</label>
              <input className="input-base" value={wie} onChange={(e) => setWie(e.target.value)}
                placeholder="Bram" maxLength={60} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select className="input-base" value={status} onChange={(e) => setStatus(e.target.value as OpdrachtStatus)}>
              {STATUSSEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {gekozenStatus && <p className="text-[11px] text-gray-500 mt-1">{gekozenStatus.hint}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Notities <span className="text-gray-400">— optioneel</span>
            </label>
            <textarea rows={3} className="input-base" value={omschrijving}
              onChange={(e) => setOmschrijving(e.target.value)} maxLength={4000}
              placeholder="Wat is er afgesproken, waar wacht je op, wat is de volgende stap?" />
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={bewaar} disabled={bezig} className="btn-primary flex-1">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {bestaand ? 'Opslaan' : 'Toevoegen'}
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}
