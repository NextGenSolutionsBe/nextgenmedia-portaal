'use client'

import { KaartTabel } from '@/components/ui/kaart-tabel'

import { leesGetal } from '@/lib/getal'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Receipt, Plus, CalendarRange, Link2, Unlink, Pencil, Repeat, AlertTriangle, ChevronDown, Sparkles, ExternalLink, MinusCircle, Wallet, Trash2, Search, History } from 'lucide-react'
import { formatEuro } from '@/lib/utils'
import { DEFAULT_VAT } from '@/lib/invoices'
import { maakReeks, valideerReeks, isDoorlopend, reeksTotaal, type ReeksInvoer } from '@/lib/facturatie/reeks'
import { AFL_STATUS_LABEL, WIJZIGING_LABEL, euro, isActiefItem, type AflItem, type AflStatus, type Aflettering, type ContractWinst, type Wijziging, type WijzigingSoort } from '@/lib/contracten/aflettering'
import { AflBadgeChip } from '@/components/contracten/afl-badge'
import { FactuurEditor, StatusChip } from '@/app/admin/invoices/factuur-editor'
import { KostenEnWinstDialoog } from '@/app/admin/invoices/kosten-en-winst'
import { INP } from '@/app/admin/instellingen/ui'
import { FactuurVoorstellen } from './factuur-voorstellen'

/**
 * Financieel overzicht van één contract — bovenaan het contract.
 *  · Contractwaarde (oorspronkelijk) → effectief uit te voeren (na verminderingen)
 *    → gefactureerd → nog te factureren, plus kosten en winst.
 *  · Alle gekoppelde facturen met nummer, datum, bedrag, kosten en status
 *    (zelfde benamingen als Facturen), met de acties per factuur.
 *  · Verminderingen en crediteringen registreren met reden, datum en notitie;
 *    de oorspronkelijke contractwaarde en de facturen blijven ongewijzigd.
 * Eén bron: dezelfde facturen en kosten als in Facturen (lib/contracten/aflettering).
 * Winst = verkoop excl. btw − directe kosten excl. btw (zoals Kosten en winst per factuur).
 */

type ContractAfl = {
  waarde: number | null; waarde_gewijzigd_op: string | null; waarde_gewijzigd_door: string | null; items: AflItem[]; doorlopend: boolean
  aflettering: Aflettering; wijzigingen: Wijziging[]; winst: ContractWinst
}
type Regel = { id: string; invoice_id: string; artikel: string | null; omschrijving: string | null; bedrag_excl: number; is_extra: boolean; contract_id: string | null }
type Kandidaat = { id: string; invoice_date: string | null; description: string | null; amount_excl: number; status: string; factuurnummer?: string | null }
type Data = {
  contract: { id: string; title: string | null; client_id: string | null; status: string | null; klant_naam: string | null }
  kandidaten: Kandidaat[]
  gekoppeldElders: (Kandidaat & { contract_id: string; contract_titel: string | null })[]
  andereContracten: { id: string; title: string | null }[]
  afl: ContractAfl | null
  regels: Regel[]
}

const d = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—')
const eur = (c: number | null | undefined) => (c === null || c === undefined ? '—' : formatEuro(euro(c)))
// Zelfde kleuren als Facturen: te factureren grijs, gefactureerd donkergroen.
const STATUS_CLS: Record<AflStatus, string> = {
  te_factureren: 'bg-gray-100 text-gray-700 border-gray-200', verstuurd: 'bg-[#166534] text-white border-[#166534]', betaald: 'bg-[#166534] text-white border-[#166534]',
  geannuleerd: 'bg-gray-50 text-gray-500 border-gray-200 line-through', gecrediteerd: 'bg-red-50 text-red-700 border-red-200',
}
const vandaagISO = () => new Date().toISOString().slice(0, 10)

function Tegel({ titel, waarde, sub, toon, actie }: { titel: string; waarde: string; sub?: React.ReactNode; toon?: 'rood' | 'groen' | 'grijs' | 'sterk'; actie?: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 min-w-0 ${toon === 'sterk' ? 'border-black bg-black text-white' : 'border-gray-200 bg-white'}`}>
      <div className={`text-[11px] font-medium flex items-center justify-between gap-1 ${toon === 'sterk' ? 'text-gray-300' : 'text-gray-500'}`}><span className="truncate">{titel}</span>{actie}</div>
      <div className={`text-lg sm:text-xl font-semibold tabular-nums mt-0.5 truncate ${toon === 'rood' ? 'text-red-700' : toon === 'groen' ? 'text-[#166534]' : toon === 'grijs' ? 'text-gray-400' : ''}`}>{waarde}</div>
      {sub && <div className={`text-[11px] mt-0.5 ${toon === 'sterk' ? 'text-gray-300' : 'text-gray-500'}`}>{sub}</div>}
    </div>
  )
}

export function ContractFacturatie({ contractId, clientId, contractTitle, isSigned, nietDoorgegaan = false, expectedCount, expectedAmountExcl }: {
  contractId: string; clientId: string | null; serviceSlug?: string | null; contractTitle: string; isSigned: boolean
  /** Geannuleerd, niet geaccepteerd of vervangen: de facturen worden niet verstuurd. */
  nietDoorgegaan?: boolean
  expectedCount?: number | null; invoiceFrequency?: string | null; expectedAmountExcl?: number | null
}) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [factuurId, setFactuurId] = useState<string | null>(null)
  const [kostenVan, setKostenVan] = useState<AflItem | null>(null)
  const [nieuweFactuur, setNieuweFactuur] = useState(false)
  const [plannen, setPlannen] = useState(false)
  const [koppelen, setKoppelen] = useState(false)
  const [voorstellen, setVoorstellen] = useState(false)
  const [vermindering, setVermindering] = useState<Wijziging | 'nieuw' | null>(null)
  const [toonAfgesloten, setToonAfgesloten] = useState(false)
  const [toonGeschiedenis, setToonGeschiedenis] = useState(false)
  const [waardeBewerken, setWaardeBewerken] = useState(false)
  const [waardeInvoer, setWaardeInvoer] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [verdelen, setVerdelen] = useState<{ id: string; titel: string } | null>(null)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      setData(j); setFout(null)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [contractId])
  useEffect(() => { laad() }, [laad])
  // Terug naar dit tabblad (bv. na een wijziging in Facturen): opnieuw ophalen, nooit verouderde cijfers tonen.
  useEffect(() => {
    const opnieuw = () => { if (document.visibilityState === 'visible') laad() }
    document.addEventListener('visibilitychange', opnieuw)
    window.addEventListener('focus', opnieuw)
    return () => { document.removeEventListener('visibilitychange', opnieuw); window.removeEventListener('focus', opnieuw) }
  }, [laad])

  /** Eén manier om te bewaren: knop geblokkeerd tijdens het bewaren, duidelijke melding, meteen de nieuwe cijfers. */
  const actie = async (body: Record<string, unknown>, sleutel: string, melding?: string | ((j: Record<string, unknown>) => string)): Promise<{ ok: boolean; j?: Record<string, unknown> }> => {
    if (bezig) return { ok: false }
    setBezig(sleutel)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      if (j.afl !== undefined) setData(j)
      toast.success(typeof j.melding === 'string' ? j.melding : (typeof melding === 'function' ? melding(j) : melding) ?? 'Bewaard.')
      router.refresh()
      return { ok: true, j }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); return { ok: false } } finally { setBezig(null) }
  }

  const afl = data?.afl ?? null
  const a = afl?.aflettering ?? null
  const w = afl?.winst ?? null
  const items = useMemo(() => (afl?.items ?? []).filter((i) => toonAfgesloten || isActiefItem(i.status)), [afl, toonAfgesloten])
  const verborgen = (afl?.items.length ?? 0) - (afl?.items.filter((i) => isActiefItem(i.status)).length ?? 0)
  const telling = useMemo(() => {
    const t: Partial<Record<AflStatus, number>> = {}
    for (const i of afl?.items ?? []) t[i.status] = (t[i.status] ?? 0) + 1
    return t
  }, [afl])
  const actieveWijzigingen = (afl?.wijzigingen ?? []).filter((x) => !x.verwijderd_op)
  const verwijderdeWijzigingen = (afl?.wijzigingen ?? []).filter((x) => x.verwijderd_op)
  const regelsVan = (invoiceId: string | null) => (data?.regels ?? []).filter((r) => r.invoice_id === invoiceId)
  const suggestie = expectedCount && expectedAmountExcl ? Math.round(expectedCount * expectedAmountExcl * 100) / 100 : null
  const knop = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50'
  const contractNaam = (cid: string | null) => (cid === contractId || cid === null ? 'Dit contract' : data?.andereContracten.find((x) => x.id === cid)?.title ?? 'Ander contract')
  const factuurLabel = (id: string | null) => { const i = afl?.items.find((x) => x.invoice_id === id); return i ? `${d(i.datum)}${i.referentie ? ` · nr. ${i.referentie}` : ''} · ${eur(i.contractCent + i.extraCent)}` : null }

  const bewaarWaarde = async (v: string | null) => {
    const r = await actie({ action: 'waarde', waarde: v }, 'waarde', v === null ? 'Contractwaarde leeggemaakt.' : 'Contractwaarde bewaard.')
    if (r.ok) setWaardeBewerken(false)
  }
  const startWaarde = () => { setWaardeInvoer(afl?.waarde !== null && afl?.waarde !== undefined ? String(afl.waarde).replace('.', ',') : suggestie !== null ? String(suggestie).replace('.', ',') : ''); setWaardeBewerken(true) }

  return (
    <div id="facturatie" className="card-base space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <h2 className="font-semibold flex items-center gap-1.5"><Receipt className="h-4 w-4 text-gray-400" />Financieel overzicht <span className="text-[11px] font-normal text-gray-500">· excl. btw</span>{laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}</h2>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" onClick={() => setNieuweFactuur(true)} className="btn-primary text-xs"><Plus className="h-3.5 w-3.5" />Factuur toevoegen</button>
          <button type="button" onClick={() => setKoppelen(true)} className="btn-secondary text-xs"><Link2 className="h-3.5 w-3.5" />Koppelen</button>
          <button type="button" onClick={() => setPlannen(true)} className="btn-secondary text-xs"><CalendarRange className="h-3.5 w-3.5" />Meerdere plannen</button>
          <button type="button" onClick={() => setVoorstellen(true)} disabled={!clientId} title={clientId ? undefined : 'Koppel eerst een klant'} className="btn-secondary text-xs"><Sparkles className="h-3.5 w-3.5" />Voorstellen</button>
          <button type="button" onClick={() => setVermindering('nieuw')} disabled={!afl || afl.waarde === null} title={afl?.waarde === null ? 'Vul eerst de contractwaarde in' : undefined} className="btn-secondary text-xs"><MinusCircle className="h-3.5 w-3.5" />Vermindering</button>
        </div>
      </div>

      {/* Facturen van een niet-getekend contract staan nog niet bij "te factureren" in Facturen. */}
      {!isSigned && (
        <div className={`rounded-xl border px-3 py-2 text-sm ${nietDoorgegaan ? 'border-gray-200 bg-gray-50 text-gray-700' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
          {nietDoorgegaan
            ? 'Dit contract ging niet door. De facturen hieronder worden niet verstuurd en tellen nergens mee.'
            : 'Nog niet getekend: de facturen hieronder staan nog niet bij Te factureren. Ze verschijnen daar zodra het contract getekend is.'}
        </div>
      )}

      {fout && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-center gap-2 flex-wrap">Het overzicht kon niet geladen worden: {fout}<button type="button" onClick={() => { setLaden(true); laad() }} className="btn-secondary text-xs ml-auto">Opnieuw proberen</button></div>}
      {!data && !fout && <div className="h-24 rounded-xl bg-gray-50 animate-pulse" />}

      {/* Contractwaarde invullen of aanpassen */}
      {afl && waardeBewerken && (
        <form onSubmit={(e) => { e.preventDefault(); const v = waardeInvoer.trim(); if (v && leesGetal(v) === null) { toast.error('Geef een geldig bedrag, bv. 5874 of 5.874,00.'); return } bewaarWaarde(v ? String(leesGetal(v)) : null) }} className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex items-end gap-2 flex-wrap">
          <div className="min-w-[180px] flex-1 max-w-xs">
            <label className="block text-xs font-medium text-gray-700 mb-1">Oorspronkelijke contractwaarde excl. btw</label>
            <input autoFocus className={INP} inputMode="decimal" value={waardeInvoer} onChange={(e) => setWaardeInvoer(e.target.value)} placeholder="bv. 5874" aria-label="Contractwaarde excl. btw" />
            <p className="text-[11px] text-gray-500 mt-1">Leeg = ontbreekt · € 0 = bewust geen waarde.{suggestie !== null && afl.waarde === null && <> Volgens de contractgegevens: {expectedCount} × {formatEuro(expectedAmountExcl ?? 0)}.</>}</p>
          </div>
          <button type="submit" disabled={bezig === 'waarde'} className="btn-primary text-sm">{bezig === 'waarde' && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
          <button type="button" onClick={() => setWaardeBewerken(false)} className="btn-secondary text-sm">Annuleren</button>
        </form>
      )}

      {/* De cijfers in één oogopslag */}
      {afl && a && w && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <Tegel titel="Contractwaarde" waarde={a.waardeCent === null ? 'Ontbreekt' : eur(a.waardeCent)} toon={a.waardeCent === null ? 'grijs' : undefined}
              actie={!waardeBewerken && <button type="button" onClick={startWaarde} className="text-gray-500 hover:text-black underline">{a.waardeCent === null ? 'invullen' : 'aanpassen'}</button>}
              sub={a.waardeCent === null ? <span className="text-amber-700">Nodig om af te letteren</span> : afl.waarde_gewijzigd_door ? `oorspronkelijk · ${afl.waarde_gewijzigd_door}` : 'oorspronkelijk'} />
            <Tegel titel="Effectief uit te voeren" waarde={a.effectiefCent === null ? '—' : eur(a.effectiefCent)} toon={a.effectiefCent === null ? 'grijs' : undefined}
              sub={a.verminderingCent ? <span className="text-amber-700">− {eur(a.verminderingCent)} verminderd</span> : 'geen verminderingen'} />
            <Tegel titel="Gefactureerd" waarde={eur(a.gefactureerdCent)} toon="groen" sub={`ingepland: ${eur(a.ingeplandCent)}`} />
            <Tegel titel="Nog te factureren" waarde={a.nogTeFacturerenCent === null ? '—' : eur(a.nogTeFacturerenCent)} toon={a.nogTeFacturerenCent !== null && a.nogTeFacturerenCent < 0 ? 'rood' : 'sterk'}
              sub={a.nogTeFacturerenCent !== null && a.nogTeFacturerenCent < 0 ? 'meer gefactureerd dan effectief' : a.nogInTePlannenCent ? `nog in te plannen: ${eur(a.nogInTePlannenCent)}` : a.overschotIngeplandCent ? `${eur(a.overschotIngeplandCent)} te veel ingepland` : a.effectiefCent !== null ? 'alles ingepland' : undefined} />
            <Tegel titel="Kosten" waarde={eur(w.kostenCent)} toon={w.aantalKosten === 0 ? 'grijs' : undefined}
              sub={w.aantalKosten === 0 ? 'geen kosten gekoppeld' : w.zonderPrijs ? <span className="text-amber-700">{w.aantalKosten} kosten · {w.zonderPrijs} zonder kostprijs</span> : `${w.aantalKosten} kost${w.aantalKosten === 1 ? '' : 'en'}`} />
            <Tegel titel={w.zonderPrijs ? 'Winst (voorlopig)' : 'Winst'} waarde={eur(w.winstCent)} toon={w.winstCent < 0 ? 'rood' : 'groen'}
              sub={`op gefactureerd: ${eur(w.winstGefactureerdCent)}`} />
          </div>
          <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>Winst = facturen {eur(w.omzetCent)}{a.extraCent ? ` (waarvan extra kosten ${eur(a.extraCent)})` : ''} − kosten {eur(w.kostenCent)}</span>
            {a.gecrediteerdCent !== 0 && <span>Gecrediteerde facturen: {eur(a.gecrediteerdCent)} (tellen niet)</span>}
            <span className="flex items-center gap-1 flex-wrap ml-auto">{a.badges.map((b) => <AflBadgeChip key={b} badge={b} />)}</span>
          </div>
          {a.teControleren > 0 && <p className="text-xs text-red-800 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{a.teControleren} factu{a.teControleren === 1 ? 'ur zonder' : 'ren zonder'} verdeling tussen contractbedrag en extra kosten — open “Verdeling” bij de factuur.</p>}
          {afl.doorlopend && <p className="text-[11px] text-purple-800 flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5" />Maandelijkse facturatie zonder einde: de maanden tot en met deze maand tellen mee.</p>}
        </>
      )}

      {/* Verminderingen en crediteringen */}
      {afl && (actieveWijzigingen.length > 0 || verwijderdeWijzigingen.length > 0) && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><MinusCircle className="h-4 w-4 text-amber-700" />Verminderingen &amp; crediteringen <span className="font-normal text-gray-600">· {eur(a?.verminderingCent ?? 0)}</span></h3>
            {verwijderdeWijzigingen.length > 0 && <button type="button" onClick={() => setToonGeschiedenis((x) => !x)} className="text-[11px] text-gray-600 underline inline-flex items-center gap-1"><History className="h-3 w-3" />{toonGeschiedenis ? 'Geschiedenis verbergen' : `Geschiedenis (${verwijderdeWijzigingen.length} verwijderd)`}</button>}
          </div>
          <ul className="divide-y divide-amber-100 rounded-lg border border-amber-100 bg-white">
            {[...actieveWijzigingen, ...(toonGeschiedenis ? verwijderdeWijzigingen : [])].map((x) => (
              <li key={x.id} className={`px-3 py-2 flex items-start gap-2 flex-wrap text-sm ${x.verwijderd_op ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium">{WIJZIGING_LABEL[x.soort as WijzigingSoort] ?? x.soort}{x.onderdeel ? <span className="font-normal"> · {x.onderdeel}</span> : null}</div>
                  <div className="text-[11px] text-gray-500">
                    {x.datum ? d(x.datum) : 'geen datum'}{x.reden ? ` · ${x.reden}` : ''}{x.invoice_id ? ` · factuur ${factuurLabel(x.invoice_id) ?? '(niet meer bij dit contract)'}` : ''}
                  </div>
                  {x.notitie && <div className="text-[11px] text-gray-600 whitespace-pre-line mt-0.5">{x.notitie}</div>}
                  <div className="text-[10px] text-gray-400 mt-0.5">{x.aangemaakt_door ?? 'onbekend'} · {d(x.aangemaakt_op.slice(0, 10))}{x.gewijzigd_op ? ` · aangepast ${d(x.gewijzigd_op.slice(0, 10))}${x.gewijzigd_door ? ` door ${x.gewijzigd_door}` : ''}` : ''}{x.verwijderd_op ? ` · verwijderd ${d(x.verwijderd_op.slice(0, 10))}${x.verwijderd_door ? ` door ${x.verwijderd_door}` : ''}` : ''}</div>
                </div>
                <span className="tabular-nums font-semibold text-amber-800">− {formatEuro(x.bedrag_excl)}</span>
                {!x.verwijderd_op && (
                  <div className="flex gap-1">
                    <button type="button" className={`${knop} bg-white border-gray-200`} disabled={!!bezig} onClick={() => setVermindering(x)} aria-label="Aanpassen"><Pencil className="h-3 w-3" /></button>
                    <button type="button" className={`${knop} bg-white border-gray-200 text-red-600`} disabled={!!bezig} aria-label="Verwijderen" onClick={() => { if (confirm('Deze vermindering verwijderen? Ze blijft zichtbaar in de geschiedenis en telt niet meer mee.')) actie({ action: 'wijziging.verwijder', wijziging_id: x.id }, `w-${x.id}`, 'Vermindering verwijderd.') }}><Trash2 className="h-3 w-3" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Gekoppelde facturen */}
      {afl && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <h3 className="text-sm font-semibold mr-1">Facturen</h3>
            {(['te_factureren', 'verstuurd', 'betaald', 'gecrediteerd', 'geannuleerd'] as AflStatus[]).filter((s) => telling[s]).map((s) => (
              <span key={s} className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[s]}`}>{telling[s]} {AFL_STATUS_LABEL[s].toLowerCase()}</span>
            ))}
            {verborgen > 0 && <label className="flex items-center gap-1.5 cursor-pointer text-gray-500 ml-auto"><input type="checkbox" checked={toonAfgesloten} onChange={(e) => setToonAfgesloten(e.target.checked)} />Toon geannuleerd en gecrediteerd ({verborgen})</label>}
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-gray-400">{afl.items.length === 0 ? 'Nog geen facturen gekoppeld.' : 'Alle gekoppelde facturen zijn geannuleerd of gecrediteerd.'}</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <KaartTabel><table className="w-full text-xs min-w-[760px]">
                <thead>
                  <tr className="text-[10px] text-gray-500 bg-gray-50">
                    <th className="px-2 py-1.5 text-left">Omschrijving</th><th className="px-2 py-1.5 text-left">Datum</th><th className="px-2 py-1.5 text-left">Factuurnr.</th>
                    <th className="px-2 py-1.5 text-right">Bedrag excl.</th><th className="px-2 py-1.5 text-right">Kosten</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5 text-right">Acties</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((i) => {
                    const regels = regelsVan(i.invoice_id)
                    const isOpen = open === i.sleutel
                    const k = w?.perItem[i.sleutel]
                    return (
                      <Fragment key={i.sleutel}>
                        <tr className={isActiefItem(i.status) ? '' : 'opacity-60'}>
                          <td className="px-2 py-2 max-w-[280px]">
                            <div className="truncate font-medium text-gray-900" title={i.omschrijving ?? ''}>{i.bron === 'recurring_maand' && <Repeat className="h-3 w-3 inline mr-1 text-purple-600" />}{i.omschrijving ?? '—'}{i.bron === 'recurring_maand' && i.maand && <span className="text-gray-400 font-normal"> · {i.maand}</span>}</div>
                            <div className="flex gap-1 mt-0.5 flex-wrap">
                              {i.creditnota && <span className="rounded-full border border-red-300 bg-red-50 text-red-800 px-1.5 text-[10px]">Creditnota</span>}
                              {i.verdelingOnbekend && <span className="rounded-full border border-red-300 bg-red-50 text-red-800 px-1.5 text-[10px]">Verdeling controleren</span>}
                              {i.gedeeld && <span className="rounded-full border border-gray-300 bg-gray-50 text-gray-700 px-1.5 text-[10px]">Verdeeld over contracten</span>}
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">{d(i.datum)}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-gray-600">{i.referentie ?? '—'}</td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            <div className={`font-semibold ${i.creditnota ? 'text-red-700' : ''}`}>{eur(i.contractCent + i.extraCent)}</div>
                            {i.extraCent !== 0 && <div className="text-[10px] text-gray-500">waarvan extra {eur(i.extraCent)}</div>}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-600">{k && k.aantal ? <>{eur(k.kostenCent)}{k.zonderPrijs ? <div className="text-[10px] text-amber-700">{k.zonderPrijs} zonder prijs</div> : null}</> : '—'}</td>
                          <td className="px-2 py-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${STATUS_CLS[i.status]}`}>{AFL_STATUS_LABEL[i.status]}</span></td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            {i.invoice_id
                              ? <button type="button" className={`${knop} bg-white border-gray-200`} onClick={() => setFactuurId(i.invoice_id)}><Pencil className="h-3 w-3" />Bekijken</button>
                              : <a href={`/admin/invoices${i.maand ? `?maand=${i.maand}` : ''}`} className={`${knop} bg-white border-gray-200`}><ExternalLink className="h-3 w-3" />Bekijken</a>}
                            <button type="button" className={`${knop} bg-white border-gray-200 ml-1`} onClick={() => setKostenVan(i)} title="Kosten en winst van deze factuur"><Wallet className="h-3 w-3" />Kosten</button>
                            {i.invoice_id && <button type="button" className={`${knop} bg-white border-gray-200 ml-1`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i.sleutel)} title="Binnen contractwaarde / extra kosten"><ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? '' : '-rotate-90'}`} />Verdeling</button>}
                            {i.invoice_id && <button type="button" disabled={!!bezig} className={`${knop} bg-white border-gray-200 text-gray-500 ml-1`} title="Losmaken van dit contract (de factuur blijft bestaan)" aria-label="Losmaken van dit contract" onClick={() => { if (confirm('Deze factuur losmaken van het contract? De factuur blijft bestaan als losse factuur.')) actie({ action: 'ontkoppel', invoice_id: i.invoice_id }, i.sleutel, 'Factuur losgemaakt.') }}><Unlink className="h-3 w-3" /></button>}
                          </td>
                        </tr>
                        {isOpen && i.invoice_id && (
                          <tr className="bg-gray-50/70">
                            <td colSpan={7} className="px-3 py-2.5" data-label="">
                              {regels.length === 0 ? (
                                <VerdelingZonderRegels item={i} bezig={bezig === i.sleutel} onBewaar={(bedrag) => actie({ action: 'verdeling', invoice_id: i.invoice_id, contract_bedrag_excl: bedrag }, i.sleutel, 'Verdeling bewaard.')} />
                              ) : (
                                <div className="space-y-1.5">
                                  {regels.map((r) => (
                                    <div key={r.id} className="flex items-center gap-2 flex-wrap text-xs">
                                      <span className="flex-1 min-w-[160px] truncate">{r.artikel || r.omschrijving || 'Regel'}</span>
                                      <span className="tabular-nums w-24 text-right">{formatEuro(r.bedrag_excl)}</span>
                                      <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden" role="group" aria-label={`Soort van ${r.artikel ?? 'regel'}`}>
                                        {[false, true].map((x) => (
                                          <button key={String(x)} type="button" disabled={!!bezig} aria-pressed={r.is_extra === x} onClick={() => r.is_extra !== x && actie({ action: 'regel', line_id: r.id, is_extra: x }, i.sleutel, x ? 'Gemarkeerd als extra kost.' : 'Gemarkeerd als binnen contractwaarde.')}
                                            className={`px-2 py-1 text-[11px] font-medium border-l first:border-l-0 border-gray-200 ${r.is_extra === x ? 'bg-black text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{x ? 'Extra kosten' : 'Binnen contractwaarde'}</button>
                                        ))}
                                      </div>
                                      {(data?.andereContracten.length ?? 0) > 0 && (
                                        <select className={`${INP} w-auto py-1 text-xs`} value={r.contract_id ?? contractId} disabled={!!bezig} aria-label="Contract van deze regel"
                                          onChange={(e) => actie({ action: 'regel', line_id: r.id, contract_id: e.target.value === contractId ? contractId : e.target.value }, i.sleutel, 'Regel toegewezen.')}>
                                          <option value={contractId}>Dit contract</option>
                                          {data!.andereContracten.map((c) => <option key={c.id} value={c.id}>{c.title ?? 'Contract'}</option>)}
                                        </select>
                                      )}
                                      {r.contract_id && r.contract_id !== contractId && <span className="text-[10px] text-gray-500">telt bij {contractNaam(r.contract_id)}</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table></KaartTabel>
            </div>
          )}
        </div>
      )}

      {factuurId && <FactuurEditor invoiceId={factuurId} onClose={() => setFactuurId(null)} onSaved={() => { laad(); router.refresh() }} />}
      {nieuweFactuur && <FactuurEditor standaard={{ client_id: clientId, contract_id: contractId, description: contractTitle }} onClose={() => setNieuweFactuur(false)} onSaved={() => { laad(); router.refresh() }} />}
      {kostenVan && (
        <KostenEnWinstDialoog factuur={kostenVan.invoice_id ? { invoice_id: kostenVan.invoice_id } : { recurring_id: kostenVan.recurring_id ?? undefined, maand: kostenVan.maand ?? undefined }}
          titel={`${kostenVan.omschrijving ?? 'Factuur'} · ${d(kostenVan.datum)} · ${eur(kostenVan.contractCent + kostenVan.extraCent)} excl. btw`} clientId={clientId}
          onClose={() => { setKostenVan(null); laad() }} onChanged={() => laad()} />
      )}
      {voorstellen && <FactuurVoorstellen contractId={contractId} waarde={afl?.waarde ?? null} onSluit={() => setVoorstellen(false)} onBevestigd={() => { laad(); router.refresh() }} />}
      {vermindering && afl && (
        <VerminderingDialoog bestaand={vermindering === 'nieuw' ? null : vermindering} facturen={afl.items.filter((i) => i.invoice_id)} bezig={bezig === 'vermindering'}
          onSluit={() => setVermindering(null)}
          onBewaar={async (v) => {
            const r = await actie({ action: vermindering === 'nieuw' ? 'wijziging.maak' : 'wijziging.wijzig', ...(vermindering !== 'nieuw' ? { wijziging_id: vermindering.id } : {}), ...v }, 'vermindering', vermindering === 'nieuw' ? 'Vermindering geregistreerd.' : 'Vermindering aangepast.')
            if (r.ok) setVermindering(null)
          }} />
      )}
      {plannen && <ReeksDialoog contractTitle={contractTitle} bezig={bezig === 'reeks'} onSluit={() => setPlannen(false)} onBevestig={async (inv, extra) => { const r = await actie({ action: 'reeks', ...inv, ...extra }, 'reeks', (j) => { const n = Number(j.aangemaakt ?? 0); return j.recurring_id ? 'Maandelijkse facturatie ingesteld.' : `${n} factu${n === 1 ? 'ur' : 'ren'} toegevoegd${j.overgeslagen ? ` (${j.overgeslagen} bestond al)` : ''}.` }); if (r.ok) setPlannen(false) }} />}
      {koppelen && data && <KoppelDialoog data={data} bezig={!!bezig} onKoppel={(id, verhangen) => actie({ action: 'koppel', invoice_id: id, ...(verhangen ? { verhangen: true } : {}) }, id, verhangen ? 'Factuur verhangen naar dit contract.' : 'Factuur gekoppeld.')} onVerdelen={(id, titel) => setVerdelen({ id, titel })} onSluit={() => setKoppelen(false)} />}
      {verdelen && <RegelsVerdelen contractId={contractId} factuur={verdelen} andere={data?.andereContracten ?? []} onSluit={() => { setVerdelen(null); laad(); router.refresh() }} />}
    </div>
  )
}

/** Bestaande factuur koppelen: zoeken op omschrijving, nummer of bedrag; elke factuur met nummer, datum, bedrag en status. */
function KoppelDialoog({ data, bezig, onKoppel, onVerdelen, onSluit }: { data: Data; bezig: boolean; onKoppel: (id: string, verhangen?: boolean) => void; onVerdelen: (id: string, titel: string) => void; onSluit: () => void }) {
  const [zoek, setZoek] = useState('')
  const q = zoek.trim().toLowerCase()
  const past = (k: Kandidaat) => !q || `${k.description ?? ''} ${k.factuurnummer ?? ''} ${k.amount_excl} ${d(k.invoice_date)}`.toLowerCase().includes(q)
  const los = data.kandidaten.filter(past)
  const elders = data.gekoppeldElders.filter(past)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 space-y-2">
          <h3 className="font-semibold">Bestaande factuur koppelen · {data.contract.klant_naam ?? 'deze klant'}</h3>
          <div className="relative"><Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" /><input autoFocus className={`${INP} pl-8`} placeholder="Zoek op omschrijving, nummer of bedrag" value={zoek} onChange={(e) => setZoek(e.target.value)} /></div>
        </div>
        <div className="flex-1 overflow-y-auto text-sm">
          <div className="px-5 pt-3 text-[11px] font-semibold text-gray-500">Losse facturen</div>
          <ul className="divide-y divide-gray-100">
            {los.map((k) => (
              <li key={k.id} className="px-5 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0"><div className="truncate">{k.description ?? 'Factuur'}</div><div className="text-[11px] text-gray-500">{d(k.invoice_date)}{k.factuurnummer ? ` · nr. ${k.factuurnummer}` : ''} · {formatEuro(k.amount_excl)} excl.</div></div>
                <StatusChip status={k.status} klein />
                <button type="button" disabled={bezig} onClick={() => onKoppel(k.id)} className="btn-primary text-xs"><Link2 className="h-3.5 w-3.5" />Koppelen</button>
              </li>
            ))}
            {los.length === 0 && <li className="px-5 py-3 text-gray-400 text-xs">{q ? 'Geen losse factuur gevonden.' : 'Geen losse facturen.'}</li>}
          </ul>
          {elders.length > 0 && (
            <>
              <div className="px-5 pt-3 text-[11px] font-semibold text-gray-500">Al aan een ander contract</div>
              <ul className="divide-y divide-gray-100">
                {elders.map((k) => (
                  <li key={k.id} className="px-5 py-2 flex items-center gap-2 flex-wrap">
                    <div className="flex-1 min-w-[160px]"><div className="truncate">{k.description ?? 'Factuur'}</div><div className="text-[11px] text-gray-500">{d(k.invoice_date)} · {formatEuro(k.amount_excl)} · nu bij “{k.contract_titel ?? 'ander contract'}”</div></div>
                    <button type="button" disabled={bezig} onClick={() => onVerdelen(k.id, k.description ?? 'Factuur')} className="btn-secondary text-xs">Regels verdelen</button>
                    <button type="button" disabled={bezig} onClick={() => { if (confirm(`De volledige factuur verhangen van “${k.contract_titel ?? 'ander contract'}” naar dit contract?`)) onKoppel(k.id, true) }} className="btn-secondary text-xs">Volledig verhangen</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end"><button type="button" onClick={onSluit} className="btn-secondary text-sm">Sluiten</button></div>
      </div>
    </div>
  )
}

/** Vermindering of creditering registreren of aanpassen. Wijzigt geen facturen. */
function VerminderingDialoog({ bestaand, facturen, bezig, onSluit, onBewaar }: { bestaand: Wijziging | null; facturen: AflItem[]; bezig: boolean; onSluit: () => void; onBewaar: (v: Record<string, unknown>) => void }) {
  const [soort, setSoort] = useState<WijzigingSoort>((bestaand?.soort as WijzigingSoort) ?? 'geannuleerd')
  const [onderdeel, setOnderdeel] = useState(bestaand?.onderdeel ?? '')
  const [bedrag, setBedrag] = useState(bestaand ? String(bestaand.bedrag_excl).replace('.', ',') : '')
  const [datum, setDatum] = useState(bestaand?.datum ?? vandaagISO())
  const [reden, setReden] = useState(bestaand?.reden ?? '')
  const [notitie, setNotitie] = useState(bestaand?.notitie ?? '')
  const [factuur, setFactuur] = useState(bestaand?.invoice_id ?? '')
  const n = leesGetal(bedrag)
  const ok = n !== null && n > 0
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true">
      <form onSubmit={(e) => { e.preventDefault(); if (ok && !bezig) onBewaar({ soort, onderdeel, bedrag_excl: n, datum: datum || null, reden, notitie, invoice_id: factuur || null }) }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="font-semibold">{bestaand ? 'Vermindering aanpassen' : 'Vermindering registreren'}</h3></div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {(Object.keys(WIJZIGING_LABEL) as WijzigingSoort[]).map((s) => (
              <button key={s} type="button" onClick={() => setSoort(s)} aria-pressed={soort === s}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${soort === s ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400'}`}>{WIJZIGING_LABEL[s]}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">Onderdeel</label><input className={INP} value={onderdeel} onChange={(e) => setOnderdeel(e.target.value)} placeholder="bv. Shoot maart" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Bedrag excl. btw</label><input className={INP} inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="bv. 750" autoFocus /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Datum</label><input type="date" className={INP} value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
            <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">Reden</label><input className={INP} value={reden} onChange={(e) => setReden(e.target.value)} placeholder="bv. klant heeft de shoot geannuleerd" /></div>
            <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">{soort === 'gecrediteerd' ? 'Creditnota of gecrediteerde factuur' : 'Betrokken factuur'} <span className="text-gray-400">(optioneel)</span></label>
              <select className={INP} value={factuur} onChange={(e) => setFactuur(e.target.value)}>
                <option value="">— Geen —</option>
                {facturen.map((f) => <option key={f.sleutel} value={f.invoice_id!}>{d(f.datum)}{f.referentie ? ` · nr. ${f.referentie}` : ''} · {f.omschrijving ?? 'Factuur'} · {eur(f.contractCent + f.extraCent)}{f.creditnota ? ' (creditnota)' : ''}</option>)}
              </select>
            </div>
            <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">Notitie</label><textarea rows={2} className={INP} value={notitie} onChange={(e) => setNotitie(e.target.value)} /></div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/60">
          <button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button>
          <button type="submit" disabled={!ok || bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{bestaand ? 'Bewaren' : 'Registreren'}</button>
        </div>
      </form>
    </div>
  )
}

/** Oude factuur zonder regels: expliciet vastleggen welk deel binnen de contractwaarde valt. */
function VerdelingZonderRegels({ item, bezig, onBewaar }: { item: AflItem; bezig: boolean; onBewaar: (bedrag: number) => void }) {
  const totaal = euro(item.contractCent + item.extraCent)
  const [binnen, setBinnen] = useState(String(euro(item.contractCent)).replace('.', ','))
  const n = leesGetal(binnen)
  return (
    <div className="flex items-end gap-2 flex-wrap text-xs">
      <div className="text-gray-600 basis-full">Deze factuur heeft geen regels. Hoeveel van de {formatEuro(totaal)} valt binnen de contractwaarde? De rest telt als extra kosten / meerwerk.</div>
      <div><label className="block text-[11px] text-gray-600 mb-0.5">Binnen contractwaarde (excl.)</label><input className={`${INP} w-36 py-1`} inputMode="decimal" value={binnen} onChange={(e) => setBinnen(e.target.value)} /></div>
      <span className="pb-1.5 text-gray-600">Extra: {n === null ? '—' : formatEuro(Math.max(0, Math.round((totaal - n) * 100) / 100))}</span>
      <button type="button" disabled={bezig || n === null || n < 0 || n > totaal + 0.001} onClick={() => onBewaar(n!)} className="btn-primary text-xs">{bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Verdeling bevestigen</button>
      <button type="button" disabled={bezig} onClick={() => onBewaar(totaal)} className="btn-secondary text-xs">Alles binnen contractwaarde</button>
    </div>
  )
}

/** Een factuur die al aan een ander contract hangt per regel verdelen. */
function RegelsVerdelen({ contractId, factuur, andere, onSluit }: { contractId: string; factuur: { id: string; titel: string }; andere: { id: string; title: string | null }[]; onSluit: () => void }) {
  const [regels, setRegels] = useState<(Omit<Regel, 'invoice_id'>)[] | null>(null)
  const [factuurContract, setFactuurContract] = useState<string | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json(); if (!r.ok) throw new Error(j.error); return j
  }
  const laad = useCallback(async () => {
    try { const j = await post({ action: 'regels_van', invoice_id: factuur.id }); setRegels(j.regels); setFactuurContract(j.factuur_contract_id) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [factuur.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { laad() }, [laad])
  const opties = [{ id: contractId, title: 'Dit contract' }, ...andere]
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="font-semibold">Regels verdelen · {factuur.titel}</h3><p className="text-xs text-gray-500 mt-0.5">Kies per regel bij welk contract ze hoort. Elk bedrag telt bij precies één contract.</p></div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2 text-sm">
          {!regels && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {regels?.length === 0 && <p className="text-xs text-gray-600">Deze factuur heeft nog geen regels. Open ze in Facturen en splits het bedrag in regels; daarna kun je ze hier verdelen.</p>}
          {regels?.map((r) => (
            <div key={r.id} className="flex items-center gap-2 flex-wrap">
              <span className="flex-1 min-w-[140px] truncate">{r.artikel || r.omschrijving || 'Regel'}</span>
              <span className="tabular-nums text-xs">{formatEuro(r.bedrag_excl)}</span>
              <select className={`${INP} w-auto py-1 text-xs`} disabled={bezig === r.id} value={r.contract_id ?? factuurContract ?? ''} aria-label="Contract van deze regel"
                onChange={async (e) => { setBezig(r.id); try { await post({ action: 'regel', line_id: r.id, contract_id: e.target.value }); await laad(); toast.success('Regel toegewezen.') } catch (er) { toast.error(er instanceof Error ? er.message : 'Mislukt') } finally { setBezig(null) } }}>
                {opties.map((o) => <option key={o.id} value={o.id}>{o.title ?? 'Contract'}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end"><button type="button" onClick={onSluit} className="btn-primary text-sm">Klaar</button></div>
      </div>
    </div>
  )
}

/** Meerdere facturen plannen: alles handmatig ingevuld, met een voorbeeld vóór het aanmaken. */
function ReeksDialoog({ contractTitle, bezig, onSluit, onBevestig }: { contractTitle: string; bezig: boolean; onSluit: () => void; onBevestig: (inv: ReeksInvoer, extra: { verantwoordelijke: string; notitie: string }) => Promise<void> }) {
  const vandaag = new Date().toISOString().slice(0, 10)
  const [type, setType] = useState<ReeksInvoer['type']>('meerdere')
  const [aantal, setAantal] = useState('3')
  const [doorlopend, setDoorlopend] = useState(true)
  const [bedrag, setBedrag] = useState('')
  const [btw, setBtw] = useState(String(DEFAULT_VAT))
  const [start, setStart] = useState(vandaag)
  const [interval, setInterval_] = useState('1')
  const [omschrijving, setOmschrijving] = useState(contractTitle)
  const [termijn, setTermijn] = useState('30')
  const [verantwoordelijke, setVerantwoordelijke] = useState('')
  const [notitie, setNotitie] = useState('')
  const inv: ReeksInvoer = {
    type, aantal: type === 'eenmalig' ? 1 : type === 'maandelijks' && doorlopend ? null : Number(aantal) || 0,
    bedrag_excl: leesGetal(bedrag) ?? 0, btw_pct: leesGetal(btw) ?? 0, start_datum: start, interval_maanden: Number(interval) || 1,
    omschrijving, betalingstermijn_dagen: Number(termijn) || 0,
  }
  const fouten = valideerReeks(inv)
  const voorbeeld = useMemo(() => maakReeks(inv), [inv.type, inv.aantal, inv.bedrag_excl, inv.btw_pct, inv.start_datum, inv.interval_maanden, inv.omschrijving, inv.betalingstermijn_dagen]) // eslint-disable-line react-hooks/exhaustive-deps
  const tot = reeksTotaal(voorbeeld)
  const keuze = (v: ReeksInvoer['type'], label: string, uitleg: string) => (
    <button type="button" onClick={() => setType(v)} className={`rounded-xl border p-2.5 text-left text-sm transition-colors ${type === v ? 'border-gray-900 bg-gray-100 ring-1 ring-gray-900' : 'border-gray-200 hover:border-gray-300'}`}><div className="font-medium">{label}</div><div className="text-[11px] text-gray-500">{uitleg}</div></button>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="font-semibold">Meerdere facturen plannen</h3><p className="text-xs text-gray-500 mt-0.5">Jij bepaalt aantal, bedrag en datums; de app maakt exact die facturen aan met status Te factureren. Elke factuur blijft daarna volledig bewerkbaar.</p></div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {keuze('eenmalig', 'Eén factuur', 'Eén geplande factuur')}
            {keuze('meerdere', 'Meerdere termijnen', 'Bv. 6 × € 979, maandelijks of per kwartaal')}
            {keuze('maandelijks', 'Maandelijks', 'Doorlopend of voor een aantal maanden')}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {type !== 'eenmalig' && (
              <div><label className="block text-xs font-medium text-gray-600 mb-1">{type === 'maandelijks' ? 'Aantal maanden' : 'Aantal facturen'}</label>
                {type === 'maandelijks' && <label className="flex items-center gap-1.5 text-[11px] text-gray-600 mb-1 cursor-pointer"><input type="checkbox" checked={doorlopend} onChange={(e) => setDoorlopend(e.target.checked)} />Doorlopend (geen einde)</label>}
                <input className={INP} inputMode="numeric" value={aantal} disabled={type === 'maandelijks' && doorlopend} onChange={(e) => setAantal(e.target.value)} />
              </div>
            )}
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Bedrag per factuur (excl.)</label><input className={INP} inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="979" autoFocus /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Btw %</label><input className={INP} inputMode="decimal" value={btw} onChange={(e) => setBtw(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">{type === 'eenmalig' ? 'Geplande factuurdatum' : 'Eerste factuurdatum'}</label><input type="date" className={INP} value={start} onChange={(e) => setStart(e.target.value)} /></div>
            {type === 'meerdere' && <div><label className="block text-xs font-medium text-gray-600 mb-1">Interval</label><select className={INP} value={interval} onChange={(e) => setInterval_(e.target.value)}><option value="1">Maandelijks</option><option value="2">Om de 2 maanden</option><option value="3">Per kwartaal</option><option value="6">Per half jaar</option><option value="12">Jaarlijks</option></select></div>}
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Betaaltermijn (dagen)</label><input className={INP} inputMode="numeric" value={termijn} onChange={(e) => setTermijn(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Verantwoordelijke</label><input className={INP} list="ngm-verantwoordelijken-reeks" value={verantwoordelijke} onChange={(e) => setVerantwoordelijke(e.target.value)} placeholder="Bv. Bram Reinquin" /><datalist id="ngm-verantwoordelijken-reeks"><option value="Bram Reinquin" /><option value="Marco Castermans" /></datalist></div>
            <div className="col-span-2 md:col-span-4"><label className="block text-xs font-medium text-gray-600 mb-1">Omschrijving</label><input className={INP} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} placeholder="Bv. Social media beheer" /></div>
            <div className="col-span-2 md:col-span-4"><label className="block text-xs font-medium text-gray-600 mb-1">Interne notitie <span className="text-gray-400">— optioneel, niet voor de klant</span></label><input className={INP} value={notitie} onChange={(e) => setNotitie(e.target.value)} placeholder="Bv. kilometervergoeding nog toevoegen" /></div>
          </div>
          {fouten.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Nog in te vullen: {fouten.join(', ')}.</div>}
          {isDoorlopend(inv) && fouten.length === 0 && <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900">Er komt een <b>maandelijkse facturatie</b> vanaf {start.slice(0, 7)} van {formatEuro(inv.bedrag_excl)} excl. per maand, zonder einddatum. Elke maand verschijnt ze in Facturen en de planner; stopzetten kan daar.</div>}
          {voorbeeld.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-gray-400 mb-1">Voorbeeld — {voorbeeld.length} factu{voorbeeld.length === 1 ? 'ur' : 'ren'} · {formatEuro(tot.excl)} excl. · {formatEuro(tot.incl)} incl.</div>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 text-xs max-h-48 overflow-y-auto">{voorbeeld.map((m) => <li key={m.volgnr} className="px-3 py-1.5 flex justify-between gap-2"><span>{d(m.factuurdatum)} · {m.omschrijving}</span><span className="tabular-nums">{formatEuro(m.bedrag_excl)}</span></li>)}</ul>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/60">
          <button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button>
          <button type="button" disabled={bezig || fouten.length > 0} onClick={() => onBevestig(inv, { verantwoordelijke, notitie })} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{isDoorlopend(inv) ? 'Maandelijkse facturatie aanmaken' : `${voorbeeld.length || ''} factu${voorbeeld.length === 1 ? 'ur' : 'ren'} aanmaken`}</button>
        </div>
      </div>
    </div>
  )
}
