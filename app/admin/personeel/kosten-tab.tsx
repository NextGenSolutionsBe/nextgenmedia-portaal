'use client'

import { KaartTabel } from '@/components/ui/kaart-tabel'

import { Fragment, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, History } from 'lucide-react'
import { api, Chip, euro, uren, datumNl } from '@/components/personeel/ui'
import { KOSTEN_SOORT } from '@/lib/personeel/kostenposten'
import type { PeriodeKost } from '@/lib/personeel/kost'

type Post = { id: string; versie: number; bedrag: number; uren: number; actueel: boolean; verschil: number | null; reden: string | null; created_by: string | null; created_at: string; cost_entry_id: string | null }
type Rij = {
  personeel_id: string; naam: string; type: string; periode: string
  verwacht: PeriodeKost; voorlopig: PeriodeKost; definitief: PeriodeKost
  geboekt: Post | null; versies: Post[]; sessie_ids: string[]; synchroon: boolean; tariefOntbreekt: boolean
}
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
const maand = (p: string) => `${MAANDEN[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`

/**
 * Kostenposten per medewerker en maand: verwacht (planning), voorlopig
 * (ingediend) en definitief (goedgekeurd). Enkel definitief staat in
 * Financiën; elke correctie is een nieuwe versie die je hier terugvindt.
 */
export function KostenTab({ personeelId }: { personeelId?: string }) {
  const jaar = new Date().getFullYear()
  const [van, setVan] = useState(`${jaar}-01-01`)
  const [tot, setTot] = useState(`${jaar}-12-31`)
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)

  const laad = useCallback(async () => {
    try { const j = await api<{ rijen: Rij[] }>(`/api/admin/personeel/kostenposten?van=${van}&tot=${tot}`); setRijen(j.rijen.filter((r) => !personeelId || r.personeel_id === personeelId)); setFout(null) }
    catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt'); setRijen([]) }
  }, [van, tot, personeelId])
  useEffect(() => { laad() }, [laad])

  const herboek = async (r: Rij) => {
    setBezig(`${r.personeel_id}${r.periode}`)
    try { const j = await api<{ actie: string }>('/api/admin/personeel/kostenposten', { body: { personeel_id: r.personeel_id, periode: r.periode } }); toast.success(j.actie === 'geen' ? 'Al correct geboekt.' : 'Geboekt in Financiën.'); await laad() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  if (fout) return <div className="card-base text-sm text-gray-600">{fout}</div>
  const som = (k: 'verwacht' | 'voorlopig' | 'definitief') => (rijen ?? []).reduce((s, r) => s + r[k].totaal, 0)
  return (
    <div className="space-y-3">
      <div className="card-base p-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="text-xs text-gray-500">Van<input type="date" className="block rounded-lg border border-gray-200 px-2 py-1.5" value={van} onChange={(e) => e.target.value && setVan(e.target.value)} /></label>
        <label className="text-xs text-gray-500">Tot<input type="date" className="block rounded-lg border border-gray-200 px-2 py-1.5" value={tot} onChange={(e) => e.target.value && setTot(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2 ml-auto">
          {(['verwacht', 'voorlopig', 'definitief'] as const).map((k) => <div key={k} className={`rounded-lg border px-3 py-1.5 ${KOSTEN_SOORT[k].chip}`}><div className="text-[10px]">{KOSTEN_SOORT[k].label}</div><div className="font-bold tabular-nums">{euro(som(k))}</div></div>)}
        </div>
      </div>
      <p className="text-xs text-gray-500">Verwacht = {KOSTEN_SOORT.verwacht.uitleg.toLowerCase()}. Voorlopig = {KOSTEN_SOORT.voorlopig.uitleg.toLowerCase()}. Definitief = {KOSTEN_SOORT.definitief.uitleg.toLowerCase()} (categorie “Personeel”, één post per medewerker en maand — nooit dubbel).</p>

      {rijen === null ? <div className="py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        : rijen.length === 0 ? <div className="card-base text-center py-10 text-sm text-gray-400">Nog geen uren of planning in deze periode.</div> : (
          <div className="card-base p-0 overflow-x-auto">
            <KaartTabel><table className="w-full text-sm min-w-[860px]">
              <thead><tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide bg-gray-50">
                <th className="px-3 py-2 font-medium">Medewerker</th><th className="px-3 py-2 font-medium">Maand</th>
                <th className="px-3 py-2 font-medium text-right">Verwacht</th><th className="px-3 py-2 font-medium text-right">Voorlopig</th><th className="px-3 py-2 font-medium text-right">Definitief</th>
                <th className="px-3 py-2 font-medium">In Financiën</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rijen.map((r) => {
                  const sl = `${r.personeel_id}${r.periode}`
                  return (
                    <Fragment key={sl}>
                      <tr>
                        <td className="px-3 py-2 font-medium">{personeelId ? r.naam : <Link href={`/admin/personeel/${r.personeel_id}?tab=kosten`} className="hover:underline">{r.naam}</Link>}</td>
                        <td className="px-3 py-2 capitalize">{maand(r.periode)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-blue-700">{euro(r.verwacht.totaal)}<div className="text-[10px] text-gray-400">{uren(r.verwacht.uren)}</div></td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">{euro(r.voorlopig.totaal)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{euro(r.definitief.totaal)}<div className="text-[10px] text-gray-400 font-normal">{uren(r.definitief.uren)}</div></td>
                        <td className="px-3 py-2">
                          {r.geboekt ? <Chip cls={r.synchroon ? 'bg-green-50 text-green-800 border-green-200' : 'bg-amber-50 text-amber-800 border-amber-200'} klein>{r.synchroon ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{euro(Number(r.geboekt.bedrag))} · v{r.geboekt.versie}</Chip>
                            : r.definitief.totaal > 0 ? <Chip cls="bg-amber-50 text-amber-800 border-amber-200" klein>Nog niet geboekt</Chip> : <span className="text-xs text-gray-400">—</span>}
                          {r.tariefOntbreekt && <div className="text-[10px] text-red-600 mt-0.5">Tarief ontbreekt</div>}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {!r.synchroon && <button type="button" disabled={bezig === sl} onClick={() => herboek(r)} className="btn-secondary text-xs h-7 px-2">{bezig === sl ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Boeken</button>}
                          <button type="button" onClick={() => setOpen(open === sl ? null : sl)} className="btn-secondary text-xs h-7 px-2 ml-1" aria-label="Berekening"><ChevronDown className={`h-3 w-3 transition-transform ${open === sl ? 'rotate-180' : ''}`} /></button>
                        </td>
                      </tr>
                      {open === sl && (
                        <tr><td colSpan={7} className="px-3 py-3 bg-gray-50/60">
                          <div className="grid md:grid-cols-2 gap-4 text-xs">
                            <div>
                              <div className="font-semibold mb-1">Berekening definitief ({uren(r.definitief.uren)}, {r.definitief.dagen} dag{r.definitief.dagen === 1 ? '' : 'en'})</div>
                              {r.definitief.regels.length === 0 ? <div className="text-gray-400">Geen goedgekeurde uren.</div> : (
                                <table className="w-full"><tbody>{r.definitief.regels.map((g) => <tr key={g.label}><td className="py-0.5">{g.label}<span className="text-gray-400"> — {g.toelichting}</span></td><td className="py-0.5 text-right tabular-nums">{euro(g.bedrag)}</td></tr>)}
                                  <tr className="border-t border-gray-200 font-semibold"><td className="py-1">Totaal (basis {euro(r.definitief.basis)} + lasten {euro(r.definitief.lasten)})</td><td className="py-1 text-right">{euro(r.definitief.totaal)}</td></tr>
                                  {r.definitief.btw > 0 && <tr className="text-gray-500"><td>Btw (recupereerbaar, niet in de kost)</td><td className="text-right">{euro(r.definitief.btw)}</td></tr>}
                                </tbody></table>
                              )}
                              {r.sessie_ids.length > 0 && <Link href={`/admin/personeel/${r.personeel_id}?tab=uren`} className="inline-block mt-2 text-blue-700 hover:underline">{r.sessie_ids.length} goedgekeurde sessie{r.sessie_ids.length === 1 ? '' : 's'} bekijken →</Link>}
                            </div>
                            <div>
                              <div className="font-semibold mb-1 flex items-center gap-1"><History className="h-3.5 w-3.5" />Boekingsgeschiedenis</div>
                              {r.versies.length === 0 ? <div className="text-gray-400">Nog niets geboekt.</div> : (
                                <ul className="space-y-1">{r.versies.map((p) => (
                                  <li key={p.id} className={p.actueel ? 'font-medium' : 'text-gray-500'}>v{p.versie} · {euro(Number(p.bedrag))} ({uren(Number(p.uren))}){p.verschil !== null ? ` · ${Number(p.verschil) >= 0 ? '+' : ''}${euro(Number(p.verschil))}` : ''} · {datumNl(p.created_at.slice(0, 10))} · {p.created_by ?? '—'}{p.reden ? ` — ${p.reden}` : ''}{p.actueel ? ' (actueel)' : ''}</li>
                                ))}</ul>
                              )}
                            </div>
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table></KaartTabel>
          </div>
        )}
    </div>
  )
}
