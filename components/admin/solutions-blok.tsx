'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { projectFaseLabel } from '@/lib/ngs/levering'
import { faseLabel } from '@/lib/ngs/model'
import type { KlantSolutions } from '@/lib/ngs/levering-server'
import { CareLijst } from '@/app/admin/nextgensolutions/levering/care'

/**
 * NextGenSolutions op de klantfiche (verbeterplan fase 5, punt 30): deals,
 * leveringsprojecten en Care. Enkel zichtbaar als er iets is en je de module
 * NextGenSolutions mag zien (anders weigert de API en tonen we niets).
 */
export function SolutionsBlok({ clientId }: { clientId: string }) {
  const [d, setD] = useState<KlantSolutions | null>(null)
  const laad = useCallback(() => {
    fetch(`/api/admin/nextgensolutions/levering?klant=${clientId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => setD(j)).catch(() => setD(null))
  }, [clientId])
  useEffect(() => { laad() }, [laad])
  if (!d || (!d.deals.length && !d.projecten.length && !d.care.length)) return null
  return (
    <div className="card-base space-y-3">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logos/nextgensolutions-icoon-128.png" alt="" width={20} height={20} className="h-5 w-5" />
        <h2 className="font-semibold text-sm text-gray-900">NextGenSolutions</h2>
      </div>
      {d.deals.length > 0 && (
        <ul className="space-y-1 text-sm">
          {d.deals.map((x) => <li key={x.id} className="flex justify-between gap-2"><Link href={`/admin/nextgensolutions?deal=${x.id}`} className="hover:underline truncate">{x.bedrijf}</Link><span className="text-xs text-gray-500 shrink-0">{faseLabel(x.fase)}</span></li>)}
        </ul>
      )}
      {d.projecten.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-gray-500">Levering</div>
          {d.projecten.map((p) => (
            <Link key={p.id} href={`/admin/nextgensolutions/levering?project=${p.id}`} className="block rounded-lg border border-gray-100 px-2.5 py-1.5 hover:bg-gray-50">
              <div className="text-sm font-medium flex justify-between gap-2"><span className="truncate">{p.titel}</span><span className="text-xs text-gray-500 shrink-0">{projectFaseLabel(p.fase)}</span></div>
              {p.stories.totaal > 0 && <div className="text-[11px] text-gray-500">{p.stories.klaar}/{p.stories.totaal - p.stories.voorstel} stories klaar · {p.stories.besteed}/{p.stories.geschat} u</div>}
            </Link>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <div className="text-[11px] text-gray-500">Care: lopende automatisaties</div>
        <CareLijst items={d.care} onVernieuw={laad} nieuw={{ client_id: clientId }} />
      </div>
    </div>
  )
}
