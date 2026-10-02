'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, PlugZap, KeyRound } from 'lucide-react'
import type { Integratie } from '@/lib/instellingen/integraties'
import { Kop, Badge, Laden, datumTijd } from './ui'

export function SectieIntegraties({ isAdmin }: { isAdmin: boolean }) {
  const [rijen, setRijen] = useState<Integratie[] | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [resultaat, setResultaat] = useState<Record<string, { ok: boolean; bericht: string }>>({})

  const laad = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/instellingen/integraties', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setRijen(j.integraties ?? [])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setRijen([]) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const doe = async (key: string, actie: 'test' | 'sync') => {
    setBezig(`${key}:${actie}`)
    try {
      const r = await fetch('/api/admin/instellingen/integraties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, actie }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setResultaat((p) => ({ ...p, [key]: { ok: j.ok, bericht: j.bericht } }))
      if (j.ok) toast.success(j.bericht); else toast.error(j.bericht)
      if (actie === 'sync') laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  if (!rijen) return <Laden />
  const badge = (s: Integratie['status']) => s === 'actief' ? <Badge kleur="groen">Actief</Badge> : s === 'fout' ? <Badge kleur="rood">Fout</Badge> : s === 'niet_ingesteld' ? <Badge kleur="grijs">Niet ingesteld</Badge> : <Badge kleur="amber">Onbekend</Badge>

  return (
    <div className="card-base">
      <Kop titel="Integraties" tekst="Status van de koppelingen. Sleutels en tokens staan enkel in de omgevingsvariabelen van de hosting; hier zie je alleen de laatste vier tekens, nooit de volledige waarde." rechts={<button type="button" onClick={laad} className="btn-secondary"><RefreshCw className="h-4 w-4" />Vernieuwen</button>} />
      <div className="grid md:grid-cols-2 gap-3">
        {rijen.map((i) => (
          <div key={i.key} className="rounded-xl border border-gray-100 p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-sm">{i.naam}</div>
                <div className="text-[11px] text-gray-500">{i.omschrijving}</div>
              </div>
              {badge(i.status)}
            </div>
            <dl className="text-xs grid grid-cols-[90px_1fr] gap-x-2 gap-y-0.5">
              <dt className="text-gray-400 flex items-center gap-1"><KeyRound className="h-3 w-3" />Sleutel</dt><dd className="font-mono">{i.sleutel ?? <span className="text-gray-400 font-sans">—</span>}</dd>
              <dt className="text-gray-400">Laatste sync</dt><dd>{i.laatsteSync ? datumTijd(i.laatsteSync) : <span className="text-gray-400">n.v.t.</span>}</dd>
            </dl>
            <ul className="text-[11px] text-gray-600 space-y-0.5">{i.details.map((d) => <li key={d}>· {d}</li>)}</ul>
            {resultaat[i.key] && <div className={`text-xs rounded-lg px-2.5 py-1.5 ${resultaat[i.key].ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{resultaat[i.key].bericht}</div>}
            {isAdmin && (i.kanTesten || i.kanSync) && (
              <div className="flex gap-2 pt-1">
                {i.kanTesten && <button type="button" onClick={() => doe(i.key, 'test')} disabled={!!bezig} className="btn-secondary text-xs h-8">{bezig === `${i.key}:test` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}Verbinding testen</button>}
                {i.kanSync && <button type="button" onClick={() => doe(i.key, 'sync')} disabled={!!bezig} className="btn-secondary text-xs h-8">{bezig === `${i.key}:sync` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Opnieuw synchroniseren</button>}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-500 mt-4">Een sleutel wijzigen gebeurt in de hostingomgeving (Vercel → Environment Variables), nooit hier. Elke test en synchronisatie komt in het activiteitenlogboek.</p>
    </div>
  )
}
