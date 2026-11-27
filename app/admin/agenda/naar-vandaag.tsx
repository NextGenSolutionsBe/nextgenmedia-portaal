'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { CalendarCheck2, Loader2, ArrowRight } from 'lucide-react'
import { vandaag, plusDagen, kortDag, zoneNaarIso, type Item } from '@/lib/agenda/model'
import { vanVorigeDagen, verplaatsingen, zoalsHetWas, laatsteDag, hoeLangOpen, DAGEN_TERUG, MAX_VERPLAATS } from '@/lib/agenda/dag-afsluiten'
import { actie, api, Popover, focusRing, type BoomData } from './gedeeld'

type Resultaat = { ok: true; verplaatst: number; overgeslagen: number }
const taken = (n: number) => `${n} ${n === 1 ? 'taak' : 'taken'}`

/**
 * Naar vandaag: één knop die al jouw open taken van de vorige dagen (tot 30 dagen terug)
 * op vandaag zet. Eerst zie je hoeveel en welke, dan één klik; Ongedaan maken zet alles terug.
 * De lijst wordt pas geladen bij het openen, zodat de agenda er niet trager van wordt.
 */
export function NaarVandaag({ boom, onVernieuw, gsm = false }: { boom: BoomData; onVernieuw: () => void; gsm?: boolean }) {
  const [open, setOpen] = useState(false)
  const [lijst, setLijst] = useState<Item[] | null>(null)
  const [bezig, setBezig] = useState(false)
  // Klik op de knop terwijl het venster open is: het venster sluit al bij het indrukken, niet meteen opnieuw openen.
  const gesloten = useRef(0)
  const sluit = () => { gesloten.current = Date.now(); setOpen(false) }

  const openen = async () => {
    if (open) { setOpen(false); return }
    if (Date.now() - gesloten.current < 300) return
    setOpen(true); setLijst(null)
    try {
      const d = vandaag()
      const j = await api<{ items: Item[] }>(`/api/admin/agenda?van=${encodeURIComponent(zoneNaarIso(plusDagen(d, -DAGEN_TERUG - 1), '00:00'))}&tot=${encodeURIComponent(zoneNaarIso(plusDagen(d, 1), '00:00'))}`)
      setLijst(vanVorigeDagen(j.items, { ik: boom.ik, dag: d }))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setOpen(false) }
  }

  const verplaats = async () => {
    if (!lijst?.length) return
    const mee = lijst.slice(0, MAX_VERPLAATS)
    const terug = zoalsHetWas(mee)
    setBezig(true)
    try {
      const r = await actie<Resultaat>({ actie: 'item.verplaats', wijzigingen: verplaatsingen(mee, vandaag()) })
      setOpen(false); onVernieuw()
      if (!r.verplaatst) { toast.error('Er kon niets verplaatst worden.'); return }
      toast.success(`${taken(r.verplaatst)} naar vandaag${r.overgeslagen ? ` (${r.overgeslagen} niet)` : ''}.`, {
        duration: 10_000,
        action: {
          label: 'Ongedaan maken',
          onClick: async () => {
            try { await actie<Resultaat>({ actie: 'item.verplaats', wijzigingen: terug }); toast.success('Teruggezet.'); onVernieuw() }
            catch (e) { toast.error(e instanceof Error ? e.message : 'Terugzetten mislukt') }
          },
        },
      })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verplaatsen mislukt') } finally { setBezig(false) }
  }

  // Zelfde stijl als de knoppen in de filterrij. Op de gsm vooraan (bij Dag afsluiten), op de computer naast Takenlijst vandaag.
  const knop = <button type="button" onClick={openen} aria-expanded={open} title="Al je open taken van vorige dagen naar vandaag" className={`inline-flex items-center gap-1.5 rounded-full border h-8 px-3 bg-white border-gray-200 text-gray-700 hover:border-gray-400 text-xs ${focusRing}`}><CalendarCheck2 className="h-3.5 w-3.5" />Naar vandaag</button>

  const zichtbaar = (lijst ?? []).slice(0, 8)
  return (
    <div className={gsm ? 'relative md:hidden' : 'relative hidden md:block'}>
      {knop}
      <Popover open={open} onSluit={sluit} uitlijnen="rechts" zwevend className="w-80 p-3">
        {!lijst && <div className="py-6 flex items-center justify-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Even kijken…</div>}
        {lijst && !lijst.length && <div className="py-4 text-center text-sm text-gray-600">Niets meer open van vorige dagen.</div>}
        {lijst && lijst.length > 0 && (
          <>
            <div className="font-semibold text-gray-900">{taken(lijst.length)} van vorige dagen</div>
            <div className="text-xs text-gray-500 mb-2">Jouw open taken. De uren blijven staan.</div>
            <ul className="space-y-1 max-h-56 overflow-y-auto">
              {zichtbaar.map((t) => {
                const d = laatsteDag(t)
                return (
                  <li key={t.id} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate text-gray-800">{t.titel}</span>
                    {d && <span className="shrink-0 text-[11px] text-gray-500" title={kortDag(d)}>{hoeLangOpen(d)}</span>}
                  </li>
                )
              })}
            </ul>
            {lijst.length > zichtbaar.length && <div className="text-xs text-gray-500 mt-1">en nog {lijst.length - zichtbaar.length}</div>}
            {lijst.length > MAX_VERPLAATS && <div className="text-xs text-amber-700 mt-1">De eerste {MAX_VERPLAATS} gaan mee, druk daarna nog eens.</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className={`btn-secondary !py-1.5 !text-sm ${focusRing}`}>Annuleren</button>
              <button type="button" onClick={verplaats} disabled={bezig} className={`btn-primary !py-1.5 !text-sm ${focusRing}`}>
                {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Alles naar vandaag
              </button>
            </div>
          </>
        )}
      </Popover>
    </div>
  )
}
