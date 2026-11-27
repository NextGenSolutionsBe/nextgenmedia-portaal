'use client'

import { useEffect, useState } from 'react'
import { maandStand, deliverableTekst, type Deliverable } from '@/lib/bedrijven/deliverables'

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const maandNaam = (m: string) => MAANDEN[Number(m.slice(5, 7)) - 1] ?? m
const volgende = (m: string) => { const [j, mm] = m.split('-').map(Number); return mm === 12 ? `${j + 1}-01` : `${j}-${String(mm + 1).padStart(2, '0')}` }

let geheugen: Promise<Deliverable[]> | null = null
/** De standaard-deliverables van Social media (en zijn subdiensten), één keer per pagina geladen. */
function laad(): Promise<Deliverable[]> {
  geheugen ??= fetch('/api/admin/bedrijven?deliverables=1', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j) return []
      const sub = ((j.catalogus?.diensten ?? []) as { slug: string; parent_slug: string | null }[]).filter((d) => d.parent_slug === 'social_media').map((d) => d.slug)
      return ['social_media', ...sub].flatMap((s) => (j.deliverables?.[s] ?? []) as Deliverable[])
    })
    .catch(() => [])
  return geheugen
}

/**
 * Contentkalender (verbeterplan fase 6, punt 65): wat standaard afgesproken is
 * (Instellingen → Diensten → Social media) tegenover wat deze en volgende maand
 * gepland staat. Enkel een richtlijn; niets wordt aangemaakt. Zonder
 * deliverables toont het niets.
 */
export function DeliverablesStand({ items }: { items: { content_type?: string | null; planned_date?: string | null }[] }) {
  const [lijst, setLijst] = useState<Deliverable[] | null>(null)
  useEffect(() => { let weg = false; laad().then((l) => { if (!weg) setLijst(l) }); return () => { weg = true } }, [])
  const perMaand = (lijst ?? []).filter((d) => d.per === 'maand')
  if (!perMaand.length) return null
  const nu = new Date().toISOString().slice(0, 7)
  return (
    <div className="card-base py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="label-mono text-gray-500" title={perMaand.map(deliverableTekst).join(' · ')}>Standaard afgesproken</span>
        {[nu, volgende(nu)].map((m) => (
          <div key={m} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-gray-500 capitalize">{maandNaam(m)}</span>
            {maandStand(perMaand, items, m).map((s) => {
              const kort = s.gepland < s.afgesproken
              return (
                <span key={s.wat} className={`tabular-nums ${kort ? 'text-gray-900' : 'text-gray-500'}`}>
                  <strong className="font-semibold">{s.gepland}</strong> van {s.afgesproken} {s.wat}{kort ? '' : ' ✓'}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
