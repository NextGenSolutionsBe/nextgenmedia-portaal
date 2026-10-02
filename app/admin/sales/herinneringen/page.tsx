'use client'

import { useCallback, useEffect, useState } from 'react'
import { PhoneCall, Loader2, Check, Undo2, Mail, MapPin, Clock, Building2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * De bellijst. Vervangt de herinneringsmails.
 *
 * Er gaat niets meer automatisch naar een prospect. Twee dagen vóór de afspraak
 * bellen we zelf even: is de uitnodiging aangekomen, staat het nog. Dat levert
 * meer op dan een mail die niemand leest, en je hoort meteen of iemand afhaakt.
 */

type Item = {
  appointmentId: string
  startsAt: string
  bedrijf: string | null
  contact: string | null
  telefoon: string | null
  email: string | null
  pipeline: string | null
  notitie: string | null
  dagenTot: number
  teLaat: boolean
}

const wanneer = (d: number) =>
  d === 0 ? 'vandaag' : d === 1 ? 'morgen' : d === 2 ? 'overmorgen' : `over ${d} dagen`

const tijd = (iso: string) =>
  new Date(iso).toLocaleString('nl-BE', {
    weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })

export default function BellijstPage() {
  const [tebellen, setTebellen] = useState<Item[]>([])
  const [later, setLater] = useState<Item[]>([])
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/sales/bellijst', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setTebellen(j.tebellen ?? [])
      setLater(j.later ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Laden mislukt')
    } finally { setLaden(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const markeer = async (i: Item, gebeld: boolean) => {
    setBezig(i.appointmentId)
    try {
      const r = await fetch('/api/admin/sales/bellijst', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: i.appointmentId, gebeld }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success(gebeld ? 'Afgevinkt' : 'Terug op de lijst')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Mislukt')
    } finally { setBezig(null) }
  }

  const Kaart = ({ i, afvinken }: { i: Item; afvinken: boolean }) => (
    <div className={`card-base ${i.teLaat ? 'border-red-200 bg-red-50/40' : ''}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium flex items-center gap-2 flex-wrap">
            <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
            {i.bedrijf ?? 'Onbekend bedrijf'}
            {i.pipeline && <span className="status-badge bg-gray-100 text-gray-600">{i.pipeline}</span>}
            {i.teLaat && <span className="status-badge bg-red-100 text-red-700">had al gebeld moeten zijn</span>}
          </div>
          {i.contact && <div className="text-sm text-gray-700 mt-0.5">{i.contact}</div>}
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
            <Clock className="h-3.5 w-3.5" />
            Afspraak {wanneer(i.dagenTot)} — {tijd(i.startsAt)}
          </div>
          {i.notitie && (
            <div className="text-xs text-gray-600 mt-1.5 whitespace-pre-wrap">{i.notitie}</div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {/* Het nummer is waarvoor je hier bent: groot, en aanklikbaar zodat
              je op een telefoon meteen kan bellen. */}
          {i.telefoon ? (
            <a href={`tel:${i.telefoon.replace(/\s/g, '')}`}
              className="text-base font-semibold text-gray-900 hover:underline flex items-center gap-1.5">
              <PhoneCall className="h-4 w-4" />{i.telefoon}
            </a>
          ) : (
            <span className="text-sm text-amber-700">geen nummer bekend</span>
          )}
          {i.email && (
            <a href={`mailto:${i.email}`} className="text-xs text-gray-500 hover:underline flex items-center gap-1">
              <Mail className="h-3 w-3" />{i.email}
            </a>
          )}
          {afvinken ? (
            <button onClick={() => markeer(i, true)} disabled={bezig === i.appointmentId}
              className="btn-primary mt-1 disabled:opacity-50">
              {bezig === i.appointmentId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Gebeld
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <PhoneCall className="h-6 w-6" />Bevestigingen
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Twee dagen vóór een afspraak bellen we de prospect: is de uitnodiging aangekomen, staat het nog.
          Er gaat geen mail meer automatisch uit.
        </p>
      </div>

      {laden ? (
        <div className="card-base text-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : (
        <>
          <div>
            <h2 className="font-semibold mb-2">
              Vandaag bellen {tebellen.length > 0 && <span className="text-gray-400">({tebellen.length})</span>}
            </h2>
            {tebellen.length === 0 ? (
              <div className="card-base text-center py-8 text-gray-400">
                <Check className="h-7 w-7 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Niemand te bellen vandaag</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tebellen.map((i) => <Kaart key={i.appointmentId} i={i} afvinken />)}
              </div>
            )}
          </div>

          {later.length > 0 && (
            <div>
              <h2 className="font-semibold mb-2 text-gray-600">
                Later deze weken <span className="text-gray-400">({later.length})</span>
              </h2>
              <p className="text-xs text-gray-500 mb-2">
                Nog niet aan de beurt. Ze verschijnen vanzelf bovenaan zodra ze twee dagen weg zijn.
              </p>
              <div className="space-y-2 opacity-75">
                {later.map((i) => <Kaart key={i.appointmentId} i={i} afvinken={false} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
