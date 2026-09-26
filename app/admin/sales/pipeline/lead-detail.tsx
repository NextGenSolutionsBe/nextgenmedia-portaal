'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  X, Phone, Mail, Globe, CalendarClock, Pencil, PhoneCall, MailPlus, StickyNote, FileText,
  Trophy, XCircle, PhoneOff, Archive, History, Bot, Flame, Loader2, Check, Linkedin, MapPin, Users,
} from 'lucide-react'
import { STAGES } from '@/lib/sales/stages'
import { LEADBRONNEN, leadbronLabel } from '@/lib/sales/leadbron'
import { merkStijl } from '@/lib/sales/merk'
import { LeadGegevens } from './lead-gegevens'
import { LeadTijdlijn } from './lead-tijdlijn'
import { DienstenLijst } from './lead-dialogen'
import { LeadOpdrachten } from './lead-opdrachten'
import { LeadControle } from './lead-controle'
import { LeadLabels } from './lead-labels'
import { LeadActiviteiten, BEHEERBARE_TYPES } from './lead-activiteiten'
import type { Activiteit } from '@/lib/sales/activiteiten-model'
import {
  type Lead, type Medewerker, type Pipeline, emailVan, euro, korteDatum, merkenVan, telefoonVan,
} from './types'

export type DialoogSoort = 'gesprek' | 'email' | 'notitie' | 'voorstel' | 'opvolg'


/** Vanaf deze fases ligt het merk vast (er is een afspraak geweest). */
const MERK_VAST = ['afspraak', 'voorstel', 'gewonnen', 'verloren']

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
  const [dienst, setDienst] = useState(lead.dienst ?? '')
  useEffect(() => { setDienst(lead.dienst ?? '') }, [lead.dienst])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key === 'Escape' && !(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))) onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
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
            <button onClick={onClose} aria-label="Sluiten" className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
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

          {/* Snelle acties */}
          <div className="grid grid-cols-3 gap-1.5">
            <Actie icon={PhoneCall} label="Gesprek" onClick={() => onDialoog('gesprek')} />
            <Actie icon={MailPlus} label="E-mail" onClick={() => onDialoog('email')} />
            <Actie icon={StickyNote} label="Notitie" onClick={() => onDialoog('notitie')} />
            <Link href={`/admin/sales/appointments?lead=${lead.id}`}
              className="text-xs font-medium px-2 py-2 rounded-lg border border-[#fff848] bg-[#fff848]/30 hover:bg-[#fff848]/60 flex flex-col items-center gap-1">
              <CalendarClock className="h-4 w-4" />Afspraak
            </Link>
            <Actie icon={FileText} label="Voorstel" onClick={() => onDialoog('voorstel')} />
            <Actie icon={CalendarClock} label="Opvolgdatum" onClick={() => onDialoog('opvolg')} />
            <Actie icon={Trophy} label="Gewonnen" onClick={() => onFase('gewonnen')} className="text-green-700" />
            <Actie icon={XCircle} label="Verloren" onClick={() => onFase('verloren')} className="text-red-600" />
          </div>

          {/* Fase, bron, verantwoordelijke, dienst, opvolgdatum */}
          <div className="grid grid-cols-2 gap-2">
            <Label tekst="Fase">
              <select className="input-base text-sm" value={lead.stage_key} disabled={bezig} onChange={(e) => onFase(e.target.value)}>
                {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Label>
            <Label tekst="Leadbron">
              <select className="input-base text-sm" value={lead.leadbron ?? 'outbound'} disabled={bezig}
                onChange={(e) => patch({ leadbron: e.target.value }, 'Leadbron bijgewerkt.')}>
                {LEADBRONNEN.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            </Label>
            <Label tekst="Verantwoordelijke">
              <select className="input-base text-sm" value={lead.assigned_to ?? ''} disabled={bezig}
                onChange={(e) => patch({ assigned_to: e.target.value || null }, 'Verantwoordelijke bijgewerkt.')}>
                <option value="">Niemand</option>
                {medewerkers.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
                {lead.assigned_to && !medewerkers.some((m) => m.id === lead.assigned_to) && (
                  <option value={lead.assigned_to}>Onbekende medewerker</option>
                )}
              </select>
            </Label>
            <Label tekst="Opvolgdatum">
              <input type="date" className="input-base text-sm" value={lead.opvolgdatum?.slice(0, 10) ?? ''} disabled={bezig}
                onChange={(e) => patch({ opvolgdatum: e.target.value || null }, e.target.value ? 'Opvolgdatum gezet.' : 'Opvolgdatum gewist.')} />
            </Label>
            <div className="col-span-2">
              <Label tekst="Geïnteresseerde dienst">
                <input className="input-base text-sm" list="diensten-lijst" value={dienst} disabled={bezig}
                  onChange={(e) => setDienst(e.target.value)}
                  onBlur={() => { if (dienst.trim() !== (lead.dienst ?? '')) patch({ dienst: dienst.trim() || null }, 'Dienst bijgewerkt.') }} />
              </Label>
              <DienstenLijst />
            </div>
          </div>

          {/* Opdrachten: titel + bedrag; hun som is de waarde van de lead */}
          <LeadOpdrachten leadId={lead.id} onChanged={onChanged} />

          <LeadLabels labels={lead.labels ?? []} suggesties={labelSuggesties} bezig={bezig}
            onOpslaan={(labels, melding) => patch({ labels }, melding)} />

          {/* Gewonnen / verloren */}
          {lead.stage_key === 'gewonnen' && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm">
              <b className="text-green-800">Gewonnen</b>
              {lead.gesloten_op && <> op {new Date(lead.gesloten_op).toLocaleDateString('nl-BE')}</>}
              {(lead.waarde_cents ?? 0) > 0
                ? <> · {euro(lead.waarde_cents)}</>
                : typeof lead.deal_waarde_cents === 'number' && <> · {euro(lead.deal_waarde_cents)}</>}
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
                  const actief = merkenVan(lead, pipelines).map((m) => m.key)
                  const aan = actief.includes(p.key)
                  const stijl = merkStijl(p.key)
                  return (
                    <button key={p.id} type="button" disabled={bezig}
                      onClick={() => {
                        const nieuwe = aan ? actief.filter((k) => k !== p.key) : [...actief, p.key]
                        if (!nieuwe.length) { toast.error('Een lead hoort bij minstens één merk.'); return }
                        patch({ merken: nieuwe }, 'Merk bijgewerkt.')
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
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5 flex items-center gap-1">
                {lead.harrie.reageerde ? <Flame className="h-3 w-3 text-orange-600" /> : <Bot className="h-3 w-3" />}Advies van Harrie
              </div>
              <p className="text-[13px] text-gray-900 font-medium leading-snug">{lead.harrie.belAdvies}</p>
            </div>
          )}

          {/* Interne notities */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-gray-400 font-bold mb-2 flex items-center gap-1">
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
            <h3 className="text-[11px] uppercase tracking-wide text-gray-400 font-bold mb-2 flex items-center gap-1">
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
        <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
          <button onClick={() => patch({ do_not_call: !lead.do_not_call }, lead.do_not_call ? 'Weer bellen.' : 'Gemarkeerd als niet bellen.')}
            disabled={bezig} className="btn-secondary text-xs flex-1">
            <PhoneOff className="h-3.5 w-3.5" />{lead.do_not_call ? 'Weer bellen' : 'Niet bellen'}
          </button>
          <button onClick={async () => { if (await patch({ archived: true }, 'Gearchiveerd.')) onClose() }} disabled={bezig} className="btn-secondary text-xs flex-1">
            <Archive className="h-3.5 w-3.5" />Archiveer
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

function Actie({ icon: Icon, label, onClick, className = '' }: {
  icon: typeof Phone; label: string; onClick: () => void; className?: string
}) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs font-medium px-2 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 flex flex-col items-center gap-1 ${className}`}>
      <Icon className="h-4 w-4" />{label}
    </button>
  )
}
