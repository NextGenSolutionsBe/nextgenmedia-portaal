import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import {
  KPIS, PERIODES, bestePosts, grafiekReeks, kortGetal, netwerkLabel, netwerkenMetData, samenvatting,
  type KpiCijfer, type Netwerk, type Periode, type PeriodeSoort,
} from '@/lib/metricool-stats'
import type { StatistiekenData } from '@/lib/metricool-stats-server'
import { DagGrafiek } from './dag-grafiek'
import { PostKaart } from './post-kaart'

const link = (q: { periode: PeriodeSoort; netwerk: Netwerk | 'alle' }) =>
  `/portal/metricool?${new URLSearchParams({ periode: q.periode, netwerk: q.netwerk }).toString()}`

function Pil({ href, actief, children }: { href: string; actief: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} scroll={false} prefetch={false}
      className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${actief ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:text-gray-900'}`}>
      {children}
    </Link>
  )
}

/** Verschil met de vorige periode: pijl, teken en woord, nooit enkel kleur. */
function Verschil({ c }: { c: KpiCijfer }) {
  if (c.procent === null) return <p className="text-xs text-gray-400 mt-1">Geen vergelijking</p>
  const op = c.procent > 0, neer = c.procent < 0
  const Icoon = op ? ArrowUpRight : neer ? ArrowDownRight : Minus
  return (
    <p className={`text-xs mt-1 flex items-center gap-0.5 ${op ? 'text-green-700' : neer ? 'text-red-600' : 'text-gray-500'}`}>
      <Icoon className="h-3.5 w-3.5" />
      <span className="tabular-nums">{op ? '+' : ''}{c.procent.toLocaleString('nl-BE')}%</span>
    </p>
  )
}

export function Statistieken({ data, periode, netwerk }: { data: StatistiekenData; periode: Periode; netwerk: Netwerk | 'alle' }) {
  const netwerken = netwerkenMetData(data.rijen)
  const kies: Netwerk | 'alle' = netwerk !== 'alle' && !netwerken.includes(netwerk) ? 'alle' : netwerk
  const cijfers = samenvatting(data.rijen, periode, kies).filter((c) => c.waarde !== null)
  const vorigeLabel = periode.soort === 'maand' ? 'de maand ervoor' : periode.soort === '90d' ? 'de 90 dagen ervoor' : 'de 30 dagen ervoor'
  const posts = bestePosts(data.posts, periode, kies)
  const heeft = (k: string) => cijfers.some((c) => c.kpi === k)
  const zichtbaar = heeft('bereik') ? 'bereik' : 'weergaven'
  const bijgewerkt = data.laatstOp
    ? new Date(data.laatstOp).toLocaleString('nl-BE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
    : null

  if (!data.rijen.length && !data.posts.length) {
    return (
      <div className="card-base text-center py-12">
        <p className="font-medium text-gray-900">Je cijfers worden opgehaald</p>
        <p className="text-sm text-gray-500 mt-1">Dat duurt de eerste keer even. Kom straks terug.</p>
      </div>
    )
  }

  // Per kanaal naast elkaar, enkel bij "Alle kanalen" en als er meer dan één is.
  const perKanaal = kies === 'alle' && netwerken.length > 1
    ? netwerken.map((n) => ({ netwerk: n, c: samenvatting(data.rijen, periode, n) }))
    : []
  const kolommen = KPIS.filter((k) => perKanaal.some((r) => r.c.find((c) => c.kpi === k.key)?.waarde !== null))

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {PERIODES.map((p) => <Pil key={p.key} href={link({ periode: p.key, netwerk: kies })} actief={p.key === periode.soort}>{p.label}</Pil>)}
        </div>
        {netwerken.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <Pil href={link({ periode: periode.soort, netwerk: 'alle' })} actief={kies === 'alle'}>Alle kanalen</Pil>
            {netwerken.map((n) => <Pil key={n} href={link({ periode: periode.soort, netwerk: n })} actief={kies === n}>{netwerkLabel(n)}</Pil>)}
          </div>
        )}
      </div>

      <p className="text-sm text-gray-500 -mt-1">
        {periode.label.charAt(0).toUpperCase() + periode.label.slice(1)}
        {kies !== 'alle' ? ` · ${netwerkLabel(kies)}` : netwerken.length === 1 ? ` · ${netwerkLabel(netwerken[0])}` : ''}
        {' · '}vergeleken met {vorigeLabel}
      </p>

      {cijfers.length > 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {cijfers.map((c) => {
            const info = KPIS.find((k) => k.key === c.kpi)!
            return (
              <div key={c.kpi} className="stat-card" title={info.uitleg}>
                <p className="text-xs text-gray-500">{info.label}</p>
                <p className="text-2xl sm:text-3xl font-semibold text-gray-900 tabular-nums mt-1">{kortGetal(c.waarde)}</p>
                {c.kpi === 'volgers' && typeof c.groei === 'number' && c.groei !== 0
                  ? <p className="text-xs text-gray-600 mt-1 tabular-nums">{c.groei > 0 ? '+' : ''}{c.groei.toLocaleString('nl-BE')} in deze periode</p>
                  : <Verschil c={c} />}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="card-base text-sm text-gray-500">Voor deze periode zijn er nog geen cijfers.</div>
      )}

      <div className="grid lg:grid-cols-2 gap-3">
        {heeft('volgers') && <DagGrafiek titel="Volgers" eenheid="Volgers" soort="lijn" punten={grafiekReeks(data.rijen, periode, kies, 'volgers')} />}
        {heeft(zichtbaar) && <DagGrafiek titel={zichtbaar === 'bereik' ? 'Bereik per dag' : 'Weergaven per dag'} eenheid={zichtbaar === 'bereik' ? 'Bereik' : 'Weergaven'} soort="balk" punten={grafiekReeks(data.rijen, periode, kies, zichtbaar)} />}
        {heeft('interacties') && <DagGrafiek titel="Interacties per dag" eenheid="Interacties" soort="balk" punten={grafiekReeks(data.rijen, periode, kies, 'interacties')} />}
      </div>

      {perKanaal.length > 0 && kolommen.length > 0 && (
        <div className="card-base overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Per kanaal</h3>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1.5 pr-3 font-medium">Kanaal</th>
                {kolommen.map((k) => <th key={k.key} className="py-1.5 px-2 font-medium text-right">{k.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {perKanaal.map((r) => (
                <tr key={r.netwerk} className="border-t border-gray-100">
                  <td className="py-2 pr-3 text-gray-900">
                    <Link href={link({ periode: periode.soort, netwerk: r.netwerk })} scroll={false} prefetch={false} className="hover:underline">{netwerkLabel(r.netwerk)}</Link>
                  </td>
                  {kolommen.map((k) => <td key={k.key} className="py-2 px-2 text-right text-gray-700">{kortGetal(r.c.find((c) => c.kpi === k.key)?.waarde ?? null)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-3">Beste posts</h2>
        {posts.length === 0
          ? <div className="card-base text-sm text-gray-500">Geen posts in deze periode.</div>
          : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {posts.map((p) => (
                <PostKaart key={`${p.netwerk}:${p.post_id}`} netwerk={p.netwerk} tekst={p.tekst} link={p.link} beeld={p.beeld} gepubliceerd={p.gepubliceerd_op} cijfers={p.cijfers} />
              ))}
            </div>
          )}
      </div>

      {bijgewerkt && <p className="text-xs text-gray-400">Cijfers uit Metricool, bijgewerkt op {bijgewerkt}.</p>}
    </div>
  )
}
