'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X, Upload, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react'

type Field = { key: string; label: string; required?: boolean }
type Analysis = {
  headers: string[]
  rowCount: number
  /** Rijen die in Excel verborgen waren (filter) en NIET meegaan. */
  verborgenRijen?: number
  sample: string[][]
  mapping: Record<string, string>
  schoonVerslag?: { opgeschoond: number; perVeld: Record<string, number> }
  fields: Field[]
  aiUsed: boolean
  table: { headers: string[]; rows: string[][] }
}

/**
 * Bulk-import (§ nieuw): bestand → AI stelt de kolomkoppeling voor → mens
 * controleert en bevestigt → pas dán worden er leads aangemaakt.
 * Er wordt niets opgeslagen vóór de bevestiging.
 */
export function ImportModal({ pipelineId, onClose, onDone }: {
  pipelineId: string; onClose: () => void; onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [a, setA] = useState<Analysis | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [result, setResult] = useState<{ created: number; duplicate: number; skipped: number; alKlant?: number; problems: string[] } | null>(null)

  const analyse = async (file: File) => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/sales/import', { method: 'POST', body: fd })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setA(j)
      setMapping(j.mapping ?? {})
      if (j.aiUsed) toast.success('Kolommen geanalyseerd — controleer de koppeling hieronder.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Analyse mislukt') } finally { setBusy(false) }
  }

  const run = async () => {
    if (!a) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/sales/import', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineId, table: a.table, mapping }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setResult(j)
      onDone()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Importeren mislukt') } finally { setBusy(false) }
  }

  // Elk veld maar één keer: anders zou de tweede kolom de eerste stil overschrijven.
  const takenBy = (field: string) => Object.entries(mapping).find(([, v]) => v === field)?.[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Upload className="h-4 w-4 text-gray-400" />Leads importeren</h3>
            <p className="text-sm text-gray-600 mt-0.5">Upload een lijst; we stellen de kolomkoppeling voor en jij bevestigt.</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Klaar */}
          {result ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-semibold">{result.created} lead(s) toegevoegd</span>
              </div>
              {(result.alKlant ?? 0) > 0 && (
                <p className='text-sm text-gray-600'>
                  {result.alKlant} rij(en) overgeslagen — dat bedrijf is <b>al klant</b>. Die belanden nooit in de belijst.
                </p>
              )}
              {result.duplicate > 0 && (
                <p className="text-sm text-gray-600">
                  {result.duplicate} rij(en) overgeslagen — dat bedrijf stond al in deze pipeline.
                </p>
              )}
              {result.skipped > 0 && (
                <p className="text-sm text-gray-600">{result.skipped} rij(en) niet bruikbaar (geen bedrijfsnaam of een fout).</p>
              )}
              {result.problems?.length > 0 && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-0.5">
                  {result.problems.map((p, i) => <div key={i}>{p}</div>)}
                </div>
              )}
            </div>
          ) : !a ? (
            /* Stap 1: bestand kiezen */
            <div className="space-y-3">
              <label className="block border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-gray-300 hover:bg-gray-50 transition-colors">
                <Upload className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                <div className="text-sm font-medium text-gray-800">Kies een Excel- of CSV-bestand</div>
                <div className="text-xs text-gray-500 mt-1">.xlsx of .csv — max. 5 MB en 2000 rijen</div>
                <input type="file"
                  accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) analyse(f) }} />
              </label>
              <p className="text-[11px] text-gray-500">
                Sleep je Excel er gerust rechtstreeks in — omzetten naar CSV hoeft niet. De kolomvolgorde maakt
                niet uit: we herkennen de koppen zelf. Alleen het eerste tabblad wordt gelezen.
              </p>
              {busy && <div className="text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>}
            </div>
          ) : (
            /* Stap 2: koppeling controleren */
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-gray-400" />
                <span className="text-gray-700">
                  <b>{a.rowCount}</b> rij(en) gevonden. {a.aiUsed ? 'De onbekende kolommen zijn automatisch geduid.' : 'Kolommen automatisch herkend.'}
                </span>
              </div>

              {(a.verborgenRijen ?? 0) > 0 && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    <b>{a.verborgenRijen} rij(en) zijn in Excel verborgen</b> (een actief filter) en gaan
                    níét mee. Wil je ze wel importeren, hef dan het filter op in Excel en upload opnieuw.
                  </span>
                </p>
              )}

              {(a.schoonVerslag?.opgeschoond ?? 0) > 0 && (
                <p className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  {a.schoonVerslag!.opgeschoond} onbruikbare veldwaarde(n) opgeschoond — kale getallen of
                  ongeldige waarden in telefoon-, e-mail- of websitekolommen worden leeg geïmporteerd, nooit fout.
                </p>
              )}

              <div className="space-y-1.5">
                {a.headers.map((h) => {
                  const value = mapping[h] ?? ''
                  return (
                    <div key={h} className="flex items-center gap-2">
                      <div className="w-1/3 min-w-0">
                        <div className="text-sm font-medium truncate">{h}</div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {a.sample.map((r) => r[a.headers.indexOf(h)]).filter(Boolean)[0] || <span className="text-gray-300">leeg</span>}
                        </div>
                      </div>
                      <select className="input-base flex-1 text-sm" value={value}
                        onChange={(e) => setMapping((p) => ({ ...p, [h]: e.target.value }))}>
                        <option value="">— niet importeren —</option>
                        {a.fields.map((f) => {
                          const owner = takenBy(f.key)
                          const disabled = !!owner && owner !== h
                          return (
                            <option key={f.key} value={f.key} disabled={disabled}>
                              {f.label}{f.required ? ' *' : ''}{disabled ? ` (al: ${owner})` : ''}
                            </option>
                          )
                        })}
                      </select>
                    </div>
                  )
                })}
              </div>

              {!Object.values(mapping).includes('company.name') && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Wijs één kolom toe aan <b>Bedrijfsnaam</b> — zonder bedrijf kunnen we geen lead aanmaken.
                </p>
              )}

              <p className="text-[11px] text-gray-500">
Staat een bedrijf al in deze pipeline, dan slaan we die rij over. Bedrijven die al klant zijn worden er ook uitgehouden — er ontstaan nooit dubbele leads en je belt nooit je eigen klanten.
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          {result ? (
            <button onClick={onClose} className="btn-primary flex-1">Sluiten</button>
          ) : (
            <>
              <button onClick={run} disabled={busy || !a || !Object.values(mapping).includes('company.name')}
                className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {a ? `${a.rowCount} lead(s) importeren` : 'Importeren'}
              </button>
              <button onClick={onClose} className="btn-secondary">Annuleer</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
