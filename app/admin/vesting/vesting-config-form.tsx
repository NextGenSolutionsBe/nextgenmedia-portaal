'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, Settings2, Trash2 } from 'lucide-react'
import type { VestingConfig } from '@/lib/vesting'

export function VestingConfigForm({ cfg }: { cfg: VestingConfig }) {
  const router = useRouter()
  const [f, setF] = useState<VestingConfig>(cfg)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'
  const set = (k: keyof VestingConfig, v: string | number) => { setF(p => ({ ...p, [k]: v })); setSaved(false) }

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/vesting', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      if (res.ok) { setSaved(true); router.refresh() }
    } finally { setSaving(false) }
  }

  return (
    <div className="card-base">
      <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-1"><Settings2 className="h-4 w-4 text-gray-400" />Vestiging-instellingen</h2>
      <p className="text-xs text-gray-500 mb-4">Startdatum bepaalt het vestigingsjaar (1/2/3) en dus het tarief van schijf 3.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className={lbl}>Startdatum vesting</label><input type="date" className={inp} value={f.start_date ?? ''} onChange={e => set('start_date', e.target.value)} /></div>
        <div><label className={lbl}>Schijf 2 (€/% )</label><input type="number" step="100" className={inp} value={String(f.schijf2_per)} onChange={e => set('schijf2_per', Number(e.target.value))} /></div>
        <div><label className={lbl}>Schijf 3 · jaar 1 (€/%)</label><input type="number" step="100" className={inp} value={String(f.schijf3_y1)} onChange={e => set('schijf3_y1', Number(e.target.value))} /></div>
        <div><label className={lbl}>Schijf 3 · jaar 2 (€/%)</label><input type="number" step="100" className={inp} value={String(f.schijf3_y2)} onChange={e => set('schijf3_y2', Number(e.target.value))} /></div>
        <div><label className={lbl}>Schijf 3 · jaar 3 (€/%)</label><input type="number" step="100" className={inp} value={String(f.schijf3_y3)} onChange={e => set('schijf3_y3', Number(e.target.value))} /></div>
      </div>
      <p className="text-[11px] text-gray-400 mt-3">Toerekening is vast volgens de overeenkomst: outbound = outreach 50% + closing 50%, inbound = closing 25%.</p>
      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Opslaan</button>
        {saved && <span className="text-sm text-green-600 flex items-center gap-1"><Check className="h-4 w-4" />Opgeslagen</span>}
      </div>
    </div>
  )
}

export function VestingDelete({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    if (!confirm('Registratie verwijderen?')) return
    setBusy(true)
    try { const res = await fetch(`/api/admin/vesting?id=${id}`, { method: 'DELETE' }); if (res.ok) router.refresh() } finally { setBusy(false) }
  }
  return (
    <button onClick={remove} disabled={busy} className="text-red-400 hover:text-red-600" title="Verwijderen">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  )
}
