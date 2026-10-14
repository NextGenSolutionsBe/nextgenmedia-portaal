'use client'

import { useMemo, useState } from 'react'
import { BookOpen, Check, ChevronDown, ExternalLink, Flag, Layers, LayoutGrid, Pencil, Route, CalendarClock, AlertTriangle, Loader2 } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import {
  REEKSEN, MAANDSTART, DAG_KORT, eersteWerkdag, faseplanVanMaand, reeksPeriodes, leesWerkwijze, maandag, maandVan, plusDagen, plusMaanden, weekdagNr, werkdagenVanMaand,
  werkwijze1Beurten, inReeks1, REEKS1_AANPASSINGEN, reeks1AanpassingenCheckDatum, type Reeks, type Werk1Beurt,
} from '@/lib/contentplanning/model'
import { Paneel, focusRing } from './bouwstenen'
import type { BordCel, CpData, Doe, Weergave } from './types'
import { MAANDEN, datumLang, datumNl } from './types'

/**
 * Dagelijkse werking — Chiara’s werkscherm (dag · week · maand). Per dag de
 * reeks(en) en ALLE klanten die deze maand in die reeks zitten (uit Batches),
 * om zelf te kiezen wie je vandaag doet en af te vinken. Vaste momenten
 * (maandstart, aanpassingen doorvoeren op de laatste dag van reeks 1, start
 * reeks 2, meetings plannen bij reeks 3) verschijnen vanzelf.
 * Het afvinken geldt per klant, maand en reeks; de dag van afvinken wordt bewaard.
 */

export type WerkModus = 'dag' | 'week' | 'maand'
type Props = {
  data: CpData; anker: string; vandaag: string; doe: Doe; modus: WerkModus
  onDag: (d: string) => void; onKlant: (id: string) => void; onWeergave: (w: Weergave) => void
  reeksenOp: (d: string) => Reeks[]
}

const MEETING_LABEL = { nodig: 'Meeting nodig', ingepland: 'Ingepland', niet_nodig: 'Niet nodig' } as const
type MeetingStatus = keyof typeof MEETING_LABEL
const MAAND_KORT = (ym: string) => MAANDEN[Number(ym.slice(5, 7)) - 1]

/** Gedeelde stijl: grote, stevige kaarten. */
export const KAART = 'rounded-cp border border-cp-rand bg-cp-vlak'
const KNOP = `inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-cp-rand bg-cp-vlak text-cp-klein font-semibold hover:border-cp-ink active:scale-[0.98] transition-all ${focusRing}`
/** Donkere hoofdknop. Niet KNOP + bg-cp-ink: dan wint de witte achtergrond van KNOP en wordt de tekst onzichtbaar. */
const KNOP_DONKER = `inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-cp-ink bg-cp-ink text-cp-op-ink text-cp-klein font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 ${focusRing}`
const VINK = 'h-6 w-6 shrink-0 cursor-pointer accent-[var(--cp-klaar)]'

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
  /** Werkwijze 1: wie is in deze maand aan de beurt (kalender voor volgende maand, meeting deze maand)? */
  const beurtenReeks1 = (ym: string): Werk1Beurt[] => {
    const cp = new Map(data.cpKlanten.map((k) => [k.client_id, k]))
    const start = new Map(data.batches.map((b) => [b.id, b.start_month]))
    const meeting = new Map(data.meetings.filter((m) => m.maand === ym).map((m) => [m.client_id, m.status]))
    return werkwijze1Beurten(ym, data.instellingen.onderdelen, socialKlanten
      .filter((k) => cp.get(k.id)?.actief !== false)
      .map((k) => ({
        client_id: k.id,
        instelling: { ritme: cp.get(k.id)?.ritme ?? null, activiteiten: cp.get(k.id)?.activiteiten ?? {}, batch_start_maand: k.batch_id ? (start.get(k.batch_id) ?? null) : null },
        contentMaanden: data.contentMaanden?.[k.id] ?? [],
        meetingStatus: meeting.get(k.id) ?? null,
      })))
      .sort((a, b) => (naam.get(a.client_id) ?? '').localeCompare(naam.get(b.client_id) ?? '', 'nl'))
  }
  return { verborgen, naam, periodes, cellen, socialKlanten, beurtenReeks1 }
}

// ── Werkwijze 1: klanten aan de beurt (automatisch bepaald) ─────────────────
const KALENDER_BADGE: Partial<Record<Werk1Beurt['kalender'], { label: string; kleur: string }>> = {
  nodig: { label: 'Nieuwe kalender', kleur: 'bg-cp-r1-zacht border-cp-rand' },
  controleren: { label: 'Kalender? controleren', kleur: 'bg-amber-50 border-amber-300 text-amber-900' },
}
const MEETING_BADGE: Partial<Record<Werk1Beurt['meeting'], { label: string; kleur: string }>> = {
  nodig: { label: 'Meeting', kleur: 'bg-cp-r3-zacht border-cp-rand' },
  ingepland: { label: 'Meeting ingepland', kleur: 'bg-cp-r3-zacht border-cp-rand' },
}
function Badges({ b }: { b: Werk1Beurt }) {
  const k = KALENDER_BADGE[b.kalender], m = MEETING_BADGE[b.meeting]
  return <>{k && <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${k.kleur}`}>{k.label}</span>}{m && <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${m.kleur}`}>{m.label}</span>}</>
}

/**
 * Wie moet deze maand in reeks 1? De app bepaalt het uit het ritme, de batch,
 * de meetingplanning en wat er al gepland staat (zie werkwijze1Beurten). Met één
 * klik komen ze op het Klantenbord (enkel lege vakjes), zodat je ze kan afvinken.
 */
export function Reeks1Voorstel({ data, doe, maand, kanSchrijven, onKlant }: { data: CpData; doe: Doe; maand: string; kanSchrijven: boolean; onKlant: (id: string) => void }) {
  const w = useWerk(data)
  const [toon, setToon] = useState<'niet' | 'onbekend' | null>(null)
  const [bezig, setBezig] = useState(false)
  const lijst = w.beurtenReeks1(maand)
  const aan = lijst.filter(inReeks1)
  const niet = lijst.filter((b) => !inReeks1(b))
  // Los daarvan: bij wie ontbreekt het ritme of de batch (bv. om de kwartaalmeeting te bepalen)?
  const onbekend = lijst.filter((b) => b.instellingOntbreekt)
  const opBord = new Set(data.bord.filter((c) => c.maand === maand && c.reeks === 1).map((c) => c.client_id))
  const toeTeVoegen = aan.filter((b) => !opBord.has(b.client_id))
  const volgende = plusMaanden(maand, 1)
  const zet = async () => {
    setBezig(true)
    await doe('reeks1.voorstel', { maand, client_ids: toeTeVoegen.map((b) => b.client_id) }, { melding: `${toeTeVoegen.length} klant${toeTeVoegen.length === 1 ? '' : 'en'} in reeks 1 gezet.` })
    setBezig(false)
  }
  const rij = (b: Werk1Beurt) => (
    <li key={b.client_id} className="px-4 py-2.5 flex items-start gap-2 flex-wrap">
      <button type="button" onClick={() => onKlant(b.client_id)} className={`text-left text-cp-basis font-semibold min-w-0 ${focusRing} rounded`}>{w.naam.get(b.client_id)}</button>
      <span className="flex gap-1 flex-wrap"><Badges b={b} />{b.instellingOntbreekt && <span className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900" title={b.instellingOntbreekt}>ritme/batch?</span>}</span>
      {b.reden && <span className="basis-full text-cp-klein text-cp-zacht">{b.reden}</span>}
    </li>
  )
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h3 className="text-cp-basis font-semibold">Aan de beurt: kalender voor {MAAND_KORT(volgende)}, meetings in {MAAND_KORT(maand)}</h3>
          <p className="text-cp-klein text-cp-zacht">Automatisch bepaald uit het ritme per klant, de batch, de meetingplanning en wat er al gepland staat.</p>
        </div>
        {kanSchrijven && toeTeVoegen.length > 0 && (
          <button type="button" disabled={bezig} onClick={zet} className={KNOP_DONKER}>{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}In reeks 1 zetten ({toeTeVoegen.length})</button>
        )}
      </div>
      {aan.length === 0 ? <p className="text-cp-basis text-cp-zacht">Niemand aan de beurt deze maand.</p> : (
        <ul className="divide-y divide-cp-rand rounded-xl border border-cp-rand">{aan.map(rij)}</ul>
      )}
      <div className="flex gap-2 flex-wrap">
        {niet.length > 0 && <button type="button" onClick={() => setToon(toon === 'niet' ? null : 'niet')} aria-expanded={toon === 'niet'} className={`${KNOP} h-9`}>Niet aan de beurt ({niet.length})<ChevronDown className={`h-4 w-4 transition-transform ${toon === 'niet' ? '' : '-rotate-90'}`} /></button>}
        {onbekend.length > 0 && <button type="button" onClick={() => setToon(toon === 'onbekend' ? null : 'onbekend')} aria-expanded={toon === 'onbekend'} className={`${KNOP} h-9 border-amber-300 bg-amber-50`}><AlertTriangle className="h-4 w-4" />Instellingen ontbreken ({onbekend.length})<ChevronDown className={`h-4 w-4 transition-transform ${toon === 'onbekend' ? '' : '-rotate-90'}`} /></button>}
      </div>
      {toon === 'niet' && <ul className="divide-y divide-cp-rand rounded-xl border border-cp-rand">{niet.map(rij)}</ul>}
      {toon === 'onbekend' && (
        <ul className="divide-y divide-cp-rand rounded-xl border border-amber-300">
          {onbekend.map((b) => (
            <li key={b.client_id} className="px-4 py-2.5 flex items-start gap-2 flex-wrap">
              <span className="text-cp-basis font-semibold">{w.naam.get(b.client_id)}</span>
              <span className="basis-full text-cp-klein text-cp-zacht">{b.instellingOntbreekt}{b.meeting === 'onbekend' ? ' Daardoor weet de app niet of er een kwartaalmeeting nodig is.' : ''}</span>
              <button type="button" onClick={() => onKlant(b.client_id)} className={`text-cp-klein underline ${focusRing}`}>{data.kan.beheren ? 'ritme en batch instellen' : 'klantfiche'}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Werkwijze (stappenplan) tonen ───────────────────────────────────────────
export function WerkwijzeTekst({ tekst, compact }: { tekst: string; compact?: boolean }) {
  const w = leesWerkwijze(tekst)
  if (!w.stappen.length && !w.letOp.length && !w.intro.length) return <p className="text-cp-klein text-cp-zacht">Nog geen werkwijze.</p>
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {w.letOp.map((l) => <div key={l} className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-cp-basis text-amber-900 flex items-start gap-2"><AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />{l}</div>)}
      {w.intro.map((l) => <p key={l} className="text-cp-basis">{l}</p>)}
      <ol className="divide-y divide-cp-rand">
        {w.stappen.map((s, i) => (
          <li key={`${i}-${s.titel}`} className={`flex gap-3 ${compact ? 'py-2' : 'py-3'}`}>
            <span className="text-cp-basis font-bold text-cp-zacht w-5 shrink-0 tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1 space-y-1">
              {s.titel && <div className="text-cp-basis font-semibold flex items-center gap-2 flex-wrap">{s.titel}{s.badge && <span className="rounded-full bg-cp-achtergrond border border-cp-rand px-2 text-cp-klein font-normal">{s.badge}</span>}</div>}
              {s.punten.length > 0 && <ul className="space-y-0.5">{s.punten.map((p) => <li key={p} className="text-cp-klein flex gap-1.5"><span className="text-cp-zacht">•</span><Linkjes tekst={p} /></li>)}</ul>}
              {s.blokken.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-2 pt-1">
                  {s.blokken.map((b) => (
                    <div key={b.titel} className="rounded-xl bg-cp-achtergrond border border-cp-rand px-3 py-2">
                      <div className="text-cp-klein font-semibold">{b.titel}</div>
                      <ul className="mt-0.5 space-y-0.5">{b.punten.map((p) => <li key={p} className="text-cp-klein flex gap-1.5"><span className="text-cp-zacht">•</span><Linkjes tekst={p} /></li>)}</ul>
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
  return <span className="min-w-0 break-words">{delen.map((d, i) => (/^https?:\/\//.test(d) ? <a key={i} href={d} target="_blank" rel="noreferrer" className="underline break-all">{d}</a> : <span key={i}>{d}</span>))}</span>
}

/** Zijpaneel met de werkwijze van een reeks; beheerders kunnen de tekst aanpassen. Reeks 2 toont bovenaan waar het materiaal per klant staat. */
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
    <Paneel breed titel={<span className="inline-flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${info.kleur}`} />{info.label}</span>} onSluit={onSluit}>
      {r === 1 && !bewerk && (
        <section className="rounded-xl border border-cp-rand bg-cp-achtergrond p-4">
          <Reeks1Voorstel data={data} doe={doe} maand={maand} kanSchrijven={data.kan.aanpassen || data.kan.beheren} onKlant={onKlant} />
        </section>
      )}
      {/* Reeks 2: eerst weten waar het materiaal staat (stap 1 van de werkwijze). */}
      {r === 2 && (
        <section className="space-y-2 border-b border-cp-rand pb-4">
          <h4 className="text-cp-kop">Materiaal per klant</h4>
          <div className="divide-y divide-cp-rand rounded-xl border border-cp-rand">
            {materiaal.map((k) => (
              <div key={k.client_id} className="px-4 py-3 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-cp-basis font-semibold flex items-center gap-1.5">{w.naam.get(k.client_id)}{inReeks.has(k.client_id) && <span className={`h-2.5 w-2.5 rounded-full ${info.kleur}`} title="Deze maand in reeks 2" />}</div>
                  {k.materiaal ? <div className="text-cp-klein text-cp-zacht whitespace-pre-line"><Linkjes tekst={k.materiaal} /></div> : <div className="text-cp-klein text-cp-zacht">—</div>}
                </div>
                <button type="button" onClick={() => onKlant(k.client_id)} className={`text-cp-klein underline shrink-0 ${focusRing}`}>{data.kan.beheren ? 'aanpassen' : 'klantfiche'}</button>
              </div>
            ))}
          </div>
        </section>
      )}
      {bewerk ? (
        <div className="space-y-2">
          <textarea className={`${INP} font-mono text-xs`} rows={22} value={concept} onChange={(e) => setConcept(e.target.value)} aria-label="Werkwijze bewerken" />
          <p className="text-[11px] text-cp-zacht"># Stap [badge] · ## Deelblok · - punt · ! let op</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setConcept(tekst); setBewerk(false) }} className="btn-secondary text-sm">Annuleren</button>
            <button type="button" disabled={bezig} onClick={async () => { setBezig(true); const ok = await doe('werkwijze.opslaan', { reeks: r, tekst: concept }, { melding: 'Werkwijze bewaard.' }); setBezig(false); if (ok) setBewerk(false) }} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
          </div>
        </div>
      ) : (
        <>
          <WerkwijzeTekst tekst={tekst} />
          {data.kan.beheren && <button type="button" onClick={() => { setConcept(tekst); setBewerk(true) }} className={KNOP}><Pencil className="h-4 w-4" />Aanpassen</button>}
        </>
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
  return (
    <section className={`${KAART} border-2 border-cp-ink overflow-hidden`}>
      <h2 className="px-5 py-4 bg-cp-ink text-cp-op-ink text-cp-kop flex items-center gap-2"><Flag className="h-5 w-5" />{anker === eerste ? `Maandstart ${MAAND_KORT(maand)}` : `Maandstart ${MAAND_KORT(maand)} · nog open sinds ${datumNl(eerste)}`}</h2>
      <ul className="divide-y divide-cp-rand">
        {MAANDSTART.map((m, i) => {
          const aan = klaar(m.key)
          const door = data.checks.find((c) => c.routine_key === m.key && c.datum === eerste)?.door
          return (
            <li key={m.key} className="px-5 py-4 flex items-center gap-4 flex-wrap">
              <input type="checkbox" className={VINK} checked={aan} disabled={!kanSchrijven} aria-label={`${m.titel} afvinken`}
                onChange={(e) => doe('routine.check', { routine_key: m.key, datum: eerste, aan: e.target.checked }, { stil: true })} />
              <span className={`flex-1 min-w-[200px] text-cp-basis font-semibold ${aan ? 'line-through text-cp-zacht' : ''}`}>{i + 1}. {m.titel}{aan && door && <span className="text-cp-klein font-normal text-cp-zacht"> · {door}</span>}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => onWeergave(m.weergave)} className={KNOP}>{m.weergave === 'batches' ? <><Layers className="h-4 w-4" />Batches</> : <><Route className="h-4 w-4" />Reeksen</>}</button>
                {m.key === 'maandstart_batches' && <button type="button" onClick={() => onWeergave('bord')} className={KNOP}><LayoutGrid className="h-4 w-4" />Klantenbord</button>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Laatste dag reeks 1: alle aanpassingen doorvoeren (één taak voor alle klanten) ──
function AanpassingenTaak({ data, doe, anker, tot, kanSchrijven, onWerkwijze }: { data: CpData; doe: Doe; anker: string; tot: string; kanSchrijven: boolean; onWerkwijze: () => void }) {
  const datum = reeks1AanpassingenCheckDatum(maandVan(anker))
  const check = data.checks.find((c) => c.routine_key === REEKS1_AANPASSINGEN.key && c.datum === datum)
  // Op de laatste dag van reeks 1, en daarna tot het afgevinkt is.
  if (anker < tot || (anker !== tot && check)) return null
  return (
    <section className={`${KAART} border-2 border-cp-ink overflow-hidden`}>
      <div className="h-2 bg-cp-r1" />
      <div className="px-5 py-4 flex items-center gap-4 flex-wrap">
        <input type="checkbox" className={VINK} checked={!!check} disabled={!kanSchrijven} aria-label={`${REEKS1_AANPASSINGEN.titel} afvinken`}
          onChange={(e) => doe('routine.check', { routine_key: REEKS1_AANPASSINGEN.key, datum, aan: e.target.checked }, { stil: true })} />
        <div className="flex-1 min-w-[200px]">
          <div className={`text-cp-basis font-semibold ${check ? 'line-through text-cp-zacht' : ''}`}>{REEKS1_AANPASSINGEN.titel}{check?.door && <span className="text-cp-klein font-normal text-cp-zacht"> · {check.door}</span>}</div>
          <div className="text-cp-klein text-cp-zacht">{anker === tot ? 'Laatste dag van reeks 1' : `Laatste dag van reeks 1 was ${datumNl(tot)}`}</div>
        </div>
        <button type="button" onClick={onWerkwijze} className={KNOP}><BookOpen className="h-4 w-4" />Werkwijze reeks 1</button>
      </div>
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
    <section className={`${KAART} p-5 space-y-3`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-cp-kop">{inst.vaste_naam}</h3>
        <span className="text-cp-klein text-cp-zacht">week {datumNl(week)}</span>
      </div>
      {inst.vaste_taken.map((t) => {
        const check = data.checks.find((c) => c.routine_key === t.key && c.datum === week)
        return (
          <div key={t.key} className="rounded-xl border border-cp-rand">
            <div className="flex items-center gap-3 px-3 py-3">
              <input type="checkbox" className={VINK} checked={!!check} disabled={!kanSchrijven} aria-label={`${t.titel} afvinken voor deze week`}
                onChange={(e) => doe('routine.check', { routine_key: t.key, datum: week, aan: e.target.checked }, { stil: true })} />
              <span className={`text-cp-basis font-medium flex-1 min-w-0 ${check ? 'line-through text-cp-zacht' : ''}`}>{t.titel}{check?.door && <span className="text-cp-klein text-cp-zacht"> · {check.door}</span>}</span>
              <button type="button" onClick={() => setOpen(open === t.key ? null : t.key)} aria-expanded={open === t.key} aria-label={`Details ${t.titel}`} className={`h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-cp-achtergrond ${focusRing}`}><ChevronDown className={`h-4 w-4 transition-transform ${open === t.key ? '' : '-rotate-90'}`} /></button>
            </div>
            {open === t.key && <div className="border-t border-cp-rand px-4 py-3"><WerkwijzeTekst tekst={t.detail} compact /></div>}
          </div>
        )
      })}
      <div className="flex gap-2 flex-wrap">{inst.routine_links.filter((l) => /^https?:\/\//.test(l.url)).map((l) => <a key={l.label + l.url} href={l.url} target="_blank" rel="noreferrer" className={`${KNOP} h-9`}><ExternalLink className="h-4 w-4" />{l.label}</a>)}</div>
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
  // Reeks 1: waarom staat een klant erin (kalender, meeting) — uit dezelfde berekening als het voorstel.
  const beurt = r === 1 ? new Map(w.beurtenReeks1(maand).map((b) => [b.client_id, b])) : null
  const p = w.periodes(maand)[r]
  const info = REEKSEN[r - 1]
  const vink = (c: BordCel, gedaan: boolean) => doe('reeksvink.zet', { client_id: c.client_id, maand, reeks: r, gedaan, datum }, { stil: true })
  return (
    <section className={`${KAART} overflow-hidden`}>
      <div className={`h-2 ${info.kleur}`} />
      <div className={`px-5 py-4 ${info.zacht} flex items-center gap-3 flex-wrap`}>
        <div className="min-w-0 flex-1">
          <h2 className={klein ? 'text-cp-basis font-semibold' : 'text-cp-kop'}>{info.label}</h2>
          <p className="text-cp-klein text-cp-zacht">{p ? `${datumNl(p.van)} – ${datumNl(p.tot)} · ` : ''}{klaar.length}/{lijst.length} klaar</p>
        </div>
        <button type="button" onClick={onWerkwijze} className={KNOP}><BookOpen className="h-4 w-4" />Werkwijze</button>
      </div>
      {lijst.length > 0 && <div className="h-1.5 bg-cp-achtergrond"><div className={`h-1.5 ${info.kleur} transition-all duration-500`} style={{ width: `${Math.round((klaar.length / lijst.length) * 100)}%` }} /></div>}
      {r === 1 && !klein && <div className="px-5 py-4 border-b border-cp-rand"><Reeks1Voorstel data={data} doe={doe} maand={maand} kanSchrijven={kanSchrijven} onKlant={onKlant} /></div>}
      {lijst.length === 0 ? <p className="px-5 py-4 text-cp-basis text-cp-zacht">Geen klanten</p> : (
        <ul className={`divide-y divide-cp-rand ${klein ? 'max-h-80 overflow-y-auto' : ''}`}>
          {[...open, ...klaar].map((c) => (
            <li key={c.client_id} className={`flex items-center gap-4 ${klein ? 'px-4 py-2.5' : 'px-5 py-4'} hover:bg-cp-achtergrond transition-colors`}>
              <input type="checkbox" className={VINK} checked={!!c.afgewerkt_op} disabled={!kanSchrijven}
                aria-label={`${w.naam.get(c.client_id)}: ${info.label} ${c.afgewerkt_op ? 'weer open zetten' : 'afvinken'}`} onChange={(e) => vink(c, e.target.checked)} />
              <button type="button" onClick={() => onKlant(c.client_id)} className={`text-left min-w-0 flex-1 truncate ${klein ? 'text-cp-basis' : 'text-lg'} ${c.afgewerkt_op ? 'line-through text-cp-zacht' : 'font-semibold'} ${focusRing} rounded`}>{w.naam.get(c.client_id)}</button>
              {beurt?.get(c.client_id) && !klein && <span className="hidden sm:flex gap-1 shrink-0"><Badges b={beurt.get(c.client_id)!} /></span>}
              {c.afgewerkt_op && <span className="text-cp-klein text-cp-zacht shrink-0">{datumNl(c.afgewerkt_op)}{c.afgewerkt_door ? ` · ${c.afgewerkt_door}` : ''}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Reeks 3: meetings voor volgende maand ──────────────────────────────────
function MeetingPlanning({ data, doe, maand, kanSchrijven, onKlant }: { data: CpData; doe: Doe; maand: string; kanSchrijven: boolean; onKlant: (id: string) => void }) {
  const w = useWerk(data)
  const volgende = plusMaanden(maand, 1)
  const status = new Map(data.meetings.filter((m) => m.maand === volgende).map((m) => [m.client_id, m]))
  const klanten = [...w.socialKlanten].sort((a, b) => a.company_name.localeCompare(b.company_name, 'nl'))
  const beslist = klanten.filter((k) => { const s = status.get(k.id)?.status; return s === 'niet_nodig' || s === 'ingepland' }).length
  const zet = (cid: string, s: MeetingStatus) => doe('meetingplan.zet', { client_id: cid, maand: volgende, status: status.get(cid)?.status === s ? null : s }, { stil: true })
  return (
    <section className={`${KAART} overflow-hidden`}>
      <div className="h-2 bg-cp-r3" />
      <div className="px-5 py-4 flex items-center gap-3 flex-wrap">
        <CalendarClock className="h-5 w-5" />
        <h2 className="text-cp-kop flex-1">Kijken welke meetings ingepland moeten worden ({MAAND_KORT(volgende)})</h2>
        <span className="text-cp-klein text-cp-zacht">{beslist}/{klanten.length}</span>
      </div>
      <ul className="divide-y divide-cp-rand border-t border-cp-rand">
        {klanten.map((k) => {
          const s = status.get(k.id)
          return (
            <li key={k.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
              <button type="button" onClick={() => onKlant(k.id)} className={`text-cp-basis font-semibold text-left min-w-[160px] flex-1 truncate ${focusRing} rounded`}>{k.company_name}</button>
              <div className="inline-flex rounded-xl border border-cp-rand overflow-hidden" role="group" aria-label={`Meeting ${k.company_name}`}>
                {(['nodig', 'ingepland', 'niet_nodig'] as MeetingStatus[]).map((x) => (
                  <button key={x} type="button" disabled={!kanSchrijven} aria-pressed={s?.status === x} onClick={() => zet(k.id, x)}
                    className={`h-10 px-3 text-cp-klein font-semibold border-l first:border-l-0 border-cp-rand transition-colors ${s?.status === x ? 'bg-cp-ink text-cp-op-ink' : 'bg-cp-vlak hover:bg-cp-achtergrond'} ${focusRing}`}>{MEETING_LABEL[x]}</button>
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
  /** Markeringen van een dag: maandstart, aanpassingen doorvoeren (laatste dag reeks 1), start reeks 2, meetings plannen (eerste dag reeks 3). */
  const markers = (d: string) => {
    const m = maandVan(d), per = w.periodes(m), uit: { label: string; kleur: string }[] = []
    if (d === eersteWerkdag(m)) uit.push({ label: 'Maandstart', kleur: 'bg-cp-ink text-cp-op-ink' })
    if (per[1]?.tot === d) uit.push({ label: 'Aanpassingen doorvoeren', kleur: 'bg-cp-r1 text-cp-ink' })
    if (per[2]?.van === d) uit.push({ label: 'Start reeks 2', kleur: 'bg-cp-r2 text-white' })
    if (per[3]?.van === d) uit.push({ label: 'Meetings plannen', kleur: 'bg-cp-r3 text-white' })
    return uit
  }
  const Markers = ({ d }: { d: string }) => <>{markers(d).map((x) => <span key={x.label} className={`rounded-md px-2 py-0.5 text-cp-klein font-semibold ${x.kleur}`}>{x.label}</span>)}</>

  const paneel = werkwijze && <WerkwijzePaneel r={werkwijze.r} maand={werkwijze.maand} data={data} doe={doe} onKlant={(id) => { setWerkwijze(null); p.onKlant(id) }} onSluit={() => setWerkwijze(null)} />
  const bordLeeg = w.cellen(maand).length === 0
  const bordMelding = bordLeeg && (
    <div className={`${KAART} border-2 border-amber-300 bg-amber-50 p-5 text-cp-basis font-semibold flex items-center gap-3 flex-wrap`}>
      <Layers className="h-5 w-5" />Batches {MAAND_KORT(maand)} nog niet ingevuld
      <button type="button" onClick={() => p.onWeergave('batches')} className={`${KNOP_DONKER} ml-auto`}>Batches invullen</button>
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
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {reeksen.length ? reeksen.map((r) => (
            <button key={r} type="button" onClick={() => open(r)} className={`inline-flex items-center gap-2 h-10 px-4 rounded-full text-cp-klein font-semibold ${REEKSEN[r - 1].zacht} border border-cp-rand hover:border-cp-ink transition-colors ${focusRing}`}><span className={`h-3 w-3 rounded-full ${REEKSEN[r - 1].kleur}`} />{REEKSEN[r - 1].label}</button>
          )) : <span className="text-cp-basis text-cp-zacht">{weekdagNr(anker) > 5 ? 'Weekend' : 'Geen reeks'}</span>}
          <Markers d={anker} />
        </div>
        <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
          <div className="space-y-4 min-w-0">
            <MaandstartBlok data={data} doe={doe} anker={anker} kanSchrijven={kanSchrijven} onWeergave={p.onWeergave} />
            {per[1] && <AanpassingenTaak data={data} doe={doe} anker={anker} tot={per[1].tot} kanSchrijven={kanSchrijven} onWerkwijze={() => open(1)} />}
            {per[2]?.van === anker && (
              <div className={`${KAART} overflow-hidden`}>
                <div className="h-2 bg-cp-r2" />
                <div className="px-5 py-4 flex items-center gap-3 flex-wrap">
                  <h2 className="text-cp-kop flex-1">Start reeks 2</h2>
                  <button type="button" onClick={() => open(2)} className={KNOP}><BookOpen className="h-4 w-4" />Werkwijze reeks 2</button>
                </div>
              </div>
            )}
            {toonMeetings && <MeetingPlanning data={data} doe={doe} maand={maand} kanSchrijven={kanSchrijven} onKlant={p.onKlant} />}
            {bordMelding}
            {reeksen.map((r) => kaart(r, maand, datum))}
            {overige.length > 0 && (
              <details className={`${KAART} p-5 group`}>
                <summary className="text-cp-basis font-semibold cursor-pointer list-none flex items-center gap-2"><ChevronDown className="h-4 w-4 -rotate-90 group-open:rotate-0 transition-transform" />Andere reeksen van {MAAND_KORT(maand)}</summary>
                <div className="space-y-3 mt-4">{overige.map((r) => kaart(r, maand, datum, true))}</div>
              </details>
            )}
          </div>
          <VasteKlant data={data} doe={doe} anker={anker} kanSchrijven={kanSchrijven} />
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
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {dagen.map((d) => {
            const r = p.reeksenOp(d)
            const gedaan = data.bord.filter((c) => c.actief && c.afgewerkt_op === d && !w.verborgen.has(c.client_id))
            return (
              <section key={d} className={`${KAART} p-4 md:min-h-[240px] space-y-2.5 ${d === vandaag ? 'border-2 border-cp-vandaag' : ''}`}>
                <button type="button" onClick={() => p.onDag(d)} className={`w-full text-left text-cp-kop capitalize hover:underline ${focusRing} rounded`}>{DAG_KORT[weekdagNr(d) - 1]} {Number(d.slice(8))}/{Number(d.slice(5, 7))}</button>
                <div className="flex gap-1">{r.map((n) => <span key={n} className={`h-2.5 flex-1 rounded-full ${REEKSEN[n - 1].kleur}`} title={REEKSEN[n - 1].label} />)}</div>
                <div className="flex flex-wrap gap-1"><Markers d={d} /></div>
                {r.map((n) => <div key={n} className="text-cp-klein">{REEKSEN[n - 1].kort}: <b>{w.cellen(maandVan(d), n).filter((c) => !c.afgewerkt_op).length}</b> open</div>)}
                {gedaan.length > 0 && (
                  <ul className="space-y-1 pt-2 border-t border-cp-rand">
                    {gedaan.map((c) => <li key={`${c.client_id}-${c.reeks}`} className="text-cp-klein flex items-center gap-1.5"><Check className="h-4 w-4" /><span className={`h-2 w-2 rounded-full ${REEKSEN[c.reeks - 1].kleur}`} /><span className="truncate">{w.naam.get(c.client_id)}</span></li>)}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
        <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
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
    if (!c) return <span className="text-cp-zacht" aria-label="Niet in deze reeks">—</span>
    return (
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" className={VINK} checked={!!c.afgewerkt_op} disabled={!kanSchrijven} onChange={(e) => vink(c, e.target.checked)} aria-label={`${w.naam.get(cid)}: ${REEKSEN[r - 1].label}`} />
        <span className="text-cp-klein text-cp-zacht">{c.afgewerkt_op ? datumNl(c.afgewerkt_op) : 'open'}</span>
      </label>
    )
  }
  return (
    <div className="space-y-5">
      <div className={`${KAART} p-4 space-y-3`}>
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-[640px]">
            {wd.map((d) => {
              const r = p.reeksenOp(d), mk = markers(d)
              const n = data.bord.filter((c) => c.actief && c.afgewerkt_op === d).length
              return (
                <button key={d} type="button" onClick={() => p.onDag(d)} title={`${datumLang(d)}${mk.length ? ` · ${mk.map((x) => x.label).join(', ')}` : ''}${n ? ` · ${n} afgevinkt` : ''}`}
                  className={`flex-1 min-w-[26px] rounded-xl border-2 px-0.5 py-2 text-center transition-colors ${d === vandaag ? 'border-cp-vandaag' : 'border-transparent'} hover:border-cp-rand ${focusRing}`}>
                  <div className="text-[10px] uppercase text-cp-zacht">{DAG_KORT[weekdagNr(d) - 1]}</div>
                  <div className="text-cp-basis font-bold">{Number(d.slice(8))}</div>
                  <div className="flex flex-col gap-0.5 mt-1">{([1, 2, 3] as Reeks[]).map((x) => <span key={x} className={`h-1.5 rounded-full ${r.includes(x) ? REEKSEN[x - 1].kleur : 'bg-transparent'}`} />)}</div>
                  {mk.length > 0 && <div className="mt-1 mx-auto h-2 w-2 rounded-full bg-cp-ink" />}
                  {n > 0 && <div className="text-[10px] font-bold">✓{n}</div>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-cp-klein">
          {REEKSEN.map((r) => { const pp = per[r.nr]; const l = w.cellen(maand, r.nr); return (
            <button key={r.nr} type="button" onClick={() => open(r.nr)} className={`inline-flex items-center gap-1.5 hover:underline ${focusRing} rounded`}><span className={`h-2.5 w-4 rounded-full ${r.kleur}`} />{r.kort}{pp ? ` ${datumNl(pp.van)}–${datumNl(pp.tot)}` : ''} · {l.filter((c) => c.afgewerkt_op).length}/{l.length}</button>
          ) })}
        </div>
      </div>
      {bordMelding}
      {klanten.length > 0 && (
        <>
          {/* Computer: matrix */}
          <div className={`hidden md:block ${KAART} overflow-hidden`}>
            <table className="w-full">
              <thead><tr className="bg-cp-achtergrond border-b border-cp-rand">
                <th className="text-left px-5 py-3 text-cp-klein font-semibold text-cp-zacht">Klant</th>
                {REEKSEN.map((r) => <th key={r.nr} className="px-4 py-3 text-left"><button type="button" onClick={() => open(r.nr)} className={`inline-flex items-center gap-1.5 text-cp-klein font-semibold hover:underline ${focusRing} rounded`}><span className={`h-2.5 w-2.5 rounded-full ${r.kleur}`} />{r.label}</button></th>)}
              </tr></thead>
              <tbody>{klanten.map((cid) => (
                <tr key={cid} className="border-b border-cp-rand last:border-b-0 hover:bg-cp-achtergrond transition-colors">
                  <td className="px-5 py-3"><button type="button" onClick={() => p.onKlant(cid)} className={`text-cp-basis font-semibold hover:underline text-left ${focusRing} rounded`}>{w.naam.get(cid)}</button></td>
                  {REEKSEN.map((r) => <td key={r.nr} className="px-4 py-3"><Vakje cid={cid} r={r.nr} /></td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          {/* Telefoon: kaarten */}
          <div className="md:hidden space-y-3">
            {klanten.map((cid) => (
              <div key={cid} className={`${KAART} p-4 space-y-2`}>
                <button type="button" onClick={() => p.onKlant(cid)} className="text-cp-basis font-semibold text-left">{w.naam.get(cid)}</button>
                {REEKSEN.map((r) => <div key={r.nr} className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1.5 text-cp-klein"><span className={`h-2.5 w-2.5 rounded-full ${r.kleur}`} />{r.kort}</span><Vakje cid={cid} r={r.nr} /></div>)}
              </div>
            ))}
          </div>
        </>
      )}
      {per[3] && <MeetingPlanning data={data} doe={doe} maand={maand} kanSchrijven={kanSchrijven} onKlant={p.onKlant} />}
      {paneel}
    </div>
  )
}
