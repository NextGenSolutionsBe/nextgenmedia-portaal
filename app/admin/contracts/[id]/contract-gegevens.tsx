'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Pencil, Save } from 'lucide-react'
import { Dialoog, INP } from '@/app/admin/instellingen/ui'
import { SERVICE_LABELS } from '@/lib/utils'
import { DURATION_TYPES } from '@/lib/contract-status'

type Gegevens = { title: string; client_id: string | null; service_slug: string | null; signer_name: string | null; signer_email: string | null; duration_type: string | null }
const LBL = 'block text-xs font-medium text-gray-600 mb-1'

/**
 * Titel, klant, dienst, ondertekenaar en contractduur van een contract
 * aanpassen. Bewaart via PATCH action 'gegevens' (met logboek). Start- en
 * einddatum, type en looptijdstatus hebben elk hun eigen bewerker op de pagina.
 */
export function ContractGegevens({ contractId, begin, isSigned, klanten }: { contractId: string; begin: Gegevens; isSigned: boolean; klanten: { id: string; company_name: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<Gegevens>(begin)
  const [bezig, setBezig] = useState(false)
  const zet = <K extends keyof Gegevens>(k: K, w: Gegevens[K]) => setV((o) => ({ ...o, [k]: w }))
  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'gegevens', ...v }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Opslaan mislukt')
      toast.success('Contractgegevens bewaard.'); setOpen(false); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }
  return (
    <>
      <button type="button" onClick={() => { setV(begin); setOpen(true) }} className="btn-secondary" title="Titel, klant, dienst, ondertekenaar en duur aanpassen"><Pencil className="h-4 w-4" />Gegevens</button>
      {open && (
        <Dialoog titel="Contractgegevens" onSluit={() => setOpen(false)} breed>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><label className={LBL}>Titel *</label><input className={INP} value={v.title} onChange={(e) => zet('title', e.target.value)} /></div>
              <div><label className={LBL}>Klant</label>
                <select className={INP} value={v.client_id ?? ''} onChange={(e) => zet('client_id', e.target.value || null)}>
                  <option value="">— Geen klant —</option>
                  {klanten.map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}
                  {v.client_id && !klanten.some((k) => k.id === v.client_id) && <option value={v.client_id}>Huidige klant</option>}
                </select></div>
              <div><label className={LBL}>Dienst</label>
                <select className={INP} value={v.service_slug ?? ''} onChange={(e) => zet('service_slug', e.target.value || null)}>
                  <option value="">— Geen dienst —</option>
                  {Object.entries(SERVICE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></div>
              <div><label className={LBL}>Naam ondertekenaar</label><input className={INP} value={v.signer_name ?? ''} onChange={(e) => zet('signer_name', e.target.value)} /></div>
              <div><label className={LBL}>E-mail ondertekenaar</label><input type="email" className={INP} value={v.signer_email ?? ''} onChange={(e) => zet('signer_email', e.target.value)} /></div>
              <div><label className={LBL}>Contractduur</label>
                <select className={INP} value={v.duration_type ?? ''} onChange={(e) => zet('duration_type', e.target.value || null)}>
                  <option value="">—</option>
                  {DURATION_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select></div>
            </div>
            {isSigned && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">Dit contract is al getekend. De ondertekende pdf en het certificaat blijven ongewijzigd; je past enkel de gegevens in de app aan. Elke wijziging komt in de tijdlijn.</p>}
            <p className="text-[11px] text-gray-500">Start- en einddatum, contracttype en looptijdstatus pas je rechtstreeks op de pagina aan.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Annuleren</button>
              <button type="button" disabled={bezig || !v.title.trim()} onClick={bewaar} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren</button>
            </div>
          </div>
        </Dialoog>
      )}
    </>
  )
}
