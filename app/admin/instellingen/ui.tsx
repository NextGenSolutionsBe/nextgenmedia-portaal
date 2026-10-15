'use client'

import { useEffect, type ReactNode } from 'react'
import { Loader2, X, AlertTriangle } from 'lucide-react'

/** Gedeelde bouwstenen van de instellingenpagina — zelfde stijl als de rest van de admin. */

export const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#fff848]/60 disabled:bg-gray-50 disabled:text-gray-400'

export function Kop({ titel, tekst, rechts }: { titel: string; tekst?: string; rechts?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
      <div>
        <h2 className="font-semibold text-gray-900">{titel}</h2>
        {tekst && <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">{tekst}</p>}
      </div>
      {rechts}
    </div>
  )
}

export function Groep({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">{titel}</div>
      {children}
    </div>
  )
}

export function Veld({ label, hint, children, breed }: { label: ReactNode; hint?: string; children: ReactNode; breed?: boolean }) {
  return (
    <div className={breed ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

export function Tekst({ label, value, onChange, type = 'text', placeholder, hint, breed, disabled, maxLength }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; hint?: string; breed?: boolean; disabled?: boolean; maxLength?: number
}) {
  return (
    <Veld label={label} hint={hint} breed={breed}>
      <input type={type} className={INP} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} maxLength={maxLength} />
    </Veld>
  )
}

export function Getal({ label, value, onChange, hint, min, max, stap, eenheid }: {
  label: string; value: number; onChange: (v: number) => void; hint?: string; min?: number; max?: number; stap?: number; eenheid?: string
}) {
  return (
    <Veld label={label} hint={hint}>
      <div className="relative">
        <input type="number" className={INP} value={Number.isFinite(value) ? value : ''} min={min} max={max} step={stap ?? 1}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
        {eenheid && <span className="absolute right-3 top-2 text-xs text-gray-400">{eenheid}</span>}
      </div>
    </Veld>
  )
}

export function Schakelaar({ aan, onChange, disabled, label }: { aan: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={aan} aria-label={label} disabled={disabled} onClick={() => onChange(!aan)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${aan ? 'bg-green-500' : 'bg-gray-300'}`}>
      <span className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform" style={{ transform: aan ? 'translateX(18px)' : 'translateX(2px)' }} />
    </button>
  )
}

/** Vaste balk onderaan een formulier: opslaan / annuleren / laatst bijgewerkt. */
export function OpslaanBalk({ vuil, bezig, onOpslaan, onAnnuleer, bijgewerkt, extra }: {
  vuil: boolean; bezig: boolean; onOpslaan: () => void; onAnnuleer: () => void
  bijgewerkt?: { op: string; door: string | null } | null; extra?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-4 mt-2 border-t border-gray-100">
      <div className="text-[11px] text-gray-400">
        {vuil ? <span className="text-amber-700">Niet-opgeslagen wijzigingen</span>
          : bijgewerkt ? `Laatst opgeslagen ${new Date(bijgewerkt.op).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${bijgewerkt.door ? ` door ${bijgewerkt.door}` : ''}`
          : 'Standaardwaarden (nog nooit opgeslagen)'}
      </div>
      <div className="flex items-center gap-2">
        {extra}
        <button type="button" onClick={onAnnuleer} disabled={!vuil || bezig} className="btn-secondary disabled:opacity-40">Annuleren</button>
        <button type="button" onClick={onOpslaan} disabled={!vuil || bezig} className="btn-primary disabled:opacity-40">
          {bezig && <Loader2 className="h-4 w-4 animate-spin" />}Wijzigingen opslaan
        </button>
      </div>
    </div>
  )
}

export function Dialoog({ titel, children, onSluit, breed }: { titel: string; children: ReactNode; onSluit: () => void; breed?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f)
  }, [onSluit])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onSluit}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${breed ? 'max-w-2xl' : 'max-w-lg'} max-h-[90dvh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 className="font-semibold">{titel}</h3>
          <button onClick={onSluit} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Bevestig({ titel, tekst, bevestigLabel = 'Bevestigen', gevaarlijk, bezig, onBevestig, onAnnuleer }: {
  titel: string; tekst: ReactNode; bevestigLabel?: string; gevaarlijk?: boolean; bezig?: boolean; onBevestig: () => void; onAnnuleer: () => void
}) {
  return (
    <Dialoog titel={titel} onSluit={onAnnuleer}>
      <div className="flex gap-3">
        <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${gevaarlijk ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}><AlertTriangle className="h-4 w-4" /></div>
        <div className="text-sm text-gray-700 leading-relaxed">{tekst}</div>
      </div>
      <div className="flex gap-2 justify-end pt-5">
        <button type="button" onClick={onAnnuleer} disabled={bezig} className="btn-secondary">Annuleren</button>
        <button type="button" onClick={onBevestig} disabled={bezig} className={gevaarlijk ? 'btn-danger' : 'btn-primary'}>
          {bezig && <Loader2 className="h-4 w-4 animate-spin" />}{bevestigLabel}
        </button>
      </div>
    </Dialoog>
  )
}

export function Badge({ kleur, children }: { kleur: 'groen' | 'grijs' | 'rood' | 'amber' | 'blauw'; children: ReactNode }) {
  const k = { groen: 'bg-green-100 text-green-700', grijs: 'bg-gray-100 text-gray-600', rood: 'bg-red-100 text-red-600', amber: 'bg-amber-100 text-amber-800', blauw: 'bg-blue-100 text-blue-700' }[kleur]
  return <span className={`status-badge ${k}`}>{children}</span>
}

export const datumTijd = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

export function Laden() {
  return <div className="card-base text-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
}
