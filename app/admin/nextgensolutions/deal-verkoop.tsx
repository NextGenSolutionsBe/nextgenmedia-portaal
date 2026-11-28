'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, CalendarPlus, Check, FileText, Loader2, Phone } from 'lucide-react'
import { NieuweTaak } from '@/components/admin/clickup-taken'
import { DicteerKnop } from '@/components/admin/dicteer-knop'
import { UITKOMSTEN } from '@/lib/abm'
import { AUDIT_STAPPEN, leesChecklist, presentatieMinuten, faseLabel, type Deal } from '@/lib/ngs/model'
import { auditPrijs, type WerkingInstellingen } from '@/lib/werking/instellingen'
import type { Vervolg } from '@/lib/ngs/server'
import { Chip, dagKort, eur, inp, lbl, post, tijdstip } from './ui'

type Verkoop = WerkingInstellingen['verkoop']
const lokaal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const plusDagen = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const inplanLink = (deal: Deal) => `/admin/meetings?plan=1&deal=${deal.id}${deal.client_id ? `&klant=${deal.client_id}` : ''}`

/**
 * Voorstel: in het gesprek plan je meteen de volgende afspraak, en het voorstel
 * stuur je vooraf. De vervolgafspraak komt uit de Meeting Inplanner (gekoppeld
 * aan de deal) of je vult ze zelf in. Zonder vervolgafspraak kan het voorstel niet weg.
 */
export function VervolgBlok({ deal, vervolg, onVernieuw }: { deal: Deal; vervolg: Vervolg | null; onVernieuw: () => void }) {
  const [hand, setHand] = useState(lokaal(deal.vervolg_op ?? null))
  const [bezig, setBezig] = useState(false)
  const wanneer = vervolg?.starts_at ?? deal.vervolg_op ?? null
  const voorbij = !!wanneer && wanneer < new Date().toISOString()
  const bewaar = async () => {
    setBezig(true)
    try { await post({ actie: 'vervolg', id: deal.id, vervolg_op: hand ? new Date(hand).toISOString() : null }); toast.success(hand ? 'Vervolgafspraak bewaard.' : 'Weggehaald.'); onVernieuw() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <section className={`rounded-xl border p-3.5 space-y-2.5 ${wanneer && !voorbij ? 'border-gray-100' : 'border-amber-300 bg-amber-50'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold flex-1">Vervolgafspraak</span>
        <a href={inplanLink(deal)} target="_blank" rel="noopener" className="btn-secondary !py-1 text-xs"><CalendarPlus className="h-3.5 w-3.5" />Inplannen</a>
      </div>
      {wanneer && !voorbij
        ? <p className="text-sm text-gray-800">{tijdstip(wanneer)}{vervolg?.titel ? ` · ${vervolg.titel}` : ''}</p>
        : <p className="text-sm text-amber-900 inline-flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />{voorbij ? 'De vervolgafspraak is voorbij. Plan de volgende.' : 'Nog geen vervolgafspraak. Plan ze in het gesprek, het voorstel stuur je vooraf.'}</p>}
      <details>
        <summary className="text-xs text-gray-500 cursor-pointer">Al elders vastgelegd? Zelf invullen</summary>
        <div className="flex gap-2 mt-2">
          <input type="datetime-local" className={inp} value={hand} onChange={(e) => setHand(e.target.value)} aria-label="Vervolgafspraak" />
          <button type="button" onClick={bewaar} disabled={bezig} className="btn-secondary !py-1 text-xs shrink-0">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Bewaren</button>
        </div>
      </details>
      <VoorstelKnop deal={deal} heeftVervolg={!!wanneer && !voorbij} />
    </section>
  )
}

/** Het voorstel = een contract van NextGenSolutions voor de klant van de deal. Pas als de vervolgafspraak er staat. */
export function VoorstelKnop({ deal, heeftVervolg }: { deal: Deal; heeftVervolg: boolean }) {
  if (!deal.client_id) return <p className="text-[11px] text-gray-500">Koppel de klant (onderaan) om het voorstel op te maken.</p>
  if (!heeftVervolg) return <button type="button" disabled className="btn-primary w-full !py-1.5 text-sm opacity-50" title="Eerst de vervolgafspraak"><FileText className="h-4 w-4" />Voorstel opmaken (eerst de vervolgafspraak)</button>
  return <Link href={`/admin/contracts/templates?client=${deal.client_id}&deal=${deal.id}`} className="btn-primary w-full !py-1.5 text-sm justify-center"><FileText className="h-4 w-4" />Voorstel opmaken</Link>
}

/**
 * Opvolgen (voorstel of rapport): elke week bellen, tenzij anders afgesproken.
 * Na een gelogde belpoging stelt de app de volgende opvolgtaak voor (standaard
 * 7 dagen later, Instellingen → Werking); de datum pas je aan, de taak maak je zelf.
 */
export function BelpogingBlok({ deal, onVernieuw }: { deal: Deal; onVernieuw: () => void }) {
  const [uitkomst, setUitkomst] = useState<string>('')
  const [tekst, setTekst] = useState('')
  const [bezig, setBezig] = useState(false)
  const [voorstel, setVoorstel] = useState<string | null>(null)
  const log = async () => {
    if (!uitkomst) { toast.error('Hoe ging het gesprek?'); return }
    setBezig(true)
    try { const j = await post({ actie: 'belpoging', id: deal.id, uitkomst, tekst }); setVoorstel(String(j.voorstel)); setTekst(''); setUitkomst(''); onVernieuw() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  if (voorstel) {
    return (
      <section className="rounded-xl border border-gray-100 p-3.5 space-y-2">
        <div className="text-sm font-semibold">Volgende opvolging</div>
        <NieuweTaak basis={`/api/admin/nextgensolutions/deals/${deal.id}/taken`} waarbij="deal" standaardMerk="nextgensolutions" kader={false}
          klant={deal.bedrijf} context={[deal.bedrijf, deal.titel].filter(Boolean).join(' · ')} standaardDeadline={voorstel}
          onSluit={() => setVoorstel(null)} onKlaar={() => { setVoorstel(null); toast.success('De opvolgtaak staat in ClickUp.'); onVernieuw() }} />
      </section>
    )
  }
  return (
    <section className="rounded-xl border border-gray-100 p-3.5 space-y-2.5">
      <div className="text-sm font-semibold inline-flex items-center gap-1.5"><Phone className="h-4 w-4" />Belpoging</div>
      <div className="flex gap-1.5 flex-wrap">{UITKOMSTEN.map((u) => <Chip key={u.key} aan={uitkomst === u.key} onClick={() => setUitkomst(u.key)}>{u.label}</Chip>)}</div>
      <div className="relative">
        <textarea rows={2} className={`${inp} pr-10`} value={tekst} onChange={(e) => setTekst(e.target.value)} placeholder="Wat werd er gezegd? (optioneel)" />
        <div className="absolute right-1.5 top-1.5"><DicteerKnop klein zet={(f) => setTekst(f)} context={deal.bedrijf} /></div>
      </div>
      <button type="button" onClick={log} disabled={bezig || !uitkomst} className="btn-secondary w-full !py-1.5 text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Gesprek loggen</button>
    </section>
  )
}

/** De audit in het dealvenster: wat afgesproken is en de checklist (auditdag, briefing, rapport, presentatie). */
export function AuditBlok({ deal, verkoop, onVernieuw }: { deal: Deal; verkoop: Verkoop; onVernieuw: () => void }) {
  const [bezig, setBezig] = useState<string | null>(null)
  if (!deal.auditdag_op && !deal.processen) return null
  const lijst = leesChecklist(deal.audit_checklist)
  const wie = (k: 'auditdag' | 'rapport') => (k === 'auditdag' ? verkoop.auditdag_door : verkoop.rapport_door)
  const vink = async (stap: string, aan: boolean) => {
    setBezig(stap)
    try { await post({ actie: 'auditstap', id: deal.id, stap, aan }); onVernieuw() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  return (
    <section className="rounded-xl border border-blue-100 bg-blue-50/40 p-3.5 space-y-2.5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold">Audit</span>
        <span className="text-xs text-gray-600">{deal.processen} {deal.processen === 1 ? 'proces' : 'processen'} · {eur(deal.audit_prijs ?? 0)}</span>
      </div>
      <p className="text-xs text-gray-700">
        Auditdag {deal.auditdag_op ? dagKort(deal.auditdag_op) : '—'} · presentatie {deal.presentatie_op ? dagKort(deal.presentatie_op) : '—'} (± {presentatieMinuten(deal.processen, verkoop.presentatie_min_per_proces)} min)
        {deal.audit_buiten_app ? ' · voorstel buiten de app getekend' : deal.audit_contract_id ? ' · voorstel getekend in de app' : ''}
      </p>
      <ul className="space-y-1.5">
        {AUDIT_STAPPEN.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 rounded-lg bg-white border border-gray-100 px-3 py-2">
            <input type="checkbox" className="h-4 w-4" checked={!!lijst[s.key]} disabled={bezig === s.key} onChange={(e) => vink(s.key, e.target.checked)} aria-label={`${s.titel} afvinken`} />
            <span className={`text-sm flex-1 ${lijst[s.key] ? 'line-through text-gray-500' : ''}`}>{s.key === 'briefing' ? `Briefing van 30 minuten aan ${verkoop.rapport_door}` : s.titel}</span>
            <span className="text-[11px] text-gray-500">{wie(s.wie)}{lijst[s.key] ? ` · ${dagKort(lijst[s.key]!)}` : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Naar Voorstel: de vervolgafspraak inplannen (of zelf invullen). Zonder kan ook, dan een gele waarschuwing op de kaart. */
export function NaarVoorstel({ deal, onKlaar }: { deal: Deal; onKlaar: (m: string) => void }) {
  const [hand, setHand] = useState(lokaal(deal.vervolg_op ?? null))
  const [bezig, setBezig] = useState(false)
  const verplaats = async (met: boolean) => {
    setBezig(true)
    try { await post({ actie: 'verplaats', id: deal.id, naar: 'voorstel', ...(met && hand ? { vervolg_op: new Date(hand).toISOString() } : {}) }); onKlaar(`${deal.bedrijf} staat in Voorstel.`) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); setBezig(false) }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">Plan in het gesprek meteen de vervolgafspraak. Het voorstel stuur je vooraf.</p>
      <a href={inplanLink(deal)} target="_blank" rel="noopener" className="btn-secondary w-full justify-center"><CalendarPlus className="h-4 w-4" />Inplannen in de Meeting Inplanner</a>
      <label className="block"><span className={lbl}>Of de datum die al vastligt</span><input type="datetime-local" className={inp} value={hand} onChange={(e) => setHand(e.target.value)} /></label>
      <button type="button" onClick={() => verplaats(true)} disabled={bezig || !hand} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Naar Voorstel</button>
      <button type="button" onClick={() => verplaats(false)} disabled={bezig} className="w-full text-xs text-gray-500 underline">Verplaatsen zonder vervolgafspraak (gele waarschuwing op de kaart)</button>
      <p className="text-[11px] text-gray-500">Plan je in de Meeting Inplanner, dan komt de afspraak vanzelf bij de deal (het venster opent in een nieuw tabblad).</p>
    </div>
  )
}

/**
 * Naar Audit: processen (1 tot max), de prijs (basis + per proces), het getekende
 * voorstel, de auditdag en de presentatie (richtlijn: hoogstens x dagen na de
 * auditdag, later mag met een waarschuwing). Alles uit Instellingen → Werking.
 */
export function NaarAudit({ deal, verkoop, onKlaar }: { deal: Deal; verkoop: Verkoop; onKlaar: (m: string) => void }) {
  const [n, setN] = useState(deal.processen ?? 1)
  const [contracten, setContracten] = useState<{ id: string; titel: string; getekend: string | null }[] | null>(null)
  const [contract, setContract] = useState(deal.audit_contract_id ?? '')
  const [buiten, setBuiten] = useState(deal.audit_buiten_app ?? false)
  const [notitie, setNotitie] = useState(deal.audit_buiten_notitie ?? '')
  const [auditdag, setAuditdag] = useState(deal.auditdag_op ?? '')
  const [presentatie, setPresentatie] = useState(deal.presentatie_op ?? '')
  const [bezig, setBezig] = useState(false)
  useEffect(() => {
    fetch(`/api/admin/nextgensolutions?contracten=${deal.id}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { contracten: [] })).then((j) => setContracten(j.contracten ?? [])).catch(() => setContracten([]))
  }, [deal.id])
  const prijs = auditPrijs(n, verkoop)
  const getekend = (contracten ?? []).filter((c) => c.getekend)
  const teLaat = auditdag && presentatie && presentatie > plusDagen(auditdag, verkoop.presentatie_max_dagen)
  const kan = !!auditdag && !!presentatie && presentatie >= auditdag && (!!contract || buiten) && (!!deal.client_id || !!contract)
  const bewaar = async () => {
    setBezig(true)
    try {
      const j = await post({ actie: 'verplaats', id: deal.id, naar: 'audit', processen: n, audit_contract_id: contract || null, audit_buiten_app: !contract && buiten, audit_buiten_notitie: notitie, auditdag_op: auditdag, presentatie_op: presentatie })
      if (j.waarschuwing) toast.warning(String(j.waarschuwing))
      onKlaar(`${deal.bedrijf} staat in ${faseLabel('audit')}.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); setBezig(false) }
  }
  return (
    <div className="space-y-3.5">
      <div>
        <span className={lbl}>Hoeveel processen?</span>
        <div className="flex gap-1.5 flex-wrap">{Array.from({ length: verkoop.max_processen }, (_, i) => i + 1).map((k) => <Chip key={k} aan={n === k} onClick={() => setN(k)}>{k}</Chip>)}</div>
        <p className="text-sm font-semibold mt-1.5">Auditprijs {eur(prijs)} <span className="font-normal text-xs text-gray-500">({eur(verkoop.audit_basis)} + {n} × {eur(verkoop.audit_per_proces)})</span></p>
      </div>
      <div>
        <span className={lbl}>Getekend voorstel</span>
        {contracten === null ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : (
          <select className={inp} value={contract} onChange={(e) => { setContract(e.target.value); if (e.target.value) setBuiten(false) }}>
            <option value="">{getekend.length ? 'Kies het getekende contract' : 'Nog geen getekend contract in de app'}</option>
            {getekend.map((c) => <option key={c.id} value={c.id}>{c.titel} · getekend {dagKort(c.getekend!)}</option>)}
          </select>
        )}
        {!contract && (
          <label className="flex items-center gap-2 mt-2 text-sm"><input type="checkbox" checked={buiten} onChange={(e) => setBuiten(e.target.checked)} />Getekend buiten de app</label>
        )}
        {!contract && buiten && <input className={`${inp} mt-1.5`} value={notitie} onChange={(e) => setNotitie(e.target.value)} placeholder="Hoe? bv. per mail op 2 december" />}
        {!contract && !deal.client_id && <p className="text-[11px] text-amber-800 mt-1">Koppel eerst de klant in het dealvenster (Klant in de app).</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={lbl}>Auditdag</span><input type="date" className={inp} value={auditdag} onChange={(e) => setAuditdag(e.target.value)} /></label>
        <label className="block"><span className={lbl}>Presentatie rapport</span><input type="date" className={inp} value={presentatie} min={auditdag || undefined} onChange={(e) => setPresentatie(e.target.value)} /></label>
      </div>
      {teLaat && <p className="text-xs text-amber-800 inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Later dan {verkoop.presentatie_max_dagen} dagen na de auditdag. Kan, maar leg het vast op de auditdag zelf.</p>}
      <p className="text-[11px] text-gray-500">Presentatie: ongeveer {presentatieMinuten(n, verkoop.presentatie_min_per_proces)} minuten ({verkoop.presentatie_min_per_proces} per proces).</p>
      <button type="button" onClick={bewaar} disabled={bezig || !kan} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Naar Audit</button>
    </div>
  )
}
