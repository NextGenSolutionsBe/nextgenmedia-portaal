'use client'

import type { ReactNode } from 'react'
import { ExternalLink, Paperclip } from 'lucide-react'

/** Kleine, gedeelde bouwstenen voor Personeel (admin) en de werknemersomgeving. */

export async function api<T = Record<string, unknown>>(url: string, opts?: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
  const r = await fetch(url, {
    method: opts?.method ?? (opts?.body || opts?.form ? 'POST' : 'GET'),
    headers: opts?.form ? undefined : opts?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts?.form ?? (opts?.body ? JSON.stringify(opts.body) : undefined),
    cache: 'no-store',
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as { error?: string }).error || `Mislukt (${r.status})`)
  return j as T
}

const TZ = 'Europe/Brussels'
export const euro = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(n))
export const uren = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('nl-BE', { maximumFractionDigits: 2 })} u`)
export const datumNl = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—')
export const uurNl = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('nl-BE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '—')
export const dagVanIso = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
export const vandaagBE = () => dagVanIso(new Date().toISOString())
export const dagLang = (d: string) => new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))
export const kortUur = (u: string | null | undefined) => (u ? String(u).slice(0, 5) : '')
/** 'YYYY-MM-DDTHH:MM' voor een datetime-local invoerveld, in Belgische tijd. */
export function naarLokaal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const delen = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const w = (t: string) => delen.find((p) => p.type === t)?.value ?? '00'
  return `${w('year')}-${w('month')}-${w('day')}T${w('hour')}:${w('minute')}`
}
/** Omgekeerd: een datetime-local waarde (Belgische tijd) als ISO. */
export function vanLokaal(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null
  const [d, t] = v.split('T')
  const [j, m, dd] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const gok = Date.UTC(j, m - 1, dd, h, mi)
  const off = (ms: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms))
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value)
    return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute')) - ms) / 60000)
  }
  let t2 = gok - off(gok) * 60000
  t2 = gok - off(t2) * 60000
  return new Date(t2).toISOString()
}
export const duur = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} u ${String(m).padStart(2, '0')}` : `${m} min` }

export function Kaart({ label, waarde, sub, kleur, icon, onClick, actief }: { label: string; waarde: ReactNode; sub?: ReactNode; kleur?: string; icon?: ReactNode; onClick?: () => void; actief?: boolean }) {
  const inhoud = (
    <>
      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500"><span className="truncate">{label}</span>{icon}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${kleur ?? 'text-gray-900'}`}>{waarde}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </>
  )
  return onClick
    ? <button type="button" onClick={onClick} className={`card-base text-left p-3 transition-shadow hover:shadow-md ${actief ? 'ring-2 ring-black' : ''}`}>{inhoud}</button>
    : <div className="card-base p-3">{inhoud}</div>
}

export function Chip({ cls, children, klein }: { cls: string; children: ReactNode; klein?: boolean }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 ${klein ? 'py-0 text-[10px]' : 'py-0.5 text-[11px]'} font-medium whitespace-nowrap ${cls}`}>{children}</span>
}

export function Avatar({ naam, url, groot }: { naam: string; url?: string | null; groot?: boolean }) {
  const s = groot ? 'h-16 w-16 text-lg' : 'h-9 w-9 text-xs'
  const init = naam.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={naam} className={`${s} rounded-full object-cover border border-gray-200 shrink-0`} /> : <span className={`${s} rounded-full bg-[#fff848] text-black font-bold flex items-center justify-center shrink-0`}>{init}</span>
}

export type LinkItem = { naam: string; url?: string | null; pad?: string | null }
export function LinksLijst({ links, bestandUrl }: { links: LinkItem[] | null | undefined; bestandUrl: (pad: string) => string }) {
  if (!links?.length) return null
  return (
    <ul className="space-y-1">
      {links.map((l, i) => (
        <li key={i}>
          <a href={l.url ?? (l.pad ? bestandUrl(l.pad) : '#')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline break-all">
            {l.pad ? <Paperclip className="h-3 w-3 shrink-0" /> : <ExternalLink className="h-3 w-3 shrink-0" />}{l.naam}
          </a>
        </li>
      ))}
    </ul>
  )
}

export const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#fff848]/60 disabled:bg-gray-50 disabled:text-gray-400'
export const LBL = 'block text-xs font-medium text-gray-600 mb-1'
