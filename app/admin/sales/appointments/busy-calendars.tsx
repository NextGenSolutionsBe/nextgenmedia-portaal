'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X, Save, CalendarRange } from 'lucide-react'

type Cal = { id: string; summary: string; primary: boolean; accessRole: string }

/**
 * Welke agenda's van dit Google-account blokkeren de beschikbaarheid?
 * Eén account heeft meestal meerdere agenda's (Marco, Bram, Chiara, ...).
 * Standaard tellen ze allemaal mee — dat is de veilige kant: liever een uur
 * te veel grijs dan een afspraak bovenop een bestaande.
 */
export function BusyCalendarsPanel({ connectionId, ownerName, onClose, onSaved }: {
  connectionId: string; ownerName: string
  onClose: () => void; onSaved: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cals, setCals] = useState<Cal[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [writeTarget, setWriteTarget] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/sales/calendar/calendars?connection=${connectionId}`)
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setCals(j.calendars ?? [])
      setPicked(new Set(j.selected ?? []))
      setWriteTarget(j.writeTarget ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Agenda’s laden mislukt') } finally { setLoading(false) }
  }, [connectionId])
  useEffect(() => { load() }, [load])

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/sales/calendar/calendars', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection: connectionId, ids: [...picked] }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Opgeslagen — de beschikbaarheid is herberekend.')
      onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-gray-400" />Welke agenda&apos;s blokkeren?
            </h3>
            <p className="text-sm text-gray-600 mt-0.5">
              Account van {ownerName}. Aangevinkte agenda&apos;s maken hun bezette uren grijs.
            </p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : cals.length === 0 ? (
          <div className="p-5 text-sm text-gray-600">
            We krijgen de agenda&apos;s van dit account niet te zien. Meestal is de koppeling vervallen —
            koppel deze persoon opnieuw.
          </div>
        ) : (
          <div className="p-5 space-y-1 overflow-y-auto">
            {cals.map((c) => {
              const isTarget = c.id === writeTarget
              return (
                <label key={c.id}
                  className={`flex items-start gap-2.5 px-2 py-2 rounded-lg cursor-pointer hover:bg-gray-50 ${isTarget ? 'bg-[#fff848]/10' : ''}`}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[#fff848]"
                    checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-900 truncate">{c.summary}</span>
                    <span className="block text-[11px] text-gray-500">
                      {isTarget && <b>hierin komen onze afspraken · </b>}
                      {c.accessRole === 'owner' ? 'eigen agenda'
                        : c.accessRole === 'writer' ? 'mag je bewerken'
                        : 'alleen lezen'}
                    </span>
                  </span>
                </label>
              )
            })}
            <p className="text-[11px] text-gray-500 pt-2">
              Vink je een agenda uit, dan negeren we die volledig en kan er over een bezet moment heen
              geboekt worden. De agenda waarin wij schrijven telt altijd mee.
            </p>
          </div>
        )}

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={save} disabled={saving || loading || cals.length === 0} className="btn-primary flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Opslaan
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}
