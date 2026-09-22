'use client'

import { useState } from 'react'
import { Sparkles, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { DIENSTEN, VELD_TYPE_INFO, isAntwoordVeld, type Veld } from '@/lib/formulieren/model'

export type Voorstel = { titel: string; beschrijving: string; velden: Veld[] }

/**
 * "Beschrijf het formulier…" → AI-voorstel. De AI STELT ENKEL VOOR: dit paneel
 * toont het voorstel, en de ouder beslist via `acties` wat ermee gebeurt
 * (vervangen, toevoegen, aanmaken). Er wordt hier niets opgeslagen.
 */
export function AiVoorstelPaneel({ standaardDienst = 'algemeen', standaardDoel = '', acties, compact = false }: {
  standaardDienst?: string
  standaardDoel?: string
  acties: (voorstel: Voorstel, ctx: { dienst: string; doel: string; wis: () => void }) => React.ReactNode
  compact?: boolean
}) {
  const [prompt, setPrompt] = useState('')
  const [dienst, setDienst] = useState(standaardDienst)
  const [doel, setDoel] = useState(standaardDoel)
  const [bezig, setBezig] = useState(false)
  const [voorstel, setVoorstel] = useState<Voorstel | null>(null)

  const genereer = async () => {
    if (prompt.trim().length < 10) { toast.error('Beschrijf in minstens één zin wat het formulier moet vragen.'); return }
    setBezig(true)
    try {
      const r = await fetch('/api/admin/formulieren/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, dienst, doel }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'AI-voorstel mislukt')
      setVoorstel(j.voorstel)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'AI-voorstel mislukt') } finally { setBezig(false) }
  }

  if (voorstel) {
    const vragen = voorstel.velden.filter((v) => isAntwoordVeld(v.type)).length
    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />Voorstel — bevestiging vereist</div>
            <div className="font-semibold text-gray-900 mt-0.5">{voorstel.titel || 'Voorstel'}</div>
            {voorstel.beschrijving && <p className="text-xs text-gray-500 mt-0.5">{voorstel.beschrijving}</p>}
          </div>
          <button type="button" onClick={() => setVoorstel(null)} className="btn-secondary text-xs px-2 py-1 shrink-0" title="Opnieuw beschrijven"><RotateCcw className="h-3.5 w-3.5" />Opnieuw</button>
        </div>
        <div className="text-xs text-gray-500">{voorstel.velden.length} velden, waarvan {vragen} vragen</div>
        <ol className="max-h-72 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-100 text-sm">
          {voorstel.velden.map((v, i) => (
            <li key={v.id} className={`flex items-center gap-2 px-3 py-1.5 ${v.type === 'sectie' ? 'bg-gray-50 font-semibold' : ''}`}>
              <span className="text-[11px] text-gray-400 w-5 shrink-0 tabular">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate">{v.label || VELD_TYPE_INFO[v.type].label}{v.verplicht && <span className="text-red-500"> *</span>}</span>
              {v.voorwaarde && <span className="text-[10px] text-blue-600 shrink-0">voorwaarde</span>}
              <span className="text-[11px] text-gray-400 shrink-0">{VELD_TYPE_INFO[v.type].label}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">{acties(voorstel, { dienst, doel, wis: () => { setVoorstel(null); setPrompt('') } })}</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <textarea
        className="input-base" rows={compact ? 3 : 4} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000}
        placeholder="Beschrijf het formulier… bv. 'Intake voor een nieuw logo en huisstijl voor een bakkerij: vraag naar doelgroep, gewenste stijl, kleuren, bestaand logo en toepassingen.'"
      />
      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
        <select className="input-base" value={dienst} onChange={(e) => setDienst(e.target.value)} aria-label="Dienst">
          {DIENSTEN.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <input className="input-base" value={doel} onChange={(e) => setDoel(e.target.value)} placeholder="Doel (bv. Intake huisstijl)" maxLength={120} aria-label="Doel" />
        <button type="button" onClick={genereer} disabled={bezig} className="btn-primary">
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{bezig ? 'Bezig…' : 'Genereer velden'}
        </button>
      </div>
      {bezig && <p className="text-xs text-gray-400">De AI stelt het formulier samen, dit duurt meestal 10 à 30 seconden.</p>}
    </div>
  )
}
