'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Car, X, Plus, Trash2, Loader2, MapPin, Building2, RotateCcw, ArrowRight, Check, Minus, Repeat } from 'lucide-react'
import {
  KANTOOR_PLEK, WAARVOOR_VOORSTELLEN, STANDAARD_KM_TARIEF, nieuweRit, ritTotaal, totaalKm, kmRegelVan, kmTitel, kmOmschrijving, isKmRegel,
  zetKmRegel, zonderKmRegel, leesVerplaatsing, controleerVerplaatsing, kortVan, type Plek, type Rit, type Verplaatsing,
} from '@/lib/facturen/kilometers'
import { berekenRegel, berekenTotalen, hernummer, type FactuurRegel } from '@/lib/facturen/regels'
import { GetalInvoer } from '@/components/ui/getal-invoer'
import { zoekVeld } from '@/lib/zoekveld'

/**
 * Kilometervergoeding op een factuur in Te factureren. Ritten met adressen
 * (voorstellen terwijl je typt, Corda Campus en het adres van de klant met één
 * klik), heen en terug, hoeveel keer, en de afstand over de weg die de app
 * vanzelf berekent. Elke afstand, het tarief en de btw zijn aan te passen.
 * Bewaren zet één regel "Kilometervergoeding" op de factuur (of vervangt de
 * bestaande) en onthoudt de ritten, zodat je ze later kan aanpassen.
 */

type KlantInfo = { id?: string; naam?: string; straat: string | null; postcode: string | null; gemeente: string | null; land?: string | null } | null
type ItemData = {
  bron: 'invoice' | 'recurring'; invoice_id?: string | null; recurring_id?: string | null; maand?: string | null; contract_id?: string | null; client_id?: string | null
  km_ritten?: unknown
  detail: {
    klant: KlantInfo; titel: string | null; datum: string; regels: FactuurRegel[]; betaaltermijn: number; klant_referentie: string | null
    prestatie_van: string | null; prestatie_tot: string | null; periode: string | null; mededeling: string | null; notitie: string | null
  }
}

const INP = 'input-base text-sm'
const lbl = 'block text-[11px] font-medium text-gray-500 mb-1'
const eur = (n: number) => `€ ${n.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const km = (n: number) => `${n.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} km`
const sleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

function klantPlek(k: KlantInfo): Plek | null {
  if (!k) return null
  const gemeente = [k.postcode, k.gemeente].filter(Boolean).join(' ')
  const adres = [k.straat, gemeente].filter((x) => x && String(x).trim()).join(', ')
  return adres ? { adres, kort: k.gemeente || null } : null
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j as T
}

export function KilometerVenster({ momentId, titel, onSluit, onKlaar }: { momentId: string; titel?: string | null; onSluit: () => void; onKlaar: (nieuwMomentId?: string) => void }) {
  const [item, setItem] = useState<ItemData | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [v, setV] = useState<Verplaatsing | null>(null)
  const [had, setHad] = useState(false)
  const [modus, setModus] = useState<'vervang' | 'erbij'>('vervang')
  const [bezig, setBezig] = useState(false)
  const [rekent, setRekent] = useState<Record<string, boolean>>({})
  const [ritFout, setRitFout] = useState<Record<string, string>>({})
  const aanmaak = useRef(sleutel())

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onSluit])

  useEffect(() => {
    let weg = false
    ;(async () => {
      try {
        const [d, inst] = await Promise.all([
          json<ItemData>(`/api/admin/invoices/item?id=${encodeURIComponent(momentId)}`),
          json<{ tarief: number; btw: number }>('/api/admin/invoices/kilometers').catch(() => ({ tarief: STANDAARD_KM_TARIEF, btw: 21 })),
        ])
        if (weg) return
        setItem(d)
        const bewaard = leesVerplaatsing(d.km_ritten)
        if (bewaard && bewaard.ritten.length) { setV(bewaard); setHad(true) }
        else setV({ ritten: [nieuweRit({ van: KANTOOR_PLEK, naar: klantPlek(d.detail.klant) ?? { adres: '' } })], tarief: inst.tarief, btw: inst.btw, waarvoor: null })
      } catch (e) { if (!weg) setFout(e instanceof Error ? e.message : 'Laden mislukt') }
    })()
    return () => { weg = true }
  }, [momentId])

  const wisFout = (id: string) => setRitFout((s) => { if (!(id in s)) return s; const n = { ...s }; delete n[id]; return n })
  const zetRit = useCallback((id: string, deel: Partial<Rit>) => setV((x) => (x ? { ...x, ritten: x.ritten.map((r) => (r.id === id ? { ...r, ...deel } : r)) } : x)), [])

  const bereken = useCallback(async (r: Rit) => {
    if (!r.van.adres.trim() || !r.naar.adres.trim()) return
    setRekent((s) => ({ ...s, [r.id]: true })); setRitFout((s) => { const n = { ...s }; delete n[r.id]; return n })
    try {
      const j = await json<{ km: number; van: Plek; naar: Plek }>('/api/admin/invoices/kilometers', { method: 'POST', body: JSON.stringify({ van: r.van, naar: r.naar }) })
      setV((x) => (x ? { ...x, ritten: x.ritten.map((y) => (y.id !== r.id ? y : {
        ...y, km: j.km, berekend: j.km,
        van: y.van.lat == null ? { ...y.van, lat: j.van.lat, lon: j.van.lon, kort: y.van.kort || j.van.kort || null } : y.van,
        naar: y.naar.lat == null ? { ...y.naar, lat: j.naar.lat, lon: j.naar.lon, kort: y.naar.kort || j.naar.kort || null } : y.naar,
      })) } : x))
    } catch (e) { setRitFout((s) => ({ ...s, [r.id]: e instanceof Error ? e.message : 'Berekenen mislukt' })) }
    finally { setRekent((s) => ({ ...s, [r.id]: false })) }
  }, [])

  // Bij het openen: de eerste rit (Corda Campus → adres klant) meteen uitrekenen.
  const eersteKeer = useRef(true)
  useEffect(() => {
    if (!v || !eersteKeer.current) return
    eersteKeer.current = false
    for (const r of v.ritten) if (r.km == null && r.van.adres.trim() && r.naar.adres.trim()) void bereken(r)
  }, [v, bereken])
  // Een plek gekozen (voorstel of snelle keuze): meteen rekenen als de andere kant er ook is.
  const kiesPlek = (r: Rit, kant: 'van' | 'naar', p: Plek, gekozen: boolean) => {
    const nieuw = { ...r, [kant]: p, km: null, berekend: null }
    zetRit(r.id, { [kant]: p, km: null, berekend: null })
    wisFout(r.id)
    if (gekozen && nieuw.van.adres.trim() && nieuw.naar.adres.trim()) void bereken(nieuw)
  }

  const bestaande = useMemo(() => (item?.detail.regels ?? []).find(isKmRegel) ?? null, [item])
  const regel = v ? kmRegelVan(v) : null
  const probleem = v ? controleerVerplaatsing(v) : null
  const nieuweRegels = useMemo(() => (item && regel ? zetKmRegel(item.detail.regels, regel, had ? 'vervang' : modus) : []), [item, regel, had, modus])
  const totaalNa = useMemo(() => berekenTotalen(nieuweRegels), [nieuweRegels])

  const bewaar = async () => {
    if (!item || !v || !regel) return
    if (probleem) { toast.error(probleem); return }
    setBezig(true)
    let nieuwId: string | undefined
    try {
      if (item.bron === 'invoice' && item.invoice_id) {
        await json(`/api/admin/invoices/${item.invoice_id}`, { method: 'PATCH', body: JSON.stringify({ regels: nieuweRegels, km_ritten: v }) })
      } else {
        // Een maand van een terugkerende reeks: eerst een eigen item voor die maand, met de kilometers erbij.
        const d = item.detail
        const clientId = d.klant?.id ?? item.client_id
        if (!clientId || !item.recurring_id || !item.maand) throw new Error('Deze maand kan ik niet openen. Kies "Artikelen voor deze maand aanpassen".')
        const regels = hernummer(nieuweRegels.map((r) => ({ ...r, id: null })))
        const j = await json<{ id: string }>('/api/admin/invoices', { method: 'POST', body: JSON.stringify({
          action: 'aanmaken', aanmaak_sleutel: aanmaak.current, client_id: clientId, contract_id: item.contract_id ?? null, description: d.titel || null,
          invoice_date: d.datum, payment_term_days: d.betaaltermijn, factuur_type: 'terugkerend', klant_referentie: d.klant_referentie || null,
          prestatie_van: d.prestatie_van || null, prestatie_tot: d.prestatie_tot || null, periode: d.prestatie_van ? d.prestatie_van.slice(0, 7) : d.datum.slice(0, 7),
          mededeling: d.mededeling || null, note: d.notitie || null, regels, terugkerende_omzet: true,
          recurring_maand: { recurring_id: item.recurring_id, maand: item.maand },
        }) })
        await json(`/api/admin/invoices/${j.id}`, { method: 'PATCH', body: JSON.stringify({ km_ritten: v }) }).catch(() => null)
        nieuwId = `inv:${j.id}`
      }
      toast.success(`Kilometervergoeding op de factuur: ${km(totaalKm(v.ritten))}, ${eur(berekenRegel(regel).excl)} excl. btw.`)
      onKlaar(nieuwId)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  const weghalen = async () => {
    if (!item?.invoice_id || !confirm('De kilometervergoeding van deze factuur halen?')) return
    setBezig(true)
    try {
      await json(`/api/admin/invoices/${item.invoice_id}`, { method: 'PATCH', body: JSON.stringify({ regels: zonderKmRegel(item.detail.regels), km_ritten: null }) })
      toast.success('Kilometervergoeding weggehaald.')
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Weghalen mislukt') } finally { setBezig(false) }
  }

  const klant = item ? klantPlek(item.detail.klant) : null
  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={(e) => { e.stopPropagation(); onSluit() }}>
      <div role="dialog" aria-modal="true" aria-label="Kilometervergoeding" onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[94dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 flex items-center gap-2"><Car className="h-4 w-4" />Kilometervergoeding</p>
            <p className="text-xs text-gray-500 truncate">{[item?.detail.klant?.naam, titel ?? item?.detail.titel].filter(Boolean).join(' · ') || 'Factuur'}</p>
          </div>
          <button type="button" onClick={onSluit} aria-label="Sluiten" className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        {fout ? <p className="p-5 text-sm text-red-700">{fout}</p> : !item || !v ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : (
          <div className="px-4 sm:px-5 py-4 space-y-4">
            {/* Waarvoor */}
            <div>
              <label className={lbl} htmlFor="km-waarvoor">Waarvoor <span className="font-normal text-gray-400">(komt in de titel, optioneel)</span></label>
              <div className="flex gap-1.5 flex-wrap mb-1.5">
                {WAARVOOR_VOORSTELLEN.map((w) => (
                  <button key={w} type="button" onClick={() => setV({ ...v, waarvoor: v.waarvoor === w ? null : w })}
                    className={`px-2.5 py-1 rounded-full text-xs border ${v.waarvoor === w ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{w}</button>
                ))}
              </div>
              <input id="km-waarvoor" className={INP} value={v.waarvoor ?? ''} maxLength={80} onChange={(e) => setV({ ...v, waarvoor: e.target.value || null })} placeholder="bv. contentshoot 12 november" />
            </div>

            {/* Ritten */}
            <div className="space-y-3">
              {v.ritten.map((r, i) => {
                const vorige = i > 0 ? v.ritten[i - 1].naar : null
                return (
                  <div key={r.id} className="rounded-2xl border border-gray-200 p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-700">{v.ritten.length > 1 ? `Rit ${i + 1}` : 'Rit'}</span>
                      {v.ritten.length > 1 && <button type="button" onClick={() => setV({ ...v, ritten: v.ritten.filter((x) => x.id !== r.id) })} aria-label={`Rit ${i + 1} weghalen`} className="h-7 w-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                    <AdresVeld label="Van" waarde={r.van} onChange={(p, gekozen) => kiesPlek(r, 'van', p, gekozen)}
                      snel={[{ label: 'Corda Campus', plek: KANTOOR_PLEK, icoon: Building2 }, ...(vorige?.adres ? [{ label: `Vorige: ${kortVan(vorige)}`, plek: vorige, icoon: MapPin }] : [])]} />
                    <AdresVeld label="Naar" waarde={r.naar} onChange={(p, gekozen) => kiesPlek(r, 'naar', p, gekozen)}
                      snel={[...(klant ? [{ label: `Adres klant${klant.kort ? ` (${klant.kort})` : ''}`, plek: klant, icoon: MapPin }] : []), { label: 'Corda Campus', plek: KANTOOR_PLEK, icoon: Building2 }]} />
                    <div className="flex items-end gap-2 flex-wrap">
                      <button type="button" onClick={() => zetRit(r.id, { heenEnTerug: !r.heenEnTerug })} aria-pressed={r.heenEnTerug}
                        className={`h-10 px-3 rounded-full border text-sm inline-flex items-center gap-1.5 ${r.heenEnTerug ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-400'}`}>
                        <Repeat className="h-3.5 w-3.5" />Heen en terug
                      </button>
                      <div>
                        <span className={lbl}>Hoeveel keer</span>
                        <div className="h-10 inline-flex items-center rounded-full border border-gray-200">
                          <button type="button" aria-label="Eén keer minder" disabled={r.keer <= 1} onClick={() => zetRit(r.id, { keer: Math.max(1, r.keer - 1) })} className="h-10 w-9 flex items-center justify-center text-gray-600 disabled:opacity-30"><Minus className="h-3.5 w-3.5" /></button>
                          <span className="w-6 text-center text-sm tabular-nums">{r.keer}</span>
                          <button type="button" aria-label="Eén keer meer" disabled={r.keer >= 50} onClick={() => zetRit(r.id, { keer: Math.min(50, r.keer + 1) })} className="h-10 w-9 flex items-center justify-center text-gray-600 disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      <label className="block">
                        <span className={lbl}>Datum <span className="font-normal text-gray-400">(optioneel)</span></span>
                        <input type="date" className={`${INP} h-10 !py-1`} value={r.datum ?? ''} onChange={(e) => zetRit(r.id, { datum: e.target.value || null })} />
                      </label>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2.5 flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-2 text-sm">
                        <span className="text-gray-600">Afstand</span>
                        <GetalInvoer className="input-base text-sm !w-24 h-9 !py-1 text-right tabular-nums" waarde={r.km} min={0} max={5000} leeg={0}
                          onWaarde={(n) => zetRit(r.id, { km: n > 0 ? n : null })} aria-label="Afstand in km, één richting" />
                        <span className="text-gray-600">km{r.heenEnTerug ? ' enkel' : ''}</span>
                      </label>
                      {rekent[r.id] ? <span className="text-xs text-gray-500 inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />Route berekenen…</span>
                        : <button type="button" onClick={() => bereken(r)} disabled={!r.van.adres.trim() || !r.naar.adres.trim()} className="text-xs text-gray-700 underline underline-offset-2 disabled:opacity-40 disabled:no-underline">{r.berekend != null ? 'Opnieuw berekenen' : 'Afstand berekenen'}</button>}
                      {r.berekend != null && r.km != null && r.km !== r.berekend && <span className="text-[11px] text-amber-800">aangepast (route: {km(r.berekend)})</span>}
                      <span className="ml-auto text-sm font-semibold tabular-nums">{km(ritTotaal(r))}</span>
                    </div>
                    {ritFout[r.id] && <p className="text-xs text-red-700">{ritFout[r.id]}</p>}
                  </div>
                )
              })}
              <button type="button" onClick={() => setV({ ...v, ritten: [...v.ritten, nieuweRit({ van: v.ritten[v.ritten.length - 1]?.naar ?? KANTOOR_PLEK, heenEnTerug: false })] })}
                className="btn-secondary text-sm"><Plus className="h-4 w-4" />Nog een rit</button>
              {v.ritten.length > 1 && <p className="text-[11px] text-gray-500">Meerdere stops? Zet "Heen en terug" uit en voeg elke etappe toe, ook de terugrit naar Corda Campus.</p>}
            </div>

            {/* Tarief en btw */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className={lbl}>Tarief per km (excl. btw)</span>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">€</span>
                  <GetalInvoer className={`${INP} pl-7`} waarde={v.tarief} min={0} max={10} onWaarde={(n) => setV({ ...v, tarief: n })} aria-label="Tarief per km" /></div>
              </label>
              <label className="block"><span className={lbl}>Btw</span>
                <div className="relative"><GetalInvoer className={`${INP} pr-7`} waarde={v.btw} min={0} max={100} onWaarde={(n) => setV({ ...v, btw: n })} aria-label="Btw in procent" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span></div>
              </label>
            </div>

            {/* Een kilometerregel die er al stond (van vroeger of met de hand) */}
            {!had && bestaande && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 space-y-1.5">
                <p>Er staat al een kilometerregel op deze factuur: <b>{bestaande.artikel}</b> ({km(bestaande.aantal)}).</p>
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={() => setModus('vervang')} aria-pressed={modus === 'vervang'} className={`px-3 py-1 rounded-full text-xs border ${modus === 'vervang' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200'}`}>Vervangen</button>
                  <button type="button" onClick={() => setModus('erbij')} aria-pressed={modus === 'erbij'} className={`px-3 py-1 rounded-full text-xs border ${modus === 'erbij' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200'}`}>Er een regel bij zetten</button>
                </div>
              </div>
            )}

            {/* Zo komt het op de factuur */}
            {regel && totaalKm(v.ritten) > 0 && (
              <div className="rounded-2xl bg-gray-900 text-white p-4 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">Zo komt het op de factuur</p>
                <p className="font-semibold">{kmTitel(v)}</p>
                <p className="text-sm text-gray-300">{kmOmschrijving(v)}</p>
                <div className="flex items-baseline justify-between gap-3 pt-1 flex-wrap">
                  <span className="text-sm text-gray-300 tabular-nums">{km(totaalKm(v.ritten))} × {eur(v.tarief).replace('€ ', '€ ')}</span>
                  <span className="text-lg font-semibold tabular-nums">{eur(berekenRegel(regel).excl)} <span className="text-xs font-normal text-gray-400">excl. btw · {eur(berekenRegel(regel).incl)} incl.</span></span>
                </div>
                <p className="text-[11px] text-gray-400 inline-flex items-center gap-1">Factuur daarna <ArrowRight className="h-3 w-3" /> {eur(totaalNa.excl)} excl. btw</p>
              </div>
            )}

            {probleem && totaalKm(v.ritten) > 0 && <p className="text-xs text-amber-800">{probleem}</p>}

            <div className="flex items-center gap-2 flex-wrap pt-1">
              <button type="button" onClick={bewaar} disabled={bezig || !!probleem} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{had ? 'Kilometers bijwerken' : 'Op de factuur zetten'}</button>
              <button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button>
              {had && item.invoice_id && <button type="button" onClick={weghalen} disabled={bezig} className="ml-auto text-xs text-red-600 inline-flex items-center gap-1 hover:underline"><RotateCcw className="h-3.5 w-3.5" />Kilometers weghalen</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type Snel = { label: string; plek: Plek; icoon: React.ElementType }

/** Een adres: typen met voorstellen, of één klik op een snelle keuze. */
function AdresVeld({ label, waarde, onChange, snel }: { label: string; waarde: Plek; onChange: (p: Plek, gekozen: boolean) => void; snel: Snel[] }) {
  const [tekst, setTekst] = useState(waarde.adres)
  const [voorstellen, setVoorstellen] = useState<Plek[]>([])
  const [open, setOpen] = useState(false)
  const [laden, setLaden] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vraag = useRef(0)

  useEffect(() => { setTekst(waarde.adres) }, [waarde.adres])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const typ = (t: string) => {
    setTekst(t)
    onChange({ adres: t, kort: null, lat: null, lon: null }, false)
    if (timer.current) clearTimeout(timer.current)
    if (t.trim().length < 3) { setVoorstellen([]); return }
    timer.current = setTimeout(async () => {
      const mijn = ++vraag.current
      setLaden(true)
      try {
        const r = await fetch(`/api/admin/invoices/kilometers?q=${encodeURIComponent(t.trim())}`, { cache: 'no-store' })
        const j = await r.json().catch(() => ({}))
        if (mijn === vraag.current) { setVoorstellen(Array.isArray(j.voorstellen) ? j.voorstellen : []); setOpen(true) }
      } catch { /* typen blijft werken */ } finally { if (mijn === vraag.current) setLaden(false) }
    }, 350)
  }
  const kies = (p: Plek) => { setTekst(p.adres); setOpen(false); setVoorstellen([]); onChange(p, true) }

  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <span className="text-[11px] font-medium text-gray-500">{label}</span>
        <div className="flex gap-1 flex-wrap">
          {snel.map((s) => {
            const Icoon = s.icoon
            return <button key={s.label} type="button" onClick={() => kies(s.plek)} className="px-2 py-0.5 rounded-full text-[11px] border border-gray-200 text-gray-600 hover:border-gray-400 inline-flex items-center gap-1"><Icoon className="h-3 w-3" />{s.label}</button>
          })}
        </div>
      </div>
      <div className="relative">
        <input {...zoekVeld(`km-${label.toLowerCase()}`)} enterKeyHint="done" className={`${INP} pr-8`} value={tekst} placeholder="Straat en nummer, gemeente" aria-label={`${label}: adres`}
          onChange={(e) => typ(e.target.value)} onFocus={() => voorstellen.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2">{laden ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : waarde.lat != null ? <Check className="h-3.5 w-3.5 text-green-600" aria-label="Adres gevonden" /> : null}</span>
      </div>
      {open && voorstellen.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden" role="listbox">
          {voorstellen.map((p) => (
            <li key={`${p.adres}-${p.lat}`}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => kies(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-start gap-2">
                <MapPin className="h-3.5 w-3.5 mt-0.5 text-gray-400 shrink-0" /><span className="min-w-0">{p.adres}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
