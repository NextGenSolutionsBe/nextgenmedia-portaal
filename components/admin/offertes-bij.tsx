'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Eye, Send, Loader2, Trash2, FilePlus2 } from 'lucide-react'
import { formatEuro } from '@/lib/utils'
import { offerteWeergave, verwijderVraag, type Offerte } from '@/lib/offertes'
import type { MailMerk } from '@/lib/merk-mail'
import { MailDialog } from '@/components/admin/mail-composer'
import { OfferteVersturen } from '@/components/admin/offerte-versturen'

type Rij = Offerte & { link: string }
const KLEUR: Record<string, string> = {
  grijs: 'bg-gray-100 text-gray-700', blauw: 'bg-blue-50 text-blue-800', amber: 'bg-amber-50 text-amber-900', groen: 'bg-green-50 text-green-800', rood: 'bg-red-50 text-red-700',
}

/**
 * Offertes van één project of klant, met de knop "Stuur offerte". Gebruikt op
 * de projectkaart en de klantdetail; beheer en sjablonen staan in Offertes.
 */
export function OffertesBij({ opdrachtId = null, clientId = null, klantNaam = null, merk = null, onVerstuurd }: {
  opdrachtId?: string | null; clientId?: string | null; klantNaam?: string | null; merk?: MailMerk | null; onVerstuurd?: () => void
}) {
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [mail, setMail] = useState<Rij | null>(null)
  const filter = opdrachtId ? `opdracht_id=${opdrachtId}` : clientId ? `client_id=${clientId}` : null

  const laad = useCallback(async () => {
    if (!filter) { setRijen([]); return }
    try {
      const r = await fetch(`/api/admin/offertes?${filter}`)
      const j = await r.json().catch(() => ({}))
      setRijen(r.ok ? (j.offertes ?? []) : [])
    } catch { setRijen([]) }
  }, [filter])
  useEffect(() => { void laad() }, [laad])

  const klaar = () => { void laad(); onVerstuurd?.() }
  const [weg, setWeg] = useState<string | null>(null)
  const verwijder = async (o: Rij) => {
    if (!confirm(verwijderVraag(o))) return
    setWeg(o.id)
    try {
      const r = await fetch(`/api/admin/offertes/${o.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Verwijderen mislukt')
      toast.success('Offerte verwijderd.'); klaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setWeg(null) }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link href={`/admin/offertes/opmaken?${new URLSearchParams({ ...(clientId ? { client: clientId } : {}), ...(opdrachtId ? { opdracht: opdrachtId } : {}) }).toString()}`} className="btn-primary text-xs h-8"><FilePlus2 className="h-3.5 w-3.5" />Offerte opmaken</Link>
          <OfferteVersturen clientId={clientId} opdrachtId={opdrachtId} klantNaam={klantNaam} merkStandaard={merk} label="Pdf versturen" className="btn-secondary text-xs h-8" onVerstuurd={klaar} />
        </div>
        <Link href="/admin/offertes?tab=sjablonen" className="text-[11px] text-gray-500 hover:text-black underline">Sjablonen beheren</Link>
      </div>
      {rijen === null ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : rijen.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {rijen.slice(0, 6).map((o) => {
            const w = offerteWeergave(o)
            return (
              <li key={o.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-900 truncate">{o.offertenummer ? `${o.offertenummer} · ` : ''}{o.titel}{o.bedrag_excl !== null && <span className="font-normal text-gray-500"> · {formatEuro(Number(o.bedrag_excl))}</span>}</p>
                  {w.sub && <p className="text-[11px] text-gray-500 truncate">{w.sub}</p>}
                </div>
                <span className={`status-badge ${KLEUR[w.kleur]}`}>{w.label}</span>
                <a href={`/api/admin/offertes/${o.id}/pdf`} target="_blank" rel="noreferrer" className="h-7 w-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Pdf bekijken"><Eye className="h-3.5 w-3.5" /></a>
                {(o.status === 'concept' || o.status === 'verstuurd') && (
                  <button type="button" onClick={() => setMail(o)} className="h-7 w-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title={o.status === 'concept' ? 'Versturen' : 'Opnieuw versturen'}><Send className="h-3.5 w-3.5" /></button>
                )}
                <button type="button" onClick={() => verwijder(o)} disabled={weg === o.id} className="h-7 w-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-red-600" title="Volledig verwijderen">{weg === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
              </li>
            )
          })}
        </ul>
      )}
      {mail && (
        <MailDialog
          context={{ type: 'offerte', offerteId: mail.id, titel: mail.titel, link: mail.link, klant: mail.klant_naam, contact: mail.ontvanger_naam, email: mail.ontvanger_email, geldigTot: mail.geldig_tot, merk: mail.merk }}
          onClose={() => setMail(null)}
          onSent={() => { toast.success('Verstuurd.'); setMail(null); klaar() }}
        />
      )}
    </div>
  )
}
