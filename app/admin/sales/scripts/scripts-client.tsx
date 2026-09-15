'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, Upload, FileText, Trash2, RefreshCw, ChevronDown, User, Users, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { sectieKleur, type ScriptAnalyse } from '@/lib/sales/script-analyse'
import { readJson } from '@/lib/upload'

type Script = {
  id: string; naam: string; eigenaar_auth_id: string | null; pipeline_id: string | null
  ruwe_tekst: string; bron_bestand: string | null; analyse: ScriptAnalyse | null
  geanalyseerd_op: string | null; actief: boolean; created_at: string
}
type Pipeline = { id: string; name: string }

export function ScriptsClient() {
  const [scripts, setScripts] = useState<Script[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [mijnId, setMijnId] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [laden, setLaden] = useState(true)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  // Welke stap loopt er? Zonder dit lijkt een trage analyse op 'er gebeurt niks'.
  const [stap, setStap] = useState<'opslaan' | 'analyseren' | null>(null)

  // Uploadformulier
  const [naam, setNaam] = useState('')
  const [tekst, setTekst] = useState('')
  const [bestand, setBestand] = useState<File | null>(null)
  const [eigenaar, setEigenaar] = useState<'mij' | 'algemeen'>('mij')
  const [merk, setMerk] = useState('')

  const laad = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/sales/scripts')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setScripts(j.scripts ?? [])
      setPipelines(j.pipelines ?? [])
      setMijnId(String(j.mijnAuthId ?? ''))
      setHint(j.hint ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Laden mislukt')
    } finally { setLaden(false) }
  }, [])
  useEffect(() => { laad() }, [laad])

  /**
   * Twee stappen, bewust apart. Het opslaan is snel en lukt vrijwel altijd;
   * de AI-analyse duurt tientallen seconden. Door ze te scheiden zie je het
   * script meteen verschijnen en gaat er bij een mislukte analyse niets
   * verloren — je klikt gewoon op "opnieuw analyseren".
   */
  const upload = async () => {
    if (!bestand && !tekst.trim()) { toast.error('Kies een bestand of plak de scripttekst.'); return }
    setBusy(true)
    setStap('opslaan')
    try {
      const fd = new FormData()
      if (bestand) fd.append('bestand', bestand)
      if (tekst.trim()) fd.append('tekst', tekst.trim())
      fd.append('naam', naam.trim())
      fd.append('eigenaar', eigenaar)
      if (merk) fd.append('pipelineId', merk)

      const r = await fetch('/api/admin/sales/scripts', { method: 'POST', body: fd })
      const j = await readJson(r)   // vangt ook een HTML-foutpagina netjes af
      const id = String(j.id ?? '')

      setNaam(''); setTekst(''); setBestand(null)
      await laad()

      // Stap 2: analyseren. Faalt dit, dan blijft het script gewoon staan.
      setStap('analyseren')
      try {
        const r2 = await fetch('/api/admin/sales/scripts', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, heranalyse: true }),
        })
        await readJson(r2)
        toast.success('Script geanalyseerd en klaar voor Focus Mode.')
      } catch (e) {
        toast.warning(
          `Het script is opgeslagen, maar de analyse lukte niet: ${e instanceof Error ? e.message : 'onbekende fout'}. `
          + 'Klik op het vernieuwicoon om het opnieuw te proberen.',
        )
      }
      await laad()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Uploaden mislukt')
    } finally { setBusy(false); setStap(null) }
  }

  const wijzig = async (id: string, body: Record<string, unknown>, melding?: string) => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/sales/scripts', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      if (melding) toast.success(melding)
      await laad()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bijwerken mislukt')
    } finally { setBusy(false) }
  }

  const verwijder = async (id: string, naamScript: string) => {
    if (!confirm(`Script "${naamScript}" verwijderen?`)) return
    setBusy(true)
    try {
      const r = await fetch(`/api/admin/sales/scripts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      await laad()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt')
    } finally { setBusy(false) }
  }

  if (laden) return <div className="text-center text-gray-400 py-16"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>

  return (
    <div className="space-y-6">
      {hint && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{hint}</p>
      )}

      {/* ── Nieuw script ── */}
      <div className="card-base space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Upload className="h-4 w-4 text-gray-400" />Nieuw script</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">
            Naam
            <input value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Bv. Prospectie NextGenMedia"
              className="input-base text-sm mt-1" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500">
              Van wie
              <select value={eigenaar} onChange={(e) => setEigenaar(e.target.value as 'mij' | 'algemeen')} className="input-base text-sm mt-1">
                <option value="mij">Mijn script</option>
                <option value="algemeen">Voor iedereen</option>
              </select>
            </label>
            <label className="text-xs text-gray-500">
              Merk
              <select value={merk} onChange={(e) => setMerk(e.target.value)} className="input-base text-sm mt-1">
                <option value="">Alle merken</option>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
        </div>
        <label className="block border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-gray-300 hover:bg-gray-50 transition-colors">
          <FileText className="h-5 w-5 text-gray-400 mx-auto mb-1" />
          <span className="text-sm font-medium">{bestand ? bestand.name : 'Kies een bestand (.pdf, .docx of .txt)'}</span>
          <input type="file" accept=".pdf,.docx,.txt,.md" className="hidden"
            onChange={(e) => setBestand(e.target.files?.[0] ?? null)} />
        </label>
        <div className="text-center text-[11px] text-gray-400">— of plak de tekst —</div>
        <textarea rows={4} value={tekst} onChange={(e) => setTekst(e.target.value)}
          placeholder="Plak hier je volledige belscript…" className="input-base text-sm" />
        <button onClick={upload} disabled={busy} className="btn-primary disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {stap === 'opslaan' ? 'Opslaan…' : stap === 'analyseren' ? 'Analyseren met AI…' : 'Uploaden en analyseren'}
        </button>
        <p className="text-[11px] text-gray-500">
          De AI deelt het script in — de tekst zelf blijft woordelijk de jouwe. De analyse duurt
          doorgaans 20 tot 60 seconden; het script verschijnt meteen in de lijst en wordt daarna ingevuld.
        </p>
      </div>

      {/* ── Bestaande scripts ── */}
      {scripts.length === 0 && !hint ? (
        <p className="text-sm text-gray-500 border border-gray-200 rounded-2xl px-4 py-10 text-center">
          Nog geen scripts. Upload er hierboven één — dan verschijnt hij in Focus Mode.
        </p>
      ) : (
        <div className="space-y-3">
          {scripts.map((s) => (
            <div key={s.id} className="card-base">
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => setOpen(open === s.id ? null : s.id)} className="text-left min-w-0 flex-1">
                  <div className="font-semibold flex items-center gap-2">
                    {s.naam}
                    <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', open === s.id && 'rotate-180')} />
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      {s.eigenaar_auth_id ? <User className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                      {s.eigenaar_auth_id ? (s.eigenaar_auth_id === mijnId ? 'Mijn script' : 'Van een collega') : 'Voor iedereen'}
                    </span>
                    <span>· {pipelines.find((p) => p.id === s.pipeline_id)?.name ?? 'Alle merken'}</span>
                    {s.analyse
                      ? <span>· {s.analyse.secties.length} secties, {s.analyse.bezwaren.length} bezwaren</span>
                      : <span className='text-amber-700 font-medium'>· nog niet geanalyseerd</span>}
                  </div>
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => wijzig(s.id, { actief: !s.actief }, s.actief ? 'Script uitgezet.' : 'Script actief.')}
                    disabled={busy}
                    className={cn('text-xs font-semibold px-2.5 py-1 rounded-lg border',
                      s.actief ? 'bg-green-50 border-green-200 text-green-700' : 'border-gray-200 text-gray-400')}
                  >
                    {s.actief ? 'Actief' : 'Uit'}
                  </button>
                  <button onClick={() => wijzig(s.id, { heranalyse: true }, 'Opnieuw geanalyseerd.')} disabled={busy}
                    title="Opnieuw analyseren" className="h-7 w-7 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center justify-center">
                    <RefreshCw className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                  <button onClick={() => verwijder(s.id, s.naam)} disabled={busy}
                    className="h-7 w-7 rounded-lg border border-red-200 hover:bg-red-50 flex items-center justify-center">
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </button>
                </div>
              </div>

              {open === s.id && s.analyse && (
                <div className="mt-4 grid lg:grid-cols-[1fr_280px] gap-5 border-t border-gray-100 pt-4">
                  <div className="space-y-4">
                    {s.analyse.secties.map((sec, i) => (
                      <section key={`${i}-${sec.kop}`}>
                        <h3 className={cn('text-xs font-bold uppercase tracking-wide mb-1', sectieKleur(sec.kop))}>{sec.kop}</h3>
                        <div className="text-sm leading-relaxed whitespace-pre-wrap">{sec.tekst}</div>
                      </section>
                    ))}
                  </div>
                  <div className="space-y-3">
                    {s.analyse.bezwaren.length > 0 && (
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wide text-red-600 mb-1.5">Bezwaren</h3>
                        <div className="space-y-2">
                          {s.analyse.bezwaren.map((b, i) => (
                            <div key={i} className="text-xs border border-gray-200 rounded-lg p-2">
                              <div className="font-semibold">“{b.bezwaar}”</div>
                              <div className="text-gray-600 mt-1 whitespace-pre-wrap">{b.reactie}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {s.analyse.weetjes.length > 0 && (
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1.5">Snel opzoeken</h3>
                        <ul className="text-xs text-gray-600 list-disc pl-4 space-y-0.5">
                          {s.analyse.weetjes.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
