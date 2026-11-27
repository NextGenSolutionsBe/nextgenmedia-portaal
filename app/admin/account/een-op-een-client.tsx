'use client'

import { useEffect, useState } from 'react'
import type { Actiepunt } from '@/lib/ritme/model'

type Gesprek = { id: string; datum: string; notities: string | null; met_naam: string | null; over_mij: boolean; afspraken: Actiepunt[] }

/** Mijn account (fase 7): de 1-op-1's over mij of die ik voerde. Enkel lezen; niets als er geen zijn. */
export function MijnEenOpEen() {
  const [lijst, setLijst] = useState<Gesprek[]>([])
  useEffect(() => { fetch('/api/admin/account/een-op-een', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => setLijst(j?.gesprekken ?? [])).catch(() => null) }, [])
  if (!lijst.length) return null
  return (
    <details className="card-base">
      <summary className="cursor-pointer font-semibold text-sm">Mijn 1-op-1's <span className="text-gray-500 font-normal">· {lijst.length}</span></summary>
      <div className="mt-3 space-y-3">
        {lijst.map((g) => (
          <div key={g.id} className="border-t border-gray-100 pt-2">
            <div className="text-sm font-medium">{new Date(`${g.datum}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })} <span className="text-gray-500 font-normal">· {g.over_mij ? `met ${g.met_naam ?? 'een zaakvoerder'}` : 'jij voerde het gesprek'}</span></div>
            {g.notities && <p className="text-sm whitespace-pre-wrap text-gray-700 mt-1">{g.notities}</p>}
            {g.afspraken.length > 0 && <ul className="text-sm list-disc pl-5 mt-1">{g.afspraken.map((a) => <li key={a.id}>{a.tekst} <span className="text-gray-500">· {a.wie}{a.tegen ? ` · tegen ${a.tegen.split('-').reverse().join('/')}` : ''}</span></li>)}</ul>}
          </div>
        ))}
      </div>
    </details>
  )
}
