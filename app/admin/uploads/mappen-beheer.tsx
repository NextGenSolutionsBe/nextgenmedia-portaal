'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FolderPlus, Loader2, X, Trash2, Folder } from 'lucide-react'

/**
 * Submappen maken (en weghalen) in de map van een klant. Weghalen verwijdert
 * nooit een bestand: wat erin zat komt bij de losse bestanden.
 */
export function MappenBeheer({ clientId, mappen }: { clientId: string; mappen: { id: string; naam: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [naam, setNaam] = useState('')
  const [beschrijving, setBeschrijving] = useState('')
  const [bezig, setBezig] = useState<string | null>(null)

  const maak = async () => {
    if (!naam.trim()) { toast.error('Geef de map een naam.'); return }
    setBezig('maak')
    try {
      const r = await fetch('/api/admin/uploads/mappen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, naam, beschrijving }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Mislukt')
      toast.success(`Map "${j.map.naam}" staat klaar.`)
      setNaam(''); setBeschrijving('')
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  const weg = async (m: { id: string; naam: string }) => {
    if (!confirm(`Map "${m.naam}" weghalen? De bestanden blijven, ze komen bij de losse bestanden.`)) return
    setBezig(m.id)
    try {
      const r = await fetch(`/api/admin/uploads/mappen?id=${m.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Mislukt')
      toast.success('Map weggehaald.')
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 flex items-center gap-1.5">
        <FolderPlus className="h-3.5 w-3.5" />Nieuwe map
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Mappen">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold">Mappen van deze klant</h3>
              <button type="button" onClick={() => setOpen(false)} className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center" aria-label="Sluiten"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600" htmlFor="map-naam">Nieuwe map</label>
                <input id="map-naam" className="input-base" value={naam} onChange={(e) => setNaam(e.target.value)} maxLength={80} placeholder="Bv. Shoot november 2026" autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void maak() } }} />
                <input className="input-base" value={beschrijving} onChange={(e) => setBeschrijving(e.target.value)} maxLength={300} placeholder="Korte uitleg (optioneel)" />
                <button type="button" onClick={maak} disabled={!!bezig || !naam.trim()} className="btn-primary text-sm">
                  {bezig === 'maak' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}Map maken
                </button>
              </div>
              {mappen.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Bestaande mappen</p>
                  <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
                    {mappen.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <Folder className="h-4 w-4 text-gray-400 shrink-0" /><span className="flex-1 truncate">{m.naam}</span>
                        <button type="button" onClick={() => weg(m)} disabled={!!bezig} className="text-gray-400 hover:text-red-600 p-1" aria-label={`Map ${m.naam} weghalen`}>
                          {bezig === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-gray-400 mt-1">Weghalen verwijdert geen bestanden: ze komen bij de losse bestanden. De klant ziet de mappen ook in de klantapp.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
