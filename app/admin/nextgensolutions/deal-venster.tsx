'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { leesGetal } from '@/lib/getal'
import { ClickupTaken, NieuweTaak } from '@/components/admin/clickup-taken'
import { DicteerKnop } from '@/components/admin/dicteer-knop'
import { UITKOMSTEN } from '@/lib/abm'
import {
  BRONNEN, FASES, STANDAARD_LOOPTIJD, VERLOREN_REDENEN, dealWaarde, faseLabel, bronLabel, type Deal, type Fase,
} from '@/lib/ngs/model'
import { Chip, FASE_STIJL, Venster, dagKort, eur, eurCent, inp, lbl, post, tijdstip } from './ui'
import { PersoonKnop } from '@/components/admin/persoon-foto'
import { DealLevering } from './deal-levering'
import { VervolgBlok, BelpogingBlok, AuditBlok, NaarVoorstel, NaarAudit } from './deal-verkoop'
import { isOpvolgFase, volgendeBelDatum } from '@/lib/ngs/model'
import type { Vervolg } from '@/lib/ngs/server'
import type { WerkingInstellingen } from '@/lib/werking/instellingen'

type Velden = {
  bedrijf: string; contactpersoon: string; email: string; telefoon: string; titel: string; diensten: string[]
  afspraak_op: string; waarde_eenmalig: string; waarde_maandelijks: string; looptijd_maanden: string; start_datum: string
  bron: string; verantwoordelijke: string
}

/** Een ISO-tijdstip als waarde voor <input type="datetime-local"> (tijd van de browser). */
const lokaal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const bedragTekst = (n: number | null) => (n === null || n === undefined ? '' : String(n).replace('.', ','))

const veldenVan = (d: Deal | null, ik: string | null): Velden => ({
  bedrijf: d?.bedrijf ?? '', contactpersoon: d?.contactpersoon ?? '', email: d?.email ?? '', telefoon: d?.telefoon ?? '', titel: d?.titel ?? '',
  diensten: d?.diensten ?? [], afspraak_op: lokaal(d?.afspraak_op ?? null),
  waarde_eenmalig: bedragTekst(d?.waarde_eenmalig ?? null), waarde_maandelijks: bedragTekst(d?.waarde_maandelijks ?? null),
  looptijd_maanden: d?.looptijd_maanden ? String(d.looptijd_maanden) : '', start_datum: d?.start_datum ?? '',
  bron: d?.bron ?? '', verantwoordelijke: d?.verantwoordelijke ?? ik ?? '',
})

/** De volgende opvolging: vandaag + x dagen (Instellingen → Werking), in het weekend de maandag erna. */
const opvolgDatum = (dagen: number) => volgendeBelDatum(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), dagen)

/** Wat de server verwacht (afspraak als ISO). */
const lichaam = (v: Velden) => ({ ...v, afspraak_op: v.afspraak_op ? new Date(v.afspraak_op).toISOString() : null })

/** De velden van een bestaande deal, om enkel een paar te wijzigen (bv. de waarde bij Closed Won). */
export const dealLichaam = (d: Deal, extra: Partial<Velden> = {}) => lichaam({ ...veldenVan(d, null), ...extra })

function waardeUitleg(v: Pick<Velden, 'waarde_eenmalig' | 'waarde_maandelijks' | 'looptijd_maanden'>): string | null {
  const e = leesGetal(v.waarde_eenmalig) ?? 0, m = leesGetal(v.waarde_maandelijks) ?? 0
  if (!e && !m) return null
  const l = Number(v.looptijd_maanden) || null
  const totaal = dealWaarde({ waarde_eenmalig: e, waarde_maandelijks: m, looptijd_maanden: l })
  const delen = [e ? `${eurCent(e)} eenmalig` : null, m ? `${l ?? STANDAARD_LOOPTIJD} × ${eurCent(m)}${l ? '' : ' (eerste jaar)'}` : null].filter(Boolean).join(' + ')
  return `Waarde ${eur(totaal)}${delen.includes('+') || m ? ` = ${delen}` : ''}`
}

/** De velden van een deal: bedrijf en contact, wat, waarde, afspraak, bron en verantwoordelijke. */
function Formulier({ v, zet, namen }: { v: Velden; zet: (p: Partial<Velden>) => void; namen: string[] }) {
  const uitleg = waardeUitleg(v)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2 sm:col-span-1"><span className={lbl}>Bedrijf *</span><input className={inp} value={v.bedrijf} onChange={(e) => zet({ bedrijf: e.target.value })} placeholder="bv. Kilowot" /></label>
        <label className="block col-span-2 sm:col-span-1"><span className={lbl}>Contactpersoon</span><input className={inp} value={v.contactpersoon} onChange={(e) => zet({ contactpersoon: e.target.value })} /></label>
        <label className="block"><span className={lbl}>E-mail</span><input type="email" className={inp} value={v.email} onChange={(e) => zet({ email: e.target.value })} /></label>
        <label className="block"><span className={lbl}>Telefoon</span><input type="tel" className={inp} value={v.telefoon} onChange={(e) => zet({ telefoon: e.target.value })} /></label>
      </div>
      <label className="block"><span className={lbl}>Info <span className="text-gray-400 font-normal">(vrijblijvend)</span></span>
        <textarea rows={3} className={inp} value={v.titel} onChange={(e) => zet({ titel: e.target.value })} placeholder="bv. AI-automatisatie van hun offertes, budget rond € 8.000, beslissen in januari" />
      </label>
      <div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block"><span className={lbl}>Eenmalig (€)</span><input inputMode="decimal" className={inp} value={v.waarde_eenmalig} onChange={(e) => zet({ waarde_eenmalig: e.target.value })} placeholder="0" /></label>
          <label className="block"><span className={lbl}>Per maand (€)</span><input inputMode="decimal" className={inp} value={v.waarde_maandelijks} onChange={(e) => zet({ waarde_maandelijks: e.target.value })} placeholder="0" /></label>
          <label className="block"><span className={lbl}>Looptijd (maanden)</span><input inputMode="numeric" className={inp} value={v.looptijd_maanden} onChange={(e) => zet({ looptijd_maanden: e.target.value.replace(/\D/g, '') })} placeholder="onbepaald" /></label>
          <label className="block"><span className={lbl}>Maandbedrag vanaf</span><input type="date" className={inp} value={v.start_datum} onChange={(e) => zet({ start_datum: e.target.value })} /></label>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">{uitleg ?? 'Bedragen excl. btw. Zonder looptijd telt het maandbedrag voor één jaar in de waarde.'}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block"><span className={lbl}>Afspraak op</span><input type="datetime-local" className={inp} value={v.afspraak_op} onChange={(e) => zet({ afspraak_op: e.target.value })} /></label>
        <div>
          <span className={lbl}>Verantwoordelijke</span>
          <input className={inp} value={v.verantwoordelijke} onChange={(e) => zet({ verantwoordelijke: e.target.value })} list="ngs-namen" placeholder="bv. Marco" />
          <datalist id="ngs-namen">{namen.map((n) => <option key={n} value={n} />)}</datalist>
          <div className="flex gap-1.5 flex-wrap mt-1.5">{namen.slice(0, 4).map((n) => <PersoonKnop key={n} naam={n} klein rol="button" aan={v.verantwoordelijke === n} onClick={() => zet({ verantwoordelijke: n })} />)}</div>
        </div>
      </div>
      <div>
        <span className={lbl}>Bron</span>
        <div className="flex gap-1.5 flex-wrap">
          {BRONNEN.map((b) => <Chip key={b.key} aan={v.bron === b.key} onClick={() => zet({ bron: v.bron === b.key ? '' : b.key })}>{b.label}</Chip>)}
          {v.bron && !BRONNEN.some((b) => b.key === v.bron) && <Chip aan onClick={() => zet({ bron: '' })}>{bronLabel(v.bron)}</Chip>}
        </div>
      </div>
    </div>
  )
}

type Notitie = { id: string; tekst: string; soort: 'notitie' | 'systeem'; door: string | null; created_at: string; uitkomst?: string | null }

/**
 * Een deal openen of toevoegen. Nieuw: de gegevens en in welke fase hij start.
 * Bestaand: de fase (klik = verplaatsen), de gegevens, de opvolgtaken (ClickUp)
 * en de notities met de tijdlijn.
 */
export function DealVenster({ deal, ik, namen, onSluit, onKlaar, onVerplaats, onVernieuw, vervolg, verkoop }: {
  deal: Deal | null; ik: string | null; namen: string[]
  /** De eerstvolgende meeting van de deal (Meeting Inplanner). */
  vervolg?: Vervolg | null
  /** Instellingen → Werking: auditprijs, opvolgritme, wie de audit doet. */
  verkoop: WerkingInstellingen['verkoop']
  onSluit: () => void
  /** Stil herladen (bv. na een nieuwe opvolgtaak), het venster blijft open. */
  onVernieuw: () => void
  /** Na bewaren; bij een nieuwe deal met zijn id en fase. */
  onKlaar: (m: string, nieuw?: { id: string; fase: Fase }) => void
  onVerplaats: (d: Deal, naar: Fase) => void
}) {
  const [v, setV] = useState<Velden>(() => veldenVan(deal, ik))
  const [fase, setFase] = useState<Fase>('afspraak')
  // Toevoegen als Closed Won (bv. een bestaande klant) of Closed Lost: wanneer, en bij lost waarom.
  const vandaagBE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const [datum, setDatum] = useState(vandaagBE)
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  const [notities, setNotities] = useState<Notitie[] | null>(null)
  const [nieuweNotitie, setNieuweNotitie] = useState('')
  const [notitieBezig, setNotitieBezig] = useState(false)
  const zet = (p: Partial<Velden>) => setV((x) => ({ ...x, ...p }))
  const gewijzigd = deal ? JSON.stringify(veldenVan(deal, ik)) !== JSON.stringify(v) : true

  const laadNotities = useCallback(async () => {
    if (!deal) return
    const r = await fetch(`/api/admin/nextgensolutions?deal=${deal.id}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    setNotities(Array.isArray(j.notities) ? j.notities : [])
  }, [deal])
  useEffect(() => { laadNotities() }, [laadNotities])

  const bewaar = async () => {
    if (!v.bedrijf.trim()) { toast.error('Vul de naam van het bedrijf in.'); return }
    setBezig(true)
    try {
      if (deal) { await post({ actie: 'wijzig', id: deal.id, ...lichaam(v) }); onKlaar('Deal bewaard.') }
      else { const j = await post({ actie: 'nieuw', fase, datum, reden, ...lichaam(v) }); onKlaar(`${v.bedrijf} staat in ${faseLabel(fase)}.`, { id: String(j.id), fase }) }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(false) }
  }
  const voegNotitieToe = async () => {
    if (!deal || !nieuweNotitie.trim()) return
    setNotitieBezig(true)
    try { await post({ actie: 'notitie', id: deal.id, tekst: nieuweNotitie }); setNieuweNotitie(''); await laadNotities() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setNotitieBezig(false) }
  }
  const verwijder = async () => {
    if (!deal || !confirm(`${deal.bedrijf} uit de pipeline en de cijfers halen?`)) return
    try { await post({ actie: 'verwijder', id: deal.id }); onKlaar('Deal verwijderd.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  if (!deal) {
    return (
      <Venster titel="Klant toevoegen" onSluit={onSluit} breed>
        <div>
          <span className={lbl}>Status</span>
          <div className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-gray-100" role="group" aria-label="Status">
            {FASES.filter((f) => f.key !== 'audit' && f.key !== 'opvolgen_rapport').map((f) => (
              <button key={f.key} type="button" onClick={() => setFase(f.key)} aria-pressed={fase === f.key}
                className={`h-9 rounded-lg text-[11px] sm:text-xs leading-tight px-1 ${fase === f.key ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-600'}`}>
                <span className="hidden sm:inline">{f.label}</span><span className="sm:hidden">{f.kort}</span>
              </button>
            ))}
          </div>
          {fase === 'opvolgen' && <p className="text-[11px] text-gray-500 mt-1">Na het toevoegen kies je wanneer je opvolgt; dat wordt een taak in ClickUp.</p>}
        </div>
        {fase === 'won' && (
          <div className="rounded-xl bg-green-50 border border-green-100 p-3 space-y-2">
            <label className="block"><span className={lbl}>Gewonnen op</span><input type="date" className={inp} value={datum} max={vandaagBE} onChange={(e) => setDatum(e.target.value)} /></label>
            <p className="text-[11px] text-green-900">Vul hieronder de waarde in (eenmalig en/of per maand): daar komen de cijfers uit.</p>
          </div>
        )}
        {fase === 'lost' && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-2">
            <span className={lbl}>Waarom ging het niet door?</span>
            <div className="flex gap-1.5 flex-wrap">{VERLOREN_REDENEN.map((r) => <Chip key={r} aan={reden === r} onClick={() => setReden(r)}>{r}</Chip>)}</div>
            <input className={inp} value={reden} onChange={(e) => setReden(e.target.value)} placeholder="Of schrijf het zelf" />
            <label className="block"><span className={lbl}>Op</span><input type="date" className={inp} value={datum} max={vandaagBE} onChange={(e) => setDatum(e.target.value)} /></label>
          </div>
        )}
        <Formulier v={v} zet={zet} namen={namen} />
        <button type="button" onClick={bewaar} disabled={bezig || !v.bedrijf.trim() || (fase === 'lost' && reden.trim().length < 2)} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Toevoegen</button>
      </Venster>
    )
  }

  const stijl = FASE_STIJL[deal.fase]
  return (
    <Venster breed onSluit={onSluit} titel={deal.bedrijf}
      sub={<span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${stijl.stip}`} />{faseLabel(deal.fase)} · {eur(dealWaarde(deal))}</span>}>
      {/* Fase: klik = verplaatsen */}
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 p-1 rounded-xl bg-gray-100" role="group" aria-label="Fase">
        {FASES.map((f) => (
          <button key={f.key} type="button" onClick={() => f.key !== deal.fase && onVerplaats(deal, f.key)} aria-pressed={deal.fase === f.key}
            className={`h-9 rounded-lg text-[11px] sm:text-xs leading-tight px-1 ${deal.fase === f.key ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}>
            <span className="hidden sm:inline">{f.label}</span><span className="sm:hidden">{f.kort}</span>
          </button>
        ))}
      </div>
      {deal.fase === 'won' && deal.gewonnen_op && <p className="text-xs text-green-800 -mt-2">Gewonnen op {dagKort(deal.gewonnen_op)}{deal.waarde_maandelijks ? `, maandbedrag vanaf ${dagKort(deal.start_datum ?? deal.gewonnen_op)}` : ''}.</p>}
      {deal.fase === 'lost' && <p className="text-xs text-gray-600 -mt-2">Verloren{deal.verloren_op ? ` op ${dagKort(deal.verloren_op)}` : ''}: {deal.verloren_reden}</p>}

      {(deal.fase === 'voorstel' || deal.fase === 'opvolgen') && <VervolgBlok deal={deal} vervolg={vervolg ?? null} onVernieuw={onVernieuw} />}
      {isOpvolgFase(deal.fase) && <BelpogingBlok deal={deal} onVernieuw={() => { laadNotities(); onVernieuw() }} />}
      <AuditBlok deal={deal} verkoop={verkoop} onVernieuw={() => { laadNotities(); onVernieuw() }} />

      <ClickupTaken api={`/api/admin/nextgensolutions/deals/${deal.id}/taken`} waarbij="deal" standaardMerk="nextgensolutions" titel="Opvolgtaken (ClickUp)"
        klant={deal.bedrijf} context={[deal.bedrijf, deal.titel].filter(Boolean).join(' · ')} onGewijzigd={() => { laadNotities(); onVernieuw() }} />

      <DealLevering deal={deal} onVernieuw={onVernieuw} />

      <details className="rounded-xl border border-gray-100" open={gewijzigd ? true : undefined}>
        <summary className="px-3.5 py-2.5 text-sm font-semibold cursor-pointer select-none">Gegevens</summary>
        <div className="px-3.5 pb-3.5 space-y-3">
          <Formulier v={v} zet={zet} namen={namen} />
          <button type="button" onClick={bewaar} disabled={bezig || !gewijzigd} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Wijzigingen bewaren</button>
        </div>
      </details>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Notities</h4>
        <div className="relative">
          <textarea rows={2} className={`${inp} pr-10`} value={nieuweNotitie} onChange={(e) => setNieuweNotitie(e.target.value)} placeholder="Wat werd er gezegd, wat is de volgende stap?" />
          <div className="absolute right-1.5 top-1.5"><DicteerKnop klein zet={(f) => setNieuweNotitie(f)} context={deal.bedrijf} /></div>
        </div>
        {nieuweNotitie.trim() && <button type="button" onClick={voegNotitieToe} disabled={notitieBezig} className="btn-secondary text-sm">{notitieBezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Notitie toevoegen</button>}
        {notities === null ? <Loader2 className="h-4 w-4 animate-spin text-gray-300" /> : notities.length === 0 ? <p className="text-xs text-gray-400">Nog niets.</p> : (
          <ul className="space-y-1.5">
            {notities.map((n) => (
              <li key={n.id} className={n.soort === 'systeem' ? 'text-[11px] text-gray-500 px-1' : 'rounded-lg bg-gray-50 border border-gray-100 px-3 py-2'}>
                {n.soort === 'systeem' ? <>{n.tekst} · {tijdstip(n.created_at)}{n.door ? ` · ${n.door}` : ''}</> : (
                  <>
                    {n.uitkomst && <p className="text-[11px] font-semibold text-gray-600">{UITKOMSTEN.find((u) => u.key === n.uitkomst)?.label ?? n.uitkomst}</p>}
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{n.tekst}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{n.door ?? '—'} · {tijdstip(n.created_at)}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" onClick={verwijder} className="text-xs text-red-600 inline-flex items-center gap-1 hover:underline"><Trash2 className="h-3.5 w-3.5" />Deal verwijderen</button>
    </Venster>
  )
}

/**
 * Naar een andere fase. Opvolgen = meteen zeggen wanneer (een taak in ClickUp);
 * Closed Won = datum en de waarde nakijken (daar komen de cijfers uit);
 * Closed Lost = waarom; Afspraak = wanneer.
 */
export function VerplaatsVenster({ deal, naar, onSluit, onKlaar, verkoop }: { deal: Deal; naar: Fase; onSluit: () => void; onKlaar: (m: string) => void; verkoop: WerkingInstellingen['verkoop'] }) {
  const vandaag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const [datum, setDatum] = useState(vandaag)
  const [reden, setReden] = useState('')
  const [w, setW] = useState(() => ({ waarde_eenmalig: bedragTekst(deal.waarde_eenmalig), waarde_maandelijks: bedragTekst(deal.waarde_maandelijks), looptijd_maanden: deal.looptijd_maanden ? String(deal.looptijd_maanden) : '', start_datum: deal.start_datum ?? '' }))
  const [afspraak, setAfspraak] = useState(lokaal(deal.afspraak_op))
  const [bezig, setBezig] = useState(false)

  const verplaats = async (extra: Record<string, unknown> = {}, melding?: string) => {
    setBezig(true)
    try {
      await post({ actie: 'verplaats', id: deal.id, naar, ...extra })
      onKlaar(melding ?? `${deal.bedrijf} staat in ${faseLabel(naar)}.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); setBezig(false) }
  }

  if (naar === 'voorstel') {
    return (
      <Venster titel={`Voorstel: ${deal.bedrijf}`} sub="Wanneer is de vervolgafspraak?" onSluit={onSluit}>
        <NaarVoorstel deal={deal} onKlaar={onKlaar} />
      </Venster>
    )
  }

  if (naar === 'audit') {
    return (
      <Venster titel={`Audit: ${deal.bedrijf}`} sub="Processen, prijs, getekend voorstel, auditdag en presentatie." onSluit={onSluit}>
        <NaarAudit deal={deal} verkoop={verkoop} onKlaar={onKlaar} />
      </Venster>
    )
  }

  if (naar === 'opvolgen' || naar === 'opvolgen_rapport') {
    const label = faseLabel(naar)
    return (
      <Venster titel={`${label}: ${deal.bedrijf}`} sub={`Wanneer bel je? Standaard één keer per week (elke ${verkoop.opvolg_dagen} dagen). Dat wordt een taak in ClickUp.`} onSluit={onSluit}>
        <NieuweTaak basis={`/api/admin/nextgensolutions/deals/${deal.id}/taken`} waarbij="deal" standaardMerk="nextgensolutions" kader={false}
          klant={deal.bedrijf} context={[deal.bedrijf, deal.titel].filter(Boolean).join(' · ')} onSluit={onSluit} standaardDeadline={opvolgDatum(verkoop.opvolg_dagen)}
          onKlaar={() => (deal.fase === naar ? onKlaar('Opvolgtaak staat in ClickUp.') : verplaats({}, `${deal.bedrijf} staat in ${label}, met de taak in ClickUp.`))} />
        {deal.fase !== naar && <button type="button" onClick={() => verplaats()} disabled={bezig} className="w-full text-xs text-gray-500 underline">Verplaatsen zonder opvolgtaak</button>}
      </Venster>
    )
  }

  if (naar === 'won') {
    const e = leesGetal(w.waarde_eenmalig) ?? 0, m = leesGetal(w.waarde_maandelijks) ?? 0
    const uitleg = waardeUitleg(w)
    const bewaar = async () => {
      setBezig(true)
      try {
        // Eerst de waarde (daar komen de cijfers uit), dan de fase.
        await post({ actie: 'wijzig', id: deal.id, ...dealLichaam(deal, { ...w, start_datum: w.start_datum }) })
        await verplaats({ datum }, `Closed Won: ${deal.bedrijf}. Proficiat!`)
      } catch (x) { toast.error(x instanceof Error ? x.message : 'Mislukt'); setBezig(false) }
    }
    return (
      <Venster titel={`Closed Won: ${deal.bedrijf}`} sub="Kijk de waarde na, daar komen de cijfers uit." onSluit={onSluit}>
        <label className="block"><span className={lbl}>Gewonnen op</span><input type="date" className={inp} value={datum} max={vandaag} onChange={(x) => setDatum(x.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Eenmalig (€)</span><input inputMode="decimal" className={inp} value={w.waarde_eenmalig} onChange={(x) => setW({ ...w, waarde_eenmalig: x.target.value })} placeholder="0" /></label>
          <label className="block"><span className={lbl}>Per maand (€)</span><input inputMode="decimal" className={inp} value={w.waarde_maandelijks} onChange={(x) => setW({ ...w, waarde_maandelijks: x.target.value })} placeholder="0" /></label>
          <label className="block"><span className={lbl}>Looptijd (maanden)</span><input inputMode="numeric" className={inp} value={w.looptijd_maanden} onChange={(x) => setW({ ...w, looptijd_maanden: x.target.value.replace(/\D/g, '') })} placeholder="onbepaald" /></label>
          <label className="block"><span className={lbl}>Maandbedrag vanaf</span><input type="date" className={inp} value={w.start_datum || datum} onChange={(x) => setW({ ...w, start_datum: x.target.value })} /></label>
        </div>
        <div className="rounded-xl bg-green-50 border border-green-100 px-3.5 py-3 text-sm text-green-900">
          {e || m ? uitleg : 'Nog geen bedrag ingevuld: de deal telt dan voor € 0 in de cijfers.'}
        </div>
        <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Closed Won</button>
      </Venster>
    )
  }

  if (naar === 'lost') {
    return (
      <Venster titel={`Closed Lost: ${deal.bedrijf}`} onSluit={onSluit}>
        <div>
          <span className={lbl}>Waarom ging het niet door?</span>
          <div className="flex gap-1.5 flex-wrap mb-2">{VERLOREN_REDENEN.map((r) => <Chip key={r} aan={reden === r} onClick={() => setReden(r)}>{r}</Chip>)}</div>
          <textarea rows={2} className={inp} value={reden} onChange={(x) => setReden(x.target.value)} placeholder="Of schrijf het zelf" />
        </div>
        <label className="block"><span className={lbl}>Op</span><input type="date" className={inp} value={datum} max={vandaag} onChange={(x) => setDatum(x.target.value)} /></label>
        <button type="button" onClick={() => verplaats({ datum, reden })} disabled={bezig || reden.trim().length < 2} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Closed Lost</button>
      </Venster>
    )
  }

  // Terug naar Afspraak: wanneer is ze?
  return (
    <Venster titel={`Afspraak: ${deal.bedrijf}`} onSluit={onSluit}>
      <label className="block"><span className={lbl}>Wanneer</span><input type="datetime-local" className={inp} value={afspraak} onChange={(x) => setAfspraak(x.target.value)} /></label>
      <button type="button" disabled={bezig} className="btn-primary w-full" onClick={async () => {
        setBezig(true)
        try {
          if (afspraak !== lokaal(deal.afspraak_op)) await post({ actie: 'wijzig', id: deal.id, ...dealLichaam(deal, { afspraak_op: afspraak }) })
          await verplaats()
        } catch (x) { toast.error(x instanceof Error ? x.message : 'Mislukt'); setBezig(false) }
      }}>{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Naar Afspraak</button>
    </Venster>
  )
}

