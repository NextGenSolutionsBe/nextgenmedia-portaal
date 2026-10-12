'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarCog, Loader2 } from 'lucide-react'

/**
 * "Contentkalender beheren door klant" — per klant aan/uit (standaard uit).
 * Uit: de klant bekijkt, keurt goed en geeft feedback zoals altijd.
 * Aan: aanmaken, bewerken, inplannen, status (zonder goedkeuring over te slaan),
 * als gepubliceerd markeren en verwijderen — voor alle of geselecteerde gebruikers.
 */
type Data = { beheer: { aan: boolean; wie: 'alle' | 'geselecteerd'; eigenaar: boolean }; eigenaar: string | null; gebruikers: { id: string; naam: string | null; email: string | null; actief: boolean; beheer: boolean }[] }

export function KalenderBeheer({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [v, setV] = useState<Data['beheer'] | null>(null)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const zet = (d: Data) => { setData(d); setV(d.beheer); setSel(Object.fromEntries(d.gebruikers.map((g) => [g.id, g.beheer]))) }
  useEffect(() => { fetch(`/api/admin/clients/${clientId}/kalender-beheer`, { cache: 'no-store' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); zet(j) }).catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt')) }, [clientId])
  if (fout) return null
  if (!data || !v) return <div className="card-base py-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-gray-400" /></div>
  const gewijzigd = JSON.stringify(v) !== JSON.stringify(data.beheer) || data.gebruikers.some((g) => sel[g.id] !== g.beheer)
  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/clients/${clientId}/kalender-beheer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...v, gebruikers: v.wie === 'geselecteerd' ? sel : undefined }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      zet(j); toast.success(j.beheer.aan ? 'Kalenderbeheer door de klant staat aan.' : 'Kalenderbeheer door de klant staat uit.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="card-base space-y-3">
      <div className="flex items-start gap-3">
        <CalendarCog className="h-4 w-4 text-gray-400 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm">Contentkalender beheren door klant</h2>
          <p className="text-[11px] text-gray-500">Uit: de klant bekijkt, keurt goed en geeft feedback. Aan: de klant kan ook zelf items aanmaken, bewerken, inplannen, als gepubliceerd markeren en verwijderen. NextGenMedia behoudt altijd alle rechten.</p>
        </div>
        <button type="button" role="switch" aria-checked={v.aan} aria-label="Contentkalender beheren door klant" onClick={() => setV({ ...v, aan: !v.aan })} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${v.aan ? 'bg-[#166534]' : 'bg-gray-300'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${v.aan ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {v.aan && (
        <div className="space-y-2 pl-7">
          <div className="flex gap-4 text-sm flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={v.wie === 'alle'} onChange={() => setV({ ...v, wie: 'alle' })} />Alle gebruikers van deze klant</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={v.wie === 'geselecteerd'} onChange={() => setV({ ...v, wie: 'geselecteerd' })} />Enkel geselecteerde gebruikers</label>
          </div>
          {v.wie === 'geselecteerd' && (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">
              <li className="px-3 py-2"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={v.eigenaar} onChange={(e) => setV({ ...v, eigenaar: e.target.checked })} /><span className="flex-1">Eigenaar{data.eigenaar ? ` · ${data.eigenaar}` : ''}</span></label></li>
              {data.gebruikers.map((g) => (
                <li key={g.id} className={`px-3 py-2 ${g.actief ? '' : 'opacity-60'}`}><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!sel[g.id]} onChange={(e) => setSel({ ...sel, [g.id]: e.target.checked })} /><span className="flex-1 truncate">{g.naam || g.email}{g.naam && g.email ? <span className="text-gray-500"> · {g.email}</span> : null}{!g.actief && ' (inactief)'}</span></label></li>
              ))}
              {data.gebruikers.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">Geen subaccounts. Voeg ze toe onder “Gebruikers &amp; rechten”.</li>}
            </ul>
          )}
        </div>
      )}
      {gewijzigd && <div className="flex justify-end gap-2"><button type="button" onClick={() => zet(data)} className="btn-secondary text-xs">Annuleren</button><button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-xs">{bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Bewaren</button></div>}
    </div>
  )
}
