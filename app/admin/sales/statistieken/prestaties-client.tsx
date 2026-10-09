'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Trophy, PhoneCall, Target, Info, CheckCircle2, XCircle, HelpCircle, History } from 'lucide-react'
import { KaartTabel } from '@/components/ui/kaart-tabel'
import { duurTekst, type PRij, type PodiumPlek } from '@/lib/sales/prestaties'

type Afspraak = { id: string; lead_id: string | null; setter_id: string | null; verantwoordelijke_id: string | null; starts_at: string; status: string | null; aanwezigheid: string | null; outcome: string | null }
type Activiteit = { id: string; lead_id: string; medewerker_id: string | null; type: string; uitkomst: string | null; bron: string | null; van_fase: string | null; naar_fase: string | null; gesprek_start: string | null; gesprek_eind: string | null; created_at: string }
type Correctie = { id: string; soort: string; oud: unknown; nieuw: unknown; reden: string; door_email: string | null; created_at: string }
type Data = {
  perMedewerker: PRij[]; team: PRij | null; podium: { coldCaller: PodiumPlek[]; closer: PodiumPlek[] } | null
  namen: Record<string, string>; isAdmin: boolean; meId: string
  medewerkers?: { id: string; naam: string }[]
  registraties?: { afspraken: Afspraak[]; activiteiten: Activiteit[]; correcties: Correctie[]; leadNaam: Record<string, string> } | null
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function bereikVoor(k: string): { van: string; tot: string } {
  const n = new Date()
  if (k === 'vorige') return { van: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), tot: iso(new Date(n.getFullYear(), n.getMonth(), 0)) }
  if (k === '30') return { van: iso(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 29)), tot: iso(n) }
  if (k === 'jaar') return { van: iso(new Date(n.getFullYear(), 0, 1)), tot: iso(n) }
  return { van: iso(new Date(n.getFullYear(), n.getMonth(), 1)), tot: iso(new Date(n.getFullYear(), n.getMonth() + 1, 0)) }
}
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('nl-BE', { maximumFractionDigits: 1 })} %`)
const datumTijd = (s: string) => new Date(s).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const FASE: Record<string, string> = { outbound: 'Outbound', inbound: 'Inbound', gebeld: 'Gebeld', email_verstuurd: 'E-mail verstuurd', geen_interesse: 'Geen interesse', opvolgen: 'Opvolgen', afspraak: 'Afspraak gepland', voorstel: 'Voorstel', gewonnen: 'Gewonnen', verloren: 'Verloren' }
const UITKOMST: Record<string, string> = { niet_opgenomen: 'Niet opgenomen', contact_gehad: 'Contact gehad', geen_interesse: 'Geen interesse', afspraak_gepland: 'Afspraak gepland' }

export function PrestatiesClient() {
  const [preset, setPreset] = useState('maand')
  const [eigen, setEigen] = useState(bereikVoor('maand'))
  const bereik = preset === 'eigen' ? eigen : bereikVoor(preset)
  const [data, setData] = useState<Data | null>(null)
  const [laden, setLaden] = useState(false)

  const laad = useCallback(async () => {
    setLaden(true)
    try {
      const r = await fetch(`/api/admin/sales/prestaties?van=${bereik.van}&tot=${bereik.tot}&registraties=1`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Laden mislukt')
      setData(j as Data)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [bereik.van, bereik.tot])
  useEffect(() => { laad() }, [laad])

  const naam = (id: string | null | undefined) => (id ? data?.namen[id] ?? 'Onbekende gebruiker' : 'Niet toegewezen')

  return (
    <div className="space-y-5">
      {/* Periode */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {[['maand', 'Deze maand'], ['vorige', 'Vorige maand'], ['30', 'Laatste 30 dagen'], ['jaar', 'Dit jaar'], ['eigen', 'Aangepast']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPreset(k)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${preset === k ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{l}</button>
          ))}
        </div>
        {preset === 'eigen' && (
          <div className="flex items-center gap-1.5 text-xs">
            <input type="date" className="input-base !w-auto text-xs" value={eigen.van} onChange={(e) => setEigen((x) => ({ ...x, van: e.target.value }))} />
            <span className="text-gray-400">t/m</span>
            <input type="date" className="input-base !w-auto text-xs" value={eigen.tot} onChange={(e) => setEigen((x) => ({ ...x, tot: e.target.value }))} />
          </div>
        )}
        {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {!data ? <div className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" /></div> : (
        <>
          {/* Podium */}
          {data.podium && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Podium titel="Beste cold caller" sub="Meeste cold calls in deze periode" icoon={<PhoneCall className="h-4 w-4" />}
                plekken={data.podium.coldCaller} naam={naam} waarde={(p) => `${p.waarde} ${p.waarde === 1 ? 'call' : 'calls'}`} leeg="Nog geen cold calls in deze periode." />
              <Podium titel="Beste closer" sub="Hoogste closing rate op de leads waarvan die medewerker verantwoordelijke is" icoon={<Target className="h-4 w-4" />}
                plekken={data.podium.closer} naam={naam} waarde={(p) => `${pct(p.waarde)} · ${p.detail} gewonnen/afgerond`} leeg="Nog geen gewonnen of verloren leads met een verantwoordelijke — dus nog geen closing rate." />
            </div>
          )}

          {/* Team of eigen cijfers */}
          {(() => {
            const r = data.team ?? data.perMedewerker[0] ?? null
            if (!r) return <div className="card-base text-sm text-gray-500">Nog geen salesactiviteit in deze periode.</div>
            return (
              <div className="card-base">
                <h2 className="font-semibold">{data.team ? 'Team' : 'Mijn cijfers'}</h2>
                <p className="text-xs text-gray-500 mb-3">Cold calls, bereikt, gespreksduur en faseverplaatsingen: gekozen periode. Afspraken, gewonnen, verloren, geen interesse en closing rate: de pipeline zoals ze nu staat, per verantwoordelijke.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <Tegel label="Cold calls" waarde={r.coldCalls} />
                  <Tegel label="Bereikte leads" waarde={r.bereikteLeads} />
                  <Tegel label="Gespreksduur (gemeten)" waarde={r.gesprekkenMetDuur ? duurTekst(r.gespreksduurSec) : '—'} onder={r.gesprekkenZonderDuur ? `${r.gesprekkenZonderDuur} gesprek(ken) zonder meting` : undefined} />
                  <Tegel label="Afspraken ingepland" waarde={r.afsprakenIngepland} onder="leads in de pipeline" />
                  <Tegel label="Afspraken gehouden" waarde={r.afsprakenGehouden} onder={[r.afsprakenNietGehouden ? `${r.afsprakenNietGehouden} niet gehouden` : '', r.afsprakenOnbevestigd ? `${r.afsprakenOnbevestigd} nog te bevestigen` : ''].filter(Boolean).join(' · ') || undefined} />
                  <Tegel label="Closing rate" waarde={pct(r.closingRate)} onder={r.closingAfgerond ? `${r.closingGewonnen} / ${r.closingAfgerond} gewonnen/afgerond` : 'nog geen gewonnen of verloren leads'} nadruk />
                  <Tegel label="Gewonnen" waarde={r.gewonnen} kleur="text-green-700" />
                  <Tegel label="Verloren" waarde={r.verloren} kleur="text-red-600" />
                  <Tegel label="Geen interesse" waarde={r.geenInteresse} onder="leads in de pipeline" />
                  <Tegel label="Faseverplaatsingen" waarde={r.faseverplaatsingen} />
                </div>
              </div>
            )
          })()}

          {/* Vergelijking per medewerker */}
          {data.isAdmin && data.perMedewerker.length > 0 && (
            <div className="card-base">
              <h2 className="font-semibold mb-3">Vergelijking per medewerker</h2>
              <KaartTabel>
                <div className="table-wrap">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                      <th className="table-th">Medewerker</th>
                      <th className="table-th text-right">Cold calls</th><th className="table-th text-right">Bereikt</th><th className="table-th text-right">Gespreksduur</th>
                      <th className="table-th text-right">Ingepland</th><th className="table-th text-right">Gehouden</th><th className="table-th text-right">Gewonnen</th>
                      <th className="table-th text-right">Verloren</th><th className="table-th text-right">Geen interesse</th><th className="table-th text-right">Fase&shy;verplaatsingen</th>
                      <th className="table-th text-right">Closing rate</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.perMedewerker.map((r) => (
                        <tr key={r.sleutel} className={r.sleutel === 'onbekend' ? 'text-gray-500' : ''}>
                          <td className="table-td font-medium">{naam(r.sleutel === 'onbekend' ? null : r.sleutel)}</td>
                          <td className="table-td text-right tabular-nums">{r.coldCalls}</td>
                          <td className="table-td text-right tabular-nums">{r.bereikteLeads}</td>
                          <td className="table-td text-right tabular-nums">{r.gesprekkenMetDuur ? duurTekst(r.gespreksduurSec) : '—'}</td>
                          <td className="table-td text-right tabular-nums">{r.afsprakenIngepland}</td>
                          <td className="table-td text-right tabular-nums">{r.afsprakenGehouden}{r.afsprakenOnbevestigd ? <span className="text-amber-600" title="Voorbij, nog niet bevestigd"> ({r.afsprakenOnbevestigd}?)</span> : null}</td>
                          <td className="table-td text-right tabular-nums text-green-700">{r.gewonnen}</td>
                          <td className="table-td text-right tabular-nums text-red-600">{r.verloren}</td>
                          <td className="table-td text-right tabular-nums">{r.geenInteresse}</td>
                          <td className="table-td text-right tabular-nums">{r.faseverplaatsingen}</td>
                          <td className="table-td text-right tabular-nums font-semibold">{pct(r.closingRate)}{r.closingAfgerond ? <span className="block text-[10px] font-normal text-gray-500">{r.closingGewonnen} / {r.closingAfgerond}</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </KaartTabel>
            </div>
          )}

          {/* Wat wel en niet betrouwbaar geregistreerd is */}
          <Toelichting data={data} />

          {data.isAdmin && data.registraties && (
            <Correcties data={data} naam={naam} onGewijzigd={laad} />
          )}
        </>
      )}
    </div>
  )
}

function Podium({ titel, sub, icoon, plekken, naam, waarde, leeg }: { titel: string; sub: string; icoon: React.ReactNode; plekken: PodiumPlek[]; naam: (id: string) => string; waarde: (p: PodiumPlek) => string; leeg: string }) {
  const kleur = (p: number) => (p === 1 ? 'bg-[#fff848] text-black' : p === 2 ? 'bg-gray-200 text-gray-800' : 'bg-orange-100 text-orange-800')
  return (
    <div className="card-base">
      <div className="flex items-center gap-2 font-semibold"><Trophy className="h-4 w-4 text-amber-500" />{titel}<span className="text-gray-400">{icoon}</span></div>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">{sub}</p>
      {plekken.length === 0 ? <p className="text-sm text-gray-400">{leeg}</p> : (
        <ol className="space-y-1.5">
          {plekken.map((p) => (
            <li key={p.sleutel} className="flex items-center gap-2.5">
              <span className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${kleur(p.plaats)}`}>{p.plaats}</span>
              <span className="font-medium truncate">{naam(p.sleutel)}</span>
              <span className="ml-auto text-sm tabular-nums text-gray-700 text-right">{waarde(p)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Tegel({ label, waarde, onder, kleur = 'text-gray-900', nadruk }: { label: string; waarde: number | string; onder?: string; kleur?: string; nadruk?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 min-w-0 ${nadruk ? 'border-black/20 bg-[#fff848]/15' : 'border-gray-200 bg-white'}`}>
      <div className="text-[11px] font-medium text-gray-500 truncate">{label}</div>
      <div className={`text-xl font-bold tabular-nums leading-tight ${kleur}`}>{waarde}</div>
      {onder && <div className="text-[10px] text-gray-500 mt-0.5">{onder}</div>}
    </div>
  )
}

function Toelichting({ data }: { data: Data }) {
  const r = data.team ?? data.perMedewerker[0]
  const punten: string[] = []
  punten.push('Afspraken ingepland/gehouden, gewonnen, verloren en geen interesse komen rechtstreeks uit de pipeline: elke lead telt voor de verantwoordelijke die er nu op staat, ongeacht wie de kaart versleepte. Dit is de stand van nu, los van de gekozen periode.')
  punten.push('Ingepland = lead in Afspraak gepland, Voorstel, Gewonnen of Verloren (of met een afspraak in de agenda). Gehouden = lead in Voorstel, Gewonnen of Verloren (of afspraak bevestigd als gehouden).')
  punten.push('Closing rate = gewonnen ÷ (gewonnen + verloren).')
  punten.push('Cold calls = alle geregistreerde belpogingen van die medewerker in de periode. Faseverplaatsingen tellen voor wie de kaart zelf verplaatste.')
  punten.push('Gespreksduur telt enkel gesprekken waarbij de timer liep (start én einde bewaard). Er wordt nooit een duur geschat.')
  if (r && r.afsprakenOnbevestigd) punten.push(`${r.afsprakenOnbevestigd} lead(s) in Afspraak gepland hebben een voorbije afspraak die nog niet als gehouden bevestigd is.`)
  if (data.perMedewerker.some((x) => x.sleutel === 'onbekend')) punten.push('"Niet toegewezen" = leads zonder verantwoordelijke in de pipeline. Kies er een verantwoordelijke op en ze tellen meteen mee voor die persoon.')
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 space-y-1">
      <div className="font-semibold text-gray-700 flex items-center gap-1.5"><Info className="h-3.5 w-3.5" />Hoe de cijfers tot stand komen</div>
      <ul className="list-disc pl-4 space-y-0.5">{punten.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>
  )
}

function Correcties({ data, naam, onGewijzigd }: { data: Data; naam: (id: string | null | undefined) => string; onGewijzigd: () => void }) {
  const reg = data.registraties!
  const [tab, setTab] = useState<'afspraken' | 'registraties' | 'log'>('afspraken')
  const [bezig, setBezig] = useState<string | null>(null)
  const medewerkers = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of data.medewerkers ?? []) m.set(x.id, x.naam)
    for (const [k, v] of Object.entries(data.namen)) if (k !== 'onbekend' && !m.has(k)) m.set(k, v)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data.medewerkers, data.namen])

  const stuur = async (sleutel: string, body: Record<string, unknown>, vraagReden: boolean) => {
    let reden = ''
    if (vraagReden) {
      reden = (prompt('Reden van deze correctie (wordt bewaard met de oude en nieuwe waarde):') ?? '').trim()
      if (!reden) { toast.error('Zonder reden geen correctie.'); return }
    }
    setBezig(sleutel)
    try {
      const r = await fetch('/api/admin/sales/prestaties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, reden }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Correctie mislukt')
      toast.success('Bewaard — de cijfers zijn bijgewerkt.'); onGewijzigd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Correctie mislukt') } finally { setBezig(null) }
  }
  const nu = new Date().toISOString()

  return (
    <div className="card-base">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="font-semibold">Registraties bevestigen en corrigeren</h2>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 text-xs">
          {([['afspraken', `Afspraken (${reg.afspraken.length})`], ['registraties', `Gesprekken en verplaatsingen (${reg.activiteiten.length})`], ['log', 'Correctielog']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`px-2.5 py-1 rounded-md font-medium ${tab === k ? 'bg-black text-white' : 'text-gray-600'}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === 'afspraken' && (reg.afspraken.length === 0 ? <p className="text-sm text-gray-400">Geen afspraken in deze periode.</p> : (
        <KaartTabel>
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100"><th className="table-th">Lead</th><th className="table-th">Datum</th><th className="table-th">Ingepland door</th><th className="table-th">Agenda van</th><th className="table-th">Gehouden?</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {reg.afspraken.map((a) => {
                  const gehouden = a.aanwezigheid === 'gehouden' || (!a.aanwezigheid && (a.outcome === 'won' || a.outcome === 'lost'))
                  const voorbij = a.starts_at < nu
                  return (
                    <tr key={a.id}>
                      <td className="table-td font-medium">{a.lead_id ? reg.leadNaam[a.lead_id] ?? '—' : '—'}</td>
                      <td className="table-td whitespace-nowrap">{datumTijd(a.starts_at)}</td>
                      <td className="table-td">{naam(a.setter_id)}</td>
                      <td className="table-td">{naam(a.verantwoordelijke_id)}</td>
                      <td className="table-td">
                        <div className="flex items-center gap-1 flex-wrap">
                          {gehouden ? <span className="inline-flex items-center gap-1 text-green-700 text-xs font-medium"><CheckCircle2 className="h-3.5 w-3.5" />Gehouden</span>
                            : a.aanwezigheid === 'niet_gehouden' ? <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium"><XCircle className="h-3.5 w-3.5" />Niet gehouden</span>
                            : voorbij ? <span className="inline-flex items-center gap-1 text-amber-700 text-xs font-medium"><HelpCircle className="h-3.5 w-3.5" />Te bevestigen</span>
                            : <span className="text-xs text-gray-400">Nog niet voorbij</span>}
                          {voorbij && (
                            <select className="input-base !w-auto text-xs" value="" disabled={bezig === a.id}
                              onChange={(e) => { const w = e.target.value; if (!w) return; stuur(a.id, { soort: 'aanwezigheid', id: a.id, waarde: w === 'onbekend' ? null : w }, !!a.aanwezigheid || w === 'onbekend') }}>
                              <option value="">{a.aanwezigheid || gehouden ? 'Corrigeren…' : 'Bevestigen…'}</option>
                              <option value="gehouden">Gehouden</option>
                              <option value="niet_gehouden">Niet gehouden</option>
                              {a.aanwezigheid && <option value="onbekend">Onbekend</option>}
                            </select>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </KaartTabel>
      ))}

      {tab === 'registraties' && (reg.activiteiten.length === 0 ? <p className="text-sm text-gray-400">Geen gesprekken of verplaatsingen in deze periode.</p> : (
        <KaartTabel>
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100"><th className="table-th">Lead</th><th className="table-th">Wanneer</th><th className="table-th">Wat</th><th className="table-th">Door</th><th className="table-th">Corrigeren</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {reg.activiteiten.map((a) => {
                  const d = a.gesprek_start && a.gesprek_eind ? Math.round((Date.parse(a.gesprek_eind) - Date.parse(a.gesprek_start)) / 1000) : null
                  const wat = a.type === 'telefoongesprek'
                    ? `${a.bron === 'focus' ? 'Cold call' : 'Gesprek'}${a.uitkomst ? ` · ${UITKOMST[a.uitkomst] ?? a.uitkomst}` : ''}${d !== null && d > 0 ? ` · ${duurTekst(d)}` : ''}`
                    : `${FASE[a.van_fase ?? ''] ?? a.van_fase ?? '?'} → ${FASE[a.naar_fase ?? ''] ?? a.naar_fase ?? '?'}`
                  return (
                    <tr key={a.id}>
                      <td className="table-td font-medium">{reg.leadNaam[a.lead_id] ?? '—'}</td>
                      <td className="table-td whitespace-nowrap">{datumTijd(a.created_at)}</td>
                      <td className="table-td">{wat}</td>
                      <td className="table-td">
                        <select className="input-base !w-auto text-xs" value={a.medewerker_id ?? ''} disabled={bezig === a.id}
                          onChange={(e) => { if (e.target.value) stuur(a.id, { soort: 'activiteit_medewerker', id: a.id, waarde: e.target.value }, true) }}>
                          {!a.medewerker_id && <option value="">— onbekend —</option>}
                          {medewerkers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                        </select>
                      </td>
                      <td className="table-td">
                        <button type="button" disabled={bezig === a.id} onClick={() => stuur(a.id, { soort: 'activiteit_ongeldig', id: a.id }, true)} className="text-xs text-red-600 hover:underline">Foutief — niet meetellen</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </KaartTabel>
      ))}

      {tab === 'log' && (reg.correcties.length === 0 ? <p className="text-sm text-gray-400">Nog geen correcties.</p> : (
        <ul className="divide-y divide-gray-100 text-sm">
          {reg.correcties.map((c) => (
            <li key={c.id} className="py-2">
              <div className="flex items-center gap-2 text-xs text-gray-500"><History className="h-3.5 w-3.5" />{datumTijd(c.created_at)} · {c.door_email?.split('@')[0] ?? 'onbekend'} · {c.soort}</div>
              <div className="text-gray-800 mt-0.5">{JSON.stringify(c.oud)} → {JSON.stringify(c.nieuw)}</div>
              <div className="text-xs text-gray-600">Reden: {c.reden}</div>
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}
