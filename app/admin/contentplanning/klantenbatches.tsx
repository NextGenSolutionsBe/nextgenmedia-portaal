'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Layers, Info, EyeOff, Eye } from 'lucide-react'
import { REEKSEN, plusMaanden, type Reeks } from '@/lib/contentplanning/model'
import { focusRing } from './bouwstenen'
import type { CpData, Doe } from './types'
import { maandNaam } from './types'

/**
 * Klantenbatches — Chiara’s eerste werkdag van de maand (na de reeksen): per
 * klant aanduiden welke reeksen die maand van toepassing zijn.
 *   ✓ = deze maand wel   leeg = deze maand niet
 * Klikken zet aan/uit; met ingedrukte muis over meerdere vakjes slepen zet ze
 * allemaal op dezelfde waarde. Dit bord bepaalt welke taken klaargezet worden
 * en welke klanten in de dagelijkse werking per reeks verschijnen.
 */

type Waarde = boolean | undefined
const KOLOMMEN: { nr: Reeks; titel: string; sub: string }[] = [
  { nr: 1, titel: 'Reeks 1', sub: 'Contentkalender en meeting' },
  { nr: 2, titel: 'Reeks 2', sub: 'Shoot en editen' },
  { nr: 3, titel: 'Reeks 3', sub: 'Feedback, verwerken en statistieken' },
]
const volgende = (w: Waarde): Waarde => (w === true ? undefined : true)
const sleutel = (cid: string, r: Reeks) => `${cid}:${r}`

export function Klantenbatches({ data, maand, doe, onKlant, onKlaarzetten }: { data: CpData; maand: string; doe: Doe; onKlant: (id: string) => void; onKlaarzetten: () => void }) {
  const kan = data.kan.beheren
  const vanServer = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const c of data.bord) if (c.maand === maand && c.actief) m.set(sleutel(c.client_id, c.reeks), true)
    return m
  }, [data.bord, maand])
  const [cellen, setCellen] = useState<Map<string, boolean>>(vanServer)
  useEffect(() => { setCellen(vanServer) }, [vanServer])

  // Rijen: alle klanten met social media + wie al in de contentplanning staat, behalve wie verborgen is.
  const [toonVerborgen, setToonVerborgen] = useState(false)
  const verborgenSet = useMemo(() => new Set(data.instellingen.bord_verborgen), [data.instellingen.bord_verborgen])
  const kandidaten = useMemo(() => {
    const ids = new Set([...data.socialKlanten, ...data.cpKlanten.filter((k) => k.actief).map((k) => k.client_id)])
    return data.klanten.filter((k) => ids.has(k.id)).sort((a, b) => a.company_name.localeCompare(b.company_name, 'nl'))
  }, [data.klanten, data.socialKlanten, data.cpKlanten])
  const rijen = kandidaten.filter((k) => !verborgenSet.has(k.id))
  const verborgen = kandidaten.filter((k) => verborgenSet.has(k.id))
  const batchNaam = useMemo(() => new Map(data.batches.map((b) => [b.id, b])), [data.batches])

  // ── Slepen: één waarde over meerdere vakjes ──
  const verf = useRef<{ waarde: Waarde; gewijzigd: Map<string, Waarde> } | null>(null)
  const zet = (cid: string, r: Reeks, w: Waarde) => {
    setCellen((m) => { const n = new Map(m); if (w === undefined) n.delete(sleutel(cid, r)); else n.set(sleutel(cid, r), w); return n })
    verf.current?.gewijzigd.set(sleutel(cid, r), w)
  }
  const bewaar = async (gewijzigd: Map<string, Waarde>) => {
    // Per klant en waarde één verzoek.
    const groepen = new Map<string, { cid: string; w: Waarde; reeksen: Reeks[] }>()
    for (const [k, w] of gewijzigd) {
      const [cid, r] = k.split(':'); const g = `${cid}:${String(w)}`
      const x = groepen.get(g) ?? { cid, w, reeksen: [] }; x.reeksen.push(Number(r) as Reeks); groepen.set(g, x)
    }
    let fout = false
    for (const g of groepen.values()) {
      const r = await doe('batchbord.zet', { client_id: g.cid, maand, reeksen: g.reeksen, actief: g.w === undefined ? null : g.w }, { stil: true })
      if (!r) fout = true
    }
    if (!fout && gewijzigd.size) toast.success(gewijzigd.size === 1 ? 'Bewaard.' : `${gewijzigd.size} vakjes bewaard.`)
  }
  useEffect(() => {
    const los = () => { const v = verf.current; verf.current = null; if (v && v.gewijzigd.size) bewaar(v.gewijzigd) }
    window.addEventListener('pointerup', los)
    return () => window.removeEventListener('pointerup', los)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maand])
  const start = (cid: string, r: Reeks) => {
    if (!kan) return
    const w = volgende(cellen.get(sleutel(cid, r)))
    verf.current = { waarde: w, gewijzigd: new Map() }
    zet(cid, r, w)
  }
  const over = (cid: string, r: Reeks) => { if (verf.current) zet(cid, r, verf.current.waarde) }
  /** Toetsenbord: spatie/enter wisselt één vakje en bewaart meteen. */
  const toets = (e: React.KeyboardEvent, cid: string, r: Reeks) => {
    if (!kan || (e.key !== ' ' && e.key !== 'Enter')) return
    e.preventDefault()
    const w = volgende(cellen.get(sleutel(cid, r)))
    zet(cid, r, w); bewaar(new Map([[sleutel(cid, r), w]]))
  }

  const ingevuld = rijen.filter((k) => KOLOMMEN.some((c) => cellen.get(sleutel(k.id, c.nr)) === true)).length
  const telling = (r: Reeks) => rijen.filter((k) => cellen.get(sleutel(k.id, r)) === true).length
  const vorige = plusMaanden(maand, -1)
  const vorigeHeeftIets = data.bord.some((c) => c.maand === vorige)

  return (
    <div className="space-y-3">
      <div className="card-base p-3 flex items-center gap-2 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-semibold flex items-center gap-2"><Layers className="h-4 w-4" />Klantenbatches · <span className="capitalize">{maandNaam(maand)}</span></h2>
          <p className="text-xs text-gray-500">Waar zit elke klant deze maand? {ingevuld} van {rijen.length} klanten met minstens één ✓.</p>
        </div>
        <div className="flex-1" />
        {kan && <button type="button" onClick={async () => { const r = await doe('batchbord.kopieer', { van: vorige, naar: maand }, { stil: true }); if (r) toast.success(Number(r.overgenomen) ? `${r.overgenomen} vakjes overgenomen uit ${maandNaam(vorige)} — pas aan waar nodig.` : `Niets over te nemen uit ${maandNaam(vorige)}.`) }} disabled={!vorigeHeeftIets} className={`btn-secondary text-sm ${focusRing}`} title="Vult enkel lege vakjes in"><Copy className="h-4 w-4" />Vorige maand overnemen</button>}
        {kan && <button type="button" onClick={onKlaarzetten} className={`btn-primary text-sm ${focusRing}`}>Taken klaarzetten voor {maandNaam(maand).split(' ')[0]}</button>}
      </div>

      <div className="card-base p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm select-none" style={{ touchAction: 'none' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2.5 font-medium text-gray-600 min-w-[150px]">Klant <span className="font-normal text-gray-400">(social media)</span></th>
                {KOLOMMEN.map((c) => (
                  <th key={c.nr} className="px-2 py-2.5 text-center w-[26%] min-w-[92px]">
                    <div className="inline-flex items-center gap-1.5 font-semibold text-gray-900"><span className={`h-2 w-2 rounded-full ${REEKSEN[c.nr - 1].kleur}`} />{c.titel}</div>
                    <div className="text-[11px] font-normal text-gray-500 leading-tight">{c.sub}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rijen.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-500">Geen klanten met social media gevonden.</td></tr>}
              {rijen.map((k) => {
                const batch = k.batch_id ? batchNaam.get(k.batch_id) : null
                return (
                  <tr key={k.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => onKlant(k.id)} className={`text-left font-medium text-gray-900 hover:underline ${focusRing} rounded`}>{k.company_name}</button>
                        {kan && <button type="button" onClick={() => doe('bord.verberg', { client_id: k.id, verborgen: true }, { melding: `${k.company_name} staat niet meer op het bord (terug te zetten onderaan).` })} className={`ml-auto text-gray-300 hover:text-gray-700 p-1 rounded ${focusRing}`} aria-label={`${k.company_name} van het bord halen`} title="Van het bord halen (geen social media)"><EyeOff className="h-3.5 w-3.5" /></button>}
                      </div>
                      {batch && <div className="text-[10px] text-gray-500 inline-flex items-center gap-1 ml-2"><span className="h-1.5 w-1.5 rounded-full" style={{ background: batch.color }} />{batch.name}</div>}
                    </td>
                    {KOLOMMEN.map((c) => {
                      const w = cellen.get(sleutel(k.id, c.nr))
                      return (
                        <td key={c.nr} className="px-2 py-1.5 text-center">
                          <button type="button" disabled={!kan}
                            onPointerDown={(e) => { e.preventDefault(); start(k.id, c.nr) }} onPointerEnter={() => over(k.id, c.nr)} onKeyDown={(e) => toets(e, k.id, c.nr)}
                            aria-pressed={w === true} aria-label={`${k.company_name}, ${c.titel} (${c.sub}): ${w === true ? 'deze maand wel' : 'deze maand niet'}`}
                            className={`h-10 w-full max-w-[120px] rounded-lg border-2 inline-flex items-center justify-center transition-colors ${w === true ? 'bg-[#166534] border-[#166534] text-white' : 'bg-white border-gray-200 text-gray-300 hover:border-gray-500'} ${kan ? 'cursor-pointer' : 'cursor-default'} ${focusRing}`}>
                            {w === true ? <Check className="h-5 w-5" strokeWidth={3} /> : null}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
            {rijen.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200 text-xs text-gray-600">
                  <td className="px-3 py-2 font-medium">Deze maand ✓</td>
                  {KOLOMMEN.map((c) => <td key={c.nr} className="px-2 py-2 text-center font-semibold tabular-nums">{telling(c.nr)}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <p className="text-[11px] text-gray-500 flex items-start gap-1.5"><Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span><b>✓</b> = deze maand wel · leeg = deze maand niet. Klik om aan of uit te zetten, of sleep met ingedrukte muis over meerdere vakjes. “Taken klaarzetten” maakt enkel de taken van de reeksen met een ✓ (een kwartaalmeeting blijft per kwartaal); de klanten met een ✓ verschijnen per reeks in de dagelijkse werking. Zolang er voor een maand nog niets aangevinkt is, volgt de app het ritme en de batch van de klant.</span>
      </p>
      {verborgen.length > 0 && (
        <div className="text-xs text-gray-600">
          <button type="button" onClick={() => setToonVerborgen((x) => !x)} aria-expanded={toonVerborgen} className={`underline ${focusRing} rounded`}>{verborgen.length} klant(en) niet op het bord{toonVerborgen ? ' — verbergen' : ' — tonen'}</button>
          {toonVerborgen && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {verborgen.map((k) => (
                <li key={k.id} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1">
                  {k.company_name}
                  {kan && <button type="button" onClick={() => doe('bord.verberg', { client_id: k.id, verborgen: false }, { melding: `${k.company_name} staat terug op het bord.` })} className={`inline-flex items-center gap-0.5 underline ${focusRing} rounded`}><Eye className="h-3 w-3" />terugzetten</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
