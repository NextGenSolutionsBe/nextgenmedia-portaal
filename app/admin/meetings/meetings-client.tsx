'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  Plus, Loader2, Video, Check, AlertTriangle, Clock, Minus, Copy, ExternalLink, RotateCcw, Pencil, Ban, X, Users,
  ChevronLeft, ChevronRight, List, CalendarDays, ShieldCheck, ArrowLeft,
} from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import { Modal, focusRing } from '@/app/admin/materiaal/dialogen'
import {
  DUUR_OPTIES, STANDAARD_TIJDZONE, TIJDZONE_OPTIES, valideerMeeting, kiesHerinnering, herinneringsMail, datumKort, datumLang, uur, dag,
  duurMinuten, wanneer, tijdzoneLabel, naamZonderKlant, maandagVan, plusDagen, ANTWOORD_LABEL,
  stapAgenda, stapMeet, stapUitnodiging, stapClickup, stapHerinnering, momentLabel, isEmail, type Persoon, type StapWeergave, type Toon,
} from '@/lib/meetings/model'

/**
 * Meetingplanner — plannen, bekijken, verplaatsen en annuleren zonder de app
 * te verlaten. Eén scherm: lijst of week, een planvenster met controlestap en
 * een detailvenster met de status per stap (Google Agenda, Meet, uitnodiging,
 * ClickUp, herinneringsmail).
 */

type Herinnering = {
  id: string; status: string; moment: string; gepland_voor: string; verzonden_op: string | null; fout: string | null
  ontvangers: Persoon[]; pogingen: number; created_at: string
}
type Meeting = {
  id: string; client_id: string | null; klant_naam: string; titel: string; beschrijving: string | null; starts_at: string; ends_at: string
  tijdzone: string; status: 'ingepland' | 'geannuleerd'; agenda_id: string | null; organisator_naam: string | null
  klant_ontvangers: Persoon[]; deelnemers: Persoon[]; herinnering_aan: boolean
  google_status: string; google_fout: string | null; meet_url: string | null
  clickup_task_id: string | null; clickup_status: string; clickup_fout: string | null
  project_id?: string | null; clickup_item_id?: string | null
  uitnodiging_status?: string | null; uitnodiging_op?: string | null; uitnodiging_naar?: string[] | null
  created_by_email: string | null; created_at: string; geannuleerd_op: string | null; geannuleerd_door: string | null
  herinnering: Herinnering | null
}
type Klant = { id: string; company_name: string | null; contact_name: string | null; email: string | null }
type Project = { id: string; titel: string; client_id: string | null; klant_vrij: string | null }
type Opties = {
  klanten: Klant[]; contacten: { client_id: string; name: string | null; email: string | null }[]; projecten: Project[]
  agendas: { id: string; naam: string; gekoppeld: boolean }[]; standaardAgenda: string | null
  ik: { naam: string | null; email: string }; rechten: { toevoegen: boolean; aanpassen: boolean }
}
type Detail = {
  meeting: Meeting; herinneringen: Herinnering[]; mail?: { onderwerp: string; tekst: string }
  antwoorden: { email: string; antwoord: string }[] | null; antwoordenFout: string | null
  klant: { id: string; company_name: string | null } | null; project: { id: string; titel: string } | null
}

const lbl = 'block text-xs font-medium text-gray-700 mb-1'
const nieuweSleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '')
const morgen = () => dag(new Date(Date.now() + 86400000).toISOString())
const MEET_PLAATSHOUDER = '[Google Meet-link, wordt aangemaakt bij het inplannen]'
const minVan = (u: string) => { const [h, m] = u.split(':').map(Number); return h * 60 + m }
const uurVan = (n: number) => `${String(Math.floor(((n % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((n % 60) + 60) % 60).padStart(2, '0')}`
const agendaNaamKort = (naam?: string) => naam?.split(/\s+[—-]\s+/)[0] ?? ''

class ApiFout extends Error { constructor(msg: string, public status: number, public data: Record<string, unknown>) { super(msg) } }
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiFout(j.error || 'Er ging iets mis', r.status, j)
  return j as T
}

// ── Kleine bouwstenen ────────────────────────────────────────────────────────

const TOON: Record<Toon, { cls: string; icoon: typeof Check }> = {
  ok: { cls: 'border-gray-300 text-gray-900 bg-white', icoon: Check },
  bezig: { cls: 'border-gray-200 text-gray-600 bg-gray-50', icoon: Clock },
  fout: { cls: 'border-red-200 text-red-700 bg-red-50', icoon: AlertTriangle },
  neutraal: { cls: 'border-gray-200 text-gray-500 bg-white', icoon: Minus },
}
function StapChip({ s }: { s: StapWeergave }) {
  const t = TOON[s.toon]
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${t.cls}`}><t.icoon className="h-3 w-3" aria-hidden />{s.label}</span>
}
const stappen = (m: Meeting) => [stapAgenda(m), stapMeet(m), stapUitnodiging(m), stapClickup(m), stapHerinnering(m, m.herinnering)]
const persoonTekst = (p: Persoon) => (p.naam ? `${p.naam} <${p.email}>` : p.email)

function Kopieer({ tekst }: { tekst: string }) {
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(tekst); toast.success('Gekopieerd.') } catch { toast.error('Kopiëren lukte niet.') } }}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-200 hover:bg-gray-50 ${focusRing}`} aria-label="Kopiëren"><Copy className="h-3.5 w-3.5" /></button>
  )
}

// ── Personenlijst ────────────────────────────────────────────────────────────

type Rij = { naam: string; email: string }
function Personen({ rijen, zet, label, uitleg, leegTekst }: { rijen: Rij[]; zet: (r: Rij[]) => void; label: string; uitleg: string; leegTekst: string }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className={lbl}>{label}</legend>
      <p className="text-[11px] text-gray-500 -mt-0.5">{uitleg}</p>
      {rijen.length === 0 && <p className="text-xs text-gray-500">{leegTekst}</p>}
      {rijen.map((r, i) => {
        const slecht = r.email.trim() !== '' && !isEmail(r.email)
        return (
          <div key={i} className="flex gap-1.5 items-start">
            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-5 gap-1.5">
              <input className={`${INP} sm:col-span-2`} placeholder="Naam (optioneel)" value={r.naam} aria-label={`${label}: naam ${i + 1}`}
                onChange={(e) => zet(rijen.map((x, j) => (j === i ? { ...x, naam: e.target.value } : x)))} />
              <div className="sm:col-span-3 min-w-0">
                <input className={`${INP} ${slecht ? 'border-red-300' : ''}`} type="email" inputMode="email" placeholder="naam@bedrijf.be" value={r.email} aria-label={`${label}: e-mail ${i + 1}`}
                  aria-invalid={slecht} onChange={(e) => zet(rijen.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                {slecht && <p className="text-[11px] text-red-700 mt-0.5">Geen geldig e-mailadres.</p>}
              </div>
            </div>
            <button type="button" onClick={() => zet(rijen.filter((_, j) => j !== i))} className={`h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 ${focusRing}`} aria-label="Verwijderen"><X className="h-4 w-4" /></button>
          </div>
        )
      })}
      <button type="button" onClick={() => zet([...rijen, { naam: '', email: '' }])} className={`text-xs font-medium underline underline-offset-2 ${focusRing}`}>+ toevoegen</button>
    </fieldset>
  )
}

function Rijtje({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col sm:flex-row gap-0.5 sm:gap-3 py-1.5"><dt className="sm:w-40 shrink-0 text-xs text-gray-500">{label}</dt><dd className="text-sm text-gray-900 min-w-0 break-words">{children}</dd></div>
}

// ── Planvenster (nieuw of aanpassen) ─────────────────────────────────────────

function PlanVenster({ opties, bestaand, startDag, onSluit, onKlaar, onOpen }: {
  opties: Opties; bestaand: Meeting | null; startDag?: string; onSluit: () => void; onKlaar: (m: Meeting, melding: string) => void; onOpen: (id: string) => void
}) {
  const [sleutel] = useState(nieuweSleutel)
  const [stap, setStap] = useState<'invullen' | 'controle'>('invullen')
  const tzStart = bestaand?.tijdzone ?? STANDAARD_TIJDZONE
  const [clientId, setClientId] = useState(bestaand?.client_id ?? '')
  const [zoek, setZoek] = useState('')
  const [toonKlanten, setToonKlanten] = useState(false)
  const [projectId, setProjectId] = useState(bestaand?.project_id ?? '')
  const [clickupItem, setClickupItem] = useState(bestaand?.clickup_item_id ? `https://app.clickup.com/t/${bestaand.clickup_item_id}` : '')
  const [titel, setTitel] = useState(bestaand?.titel ?? '')
  const [beschrijving, setBeschrijving] = useState(bestaand?.beschrijving ?? '')
  const [tijdzone, setTijdzone] = useState(tzStart)
  const [datum, setDatum] = useState(bestaand ? dag(bestaand.starts_at, tzStart) : startDag ?? morgen())
  const [tijd, setTijd] = useState(bestaand ? uur(bestaand.starts_at, tzStart) : '10:00')
  const [duur, setDuur] = useState(bestaand ? duurMinuten(bestaand.starts_at, bestaand.ends_at) : 30)
  const [agendaId, setAgendaId] = useState(bestaand?.agenda_id ?? (opties.agendas.find((a) => a.id === opties.standaardAgenda && a.gekoppeld)?.id ?? opties.agendas.find((a) => a.gekoppeld)?.id ?? ''))
  const [organisator, setOrganisator] = useState(bestaand?.organisator_naam ?? '')
  const [genodigden, setGenodigden] = useState<Rij[]>(bestaand ? bestaand.klant_ontvangers.map((p) => ({ naam: p.naam ?? '', email: p.email })) : [{ naam: '', email: '' }])
  const [extra, setExtra] = useState<Rij[]>((bestaand?.deelnemers ?? []).map((p) => ({ naam: p.naam ?? '', email: p.email })))
  const [herinnering, setHerinnering] = useState(bestaand?.herinnering_aan ?? true)
  const [toonVoorbeeld, setToonVoorbeeld] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [dubbel, setDubbel] = useState<Meeting | null>(null)
  const [onzeker, setOnzeker] = useState<string | null>(null)

  const klant = opties.klanten.find((k) => k.id === clientId) ?? null
  const klantNaam = klant ? (klant.company_name || klant.contact_name || 'Klant') : null
  const suggesties = useMemo(() => {
    if (!clientId) return [] as Rij[]
    const uit: Rij[] = []
    if (klant?.email) uit.push({ naam: klant.contact_name ?? '', email: klant.email })
    for (const c of opties.contacten) if (c.client_id === clientId && c.email) uit.push({ naam: c.name ?? '', email: c.email })
    const gezien = new Set<string>()
    return uit.filter((r) => { const k = r.email.trim().toLowerCase(); if (gezien.has(k)) return false; gezien.add(k); return true })
  }, [clientId, klant, opties.contacten])
  const projecten = opties.projecten.filter((p) => !clientId || !p.client_id || p.client_id === clientId)

  const kiesKlant = (id: string) => {
    setClientId(id); setZoek(''); setToonKlanten(false)
    const k = opties.klanten.find((x) => x.id === id)
    // E-mail van de klant voorinvullen als er nog niemand staat; het klantdossier wijzigt niet.
    const eerste = k?.email ? { naam: k.contact_name ?? '', email: k.email } : (() => { const c = opties.contacten.find((x) => x.client_id === id && x.email); return c ? { naam: c.name ?? '', email: c.email as string } : null })()
    if (eerste && !genodigden.some((r) => r.email.trim())) setGenodigden([eerste])
    if (!titel) setTitel(`Meeting ${k?.company_name ?? ''}`.trim())
  }

  const eindUur = uurVan(minVan(tijd || '00:00') + duur)
  const zetEind = (v: string) => { if (!v || !tijd) return; const d = minVan(v) - minVan(tijd); if (d > 0) setDuur(d) }

  const invoer = {
    titel, beschrijving, dag: datum, uur: tijd, duur_minuten: duur, tijdzone, herinnering_aan: herinnering,
    klant_ontvangers: genodigden.filter((r) => r.email.trim()).map((r) => ({ naam: r.naam, email: r.email })),
    deelnemers: extra.filter((r) => r.email.trim()).map((r) => ({ naam: r.naam, email: r.email })),
  }
  const controle = valideerMeeting(invoer)
  const startsAt = controle.ok ? controle.waarde.startsAt : null
  const keuze = startsAt ? kiesHerinnering(startsAt) : null
  const agenda = opties.agendas.find((a) => a.id === agendaId)
  const browserTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : STANDAARD_TIJDZONE
  const zones = TIJDZONE_OPTIES.some((o) => o.key === tijdzone) ? TIJDZONE_OPTIES : [...TIJDZONE_OPTIES, { key: tijdzone, label: tijdzone }]
  const weergaveNaam = klantNaam ?? (controle.ok ? naamZonderKlant(controle.waarde.klant_ontvangers) : '')
  const project = opties.projecten.find((p) => p.id === projectId) ?? null
  const clickupOngeldig = clickupItem.trim() !== '' && !/clickup\.com\/t\/(?:\d+\/)?[A-Za-z0-9_-]{5,40}|^#?[A-Za-z0-9_-]{5,40}$/.test(clickupItem.trim())

  const voorbeeld = controle.ok ? herinneringsMail({
    klant_naam: weergaveNaam, titel: controle.waarde.titel, starts_at: controle.waarde.startsAt, meet_url: bestaand?.meet_url ?? MEET_PLAATSHOUDER,
    beschrijving: controle.waarde.beschrijving, organisator_naam: organisator.trim() || agendaNaamKort(agenda?.naam) || null,
    ontvangers: controle.waarde.klant_ontvangers, tijdzone,
  }) : null

  const probleem = !controle.ok ? controle.fout : clickupOngeldig ? 'Geen geldig ClickUp-item. Plak de link of het taak-ID.' : !bestaand && !agendaId ? 'Kies de Google-agenda waarin de meeting komt.' : !bestaand && agenda && !agenda.gekoppeld ? 'De Google-koppeling van deze agenda is verlopen. Koppel ze opnieuw via Verkoop → Agenda.' : null

  async function bewaar(tochInplannen = false) {
    if (probleem) { toast.error(probleem); return }
    setBezig(true); setFout(null); setDubbel(null)
    const koppel = { client_id: clientId || null, project_id: projectId || null, clickup_item: clickupItem.trim() }
    try {
      if (bestaand) {
        const j = await api<{ meeting: Meeting; ongewijzigd?: boolean; herinneringFout?: string | null; googleFout?: string | null }>(`/api/admin/meetings/${bestaand.id}`, { method: 'PATCH', body: JSON.stringify({ actie: 'wijzig', ...invoer, ...koppel }) })
        if (j.googleFout) { toast.error(j.googleFout); onKlaar(j.meeting, ''); return }
        onKlaar(j.meeting, j.ongewijzigd ? 'Er was niets gewijzigd.' : j.herinneringFout ? `Aangepast, maar de herinnering is niet opnieuw gepland: ${j.herinneringFout}` : 'Meeting aangepast. De genodigden krijgen de wijziging van Google.')
      } else {
        const j = await api<{ meeting: Meeting; herhaald?: boolean; herinneringFout?: string | null }>('/api/admin/meetings', {
          method: 'POST', body: JSON.stringify({ aanvraag_sleutel: sleutel, agenda_id: agendaId, organisator_naam: organisator, toch_inplannen: tochInplannen, ...invoer, ...koppel }),
        })
        onKlaar(j.meeting, j.herhaald ? 'Deze meeting stond al ingepland.' : j.herinneringFout ? `Ingepland, maar de herinnering kon niet gepland worden: ${j.herinneringFout}` : 'Meeting ingepland. Google stuurt de uitnodiging.')
      }
    } catch (e) {
      if (e instanceof ApiFout && e.status === 409 && e.data.bestaand) { setDubbel(e.data.bestaand as Meeting); return }
      if (e instanceof ApiFout && e.data.meeting) { setFout(e.message); setOnzeker((e.data.meeting as Meeting).id); toast.error('Niet ingepland in Google Agenda.'); return }
      setFout(e instanceof Error ? e.message : 'Inplannen mislukt')
    } finally { setBezig(false) }
  }

  const klantLijst = opties.klanten.filter((k) => `${k.company_name ?? ''} ${k.contact_name ?? ''} ${k.email ?? ''}`.toLowerCase().includes(zoek.trim().toLowerCase())).slice(0, 50)

  // ── Stap 2: controleweergave ───────────────────────────────────────────────
  if (stap === 'controle' && controle.ok) {
    const w = controle.waarde
    return (
      <Modal breed titel={bestaand ? 'Wijzigingen nakijken' : 'Nakijken en inplannen'} sub="Klopt alles? Na bevestigen maakt Google de afspraak aan en verstuurt de uitnodiging." onSluit={onSluit}
        voet={<>
          <button type="button" onClick={() => { setStap('invullen'); setFout(null); setDubbel(null) }} className={`btn-secondary ${focusRing}`}><ArrowLeft className="h-4 w-4" />Terug</button>
          <button type="button" onClick={() => bewaar(false)} disabled={bezig} className={`btn-primary ${focusRing}`}>
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{bestaand ? 'Bevestigen en bijwerken' : 'Bevestigen en inplannen'}
          </button>
        </>}>
        <dl className="divide-y divide-gray-100">
          <Rijtje label="Titel">{w.titel}</Rijtje>
          <Rijtje label="Wanneer">{wanneer(w.startsAt, w.tijdzone)} – {uur(w.endsAt, w.tijdzone)} <span className="text-gray-500">({tijdzoneLabel(w.tijdzone)}, {w.duur} min)</span>
            {w.tijdzone !== STANDAARD_TIJDZONE && <div className="text-xs text-gray-500">In België: {wanneer(w.startsAt)}</div>}</Rijtje>
          <Rijtje label="Uitnodiging via Google naar">
            <ul>{w.klant_ontvangers.map((p) => <li key={p.email} className="font-medium">{persoonTekst(p)}</li>)}{w.deelnemers.map((p) => <li key={p.email}>{persoonTekst(p)} <span className="text-xs text-gray-500">(extra deelnemer)</span></li>)}</ul>
          </Rijtje>
          <Rijtje label="Herinneringsmail">
            {!w.herinnering_aan ? 'Geen' : keuze ? <>{datumLang(keuze.geplandVoor)} om {uur(keuze.geplandVoor)} ({keuze.label}) naar {w.klant_ontvangers.map((p) => p.email).join(', ')}</> : <span className="text-amber-700">Geen: de meeting begint te snel.</span>}
          </Rijtje>
          <Rijtje label="Google-agenda">{bestaand ? 'Zelfde afspraak, wordt bijgewerkt (Meet-link blijft)' : `${agenda?.naam ?? '—'}, met Google Meet-link`}</Rijtje>
          <Rijtje label="ClickUp">{bestaand ? 'Bestaande taak wordt bijgewerkt' : 'Taak in de lijst van het merk, zoals bij de verkoopafspraken'}</Rijtje>
          <Rijtje label="Klant">{klantNaam ?? <span className="text-gray-500">Geen klant gekoppeld</span>}</Rijtje>
          {project && <Rijtje label="Project">{project.titel}</Rijtje>}
          {clickupItem.trim() && <Rijtje label="ClickUp-item">{clickupItem.trim()}</Rijtje>}
          {w.beschrijving && <Rijtje label="Beschrijving"><span className="whitespace-pre-wrap">{w.beschrijving}</span></Rijtje>}
        </dl>
        {dubbel && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2" role="alert">
            <p>Deze meeting staat al ingepland: <strong>{dubbel.titel}</strong> op {wanneer(dubbel.starts_at, dubbel.tijdzone)}. Twee keer inplannen stuurt twee uitnodigingen.</p>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => onOpen(dubbel.id)} className={`btn-secondary !py-1 text-xs ${focusRing}`}>Bestaande meeting openen</button>
              <button type="button" onClick={() => bewaar(true)} disabled={bezig} className={`btn-secondary !py-1 text-xs ${focusRing}`}>Toch nog eens inplannen</button>
            </div>
          </div>
        )}
        {fout && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-2" role="alert">
            <p>{fout}</p>
            {onzeker && <button type="button" onClick={() => onOpen(onzeker)} className={`btn-secondary !py-1 text-xs ${focusRing}`}>Meeting openen</button>}
          </div>
        )}
      </Modal>
    )
  }

  // ── Stap 1: invullen ───────────────────────────────────────────────────────
  return (
    <Modal breed titel={bestaand ? 'Meeting aanpassen of verplaatsen' : 'Meeting plannen'} sub={bestaand ? 'Zelfde Google-afspraak en Meet-link; de genodigden krijgen een update' : 'Google Agenda met Meet-link en uitnodiging, ClickUp en herinneringsmail'} onSluit={onSluit}
      voet={<>
        <button type="button" onClick={onSluit} className={`btn-secondary ${focusRing}`}>Annuleren</button>
        <button type="button" onClick={() => { if (probleem) { toast.error(probleem); return } setStap('controle') }} disabled={!!probleem} className={`btn-primary ${focusRing}`} title={probleem ?? undefined}>
          Nakijken<ChevronRight className="h-4 w-4" />
        </button>
      </>}>
      <div>
        <label className={lbl} htmlFor="mt-titel">Titel</label>
        <input id="mt-titel" autoFocus={!bestaand} className={INP} value={titel} maxLength={200} onChange={(e) => setTitel(e.target.value)} placeholder="Bv. Kennismaking" />
      </div>

      <Personen label="Genodigden" rijen={genodigden} zet={setGenodigden}
        uitleg="Krijgen de agenda-uitnodiging van Google én de herinneringsmail. Iedereen kan, ook wie geen klant is."
        leegTekst="Nog niemand. Voeg minstens één e-mailadres toe." />
      {suggesties.length > 0 && (
        <div className="flex flex-wrap gap-1.5 -mt-1" aria-label="Contactpersonen van de klant">
          {suggesties.map((s) => {
            const al = genodigden.some((r) => r.email.trim().toLowerCase() === s.email.toLowerCase())
            return <button key={s.email} type="button" disabled={al} onClick={() => setGenodigden([...genodigden.filter((r) => r.email.trim()), s])} className={`rounded-full border px-2 py-0.5 text-[11px] ${al ? 'border-gray-200 text-gray-400' : 'border-gray-300 hover:bg-gray-50'} ${focusRing}`}>{al ? '✓ ' : '+ '}{s.naam || s.email}</button>
          })}
        </div>
      )}
      <Personen label="Extra deelnemers" rijen={extra} zet={setExtra} uitleg="Enkel de agenda-uitnodiging, geen herinneringsmail. Bv. collega's." leegTekst="Geen extra deelnemers." />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="col-span-2 sm:col-span-1"><label className={lbl} htmlFor="mt-dag">Datum</label><input id="mt-dag" type="date" className={INP} value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
        <div><label className={lbl} htmlFor="mt-uur">Starttijd</label><input id="mt-uur" type="time" step={300} className={INP} value={tijd} onChange={(e) => setTijd(e.target.value)} /></div>
        <div><label className={lbl} htmlFor="mt-eind">Eindtijd</label><input id="mt-eind" type="time" step={300} className={INP} value={eindUur} onChange={(e) => zetEind(e.target.value)} /></div>
        <div className="col-span-2 sm:col-span-1"><label className={lbl} htmlFor="mt-duur">Duur</label>
          <select id="mt-duur" className={INP} value={duur} onChange={(e) => setDuur(Number(e.target.value))}>
            {[...new Set([...DUUR_OPTIES, duur])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${Math.floor(d / 60)} u${d % 60 ? ` ${d % 60}` : ''}`}</option>)}
          </select>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-2 items-end">
        <div>
          <label className={lbl} htmlFor="mt-tz">Tijdzone</label>
          <select id="mt-tz" className={INP} value={tijdzone} onChange={(e) => setTijdzone(e.target.value)}>
            {zones.map((z) => <option key={z.key} value={z.key}>{z.label}{z.key === STANDAARD_TIJDZONE ? ' — standaard' : ''}</option>)}
          </select>
        </div>
        <p className="text-[11px] text-gray-600 pb-2">
          {startsAt && controle.ok ? <>{wanneer(startsAt, tijdzone)} – {uur(controle.waarde.endsAt, tijdzone)}{tijdzone !== STANDAARD_TIJDZONE && <> · in België {uur(startsAt)}</>}</> : null}
          {browserTz !== tijdzone && <span className="block text-gray-500">Je toestel staat op {browserTz}; de tijd geldt in de gekozen tijdzone.</span>}
        </p>
      </div>

      {!bestaand && (
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <label className={lbl} htmlFor="mt-agenda">Google-agenda</label>
            <select id="mt-agenda" className={INP} value={agendaId} onChange={(e) => setAgendaId(e.target.value)}>
              <option value="">Kies…</option>
              {opties.agendas.map((a) => <option key={a.id} value={a.id} disabled={!a.gekoppeld}>{a.naam}{a.gekoppeld ? '' : ' (koppeling verlopen)'}</option>)}
            </select>
            <p className="text-[11px] text-gray-500 mt-0.5">Dezelfde koppeling als de afsprakentool.</p>
          </div>
          <div>
            <label className={lbl} htmlFor="mt-org">Organisator (in de herinneringsmail)</label>
            <input id="mt-org" className={INP} value={organisator} maxLength={120} onChange={(e) => setOrganisator(e.target.value)} placeholder={agendaNaamKort(agenda?.naam) || 'Naam'} />
          </div>
        </div>
      )}

      <div>
        <label className={lbl} htmlFor="mt-besch">Beschrijving of agenda <span className="font-normal text-gray-500">(optioneel, staat ook in de uitnodiging)</span></label>
        <textarea id="mt-besch" rows={3} className={INP} value={beschrijving} maxLength={5000} onChange={(e) => setBeschrijving(e.target.value)} placeholder="Wat bespreken we?" />
      </div>

      <details className="rounded-lg border border-gray-200" open={!!(clientId || projectId || clickupItem)}>
        <summary className={`px-3 py-2 text-xs font-medium cursor-pointer ${focusRing}`}>Koppelen aan klant, project of ClickUp-item <span className="font-normal text-gray-500">(optioneel)</span></summary>
        <div className="px-3 pb-3 space-y-3">
          <div>
            <span className={lbl}>Klant</span>
            {klant ? (
              <div className="flex items-center gap-2 rounded-lg border border-gray-900 bg-gray-50 px-3 py-2 text-sm">
                <span className="flex-1 font-medium truncate">{klantNaam}</span>
                <button type="button" onClick={() => { setClientId(''); setProjectId('') }} className={`text-xs underline ${focusRing}`}>loskoppelen</button>
              </div>
            ) : (
              <>
                <input className={INP} placeholder="Zoek klant of contactpersoon…" value={zoek} onFocus={() => setToonKlanten(true)} onChange={(e) => { setZoek(e.target.value); setToonKlanten(true) }} aria-label="Zoek klant" />
                {toonKlanten && (
                  <ul className="mt-1.5 max-h-40 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {klantLijst.map((k) => (
                      <li key={k.id}><button type="button" onClick={() => kiesKlant(k.id)} className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${focusRing}`}>
                        <span className="font-medium">{k.company_name || k.contact_name}</span>
                        <span className="text-[11px] text-gray-500"> {[k.contact_name, k.email].filter(Boolean).join(' · ')}</span>
                      </button></li>
                    ))}
                    {klantLijst.length === 0 && <li className="px-3 py-3 text-xs text-gray-500">Geen klant gevonden.</li>}
                  </ul>
                )}
              </>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <label className={lbl} htmlFor="mt-project">Project / opdracht</label>
              <select id="mt-project" className={INP} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Geen</option>
                {projecten.map((p) => <option key={p.id} value={p.id}>{p.titel}{p.klant_vrij ? ` · ${p.klant_vrij}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl} htmlFor="mt-cu">ClickUp-item</label>
              <input id="mt-cu" className={`${INP} ${clickupOngeldig ? 'border-red-300' : ''}`} value={clickupItem} onChange={(e) => setClickupItem(e.target.value)} placeholder="Link of taak-ID" />
            </div>
          </div>
          <p className="text-[11px] text-gray-500">De koppeling komt in de ClickUp-taak van de meeting. Bestaande ClickUp-workflows blijven ongemoeid.</p>
        </div>
      </details>

      <div className="rounded-lg border border-gray-200 p-3 space-y-2">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={herinnering} onChange={(e) => setHerinnering(e.target.checked)} />
          <span>
            <span className="font-medium">Herinneringsmail naar de genodigden</span>
            <span className="block text-[11px] text-gray-500">Apart van de uitnodiging. Vertrekt automatisch, ook als niemand de app open heeft.</span>
          </span>
        </label>
        {herinnering && startsAt && (keuze
          ? <p className="text-xs text-gray-700">Wordt verstuurd op <strong>{datumLang(keuze.geplandVoor)} om {uur(keuze.geplandVoor)}</strong> (Belgische tijd, {keuze.label}).{keuze.moment !== '24u' && ' 24 uur vooraf is al voorbij.'}</p>
          : <p className="text-xs text-amber-700 flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />De meeting begint te snel: er wordt geen herinnering gepland.</p>)}
        {herinnering && voorbeeld && (
          <div>
            <button type="button" onClick={() => setToonVoorbeeld(!toonVoorbeeld)} className={`text-xs font-medium underline underline-offset-2 ${focusRing}`}>{toonVoorbeeld ? 'Voorbeeld verbergen' : 'Voorbeeld van de herinnering bekijken'}</button>
            {toonVoorbeeld && (
              <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs">
                <p className="text-gray-500">Aan: {controle.ok ? controle.waarde.klant_ontvangers.map(persoonTekst).join(', ') : ''}</p>
                <p className="font-semibold mt-1">{voorbeeld.onderwerp}</p>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-gray-800">{voorbeeld.tekst}</pre>
              </div>
            )}
          </div>
        )}
      </div>

      {probleem && genodigden.some((r) => r.email.trim()) && titel && <p className="text-xs text-red-700" role="alert">{probleem}</p>}
    </Modal>
  )
}

// ── Annuleren ────────────────────────────────────────────────────────────────

function AnnuleerVenster({ m, onSluit, onKlaar }: { m: Meeting; onSluit: () => void; onKlaar: (m: Meeting) => void }) {
  const [verwittigen, setVerwittigen] = useState(true)
  const [bezig, setBezig] = useState(false)
  async function doe() {
    setBezig(true)
    try {
      const j = await api<{ meeting: Meeting }>(`/api/admin/meetings/${m.id}`, { method: 'PATCH', body: JSON.stringify({ actie: 'annuleer', genodigden_verwittigen: verwittigen }) })
      onKlaar(j.meeting)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Annuleren mislukt') } finally { setBezig(false) }
  }
  return (
    <Modal titel="Meeting annuleren" sub={`${m.titel} · ${wanneer(m.starts_at, m.tijdzone)}`} onSluit={onSluit}
      voet={<>
        <button type="button" onClick={onSluit} className={`btn-secondary ${focusRing}`}>Terug</button>
        <button type="button" onClick={doe} disabled={bezig} className={`btn-danger ${focusRing}`}>{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}Meeting annuleren</button>
      </>}>
      <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5">
        <li>De afspraak in Google Agenda wordt geannuleerd.</li>
        <li>De ClickUp-taak krijgt [GEANNULEERD] en wordt gesloten, zoals bij de verkoopafspraken.</li>
        <li>Een nog niet verstuurde herinneringsmail wordt ingetrokken.</li>
        <li>De app stuurt zelf geen annuleringsmail.</li>
      </ul>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={verwittigen} onChange={(e) => setVerwittigen(e.target.checked)} />
        <span>Google laat de genodigden weten dat de afspraak vervalt<span className="block text-[11px] text-gray-500">Zonder dit blijft de afspraak in agenda&apos;s buiten Google soms gewoon staan.</span></span>
      </label>
    </Modal>
  )
}

// ── Koppelingen controleren ──────────────────────────────────────────────────

function KoppelingenVenster({ opties, onSluit }: { opties: Opties; onSluit: () => void }) {
  const [agendaId, setAgendaId] = useState(opties.standaardAgenda ?? opties.agendas[0]?.id ?? '')
  const [checks, setChecks] = useState<{ onderdeel: string; ok: boolean; melding: string }[] | null>(null)
  const [bezig, setBezig] = useState(false)
  const doe = useCallback(async () => {
    setBezig(true); setChecks(null)
    try { setChecks((await api<{ checks: { onderdeel: string; ok: boolean; melding: string }[] }>(`/api/admin/meetings?koppelingen=${agendaId}`)).checks) } catch (e) { toast.error(e instanceof Error ? e.message : 'Controle mislukt') } finally { setBezig(false) }
  }, [agendaId])
  useEffect(() => { doe() }, [doe])
  return (
    <Modal titel="Koppelingen controleren" sub="Leest enkel: er wordt niets aangemaakt of verstuurd." onSluit={onSluit}
      voet={<button type="button" onClick={doe} disabled={bezig} className={`btn-secondary ${focusRing}`}>{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Opnieuw controleren</button>}>
      <div>
        <label className={lbl} htmlFor="kc-agenda">Google-agenda</label>
        <select id="kc-agenda" className={INP} value={agendaId} onChange={(e) => setAgendaId(e.target.value)}>
          {opties.agendas.map((a) => <option key={a.id} value={a.id}>{a.naam}{a.gekoppeld ? '' : ' (koppeling verlopen)'}</option>)}
        </select>
      </div>
      {!checks && <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {checks && (
        <ul className="divide-y divide-gray-100 border-y border-gray-100">
          {checks.map((c) => (
            <li key={c.onderdeel} className="py-2.5 flex gap-2">
              {c.ok ? <Check className="h-4 w-4 mt-0.5 shrink-0" aria-label="In orde" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-700" aria-label="Probleem" />}
              <div className="min-w-0"><div className="text-sm font-medium">{c.onderdeel}</div><div className={`text-xs ${c.ok ? 'text-gray-600' : 'text-red-700'} break-words`}>{c.melding}</div></div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────────

const H_LABEL: Record<string, string> = { gepland: 'Gepland', bezig: 'Bezig', verzonden: 'Verzonden', mislukt: 'Mislukt', geannuleerd: 'Ingetrokken', overgeslagen: 'Te laat, niet verstuurd' }

function DetailVenster({ id, opties, onSluit, onWijzig, onAnnuleer, onVeranderd }: {
  id: string; opties: Opties; onSluit: () => void; onWijzig: (m: Meeting) => void; onAnnuleer: (m: Meeting) => void; onVeranderd: () => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const laad = useCallback(async () => {
    try { setD(await api<Detail>(`/api/admin/meetings/${id}`)) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); onSluit() }
  }, [id, onSluit])
  useEffect(() => { laad() }, [laad])

  async function actie(sleutel: string, body: Record<string, unknown>, ok: string) {
    setBezig(sleutel)
    try {
      await api(`/api/admin/meetings/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      toast.success(ok); await laad(); onVeranderd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); await laad() } finally { setBezig(null) }
  }

  if (!d) return <Modal titel="Meeting" onSluit={onSluit}><div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div></Modal>
  const m = d.meeting
  const tz = m.tijdzone
  const agenda = opties.agendas.find((a) => a.id === m.agenda_id)
  const kan = opties.rechten.aanpassen
  const actief = m.status === 'ingepland'
  const komend = new Date(m.starts_at).getTime() > Date.now()
  const h = m.herinnering
  const antwoordVan = (email: string) => d.antwoorden?.find((a) => a.email.toLowerCase() === email.toLowerCase())?.antwoord
  const knop = (sleutel: string, tekst: string, body: Record<string, unknown>, ok: string) => kan && (
    <button type="button" disabled={!!bezig} onClick={() => actie(sleutel, body, ok)} className={`btn-secondary !px-2.5 !py-1 text-xs ${focusRing}`}>
      {bezig === sleutel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}{tekst}
    </button>
  )
  const rij = (titel: string, s: StapWeergave, inhoud: ReactNode, actieKnop?: ReactNode) => (
    <div className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3">
      <div className="sm:w-28 text-xs font-medium text-gray-500 pt-0.5">{titel}</div>
      <div className="flex-1 min-w-0 space-y-1"><div><StapChip s={s} /></div>{inhoud}</div>
      {actieKnop && <div className="shrink-0">{actieKnop}</div>}
    </div>
  )
  const persoonMetAntwoord = (p: Persoon, extra?: boolean) => {
    const a = antwoordVan(p.email)
    return <div key={p.email} className="break-words">{persoonTekst(p)}{extra && <span className="text-[11px] text-gray-500"> · extra</span>}{a && actief && <span className={`text-[11px] ${a === 'declined' ? 'text-red-700' : 'text-gray-500'}`}> · {ANTWOORD_LABEL[a] ?? a}</span>}</div>
  }

  return (
    <Modal breed titel={<span className="flex items-center gap-2">{m.titel}{!actief && <span className="status-badge bg-gray-100 text-gray-600">Geannuleerd</span>}</span>}
      sub={`${wanneer(m.starts_at, tz)} – ${uur(m.ends_at, tz)} (${tijdzoneLabel(tz)})`} onSluit={onSluit}
      voet={kan && actief && komend ? <>
        <button type="button" onClick={() => onAnnuleer(m)} className={`btn-danger ${focusRing}`}><Ban className="h-4 w-4" />Annuleren</button>
        <button type="button" onClick={() => onWijzig(m)} className={`btn-primary ${focusRing}`}><Pencil className="h-4 w-4" />Aanpassen of verplaatsen</button>
      </> : undefined}>
      {m.google_status !== 'ok' && actief && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">Niet ingepland in Google Agenda. Er is (nog) geen uitnodiging verstuurd. Probeer de agenda-stap opnieuw of annuleer de meeting.</p>
      )}
      {m.meet_url && actief && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-3">
          <Video className="h-4 w-4 shrink-0" aria-hidden />
          <a href={m.meet_url} target="_blank" rel="noreferrer" className="text-sm font-medium underline underline-offset-2 truncate flex-1">{m.meet_url}</a>
          <Kopieer tekst={m.meet_url} />
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div><div className={lbl}>Genodigden</div>{m.klant_ontvangers.map((p) => persoonMetAntwoord(p))}{m.deelnemers.map((p) => persoonMetAntwoord(p, true))}</div>
        <div>
          <div className={lbl}>Koppelingen</div>
          <div>{d.klant ? <a className="underline underline-offset-2" href={`/admin/clients/${d.klant.id}`}>{d.klant.company_name}</a> : <span className="text-gray-500">Geen klant</span>}</div>
          {d.project && <div>Project: {d.project.titel}</div>}
          {m.clickup_item_id && <a className="underline underline-offset-2 text-xs inline-flex items-center gap-1" href={`https://app.clickup.com/t/${m.clickup_item_id}`} target="_blank" rel="noreferrer">ClickUp-item {m.clickup_item_id}<ExternalLink className="h-3 w-3" /></a>}
        </div>
        <div><div className={lbl}>Agenda</div>{agenda?.naam ?? '—'}{m.organisator_naam ? ` · organisator ${m.organisator_naam}` : ''}</div>
        <div><div className={lbl}>Ingepland door</div>{m.created_by_email ?? '—'} · {datumKort(m.created_at)}</div>
      </div>
      {tz !== STANDAARD_TIJDZONE && <p className="text-xs text-gray-500">In België: {wanneer(m.starts_at)}.</p>}
      {m.beschrijving && <div><div className={lbl}>Beschrijving</div><p className="text-sm whitespace-pre-wrap">{m.beschrijving}</p></div>}
      {!actief && <p className="text-xs text-gray-500">Geannuleerd{m.geannuleerd_door ? ` door ${m.geannuleerd_door}` : ''}{m.geannuleerd_op ? ` op ${datumKort(m.geannuleerd_op)} ${uur(m.geannuleerd_op)}` : ''}.</p>}

      <div className="divide-y divide-gray-100 border-y border-gray-100">
        {rij('Google Agenda', stapAgenda(m),
          m.google_fout ? <p className="text-xs text-red-700">{m.google_fout}</p> : null,
          m.google_status === 'fout' ? knop('google', actief ? 'Opnieuw proberen' : 'Annulering opnieuw', { actie: 'opnieuw', stap: 'google' }, actief ? 'Agenda-stap opnieuw uitgevoerd.' : 'Annulering opnieuw geprobeerd.') : null)}
        {rij('Google Meet', stapMeet(m), null,
          actief && m.google_status === 'ok' && !m.meet_url ? knop('meet', 'Meet-link aanvragen', { actie: 'opnieuw', stap: 'google' }, 'Meet-link opnieuw aangevraagd.') : null)}
        {rij('Uitnodiging', stapUitnodiging(m),
          <>
            {m.uitnodiging_op && actief && <p className="text-xs text-gray-600">Door Google verstuurd op {datumKort(m.uitnodiging_op)} {uur(m.uitnodiging_op)} naar {(m.uitnodiging_naar ?? []).join(', ')}</p>}
            {d.antwoordenFout && <p className="text-xs text-gray-500">Antwoorden niet op te halen: {d.antwoordenFout}</p>}
          </>)}
        {rij('ClickUp', stapClickup(m),
          <>
            {m.clickup_task_id && <a href={`https://app.clickup.com/t/${m.clickup_task_id}`} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2 inline-flex items-center gap-1">Taak openen<ExternalLink className="h-3 w-3" /></a>}
            {m.clickup_fout && <p className={`text-xs ${m.clickup_status === 'fout' ? 'text-red-700' : 'text-gray-500'}`}>{m.clickup_fout}</p>}
          </>,
          m.clickup_status === 'fout' ? knop('clickup', 'Opnieuw proberen', { actie: 'opnieuw', stap: 'clickup' }, 'ClickUp-stap opnieuw uitgevoerd.') : null)}
        {rij('Herinnering', stapHerinnering(m, h),
          <>
            {h && <p className="text-xs text-gray-600">{momentLabel(h.moment)} · {h.status === 'verzonden' && h.verzonden_op ? `verstuurd ${datumKort(h.verzonden_op)} ${uur(h.verzonden_op)}` : `gepland ${datumKort(h.gepland_voor)} ${uur(h.gepland_voor)} (Belgische tijd)`} · naar {h.ontvangers.map((p) => p.email).join(', ')}</p>}
            {h?.fout && <p className={`text-xs ${h.status === 'mislukt' ? 'text-red-700' : 'text-gray-500'}`}>{h.fout}</p>}
            {!h && actief && m.herinnering_aan && m.google_status === 'ok' && <p className="text-xs text-gray-500">Bij het inplannen was 24 en 2 uur vooraf al voorbij, dus er is geen herinnering gepland.</p>}
          </>,
          actief && h?.status === 'mislukt' ? knop('herinnering', 'Nu opnieuw versturen', { actie: 'herinnering_opnieuw' }, 'Herinnering opnieuw verstuurd.')
            : actief && komend && m.google_status === 'ok' && m.herinnering_aan && (!h || h.status === 'geannuleerd') && kiesHerinnering(m.starts_at) ? knop('plan', 'Herinnering plannen', { actie: 'opnieuw', stap: 'herinnering' }, 'Herinnering gepland.') : null)}
      </div>

      {d.herinneringen.length > 1 && (
        <div>
          <div className={lbl}>Geschiedenis herinneringen</div>
          <ul className="text-xs text-gray-600 space-y-0.5">
            {d.herinneringen.map((x) => <li key={x.id}>{datumKort(x.gepland_voor)} {uur(x.gepland_voor)} · {H_LABEL[x.status] ?? x.status}{x.fout ? ` · ${x.fout}` : ''}</li>)}
          </ul>
        </div>
      )}

      {actief && m.herinnering_aan && d.mail && (
        <details className="rounded-md border border-gray-200">
          <summary className={`px-3 py-2 text-xs font-medium cursor-pointer ${focusRing}`}>De herinneringsmail zoals hij vertrekt</summary>
          <div className="px-3 pb-3 text-xs">
            <p className="font-semibold">{d.mail.onderwerp}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-gray-800">{d.mail.tekst}</pre>
          </div>
        </details>
      )}
    </Modal>
  )
}

// ── Weekweergave ─────────────────────────────────────────────────────────────

function Week({ meetings, maandag, onKies, onDag }: { meetings: Meeting[]; maandag: string; onKies: (id: string) => void; onDag: (d: string) => void }) {
  const dagen = Array.from({ length: 7 }, (_, i) => plusDagen(maandag, i))
  const vandaag = dag(new Date().toISOString())
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
      {dagen.map((d) => {
        const lijst = meetings.filter((m) => dag(m.starts_at) === d).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        const iso = `${d}T12:00:00.000Z`
        return (
          <div key={d} className={`rounded-lg border ${d === vandaag ? 'border-gray-900' : 'border-gray-200'} bg-white p-2 min-h-[5rem] md:min-h-[12rem]`}>
            <button type="button" onClick={() => onDag(d)} className={`w-full flex md:flex-col items-baseline md:items-start gap-2 md:gap-0 text-left mb-1.5 ${focusRing}`} title="Meeting op deze dag plannen">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">{datumKort(iso).split(' ')[0]}</span>
              <span className="text-sm font-semibold tabular-nums">{datumKort(iso).split(' ').slice(1).join(' ')}</span>
            </button>
            <div className="space-y-1">
              {lijst.map((m) => {
                const probleem = stappen(m).some((s) => s.toon === 'fout')
                return (
                  <button key={m.id} type="button" onClick={() => onKies(m.id)} className={`w-full text-left rounded-md border px-1.5 py-1 text-[11px] leading-tight hover:bg-gray-50 ${m.status === 'geannuleerd' ? 'border-gray-100 text-gray-400 line-through' : probleem ? 'border-red-200 bg-red-50/50' : 'border-gray-200'} ${focusRing}`}>
                    <span className="font-medium tabular-nums">{uur(m.starts_at)}</span> <span className="break-words">{m.titel}</span>
                    <span className="block text-gray-500 truncate">{m.klant_naam}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Pagina ───────────────────────────────────────────────────────────────────

type Tab = 'komend' | 'voorbij' | 'geannuleerd'
type Venster = { soort: 'plan'; meeting: Meeting | null; dag?: string } | { soort: 'detail'; id: string } | { soort: 'annuleer'; meeting: Meeting } | { soort: 'koppelingen' } | null

export function MeetingsClient() {
  const router = useRouter()
  const params = useSearchParams()
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [opties, setOpties] = useState<Opties | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('komend')
  const [weergave, setWeergave] = useState<'lijst' | 'week'>('lijst')
  const [maandag, setMaandag] = useState(() => maandagVan(dag(new Date().toISOString())))
  const [venster, setVenster] = useState<Venster>(null)

  const laad = useCallback(async () => {
    try { const j = await api<{ meetings: Meeting[] }>('/api/admin/meetings'); setMeetings(j.meetings); setFout(null) } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => {
    laad()
    api<Opties>('/api/admin/meetings?opties=1').then(setOpties).catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [laad])
  useEffect(() => { try { const w = localStorage.getItem('ngm-meetings-weergave'); if (w === 'week' || w === 'lijst') setWeergave(w) } catch { /* */ } }, [])
  useEffect(() => { try { localStorage.setItem('ngm-meetings-weergave', weergave) } catch { /* */ } }, [weergave])
  // Deep-link vanuit zoeken of een melding: ?meeting=<id>
  useEffect(() => { const id = params.get('meeting'); if (id) setVenster({ soort: 'detail', id }) }, [params])

  const sluit = useCallback(() => { setVenster(null); if (params.get('meeting')) router.replace('/admin/meetings') }, [params, router])

  const nu = Date.now()
  const lijsten = useMemo(() => {
    const alle = meetings ?? []
    return {
      komend: alle.filter((m) => m.status === 'ingepland' && new Date(m.ends_at).getTime() >= nu),
      voorbij: alle.filter((m) => m.status === 'ingepland' && new Date(m.ends_at).getTime() < nu).reverse(),
      geannuleerd: alle.filter((m) => m.status === 'geannuleerd').reverse(),
    }
  }, [meetings, nu])
  const zichtbaar = lijsten[tab]
  const problemen = lijsten.komend.filter((m) => stappen(m).some((s) => s.toon === 'fout')).length
  const zondag = plusDagen(maandag, 6)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Meetings</h1>
          <p className="text-sm text-gray-500">Plan een meeting met Google Meet-link en uitnodiging, met of zonder klant. Standaard in Belgische tijd.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {opties && <button type="button" onClick={() => setVenster({ soort: 'koppelingen' })} className={`btn-secondary ${focusRing}`}><ShieldCheck className="h-4 w-4" />Koppelingen</button>}
          {opties?.rechten.toevoegen && <button type="button" onClick={() => setVenster({ soort: 'plan', meeting: null })} className={`btn-primary ${focusRing}`}><Plus className="h-4 w-4" />Meeting plannen</button>}
        </div>
      </div>

      {problemen > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-center gap-2" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" />{problemen === 1 ? 'Eén komende meeting heeft' : `${problemen} komende meetings hebben`} een stap die misliep. Open de meeting om het opnieuw te proberen.
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap justify-between">
        {weergave === 'lijst' ? (
          <div role="tablist" aria-label="Meetings" className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 max-w-full overflow-x-auto">
            {([['komend', 'Komend'], ['voorbij', 'Voorbij'], ['geannuleerd', 'Geannuleerd']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${tab === k ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'} ${focusRing}`}>
                {l}<span className={`text-xs ${tab === k ? 'text-gray-400' : 'text-gray-500'}`}>{lijsten[k].length}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setMaandag(plusDagen(maandag, -7))} className={`btn-secondary !px-2 ${focusRing}`} aria-label="Vorige week"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => setMaandag(maandagVan(dag(new Date().toISOString())))} className={`btn-secondary ${focusRing}`}>Deze week</button>
            <button type="button" onClick={() => setMaandag(plusDagen(maandag, 7))} className={`btn-secondary !px-2 ${focusRing}`} aria-label="Volgende week"><ChevronRight className="h-4 w-4" /></button>
            <span className="text-sm text-gray-700 ml-1">{datumKort(`${maandag}T12:00:00Z`)} – {datumKort(`${zondag}T12:00:00Z`)}</span>
          </div>
        )}
        <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1" role="group" aria-label="Weergave">
          <button type="button" onClick={() => setWeergave('lijst')} aria-pressed={weergave === 'lijst'} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm ${weergave === 'lijst' ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'} ${focusRing}`}><List className="h-4 w-4" />Lijst</button>
          <button type="button" onClick={() => setWeergave('week')} aria-pressed={weergave === 'week'} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm ${weergave === 'week' ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'} ${focusRing}`}><CalendarDays className="h-4 w-4" />Week</button>
        </div>
      </div>

      {fout && <div className="card-base text-sm text-red-700">{fout}</div>}
      {!meetings && !fout && <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}

      {meetings && weergave === 'week' && (
        <Week meetings={meetings} maandag={maandag} onKies={(id) => setVenster({ soort: 'detail', id })}
          onDag={(d) => { if (opties?.rechten.toevoegen && d >= dag(new Date().toISOString())) setVenster({ soort: 'plan', meeting: null, dag: d }) }} />
      )}

      {meetings && weergave === 'lijst' && zichtbaar.length === 0 && (
        <div className="card-base empty-state">
          <Video className="h-6 w-6 mx-auto mb-2 text-gray-300" aria-hidden />
          {tab === 'komend' ? 'Geen komende meetings.' : tab === 'voorbij' ? 'Nog geen voorbije meetings.' : 'Geen geannuleerde meetings.'}
        </div>
      )}

      {meetings && weergave === 'lijst' && zichtbaar.length > 0 && (
        <ul className="space-y-2">
          {zichtbaar.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setVenster({ soort: 'detail', id: m.id })} className={`card-base !p-3 sm:!p-4 w-full text-left hover:border-gray-300 flex gap-3 sm:gap-4 ${focusRing}`}>
                <div className="w-14 shrink-0 text-center border-r border-gray-100 pr-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">{datumKort(m.starts_at).split(' ')[0]}</div>
                  <div className="text-xl font-semibold tabular-nums leading-tight">{datumKort(m.starts_at).split(' ')[1]}</div>
                  <div className="text-[11px] text-gray-500">{datumKort(m.starts_at).split(' ').slice(2).join(' ')}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 truncate">{m.titel}</span>
                    <span className="text-xs text-gray-500 tabular-nums">{uur(m.starts_at)}–{uur(m.ends_at)}{m.tijdzone !== STANDAARD_TIJDZONE && ` (${uur(m.starts_at, m.tijdzone)} ${m.tijdzone})`}</span>
                  </div>
                  <div className="text-xs text-gray-600 truncate">{m.client_id ? m.klant_naam : 'Geen klant'} · {m.klant_ontvangers.map((p) => p.naam || p.email).join(', ')}
                    {m.deelnemers.length > 0 && <span className="text-gray-400"> <Users className="h-3 w-3 inline -mt-0.5" aria-hidden /> +{m.deelnemers.length}</span>}
                  </div>
                  {m.status === 'ingepland' && <div className="flex flex-wrap gap-1 mt-1.5">{stappen(m).map((s, i) => <StapChip key={i} s={s} />)}</div>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {venster?.soort === 'plan' && opties && (
        <PlanVenster opties={opties} bestaand={venster.meeting} startDag={venster.dag} onSluit={() => setVenster(venster.meeting ? { soort: 'detail', id: venster.meeting.id } : null)}
          onOpen={(id) => setVenster({ soort: 'detail', id })}
          onKlaar={(m, melding) => { if (melding) toast.success(melding); laad(); setVenster({ soort: 'detail', id: m.id }) }} />
      )}
      {venster?.soort === 'detail' && opties && (
        <DetailVenster id={venster.id} opties={opties} onSluit={sluit} onVeranderd={laad}
          onWijzig={(m) => setVenster({ soort: 'plan', meeting: m })} onAnnuleer={(m) => setVenster({ soort: 'annuleer', meeting: m })} />
      )}
      {venster?.soort === 'annuleer' && (
        <AnnuleerVenster m={venster.meeting} onSluit={() => setVenster({ soort: 'detail', id: venster.meeting.id })}
          onKlaar={(m) => { toast.success('Meeting geannuleerd.'); laad(); setVenster({ soort: 'detail', id: m.id }) }} />
      )}
      {venster?.soort === 'koppelingen' && opties && <KoppelingenVenster opties={opties} onSluit={() => setVenster(null)} />}
    </div>
  )
}
