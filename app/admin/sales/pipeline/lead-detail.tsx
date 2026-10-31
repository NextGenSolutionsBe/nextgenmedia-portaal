'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  X, Phone, Mail, Globe, Pencil, StickyNote,
  PhoneOff, Trash2, History, Bot, Flame, Loader2, Check, Linkedin, MapPin, Users,
} from 'lucide-react'
import { STAGES, stageLabel, mistVerantwoordelijke } from '@/lib/sales/stages'
import { LEADBRONNEN, leadbronLabel } from '@/lib/sales/leadbron'
import { merkStijl } from '@/lib/sales/merk'
import { LeadGegevens } from './lead-gegevens'
import { LeadTijdlijn } from './lead-tijdlijn'
import { DienstenLijst } from './lead-dialogen'
import { leesGetal } from '@/lib/getal'
import { LeadControle } from './lead-controle'
import { LeadLabels } from './lead-labels'
import { LeadActiviteiten, BEHEERBARE_TYPES } from './lead-activiteiten'
import { LeadTaken } from './lead-taken'
import type { Activiteit } from '@/lib/sales/activiteiten-model'
import {
  type Lead, type Medewerker, type Pipeline, emailVan, euro, korteDatum, merkenVan, telefoonVan,
} from './types'

export type DialoogSoort = 'gesprek' | 'email' | 'notitie' | 'voorstel' | 'opvolg'


/** Vanaf deze fases ligt het merk vast (er is een afspraak geweest). */
// Opvolgen hoort erbij: daar staan ook de leads met een verstuurd voorstel.
const MERK_VAST = ['opvolgen', 'afspraak', 'gewonnen', 'verloren']

/** De gegevens die je in de fiche invult en in één keer bewaart. */
type Concept = { leadbron: string; assigned_to: string; opvolgdatum: string; dienst: string; verwacht: string; labels: string[]; merken: string[] }

/**
 * Het detailpaneel van één lead: schuift van rechts in. Alles wat je over de
 * lead wil weten en aanpassen, zonder het bord te verlaten.
 */
export function LeadDetail({
  lead, pipelines, medewerkers, meId, isAdmin, labelSuggesties = [], onChanged, onClose, onDialoog, onFase,
}: {
  lead: Lead
  /** Labels die al ergens op het bord voorkomen (suggesties bij toevoegen). */
  labelSuggesties?: string[]
  pipelines: Pipeline[]
  medewerkers: Medewerker[]
  meId: string | null
  isAdmin: boolean
  onChanged: () => void
  onClose: () => void
  onDialoog: (soort: DialoogSoort) => void
  /** Fase kiezen; gewonnen/verloren opent de sluitdialoog bij de ouder. */
  onFase: (stage: string) => void
}) {
  const [bezig, setBezig] = useState(false)
  const [bewerken, setBewerken] = useState(false)
  const [ververs, setVerversen] = useState(0)
  const [activiteiten, setActiviteiten] = useState<Activiteit[] | null>(null)
  const notities = activiteiten ? activiteiten.filter((a) => a.type === 'interne_notitie') : null
  const andereActiviteiten = (activiteiten ?? []).filter((a) => (BEHEERBARE_TYPES as string[]).includes(a.type))
  const [bewerkId, setBewerkId] = useState<string | null>(null)
  const [bewerkTekst, setBewerkTekst] = useState('')
  const [nieuweNotitie, setNieuweNotitie] = useState('')
  // Gegevens van de lead als concept: invullen gaat meteen, bewaren gebeurt in één keer
  // met de knop onderaan (geen autosave bij elke wijziging; dat voelde traag).
  const vanLead = useCallback((): Concept => ({
    leadbron: lead.leadbron ?? 'outbound', assigned_to: lead.assigned_to ?? '', opvolgdatum: lead.opvolgdatum?.slice(0, 10) ?? '',
    dienst: lead.dienst ?? '', verwacht: verwachtAlsTekst(lead.verwachte_omzet_cents), labels: lead.labels ?? [],
    merken: merkenVan(lead, pipelines).map((m) => m.key),
  }), [lead, pipelines])
  const [concept, setConcept] = useState<Concept>(vanLead)
  const [bewaren, setBewaren] = useState(false)
  const basis = vanLead()
  const gewijzigd = (Object.keys(basis) as (keyof Concept)[]).filter((k) => JSON.stringify(concept[k]) !== JSON.stringify(basis[k]))
  // Andere lead of wijziging van elders: concept opnieuw vullen, behalve wat je net aanpast.
  const vorigeLead = useRef(lead.id)
  const netBewaard = useRef(false)
  useEffect(() => {
    if (vorigeLead.current !== lead.id) { vorigeLead.current = lead.id; setConcept(vanLead()); return }
    // Na bewaren: de server kan opmaak normaliseren (bv. 3250 → 3.250); neem die over.
    if (netBewaard.current || !gewijzigd.length) { netBewaard.current = false; setConcept(vanLead()) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.updated_at])
  const zet = <K extends keyof Concept>(k: K, w: Concept[K]) => setConcept((c) => ({ ...c, [k]: w }))

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key === 'Escape' && !(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))) sluitRef.current()
      // Cmd/Ctrl+S bewaart de gegevens.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); bewaarRef.current() }
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])

  const sluitRef = useRef<() => void>(() => onClose())
  const bewaarRef = useRef<() => void>(() => undefined)

  const laadNotities = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/sales/activiteiten?lead=${lead.id}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setActiviteiten((j.activiteiten ?? []) as Activiteit[])
    } catch { setActiviteiten([]) }
  }, [lead.id])
  useEffect(() => { laadNotities() }, [laadNotities, ververs])

  // Wijzigingen elders (dialogen, bord) → tijdlijn en notities herladen.
  useEffect(() => { setVerversen((n) => n + 1) }, [lead.updated_at, lead.laatste_notitie])

  /** Alle gewijzigde gegevens in één keer bewaren. */
  const bewaarConcept = async () => {
    if (!gewijzigd.length || bewaren) return
    const body: Record<string, unknown> = {}
    for (const k of gewijzigd) {
      if (k === 'verwacht') {
        const tekst = concept.verwacht.trim()
        const nieuw = tekst === '' ? null : leesGetal(tekst)
        if (tekst !== '' && (nieuw === null || nieuw < 0)) { toast.error('De verwachte omzet klopt niet (bv. 3.250 of 3250,50).'); return }
        body.verwachte_omzet = nieuw
      } else if (k === 'merken') {
        if (!concept.merken.length) { toast.error('Een lead hoort bij minstens één merk.'); return }
        body.merken = concept.merken
      } else if (k === 'assigned_to' || k === 'opvolgdatum' || k === 'dienst') body[k] = String(concept[k]).trim() || null
      else body[k] = concept[k]
    }
    setBewaren(true)
    try {
      const r = await fetch(`/api/admin/sales/leads/${lead.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      toast.success('Lead bijgewerkt.', { duration: 1500 })
      netBewaard.current = true
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBewaren(false) }
  }
  const sluit = () => {
    if (gewijzigd.length && !confirm('Je hebt wijzigingen die nog niet bewaard zijn. Toch sluiten?')) return
    onClose()
  }
  sluitRef.current = sluit
  bewaarRef.current = () => { void bewaarConcept() }

  const patch = async (body: Record<string, unknown>, okMsg?: string): Promise<boolean> => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/sales/leads/${lead.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      if (okMsg) toast.success(okMsg, { duration: 1500 })
      setVerversen((n) => n + 1)
      onChanged()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
      return false
    } finally { setBezig(false) }
  }

  /** De lead volledig verwijderen (niet archiveren) — na bevestiging. */
  const verwijderLead = async () => {
    const naam = lead.sales_companies?.name ?? 'deze lead'
    if (!confirm(`"${naam}" volledig verwijderen?

De lead, de tijdlijn, notities en activiteiten verdwijnen definitief. Afspraken en opdrachten blijven bestaan, maar zonder koppeling. Dit kan niet ongedaan gemaakt worden.`)) return
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/sales/leads/${lead.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Verwijderen mislukt')
      toast.success(`${naam} verwijderd.`)
      onChanged()
      onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBezig(false) }
  }

  const voegNotitieToe = async () => {
    const tekst = nieuweNotitie.trim()
    if (!tekst) return
    setBezig(true)
    try {
      const r = await fetch('/api/admin/sales/activiteiten', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, type: 'interne_notitie', notitie: tekst }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      setNieuweNotitie('')
      toast.success('Notitie opgeslagen.', { duration: 1500 })
      setVerversen((n) => n + 1)
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  const bewaarBewerking = async (id: string) => {
    const tekst = bewerkTekst.trim()
    if (!tekst) { toast.error('Een notitie zonder tekst heeft geen zin.'); return }
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/sales/activiteiten/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notitie: tekst }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      setBewerkId(null)
      toast.success('Notitie aangepast.', { duration: 1500 })
      setVerversen((n) => n + 1)
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  const verwijderNotitie = async (id: string) => {
    if (!window.confirm('Deze notitie verwijderen?\n\nZe verdwijnt uit de lijst en uit de tijdlijn.')) return
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/sales/activiteiten/${id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Verwijderen mislukt')
      if (bewerkId === id) setBewerkId(null)
      toast.success('Notitie verwijderd.', { duration: 1500 })
      setVerversen((n) => n + 1)
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBezig(false) }
  }

  const tel = telefoonVan(lead)
  const mail = emailVan(lead)
  const website = lead.sales_companies?.website
  const naamVan = (id: string | null, email: string | null) =>
    medewerkers.find((m) => m.id === id)?.naam ?? email?.split('@')[0] ?? 'onbekend'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={(e) => { if (e.target === e.currentTarget) sluit() }}>
      <aside className="h-full w-full sm:max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Kop */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {merkenVan(lead, pipelines).map((p) => (
                <span key={p.id} title={p.name} className={`inline-block h-2.5 w-2.5 rounded-full ${merkStijl(p.key).stip}`} />
              ))}
              <h2 className="font-semibold text-gray-900 text-lg truncate">{lead.sales_companies?.name ?? 'Lead'}</h2>
              {lead.warm && <Flame className="h-4 w-4 text-orange-500 shrink-0" aria-label="Warm" />}
            </div>
            <p className="text-sm text-gray-600 truncate">
              {[lead.sales_contacts?.name, lead.sales_contacts?.role].filter(Boolean).join(' · ') || 'Geen contactpersoon'}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setBewerken((v) => !v)} title="Gegevens aanpassen"
              className={`h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 ${bewerken ? 'bg-gray-100 text-black' : 'text-gray-400'}`}>
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={sluit} aria-label="Sluiten" className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Contact en bedrijf */}
          {bewerken ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
              <LeadGegevens leadId={lead.id} bedrijf={lead.sales_companies} contact={lead.sales_contacts}
                onOpgeslagen={() => { setVerversen((n) => n + 1); onChanged() }} onKlaar={() => setBewerken(false)} />
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              {tel && (
                <a href={`tel:${tel.replace(/[^\d+]/g, '')}`} onClick={() => onDialoog('gesprek')} className="flex items-center gap-2 font-medium hover:underline">
                  <Phone className="h-4 w-4 text-gray-400" />{tel}
                </a>
              )}
              {mail && (
                <a href={`mailto:${mail}`} className="flex items-center gap-2 text-gray-700 hover:underline truncate">
                  <Mail className="h-4 w-4 text-gray-400" />{mail}
                </a>
              )}
              {website && (
                <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-gray-700 hover:underline truncate">
                  <Globe className="h-4 w-4 text-gray-400" />{website}
                </a>
              )}
              {lead.sales_companies?.phone && lead.sales_companies.phone !== tel && (
                <a href={`tel:${lead.sales_companies.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 text-gray-500 hover:underline">
                  <Phone className="h-4 w-4 text-gray-300" />{lead.sales_companies.phone} <span className="text-xs">(algemeen)</span>
                </a>
              )}
              {lead.sales_contacts?.linkedin && (
                <a href={lead.sales_contacts.linkedin.startsWith('http') ? lead.sales_contacts.linkedin : `https://${lead.sales_contacts.linkedin}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-gray-700 hover:underline truncate">
                  <Linkedin className="h-4 w-4 text-gray-400" />LinkedIn {lead.sales_contacts.name ?? 'contactpersoon'}
                </a>
              )}
              {lead.sales_companies?.linkedin && (
                <a href={lead.sales_companies.linkedin.startsWith('http') ? lead.sales_companies.linkedin : `https://${lead.sales_companies.linkedin}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-gray-700 hover:underline truncate">
                  <Linkedin className="h-4 w-4 text-gray-400" />LinkedIn bedrijf
                </a>
              )}
              {(lead.sales_companies?.city || lead.sales_companies?.country) && (
                <p className="flex items-center gap-2 text-gray-500">
                  <MapPin className="h-4 w-4 text-gray-300" />
                  {[lead.sales_companies?.city, lead.sales_companies?.region, lead.sales_companies?.country].filter(Boolean).join(', ')}
                </p>
              )}
              {(lead.sales_companies?.employees || lead.sales_companies?.werkklasse) && (
                <p className="flex items-center gap-2 text-gray-500">
                  <Users className="h-4 w-4 text-gray-300" />
                  {lead.sales_companies?.employees || lead.sales_companies?.werkklasse} werknemers
                </p>
              )}
              {!tel && !mail && !website && <p className="text-xs text-gray-400">Nog geen contactgegevens — klik op het potlood.</p>}
            </div>
          )}
          <LeadControle leadId={lead.id} />

          {/* Vanaf Afspraak gepland hoort er een verantwoordelijke bij (statistieken per medewerker). */}
          {mistVerantwoordelijke({ stage_key: lead.stage_key, assigned_to: concept.assigned_to || null }) && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 space-y-1.5">
              <div className="text-sm font-semibold text-red-700">Geen medewerker verantwoordelijk</div>
              <p className="text-xs text-red-700/90">Vanaf {stageLabel('afspraak')} hoort er een medewerker bij deze lead, zodat de statistieken en closing rate per medewerker kloppen.</p>
              <select className="input-base text-sm" value=""
                onChange={(e) => { if (e.target.value) zet('assigned_to', e.target.value) }}>
                <option value="">Kies de verantwoordelijke…</option>
                {meId && <option value={meId}>Ik</option>}
                {medewerkers.filter((m) => m.id !== meId).map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
              </select>
            </div>
          )}

          {/* Fase, bron, verantwoordelijke, dienst, opvolgdatum */}
          <div className="grid grid-cols-2 gap-2">
            <Label tekst="Fase">
              <select className="input-base text-sm" value={lead.stage_key} disabled={bezig} onChange={(e) => onFase(e.target.value)}>
                {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Label>
            <Label tekst="Leadbron">
              <select className="input-base text-sm" value={concept.leadbron} onChange={(e) => zet('leadbron', e.target.value)}>
                {LEADBRONNEN.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            </Label>
            <Label tekst="Verantwoordelijke">
              <select className="input-base text-sm" value={concept.assigned_to} onChange={(e) => zet('assigned_to', e.target.value)}>
                <option value="">Niemand</option>
                {medewerkers.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
                {lead.assigned_to && !medewerkers.some((m) => m.id === lead.assigned_to) && (
                  <option value={lead.assigned_to}>Onbekende medewerker</option>
                )}
              </select>
            </Label>
            <Label tekst="Opvolgdatum">
              <input type="date" className="input-base text-sm" value={concept.opvolgdatum} onChange={(e) => zet('opvolgdatum', e.target.value)} />
            </Label>
            <div className="col-span-2">
              <Label tekst="Geïnteresseerde dienst">
                <input className="input-base text-sm" list="diensten-lijst" value={concept.dienst} onChange={(e) => zet('dienst', e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void bewaarConcept() } }} />
              </Label>
              <DienstenLijst />
            </div>
          </div>

          {/* Verwachte omzet: indicatief en handmatig — maakt of wijzigt geen opdracht, contract of factuur. */}
          <Label tekst="Verwachte omzet (€)">
            <input className="input-base text-sm" inputMode="decimal" placeholder="bv. 3.250 — indicatief"
              value={concept.verwacht} onChange={(e) => zet('verwacht', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void bewaarConcept() } }} />
          </Label>

          <LeadLabels labels={concept.labels} suggesties={labelSuggesties} bezig={false}
            onOpslaan={async (labels) => { zet('labels', labels); return true }} />

          {/* Gewonnen / verloren */}
          {lead.stage_key === 'gewonnen' && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm">
              <b className="text-green-800">Gewonnen</b>
              {lead.gesloten_op && <> op {new Date(lead.gesloten_op).toLocaleDateString('nl-BE')}</>}
              {(lead.verwachte_omzet_cents ?? 0) > 0 && <> · verwacht {euro(lead.verwachte_omzet_cents)}</>}
              {lead.dienst && <> · {lead.dienst}</>}
            </div>
          )}
          {lead.stage_key === 'verloren' && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm">
              <b className="text-red-700">Verloren</b>
              {lead.gesloten_op && <> op {new Date(lead.gesloten_op).toLocaleDateString('nl-BE')}</>}
              {(lead.verlies_reden || lead.lost_reason) && <p className="text-xs text-red-800 mt-0.5">{lead.verlies_reden || lead.lost_reason}</p>}
            </div>
          )}

          {/* Merk: pas vanaf de afspraak */}
          {pipelines.length > 1 && MERK_VAST.includes(lead.stage_key) && (
            <Label tekst="Merk">
              <div className="flex gap-1.5">
                {pipelines.map((p) => {
                  const actief = concept.merken
                  const aan = actief.includes(p.key)
                  const stijl = merkStijl(p.key)
                  return (
                    <button key={p.id} type="button"
                      onClick={() => {
                        const nieuwe = aan ? actief.filter((k) => k !== p.key) : [...actief, p.key]
                        if (!nieuwe.length) { toast.error('Een lead hoort bij minstens één merk.'); return }
                        zet('merken', nieuwe)
                      }}
                      className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg border flex items-center justify-center gap-1.5 ${aan ? stijl.badge : 'border-gray-200 text-gray-400 hover:text-black'}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${aan ? stijl.stip : 'bg-gray-300'}`} />{p.name}
                    </button>
                  )
                })}
              </div>
            </Label>
          )}

          {/* Advies van Harrie */}
          {lead.harrie?.belAdvies && (
            <div className={`rounded-xl border px-3 py-2 ${lead.harrie.reageerde ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="text-[10px] text-gray-500 mb-0.5 flex items-center gap-1">
                {lead.harrie.reageerde ? <Flame className="h-3 w-3 text-orange-600" /> : <Bot className="h-3 w-3" />}Advies van Harrie
              </div>
              <p className="text-[13px] text-gray-900 font-medium leading-snug">{lead.harrie.belAdvies}</p>
            </div>
          )}

          {/* Taken in ClickUp, met een link terug naar deze lead */}
          <LeadTaken leadId={lead.id} standaardMerk={merkenVan(lead, pipelines)[0]?.key ?? null}
            onGewijzigd={() => { setVerversen((n) => n + 1); onChanged() }} />

          {/* Interne notities */}
          <section>
            <h3 className="text-[11px] text-gray-400 font-bold mb-2 flex items-center gap-1">
              <StickyNote className="h-3 w-3" />Interne notities
            </h3>
            <div className="flex gap-2 mb-2">
              <textarea rows={2} className="input-base text-sm flex-1" value={nieuweNotitie} placeholder="Notitie toevoegen…"
                onChange={(e) => setNieuweNotitie(e.target.value)} />
              <button onClick={voegNotitieToe} disabled={bezig || !nieuweNotitie.trim()} className="btn-secondary text-sm self-end">
                {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Opslaan'}
              </button>
            </div>
            {notities === null ? (
              <div className="py-2 text-center text-gray-300"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
            ) : notities.length === 0 ? (
              lead.laatste_notitie
                ? <p className="text-[13px] text-gray-700 whitespace-pre-wrap rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5">{lead.laatste_notitie}</p>
                : <p className="text-xs text-gray-400">Nog geen notities.</p>
            ) : (
              <ul className="space-y-2">
                {notities.map((n) => {
                  const magBewerken = isAdmin || (!!meId && n.medewerker_id === meId)
                  return (
                    <li key={n.id} className="rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5">
                      {bewerkId === n.id ? (
                        <div className="space-y-1.5">
                          <textarea rows={3} autoFocus className="input-base text-sm" value={bewerkTekst} onChange={(e) => setBewerkTekst(e.target.value)} />
                          <div className="flex gap-1.5">
                            <button onClick={() => bewaarBewerking(n.id)} disabled={bezig} className="btn-primary text-xs"><Check className="h-3.5 w-3.5" />Bewaren</button>
                            <button onClick={() => setBewerkId(null)} className="btn-secondary text-xs">Annuleer</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-[13px] text-gray-800 whitespace-pre-wrap break-words">{n.notitie}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2">
                            {new Date(n.created_at).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {' · '}{naamVan(n.medewerker_id, n.medewerker_email)}
                            {magBewerken && (
                              <button onClick={() => { setBewerkId(n.id); setBewerkTekst(n.notitie ?? '') }} className="underline hover:text-black">bewerken</button>
                            )}
                            {magBewerken && (
                              <button onClick={() => verwijderNotitie(n.id)} disabled={bezig} className="underline text-red-500 hover:text-red-700">verwijderen</button>
                            )}
                          </p>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <LeadActiviteiten activiteiten={andereActiviteiten} meId={meId} isAdmin={isAdmin} naamVan={naamVan}
            onGewijzigd={() => { setVerversen((n) => n + 1); onChanged() }} />

          {/* Tijdlijn (met afspraakgegevens bovenaan) */}
          <section>
            <h3 className="text-[11px] text-gray-400 font-bold mb-2 flex items-center gap-1">
              <History className="h-3 w-3" />Tijdlijn
            </h3>
            <LeadTijdlijn leadId={lead.id} verversSleutel={ververs} max={40} />
          </section>

          <p className="text-[11px] text-gray-400">
            Bron: {leadbronLabel(lead.leadbron)}
            {lead.created_at && <> · aangemaakt {new Date(lead.created_at).toLocaleDateString('nl-BE')}</>}
            {lead.opvolgdatum && <> · opvolgen {korteDatum(lead.opvolgdatum)}</>}
          </p>
        </div>

        {/* Voet */}
        {gewijzigd.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-2" role="status">
            <span className="text-xs text-gray-700 flex-1">Niet bewaarde wijzigingen</span>
            <button type="button" onClick={() => setConcept(vanLead())} disabled={bewaren} className="btn-secondary text-xs">Annuleren</button>
            <button type="button" onClick={() => void bewaarConcept()} disabled={bewaren} className="btn-primary text-xs">
              {bewaren ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Bewaren
            </button>
          </div>
        )}
        <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
          <button onClick={() => patch({ do_not_call: !lead.do_not_call }, lead.do_not_call ? 'Weer bellen.' : 'Gemarkeerd als niet bellen.')}
            disabled={bezig} className="btn-secondary text-xs flex-1">
            <PhoneOff className="h-3.5 w-3.5" />{lead.do_not_call ? 'Weer bellen' : 'Niet bellen'}
          </button>
          <button onClick={verwijderLead} disabled={bezig} className="btn-secondary text-xs flex-1 text-red-600 hover:bg-red-50">
            <Trash2 className="h-3.5 w-3.5" />Verwijderen
          </button>
        </div>
      </aside>
    </div>
  )
}

function Label({ tekst, children }: { tekst: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-gray-500 mb-0.5">{tekst}</span>
      {children}
    </label>
  )
}

/** Verwachte omzet in centen → invoertekst ("3.250" / "3.250,5"), leeg als niet ingevuld. */
function verwachtAlsTekst(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toLocaleString('nl-BE', { maximumFractionDigits: 2 })
}
