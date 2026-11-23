import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import { PERIODES, kortGetal, netwerkLabel, type Kpi, type KpiCijfer, type Periode } from '@/lib/metricool-stats'

export type OverzichtRij = {
  clientId: string
  naam: string
  laatstOp: string | null
  netwerken: string[]
  cijfers: KpiCijfer[]
}

const KOLOMMEN: { kpi: Kpi; label: string }[] = [
  { kpi: 'volgers', label: 'Volgers' },
  { kpi: 'bereik', label: 'Bereik' },
  { kpi: 'weergaven', label: 'Weergaven' },
  { kpi: 'interacties', label: 'Interacties' },
  { kpi: 'posts', label: 'Posts' },
]

function geleden(iso: string | null): string {
  if (!iso) return 'Nog niet opgehaald'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 60) return `${Math.max(1, min)} min geleden`
  const u = Math.round(min / 60)
  if (u < 24) return `${u} u geleden`
  return `${Math.round(u / 24)} d geleden`
}

/** Eén cijfer met daaronder het verschil (volgers: de groei in aantal, de rest in %). */
function Cel({ c }: { c: KpiCijfer | undefined }) {
  if (!c || c.waarde === null) return <span className="text-gray-300">–</span>
  const verschil = c.kpi === 'volgers' ? (typeof c.groei === 'number' ? c.groei : null) : c.procent
  const op = (verschil ?? 0) > 0, neer = (verschil ?? 0) < 0
  return (
    <div>
      <div className="text-gray-900 tabular-nums">{kortGetal(c.waarde)}</div>
      {verschil !== null && verschil !== 0 && (
        <div className={`text-[11px] tabular-nums inline-flex items-center gap-0.5 ${op ? 'text-green-700' : neer ? 'text-red-600' : 'text-gray-500'}`}>
          {op ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {op ? '+' : ''}{c.kpi === 'volgers' ? verschil.toLocaleString('nl-BE') : `${verschil.toLocaleString('nl-BE')}%`}
        </div>
      )}
    </div>
  )
}

/** Alle klanten met een Metricool-merk naast elkaar, voor de gekozen periode. Klik = de details. */
export function Overzicht({ rijen, periode }: { rijen: OverzichtRij[]; periode: Periode }) {
  const vergeleken = periode.soort === 'maand' ? 'de maand ervoor' : periode.soort === '90d' ? 'de 90 dagen ervoor' : 'de 30 dagen ervoor'
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {PERIODES.map((p) => (
          <Link key={p.key} href={`/admin/metricool?periode=${p.key}`} scroll={false} prefetch={false}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${p.key === periode.soort ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:text-gray-900'}`}>
            {p.label}
          </Link>
        ))}
      </div>
      <p className="text-sm text-gray-500 -mt-1">
        {periode.label.charAt(0).toUpperCase() + periode.label.slice(1)} · alle kanalen samen · verschil met {vergeleken}
      </p>

      {rijen.length === 0 ? (
        <div className="card-base text-sm text-gray-500">Nog geen klant gekoppeld aan een Metricool-merk. Koppelen doe je bij Planning.</div>
      ) : (
        <div className="md:card-base md:p-0 overflow-hidden kaart-tabel">
          <div className="table-wrap">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className="table-th">Klant</th>
                  {KOLOMMEN.map((k) => <th key={k.kpi} className="table-th text-right">{k.label}</th>)}
                  <th className="table-th text-right">Bijgewerkt</th>
                  <th className="table-th w-8" />
                </tr>
              </thead>
              <tbody>
                {rijen.map((r) => {
                  const href = `/admin/metricool?klant=${r.clientId}&periode=${periode.soort}`
                  return (
                    <tr key={r.clientId} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="table-td" data-label="">
                        <Link href={href} prefetch={false} className="font-medium text-gray-900 hover:underline">{r.naam}</Link>
                        {r.netwerken.length > 0 && <div className="text-[11px] text-gray-500">{r.netwerken.map(netwerkLabel).join(' · ')}</div>}
                      </td>
                      {KOLOMMEN.map((k) => (
                        <td key={k.kpi} className="table-td text-right" data-label={k.label}><Cel c={r.cijfers.find((c) => c.kpi === k.kpi)} /></td>
                      ))}
                      <td className="table-td text-right text-xs text-gray-500 whitespace-nowrap" data-label="Bijgewerkt">{geleden(r.laatstOp)}</td>
                      <td className="table-td text-right" data-label="">
                        <Link href={href} prefetch={false} aria-label={`Statistieken van ${r.naam}`} className="inline-flex text-gray-400 hover:text-gray-900"><ChevronRight className="h-4 w-4" /></Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
