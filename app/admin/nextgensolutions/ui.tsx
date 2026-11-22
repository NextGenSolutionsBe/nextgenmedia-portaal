'use client'

import Link from 'next/link'
import { X } from 'lucide-react'
import type { Fase } from '@/lib/ngs/model'

/** Gedeeld door de schermen van NextGenSolutions (pipeline en cijfers). */

export const NGS_BLAUW = '#3b82f6'
export const eur = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
export const eurCent = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })
export const dagKort = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })
export const dagLang = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
export const tijdstip = (iso: string) => new Date(iso).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
export const inp = 'input-base text-sm'
export const lbl = 'block text-xs font-medium text-gray-600 mb-1'

/** Kleur per fase: een stip en een zachte achtergrond (status in de app-stijl, geen eigen palet). */
export const FASE_STIJL: Record<Fase, { stip: string; zacht: string; tekst: string }> = {
  afspraak: { stip: 'bg-sky-500', zacht: 'bg-sky-50 border-sky-100', tekst: 'text-sky-800' },
  voorstel: { stip: 'bg-violet-500', zacht: 'bg-violet-50 border-violet-100', tekst: 'text-violet-800' },
  opvolgen: { stip: 'bg-amber-500', zacht: 'bg-amber-50 border-amber-100', tekst: 'text-amber-800' },
  won: { stip: 'bg-green-600', zacht: 'bg-green-50 border-green-100', tekst: 'text-green-800' },
  lost: { stip: 'bg-gray-400', zacht: 'bg-gray-50 border-gray-100', tekst: 'text-gray-600' },
}

export async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/nextgensolutions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
  return j as Record<string, unknown>
}

/** Bovenaan elke pagina: wie we zijn (NextGen Solutions) en de twee tabbladen. */
export function Kop({ actief, titel, sub, rechts }: { actief: 'pipeline' | 'cijfers'; titel: string; sub?: React.ReactNode; rechts?: React.ReactNode }) {
  const tab = (k: 'pipeline' | 'cijfers', href: string, label: string) => (
    <Link href={href} aria-current={actief === k ? 'page' : undefined}
      className={`px-3.5 py-1.5 rounded-full text-sm transition ${actief === k ? 'bg-white shadow-sm text-gray-900 font-semibold' : 'text-gray-600 hover:text-gray-900'}`}>{label}</Link>
  )
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="h-8 w-8 rounded-xl flex items-center justify-center text-white text-[13px] font-semibold shadow-sm" style={{ background: NGS_BLAUW }} aria-hidden>NGS</span>
          <span className="text-sm font-semibold text-gray-900">NextGen Solutions</span>
        </div>
        <nav className="inline-flex p-1 rounded-full bg-gray-100" aria-label="NextGen Solutions">
          {tab('pipeline', '/admin/nextgensolutions', 'Pipeline')}
          {tab('cijfers', '/admin/nextgensolutions/cijfers', 'Cijfers')}
        </nav>
      </div>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold">{titel}</h1>
          {sub && <p className="text-sm text-gray-500 mt-0.5">{sub}</p>}
        </div>
        {rechts && <div className="flex items-center gap-2 flex-wrap">{rechts}</div>}
      </div>
    </div>
  )
}

/** Op de gsm een blad van onderen, op de computer een venster in het midden. */
export function Venster({ titel, sub, onSluit, children, breed }: { titel: React.ReactNode; sub?: React.ReactNode; onSluit: () => void; children: React.ReactNode; breed?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 sm:p-4" onClick={onSluit}>
      <div className={`bg-white w-full ${breed ? 'sm:max-w-2xl' : 'sm:max-w-lg'} rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto overscroll-contain`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={typeof titel === 'string' ? titel : undefined}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="min-w-0"><h3 className="font-semibold truncate">{titel}</h3>{sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}</div>
          <button type="button" onClick={onSluit} className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4">{children}</div>
      </div>
    </div>
  )
}

export function Chip({ aan, onClick, children }: { aan: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={aan} className={`px-2.5 py-1 rounded-full text-xs border ${aan ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:border-gray-400 bg-white'}`}>{children}</button>
}
