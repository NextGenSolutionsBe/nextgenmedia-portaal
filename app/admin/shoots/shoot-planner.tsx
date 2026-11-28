'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Loader2, MapPin, Plus, Send, Users } from 'lucide-react'
import { vandaagBrussel } from '@/lib/content/deadline-model'
import { datumKort, maandNaam, maandRaster, plusDagen, shootNaam, STATUS_INFO, tijdBereik, volgendeMaand, type ShootKort } from '@/lib/shoots/model'
import { shootRapport, urenTekst, afspraakLabel, LEGE_TIJD } from '@/lib/shoots/tijd'

const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

/** De kalender met alle shoots (maand) en daaronder de komende shoots. */
export function ShootPlanner({ magToevoegen }: { magToevoegen: boolean }) {
  const router = useRouter()
  const vandaag = vandaagBrussel()
  const [maand, setMaand] = useState(vandaag.slice(0, 7))
  const [shoots, setShoots] = useState<ShootKort[] | null>(null)
  const [komend, setKomend] = useState<ShootKort[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const raster = useMemo(() => maandRaster(maand), [maand])

  const laad = useCallback(async () => {
    setFout(null)
    try {
      const van = raster[0][0], tot = raster[raster.length - 1][6]
      const [a, b] = await Promise.all([
        fetch(`/api/admin/shoots?van=${van}&tot=${tot}`, { cache: 'no-store' }).then((r) => r.json().then((j) => (r.ok ? j : Promise.reject(new Error(j.error))))),
        fetch(`/api/admin/shoots?van=${vandaag}&tot=${plusDagen(vandaag, 180)}`, { cache: 'no-store' }).then((r) => r.json().then((j) => (r.ok ? j : Promise.reject(new Error(j.error))))),
      ])
      setShoots(a.shoots ?? []); setKomend(b.shoots ?? [])
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [raster, vandaag])
  useEffect(() => { void laad() }, [laad])

  const perDag = useMemo(() => {
    const m = new Map<string, ShootKort[]>()
    for (const s of shoots ?? []) m.set(s.datum, [...(m.get(s.datum) ?? []), s])
    return m
  }, [shoots])

  // Rapport van de maand (fase 6): per klant de shoots, de tijd en de soort afspraak.
  const rapport = useMemo(() => shootRapport((shoots ?? []).filter((s) => s.datum.slice(0, 7) === maand).map((s) => ({ ...(s.tijd ?? LEGE_TIJD), client_id: s.client_id, klant: s.klant, datum: s.datum, status: s.status }))), [shoots, maand])
  const nieuw = (datum?: string) => router.push(`/admin/shoots/nieuw${datum ? `?datum=${datum}` : ''}`)

  return (
    <div className="space-y-5">
      <div className="card-base !p-0 overflow-hidden">
        <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-gray-100">
          <button type="button" onClick={() => setMaand((m) => volgendeMaand(m, -1))} className="h-8 w-8 rounded-full hover:bg-gray-100 flex items-center justify-center" aria-label="Vorige maand"><ChevronLeft className="h-4 w-4" /></button>
          <h2 className="font-semibold capitalize min-w-[9rem] text-center">{maandNaam(maand)}</h2>
          <button type="button" onClick={() => setMaand((m) => volgendeMaand(m, 1))} className="h-8 w-8 rounded-full hover:bg-gray-100 flex items-center justify-center" aria-label="Volgende maand"><ChevronRight className="h-4 w-4" /></button>
          {maand !== vandaag.slice(0, 7) && <button type="button" onClick={() => setMaand(vandaag.slice(0, 7))} className="btn-secondary text-xs">Vandaag</button>}
          <div className="flex-1" />
          {shoots === null && !fout && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {magToevoegen && <button type="button" onClick={() => nieuw()} className="btn-primary text-sm"><Plus className="h-4 w-4" />Nieuwe shoot</button>}
        </div>
        {fout && <div className="px-4 py-3 text-sm text-red-700 bg-red-50">{fout}</div>}
        <div className="hidden sm:block">
          <div className="grid grid-cols-7 border-b border-gray-100 text-[11px] font-medium text-gray-500">
            {DAGEN.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
          </div>
          {raster.map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
              {week.map((dag) => {
                const lijst = perDag.get(dag) ?? []
                const anders = dag.slice(0, 7) !== maand
                return (
                  <div key={dag} className={`group min-h-[112px] border-r border-gray-100 last:border-r-0 p-1.5 flex flex-col gap-1 ${anders ? 'bg-gray-50/60' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs h-6 min-w-6 px-1.5 rounded-full inline-flex items-center justify-center ${dag === vandaag ? 'bg-gray-900 text-white font-semibold' : anders ? 'text-gray-400' : 'text-gray-700'}`}>{Number(dag.slice(8))}</span>
                      {magToevoegen && (
                        <button type="button" onClick={() => nieuw(dag)} className="h-6 w-6 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-900 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Nieuwe shoot op ${dag}`}><Plus className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                    {lijst.map((s) => (
                      <Link key={s.id} href={`/admin/shoots/${s.id}`} prefetch={false}
                        className={`block rounded-lg border-l-[3px] bg-white shadow-sm px-1.5 py-1 text-[11px] leading-tight hover:shadow ${s.status === 'geannuleerd' ? 'border-red-400 line-through text-gray-400' : s.status === 'concept' ? 'border-gray-300' : s.status === 'afgerond' ? 'border-green-500' : 'border-geel'}`}>
                        <span className="font-semibold">{s.start ?? ''}</span> {s.klant}
                        {s.titel && <span className="block truncate text-gray-500">{s.titel}</span>}
                      </Link>
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <p className="sm:hidden px-4 py-3 text-xs text-gray-500">Op de gsm zie je hieronder de komende shoots.</p>
      </div>

      {rapport.length > 0 && (
        <details className="card-base">
          <summary className="cursor-pointer select-none font-semibold text-sm">Rapport <span className="capitalize">{maandNaam(maand)}</span> <span className="text-gray-500 font-normal">· {rapport.reduce((t, r) => t + r.shoots, 0)} shoots · {urenTekst(rapport.reduce((t, r) => t + r.totaal, 0))}</span></summary>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1.5 font-medium">Klant</th><th className="font-medium">Shoots</th><th className="font-medium">Rijden</th><th className="font-medium">Shoot</th><th className="font-medium">Nabewerking</th><th className="font-medium">Samen</th><th className="font-medium">Afspraak</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rapport.map((r) => (
                  <tr key={r.client_id}>
                    <td className="py-1.5 font-medium">{r.klant}</td><td>{r.shoots}</td><td>{urenTekst(r.rijden)}</td><td>{urenTekst(r.shoot)}</td><td>{urenTekst(r.nabewerking)}</td>
                    <td className="font-semibold">{urenTekst(r.totaal)}{r.zonderTijd ? <span className="text-[11px] text-amber-700 font-normal"> · {r.zonderTijd} zonder tijd</span> : null}</td>
                    <td className="text-xs text-gray-600">{Object.entries(r.perAfspraak).map(([k, n]) => `${n}× ${afspraakLabel(k === 'onbekend' ? null : k).toLowerCase()}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold text-gray-900">Komende shoots</h2>
        {komend === null ? <div className="text-sm text-gray-400">Laden…</div>
          : komend.length === 0 ? (
            <div className="card-base text-sm text-gray-500">Nog geen shoots ingepland.{magToevoegen && <> <button type="button" onClick={() => nieuw()} className="underline">Plan er een</button>.</>}</div>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {komend.map((s) => (
                <li key={s.id}>
                  <Link href={`/admin/shoots/${s.id}`} prefetch={false} className="card-base !p-3 flex items-start gap-3 hover:shadow-md transition-shadow">
                    <div className={`shrink-0 w-14 rounded-xl text-center py-1.5 ${s.datum === vandaag ? 'bg-geel' : 'bg-gray-100'}`}>
                      <div className="text-lg font-bold leading-none">{Number(s.datum.slice(8))}</div>
                      <div className="text-[11px] text-gray-600">{datumKort(s.datum).split(' ')[1]}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{shootNaam(s)}</span>
                        <span className={`shrink-0 rounded-full border px-2 py-0 text-[10px] ${STATUS_INFO[s.status].cls}`}>{STATUS_INFO[s.status].label}</span>
                      </div>
                      <div className="text-xs text-gray-500 truncate">{[s.titel ? s.klant : null, tijdBereik(s.start, s.einde)].filter(Boolean).join(' · ')}</div>
                      <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-3 flex-wrap">
                        {s.locaties.length > 0 && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{s.locaties.join(', ')}</span>}
                        {s.mensen > 0 && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{s.mensen}</span>}
                        {s.verstuurd && <span className="inline-flex items-center gap-1 text-green-700"><Send className="h-3 w-3" />Verstuurd</span>}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  )
}
