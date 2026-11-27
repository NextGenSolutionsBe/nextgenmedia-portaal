'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ListChecks } from 'lucide-react'
import { voortgang, type OnboardingStap } from '@/lib/team/rollen'

/** Mijn onboarding: de eigen checklist (enkel als er een is). Afvinken mag je zelf. */
export function OnboardingClient() {
  const [stappen, setStappen] = useState<OnboardingStap[] | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  useEffect(() => { fetch('/api/admin/account/onboarding', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { stappen: [] })).then((j) => setStappen(j.stappen ?? [])).catch(() => setStappen([])) }, [])
  if (!stappen?.length) return null
  const v = voortgang(stappen)
  const zet = async (s: OnboardingStap, gedaan: boolean) => {
    setBezig(s.id)
    try {
      const r = await fetch('/api/admin/account/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stap: s.id, gedaan }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setStappen(j.stappen)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  return (
    <div className="card-base space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2"><ListChecks className="h-4 w-4" />Onboarding</h2>
        <span className="text-xs text-gray-500">{v.klaar ? 'Alles gedaan' : `${v.gedaan} van ${v.totaal}`}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-black transition-all" style={{ width: `${v.pct}%` }} /></div>
      <ul className="space-y-0.5">
        {stappen.map((s) => (
          <li key={s.id}>
            <label className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
              <input type="checkbox" className="mt-0.5" checked={!!s.gedaan_op} disabled={bezig === s.id} onChange={(e) => zet(s, e.target.checked)} />
              <span className={s.gedaan_op ? 'line-through text-gray-400' : ''}>{s.titel}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
