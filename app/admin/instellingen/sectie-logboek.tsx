'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Kop, INP, datumTijd } from './ui'

type Rij = { id: string; action: string; entity_type: string | null; entity_id: string | null; summary: string | null; actor_email: string | null; actor_role: string | null; metadata: unknown; ip: string | null; created_at: string }

export function SectieLogboek() {
  const [q, setQ] = useState(''); const [actie, setActie] = useState(''); const [actor, setActor] = useState(''); const [van, setVan] = useState(''); const [tot, setTot] = useState('')
  const [pagina, setPagina] = useState(1)
  const [data, setData] = useState<{ rijen: Rij[]; totaal: number; perPagina: number; groepen: string[] } | null>(null)
  const [laden, setLaden] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const laad = useCallback(async (p = pagina) => {
    setLaden(true)
    try {
      const sp = new URLSearchParams({ pagina: String(p) })
      if (q) sp.set('q', q); if (actie) sp.set('actie', actie); if (actor) sp.set('actor', actor); if (van) sp.set('van', van); if (tot) sp.set('tot', tot)
      const r = await fetch(`/api/admin/instellingen/logboek?${sp}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setData(j); setPagina(p)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [q, actie, actor, van, tot, pagina])
  useEffect(() => { laad(1) }, [actie]) // eslint-disable-line react-hooks/exhaustive-deps

  const paginas = data ? Math.max(1, Math.ceil(data.totaal / data.perPagina)) : 1

  return (
    <div className="card-base">
      <Kop titel="Activiteitenlogboek" tekst="Wie deed wat, wanneer. Instellingen, medewerkers, integratietests en de belangrijkste acties in de modules. Gevoelige waarden (wachtwoorden, sleutels) komen hier nooit in." />
      <form className="grid sm:grid-cols-6 gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); laad(1) }}>
        <div className="sm:col-span-2 relative">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
          <input className={`${INP} pl-9`} placeholder="Zoek in omschrijving, actie, id…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={INP} value={actie} onChange={(e) => setActie(e.target.value)}>
          <option value="">Alle acties</option>
          {(data?.groepen ?? []).map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <input className={INP} placeholder="Gebruiker (e-mail)" value={actor} onChange={(e) => setActor(e.target.value)} />
        <input type="date" className={INP} value={van} onChange={(e) => setVan(e.target.value)} />
        <div className="flex gap-2">
          <input type="date" className={INP} value={tot} onChange={(e) => setTot(e.target.value)} />
          <button type="submit" className="btn-primary shrink-0" disabled={laden}>{laden ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Zoek'}</button>
        </div>
      </form>

      {!data ? <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        : data.rijen.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">Geen activiteit gevonden voor deze filters.</p>
        : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[720px]">
              <thead><tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide"><th className="px-2 py-2 font-medium">Wanneer</th><th className="px-2 py-2 font-medium">Wie</th><th className="px-2 py-2 font-medium">Actie</th><th className="px-2 py-2 font-medium">Omschrijving</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {data.rijen.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <td className="px-2 py-2 whitespace-nowrap text-gray-600">{datumTijd(r.created_at)}</td>
                      <td className="px-2 py-2 text-gray-700">{r.actor_email ?? <span className="text-gray-400">systeem</span>}{r.actor_role && <span className="text-[10px] text-gray-400 ml-1">({r.actor_role})</span>}</td>
                      <td className="px-2 py-2"><code className="text-[11px] bg-gray-100 rounded px-1.5 py-0.5">{r.action}</code></td>
                      <td className="px-2 py-2 text-gray-800">{r.summary ?? '—'}</td>
                    </tr>
                    {open === r.id && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={4} className="px-3 py-2 text-xs">
                          <div className="grid sm:grid-cols-3 gap-2 mb-2 text-gray-600">
                            <div><span className="text-gray-400">Entiteit:</span> {r.entity_type ?? '—'} {r.entity_id ? <code className="bg-gray-100 rounded px-1">{r.entity_id}</code> : null}</div>
                            <div><span className="text-gray-400">IP:</span> {r.ip ?? '—'}</div>
                            <div><span className="text-gray-400">Id:</span> <code className="bg-gray-100 rounded px-1">{r.id}</code></div>
                          </div>
                          <pre className="bg-white border border-gray-100 rounded-lg p-2 overflow-x-auto max-h-64 text-[11px]">{JSON.stringify(r.metadata ?? {}, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {data && (
        <div className="flex items-center justify-between gap-3 pt-3 mt-2 border-t border-gray-100 text-xs text-gray-500">
          <span>{data.totaal} regel{data.totaal === 1 ? '' : 's'} · pagina {pagina} van {paginas}</span>
          <div className="flex gap-1">
            <button type="button" onClick={() => laad(pagina - 1)} disabled={pagina <= 1 || laden} className="h-7 w-7 flex items-center justify-center rounded-lg border border-gray-200 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => laad(pagina + 1)} disabled={pagina >= paginas || laden} className="h-7 w-7 flex items-center justify-center rounded-lg border border-gray-200 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  )
}
