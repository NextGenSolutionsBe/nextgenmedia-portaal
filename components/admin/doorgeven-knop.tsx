'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowRightLeft, Check, Loader2, X } from 'lucide-react'
import { PROJECT_VERANTWOORDELIJKEN } from '@/lib/opdrachten-kanban'
import { PersoonKnop } from '@/components/admin/persoon-foto'
import { NaarBody } from '@/components/admin/naar-body'

/**
 * Doorgeven aan het andere bedrijf (fase 6): een klant van NextGenMedia die iets
 * voor NextGenSolutions nodig heeft, of omgekeerd. Naar Solutions = een deal in
 * Afspraak; naar Media = een kaart in Opvolging. Niets vanzelf: enkel op deze klik.
 */
export function DoorgevenKnop({ clientId, opdrachtId, van, klein }: { clientId?: string | null; opdrachtId?: string | null; van: 'nextgenmedia' | 'nextgensolutions' | null; klein?: boolean }) {
  const [open, setOpen] = useState(false)
  const [naar, setNaar] = useState<'nextgenmedia' | 'nextgensolutions'>(van === 'nextgensolutions' ? 'nextgenmedia' : 'nextgensolutions')
  const [wat, setWat] = useState('')
  const [wie, setWie] = useState<string>(naar === 'nextgensolutions' ? 'Marco' : 'Bram')
  const [bezig, setBezig] = useState(false)
  const doe = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/opdrachten/doorgeven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naar, client_id: clientId ?? null, opdracht_id: opdrachtId ?? null, wat, verantwoordelijke: wie }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(naar === 'nextgensolutions' ? 'Doorgegeven: staat als deal in Afspraak bij NextGenSolutions.' : 'Doorgegeven: staat als kaart in Opvolging op Projecten.', {
        action: { label: 'Openen', onClick: () => { window.location.href = naar === 'nextgensolutions' ? `/admin/nextgensolutions?deal=${j.id}` : `/admin/opdrachten?opdracht=${j.id}` } },
      })
      setOpen(false); setWat('')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={klein ? 'text-xs inline-flex items-center gap-1 text-gray-600 hover:text-gray-900' : 'btn-secondary'}><ArrowRightLeft className={klein ? 'h-3.5 w-3.5' : 'h-4 w-4'} />Doorgeven aan het andere bedrijf</button>
      {open && (
        <NaarBody>
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/30 sm:p-4" onClick={() => setOpen(false)}>
            <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Doorgeven aan het andere bedrijf">
              <div className="flex items-center justify-between"><h3 className="font-semibold">Doorgeven aan het andere bedrijf</h3><button type="button" onClick={() => setOpen(false)} aria-label="Sluiten" className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-gray-100"><X className="h-4 w-4" /></button></div>
              <div className="grid grid-cols-2 gap-2">
                {([['nextgensolutions', 'NextGenSolutions'], ['nextgenmedia', 'NextGenMedia']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => { setNaar(k); setWie(k === 'nextgensolutions' ? 'Marco' : 'Bram') }} disabled={van === k} className={`rounded-xl border px-3 py-2 text-sm text-left disabled:opacity-40 ${naar === k ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 hover:border-gray-400'}`}>{l}</button>
                ))}
              </div>
              <label className="block"><span className="block text-xs font-medium text-gray-600 mb-1">Wat heeft de klant nodig?</span><textarea rows={3} className="input-base" value={wat} onChange={(e) => setWat(e.target.value)} placeholder={naar === 'nextgensolutions' ? 'bv. offertes automatisch uit de mail' : 'bv. nieuwe bedrijfsvideo voor de website'} autoFocus /></label>
              <div>
                <span className="block text-xs font-medium text-gray-600 mb-1">Wie volgt op?</span>
                <div className="flex gap-1.5 flex-wrap">{PROJECT_VERANTWOORDELIJKEN.map((n) => <PersoonKnop key={n} naam={n} klein rol="button" aan={wie === n} onClick={() => setWie(n)} />)}</div>
              </div>
              <p className="text-[11px] text-gray-500">{naar === 'nextgensolutions' ? 'Er komt een deal in Afspraak bij NextGenSolutions, gekoppeld aan de klant.' : 'Er komt een kaart in Opvolging op Projecten.'} Er vertrekt geen mail.</p>
              <button type="button" onClick={doe} disabled={bezig || wat.trim().length < 3} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Doorgeven</button>
            </div>
          </div>
        </NaarBody>
      )}
    </>
  )
}
