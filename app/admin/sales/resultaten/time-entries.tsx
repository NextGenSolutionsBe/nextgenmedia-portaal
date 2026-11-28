'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Trash2, Clock, Plus, X, Pencil, Check } from 'lucide-react'
import { secondsOf, hoursText, euro, earnedCents } from '@/lib/sales/earnings'
import { uitFormulier, valideerPeriode } from '@/lib/sales/tijd-invoer'

type Entry = {
  id: string
  setter_id: string
  setterName: string
  started_at: string
  ended_at: string | null
  note: string | null
  source: string
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' })
const pad = (n: number) => String(n).padStart(2, '0')
/** Lokale datum (JJJJ-MM-DD) en klokuur (UU:MM) — dezelfde tijdzone als uitFormulier. */
const lokaleDatum = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const lokaalUur = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

type Bewerk = { id: string; datum: string; van: string; tot: string; notitie: string }

/**
 * De belperiodes van een maand, met de mogelijkheid om er een te wissen.
 *
 * Wissen kan niet ongedaan gemaakt worden en verandert wat er uitbetaald wordt,
 * dus er staat altijd een bevestiging voor — met de duur en het bedrag erin,
 * zodat je ziet wat je precies weghaalt.
 */
export function TimeEntries({ month, setterId, hourlyRateCents, onChanged }: {
  month: string
  setterId?: string
  hourlyRateCents: number
  onChanged: () => void
}) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // Handmatig bijboeken: van–tot op één dag.
  const [openForm, setOpenForm] = useState(false)
  const [datum, setDatum] = useState(() => new Date().toISOString().slice(0, 10))
  const [van, setVan] = useState('')
  const [tot, setTot] = useState('')
  const [notitie, setNotitie] = useState('')
  const [bewaren, setBewaren] = useState(false)
  // Een bestaande periode rechtzetten (begin, einde, notitie).
  const [bewerk, setBewerk] = useState<Bewerk | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ month })
      if (setterId) p.set('setter', setterId)
      const r = await fetch(`/api/admin/sales/time?${p}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setEntries(j.entries ?? [])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
    finally { setLoading(false) }
  }, [month, setterId])
  useEffect(() => { load() }, [load])

  const remove = async (e: Entry) => {
    const secs = secondsOf(e)
    const bedrag = euro(earnedCents(secs, hourlyRateCents))
    const running = e.ended_at === null
    const ok = confirm(
      running
        ? `Deze lopende sessie verwijderen?\n\nDe timer stopt en de tijd van vandaag (${hoursText(secs)}, ${bedrag}) wordt niet meegeteld.`
        : `Deze periode verwijderen?\n\n${day(e.started_at)} ${time(e.started_at)}–${time(e.ended_at!)} · ${hoursText(secs)} · ${bedrag}\n\nDit kan niet ongedaan gemaakt worden.`,
    )
    if (!ok) return

    setBusy(e.id)
    try {
      const r = await fetch(`/api/admin/sales/time?id=${e.id}`, { method: 'DELETE' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Periode verwijderd.')
      await load()
      onChanged()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Verwijderen mislukt') }
    finally { setBusy(null) }
  }

  /**
   * Handmatig bijboeken. Dezelfde controle draait hier én op de server: hier
   * om je meteen te zeggen wat er niet klopt, daar omdat een controle die
   * alleen in de browser leeft geen controle is.
   */
  const bewaar = async () => {
    const stukken = uitFormulier(datum, van, tot)
    if (!stukken) { toast.error('Vul een datum en een begin- en einduur in.'); return }

    const check = valideerPeriode(stukken.startIso, stukken.eindIso, entries)
    if (!check.ok) { toast.error(check.fout); return }

    setBewaren(true)
    try {
      const r = await fetch('/api/admin/sales/time', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...stukken, note: notitie, setterId }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      const secs = Math.round((check.eindMs - check.startMs) / 1000)
      toast.success(`${hoursText(secs)} geboekt — ${euro(earnedCents(secs, hourlyRateCents))}.`)
      setVan(''); setTot(''); setNotitie(''); setOpenForm(false)
      await load()
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Boeken mislukt') }
    finally { setBewaren(false) }
  }

  /** Een periode aanpassen: dezelfde controle als bijboeken, zonder het blok zelf. */
  const bewerkCheck = (() => {
    if (!bewerk) return null
    const stukken = uitFormulier(bewerk.datum, bewerk.van, bewerk.tot)
    if (!stukken) return { fout: 'Vul een datum en een begin- en einduur in.' as string }
    const check = valideerPeriode(stukken.startIso, stukken.eindIso, entries.filter((e) => e.id !== bewerk.id))
    if (!check.ok) return { fout: check.fout }
    const secs = Math.round((check.eindMs - check.startMs) / 1000)
    return { stukken, tekst: `${hoursText(secs)} · ${euro(earnedCents(secs, hourlyRateCents))}` }
  })()

  const bewaarBewerking = async () => {
    if (!bewerk || !bewerkCheck) return
    if ('fout' in bewerkCheck && bewerkCheck.fout) { toast.error(bewerkCheck.fout); return }
    if (!('stukken' in bewerkCheck) || !bewerkCheck.stukken) return
    setBusy(bewerk.id)
    try {
      const r = await fetch('/api/admin/sales/time', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bewerk.id, ...bewerkCheck.stukken, note: bewerk.notitie }),
      })
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      toast.success(`Periode aangepast — ${bewerkCheck.tekst}.`)
      setBewerk(null)
      await load()
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') }
    finally { setBusy(null) }
  }

  // Wat je nu invult, meteen doorgerekend: je ziet vóór het opslaan hoeveel
  // tijd en hoeveel geld je bijboekt.
  const voorbeeld = (() => {
    const stukken = uitFormulier(datum, van, tot)
    if (!stukken) return null
    const check = valideerPeriode(stukken.startIso, stukken.eindIso, entries)
    if (!check.ok) return { fout: check.fout }
    const secs = Math.round((check.eindMs - check.startMs) / 1000)
    return { tekst: `${hoursText(secs)} · ${euro(earnedCents(secs, hourlyRateCents))}` }
  })()

  if (loading) {
    return <div className="card-base py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
  }

  return (
    <div className="card-base p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <Clock className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900">Gewerkte periodes</h2>
        <span className="text-xs text-gray-400">({entries.length})</span>
        <button onClick={() => setOpenForm((v) => !v)}
          className="ml-auto btn-secondary text-xs py-1 px-2">
          {openForm ? <><X className="h-3.5 w-3.5" />Sluiten</> : <><Plus className="h-3.5 w-3.5" />Tijd toevoegen</>}
        </button>
      </div>

      {/* Handmatig bijboeken — voor wie de timer vergat, of belde terwijl de
          app dicht stond. Van–tot in plaats van starten en stoppen. */}
      {openForm && (
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/70 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="text-[11px] text-gray-500">
              Datum
              <input type="date" className="input-base mt-0.5 text-sm" value={datum}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDatum(e.target.value)} />
            </label>
            <label className="text-[11px] text-gray-500">
              Van
              <input type="time" className="input-base mt-0.5 text-sm" value={van}
                onChange={(e) => setVan(e.target.value)} />
            </label>
            <label className="text-[11px] text-gray-500">
              Tot
              <input type="time" className="input-base mt-0.5 text-sm" value={tot}
                onChange={(e) => setTot(e.target.value)} />
            </label>
            <label className="text-[11px] text-gray-500 col-span-2 sm:col-span-1">
              Notitie <span className="text-gray-400">(optioneel)</span>
              <input className="input-base mt-0.5 text-sm" value={notitie} maxLength={200}
                placeholder="bv. belronde bouw" onChange={(e) => setNotitie(e.target.value)} />
            </label>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={bewaar} disabled={bewaren || !van || !tot} className="btn-primary text-sm">
              {bewaren ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Boeken
            </button>
            {voorbeeld?.fout && <span className="text-xs text-red-600">{voorbeeld.fout}</span>}
            {voorbeeld?.tekst && <span className="text-xs text-gray-600 tabular">{voorbeeld.tekst}</span>}
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="empty-state text-sm">Deze maand is er nog geen tijd geregistreerd.</div>
      ) : (
        <div className="divide-y divide-gray-50 max-h-[26rem] overflow-y-auto">
          {entries.map((e) => {
            const secs = secondsOf(e)
            const running = e.ended_at === null
            if (bewerk?.id === e.id) {
              return (
                <form key={e.id} className="px-4 py-3 bg-gray-50/70 space-y-2" onSubmit={(ev) => { ev.preventDefault(); void bewaarBewerking() }}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <label className="text-[11px] text-gray-500">Datum
                      <input type="date" className="input-base mt-0.5 text-sm" value={bewerk.datum}
                        max={lokaleDatum(new Date().toISOString())} onChange={(x) => setBewerk({ ...bewerk, datum: x.target.value })} />
                    </label>
                    <label className="text-[11px] text-gray-500">Van
                      <input type="time" className="input-base mt-0.5 text-sm" value={bewerk.van} onChange={(x) => setBewerk({ ...bewerk, van: x.target.value })} />
                    </label>
                    <label className="text-[11px] text-gray-500">Tot
                      <input type="time" className="input-base mt-0.5 text-sm" value={bewerk.tot} onChange={(x) => setBewerk({ ...bewerk, tot: x.target.value })} />
                    </label>
                    <label className="text-[11px] text-gray-500 col-span-2 sm:col-span-1">Notitie
                      <input className="input-base mt-0.5 text-sm" value={bewerk.notitie} maxLength={200} placeholder="optioneel"
                        onChange={(x) => setBewerk({ ...bewerk, notitie: x.target.value })} />
                    </label>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="submit" disabled={busy === e.id || !!(bewerkCheck && 'fout' in bewerkCheck && bewerkCheck.fout)} className="btn-primary text-sm">
                      {busy === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bewaren
                    </button>
                    <button type="button" onClick={() => setBewerk(null)} className="btn-secondary text-sm">Annuleer</button>
                    {bewerkCheck && 'fout' in bewerkCheck && bewerkCheck.fout && <span className="text-xs text-red-600">{bewerkCheck.fout}</span>}
                    {bewerkCheck && 'tekst' in bewerkCheck && <span className="text-xs text-gray-600 tabular">{bewerkCheck.tekst}</span>}
                  </div>
                </form>
              )
            }
            return (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{day(e.started_at)}</span>
                    <span className="tabular text-gray-700">
                      {time(e.started_at)}–{running ? 'nu' : time(e.ended_at!)}
                    </span>
                    {running && <span className="status-badge bg-green-100 text-green-700">loopt</span>}
                    {e.source === 'manual' && <span className="status-badge bg-gray-100 text-gray-600">handmatig</span>}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {e.setterName} · {hoursText(secs)} · {euro(earnedCents(secs, hourlyRateCents))}
                    {e.note ? ` · ${e.note}` : ''}
                  </div>
                </div>
                {!running && (
                  <button onClick={() => setBewerk({ id: e.id, datum: lokaleDatum(e.started_at), van: lokaalUur(e.started_at), tot: lokaalUur(e.ended_at!), notitie: e.note ?? '' })}
                    disabled={busy === e.id} title="Deze periode aanpassen"
                    className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-black disabled:opacity-50">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <button onClick={() => remove(e)} disabled={busy === e.id}
                  title="Deze periode verwijderen"
                  className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-500 hover:text-red-700 disabled:opacity-50">
                  {busy === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
