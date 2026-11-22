'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  FASES, bronLabel, cijfersVoor, dealWaarde, lopendeMrr, periodeVan, verschuif, type Deal, type PeriodeSoort,
} from '@/lib/ngs/model'
import { FASE_STIJL, Kop, NGS_BLAUW, dagKort, eur } from '../ui'
import { OmzetGrafiek } from './omzet-grafiek'

/**
 * Cijfers van NextGenSolutions, enkel uit de eigen pipeline: omzet,
 * gewonnen en verloren in de gekozen periode, wat er elke maand binnenkomt
 * en wat er open staat. Per bron en waarom deals niet doorgingen.
 */
export function CijfersClient({ deals, vandaag }: { deals: Deal[]; vandaag: string }) {
  const nu = vandaag.slice(0, 7)
  const [soort, setSoort] = useState<PeriodeSoort | 'alles'>('jaar')
  const [periode, setPeriode] = useState(() => periodeVan('jaar', nu))
  const alles = soort === 'alles'
  const c = useMemo(() => cijfersVoor(deals, alles ? null : periode), [deals, alles, periode])
  const mrr = lopendeMrr(deals, vandaag)
  const gewonnen = deals.filter((d) => d.fase === 'won' && d.gewonnen_op && (alles || periode.maanden.includes(d.gewonnen_op.slice(0, 7))))
    .sort((a, b) => (b.gewonnen_op ?? '').localeCompare(a.gewonnen_op ?? ''))
  const kies = (s: PeriodeSoort | 'alles') => { setSoort(s); if (s !== 'alles') setPeriode(periodeVan(s, nu)) }
  const label = alles ? 'altijd' : periode.label
  const isNu = !alles && periode.maanden.includes(nu)
  const maxPipe = Math.max(...c.pipeline.map((p) => p.waarde), 1)

  return (
    <div className="space-y-5 animate-fade-in">
      <Kop actief="cijfers" titel="Cijfers" sub="Omzet en verkoop uit de pipeline van NextGenSolutions, excl. btw." />

      {/* Periode */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-full p-1 bg-gray-100" role="group" aria-label="Periode">
          {(['maand', 'kwartaal', 'jaar', 'alles'] as const).map((s) => (
            <button key={s} type="button" onClick={() => kies(s)} aria-pressed={soort === s} className={`text-xs px-3 py-1.5 rounded-full capitalize ${soort === s ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-600'}`}>{s}</button>
          ))}
        </div>
        {!alles && (
          <div className="inline-flex items-center gap-1">
            <button type="button" onClick={() => setPeriode((p) => verschuif(p, -1))} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-gray-100" aria-label="Vorige periode"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-sm font-semibold capitalize min-w-[7.5rem] text-center">{periode.label}</span>
            <button type="button" onClick={() => setPeriode((p) => verschuif(p, 1))} disabled={isNu} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-gray-100 disabled:opacity-30" aria-label="Volgende periode"><ChevronRight className="h-4 w-4" /></button>
            {!isNu && <button type="button" onClick={() => setPeriode(periodeVan(periode.soort, nu))} className="text-xs text-gray-500 underline ml-1">Nu</button>}
          </div>
        )}
      </div>

      {/* Kerncijfers */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3">
        <Tegel label={`Omzet ${label}`} waarde={eur(c.omzet)} sub="eenmalig + maandbedragen" nadruk />
        <Tegel label="Gewonnen" waarde={eur(c.gewonnen.waarde)} sub={`${c.gewonnen.aantal} ${c.gewonnen.aantal === 1 ? 'deal' : 'deals'}${c.gewonnen.nieuweMrr ? ` · +${eur(c.gewonnen.nieuweMrr)}/m` : ''}`} />
        <Tegel label="Win rate" waarde={c.winrate === null ? '—' : `${Math.round(c.winrate * 100)}%`} sub={`${c.gewonnen.aantal} won · ${c.verloren} lost`} />
        <Tegel label="Gemiddelde deal" waarde={c.gemiddeld === null ? '—' : eur(c.gemiddeld)} sub={c.doorlooptijd === null ? 'doorlooptijd —' : `${c.doorlooptijd} dagen tot getekend`} />
        <Tegel label="Per maand (nu)" waarde={eur(mrr)} sub="lopende maandbedragen" />
        <Tegel label="Open pipeline" waarde={eur(c.pipelineWaarde)} sub={`gewogen ${eur(c.gewogen)}`} />
      </div>

      <OmzetGrafiek deals={deals} vandaag={vandaag} />

      <div className="grid lg:grid-cols-2 gap-3 sm:gap-4 items-start">
        <Kaart titel="Open pipeline nu" sub="Waarde per fase; gewogen met 20%, 40% en 60% kans.">
          <ul className="space-y-2.5">
            {c.pipeline.map((p) => (
              <li key={p.fase} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-gray-800"><span className={`h-2 w-2 rounded-full ${FASE_STIJL[p.fase].stip}`} />{FASES.find((f) => f.key === p.fase)!.label}<span className="text-gray-400">{p.aantal}</span></span>
                  <span className="tabular-nums font-semibold text-gray-900">{eur(p.waarde)}</span>
                </div>
                <Balk deel={p.waarde / maxPipe} />
              </li>
            ))}
          </ul>
        </Kaart>

        <Kaart titel="Per bron" sub={`Afgesloten ${label}.`}>
          {c.perBron.length === 0 ? <Leeg /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 font-medium">Bron</th><th className="py-1 font-medium text-right">Won</th><th className="py-1 font-medium text-right">Lost</th><th className="py-1 font-medium text-right">Win rate</th><th className="py-1 font-medium text-right">Waarde</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {c.perBron.map((b) => (
                  <tr key={b.bron}>
                    <td className="py-1.5 text-gray-800">{bronLabel(b.bron === 'onbekend' ? null : b.bron)}</td>
                    <td className="py-1.5 text-right tabular-nums">{b.gewonnen}</td>
                    <td className="py-1.5 text-right tabular-nums">{b.verloren}</td>
                    <td className="py-1.5 text-right tabular-nums">{Math.round((b.gewonnen / Math.max(1, b.gewonnen + b.verloren)) * 100)}%</td>
                    <td className="py-1.5 text-right tabular-nums font-semibold">{eur(b.waarde)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Kaart>

        <Kaart titel="Waarom niet doorgegaan" sub={`Closed Lost ${label}.`}>
          {c.redenen.length === 0 ? <Leeg tekst="Niets verloren in deze periode." /> : (
            <ul className="divide-y divide-gray-100">
              {c.redenen.map((r) => <li key={r.reden} className="py-1.5 flex justify-between gap-2 text-sm"><span className="text-gray-800">{r.reden}</span><span className="tabular-nums text-gray-600">{r.aantal}</span></li>)}
            </ul>
          )}
        </Kaart>
      </div>

      <Kaart titel={`Gewonnen deals (${gewonnen.length})`} sub={`Closed Won ${label}.`}>
        {gewonnen.length === 0 ? <Leeg /> : (
          <ul className="divide-y divide-gray-100">
            {gewonnen.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/nextgensolutions?deal=${d.id}`} className="py-2 flex items-center gap-3 hover:bg-gray-50 -mx-2 px-2 rounded-lg">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900 truncate">{d.bedrijf}</span>
                    {d.titel && <span className="block text-[11px] text-gray-500 truncate">{d.titel.split('\n')[0]}</span>}
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-sm font-semibold tabular-nums">{eur(dealWaarde(d))}</span>
                    <span className="block text-[11px] text-gray-500">{d.gewonnen_op ? dagKort(d.gewonnen_op) : ''}{d.waarde_maandelijks ? ` · ${eur(d.waarde_maandelijks)}/m` : ''}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  )
}

function Tegel({ label, waarde, sub, nadruk }: { label: string; waarde: string; sub: string; nadruk?: boolean }) {
  return (
    <div className="card-base !p-3 sm:!p-4 min-w-0">
      <div className="text-[11px] text-gray-500 truncate">{label}</div>
      <div className="text-lg sm:text-2xl font-semibold tabular-nums mt-0.5 text-gray-900 truncate" style={nadruk ? { color: NGS_BLAUW } : undefined}>{waarde}</div>
      <div className="text-[11px] text-gray-500 truncate">{sub}</div>
    </div>
  )
}

function Kaart({ titel, sub, children }: { titel: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card-base space-y-3">
      <div><h2 className="font-semibold text-gray-900">{titel}</h2>{sub && <p className="text-xs text-gray-500">{sub}</p>}</div>
      {children}
    </section>
  )
}

/** Een dunne balk voor een aandeel (één kleur, het getal staat ernaast). */
function Balk({ deel }: { deel: number }) {
  return <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-1.5 rounded-full" style={{ width: `${Math.max(deel > 0 ? 2 : 0, Math.round(deel * 100))}%`, background: NGS_BLAUW }} /></div>
}

const Leeg = ({ tekst = 'Nog niets in deze periode.' }: { tekst?: string }) => <p className="text-sm text-gray-500">{tekst}</p>
