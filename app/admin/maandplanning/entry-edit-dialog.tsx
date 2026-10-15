'use client'

import { useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Dialoog, INP } from '@/app/admin/instellingen/ui'
import { MONTH_CLIENT_TYPES, type MonthClientType } from '@/lib/month-phases'

/** Bewerken van één maandplanning-regel (klant in een maand): type + notitie. */
export function EntryEditDialog({ entry, titel, onClose, onSaved }: {
  entry: { id: string; planning_type: string | null; note: string | null }
  titel: string
  onClose: () => void
  onSaved: (patch: { planning_type: MonthClientType; note: string | null }) => void
}) {
  const [type, setType] = useState<MonthClientType>((entry.planning_type as MonthClientType) ?? 'new')
  const [note, setNote] = useState(entry.note ?? '')
  const [bezig, setBezig] = useState(false)

  const opslaan = async () => {
    setBezig(true)
    try {
      const res = await fetch('/api/admin/month-planning-clients', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, planning_type: type, note: note.trim() || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Opslaan mislukt')
      toast.success('Opgeslagen')
      onSaved({ planning_type: type, note: note.trim() || null })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally { setBezig(false) }
  }

  return (
    <Dialoog titel={titel} onSluit={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
          <div className="grid grid-cols-1 gap-2">
            {MONTH_CLIENT_TYPES.map((t) => (
              <button key={t.key} type="button" onClick={() => setType(t.key)}
                className={`text-left rounded-lg border p-3 text-sm transition-colors ${type === t.key ? 'border-[#fff848] bg-[#fff848]/10 ring-1 ring-[#fff848]' : 'border-gray-200 hover:border-gray-300'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notitie</label>
          <textarea rows={3} className={INP} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={opslaan} disabled={bezig} className="btn-primary flex-1 justify-center">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Opslaan
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </Dialoog>
  )
}
