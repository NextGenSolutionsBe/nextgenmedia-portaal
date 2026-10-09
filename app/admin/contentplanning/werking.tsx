'use client'

import { useMemo, useState } from 'react'
import { BookOpen, Check, ChevronDown, ExternalLink, Flag, Layers, Pencil, Route, CalendarClock, AlertTriangle, Loader2 } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import {
  REEKSEN, MAANDSTART, DAG_KORT, eersteWerkdag, faseplanVanMaand, reeksPeriodes, leesWerkwijze, maandag, maandVan, plusDagen, plusMaanden, weekdagNr, werkdagenVanMaand,
  type Reeks,
} from '@/lib/contentplanning/model'
import { Paneel, focusRing } from './bouwstenen'
import type { BordCel, CpData, Doe, Weergave } from './types'
import { MAANDEN, datumLang, datumNl, maandNaam } from './types'

/**
 * Dagelijkse werking (stap 3) — Chiara’s werkscherm. Per dag de reeks(en) met
 * hun kleur en ALLE klanten die deze maand in die reeks zitten (uit
 * Klantenbatches), om zelf te kiezen wie je vandaag doet en af te vinken.
 * De werkwijze per reeks zit achter een knop; vaste momenten (maandstart,
 * start reeks 2, meetings plannen bij reeks 3) verschijnen vanzelf.
 * Het afvinken geldt per klant, maand en reeks; de dag van afvinken wordt bewaard.
 */

export type WerkModus = 'dag' | 'week' | 'maand'
type Props = {
  data: CpData; anker: string; vandaag: string; doe: Doe; modus: WerkModus
  setModus: (m: WerkModus) => void; onDag: (d: string) => void; onKlant: (id: string) => void; onWeergave: (w: Weergave) => void
  reeksenOp: (d: string) => Reeks[]; klantNaam: (id: string | null) => string | null
}

const MEETING_LABEL = { nodig: 'Meeting nodig', ingepland: 'Ingepland', niet_nodig: 'Niet nodig' } as const
type MeetingStatus = keyof typeof MEETING_LABEL
const MAAND_KORT = (ym: string) => MAANDEN[Number(ym.slice(5, 7)) - 1]

// ── Afgeleide gegevens, gedeeld door de drie modi ───────────────────────────
function useWerk(data: CpData) {
  const verborgen = useMemo(() => new Set(data.instellingen.bord_verborgen), [data.instellingen.bord_verborgen])
  const naam = useMemo(() => new Map(data.klanten.map((k) => [k.id, k.company_name])), [data.klanten])
  const periodeCache = useMemo(() => new Map<string, ReturnType<typeof reeksPeriodes>>(), [data])
  const periodes = (ym: string) => {
    if (!periodeCache.has(ym)) periodeCache.set(ym, reeksPeriodes(ym, faseplanVanMaand(ym, data.faseAanpassingen), data.instellingen.fase_reeks))
    return periodeCache.get(ym)!
  }
  /** ✓-cellen van een maand (klant zit in die reeks), gesorteerd op naam. */
  const cellen = (ym: string, r?: Reeks): BordCel[] => data.bord
    .filter((c) => c.maand === ym && c.actief && !verborgen.has(c.client_id) && (r === undefined || c.reeks === r) && naam.has(c.client_id))
    .sort((a, b) => (naam.get(a.client_id) ?? '').localeCompare(naam.get(b.client_id) ?? '', 'nl'))
  const socialKlanten = data.klanten.filter((k) => data.socialKlanten.includes(k.id) && !verborgen.has(k.id))
  return { verborgen, naam, periodes, cellen, socialKlanten }
}

// ── Werkwijze (stappenplan) tonen ───────────────────────────────────────────
export function WerkwijzeTekst({ tekst, compact }: { tekst: string; compact?: boolean }) {
  const w = leesWerkwijze(tekst)
  if (!w.stappen.length && !w.letOp.length && !w.intro.length) return <p className="text-xs text-gray-500">Nog geen werkwijze ingevuld.</p>
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {w.letOp.map((l) => <div key={l} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 flex items-start gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{l}</div>)}
      {w.intro.map((l) => <p key={l} className="text-sm text-gray-700">{l}</p>)}
      <ol className="divide-y divide-gray-100">
        {w.stappen.map((s, i) => (
          <li key={`${i}-${s.titel}`} className={`flex gap-3 ${compact ? 'py-1.5' : 'py-2.5'}`}>
            <span className="text-sm font-semibold text-gray-400 w-4 shrink-0 tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1 space-y-1">
              {s.titel && <div className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">{s.titel}{s.badge && <span className="rounded-full bg-gray-100 border border-gray-200 px-2 py-0 text-[11px] font-normal text-gray-600">{s.badge}</span>}</div>}
              {s.punten.length > 0 && <ul className="space-y-0.5">{s.punten.map((p) => <li key={p} className="text-[13px] text-gray-600 flex gap-1.5"><span className="text-gray-300">•</span><Linkjes tekst={p} /></li>)}</ul>}
              {s.blokken.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-2 pt-1">
                  {s.blokken.map((b) => (
                    <div key={b.titel} className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                      <div className="text-xs font-semibold text-gray-800">{b.titel}</div>
                      <ul className="mt-0.5 space-y-0.5">{b.punten.map((p) => <li key={p} className="text-[12px] text-gray-600 flex gap-1.5"><span className="text-gray-300">•</span><Linkjes tekst={p} /></li>)}</ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Tekst met klikbare http(s)-links. */
function Linkjes({ tekst }: { tekst: string }) {
  const delen = tekst.split(/(https?:\/\/[^\s]+)/g)
  return <span className="min-w-0 break-words">{delen.map((d, i) => (/^https?:\/\//.test(d) ? <a key={i} href={d} target="_blank" rel="noreferrer" className="underline text-blue-700 break-all">{d}</a> : <span key={i}>{d}</span>))}</span>
}

const FORMAAT_HULP = '# Stap [badge] · ## Deelblok · - punt · ! let op'

/** Zijpaneel met de werkwijze van een reeks; beheerders kunnen de tekst aanpassen. Reeks 2 toont ook waar het materiaal per klant staat. */
function WerkwijzePaneel({ r, data, doe, maand, onKlant, onSluit }: { r: Reeks; data: CpData; doe: Doe; maand: string; onKlant: (id: string) => void; onSluit: () => void }) {
  const tekst = data.instellingen.reeks_detail[String(r)] ?? ''
  const [bewerk, setBewerk] = useState(false)
  const [concept, setConcept] = useState(tekst)
  const [bezig, setBezig] = useState(false)
  const w = useWerk(data)
  const inReeks = new Set(w.cellen(maand, r).map((c) => c.client_id))
  const materiaal = data.cpKlanten
    .filter((k) => k.actief && !w.verborgen.has(k.client_id) && w.naam.has(k.client_id))
    .sort((a, b) => Number(inReeks.has(b.client_id)) - Number(inReeks.has(a.client_id)) || (w.naam.get(a.client_id) ?? '').localeCompare(w.naam.get(b.client_id) ?? '', 'nl'))
  const info = REEKSEN[r - 1]
  return (
    <Paneel breed titel={<span className="inline-flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${info.kleur}`} />Werkwijze · {info.label}</span>} sub="Je stappenplan voor deze reeks." onSluit={onSluit}>
      {bewerk ? (
        <div className="space-y-2">
          <textarea className={`${INP} font-mono text-xs`} rows={22} value={concept} onChange={(e) => setConcept(e.target.value)} aria-label="Werkwijze bewerken" />
          <p className="text-[11px] text-gray-500">Opmaak: {FORMAAT_HULP}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setConcept(tekst); setBewerk(false) }} className="btn-secondary text-sm">Annuleren</button>
            <button type="button" disabled={bezig} onClick={async () => { setBezig(true); const ok = await doe('werkwijze.opslaan', { reeks: r, tekst: concept }, { melding: 'Werkwijze bewaard.' }); setBezig(false); if (ok) setBewerk(false) }} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
          </div>
        </div>
      ) : (
        <>
          <WerkwijzeTekst tekst={tekst} />
          {data.kan.beheren && <button type="button" onClick={() => { setConcept(tekst); setBewerk(true) }} className={`btn-secondary text-xs ${focusRing}`}><Pencil className="h-3.5 w-3.5" />Werkwijze aanpassen</button>}
        </>
      )}
      {r === 2 && (
        <section className="space-y-2 border-t border-gray-100 pt-4">
          <h4 className="text-sm font-semibold">Materiaal per klant — waar staan de foto’s en video’s?</h4>
          <p className="text-[11px] text-gray-500">Klanten in reeks 2 van {maandNaam(maand)} staan bovenaan. Aanpassen in de klantfiche.</p>
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {materiaal.map((k) => (
              <div key={k.client_id} className="px-3 py-2 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium flex items-center gap-1.5">{w.naam.get(k.client_id)}{inReeks.has(k.client_id) && <span className={`h-2 w-2 rounded-full ${info.kleur}`} title="Deze maand in reeks 2" />}</div>
                  {k.materiaal ? <div className="text-[12px] text-gray-600 whitespace-pre-line"><Linkjes tekst={k.materiaal} /></div> : <div className="text-[12px] text-gray-400">Nog niet ingevuld.</div>}
                </div>
                <button type="button" onClick={() => onKlant(k.client_id)} className={`text-xs underline text-gray-600 shrink-0 ${focusRing}`}>{data.kan.beheren ? 'aanpassen' : 'klantfiche'}</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </Paneel>
  )
}

// ── Maandstart (eerste werkdag van elke maand) ──────────────────────────────
export function MaandstartBlok({ data, doe, anker, kanSchrijven, onWeergave }: { data: CpData; doe: Doe; anker: string; kanSchrijven: boolean; onWeergave: (w: Weergave) => void }) {
  const maand = maandVan(anker)
  const eerste = eersteWerkdag(maand)
  const klaar = (key: string) => data.checks.some((c) => c.routine_key === key && c.datum === eerste)
  if (anker < eerste || (anker !== eerste && MAANDSTART.every((m) => klaar(m.key)))) return null
  const ingevuld = new Set(data.bord.filter((c) => c.maand === maand && c.actief).map((c) => c.client_id)).size
  return (
    <section className={`rounded-xl border p-3 space-y-2 ${anker === eerste ? 'border-black bg-[#fff848]/30' : 'border-amber-300 bg-amber-50'}`}>
      <h2 className="font-semibold text-sm flex items-center gap-1.5"><Flag className="h-4 w-4" />{anker === eerste ? `Maandstart ${MAAND_KORT(maand)} — eerste werkdag` : `Maandstart ${MAAND_KORT(maand)} nog niet afgerond (was ${datumNl(eerste)})`}</h2>
      {MAANDSTART.map((m, i) => {
        const aan = klaar(m.key)
        const door = data.checks.find((c) => c.routine_key === m.key && c.datum === eerste)?.door
        return (
          <div key={m.key} className="flex items-center gap-2 flex-wrap text-sm">
            <input type="checkbox" className="h-4 w-4" checked={aan} disabled={!kanSchrijven} aria-label={`${m.titel} afvinken`}
              onChange={(e) => doe('routine.check', { routine_key: m.key, datum: eerste, aan: e.target.checked }, { stil: true })} />
            <span className={aan ? 'line-through text-gray-500' : ''}>Stap {i + 1} · {m.titel}{aan && door && <span className="text-[11px] text-gray-400"> · {door}</span>}</span>
            {m.key === 'maandstart_batches' && <span className="text-[11px] text-gray-500">({ingevuld} klant(en) met een ✓)</span>}
            <button type="button" onClick={() => onWeergave(m.weergave)} className={`btn-secondary text-xs ml-auto ${focusRing}`}>{m.weergave === 'batches' ? <Layers className="h-3.5 w-3.5" /> : <Route className="h-3.5 w-3.5" />}Openen</button>
          </div>
        )
      })}
      {data.kan.beheren && <p className="text-[11px] text-gray-600">Daarna: “Taken klaarzetten” maakt de taken van de reeksen met een ✓.</p>}
    </section>
  )
}

// ── Vaste klant met weektaken (INN · SLL · K · J) ───────────────────────────
export function VasteKlant({ data, doe, anker, kanSchrijven }: { data: CpData; doe: Doe; anker: string; kanSchrijven: boolean }) {
  const inst = data.instellingen
  const week = maandag(anker)
  const [open, setOpen] = useState<string | null>(null)
  if (!inst.vaste_taken.length) return null
  return (
    <section className="card-base p-3 space-y-2">
      <div>
        <h3 className="font-semibold text-sm">{inst.vaste_naam}</h3>
        <p className="text-[11px] text-gray-500">{inst.vaste_sub ? `${inst.vaste_sub} · ` : ''}week van {datumNl(week)}</p>
      </div>
      {inst.vaste_taken.map((t) => {
        const check = data.checks.find((c) => c.routine_key === t.key && c.datum === week)
        return (
          <div key={t.key} className="rounded-lg border border-gray-100">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <input type="checkbox" className="h-4 w-4 shrink-0" checked={!!check} disabled={!kanSchrijven} aria-label={`${t.titel} afvinken voor deze week`}
                onChange={(e) => doe('routine.check', { routine_key: t.key, datum: week, aan: e.target.checked }, { stil: true })} />
              <span className={`text-sm flex-1 min-w-0 ${check ? 'line-through text-gray-500' : ''}`}>{t.titel}{check?.door && <span className="text-[11px] text-gray-400 no-underline"> · {check.door}</span>}</span>
              <button type="button" onClick={() => setOpen(open === t.key ? null : t.key)} aria-expanded={open === t.key} className={`text-[11px] text-gray-600 inline-flex items-center gap-0.5 ${focusRing} rounded`}>details<ChevronDown className={`h-3 w-3 transition-transform ${open === t.key ? '' : '-rotate-90'}`} /></button>
            </div>
            {open === t.key && <div className="border-t border-gray-100 px-3 py-2"><WerkwijzeTekst tekst={t.detail} compact /></div>}
          </div>
        )
      })}
      <div className="flex gap-1.5 flex-wrap pt-1">{inst.routine_links.filter((l) => /^https?:\/\//.test(l.url)).map((l) => <a key={l.label + l.url} href={l.url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs hover:border-gray-400 ${focusRing}`}><ExternalLink className="h-3 w-3" />{l.label}</a>)}</div>
      <p className="text-[10px] text-gray-400">Per week afvinken. De app leest Notion en Metricool niet uit; je registreert je controle zelf.</p>
    </section>
  )
}

// ── Klanten van één reeks: zelf kiezen en afvinken ─────────────────────────
function ReeksKaart({ r, maand, data, doe, datum, kanSchrijven, onWerkwijze, onKlant, klein }: {
  r: Reeks; maand: string; data: CpData; doe: Doe; datum: string; kanSchrijven: boolean; onWerkwijze: () => void; onKlant: (id: string) => void; klein?: boolean
}) {
  const w = useWerk(data)
  const lijst = w.cellen(maand, r)
  const open = lijst.filter((c) => !c.afgewerkt_op), klaar = lijst.filter((c) => c.afgewerkt_op)
  const p = w.periodes(maand)[r]
  const info = REEKSEN[r - 1]
  const vink = (c: BordCel, gedaan: boolean) => doe('reeksvink.zet', { client_id: c.client_id, maand, reeks: r, gedaan, datum }, { stil: true })
  return (
    <section className="card-base p-0 overflow-hidden">
      <div className={`px-3 py-2.5 ${info.zacht} border-b border-gray-200 flex items-center gap-2 flex-wrap`}>
        <span className={`h-3 w-3 rounded-full ${info.kleur}`} />
        <div className="min-w-0">
          <h2 className="font-semibold text-sm">{info.label}</h2>
          <p className="text-[11px] text-gray-600">{p ? `${datumNl(p.van)} – ${datumNl(p.tot)} · ` : ''}{klaar.length} van {lijst.length} klanten klaar</p>
        </div>
        <div className="flex-1" />
        <button type="button" onClick={onWerkwijze} className={`btn-secondary text-xs bg-white ${focusRing}`}><BookOpen className="h-3.5 w-3.5" />Werkwijze</button>
      </div>
      {lijst.length > 0 && <div className="h-1 bg-gray-100"><div className={`h-1 ${info.kleur}`} style={{ width: `${Math.round((klaar.length / lijst.length) * 100)}%` }} /></div>}
      {lijst.length === 0 ? <p className="px-3 py-3 text-xs text-gray-500">Geen klanten met een ✓ voor deze reeks in {maandNaam(maand)}.</p> : (
        <ul className={`divide-y divide-gray-100 ${klein ? 'max-h-72 overflow-y-auto' : ''}`}>
          {[...open, ...klaar].map((c) => (
            <li key={c.client_id} className="flex items-center gap-2.5 px-3 py-2">
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#166534]" checked={!!c.afgewerkt_op} disabled={!kanSchrijven}
                aria-label={`${w.naam.get(c.client_id)}: ${info.label} ${c.afgewerkt_op ? 'weer open zetten' : 'afvinken'}`} onChange={(e) => vink(c, e.target.checked)} />
              <button type="button" onClick={() => onKlant(c.client_id)} className={`text-sm text-left min-w-0 flex-1 truncate ${c.afgewerkt_op ? 'line-through text-gray-500' : 'font-medium text-gray-900'} ${focusRing} rounded`}>{w.naam.get(c.client_id)}</button>
              {c.afgewerkt_op && <span className="text-[11px] text-gray-500 shrink-0">{datumNl(c.afgewerkt_op)}{c.afgewerkt_door ? ` · ${c.afgewerkt_door}` : ''}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Reeks 3: meetings voor volgende maand ──────────────────────────────────
function MeetingPlanning({ data, doe, maand, kanSchrijven, vanaf, onKlant }: { data: CpData; doe: Doe; maand: string; kanSchrijven: boolean; vanaf: string | null; onKlant: (id: string) => void }) {
  const w = useWerk(data)
  const volgende = plusMaanden(maand, 1)
  const status = new Map(data.meetings.filter((m) => m.maand === volgende).map((m) => [m.client_id, m]))
  const klanten = [...w.socialKlanten].sort((a, b) => a.company_name.localeCompare(b.company_name, 'nl'))
  const beslist = klanten.filter((k) => { const s = status.get(k.id)?.status; return s === 'niet_nodig' || s === 'ingepland' }).length
  const zet = (cid: string, s: MeetingStatus) => doe('meetingplan.zet', { client_id: cid, maand: volgende, status: status.get(cid)?.status === s ? null : s }, { stil: true })
  return (
    <section className="rounded-xl border border-green-300 bg-green-50/50 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarClock className="h-4 w-4 text-green-800" />
        <h2 className="font-semibold text-sm">Meetings voor {MAAND_KORT(volgende)} inplannen</h2>
        <span className="text-[11px] text-gray-600">· {beslist} van {klanten.length} klanten afgehandeld{vanaf ? ` · eerste dag reeks 3: ${datumNl(vanaf)}` : ''}</span>
      </div>
      <p className="text-[11px] text-gray-600">Alle socialmediaklanten, niet enkel die van deze maand. Per klant: is er een meeting nodig? Stuur zelf de link en de mail; de app mailt niets.</p>
      <ul className="divide-y divide-green-100 rounded-lg border border-green-100 bg-white">
        {klanten.map((k) => {
          const s = status.get(k.id)
          return (
            <li key={k.id} className="px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => onKlant(k.id)} className={`text-sm font-medium text-left min-w-[140px] flex-1 truncate ${focusRing} rounded`}>{k.company_name}</button>
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden" role="group" aria-label={`Meeting ${k.company_name}`}>
                {(['nodig', 'ingepland', 'niet_nodig'] as MeetingStatus[]).map((x) => (
                  <button key={x} type="button" disabled={!kanSchrijven} aria-pressed={s?.status === x} onClick={() => zet(k.id, x)}
                    className={`px-2 py-1 text-[11px] font-medium border-l first:border-l-0 border-gray-200 ${s?.status === x ? (x === 'nodig' ? 'bg-amber-500 text-white' : x === 'ingepland' ? 'bg-[#166534] text-white' : 'bg-gray-600 text-white') : 'bg-white text-gray-700 hover:bg-gray-50'} ${focusRing}`}>{MEETING_LABEL[x]}</button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Het werkscherm ──────────────────────────────────────────────────────────
export function DagelijkseWerking(p: Props) {
  const { data, anker, vandaag, doe, modus } = p
  const [werkwijze, setWerkwijze] = useState<{ r: Reeks; maand: string } | null>(null)
  const kanSchrijven = data.kan.aanpassen || data.kan.beheren
  const w = useWerk(data)
  const maand = maandVan(anker)
  const open = (r: Reeks, m = maand) => setWerkwijze({ r, maand: m })
  const kaart = (r: Reeks, m: string, datum: string, klein?: boolean) => (
    <ReeksKaart key={`${m}-${r}`} r={r} maand={m} data={data} doe={doe} datum={datum} kanSchrijven={kanSchrijven} onWerkwijze={() => open(r, m)} onKlant={p.onKlant} klein={klein} />
  )
  /** Markeringen van een dag: maandstart, start reeks 2, meetings plannen (eerste dag reeks 3). */
  const markers = (d: string) => {
    const m = maandVan(d), per = w.periodes(m), uit: { label: string; kleur: string }[] = []
    if (d === eersteWerkdag(m)) uit.push({ label: 'Maandstart', kleur: 'bg-black text-white' })
    if (per[2]?.van === d) uit.push({ label: 'Start reeks 2', kleur: 'bg-purple-600 text-white' })
    if (per[3]?.van === d) uit.push({ label: 'Meetings plannen', kleur: 'bg-green-700 text-white' })
    return uit
  }
  const Markers = ({ d }: { d: string }) => <>{markers(d).map((x) => <span key={x.label} className={`rounded px-1 text-[9px] font-semibold uppercase leading-4 ${x.kleur}`}>{x.label}</span>)}</>

  const paneel = werkwijze && <WerkwijzePaneel r={werkwijze.r} maand={werkwijze.maand} data={data} doe={doe} onKlant={(id) => { setWerkwijze(null); p.onKlant(id) }} onSluit={() => setWerkwijze(null)} />
  const schakelaar = (
    <div role="tablist" aria-label="Periode" className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
      {(['dag', 'week', 'maand'] as WerkModus[]).map((m) => (
        <button key={m} role="tab" type="button" aria-selected={modus === m} onClick={() => p.setModus(m)} className={`px-3 py-1 rounded-lg text-sm font-medium capitalize ${modus === m ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'} ${focusRing}`}>{m}</button>
      ))}
    </div>
  )
  const bordLeeg = w.cellen(maand).length === 0
  const bordMelding = bordLeeg && (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-center gap-2 flex-wrap">
      <Layers className="h-4 w-4" />Klantenbatches voor {MAAND_KORT(maand)} is nog niet ingevuld — dan weet de app niet welke klanten in welke reeks zitten.
      <button type="button" onClick={() => p.onWeergave('batches')} className="btn-primary text-xs ml-auto">Klantenbatches invullen</button>
    </div>
  )

  // ── Dag ──
  if (modus === 'dag') {
    const reeksen = p.reeksenOp(anker)
    const per = w.periodes(maand)
    const datum = anker < vandaag ? anker : vandaag
    const r3van = per[3]?.van ?? null
    const meetingsOpen = (() => {
      const st = new Map(data.meetings.filter((m) => m.maand === plusMaanden(maand, 1)).map((m) => [m.client_id, m.status]))
      return w.socialKlanten.some((k) => { const s = st.get(k.id); return s !== 'niet_nodig' && s !== 'ingepland' })
    })()
    const toonMeetings = !!r3van && anker >= r3van && (anker === r3van || meetingsOpen)
    const overige = REEKSEN.map((r) => r.nr).filter((r) => !reeksen.includes(r) && w.cellen(maand, r).length > 0)
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">{schakelaar}</div>
        <div className="grid lg:grid-cols-[1fr_330px] gap-4">
          <div className="space-y-3 min-w-0">
            <div className="card-base p-3 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold capitalize mr-1">{datumLang(anker)}</span>
              {reeksen.length ? reeksen.map((r) => (
                <button key={r} type="button" onClick={() => open(r)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${REEKSEN[r - 1].zacht} border border-gray-200 hover:border-gray-500 ${focusRing}`}><span className={`h-2.5 w-2.5 rounded-full ${REEKSEN[r - 1].kleur}`} />{REEKSEN[r - 1].label}</button>
              )) : <span className="text-xs text-gray-500">{weekdagNr(anker) > 5 ? 'Weekend.' : 'Geen reeks gepland op deze dag.'}</span>}
              <Markers d={anker} />
            </div>
            <MaandstartBlok data={data} doe={doe} anker={anker} kanSchrijven={kanSchrijven} onWeergave={p.onWeergave} />
            {per[2]?.van === anker && (
              <div className="rounded-xl border border-purple-300 bg-purple-50 p-3 text-sm flex items-center gap-2 flex-wrap">
                <span className="h-2.5 w-2.5 rounded-full bg-purple-500" /><b>Vandaag start reeks 2.</b> Bekijk wat erbij hoort en waar het materiaal per klant staat.
                <button type="button" onClick={() => open(2)} className="btn-secondary text-xs ml-auto bg-white"><BookOpen className="h-3.5 w-3.5" />Werkwijze reeks 2</button>
              </div>
            )}
            {toonMeetings && <MeetingPlanning data={data} doe={doe} maand={maand} kanSchrijven={kanSchrijven} vanaf={r3van} onKlant={p.onKlant} />}
            {bordMelding}
            {reeksen.map((r) => kaart(r, maand, datum))}
            {overige.length > 0 && (
              <details className="card-base p-3">
                <summary className="text-sm font-medium cursor-pointer">Andere reeksen van {MAAND_KORT(maand)} ({overige.map((r) => REEKSEN[r - 1].kort).join(', ')})</summary>
                <div className="space-y-3 mt-3">{overige.map((r) => kaart(r, maand, datum, true))}</div>
              </details>
            )}
            <p className="text-[11px] text-gray-500">Jij kiest welke klanten je vandaag doet; vink af wat klaar is (en weer uit als het toch nog niet klaar is). De klanten per reeks komen uit Klantenbatches.</p>
          </div>
          <div className="space-y-3"><VasteKlant data={data} doe={doe} anker={anker} kanSchrijven={kanSchrijven} /></div>
        </div>
        {paneel}
      </div>
    )
  }

  // ── Week ──
  if (modus === 'week') {
    const ma = maandag(anker)
    const dagen = Array.from({ length: 5 }, (_, i) => plusDagen(ma, i))
    const maanden = [...new Set(dagen.map(maandVan))]
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">{schakelaar}<span className="text-xs text-gray-500">Per dag: de reeksen en welke klanten die dag afgevinkt zijn.</span></div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          {dagen.map((d) => {
            const r = p.reeksenOp(d)
            const gedaan = data.bord.filter((c) => c.actief && c.afgewerkt_op === d && !w.verborgen.has(c.client_id))
            return (
              <section key={d} className={`card-base p-2 md:min-h-[220px] space-y-1.5 ${d === vandaag ? 'ring-2 ring-[#fff848]' : ''}`}>
                <button type="button" onClick={() => p.onDag(d)} className={`w-full text-left text-xs font-semibold capitalize ${focusRing} rounded`}>{DAG_KORT[weekdagNr(d) - 1]} {Number(d.slice(8))}/{Number(d.slice(5, 7))}</button>
                <div className="flex gap-0.5">{r.map((n) => <span key={n} className={`h-1.5 flex-1 rounded-full ${REEKSEN[n - 1].kleur}`} title={REEKSEN[n - 1].label} />)}</div>
                <div className="flex flex-wrap gap-1"><Markers d={d} /></div>
                {r.map((n) => <div key={n} className="text-[10px] text-gray-500">{REEKSEN[n - 1].kort}: {w.cellen(maandVan(d), n).filter((c) => !c.afgewerkt_op).length} open</div>)}
                {gedaan.length > 0 && (
                  <ul className="space-y-0.5 pt-1 border-t border-gray-100">
                    {gedaan.map((c) => <li key={`${c.client_id}-${c.reeks}`} className="text-[11px] flex items-center gap-1"><Check className="h-3 w-3 text-green-700" /><span className={`h-1.5 w-1.5 rounded-full ${REEKSEN[c.reeks - 1].kleur}`} /><span className="truncate">{w.naam.get(c.client_id)}</span></li>)}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
        <div className="grid lg:grid-cols-[1fr_330px] gap-4">
          <div className="grid md:grid-cols-3 gap-3 items-start">{maanden.flatMap((m) => REEKSEN.map((r) => kaart(r.nr, m, vandaag, true)))}</div>
          <VasteKlant data={data} doe={doe} anker={anker} kanSchrijven={kanSchrijven} />
        </div>
        {paneel}
      </div>
    )
  }

  // ── Maand ──
  const wd = werkdagenVanMaand(maand)
  const per = w.periodes(maand)
  const alle = w.cellen(maand)
  const klanten = [...new Set(alle.map((c) => c.client_id))].sort((a, b) => (w.naam.get(a) ?? '').localeCompare(w.naam.get(b) ?? '', 'nl'))
  const cel = (cid: string, r: Reeks) => alle.find((c) => c.client_id === cid && c.reeks === r)
  // Afvinkdatum: vandaag; voor een voorbije maand de laatste werkdag van die maand.
  const vinkDatum = wd[wd.length - 1] < vandaag ? wd[wd.length - 1] : vandaag
  const vink = (c: BordCel, gedaan: boolean) => doe('reeksvink.zet', { client_id: c.client_id, maand, reeks: c.reeks, gedaan, datum: vinkDatum }, { stil: true })
  const Vakje = ({ cid, r }: { cid: string; r: Reeks }) => {
    const c = cel(cid, r)
    if (!c) return <span className="text-gray-300 text-xs" aria-label="Niet in deze reeks">—</span>
    return (
      <label className="inline-flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" className="h-4 w-4 accent-[#166534]" checked={!!c.afgewerkt_op} disabled={!kanSchrijven} onChange={(e) => vink(c, e.target.checked)} aria-label={`${w.naam.get(cid)}: ${REEKSEN[r - 1].label}`} />
        <span className="text-[11px] text-gray-500">{c.afgewerkt_op ? datumNl(c.afgewerkt_op) : 'open'}</span>
      </label>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">{schakelaar}</div>
      {/* Reeksen van de maand */}
      <div className="card-base p-3 space-y-2">
        <div className="overflow-x-auto">
          <div className="flex gap-0.5 min-w-[560px]">
            {wd.map((d) => {
              const r = p.reeksenOp(d), mk = markers(d)
              const n = data.bord.filter((c) => c.actief && c.afgewerkt_op === d).length
              return (
                <button key={d} type="button" onClick={() => p.onDag(d)} title={`${datumLang(d)}${mk.length ? ` · ${mk.map((x) => x.label).join(', ')}` : ''}${n ? ` · ${n} afgevinkt` : ''}`}
                  className={`flex-1 min-w-[22px] rounded-md border px-0.5 py-1 text-center ${d === vandaag ? 'border-black' : 'border-gray-100'} hover:border-gray-400 ${focusRing}`}>
                  <div className="text-[9px] uppercase text-gray-400">{DAG_KORT[weekdagNr(d) - 1]}</div>
                  <div className="text-[11px] font-semibold">{Number(d.slice(8))}</div>
                  <div className="flex flex-col gap-0.5 mt-0.5">{([1, 2, 3] as Reeks[]).map((x) => <span key={x} className={`h-1 rounded-full ${r.includes(x) ? REEKSEN[x - 1].kleur : 'bg-transparent'}`} />)}</div>
                  {mk.length > 0 && <div className="mt-0.5 mx-auto h-1.5 w-1.5 rounded-full bg-black" />}
                  {n > 0 && <div className="text-[9px] text-green-700 font-semibold">✓{n}</div>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600">
          {REEKSEN.map((r) => { const pp = per[r.nr]; const l = w.cellen(maand, r.nr); return (
            <button key={r.nr} type="button" onClick={() => open(r.nr)} className={`inline-flex items-center gap-1.5 ${focusRing} rounded`}><span className={`h-2 w-3 rounded-full ${r.kleur}`} />{r.kort}{pp ? ` ${datumNl(pp.van)}–${datumNl(pp.tot)}` : ''} · {l.filter((c) => c.afgewerkt_op).length}/{l.length} klaar</button>
          ) })}
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-black" />maandstart / start reeks 2 / meetings plannen</span>
        </div>
      </div>
      {bordMelding}
      {klanten.length > 0 && (
        <>
          {/* Computer: matrix */}
          <div className="hidden md:block card-base p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 font-medium text-gray-600">Klant</th>
                {REEKSEN.map((r) => <th key={r.nr} className="px-3 py-2 text-left"><button type="button" onClick={() => open(r.nr)} className={`inline-flex items-center gap-1.5 font-semibold ${focusRing} rounded`}><span className={`h-2 w-2 rounded-full ${r.kleur}`} />{r.label}<BookOpen className="h-3 w-3 text-gray-400" /></button></th>)}
              </tr></thead>
              <tbody>{klanten.map((cid) => (
                <tr key={cid} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-3 py-1.5"><button type="button" onClick={() => p.onKlant(cid)} className={`font-medium hover:underline text-left ${focusRing} rounded`}>{w.naam.get(cid)}</button></td>
                  {REEKSEN.map((r) => <td key={r.nr} className="px-3 py-1.5"><Vakje cid={cid} r={r.nr} /></td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          {/* Telefoon: kaarten */}
          <div className="md:hidden space-y-2">
            {klanten.map((cid) => (
              <div key={cid} className="card-base p-3 space-y-1.5">
                <button type="button" onClick={() => p.onKlant(cid)} className="font-medium text-sm text-left">{w.naam.get(cid)}</button>
                {REEKSEN.map((r) => <div key={r.nr} className="flex items-center justify-between gap-2 text-xs"><span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${r.kleur}`} />{r.kort}</span><Vakje cid={cid} r={r.nr} /></div>)}
              </div>
            ))}
          </div>
        </>
      )}
      {per[3] && <MeetingPlanning data={data} doe={doe} maand={maand} kanSchrijven={kanSchrijven} vanaf={per[3].van} onKlant={p.onKlant} />}
      {paneel}
    </div>
  )
}
