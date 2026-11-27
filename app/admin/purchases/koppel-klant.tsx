'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { KlantProjectKiezer } from '@/components/admin/klant-project-kiezer'
import { NaarBody } from '@/components/admin/naar-body'

/**
 * Een aankoop aan een klant of project hangen (verbeterplan fase 7, punt 80).
 * Staat los van de goedkeuring: geen nieuwe versie, geen nieuw bewijs. Is de
 * aankoop al een kost, dan volgt die kost mee.
 */
export function KoppelKlant({ purchaseId, clientId, opdrachtId, klantNaam }: { purchaseId: string; clientId: string | null; opdrachtId: string | null; klantNaam: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState({ client_id: clientId, opdracht_id: opdrachtId })
  const [bezig, setBezig] = useState(false)
  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/purchases', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purchase_id: purchaseId, action: 'koppel', ...v }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      toast.success(v.client_id ? 'Gekoppeld aan de klant.' : 'Koppeling weggehaald.'); setOpen(false); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><Building2 className="h-3 w-3" />{klantNaam ? `Voor ${klantNaam}` : 'Klant of project'}</button>
      {open && (
        <NaarBody>
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !bezig && setOpen(false)}>
            <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Klant of project">
              <div className="flex items-center justify-between"><h3 className="font-semibold">Voor welke klant of welk project?</h3><button type="button" onClick={() => setOpen(false)} aria-label="Sluiten" className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"><X className="h-4 w-4" /></button></div>
              <KlantProjectKiezer clientId={v.client_id} opdrachtId={v.opdracht_id} onChange={setV} id={`aankoop-klant-${purchaseId}`} />
              <p className="text-[11px] text-gray-500">Telt mee in de marge van die klant. De goedkeuring blijft zoals ze is.</p>
              <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary w-full justify-center">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
            </div>
          </div>
        </NaarBody>
      )}
    </>
  )
}
