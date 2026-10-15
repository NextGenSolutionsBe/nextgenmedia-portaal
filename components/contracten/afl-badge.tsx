'use client'

import { AlertTriangle } from 'lucide-react'
import { AFL_BADGE, type AflBadge } from '@/lib/contracten/aflettering'

/** Badge voor de aflettering (contractwaarde ↔ facturen): altijd tekst, nooit enkel kleur. */
export function AflBadgeChip({ badge, klein }: { badge: AflBadge; klein?: boolean }) {
  const b = AFL_BADGE[badge]
  return <span title={b.uitleg} className={`inline-flex items-center gap-1 rounded-full border ${klein ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[11px]'} font-medium whitespace-nowrap ${b.cls}`}>{badge === 'afwijking' && <AlertTriangle className="h-3 w-3" />}{b.label}</span>
}
