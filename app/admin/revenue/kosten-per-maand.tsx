'use client'

import { KaartTabel } from '@/components/ui/kaart-tabel'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { formatEuro } from '@/lib/utils'

/**
 * Alle kosten per maand, in één tabel: abonnementen, eenmalige kosten,
 * personeel, kosten bij facturen, Kantoor, appointment setters en sociale
 * bijdragen. Klik een maand open voor elke afzonderlijke kost — met een link
 * naar de factuur, het personeelsdossier of de bron waar hij vandaan komt.
 */

export type KostSoort = 'abonnement' | 'eenmalig' | 'personeel' | 'factuur' | 'kantoor' | 'setters' | 'sociaal'
export type KostRegel = { soort: KostSoort; label: string; sub?: string | null; bedrag: number; href?: string | null }
export type MaandRij = { mi: number; label: string; per: Record<KostSoort, number>; totaal: number; regels: KostRegel[] }

export const SOORT_LABEL: Record<KostSoort, string> = {
  abonnement: 'Abonnementen', eenmalig: 'Eenmalig', personeel: 'Personeel', factuur: 'Bij facturen', kantoor: 'Kantoor', setters: 'Setters', sociaal: 'Sociale bijdr.',
}
const SOORT_KLEUR: Record<KostSoort, string> = {
  abonnement: 'bg-red-50 text-red-800', eenmalig: 'bg-orange-50 text-orange-800', personeel: 'bg-violet-50 text-violet-800', factuur: 'bg-blue-50 text-blue-800',
  kantoor: 'bg-gray-100 text-gray-700', setters: 'bg-pink-50 text-pink-800', sociaal: 'bg-gray-100 text-gray-700',
}
const VOLGORDE: KostSoort[] = ['abonnement', 'eenmalig', 'personeel', 'factuur', 'kantoor', 'setters', 'sociaal']

export function KostenPerMaand({ rijen, year, actieveMaand }: { rijen: MaandRij[]; year: number; actieveMaand: number | null }) {
  const [open, setOpen] = useState<number | null>(actieveMaand)
  const kolommen = VOLGORDE.filter((s) => rijen.some((r) => r.per[s] > 0.004))
  const som = (s: KostSoort) => rijen.reduce((t, r) => t + r.per[s], 0)
  const totaal = rijen.reduce((t, r) => t + r.totaal, 0)
  return (
    <div className="card-base p-0 overflow-hidden">
      <div className="px-5 pt-5 pb-3">
        <h2 className="font-semibold">Kosten per maand</h2>
        <div className="text-xs text-gray-400">Boekjaar {year} · excl. btw · klik een maand open voor elke kost apart. Kosten bij facturen tellen in de maand van de factuur.</div>
      </div>
      <div className="overflow-x-auto">
        <KaartTabel><table className="w-full text-sm min-w-[720px]">
          <thead><tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide bg-gray-50">
            <th className="px-4 py-2 font-medium">Maand</th>
            {kolommen.map((s) => <th key={s} className="px-3 py-2 font-medium text-right">{SOORT_LABEL[s]}</th>)}
            <th className="px-4 py-2 font-medium text-right">Totaal</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rijen.map((r) => (
              <Fragment key={r.mi}>
                <tr onClick={() => setOpen(open === r.mi ? null : r.mi)} className={`cursor-pointer hover:bg-gray-50 ${actieveMaand === r.mi ? 'bg-[#fff848]/10' : ''}`}>
                  <td className="px-4 py-2 font-medium capitalize"><ChevronRight className={`h-3.5 w-3.5 inline -mt-0.5 mr-1 text-gray-400 transition-transform ${open === r.mi ? 'rotate-90' : ''}`} />{r.label}</td>
                  {kolommen.map((s) => <td key={s} className="px-3 py-2 text-right tabular-nums text-gray-700">{r.per[s] > 0.004 ? formatEuro(r.per[s]) : <span className="text-gray-300">—</span>}</td>)}
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-red-600">{r.totaal > 0.004 ? formatEuro(r.totaal) : <span className="text-gray-300">—</span>}</td>
                </tr>
                {open === r.mi && (
                  <tr><td colSpan={kolommen.length + 2} className="px-4 py-3 bg-gray-50/70">
                    {r.regels.length === 0 ? <div className="text-xs text-gray-400">Geen kosten in deze maand.</div> : (
                      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
                        {r.regels.map((k, i) => (
                          <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${SOORT_KLEUR[k.soort]}`}>{SOORT_LABEL[k.soort]}</span>
                              <span className="min-w-0">
                                {k.href ? <Link href={k.href} prefetch={false} className="font-medium hover:underline inline-flex items-center gap-1">{k.label}<ExternalLink className="h-3 w-3 text-gray-400" /></Link> : <span className="font-medium">{k.label}</span>}
                                {k.sub && <span className="block text-gray-500 truncate">{k.sub}</span>}
                              </span>
                            </span>
                            <span className="tabular-nums font-medium text-red-600 whitespace-nowrap">{formatEuro(k.bedrag)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <td className="px-4 py-2">Boekjaar</td>
              {kolommen.map((s) => <td key={s} className="px-3 py-2 text-right tabular-nums">{formatEuro(som(s))}</td>)}
              <td className="px-4 py-2 text-right tabular-nums text-red-600">{formatEuro(totaal)}</td>
            </tr>
          </tbody>
        </table></KaartTabel>
      </div>
    </div>
  )
}
