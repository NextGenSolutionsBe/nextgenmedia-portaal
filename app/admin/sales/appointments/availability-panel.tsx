'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X, Plus, Trash2, Save, Settings2, CalendarOff, BellRing } from 'lucide-react'

type Rule = { weekday: number; start_time: string; end_time: string }
type Exception = { date: string; closed: boolean; start_time?: string | null; end_time?: string | null; note?: string | null }
type Settings = {
  buffer_before_min: number; buffer_after_min: number
  min_notice_min: number; max_horizon_days: number
  max_per_day: number; slot_interval_min: number; default_duration_min: number
  timezone: string
  reminder_days_before: number[]
  reminder_sender_name: string | null
}

const DAYS = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag']
const hm = (t: string) => (t ?? '').slice(0, 5)   // '09:00:00' → '09:00'

/**
 * Beschikbaarheid (§8): werkuren, buffers, uitzonderingen en
 * boekingsregels. Bewust geen "meeting types" — dit zijn de knoppen die het
 * grijs/wit in de kalender bepalen, en niets meer.
 */
export function AvailabilityPanel({ initialOwnerId, onClose, onSaved }: {
  initialOwnerId?: string
  onClose: () => void; onSaved: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [owners, setOwners] = useState<{ id: string; name: string | null; account_email: string | null }[]>([])
  // Voor wie gelden deze uren? '' = voor de hele klant (elke agenda zonder
  // eigen uren). Anders alleen voor die persoon.
  const [scope, setScope] = useState<string>(initialOwnerId ?? '')
  const [saving, setSaving] = useState(false)
  const [rules, setRules] = useState<Rule[]>([])
  const [exceptions, setExceptions] = useState<Exception[]>([])
  const [s, setS] = useState<Settings>({
    buffer_before_min: 0, buffer_after_min: 0, min_notice_min: 60,
    max_horizon_days: 60, max_per_day: 8, slot_interval_min: 30,
    default_duration_min: 30, timezone: 'Europe/Brussels',
    reminder_days_before: [], reminder_sender_name: null,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/sales/availability')
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setOwners(j.owners ?? [])
      // Alleen de regels van het gekozen bereik tonen — anders lijkt het alsof
      // iemand uren heeft die eigenlijk van een ander zijn.
      const inScope = (r: { calendar_id?: string | null }) => (scope ? r.calendar_id === scope : !r.calendar_id)
      const rawRules = (j.rules ?? []) as (Rule & { calendar_id?: string | null })[]
      const rawExc = (j.exceptions ?? []) as (Exception & { calendar_id?: string | null })[]
      setRules(rawRules.filter(inScope).map((r) => ({ weekday: r.weekday, start_time: hm(r.start_time), end_time: hm(r.end_time) })))
      setExceptions(rawExc.filter(inScope).map((e) => ({
        date: e.date.slice(0, 10), closed: e.closed,
        start_time: hm(e.start_time ?? ''), end_time: hm(e.end_time ?? ''), note: e.note ?? '',
      })))
      if (j.client) setS((p) => ({ ...p, ...j.client, reminder_days_before: j.client.reminder_days_before ?? [] }))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLoading(false) }
  }, [scope])
  useEffect(() => { load() }, [load])

  const save = async () => {
    // Blokken zonder geldige tijden zijn onbruikbaar; die gooien we er stil uit
    // in plaats van de gebruiker met een foutmelding op te zadelen.
    const clean = rules.filter((r) => r.start_time && r.end_time && r.end_time > r.start_time)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/sales/availability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId: scope || null, rules: clean, exceptions, ...s }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Beschikbaarheid opgeslagen.')
      onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setSaving(false) }
  }

  const addBlock = (weekday: number) => setRules((p) => [...p, { weekday, start_time: '09:00', end_time: '17:00' }])
  const setBlock = (i: number, patch: Partial<Rule>) => setRules((p) => p.map((r, x) => x === i ? { ...r, ...patch } : r))
  const delBlock = (i: number) => setRules((p) => p.filter((_, x) => x !== i))

  const num = (k: keyof Settings, label: string, hint?: string) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type="number" min={0} className="input-base" value={String(s[k])}
        onChange={(e) => setS((p) => ({ ...p, [k]: Math.max(0, Number(e.target.value) || 0) }))} />
      {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Settings2 className="h-4 w-4 text-gray-400" />Beschikbaarheid</h3>
            <p className="text-sm text-gray-600 mt-0.5">Dit bepaalt wat wit (boekbaar) is in de agenda.</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : (
          <div className="p-5 space-y-5 overflow-y-auto">
            {/* Voor wie gelden deze uren? */}
            {owners.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Werkuren gelden voor</label>
                <select className="input-base" value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="">Alle agenda's (standaard)</option>
                  {owners.map((o) => <option key={o.id} value={o.id}>Alleen {o.name || o.account_email}</option>)}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Kies een persoon om die eigen uren te geven. Heeft iemand geen eigen uren, dan gelden automatisch de uren van "Alle agenda's".
                </p>
              </div>
            )}

            {/* Werkuren */}
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Werkuren</h4>
              <div className="space-y-1.5">
                {DAYS.map((day, wd) => {
                  const blocks = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.weekday === wd)
                  return (
                    <div key={wd} className="flex items-start gap-2">
                      <div className="w-24 pt-2 text-sm text-gray-700 shrink-0">{day}</div>
                      <div className="flex-1 space-y-1.5">
                        {blocks.length === 0 && <div className="text-xs text-gray-400 py-2">Gesloten</div>}
                        {blocks.map(({ r, i }) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <input type="time" className="input-base w-auto" value={r.start_time}
                              onChange={(e) => setBlock(i, { start_time: e.target.value })} />
                            <span className="text-gray-400 text-sm">tot</span>
                            <input type="time" className="input-base w-auto" value={r.end_time}
                              onChange={(e) => setBlock(i, { end_time: e.target.value })} />
                            <button onClick={() => delBlock(i)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600" title="Blok verwijderen">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        <button onClick={() => addBlock(wd)} className="text-xs text-gray-500 hover:text-black flex items-center gap-1">
                          <Plus className="h-3 w-3" />blok toevoegen
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">Een dag zonder blokken is volledig grijs — daar kan niemand boeken.</p>
            </div>

            {/* Buffers + regels */}
            <div className="border-t border-gray-100 pt-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Buffers en boekingsregels</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {num('buffer_before_min', 'Buffer vóór (min)', 'Beschermde tijd vlak vóór elke afspraak.')}
                {num('buffer_after_min', 'Buffer ná (min)', 'Beschermde tijd vlak ná elke afspraak.')}
                {num('slot_interval_min', 'Slot-interval (min)', 'Raster waarop het slepen inklikt.')}
                {num('default_duration_min', 'Standaardduur (min)')}
                {num('min_notice_min', 'Min. opzegtermijn (min)', 'Niet last-minute boekbaar.')}
                {num('max_horizon_days', 'Max. vooruit (dagen)')}
                {num('max_per_day', 'Max. afspraken/dag')}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tijdzone</label>
                  <input className="input-base" value={s.timezone}
                    onChange={(e) => setS((p) => ({ ...p, timezone: e.target.value }))} placeholder="Europe/Brussels" />
                </div>
              </div>
            </div>

            {/* Herinneringsmails — bewust opt-in */}
            <div className="border-t border-gray-100 pt-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <BellRing className="h-3.5 w-3.5 text-gray-400" />Herinneringsmails naar de prospect
              </h4>
              <p className="text-[11px] text-gray-500 mb-2">
                Standaard uit. Vink aan wanneer de prospect een herinnering mag krijgen — een kale, zakelijke
                mail met enkel datum, uur en de Meet-link. Antwoorden komen op het ingestelde afzenderadres binnen.
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {[0, 1, 2, 3, 7].map((d) => {
                  const on = s.reminder_days_before.includes(d)
                  return (
                    <button key={d} type="button"
                      onClick={() => setS((p) => ({
                        ...p,
                        reminder_days_before: on
                          ? p.reminder_days_before.filter((x) => x !== d)
                          : [...p.reminder_days_before, d].sort((a, b) => b - a),
                      }))}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${on ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                      {d === 0 ? 'Op de dag zelf' : d === 1 ? '1 dag vooraf' : `${d} dagen vooraf`}
                    </button>
                  )
                })}
              </div>
              {s.reminder_days_before.length > 0 && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ondertekend door</label>
                  <input className="input-base" value={s.reminder_sender_name ?? ''}
                    onChange={(e) => setS((p) => ({ ...p, reminder_sender_name: e.target.value }))}
                    placeholder="Bv. Bram Rekken" />
                </div>
              )}
            </div>

            {/* Uitzonderingen */}
            <div className="border-t border-gray-100 pt-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <CalendarOff className="h-3.5 w-3.5 text-gray-400" />Uitzonderingen
              </h4>
              <div className="space-y-1.5">
                {exceptions.length === 0 && <p className="text-xs text-gray-400">Geen vakantiedagen of afwijkende uren ingesteld.</p>}
                {exceptions.map((e, i) => (
                  <div key={i} className="flex items-center gap-1.5 flex-wrap">
                    <input type="date" className="input-base w-auto" value={e.date}
                      onChange={(ev) => setExceptions((p) => p.map((x, j) => j === i ? { ...x, date: ev.target.value } : x))} />
                    <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={e.closed}
                        onChange={(ev) => setExceptions((p) => p.map((x, j) => j === i ? { ...x, closed: ev.target.checked } : x))} />
                      hele dag dicht
                    </label>
                    {!e.closed && (
                      <>
                        <input type="time" className="input-base w-auto" value={e.start_time ?? ''}
                          onChange={(ev) => setExceptions((p) => p.map((x, j) => j === i ? { ...x, start_time: ev.target.value } : x))} />
                        <span className="text-gray-400 text-sm">tot</span>
                        <input type="time" className="input-base w-auto" value={e.end_time ?? ''}
                          onChange={(ev) => setExceptions((p) => p.map((x, j) => j === i ? { ...x, end_time: ev.target.value } : x))} />
                      </>
                    )}
                    <button onClick={() => setExceptions((p) => p.filter((_, j) => j !== i))}
                      className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setExceptions((p) => [...p, { date: new Date().toISOString().slice(0, 10), closed: true }])}
                  className="text-xs text-gray-500 hover:text-black flex items-center gap-1">
                  <Plus className="h-3 w-3" />uitzondering toevoegen
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={save} disabled={saving || loading} className="btn-primary flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Opslaan
          </button>
          <button onClick={onClose} className="btn-secondary">Sluiten</button>
        </div>
      </div>
    </div>
  )
}
