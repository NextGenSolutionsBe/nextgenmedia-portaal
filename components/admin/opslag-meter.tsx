'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { HardDrive } from 'lucide-react'
import { grootte, OPSLAG_LIMIET_GB, type Opslag } from '@/lib/opslag'

const SLEUTEL = 'ngm-opslag'
const GELDIG_MS = 30 * 60 * 1000

/**
 * Kleine meter onderaan de zijbalk: hoeveel van de 100 GB in Supabase deze app
 * gebruikt. Haalt de cijfers hoogstens om het half uur op; lukt het niet, dan
 * staat er gewoon niets.
 */
export function OpslagMeter({ onNavigate }: { onNavigate?: () => void }) {
  const [o, setO] = useState<Opslag | null>(null)
  useEffect(() => {
    let levend = true
    try {
      const c = JSON.parse(sessionStorage.getItem(SLEUTEL) ?? 'null') as { t: number; o: Opslag } | null
      if (c && Date.now() - c.t < GELDIG_MS) { setO(c.o); return }
    } catch { /* geen opslag in de browser: gewoon ophalen */ }
    fetch('/api/admin/instellingen/opslag')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!levend || !j?.opslag) return
        setO(j.opslag)
        try { sessionStorage.setItem(SLEUTEL, JSON.stringify({ t: Date.now(), o: j.opslag })) } catch { /* stil */ }
      })
      .catch(() => { /* stil */ })
    return () => { levend = false }
  }, [])
  if (!o) return null
  const kleur = o.niveau === 'kritiek' ? 'bg-red-400' : o.niveau === 'let_op' ? 'bg-amber-400' : 'bg-white/60'
  return (
    <Link href="/admin/instellingen?tab=opslag" prefetch={false} onClick={onNavigate}
      className="block px-3 py-2 rounded-lg hover:bg-white/5 transition-colors" title="Opslag in Supabase">
      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
        <span className="flex items-center gap-1.5"><HardDrive className="h-3.5 w-3.5" />Opslag</span>
        <span className="tabular-nums">{grootte(o.totaalBytes)} / {OPSLAG_LIMIET_GB} GB</span>
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full ${kleur}`} style={{ width: `${Math.max(1, Math.min(100, o.procent))}%` }} />
      </div>
    </Link>
  )
}
