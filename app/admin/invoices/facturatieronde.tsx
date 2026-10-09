'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { X, Loader2, CheckCircle2, SkipForward, ChevronRight, ChevronLeft, RotateCcw, AlertTriangle, PartyPopper } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import { datumNl, euro2, type Moment } from '@/lib/facturatie/planner-model'
import { StatusBadge } from './planner/planner-detail'
import { ItemInhoud, KopieerKnop, factuurTekst, laadItem, type ItemData } from './item-inhoud'

/**
 * Facturatieronde: Bram werkt alles af wat t.e.m. vandaag gefactureerd moet
 * worden (achterstallig inbegrepen), één item tegelijk.
 *  · Kopiëren verandert niets aan de status.
 *  · Enkel “Markeren als gefactureerd” werkt een item af (wie + wanneer wordt
 *    bewaard; extern factuurnummer optioneel). Daarna wordt het item
 *    donkergroen en opent het volgende.
 *  · Een vergissing draai je terug met “Ongedaan maken”.
 *  · Ontbreken er gegevens, dan moet Bram dat eerst uitdrukkelijk aanvinken.
 */
export function Facturatieronde({ items, onSluit, onGewijzigd }: { items: Moment[]; onSluit: () => void; onGewijzigd: () => void }) {
  const [lijst] = useState(items)   // vaste volgorde voor de hele ronde
  const [index, setIndex] = useState(0)
  const [cache, setCache] = useState<Record<string, ItemData>>({})
  const [fout, setFout] = useState<string | null>(null)
  const [afgewerkt, setAfgewerkt] = useState<Set<string>>(new Set())
  const [overgeslagen, setOvergeslagen] = useState<Set<string>>(new Set())
  const [extern, setExtern] = useState<Record<string, string>>({})
  const [bevestigd, setBevestigd] = useState<Set<string>>(new Set())
  const [bezig, setBezig] = useState(false)
  const [klaar, setKlaar] = useState(false)
  const verder = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (verder.current) clearTimeout(verder.current) }, [])

  const huidig = lijst[index]
  const data = huidig ? cache[huidig.id] : undefined

  const haal = useCallback(async (m: Moment | undefined) => {
    if (!m || cache[m.id]) return
    try { const d = await laadItem(m.id); setCache((c) => ({ ...c, [m.id]: d })); setExtern((e) => (m.id in e ? e : { ...e, [m.id]: d.detail.extern_factuurnummer ?? '' })) }
    catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [cache])
  useEffect(() => { setFout(null); haal(huidig); haal(lijst[index + 1]) }, [index, huidig, lijst, haal])

  /** Het volgende item dat nog niet afgewerkt én niet overgeslagen is; -1 = ronde klaar. */
  const volgendeOpen = (vanaf: number, uitgesloten: Set<string>): number => {
    for (let i = vanaf + 1; i < lijst.length; i++) if (!uitgesloten.has(lijst[i].id)) return i
    for (let i = 0; i < vanaf; i++) if (!uitgesloten.has(lijst[i].id)) return i
    return -1
  }
  const ga = (i: number) => { if (verder.current) clearTimeout(verder.current); if (i < 0) { setKlaar(true); return } setIndex(i) }

  const markeer = async () => {
    if (!huidig || !data) return
    if (data.ontbrekend.length > 0 && !bevestigd.has(huidig.id)) { toast.error('Er ontbreken gegevens. Vink eerst aan dat je de factuur toch volledig opmaakte.'); return }
    setBezig(true)
    try {
      const r = await fetch('/api/admin/invoices/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'verstuurd', id: data.id, extern_nummer: extern[huidig.id] ?? '' }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Mislukt')
      const nieuw = new Set(afgewerkt); nieuw.add(huidig.id)
      setAfgewerkt(nieuw); setOvergeslagen((s) => { const n = new Set(s); n.delete(huidig.id); return n })
      setCache((c) => ({ ...c, [huidig.id]: { ...data, status: 'verstuurd' } }))
      toast.success(j.melding ?? `${huidig.klant} gemarkeerd als gefactureerd.`)
      onGewijzigd()
      // Even donkergroen tonen, dan het volgende item.
      const vol = volgendeOpen(index, new Set([...nieuw, ...overgeslagen]))
      verder.current = setTimeout(() => ga(vol), 900)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Markeren mislukt') } finally { setBezig(false) }
  }

  const ongedaan = async (m: Moment) => {
    const d = cache[m.id]; if (!d) return
    if (verder.current) clearTimeout(verder.current)
    setBezig(true)
    try {
      const r = await fetch('/api/admin/invoices/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'heropen', id: d.id }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Mislukt')
      setAfgewerkt((s) => { const n = new Set(s); n.delete(m.id); return n })
      setCache((c) => ({ ...c, [m.id]: { ...d, status: m.status } }))
      setKlaar(false); setIndex(lijst.findIndex((x) => x.id === m.id))
      toast.success('Ongedaan gemaakt — terug naar te factureren.'); onGewijzigd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Ongedaan maken mislukt') } finally { setBezig(false) }
  }

  const sla = () => {
    if (!huidig) return
    const n = new Set(overgeslagen); n.add(huidig.id); setOvergeslagen(n)
    ga(volgendeOpen(index, new Set([...afgewerkt, ...n])))
  }

  const aantalKlaar = afgewerkt.size
  const isKlaar = huidig ? afgewerkt.has(huidig.id) : false
  const pct = lijst.length ? Math.round((aantalKlaar / lijst.length) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 bg-[#f7f7f5] flex flex-col" role="dialog" aria-modal="true" aria-label="Facturatieronde">
      {/* Kop met voortgang */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">Facturatieronde</h2>
              <p className="text-xs text-gray-500"><b className="text-gray-900">{aantalKlaar} van {lijst.length}</b> afgewerkt{overgeslagen.size ? ` · ${overgeslagen.size} overgeslagen` : ''}</p>
            </div>
            <button type="button" onClick={onSluit} className="btn-secondary text-sm"><X className="h-4 w-4" />Sluiten</button>
          </div>
          <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-[#166534] transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
            {lijst.map((m, i) => (
              <button key={m.id} type="button" onClick={() => { setKlaar(false); ga(i) }} title={`${m.klant} · ${euro2(m.bedrag_excl)}`}
                className={`h-2.5 min-w-[18px] flex-1 rounded-full ${afgewerkt.has(m.id) ? 'bg-[#166534]' : overgeslagen.has(m.id) ? 'bg-gray-300' : m.status === 'achterstallig' ? 'bg-orange-400' : 'bg-gray-200'} ${i === index && !klaar ? 'ring-2 ring-black ring-offset-1' : ''}`} aria-label={`Item ${i + 1}: ${m.klant}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
        <div className="max-w-3xl mx-auto">
          {lijst.length === 0 && <Leeg tekst="Er staat vandaag niets te factureren. Mooi werk!" onSluit={onSluit} />}
          {klaar && lijst.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center space-y-3">
              <PartyPopper className="h-8 w-8 mx-auto text-[#166534]" />
              <h3 className="font-semibold text-lg">Ronde klaar</h3>
              <p className="text-sm text-gray-600">{aantalKlaar} van {lijst.length} afgewerkt{overgeslagen.size ? `, ${overgeslagen.size} overgeslagen` : ''}.</p>
              {lijst.some((m) => !afgewerkt.has(m.id)) && <button type="button" onClick={() => { setKlaar(false); ga(lijst.findIndex((m) => !afgewerkt.has(m.id))) }} className="btn-secondary text-sm">Overgeslagen items bekijken</button>}
              <div><button type="button" onClick={onSluit} className="btn-primary text-sm">Terug naar de lijst</button></div>
            </div>
          )}
          {!klaar && huidig && (
            <div className={`rounded-2xl border p-4 sm:p-6 space-y-4 transition-colors ${isKlaar ? 'bg-[#166534] border-[#166534]' : 'bg-white border-gray-200'}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className={isKlaar ? 'text-white' : ''}>
                  <div className={`text-xs ${isKlaar ? 'text-green-100' : 'text-gray-500'}`}>Item {index + 1} van {lijst.length} · gepland {datumNl(huidig.datum)}</div>
                  <h3 className="text-lg font-semibold">{huidig.klant}</h3>
                  <div className={`text-sm ${isKlaar ? 'text-green-50' : 'text-gray-600'}`}>{huidig.project ?? huidig.dienst ?? huidig.type} · {euro2(huidig.bedrag_excl)} excl. btw</div>
                </div>
                {isKlaar
                  ? <div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-white text-[#166534] px-3 py-1 text-sm font-semibold"><CheckCircle2 className="h-4 w-4" />Gefactureerd</span><button type="button" disabled={bezig} onClick={() => ongedaan(huidig)} className="btn-secondary text-xs"><RotateCcw className="h-3.5 w-3.5" />Ongedaan maken</button></div>
                  : <StatusBadge status={huidig.status} />}
              </div>

              {fout && !data && <div className="text-sm text-red-700">{fout}</div>}
              {!data && !fout && <div className="py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>}
              {data && (
                <div className={isKlaar ? 'bg-white rounded-xl p-3' : ''}>
                  <div className="mb-3"><KopieerKnop tekst={factuurTekst(data)} label="Kopieer factuurgegevens" melding="Factuurgegevens gekopieerd (zonder interne notities)." /></div>
                  <ItemInhoud data={data} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Acties onderaan */}
      {!klaar && huidig && (
        <div className="bg-white border-t border-gray-200 px-4 sm:px-6 py-3">
          <div className="max-w-3xl mx-auto space-y-2">
            {data && data.ontbrekend.length > 0 && !isKlaar && (
              <label className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                <input type="checkbox" className="mt-1" checked={bevestigd.has(huidig.id)} onChange={(e) => setBevestigd((s) => { const n = new Set(s); if (e.target.checked) n.add(huidig.id); else n.delete(huidig.id); return n })} />
                <span><b className="inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Gegevens ontbreken.</b> Ik heb de factuur toch volledig opgemaakt en wil dit item afwerken.</span>
              </label>
            )}
            <div className="flex items-end gap-2 flex-wrap">
              {!isKlaar && (
                <div className="w-full sm:w-48"><label className="block text-[11px] text-gray-500 mb-1">Extern factuurnummer (optioneel)</label><input className={INP} value={extern[huidig.id] ?? ''} onChange={(e) => setExtern((x) => ({ ...x, [huidig.id]: e.target.value }))} placeholder="bv. 2026-81" /></div>
              )}
              <button type="button" onClick={() => ga(Math.max(0, index - 1))} disabled={index === 0} className="btn-secondary text-sm"><ChevronLeft className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Vorige</span></button>
              <div className="flex-1" />
              {!isKlaar && <button type="button" onClick={sla} disabled={bezig} className="btn-secondary text-sm"><SkipForward className="h-4 w-4" />Overslaan</button>}
              <button type="button" onClick={() => ga(index + 1 < lijst.length ? index + 1 : -1)} className="btn-secondary text-sm">Volgende<ChevronRight className="h-4 w-4" /></button>
              {!isKlaar && (
                <button type="button" onClick={markeer} disabled={bezig || !data || (data.ontbrekend.length > 0 && !bevestigd.has(huidig.id))}
                  className="btn-primary text-sm bg-[#166534] hover:bg-[#14532d] text-white border-[#166534]">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Markeren als gefactureerd</button>
              )}
            </div>
            <p className="text-[11px] text-gray-500">Kopiëren verandert niets aan de status. Enkel “Markeren als gefactureerd” werkt het item af.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function Leeg({ tekst, onSluit }: { tekst: string; onSluit: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center space-y-3">
      <CheckCircle2 className="h-8 w-8 mx-auto text-[#166534]" />
      <p className="text-sm text-gray-700">{tekst}</p>
      <button type="button" onClick={onSluit} className="btn-primary text-sm">Terug naar de lijst</button>
    </div>
  )
}
