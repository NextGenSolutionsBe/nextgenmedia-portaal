'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { leesGetal } from '@/lib/getal'
import type { Vennoot } from '@/lib/vesting-akkoord'
import type { KostWeergave } from '@/lib/vesting-weergave'
import { Akkoord, Paneel, api, datumKort, eur } from './delen'

const INP = 'input-base'

/** Een algemene kost (bv. de afsluiting van WAM) die van Marco's totaal afgaat, met het akkoord. */
export function KostVenster({ k, vennoten, ik, laatste, onLaatste, onClose, onVernieuw, volgende }: {
  k: KostWeergave
  vennoten: Record<Vennoot, string>
  ik: Vennoot | null
  laatste: string | null
  onLaatste: (png: string) => void
  onClose: () => void
  onVernieuw: () => void
  volgende?: (() => void) | null
}) {
  const [bewerk, setBewerk] = useState(false)
  const [weg, setWeg] = useState(false)
  const [bezig, setBezig] = useState(false)

  const verwijder = async () => {
    setBezig(true)
    try {
      await api(`/api/admin/vesting?resource=kost&id=${k.id}`, { method: 'DELETE' })
      toast.success('Kost verwijderd.')
      onClose(); onVernieuw()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt'); setBezig(false) }
  }

  return (
    <Paneel titel={k.omschrijving} sub={`${eur(k.bedrag, true)} · ${datumKort(k.datum)}`} onClose={onClose}
      voet={volgende ? <div className="flex justify-end"><button type="button" onClick={volgende} className="btn-secondary text-sm">Volgende</button></div> : undefined}>
      <section>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Kost</h3>
          {!bewerk && <button type="button" onClick={() => setBewerk(true)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Pencil className="h-3 w-3" />Aanpassen</button>}
        </div>
        {bewerk
          ? <KostForm k={k} onKlaar={() => { setBewerk(false); onVernieuw() }} onAnnuleer={() => setBewerk(false)} />
          : <p className="text-sm text-gray-700">{eur(k.bedrag, true)} gaat van het totaal af dat voor Marco meetelt: eerst van wat WAM opbracht, wat overblijft van de contracten.</p>}
      </section>

      <Akkoord onderwerp="kost" id={k.id} akkoord={k.akkoord} vennoten={vennoten} ik={ik} laatste={laatste} onLaatste={onLaatste} onGetekend={onVernieuw}
        uitleg={`Je tekent dat ${eur(k.bedrag, true)} (${k.omschrijving}) van Marco's totaal afgaat.`} />

      <section className="pt-2">
        {!weg
          ? <button type="button" onClick={() => setWeg(true)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-700"><Trash2 className="h-3 w-3" />Kost verwijderen</button>
          : <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 space-y-2">
              <p>De kost telt dan niet meer als aftrek; Marco's aandeel wordt herberekend.</p>
              <div className="flex gap-2">
                <button type="button" onClick={verwijder} disabled={bezig} className="btn-danger text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Verwijderen</button>
                <button type="button" onClick={() => setWeg(false)} className="btn-secondary text-sm">Annuleren</button>
              </div>
            </div>}
      </section>
    </Paneel>
  )
}

export function KostForm({ k, onKlaar, onAnnuleer }: { k: KostWeergave | null; onKlaar: () => void; onAnnuleer: () => void }) {
  const [omschrijving, setOmschrijving] = useState(k?.omschrijving ?? '')
  const [bedrag, setBedrag] = useState(k ? String(k.bedrag).replace('.', ',') : '')
  const [datum, setDatum] = useState(k?.datum ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }))
  const [bezig, setBezig] = useState(false)
  const b = leesGetal(bedrag)
  const ok = omschrijving.trim().length > 1 && b !== null && b > 0

  const bewaar = async () => {
    setBezig(true)
    try {
      await api('/api/admin/vesting', { method: k ? 'PATCH' : 'POST', body: JSON.stringify({ resource: 'kost', ...(k ? { id: k.id } : {}), omschrijving: omschrijving.trim(), bedrag: b, datum }) })
      toast.success(k ? 'Kost aangepast.' : 'Kost toegevoegd.')
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="space-y-2">
      <input className={INP} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} placeholder="Bv. afsluiting WAM (boekhouder, VOF)" autoFocus maxLength={200} aria-label="Omschrijving" />
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
          <input className={`${INP} pl-7`} inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="0" aria-label="Bedrag excl. btw" />
        </div>
        <input className={INP} type="date" value={datum} onChange={(e) => setDatum(e.target.value)} aria-label="Datum" />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={bewaar} disabled={!ok || bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
        <button type="button" onClick={onAnnuleer} className="btn-secondary text-sm">Annuleren</button>
      </div>
    </div>
  )
}
