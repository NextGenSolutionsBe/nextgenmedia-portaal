'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Bell, CalendarPlus, ChevronDown, Plus, StickyNote, Check, Inbox, Layers, Flag } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import { REEKSEN, isAchterstallig, isKlaar, isKwartaalmaand, maandag, plusDagen, maandVan, statusVan, eersteWerkdag, DAG_KORT, type Reeks } from '@/lib/contentplanning/model'
import { Leeg, StatusBadge, TaakKaart, focusRing } from './bouwstenen'
import { MaandstartBlok, VasteKlant } from './werking'
import type { CpData, Doe, Notitie, Taak, Weergave } from './types'
import { MAANDEN, datumNl } from './types'

export type WeergaveProps = {
  data: CpData; taken: Taak[]; vandaag: string; anker: string; doe: Doe
  klantNaam: (id: string | null) => string | null
  notitiesVan: (taakId: string) => number
  reeksenOp: (d: string) => Reeks[]
  onTaak: (t: Taak | null, standaard?: Partial<Taak>) => void
  onKlant: (id: string) => void
  onDag: (d: string) => void
  onNotities: (scope: Partial<Notitie> & { titel: string }) => void
  vink: (t: Taak) => void
  verplaats: (t: Taak, datum: string | null) => void
  kanSchrijven: boolean
}

/** Eerste werkdag van de maand = maandstart (Klantenbatches + Reeksen). */
const isMaandstart = (d: string) => d === eersteWerkdag(maandVan(d))
function MaandstartLabel() {
  return <span className="inline-flex items-center gap-0.5 rounded bg-black text-white px-1 text-[9px] font-semibold uppercase leading-4" title="Eerste werkdag: Klantenbatches invullen en reeksen bekijken"><Flag className="h-2.5 w-2.5" />Maandstart</span>
}

function ReeksStippen({ r }: { r: Reeks[] }) {
  return <span className="inline-flex gap-0.5" aria-label={r.length ? `Reeks ${r.join(', ')}` : 'Geen reeks'}>{r.map((n) => <span key={n} className={`h-1.5 w-3 rounded-full ${REEKSEN[n - 1].kleur}`} title={REEKSEN[n - 1].label} />)}</span>
}

/** Drop-zone hulpje: sleep een taak hierheen = nieuwe werkdatum (deadline blijft). */
function useDrop(taken: Taak[], verplaats: WeergaveProps['verplaats']) {
  const [doel, setDoel] = useState<string | null>(null)
  return {
    doel,
    props: (d: string | null) => ({
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDoel(d ?? 'geen') },
      onDragLeave: () => setDoel(null),
      onDrop: (e: React.DragEvent) => { e.preventDefault(); setDoel(null); const t = taken.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (t && t.werkdatum !== d) verplaats(t, d) },
    }),
    sleep: (t: Taak) => (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' },
  }
}

// ── Dag ─────────────────────────────────────────────────────────────────────
export function DagWeergave(p: WeergaveProps & { aanDeBeurt: { zonderCyclus: number; ontbrekend: number }; onKlaarzetten: () => void; onWeergave: (w: Weergave) => void }) {
  const { data, taken, vandaag, anker } = p
  const st = data.instellingen.statussen
  const maand = maandVan(anker)
  const reeksen = p.reeksenOp(anker)
  const vanDag = taken.filter((t) => t.werkdatum === anker).sort((a, b) => Number(isKlaar(a.status, st)) - Number(isKlaar(b.status, st)) || (p.klantNaam(a.client_id) ?? '').localeCompare(p.klantNaam(b.client_id) ?? ''))
  const achter = taken.filter((t) => t.werkdatum !== anker && isAchterstallig(t, anker, st))
  const inTePlannen = taken.filter((t) => !t.werkdatum && !isKlaar(t.status, st))
  const herinneringen = data.notities.filter((n) => n.soort === 'herinnering' && n.herinner_op && n.herinner_op <= anker && !n.afgevinkt_op)
  const klantenVandaag = new Set(vanDag.map((t) => t.client_id).filter(Boolean))
  const aandacht = data.notities.filter((n) => n.client_id && klantenVandaag.has(n.client_id) && !n.taak_id && (n.vastgepind || (n.soort === 'cyclus' && n.maand === maand)))
  const actieveBatches = data.batches.filter((b) => isKwartaalmaand(maand, b.start_month))
  const [planDatum, setPlanDatum] = useState<Record<string, string>>({})
  // Stap 2: wie zit deze maand in welke reeks (volgens Klantenbatches)?
  const bordMaand = data.bord.filter((c) => c.maand === maand)
  const klantenInReeks = (r: Reeks) => bordMaand.filter((c) => c.reeks === r && c.actief).map((c) => ({ id: c.client_id, naam: p.klantNaam(c.client_id) })).filter((x): x is { id: string; naam: string } => !!x.naam).sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))
  // Stap 1 + 2 samen: per klant de open taken van die reeks in de cyclus van deze maand.
  const cycliMaand = new Set(data.cycli.filter((c) => c.maand === maand).map((c) => c.id))
  const takenVan = (cid: string, r: Reeks) => {
    const alle = taken.filter((t) => t.client_id === cid && t.reeks === r && (t.cyclus_id ? cycliMaand.has(t.cyclus_id) : (t.werkdatum ?? '').startsWith(maand)))
    return { alle, open: alle.filter((t) => !isKlaar(t.status, st)).sort((a, b) => (a.werkdatum ?? '9999').localeCompare(b.werkdatum ?? '9999') || a.volgorde - b.volgorde) }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4">
      <div className="space-y-4">
        {/* Reeks en batches van vandaag */}
        <div className="card-base p-3 flex items-center gap-2 flex-wrap">
          {reeksen.length ? reeksen.map((r) => (
            <span key={r} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${REEKSEN[r - 1].zacht} border border-gray-200`}><span className={`h-2 w-2 rounded-full ${REEKSEN[r - 1].kleur}`} />{REEKSEN[r - 1].label}</span>
          )) : <span className="text-xs text-gray-500">Geen reeks gepland op deze dag (Maandplanning).</span>}
          {reeksen.length > 0 && <button type="button" onClick={() => p.onNotities({ reeks: reeksen[0], maand, soort: 'cyclus', titel: `Notities · ${REEKSEN[reeksen[0] - 1].label} · ${MAANDEN[Number(maand.slice(5)) - 1]}` })} className={`text-xs underline text-gray-600 ${focusRing}`}>notities bij deze reeks</button>}
          <span className="text-gray-300 hidden sm:inline">|</span>
          {data.batches.length === 0 ? <span className="text-xs text-gray-500">Nog geen batches ingesteld.</span> : data.batches.map((b) => (
            <button key={b.id} type="button" onClick={() => p.onNotities({ batch_id: b.id, soort: 'afspraak', titel: `Notities · ${b.name}` })} title={actieveBatches.includes(b) ? 'Kwartaalmaand voor deze batch' : 'Geen kwartaalmaand'}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${actieveBatches.includes(b) ? 'font-semibold border-gray-800' : 'text-gray-500 border-gray-200'} ${focusRing}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: b.color }} />{b.name}{actieveBatches.includes(b) && <span className="text-[10px] uppercase">· kwartaal</span>}
            </button>
          ))}
        </div>

        <MaandstartBlok data={data} doe={p.doe} anker={anker} kanSchrijven={p.kanSchrijven} onWeergave={p.onWeergave} />

        {/* Stap 1 + 2: wat moet je vandaag per klant doen in de reeks(en) van vandaag */}
        {bordMaand.length === 0 ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-center gap-2 flex-wrap">
            <Layers className="h-4 w-4" />Klantenbatches voor {MAANDEN[Number(maand.slice(5)) - 1]} is nog niet ingevuld — dan weet de planning niet welke klant in welke reeks zit.
            <button type="button" onClick={() => p.onWeergave('batches')} className="btn-primary text-xs ml-auto">Klantenbatches invullen</button>
          </div>
        ) : reeksen.length > 0 && (
          <section className="card-base p-3 sm:p-4 space-y-3">
            {reeksen.map((r) => { const l = klantenInReeks(r); return (
              <div key={r} className="space-y-1.5">
                <h2 className="text-sm font-semibold flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${REEKSEN[r - 1].kleur}`} />Vandaag in {REEKSEN[r - 1].label} <span className="font-normal text-gray-500">· {l.length} klant{l.length === 1 ? '' : 'en'}</span></h2>
                {l.length === 0 ? <p className="text-xs text-gray-500 pl-4">Geen klanten met een ✓ voor deze reeks deze maand.</p> : (
                  <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {l.map((k) => { const { alle, open } = takenVan(k.id, r); return (
                      <div key={k.id} className="px-2.5 py-2 flex items-start gap-2 flex-wrap">
                        <button type="button" onClick={() => p.onKlant(k.id)} className={`text-sm font-medium text-gray-900 hover:underline min-w-[130px] text-left ${focusRing} rounded`}>{k.naam}</button>
                        <div className="flex-1 min-w-0 flex flex-wrap gap-1">
                          {alle.length === 0 ? <span className="text-xs text-amber-800">nog geen taken klaargezet</span>
                            : open.length === 0 ? <span className="text-xs text-green-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />alles van deze reeks is klaar</span>
                            : open.map((t) => { const s = statusVan(t.status, st); return (
                              <button key={t.id} type="button" onClick={() => p.onTaak(t)} title={`${t.titel} · ${s.label}${t.werkdatum ? ` · ${datumNl(t.werkdatum)}` : ' · nog in te plannen'}`}
                                className={`rounded border px-1.5 py-0.5 text-[11px] leading-tight max-w-full truncate ${s.kleur} ${t.werkdatum === anker ? 'ring-1 ring-black' : ''} ${focusRing}`}>
                                {t.titel}<span className="opacity-70"> · {t.werkdatum ? datumNl(t.werkdatum) : 'in te plannen'}</span>
                              </button>
                            ) })}
                        </div>
                      </div>
                    ) })}
                  </div>
                )}
              </div>
            ) })}
            <div className="flex gap-3 flex-wrap items-center">
              <button type="button" onClick={() => p.onWeergave('batches')} className={`text-xs underline text-gray-600 ${focusRing}`}>Klantenbatches bekijken</button>
              <button type="button" onClick={() => p.onWeergave('reeksen')} className={`text-xs underline text-gray-600 ${focusRing}`}>Reeksen van de maand</button>
              {data.kan.beheren && reeksen.some((r) => klantenInReeks(r).some((k) => takenVan(k.id, r).alle.length === 0)) && <button type="button" onClick={p.onKlaarzetten} className="btn-primary text-xs ml-auto">Taken klaarzetten</button>}
            </div>
          </section>
        )}

        {(p.aanDeBeurt.zonderCyclus > 0 || p.aanDeBeurt.ontbrekend > 0) && data.kan.beheren && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm flex items-center gap-2 flex-wrap">
            <Layers className="h-4 w-4 text-blue-700" />
            {p.aanDeBeurt.zonderCyclus > 0 && <span><b>{p.aanDeBeurt.zonderCyclus}</b> klant(en) in de planning hebben nog geen taken voor {MAANDEN[Number(maand.slice(5)) - 1]}.</span>}
            {p.aanDeBeurt.ontbrekend > 0 && <span className="text-amber-800">{p.aanDeBeurt.ontbrekend} klant(en) missen nog ritme of batch.</span>}
            {p.aanDeBeurt.zonderCyclus > 0 && <button type="button" onClick={p.onKlaarzetten} className="btn-primary text-xs ml-auto">Taken klaarzetten</button>}
          </div>
        )}

        {/* Taken van de dag */}
        <section className="card-base p-3 sm:p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{anker === vandaag ? 'Vandaag' : 'Deze dag'} · {vanDag.filter((t) => !isKlaar(t.status, st)).length} open</h2>
            {p.kanSchrijven && <button type="button" onClick={() => p.onTaak(null, { werkdatum: anker })} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Taak</button>}
          </div>
          {vanDag.length === 0 ? <Leeg>Niets gepland op deze dag. {inTePlannen.length > 0 && 'Plan iets in uit “Nog in te plannen”.'}</Leeg> : (
            <div className="space-y-1.5">
              {vanDag.map((t) => (
                <TaakKaart key={t.id} t={t} klant={p.klantNaam(t.client_id)} statussen={st} vandaag={vandaag} aantalNotities={p.notitiesVan(t.id)}
                  onOpen={() => p.onTaak(t)} onVink={p.kanSchrijven ? () => p.vink(t) : undefined} />
              ))}
            </div>
          )}
        </section>

        {(herinneringen.length > 0 || aandacht.length > 0) && (
          <section className="card-base p-3 sm:p-4 space-y-2">
            <h2 className="font-semibold text-sm">Aandachtspunten</h2>
            {herinneringen.map((n) => (
              <div key={n.id} className="flex items-start gap-2 text-sm">
                {p.kanSchrijven && <button type="button" onClick={() => p.doe('notitie.wijzig', { id: n.id, afgevinkt: true }, { melding: 'Herinnering afgevinkt.' })} className={`mt-0.5 h-4 w-4 shrink-0 rounded border border-gray-400 ${focusRing}`} aria-label="Herinnering afvinken" />}
                <Bell className="h-4 w-4 text-amber-500 shrink-0" />
                <button type="button" onClick={() => n.client_id && p.onKlant(n.client_id)} className={`text-left min-w-0 ${focusRing}`}>
                  <span className="line-clamp-2">{n.tekst}</span>
                  <span className="text-[11px] text-gray-500">{p.klantNaam(n.client_id) ?? 'Algemeen'}{n.herinner_op && n.herinner_op < anker ? ` · sinds ${datumNl(n.herinner_op)}` : ''}</span>
                </button>
              </div>
            ))}
            {aandacht.map((n) => (
              <button key={n.id} type="button" onClick={() => n.client_id && p.onKlant(n.client_id)} className={`w-full text-left flex items-start gap-2 text-sm ${focusRing}`}>
                <StickyNote className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" /><span className="min-w-0"><b className="font-medium">{p.klantNaam(n.client_id)}</b> · <span className="line-clamp-1 inline">{n.tekst}</span></span>
              </button>
            ))}
          </section>
        )}
      </div>

      <div className="space-y-4">
        {/* Achterstallig en nog in te plannen */}
        <section className="card-base p-3 space-y-2">
          <h3 className="font-semibold text-sm flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-orange-600" />Achterstallig · {achter.length}</h3>
          {achter.length === 0 ? <p className="text-xs text-gray-500">Niets achterstallig.</p> : achter.slice(0, 12).map((t) => (
            <TaakKaart key={t.id} compact toonDatum t={t} klant={p.klantNaam(t.client_id)} statussen={st} vandaag={anker} aantalNotities={p.notitiesVan(t.id)} onOpen={() => p.onTaak(t)} onVink={p.kanSchrijven ? () => p.vink(t) : undefined} />
          ))}
          {achter.length > 12 && <p className="text-[11px] text-gray-500">+ {achter.length - 12} meer (zie Week of Maand)</p>}
        </section>
        <section className="card-base p-3 space-y-2">
          <h3 className="font-semibold text-sm flex items-center gap-1.5"><Inbox className="h-4 w-4" />Nog in te plannen · {inTePlannen.length}</h3>
          {inTePlannen.length === 0 ? <p className="text-xs text-gray-500">Alles heeft een werkdatum.</p> : inTePlannen.slice(0, 20).map((t) => (
            <div key={t.id} className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1"><TaakKaart compact t={t} klant={p.klantNaam(t.client_id)} statussen={st} vandaag={anker} aantalNotities={p.notitiesVan(t.id)} onOpen={() => p.onTaak(t)} /></div>
              {p.kanSchrijven && <input type="date" aria-label={`Werkdatum voor ${t.titel}`} className={`${INP} w-[118px] py-1 text-xs`} value={planDatum[t.id] ?? ''} onChange={(e) => { setPlanDatum({ ...planDatum, [t.id]: e.target.value }); if (e.target.value) p.verplaats(t, e.target.value) }} />}
            </div>
          ))}
          {inTePlannen.length > 20 && <p className="text-[11px] text-gray-500">+ {inTePlannen.length - 20} meer (Weekweergave)</p>}
        </section>

        <VasteKlant data={data} doe={p.doe} anker={anker} kanSchrijven={p.kanSchrijven} />
      </div>
    </div>
  )
}

// ── Week ────────────────────────────────────────────────────────────────────
export function WeekWeergave(p: WeergaveProps) {
  const { data, taken, vandaag, anker } = p
  const st = data.instellingen.statussen
  const [weekend, setWeekend] = useState(false)
  const [lade, setLade] = useState(true)
  const ma = maandag(anker)
  const dagen = Array.from({ length: weekend ? 7 : 5 }, (_, i) => plusDagen(ma, i))
  const inTePlannen = taken.filter((t) => !t.werkdatum && !isKlaar(t.status, st))
  const d = useDrop(taken, p.verplaats)
  return (
    <div className="space-y-3">
      <section className={`card-base p-3 ${d.doel === 'geen' ? 'ring-2 ring-black' : ''}`} {...d.props(null)}>
        <button type="button" onClick={() => setLade((x) => !x)} className={`w-full flex items-center justify-between text-sm font-semibold ${focusRing}`} aria-expanded={lade}>
          <span className="inline-flex items-center gap-1.5"><Inbox className="h-4 w-4" />Nog in te plannen · {inTePlannen.length}</span><ChevronDown className={`h-4 w-4 transition-transform ${lade ? '' : '-rotate-90'}`} />
        </button>
        {lade && (inTePlannen.length === 0 ? <p className="text-xs text-gray-500 mt-2">Alles heeft een werkdatum.</p> : (
          <div className="mt-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
            {inTePlannen.map((t) => <TaakKaart key={t.id} compact t={t} klant={p.klantNaam(t.client_id)} statussen={st} vandaag={vandaag} aantalNotities={p.notitiesVan(t.id)} onOpen={() => p.onTaak(t)} sleepbaar={p.kanSchrijven} onSleep={d.sleep(t)} />)}
          </div>
        ))}
        {lade && p.kanSchrijven && <p className="text-[11px] text-gray-500 mt-2">Sleep een taak naar een dag, of open ze en kies een werkdatum.</p>}
      </section>
      <div className="flex justify-end"><label className="text-xs text-gray-600 flex items-center gap-1.5"><input type="checkbox" checked={weekend} onChange={(e) => setWeekend(e.target.checked)} />Weekend tonen</label></div>
      <div className={`grid grid-cols-1 ${weekend ? 'md:grid-cols-7' : 'md:grid-cols-5'} gap-2`}>
        {dagen.map((dag) => {
          const lijst = taken.filter((t) => t.werkdatum === dag)
          const open = lijst.filter((t) => !isKlaar(t.status, st)).length
          return (
            <section key={dag} {...d.props(dag)} className={`card-base p-2 min-h-[120px] md:min-h-[320px] flex flex-col ${dag === vandaag ? 'ring-2 ring-[#fff848]' : ''} ${d.doel === dag ? 'ring-2 ring-black bg-[#fff848]/10' : ''}`}>
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <button type="button" onClick={() => p.onDag(dag)} className={`text-xs font-semibold capitalize ${focusRing} rounded`}>{DAG_KORT[(new Date(`${dag}T12:00:00Z`).getUTCDay() + 6) % 7]} {Number(dag.slice(8))}/{Number(dag.slice(5, 7))}</button>
                <span className="inline-flex items-center gap-1">{isMaandstart(dag) && <MaandstartLabel />}<ReeksStippen r={p.reeksenOp(dag)} /></span>
              </div>
              <div className="text-[10px] text-gray-500 mb-1">{lijst.length ? `${open} open · ${lijst.length} totaal` : ''}</div>
              <div className="space-y-1 flex-1">
                {lijst.map((t) => <TaakKaart key={t.id} compact t={t} klant={p.klantNaam(t.client_id)} statussen={st} vandaag={vandaag} aantalNotities={p.notitiesVan(t.id)} onOpen={() => p.onTaak(t)} onVink={p.kanSchrijven ? () => p.vink(t) : undefined} sleepbaar={p.kanSchrijven} onSleep={d.sleep(t)} />)}
              </div>
              {p.kanSchrijven && <button type="button" onClick={() => p.onTaak(null, { werkdatum: dag })} className={`mt-1 text-[11px] text-gray-500 hover:text-black inline-flex items-center gap-1 ${focusRing} rounded`}><CalendarPlus className="h-3 w-3" />toevoegen</button>}
            </section>
          )
        })}
      </div>
    </div>
  )
}

// ── Maand ───────────────────────────────────────────────────────────────────
export function MaandWeergave(p: WeergaveProps) {
  const { data, taken, vandaag, anker } = p
  const st = data.instellingen.statussen
  const ym = maandVan(anker)
  const start = maandag(`${ym}-01`)
  const cellen = Array.from({ length: 42 }, (_, i) => plusDagen(start, i))
  const d = useDrop(taken, p.verplaats)
  const metTaken = cellen.filter((c) => maandVan(c) === ym && (isMaandstart(c) || taken.some((t) => t.werkdatum === c)))
  return (
    <div className="space-y-2">
      <div className="hidden md:block card-base p-0 overflow-hidden">
        <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-100 text-[11px] font-medium text-gray-500 uppercase">{DAG_KORT.map((x) => <div key={x} className="px-2 py-1.5 text-center">{x}</div>)}</div>
        <div className="grid grid-cols-7">
          {cellen.map((c) => {
            const lijst = taken.filter((t) => t.werkdatum === c)
            const toon = lijst.slice(0, 3), meer = lijst.length - toon.length
            const inMaand = maandVan(c) === ym
            const r = p.reeksenOp(c)
            return (
              <div key={c} {...d.props(c)} className={`min-h-[110px] border-b border-r border-gray-100 p-1 flex flex-col ${inMaand ? 'bg-white' : 'bg-gray-50/70'} ${c === vandaag ? 'ring-2 ring-inset ring-[#fff848]' : ''} ${d.doel === c ? 'ring-2 ring-inset ring-black' : ''}`}>
                <div className="flex gap-0.5 mb-0.5">{r.map((n) => <span key={n} className={`h-1 flex-1 rounded-full ${REEKSEN[n - 1].kleur} opacity-60`} title={REEKSEN[n - 1].label} />)}</div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1"><button type="button" onClick={() => p.onDag(c)} className={`text-xs font-medium ${inMaand ? 'text-gray-800' : 'text-gray-400'} ${focusRing} rounded px-0.5`}>{Number(c.slice(8))}</button>{inMaand && isMaandstart(c) && <MaandstartLabel />}</span>
                  {p.kanSchrijven && inMaand && <button type="button" onClick={() => p.onTaak(null, { werkdatum: c })} className={`text-gray-300 hover:text-black ${focusRing} rounded`} aria-label={`Taak toevoegen op ${c}`}><Plus className="h-3 w-3" /></button>}
                </div>
                <div className="space-y-0.5 mt-0.5">
                  {toon.map((t) => {
                    const s = statusVan(t.status, st)
                    return (
                      <button key={t.id} type="button" draggable={p.kanSchrijven} onDragStart={d.sleep(t)} onClick={() => p.onTaak(t)} title={`${p.klantNaam(t.client_id) ?? ''} · ${t.titel} · ${s.label}`}
                        className={`w-full text-left truncate rounded border px-1 py-0.5 text-[10.5px] leading-tight ${s.kleur} ${isAchterstallig(t, vandaag, st) ? 'ring-1 ring-orange-400' : ''} ${focusRing}`}>
                        {p.klantNaam(t.client_id) ? `${p.klantNaam(t.client_id)} · ` : ''}{t.titel}
                      </button>
                    )
                  })}
                  {meer > 0 && <button type="button" onClick={() => p.onDag(c)} className={`text-[10.5px] text-gray-600 hover:text-black px-1 ${focusRing} rounded`}>+ {meer} meer</button>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-3 flex-wrap px-3 py-2 text-[11px] text-gray-500 border-t border-gray-100">{REEKSEN.map((r) => <span key={r.nr} className="inline-flex items-center gap-1"><span className={`h-1.5 w-3 rounded-full ${r.kleur}`} />{r.label}</span>)}<span>· sleep een taak naar een andere dag: de werkdatum wijzigt, de deadline blijft</span></div>
      </div>
      {/* Telefoon: agenda */}
      <div className="md:hidden space-y-2">
        {metTaken.length === 0 && <Leeg>Geen taken met een werkdatum in deze maand.</Leeg>}
        {metTaken.map((c) => (
          <section key={c} className="card-base p-2.5">
            <button type="button" onClick={() => p.onDag(c)} className={`w-full flex items-center justify-between text-sm font-semibold mb-1.5 ${focusRing}`}><span className="capitalize">{DAG_KORT[(new Date(`${c}T12:00:00Z`).getUTCDay() + 6) % 7]} {Number(c.slice(8))} {MAANDEN[Number(c.slice(5, 7)) - 1]}</span><span className="inline-flex items-center gap-1">{isMaandstart(c) && <MaandstartLabel />}<ReeksStippen r={p.reeksenOp(c)} /></span></button>
            <div className="space-y-1">{taken.filter((t) => t.werkdatum === c).map((t) => <TaakKaart key={t.id} t={t} klant={p.klantNaam(t.client_id)} statussen={st} vandaag={vandaag} aantalNotities={p.notitiesVan(t.id)} onOpen={() => p.onTaak(t)} onVink={p.kanSchrijven ? () => p.vink(t) : undefined} />)}</div>
          </section>
        ))}
      </div>
    </div>
  )
}

// ── Klantenbord ─────────────────────────────────────────────────────────────
export function Klantenbord(p: WeergaveProps & { klantFilter: (id: string) => boolean; onKlaarzetten: () => void }) {
  const { data, vandaag, anker } = p
  const st = data.instellingen.statussen
  const maand = maandVan(anker)
  const [modus, setModus] = useState<string>('batch')
  const [sleepKlant, setSleepKlant] = useState<string | null>(null)
  const [doel, setDoel] = useState<string | null>(null)
  const [toevoegen, setToevoegen] = useState('')
  const actief = data.cpKlanten.filter((k) => k.actief && p.klantFilter(k.client_id))
  const klanten = new Map(data.klanten.map((k) => [k.id, k]))
  const onderdelen = data.instellingen.onderdelen.filter((o) => o.actief)
  const cyclusVan = (cid: string) => data.cycli.find((c) => c.client_id === cid && c.maand === maand)
  const takenVan = useMemo(() => {
    const m = new Map<string, Taak[]>()
    for (const t of data.taken) { if (!t.cyclus_id) continue; const c = data.cycli.find((x) => x.id === t.cyclus_id); if (!c || c.maand !== maand) continue; const l = m.get(c.client_id) ?? []; l.push(t); m.set(c.client_id, l) }
    return m
  }, [data.taken, data.cycli, maand])
  const nietInPlanning = data.klanten.filter((k) => !data.cpKlanten.some((c) => c.client_id === k.id && c.actief))

  const kaart = (cid: string) => {
    const k = klanten.get(cid); const cp = data.cpKlanten.find((x) => x.client_id === cid)!
    const cyc = cyclusVan(cid)
    const tk = (takenVan.get(cid) ?? []).sort((a, b) => a.volgorde - b.volgorde)
    const open = tk.filter((t) => !isKlaar(t.status, st))
    const volgende = [...open].sort((a, b) => (a.werkdatum ?? '9999').localeCompare(b.werkdatum ?? '9999'))[0]
    const laat = open.some((t) => isAchterstallig(t, vandaag, st))
    const wacht = open.some((t) => t.status === 'wacht_op_klant')
    const batch = data.batches.find((b) => b.id === k?.batch_id)
    const ritme = (cyc?.instellingen.ritme ?? cp.ritme) as string | null
    const nNot = data.notities.filter((n) => n.client_id === cid && !n.taak_id).length
    return (
      <div key={cid} draggable={data.kan.beheren} onDragStart={(e) => { setSleepKlant(cid); e.dataTransfer.setData('text/plain', cid) }} onDragEnd={() => setSleepKlant(null)}
        className={`rounded-xl border bg-white p-2.5 space-y-1.5 ${laat ? 'border-orange-400' : 'border-gray-200'} ${data.kan.beheren ? 'cursor-grab' : ''}`}>
        <button type="button" onClick={() => p.onKlant(cid)} className={`w-full text-left ${focusRing} rounded`}>
          <div className="flex items-center justify-between gap-1"><span className="font-semibold text-sm truncate">{k?.company_name ?? '—'}</span>{nNot > 0 && <StickyNote className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-label="heeft notities" />}</div>
          <div className="text-[11px] text-gray-500">{ritme ? (ritme === 'maandelijks' ? 'Maandelijks' : 'Driemaandelijks') : <span className="text-amber-700">ritme in te vullen</span>} · {batch ? batch.name : <span className="text-amber-700">geen batch</span>}{cyc && cyc.status !== 'actief' ? ` · ${cyc.status}` : ''}</div>
        </button>
        {cyc ? (
          <>
            <div className="text-xs">{volgende ? <><span className="text-gray-500">Volgende:</span> <b className="font-medium">{volgende.titel}</b> <span className="text-gray-500">{volgende.werkdatum ? datumNl(volgende.werkdatum) : '· nog in te plannen'}</span></> : <span className="text-[#166534] font-medium inline-flex items-center gap-1"><Check className="h-3 w-3" />Alles afgerond</span>}</div>
            <div className="flex gap-0.5 flex-wrap" aria-label="Voortgang per onderdeel">
              {onderdelen.map((o) => { const t = tk.find((x) => x.onderdeel === o.key); const s = t ? statusVan(t.status, st) : null; return <span key={o.key} title={`${o.label}: ${s ? s.label : 'geen taak'}`} className={`h-2.5 w-5 rounded-sm border ${s ? s.kleur : 'bg-transparent border-dashed border-gray-200'}`} /> })}
            </div>
            {(laat || wacht) && <div className="text-[11px] flex gap-2">{laat && <span className="text-orange-700 font-semibold inline-flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" />over tijd</span>}{wacht && <span className="text-purple-800">wacht op klant</span>}</div>}
          </>
        ) : <div className="text-[11px] text-gray-500">Nog geen taken voor deze maand.</div>}
      </div>
    )
  }

  // Kolommen: per batch (standaard), of per status voor één onderdeel.
  const opOnderdeel = modus !== 'batch' ? modus : null
  const kolommen: { key: string; titel: string; kleur?: string; klanten: string[] }[] = opOnderdeel
    ? [...st.map((s) => ({ key: s.key, titel: s.label, klanten: actief.filter((k) => (takenVan.get(k.client_id) ?? []).find((t) => t.onderdeel === opOnderdeel)?.status === s.key).map((k) => k.client_id) })),
       { key: '__geen', titel: 'Geen taak deze maand', klanten: actief.filter((k) => !(takenVan.get(k.client_id) ?? []).some((t) => t.onderdeel === opOnderdeel)).map((k) => k.client_id) }]
    : [...data.batches.map((b) => ({ key: b.id, titel: b.name, kleur: b.color, klanten: actief.filter((k) => klanten.get(k.client_id)?.batch_id === b.id).map((k) => k.client_id) })),
       { key: '__geen', titel: 'Geen batch', klanten: actief.filter((k) => !klanten.get(k.client_id)?.batch_id).map((k) => k.client_id) }]

  const drop = async (kolom: string) => {
    setDoel(null)
    const cid = sleepKlant; setSleepKlant(null)
    if (!cid || !data.kan.beheren && !opOnderdeel) return
    if (!opOnderdeel) { await p.doe('klant.wijzig', { client_id: cid, batch_id: kolom === '__geen' ? null : kolom }, { melding: 'Batch aangepast.' }); return }
    const t = (takenVan.get(cid) ?? []).find((x) => x.onderdeel === opOnderdeel)
    if (!t || kolom === '__geen') return
    await p.doe('taak.wijzig', { id: t.id, status: kolom }, { melding: 'Status aangepast.' })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-gray-600">Groeperen op</label>
        <select className={`${INP} w-auto py-1.5 text-sm`} value={modus} onChange={(e) => setModus(e.target.value)}>
          <option value="batch">Batch</option>
          {onderdelen.map((o) => <option key={o.key} value={o.key}>Status · {o.label}</option>)}
        </select>
        <div className="flex-1" />
        {data.kan.beheren && (
          <div className="flex items-center gap-1.5">
            <select className={`${INP} w-auto py-1.5 text-sm`} value={toevoegen} onChange={(e) => setToevoegen(e.target.value)} aria-label="Klant aan de planning toevoegen"><option value="">Klant toevoegen…</option>{nietInPlanning.map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}</select>
            <button type="button" disabled={!toevoegen} onClick={async () => { if (await p.doe('klant.voegtoe', { client_id: toevoegen }, { melding: 'Toegevoegd aan de contentplanning.' })) { const id = toevoegen; setToevoegen(''); p.onKlant(id) } }} className="btn-secondary text-sm"><Plus className="h-4 w-4" /></button>
            <button type="button" onClick={p.onKlaarzetten} className="btn-secondary text-sm" title="Maakt de taken aan voor wie deze maand aan de beurt is; bestaande of verwijderde taken blijven ongemoeid">Taken klaarzetten</button>
          </div>
        )}
      </div>
      {actief.length === 0 ? <Leeg>Nog geen klanten in de contentplanning. {data.kan.beheren ? 'Voeg er een toe via “Klant toevoegen”.' : ''}</Leeg> : (
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
          {kolommen.map((k) => (
            <section key={k.key} onDragOver={(e) => { e.preventDefault(); setDoel(k.key) }} onDragLeave={() => setDoel(null)} onDrop={(e) => { e.preventDefault(); drop(k.key) }}
              className={`snap-start shrink-0 w-[260px] rounded-2xl bg-gray-50 border p-2 space-y-2 ${doel === k.key ? 'border-black ring-2 ring-black' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between px-1">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">{k.kleur && <span className="h-2.5 w-2.5 rounded-full" style={{ background: k.kleur }} />}{k.titel} <span className="text-gray-400 font-normal">{k.klanten.length}</span></h3>
                {!opOnderdeel && k.key !== '__geen' && <button type="button" onClick={() => p.onNotities({ batch_id: k.key, soort: 'afspraak', titel: `Notities · ${k.titel}` })} className={`text-gray-400 hover:text-black ${focusRing} rounded`} aria-label={`Notities bij ${k.titel}`}><StickyNote className="h-3.5 w-3.5" /></button>}
              </div>
              {k.klanten.length === 0 ? <p className="text-[11px] text-gray-400 px-1">—</p> : k.klanten.map(kaart)}
            </section>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-500">Sleep een kaart naar een andere {opOnderdeel ? 'status' : 'batch'}{opOnderdeel ? '' : ' (of kies de batch in de klantfiche)'}. Een statuswijziging rondt andere onderdelen nooit automatisch af.</p>
    </div>
  )
}

export { StatusBadge }
