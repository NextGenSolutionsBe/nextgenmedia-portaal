'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, EyeOff, Eye } from 'lucide-react'
import { REEKSEN, plusMaanden, type Reeks } from '@/lib/contentplanning/model'
import { focusRing } from './bouwstenen'
import { KAART } from './werking'
import type { CpData, Doe } from './types'
import { maandNaam } from './types'

/**
 * Batches — Chiara’s eerste werkdag van de maand (na de reeksen): per
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
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-cp-basis"><b className="text-cp-kop">{ingevuld}</b><span className="text-cp-zacht"> / {rijen.length} klanten ingevuld</span></span>
        <div className="flex-1" />
        {kan && <button type="button" onClick={async () => { const r = await doe('batchbord.kopieer', { van: vorige, naar: maand }, { stil: true }); if (r) toast.success(Number(r.overgenomen) ? `${r.overgenomen} vakjes overgenomen uit ${maandNaam(vorige)}.` : `Niets over te nemen uit ${maandNaam(vorige)}.`) }} disabled={!vorigeHeeftIets} className={`inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-cp-rand bg-cp-vlak text-cp-basis font-semibold hover:border-cp-ink disabled:opacity-40 ${focusRing}`}><Copy className="h-4 w-4" />Vorige maand overnemen</button>}
        {kan && <button type="button" onClick={onKlaarzetten} className={`inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-cp-ink text-cp-op-ink text-cp-basis font-semibold hover:opacity-90 active:scale-[0.98] transition-all ${focusRing}`}>Taken klaarzetten</button>}
      </div>

      <div className={`${KAART} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm select-none" style={{ touchAction: 'none' }}>
            <thead>
              <tr className="bg-cp-achtergrond border-b border-cp-rand">
                <th className="text-left px-5 py-3 text-cp-klein font-semibold text-cp-zacht min-w-[170px]">Klant</th>
                {KOLOMMEN.map((c) => (
                  <th key={c.nr} className="px-2 py-3 text-center w-[26%] min-w-[100px]">
                    <div className={`mx-auto mb-1.5 h-1.5 w-16 rounded-full ${REEKSEN[c.nr - 1].kleur}`} />
                    <div className="text-cp-basis font-bold">{c.titel}</div>
                    <div className="text-cp-klein font-normal text-cp-zacht leading-tight">{c.sub}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rijen.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-cp-basis text-cp-zacht">Geen klanten</td></tr>}
              {rijen.map((k) => {
                const batch = k.batch_id ? batchNaam.get(k.batch_id) : null
                return (
                  <tr key={k.id} className="border-b border-cp-rand last:border-b-0 hover:bg-cp-achtergrond transition-colors">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => onKlant(k.id)} className={`text-left text-cp-basis font-semibold hover:underline ${focusRing} rounded`}>{k.company_name}</button>
                        {kan && <button type="button" onClick={() => doe('bord.verberg', { client_id: k.id, verborgen: true }, { melding: `${k.company_name} staat niet meer op het bord.` })} className={`ml-auto text-cp-zacht hover:text-cp-ink p-1.5 rounded-lg ${focusRing}`} aria-label={`${k.company_name} van het bord halen`} title="Van het bord halen"><EyeOff className="h-4 w-4" /></button>}
                      </div>
                      {batch && <div className="text-cp-klein text-cp-zacht">{batch.name}</div>}
                    </td>
                    {KOLOMMEN.map((c) => {
                      const w = cellen.get(sleutel(k.id, c.nr))
                      return (
                        <td key={c.nr} className="px-2 py-2.5 text-center">
                          <button type="button" disabled={!kan}
                            onPointerDown={(e) => { e.preventDefault(); start(k.id, c.nr) }} onPointerEnter={() => over(k.id, c.nr)} onKeyDown={(e) => toets(e, k.id, c.nr)}
                            aria-pressed={w === true} aria-label={`${k.company_name}, ${c.titel} (${c.sub}): ${w === true ? 'deze maand wel' : 'deze maand niet'}`}
                            className={`h-12 w-full max-w-[140px] rounded-xl border-2 inline-flex items-center justify-center transition-all ${w === true ? `${REEKSEN[c.nr - 1].kleur} border-transparent text-white shadow-sm` : 'bg-cp-vlak border-cp-rand hover:border-cp-ink'} ${kan ? 'cursor-pointer active:scale-95' : 'cursor-default'} ${focusRing}`}>
                            {w === true ? <Check className="h-6 w-6 drop-shadow" strokeWidth={3} /> : null}
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
                <tr className="bg-cp-achtergrond border-t border-cp-rand text-cp-basis">
                  <td className="px-5 py-3 font-semibold">Totaal</td>
                  {KOLOMMEN.map((c) => <td key={c.nr} className="px-2 py-3 text-center font-bold tabular-nums">{telling(c.nr)}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {verborgen.length > 0 && (
        <div className="text-cp-klein text-cp-zacht">
          <button type="button" onClick={() => setToonVerborgen((x) => !x)} aria-expanded={toonVerborgen} className={`underline ${focusRing} rounded`}>{verborgen.length} verborgen klant(en)</button>
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
