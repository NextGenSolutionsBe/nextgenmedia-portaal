'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X, Plus, Pencil, Ban, Undo2, CheckCircle2, AlertTriangle, ExternalLink, Info, Wallet } from 'lucide-react'
import { formatEuro, formatDate } from '@/lib/utils'
import {
  CLASSIFICATIE_LABEL, KOSTEN_STATUS_LABEL, KOSTEN_CATEGORIEEN, stelClassificatieVoor,
  type Classificatie, type KostenStatus, type Lijn, type Kost, type FactuurKostenWinst,
} from '@/lib/facturen/kosten-winst'

/**
 * "Kosten en winst" van één factuur (of één maand van een recurring factuur).
 *
 * Compact onderdeel in de Facturen-lijst, in de bestaande stijl. Laat lijnen
 * classificeren en directe kosten toevoegen, wijzigen of annuleren — ook
 * nadat de factuur verstuurd is. Dat raakt de klantfactuur nooit: enkel de
 * interne kostprijs, winst en vestingwaarde bewegen mee.
 */

export type FactuurRefProps = { invoice_id?: string; recurring_id?: string; maand?: string }

export const STATUS_STIJL: Record<KostenStatus, string> = {
  volledig: 'bg-green-100 text-green-800', voorlopig: 'bg-amber-100 text-amber-800', controle_vereist: 'bg-red-100 text-red-700',
  geen_directe_kosten: 'bg-gray-100 text-gray-700', ongecontroleerd: 'bg-gray-100 text-gray-500',
}

type Antwoord = {
  kop: { omzet_excl: number; btw_pct: number; omschrijving: string | null; factuurstatus: string; client_id: string | null; contract_id: string | null; bevestigd: boolean }
  lijnen: Lijn[]; kosten: Kost[]; berekend: FactuurKostenWinst; raaktVesting: boolean
  log: { id: number; actie: string; oud: unknown; nieuw: unknown; effect_winst: number | null; effect_vesting: number | null; reden: string | null; actor_email: string | null; created_at: string }[]
}

const ACTIE_LABEL: Record<string, string> = {
  lijn_toevoegen: 'Lijn toegevoegd', lijn_wijzigen: 'Lijn gewijzigd', lijn_verwijderen: 'Lijn verwijderd',
  kost_toevoegen: 'Kost toegevoegd', kost_wijzigen: 'Kost gewijzigd', kost_annuleren: 'Kost geannuleerd', kost_herstellen: 'Kost hersteld', geen_directe_kosten: 'Bevestiging geen directe kosten',
}
const inp = 'w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg'
const knop = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50'
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toLocaleString('nl-BE', { maximumFractionDigits: 1 })} %`)

// LET OP: de prop heet bewust NIET `ref` — React 18 geeft `ref` niet door aan
// een functiecomponent, waardoor dit venster leeg bleef.
export function KostenEnWinstDialoog({ factuur: ref, titel, clientId, onClose, onChanged }: { factuur: FactuurRefProps; titel: string; clientId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [data, setData] = useState<Antwoord | null>(null)
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState(false)
  const [kostForm, setKostForm] = useState<null | { id?: string; line_id: string; omschrijving: string; categorie: string; leverancier: string; kostprijs_excl: string; datum: string; bewijs_url: string; opmerking: string; reden: string }>(null)
  const [lijnForm, setLijnForm] = useState<null | { id?: string; omschrijving: string; aantal: string; prijs_excl: string; btw_pct: string; classificatie: Classificatie; opmerking: string; kostprijs_excl: string; leverancier: string; voorstel: string }>(null)
  const [toonLog, setToonLog] = useState(false)

  const query = ref.invoice_id ? `invoice_id=${ref.invoice_id}` : `recurring_id=${ref.recurring_id}&maand=${ref.maand}`
  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/invoices/kosten?${query}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setData(j)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [query])
  useEffect(() => { laad() }, [laad])

  const post = async (body: Record<string, unknown>, melding: string) => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/invoices/kosten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...ref, ...body }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      const effect = typeof j.effectWinst === 'number' && j.effectWinst !== 0 ? ` Winst ${j.effectWinst > 0 ? '+' : ''}${formatEuro(j.effectWinst)}${j.raaktVesting ? ' (telt door in Vesting)' : ''}.` : ''
      toast.success(melding + effect)
      await laad(); onChanged?.()
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); return false } finally { setBezig(false) }
  }

  // Classificatie + kostprijs voorstellen zodra de omschrijving van een nieuwe lijn bekend is.
  const stelVoor = async (omschrijving: string) => {
    const lokaal = stelClassificatieVoor(omschrijving)
    setLijnForm((f) => (f ? { ...f, classificatie: lokaal.classificatie, voorstel: lokaal.reden } : f))
    try {
      const r = await fetch(`/api/admin/invoices/kosten?suggestie=1&omschrijving=${encodeURIComponent(omschrijving)}&client_id=${clientId ?? ''}`)
      const j = await r.json()
      const k = j?.kostprijs
      if (k && (k.kostprijs_maand !== null || k.kostprijs_jaar !== null)) {
        const waarde = ref.recurring_id ? k.kostprijs_maand : k.kostprijs_jaar
        setLijnForm((f) => (f && !f.kostprijs_excl ? { ...f, kostprijs_excl: waarde !== null ? String(waarde) : f.kostprijs_excl, voorstel: `${lokaal.reden} Kostprijs voorgesteld uit ${k.bron}.` } : f))
      }
    } catch { /* voorstel is best-effort */ }
  }

  const b = data?.berekend
  const st = b ? KOSTEN_STATUS_LABEL[b.status] : ''
  const lijnNaam = (id: string | null) => (id ? (data?.lijnen.find((l) => l.id === id)?.omschrijving ?? '—') : 'Hele factuur')
  // Actieve kosten met een bekende kostprijs die aan geen enkele lijn hangen.
  const losseKosten = (data?.kosten ?? []).filter((k) => k.status === 'actief' && !k.line_id && k.kostprijs_excl !== null).reduce((sm, k) => sm + Number(k.kostprijs_excl), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-semibold">Kosten en winst</h3>
            <p className="text-xs text-gray-500 truncate">{titel}</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-sm">
          {laden || !data || !b ? <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : (
            <>
              {/* Samenvatting */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <Vak label="Factuurwaarde excl. btw" waarde={formatEuro(b.omzetExcl)} sub={`btw ${formatEuro(b.btw)} · incl. ${formatEuro(b.omzetIncl)}`} />
                <Vak label="Directe kosten" waarde={formatEuro(b.directeKosten)} sub={b.kostenOnbekend > 0 ? `${b.kostenOnbekend} zonder kostprijs` : `${b.aantalKosten} kost${b.aantalKosten === 1 ? '' : 'en'}`} kleur="text-red-600" />
                <Vak label="Werkelijke winst" waarde={formatEuro(b.winst)} kleur={b.winst < 0 ? 'text-red-600' : 'text-green-700'} sub={b.status === 'voorlopig' || b.status === 'ongecontroleerd' ? 'voorlopig' : undefined} />
                <Vak label="Marge" waarde={pct(b.margePct)} />
                <Vak label="Telt voor vesting" waarde={formatEuro(b.vestingWaarde)} sub={data.raaktVesting ? 'gekoppeld aan een vestingcontract' : 'niet aan een vestingcontract gekoppeld'} />
                <Vak label="Telt niet mee" waarde={formatEuro(b.nietMeetellend)} sub="doorgerekende kosten" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`status-badge ${STATUS_STIJL[b.status]}`}>{st}</span>
                {b.status !== 'geen_directe_kosten' && !data.kop.bevestigd && (
                  <button disabled={bezig} onClick={() => { if (confirm('Bevestigen dat deze factuur geen directe (projectgebonden) kosten heeft?')) post({ action: 'geen_directe_kosten', bevestigd: true }, 'Bevestigd: geen directe kosten.') }} className={`${knop} bg-white border-gray-200 text-gray-600 hover:border-green-500`}><CheckCircle2 className="h-3 w-3" />Geen directe kosten</button>
                )}
                {data.kop.bevestigd && <button disabled={bezig} onClick={() => post({ action: 'geen_directe_kosten', bevestigd: false }, 'Bevestiging ingetrokken.')} className={`${knop} bg-white border-gray-200 text-gray-500`}><Undo2 className="h-3 w-3" />Bevestiging intrekken</button>}
                <span className="text-[11px] text-gray-400 ml-auto">Winst = verkoop excl. btw − directe kosten excl. btw. Btw telt nooit mee.</span>
              </div>
              {b.waarschuwingen.length > 0 && (
                <ul className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                  {b.waarschuwingen.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{w}</li>)}
                </ul>
              )}

              {/* Lijnen */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="font-semibold text-xs uppercase tracking-wide text-gray-500">Factuurlijnen (intern)</h4>
                  <button disabled={bezig} onClick={() => setLijnForm({ omschrijving: '', aantal: '1', prijs_excl: '', btw_pct: String(data.kop.btw_pct), classificatie: 'dienst', opmerking: '', kostprijs_excl: '', leverancier: '', voorstel: '' })} className={`${knop} bg-white border-gray-200 text-gray-700 hover:border-gray-400`}><Plus className="h-3 w-3" />Lijn</button>
                </div>
                {data.lijnen.length === 0 ? (
                  <p className="text-xs text-gray-500">Geen lijnen ingevoerd; de factuur telt als één geheel ({formatEuro(b.omzetExcl)}). Voeg lijnen toe om per onderdeel te classificeren.</p>
                ) : (
                  <div className="table-wrap rounded-lg border border-gray-100"><table className="w-full text-xs">
                    <thead><tr className="border-b border-gray-100"><th className="table-th">Omschrijving</th><th className="table-th">Classificatie</th><th className="table-th text-right">Aantal</th><th className="table-th text-right">Verkoop excl.</th><th className="table-th text-right">Kosten</th><th className="table-th text-right">Winst</th><th className="table-th"></th></tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {b.perLijn.map((l) => (
                        <tr key={l.id}>
                          <td className="table-td">{l.omschrijving}{l.opmerking && <div className="text-[10px] text-gray-400">{l.opmerking}</div>}</td>
                          <td className="table-td">{CLASSIFICATIE_LABEL[l.classificatie]}</td>
                          <td className="table-td text-right tabular">{l.aantal}</td>
                          <td className="table-td text-right tabular">{formatEuro(l.verkoop)}</td>
                          <td className="table-td text-right tabular">{formatEuro(l.kosten)}{l.kostenOnbekend && <span className="text-amber-600" title="Kostprijs nog aan te vullen"> ?</span>}</td>
                          <td className={`table-td text-right tabular font-semibold ${l.winst < 0 ? 'text-red-600' : ''}`}>{formatEuro(l.winst)}</td>
                          <td className="table-td"><div className="flex justify-end gap-1">
                            <button onClick={() => setKostForm({ line_id: l.id, omschrijving: l.omschrijving, categorie: stelClassificatieVoor(l.omschrijving).categorie ?? '', leverancier: '', kostprijs_excl: '', datum: '', bewijs_url: '', opmerking: '', reden: '' })} className={`${knop} bg-white border-gray-200 text-gray-600`} title="Kost aan deze lijn koppelen"><Plus className="h-3 w-3" />Kost</button>
                            <button onClick={() => setLijnForm({ id: l.id, omschrijving: l.omschrijving, aantal: String(l.aantal), prijs_excl: String(l.prijs_excl), btw_pct: String(l.btw_pct), classificatie: l.classificatie, opmerking: l.opmerking ?? '', kostprijs_excl: '', leverancier: '', voorstel: '' })} className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400"><Pencil className="h-3 w-3" /></button>
                          </div></td>
                        </tr>
                      ))}
                      {b.lijnenTotaal !== null && (
                        <tr className="bg-gray-50 font-semibold"><td className="table-td" colSpan={3}>Som van de lijnen</td><td className="table-td text-right tabular">{formatEuro(b.lijnenTotaal)}</td><td className="table-td text-right tabular">{formatEuro(b.perLijn.reduce((s, l) => s + l.kosten, 0))}</td><td className="table-td text-right tabular">{formatEuro(b.perLijn.reduce((s, l) => s + l.winst, 0))}</td><td></td></tr>
                      )}
                      {/* Kosten die aan de hele factuur hangen staan bij geen enkele lijn; zonder deze rij lijkt de winst hoger dan ze is. */}
                      {losseKosten > 0 && (
                        <tr className="text-gray-600"><td className="table-td" colSpan={3}>Kosten op de hele factuur <span className="text-[10px] text-gray-400">— niet aan een lijn gekoppeld</span></td><td className="table-td text-right tabular">—</td><td className="table-td text-right tabular">{formatEuro(losseKosten)}</td><td className="table-td text-right tabular">−{formatEuro(losseKosten)}</td><td></td></tr>
                      )}
                      <tr className="bg-gray-100 font-semibold"><td className="table-td" colSpan={3}>Deze factuur</td><td className="table-td text-right tabular">{formatEuro(b.omzetExcl)}</td><td className="table-td text-right tabular">{formatEuro(b.directeKosten)}</td><td className={`table-td text-right tabular ${b.winst < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatEuro(b.winst)}</td><td></td></tr>
                    </tbody>
                  </table></div>
                )}
              </div>

              {/* Kosten */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className="font-semibold text-xs uppercase tracking-wide text-gray-500">Gekoppelde kosten</h4>
                  <button disabled={bezig} onClick={() => setKostForm({ line_id: '', omschrijving: '', categorie: '', leverancier: '', kostprijs_excl: '', datum: new Date().toISOString().slice(0, 10), bewijs_url: '', opmerking: '', reden: '' })} className={`${knop} bg-black text-white border-black hover:bg-gray-800`}><Plus className="h-3 w-3" />Kost toevoegen</button>
                </div>
                {data.kosten.length === 0 ? <p className="text-xs text-gray-500">Nog geen kosten gekoppeld.</p> : (
                  <div className="table-wrap rounded-lg border border-gray-100"><table className="w-full text-xs">
                    <thead><tr className="border-b border-gray-100"><th className="table-th">Omschrijving</th><th className="table-th">Categorie</th><th className="table-th">Leverancier</th><th className="table-th text-right">Kostprijs excl.</th><th className="table-th">Gekoppeld aan</th><th className="table-th">Datum</th><th className="table-th">Status</th><th className="table-th">Bewijs</th><th className="table-th"></th></tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.kosten.map((k) => (
                        <tr key={k.id} className={k.status === 'geannuleerd' ? 'opacity-50' : ''}>
                          <td className="table-td">{k.omschrijving}{k.opmerking && <div className="text-[10px] text-gray-400">{k.opmerking}</div>}</td>
                          <td className="table-td">{k.categorie ?? '—'}</td>
                          <td className="table-td">{k.leverancier ?? '—'}</td>
                          <td className="table-td text-right tabular">{k.kostprijs_excl === null ? <span className="text-amber-700 font-medium">nog aan te vullen</span> : formatEuro(k.kostprijs_excl)}</td>
                          <td className="table-td">{lijnNaam(k.line_id)}</td>
                          <td className="table-td whitespace-nowrap">{k.datum ? formatDate(k.datum) : '—'}</td>
                          <td className="table-td">{k.status === 'geannuleerd' ? 'Geannuleerd' : k.kostprijs_excl === null ? 'Voorlopig' : 'Actief'}</td>
                          <td className="table-td">{k.bewijs_url ? <a href={k.bewijs_url} target="_blank" rel="noreferrer" className="text-blue-700 inline-flex items-center gap-0.5">Open<ExternalLink className="h-3 w-3" /></a> : '—'}</td>
                          <td className="table-td"><div className="flex justify-end gap-1">
                            <button onClick={() => setKostForm({ id: k.id, line_id: k.line_id ?? '', omschrijving: k.omschrijving, categorie: k.categorie ?? '', leverancier: k.leverancier ?? '', kostprijs_excl: k.kostprijs_excl === null ? '' : String(k.kostprijs_excl), datum: k.datum ?? '', bewijs_url: k.bewijs_url ?? '', opmerking: k.opmerking ?? '', reden: '' })} className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400" title="Bewerken"><Pencil className="h-3 w-3" /></button>
                            {k.status === 'actief'
                              ? <button disabled={bezig} onClick={() => { const reden = prompt('Reden voor annulering (optioneel):') ?? ''; post({ action: 'kost_annuleren', cost_id: k.id, reden }, 'Kost geannuleerd.') }} className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-50 text-gray-400 hover:text-red-600" title="Annuleren (blijft in de geschiedenis)"><Ban className="h-3 w-3" /></button>
                              : <button disabled={bezig} onClick={() => post({ action: 'kost_herstellen', cost_id: k.id }, 'Kost hersteld.')} className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400" title="Herstellen"><Undo2 className="h-3 w-3" /></button>}
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </div>

              {/* Geschiedenis */}
              <div>
                <button onClick={() => setToonLog((v) => !v)} className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"><Info className="h-3 w-3" />{toonLog ? 'Geschiedenis verbergen' : `Geschiedenis (${data.log.length})`}</button>
                {toonLog && (
                  <ul className="mt-2 space-y-1 text-[11px] text-gray-600">
                    {data.log.length === 0 && <li>Nog geen wijzigingen.</li>}
                    {data.log.map((r) => (
                      <li key={r.id} className="flex gap-2 flex-wrap">
                        <span className="text-gray-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="font-medium">{ACTIE_LABEL[r.actie] ?? r.actie}</span>
                        <span>{r.actor_email ?? '—'}</span>
                        {r.effect_winst !== null && r.effect_winst !== 0 && <span className={r.effect_winst < 0 ? 'text-red-600' : 'text-green-700'}>winst {r.effect_winst > 0 ? '+' : ''}{formatEuro(r.effect_winst)}{r.effect_vesting !== null ? ' · vesting' : ''}</span>}
                        {r.reden && <span className="text-gray-400">· {r.reden}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        {/* Kostformulier */}
        {kostForm && data && (
          <div className="border-t border-gray-100 p-5 bg-gray-50/70 space-y-2">
            <div className="text-xs font-semibold">{kostForm.id ? 'Kost bewerken' : 'Kost toevoegen'} <span className="font-normal text-gray-500">— wijzigt de klantfactuur niet</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="text-[11px] text-gray-600 col-span-2">Omschrijving *<input className={inp} value={kostForm.omschrijving} onChange={(e) => setKostForm({ ...kostForm, omschrijving: e.target.value, categorie: kostForm.categorie || (stelClassificatieVoor(e.target.value).categorie ?? '') })} /></label>
              <label className="text-[11px] text-gray-600">Categorie<select className={inp} value={kostForm.categorie} onChange={(e) => setKostForm({ ...kostForm, categorie: e.target.value })}><option value="">—</option>{KOSTEN_CATEGORIEEN.map((k) => <option key={k.categorie} value={k.categorie}>{k.categorie}</option>)}<option value="Andere">Andere</option></select></label>
              <label className="text-[11px] text-gray-600">Kostprijs excl. btw<input className={inp} inputMode="decimal" placeholder="leeg = nog aan te vullen" value={kostForm.kostprijs_excl} onChange={(e) => setKostForm({ ...kostForm, kostprijs_excl: e.target.value })} /></label>
              <label className="text-[11px] text-gray-600">Leverancier<input className={inp} value={kostForm.leverancier} onChange={(e) => setKostForm({ ...kostForm, leverancier: e.target.value })} /></label>
              <label className="text-[11px] text-gray-600">Gekoppeld aan<select className={inp} value={kostForm.line_id} onChange={(e) => setKostForm({ ...kostForm, line_id: e.target.value })}><option value="">Hele factuur</option>{data.lijnen.map((l) => <option key={l.id} value={l.id}>{l.omschrijving}</option>)}</select></label>
              <label className="text-[11px] text-gray-600">Datum<input type="date" className={inp} value={kostForm.datum} onChange={(e) => setKostForm({ ...kostForm, datum: e.target.value })} /></label>
              <label className="text-[11px] text-gray-600">Bewijsstuk (link)<input className={inp} placeholder="https://… leveranciersfactuur" value={kostForm.bewijs_url} onChange={(e) => setKostForm({ ...kostForm, bewijs_url: e.target.value })} /></label>
              <label className="text-[11px] text-gray-600 col-span-2">Interne opmerking<input className={inp} value={kostForm.opmerking} onChange={(e) => setKostForm({ ...kostForm, opmerking: e.target.value })} /></label>
              <label className="text-[11px] text-gray-600 col-span-2">Reden (voor de geschiedenis)<input className={inp} value={kostForm.reden} onChange={(e) => setKostForm({ ...kostForm, reden: e.target.value })} placeholder="bv. leveranciersfactuur ontvangen" /></label>
            </div>
            <div className="flex gap-2">
              <button disabled={bezig} onClick={async () => {
                const ok = await post({ action: kostForm.id ? 'kost_wijzigen' : 'kost_toevoegen', cost_id: kostForm.id, line_id: kostForm.line_id || null, omschrijving: kostForm.omschrijving, categorie: kostForm.categorie || null, leverancier: kostForm.leverancier, kostprijs_excl: kostForm.kostprijs_excl === '' ? null : kostForm.kostprijs_excl, datum: kostForm.datum || null, bewijs_url: kostForm.bewijs_url, opmerking: kostForm.opmerking, reden: kostForm.reden }, kostForm.id ? 'Kost bijgewerkt.' : 'Kost toegevoegd.')
                if (ok) setKostForm(null)
              }} className="btn-primary text-xs">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Opslaan</button>
              <button onClick={() => setKostForm(null)} className="btn-secondary text-xs">Annuleer</button>
            </div>
          </div>
        )}

        {/* Lijnformulier */}
        {lijnForm && data && (
          <div className="border-t border-gray-100 p-5 bg-gray-50/70 space-y-2">
            <div className="text-xs font-semibold">{lijnForm.id ? 'Lijn bewerken' : 'Lijn toevoegen'} <span className="font-normal text-gray-500">— intern; de klantfactuur blijft {formatEuro(data.kop.omzet_excl)} excl. btw</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="text-[11px] text-gray-600 col-span-2">Omschrijving *<input className={inp} value={lijnForm.omschrijving} onChange={(e) => setLijnForm({ ...lijnForm, omschrijving: e.target.value })} onBlur={(e) => { if (!lijnForm.id && e.target.value.trim()) stelVoor(e.target.value) }} /></label>
              <label className="text-[11px] text-gray-600">Aantal<input className={inp} inputMode="decimal" value={lijnForm.aantal} onChange={(e) => setLijnForm({ ...lijnForm, aantal: e.target.value })} /></label>
              <label className="text-[11px] text-gray-600">Prijs excl. btw<input className={inp} inputMode="decimal" value={lijnForm.prijs_excl} onChange={(e) => setLijnForm({ ...lijnForm, prijs_excl: e.target.value })} /></label>
              <label className="text-[11px] text-gray-600 col-span-2">Classificatie<select className={inp} value={lijnForm.classificatie} onChange={(e) => setLijnForm({ ...lijnForm, classificatie: e.target.value as Classificatie })}>{(Object.keys(CLASSIFICATIE_LABEL) as Classificatie[]).map((c) => <option key={c} value={c}>{CLASSIFICATIE_LABEL[c]}</option>)}</select></label>
              <label className="text-[11px] text-gray-600">Btw %<input className={inp} inputMode="decimal" value={lijnForm.btw_pct} onChange={(e) => setLijnForm({ ...lijnForm, btw_pct: e.target.value })} /></label>
              {!lijnForm.id && <label className="text-[11px] text-gray-600">Werkelijke kostprijs excl.<input className={inp} inputMode="decimal" placeholder="optioneel" value={lijnForm.kostprijs_excl} onChange={(e) => setLijnForm({ ...lijnForm, kostprijs_excl: e.target.value })} /></label>}
              {!lijnForm.id && <label className="text-[11px] text-gray-600 col-span-2">Leverancier<input className={inp} value={lijnForm.leverancier} onChange={(e) => setLijnForm({ ...lijnForm, leverancier: e.target.value })} /></label>}
              <label className="text-[11px] text-gray-600 col-span-2">Interne opmerking<input className={inp} value={lijnForm.opmerking} onChange={(e) => setLijnForm({ ...lijnForm, opmerking: e.target.value })} /></label>
            </div>
            {lijnForm.voorstel && <p className="text-[11px] text-gray-500">Voorstel: {lijnForm.voorstel}</p>}
            <div className="flex gap-2">
              <button disabled={bezig} onClick={async () => {
                const ok = await post({ action: lijnForm.id ? 'lijn_wijzigen' : 'lijn_toevoegen', line_id: lijnForm.id, omschrijving: lijnForm.omschrijving, aantal: lijnForm.aantal, prijs_excl: lijnForm.prijs_excl, btw_pct: lijnForm.btw_pct, classificatie: lijnForm.classificatie, opmerking: lijnForm.opmerking, kostprijs_excl: lijnForm.kostprijs_excl === '' ? null : lijnForm.kostprijs_excl, leverancier: lijnForm.leverancier }, lijnForm.id ? 'Lijn bijgewerkt.' : 'Lijn toegevoegd.')
                if (ok) setLijnForm(null)
              }} className="btn-primary text-xs">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Opslaan</button>
              {lijnForm.id && <button disabled={bezig} onClick={async () => { if (confirm('Lijn verwijderen? Kosten die eraan hangen moeten eerst losgekoppeld of geannuleerd zijn.')) { const ok = await post({ action: 'lijn_verwijderen', line_id: lijnForm.id }, 'Lijn verwijderd.'); if (ok) setLijnForm(null) } }} className="btn-secondary text-xs text-red-600">Verwijderen</button>}
              <button onClick={() => setLijnForm(null)} className="btn-secondary text-xs">Annuleer</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Vak({ label, waarde, sub, kleur }: { label: string; waarde: string; sub?: string; kleur?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-sm font-bold ${kleur ?? ''}`}>{waarde}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  )
}

/**
 * Compacte, interne samenvatting van kosten en winst — bedoeld voor ín de
 * factuureditor, zodat je zonder een tweede venster ziet wat de factuur ons
 * kost en wat er onderaan overblijft. De klant ziet hier nooit iets van.
 */
export function KostenSamenvatting({ invoiceId, versie, onOpen }: { invoiceId: string; versie?: number; onOpen: () => void }) {
  const [data, setData] = useState<Antwoord | null>(null)
  const [laden, setLaden] = useState(true)

  useEffect(() => {
    let weg = false
    setLaden(true)
    fetch(`/api/admin/invoices/kosten?invoice_id=${invoiceId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!weg && !j?.error) setData(j) })
      .catch(() => { /* stil: de knop blijft werken */ })
      .finally(() => { if (!weg) setLaden(false) })
    return () => { weg = true }
  }, [invoiceId, versie])

  const b = data?.berekend
  const actief = (data?.kosten ?? []).filter((k) => k.status === 'actief')
  const geannuleerd = (data?.kosten ?? []).length - actief.length

  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Interne kosten en winst</div>
          <p className="text-xs text-gray-600 mt-0.5">Wat deze factuur ons kost: onderaanneming, freelancers, materiaal, advertentiebudget, drukwerk… <b>De klant ziet dit nooit</b>; het staat niet op de factuur.</p>
        </div>
        <button type="button" onClick={onOpen} className="btn-secondary text-xs whitespace-nowrap"><Wallet className="h-3.5 w-3.5" />Kosten beheren</button>
      </div>

      {laden || !b ? (
        <div className="py-3 text-center text-gray-300"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Vak label="Verkoop excl. btw" waarde={formatEuro(b.omzetExcl)} sub={`btw ${formatEuro(b.btw)} · incl. ${formatEuro(b.omzetIncl)}`} />
            <Vak label="Directe kosten" waarde={formatEuro(b.directeKosten)} kleur={b.directeKosten > 0 ? 'text-red-600' : undefined} sub={b.kostenOnbekend > 0 ? `${b.kostenOnbekend} zonder kostprijs` : `${b.aantalKosten} kost${b.aantalKosten === 1 ? '' : 'en'}`} />
            <Vak label="Winst" waarde={formatEuro(b.winst)} kleur={b.winst < 0 ? 'text-red-600' : 'text-green-700'} sub={b.status === 'voorlopig' || b.status === 'ongecontroleerd' ? 'voorlopig' : undefined} />
            <Vak label="Marge" waarde={pct(b.margePct)} sub={data?.raaktVesting ? 'telt mee voor vesting' : undefined} />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className={`status-badge ${STATUS_STIJL[b.status]}`}>{KOSTEN_STATUS_LABEL[b.status]}</span>
            <span className="text-[11px] text-gray-400">Winst = verkoop excl. btw − directe kosten excl. btw.</span>
          </div>

          {actief.length === 0 ? (
            <p className="text-xs text-gray-500">Nog geen kosten gelogd{geannuleerd > 0 ? ` (${geannuleerd} geannuleerd)` : ''}. Klik op <b>Kosten beheren</b> om er een toe te voegen.</p>
          ) : (
            <ul className="divide-y divide-gray-50 rounded-lg border border-gray-100 text-xs">
              {actief.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <span className="min-w-0">
                    <span className="font-medium">{k.omschrijving}</span>
                    <span className="text-gray-400"> · {[k.categorie, k.leverancier, k.line_id ? 'aan een lijn' : 'hele factuur', k.datum ? formatDate(k.datum) : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={`tabular whitespace-nowrap ${k.kostprijs_excl === null ? 'text-amber-700' : 'text-red-600'}`}>{k.kostprijs_excl === null ? 'nog aan te vullen' : `− ${formatEuro(k.kostprijs_excl)}`}</span>
                </li>
              ))}
              {geannuleerd > 0 && <li className="px-2.5 py-1.5 text-[11px] text-gray-400">{geannuleerd} geannuleerde kost{geannuleerd === 1 ? '' : 'en'} — tellen niet mee.</li>}
            </ul>
          )}

          {b.waarschuwingen.length > 0 && (
            <ul className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 space-y-1">
              {b.waarschuwingen.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{w}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
