'use client'

import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { euro2, type Moment } from '@/lib/facturatie/planner-model'

export type VerwijderBereik = 'dit' | 'toekomst'

/**
 * “Wil je dit facturatie-item verwijderen?” — met klant en omschrijving. Bij
 * een terugkerend item kies je: enkel dit item, of dit item en toekomstige
 * herhalingen. Eerdere items blijven altijd staan. Dit verwijdert enkel het
 * item in de interne planner, nooit een factuur in de externe boekhouding.
 */
export function VerwijderDialoog({ m, onAnnuleer, onBevestig }: { m: Moment; onAnnuleer: () => void; onBevestig: (bereik: VerwijderBereik) => Promise<void> }) {
  const reeks = !!m.recurring_id
  const [bereik, setBereik] = useState<VerwijderBereik>('dit')
  const [bezig, setBezig] = useState(false)
  const gefactureerd = m.status === 'verstuurd' || m.status === 'betaald'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" role="alertdialog" aria-modal="true" aria-labelledby="verwijder-titel">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h4 id="verwijder-titel" className="font-semibold text-gray-900">Wil je dit facturatie-item verwijderen?</h4>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
          <div className="font-medium text-gray-900">{m.klant}</div>
          <div className="text-gray-600">{m.omschrijving || m.project || m.dienst || m.type}</div>
          <div className="text-xs text-gray-500 mt-0.5">gepland {m.datum.split('-').reverse().join('/')} · {euro2(m.bedrag_excl)} excl. btw</div>
        </div>
        {reeks && (
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-gray-600 mb-1">Dit is een terugkerend item</legend>
            <label className="flex items-start gap-2 text-sm cursor-pointer"><input type="radio" name="bereik" className="mt-1" checked={bereik === 'dit'} onChange={() => setBereik('dit')} /><span><b className="font-medium">Alleen dit item verwijderen</b><span className="block text-xs text-gray-500">De andere maanden blijven staan; deze maand komt niet terug.</span></span></label>
            <label className="flex items-start gap-2 text-sm cursor-pointer"><input type="radio" name="bereik" className="mt-1" checked={bereik === 'toekomst'} onChange={() => setBereik('toekomst')} /><span><b className="font-medium">Dit item en toekomstige herhalingen verwijderen</b><span className="block text-xs text-gray-500">Eerdere items blijven behouden; al gefactureerde maanden ook.</span></span></label>
          </fieldset>
        )}
        <p className="text-[11px] text-gray-500">{gefactureerd ? 'Dit item staat al op gefactureerd. ' : ''}Enkel het item in deze planner verdwijnt; klant, contract en opdracht blijven bestaan, en er wordt niets in jullie boekhoudsoftware verwijderd.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onAnnuleer} disabled={bezig} className="btn-secondary text-sm" autoFocus>Annuleren</button>
          <button type="button" disabled={bezig} onClick={async () => { setBezig(true); try { await onBevestig(bereik) } finally { setBezig(false) } }} className="btn-primary text-sm bg-red-600 hover:bg-red-700 text-white border-red-600">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Verwijderen
          </button>
        </div>
      </div>
    </div>
  )
}
