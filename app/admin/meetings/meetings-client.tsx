'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Loader2, Video, Check, AlertTriangle, Clock, Minus, Copy, ExternalLink, RotateCcw, Pencil, Ban, X, Users } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import { Modal, focusRing } from '@/app/admin/materiaal/dialogen'
import {
  DUUR_OPTIES, TIJDZONE_LABEL, valideerMeeting, kiesHerinnering, herinneringsMail, datumKort, datumLang, uur, dag, duurMinuten, wanneer,
  stapAgenda, stapMeet, stapClickup, stapHerinnering, momentLabel, isEmail, type Persoon, type StapWeergave, type Toon,
} from '@/lib/meetings/model'

/**
 * Klantmeetings — plannen, bekijken, aanpassen en annuleren. Eén scherm:
 * de lijst, een planvenster en een detailvenster met de status per stap
 * (Google Agenda, Meet, ClickUp, herinneringsmail).
 */

type Herinnering = {
  id: string; status: string; moment: string; gepland_voor: string; verzonden_op: string | null; fout: string | null
  ontvangers: Persoon[]; pogingen: number; created_at: string
}
type Meeting = {
  id: string; client_id: string | null; klant_naam: string; titel: string; beschrijving: string | null; starts_at: string; ends_at: string
  status: 'ingepland' | 'geannuleerd'; agenda_id: string | null; organisator_naam: string | null
  klant_ontvangers: Persoon[]; deelnemers: Persoon[]; herinnering_aan: boolean
  google_status: string; google_fout: string | null; meet_url: string | null
  clickup_task_id: string | null; clickup_status: string; clickup_fout: string | null
  created_by_email: string | null; created_at: string; geannuleerd_op: string | null; geannuleerd_door: string | null
  herinnering: Herinnering | null
}
type Klant = { id: string; company_name: string | null; contact_name: string | null; email: string | null }
type Opties = {
  klanten: Klant[]; contacten: { client_id: string; name: string | null; email: string | null }[]
  agendas: { id: string; naam: string; gekoppeld: boolean }[]; standaardAgenda: string | null
  ik: { naam: string | null; email: string }; rechten: { toevoegen: boolean; aanpassen: boolean }
}
type Detail = { meeting: Meeting; herinneringen: Herinnering[]; mail?: { onderwerp: string; tekst: string } }

const lbl = 'block text-xs font-medium text-gray-700 mb-1'
const nieuweSleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '')
const morgenBrussel = () => dag(new Date(Date.now() + 86400000).toISOString())
const MEET_PLAATSHOUDER = '[Google Meet-link, wordt aangemaakt bij het inplannen]'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
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
function stappen(m: Meeting) {
  return [stapAgenda(m), stapMeet(m), stapClickup(m), stapHerinnering(m, m.herinnering)]
}
const persoonTekst = (p: Persoon) => (p.naam ? `${p.naam} <${p.email}>` : p.email)

function Kopieer({ tekst }: { tekst: string }) {
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(tekst); toast.success('Gekopieerd.') } catch { toast.error('Kopiëren lukte niet.') } }}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-200 hover:bg-gray-50 ${focusRing}`} aria-label="Kopiëren"><Copy className="h-3.5 w-3.5" /></button>
  )
}

// ── Personenlijst (klantontvangers of deelnemers) ────────────────────────────

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
            <input className={`${INP} sm:w-2/5`} placeholder="Naam" value={r.naam} aria-label={`${label}: naam ${i + 1}`}
              onChange={(e) => zet(rijen.map((x, j) => (j === i ? { ...x, naam: e.target.value } : x)))} />
            <div className="flex-1 min-w-0">
              <input className={`${INP} ${slecht ? 'border-red-300' : ''}`} type="email" inputMode="email" placeholder="naam@bedrijf.be" value={r.email} aria-label={`${label}: e-mail ${i + 1}`}
                aria-invalid={slecht} onChange={(e) => zet(rijen.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
              {slecht && <p className="text-[11px] text-red-700 mt-0.5">Geen geldig e-mailadres.</p>}
            </div>
            <button type="button" onClick={() => zet(rijen.filter((_, j) => j !== i))} className={`h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 ${focusRing}`} aria-label="Verwijderen"><X className="h-4 w-4" /></button>
          </div>
        )
      })}
      <button type="button" onClick={() => zet([...rijen, { naam: '', email: '' }])} className={`text-xs font-medium underline underline-offset-2 ${focusRing}`}>+ toevoegen</button>
    </fieldset>
  )
}

// ── Planvenster (nieuw of aanpassen) ─────────────────────────────────────────

function PlanVenster({ opties, bestaand, onSluit, onKlaar }: {
  opties: Opties; bestaand: Meeting | null; onSluit: () => void; onKlaar: (m: Meeting, melding: string) => void
}) {
  const [sleutel] = useState(nieuweSleutel)
  const [clientId, setClientId] = useState(bestaand?.client_id ?? '')
  const [zoek, setZoek] = useState('')
  const [titel, setTitel] = useState(bestaand?.titel ?? '')
  const [beschrijving, setBeschrijving] = useState(bestaand?.beschrijving ?? '')
  const [datum, setDatum] = useState(bestaand ? dag(bestaand.starts_at) : morgenBrussel())
  const [tijd, setTijd] = useState(bestaand ? uur(bestaand.starts_at) : '10:00')
  const [duur, setDuur] = useState(bestaand ? duurMinuten(bestaand.starts_at, bestaand.ends_at) : 30)
  const [agendaId, setAgendaId] = useState(bestaand?.agenda_id ?? (opties.agendas.find((a) => a.id === opties.standaardAgenda && a.gekoppeld)?.id ?? opties.agendas.find((a) => a.gekoppeld)?.id ?? ''))
  const [organisator, setOrganisator] = useState(bestaand?.organisator_naam ?? '')
  const [klantRijen, setKlantRijen] = useState<Rij[]>((bestaand?.klant_ontvangers ?? []).map((p) => ({ naam: p.naam ?? '', email: p.email })))
  const [deelRijen, setDeelRijen] = useState<Rij[]>((bestaand?.deelnemers ?? []).map((p) => ({ naam: p.naam ?? '', email: p.email })))
  const [herinnering, setHerinnering] = useState(bestaand?.herinnering_aan ?? true)
  const [toonVoorbeeld, setToonVoorbeeld] = useState(false)
  const [bezig, setBezig] = useState(false)

  const klant = opties.klanten.find((k) => k.id === clientId) ?? null
  const klantNaam = klant ? (klant.company_name || klant.contact_name || 'Klant') : (bestaand?.klant_naam ?? '')
  const suggesties = useMemo(() => {
    if (!clientId) return [] as Rij[]
    const uit: Rij[] = []
    if (klant?.email) uit.push({ naam: klant.contact_name ?? '', email: klant.email })
    for (const c of opties.contacten) if (c.client_id === clientId && c.email) uit.push({ naam: c.name ?? '', email: c.email })
    const gezien = new Set<string>()
    return uit.filter((r) => { const k = r.email.trim().toLowerCase(); if (gezien.has(k)) return false; gezien.add(k); return true })
  }, [clientId, klant, opties.contacten])

  const kiesKlant = (id: string) => {
    setClientId(id); setZoek('')
    const k = opties.klanten.find((x) => x.id === id)
    // E-mail van de klant voorinvullen; aanpassen hier wijzigt het klantdossier niet.
    const eerste = k?.email ? [{ naam: k.contact_name ?? '', email: k.email }] : (opties.contacten.filter((c) => c.client_id === id && c.email).slice(0, 1).map((c) => ({ naam: c.name ?? '', email: c.email as string })))
    setKlantRijen(eerste)
    if (!titel) setTitel(`Meeting ${k?.company_name ?? ''}`.trim())
  }

  const invoer = {
    titel, beschrijving, dag: datum, uur: tijd, duur_minuten: duur, herinnering_aan: herinnering,
    klant_ontvangers: klantRijen.filter((r) => r.email.trim()).map((r) => ({ naam: r.naam, email: r.email })),
    deelnemers: deelRijen.filter((r) => r.email.trim()).map((r) => ({ naam: r.naam, email: r.email })),
  }
  const controle = valideerMeeting(invoer)
  const startsAt = controle.ok ? controle.waarde.startsAt : null
  const keuze = startsAt ? kiesHerinnering(startsAt) : null
  const agenda = opties.agendas.find((a) => a.id === agendaId)
  const browserTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Europe/Brussels'

  const voorbeeld = controle.ok ? herinneringsMail({
    klant_naam: klantNaam, titel: controle.waarde.titel, starts_at: controle.waarde.startsAt, meet_url: bestaand?.meet_url ?? MEET_PLAATSHOUDER,
    beschrijving: controle.waarde.beschrijving, organisator_naam: organisator.trim() || agenda?.naam.split(/\s+[—-]\s+/)[0] || null,
    ontvangers: controle.waarde.klant_ontvangers,
  }) : null

  const fout = !bestaand && !clientId ? 'Kies een klant.' : !controle.ok ? controle.fout : !bestaand && !agendaId ? 'Kies de agenda waarin de meeting komt.' : !bestaand && agenda && !agenda.gekoppeld ? 'De Google-koppeling van deze agenda is verlopen.' : null

  async function bewaar() {
    if (fout) { toast.error(fout); return }
    setBezig(true)
    try {
      if (bestaand) {
        const j = await api<{ meeting: Meeting; ongewijzigd?: boolean; herinneringFout?: string | null }>(`/api/admin/meetings/${bestaand.id}`, { method: 'PATCH', body: JSON.stringify({ actie: 'wijzig', ...invoer }) })
        onKlaar(j.meeting, j.ongewijzigd ? 'Er was niets gewijzigd.' : j.herinneringFout ? `Aangepast, maar de herinnering is niet opnieuw gepland: ${j.herinneringFout}` : 'Meeting aangepast.')
      } else {
        const j = await api<{ meeting: Meeting; herhaald?: boolean; herinneringFout?: string | null }>('/api/admin/meetings', { method: 'POST', body: JSON.stringify({ aanvraag_sleutel: sleutel, client_id: clientId, agenda_id: agendaId, organisator_naam: organisator, ...invoer }) })
        onKlaar(j.meeting, j.herhaald ? 'Deze meeting stond al ingepland.' : j.herinneringFout ? `Ingepland, maar de herinnering kon niet gepland worden: ${j.herinneringFout}` : 'Meeting ingepland.')
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Inplannen mislukt') } finally { setBezig(false) }
  }

  const klantLijst = opties.klanten.filter((k) => `${k.company_name ?? ''} ${k.contact_name ?? ''} ${k.email ?? ''}`.toLowerCase().includes(zoek.trim().toLowerCase())).slice(0, 50)

  return (
    <Modal breed titel={bestaand ? 'Meeting aanpassen' : 'Meeting inplannen'} sub={bestaand ? `${bestaand.klant_naam} · zelfde agenda-afspraak en Meet-link` : 'Google Agenda met Meet, ClickUp en een herinneringsmail'} onSluit={onSluit}
      voet={<>
        <button type="button" onClick={onSluit} className={`btn-secondary ${focusRing}`}>Annuleren</button>
        <button type="button" onClick={bewaar} disabled={bezig || !!fout} className={`btn-primary ${focusRing}`} title={fout ?? undefined}>
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{bestaand ? 'Wijzigingen bewaren' : 'Inplannen'}
        </button>
      </>}>
      {/* Klant */}
      {bestaand ? (
        <div><span className={lbl}>Klant</span><p className="text-sm font-medium">{bestaand.klant_naam}</p></div>
      ) : (
        <div>
          <label className={lbl} htmlFor="mt-klant">Klant</label>
          {klant ? (
            <div className="flex items-center gap-2 rounded-lg border border-gray-900 bg-gray-50 px-3 py-2 text-sm">
              <span className="flex-1 font-medium truncate">{klantNaam}</span>
              <button type="button" onClick={() => { setClientId(''); setKlantRijen([]) }} className={`text-xs underline ${focusRing}`}>wijzigen</button>
            </div>
          ) : (
            <>
              <input id="mt-klant" autoFocus className={INP} placeholder="Zoek klant of contactpersoon…" value={zoek} onChange={(e) => setZoek(e.target.value)} />
              <ul className="mt-1.5 max-h-44 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200">
                {klantLijst.map((k) => (
                  <li key={k.id}><button type="button" onClick={() => kiesKlant(k.id)} className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${focusRing}`}>
                    <span className="font-medium">{k.company_name || k.contact_name}</span>
                    <span className="text-[11px] text-gray-500"> {[k.contact_name, k.email].filter(Boolean).join(' · ') || 'geen e-mailadres gekend'}</span>
                  </button></li>
                ))}
                {klantLijst.length === 0 && <li className="px-3 py-3 text-xs text-gray-500">Geen klant gevonden.</li>}
              </ul>
            </>
          )}
        </div>
      )}

      {(clientId || bestaand) && (
        <>
          <Personen label="Klantontvangers" rijen={klantRijen} zet={setKlantRijen}
            uitleg="Krijgen de uitnodiging én de herinneringsmail. Een adres aanpassen geldt enkel voor deze meeting; het klantdossier blijft ongewijzigd."
            leegTekst="Er is geen e-mailadres gekend voor deze klant. Vul het adres in dat de uitnodiging moet krijgen." />
          {suggesties.length > 0 && (
            <div className="flex flex-wrap gap-1.5 -mt-1">
              {suggesties.map((s) => {
                const al = klantRijen.some((r) => r.email.trim().toLowerCase() === s.email.toLowerCase())
                return <button key={s.email} type="button" disabled={al} onClick={() => setKlantRijen([...klantRijen, s])} className={`rounded-full border px-2 py-0.5 text-[11px] ${al ? 'border-gray-200 text-gray-400' : 'border-gray-300 hover:bg-gray-50'} ${focusRing}`}>{al ? '✓ ' : '+ '}{s.naam || s.email}</button>
              })}
            </div>
          )}
          <Personen label="Deelnemers" rijen={deelRijen} zet={setDeelRijen} uitleg="Enkel uitgenodigd op de agenda-afspraak, geen herinneringsmail. Bv. collega's." leegTekst="Geen extra deelnemers." />
        </>
      )}

      <div>
        <label className={lbl} htmlFor="mt-titel">Titel</label>
        <input id="mt-titel" className={INP} value={titel} maxLength={200} onChange={(e) => setTitel(e.target.value)} placeholder="Bv. Contentplanning Q1" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div><label className={lbl} htmlFor="mt-dag">Datum</label><input id="mt-dag" type="date" className={INP} value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
        <div><label className={lbl} htmlFor="mt-uur">Starttijd</label><input id="mt-uur" type="time" step={300} className={INP} value={tijd} onChange={(e) => setTijd(e.target.value)} /></div>
        <div className="col-span-2 sm:col-span-1"><label className={lbl} htmlFor="mt-duur">Duur</label>
          <select id="mt-duur" className={INP} value={duur} onChange={(e) => setDuur(Number(e.target.value))}>
            {[...new Set([...DUUR_OPTIES, duur])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d < 60 ? `${d} min` : `${Math.floor(d / 60)} u${d % 60 ? ` ${d % 60}` : ''}`}</option>)}
          </select>
        </div>
      </div>
      <p className="text-[11px] text-gray-600 -mt-2">
        <Clock className="h-3 w-3 inline -mt-0.5 mr-1" aria-hidden />{TIJDZONE_LABEL}
        {startsAt && controle.ok && <> · {wanneer(startsAt)} – {uur(controle.waarde.endsAt)}</>}
        {browserTz !== 'Europe/Brussels' && <span className="block text-amber-700">Je toestel staat op {browserTz}; de meeting wordt gepland in Belgische tijd.</span>}
      </p>

      {!bestaand && (
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <label className={lbl} htmlFor="mt-agenda">Agenda (Google)</label>
            <select id="mt-agenda" className={INP} value={agendaId} onChange={(e) => setAgendaId(e.target.value)}>
              <option value="">Kies…</option>
              {opties.agendas.map((a) => <option key={a.id} value={a.id} disabled={!a.gekoppeld}>{a.naam}{a.gekoppeld ? '' : ' (koppeling verlopen)'}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="mt-org">Organisator (in de mail)</label>
            <input id="mt-org" className={INP} value={organisator} maxLength={120} onChange={(e) => setOrganisator(e.target.value)} placeholder={agenda?.naam.split(/\s+[—-]\s+/)[0] ?? 'Naam'} />
          </div>
        </div>
      )}

      <div>
        <label className={lbl} htmlFor="mt-besch">Beschrijving / agenda <span className="font-normal text-gray-500">(optioneel)</span></label>
        <textarea id="mt-besch" rows={3} className={INP} value={beschrijving} maxLength={5000} onChange={(e) => setBeschrijving(e.target.value)} placeholder="Wat bespreken we?" />
      </div>

      <div className="rounded-lg border border-gray-200 p-3 space-y-2">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={herinnering} onChange={(e) => setHerinnering(e.target.checked)} />
          <span>
            <span className="font-medium">Herinneringsmail naar de klantontvanger(s)</span>
            <span className="block text-[11px] text-gray-500">Vertrekt automatisch, ook als niemand de app open heeft. Je bevestigt dit hier per meeting.</span>
          </span>
        </label>
        {herinnering && startsAt && (keuze
          ? <p className="text-xs text-gray-700">Wordt verstuurd op <strong>{datumLang(keuze.geplandVoor)} om {uur(keuze.geplandVoor)}</strong> ({keuze.label}).{keuze.moment !== '24u' && ' 24 uur vooraf is al voorbij.'}</p>
          : <p className="text-xs text-amber-700 flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />De meeting begint te snel: er wordt geen herinnering gepland.</p>)}
        {herinnering && voorbeeld && (
          <div>
            <button type="button" onClick={() => setToonVoorbeeld(!toonVoorbeeld)} className={`text-xs font-medium underline underline-offset-2 ${focusRing}`}>{toonVoorbeeld ? 'Voorbeeld verbergen' : 'Voorbeeld van de mail bekijken'}</button>
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

      {fout && (clientId || bestaand) && <p className="text-xs text-red-700" role="alert">{fout}</p>}
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
    <Modal titel="Meeting annuleren" sub={`${m.klant_naam} · ${m.titel}`} onSluit={onSluit}
      voet={<>
        <button type="button" onClick={onSluit} className={`btn-secondary ${focusRing}`}>Terug</button>
        <button type="button" onClick={doe} disabled={bezig} className={`btn-danger ${focusRing}`}>{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}Meeting annuleren</button>
      </>}>
      <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5">
        <li>De afspraak in Google Agenda wordt geannuleerd.</li>
        <li>De ClickUp-taak krijgt [GEANNULEERD] en wordt gesloten, zoals bij de verkoopafspraken.</li>
        <li>Een geplande herinneringsmail wordt ingetrokken.</li>
        <li>De app stuurt zelf geen annuleringsmail.</li>
      </ul>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={verwittigen} onChange={(e) => setVerwittigen(e.target.checked)} />
        <span>Google laat de genodigden weten dat de afspraak vervalt<span className="block text-[11px] text-gray-500">Zonder dit blijft de afspraak in agenda&apos;s buiten Google soms gewoon staan.</span></span>
      </label>
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
  const agenda = opties.agendas.find((a) => a.id === m.agenda_id)
  const kan = opties.rechten.aanpassen
  const actief = m.status === 'ingepland'
  const komend = new Date(m.starts_at).getTime() > Date.now()
  const h = m.herinnering
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

  return (
    <Modal breed titel={<span className="flex items-center gap-2">{m.titel}{!actief && <span className="status-badge bg-gray-100 text-gray-600">Geannuleerd</span>}</span>}
      sub={`${m.klant_naam} · ${wanneer(m.starts_at)} – ${uur(m.ends_at)} (Belgische tijd)`} onSluit={onSluit}
      voet={kan && actief && komend ? <>
        <button type="button" onClick={() => onAnnuleer(m)} className={`btn-danger ${focusRing}`}><Ban className="h-4 w-4" />Annuleren</button>
        <button type="button" onClick={() => onWijzig(m)} className={`btn-primary ${focusRing}`}><Pencil className="h-4 w-4" />Aanpassen</button>
      </> : undefined}>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div><div className={lbl}>Klantontvangers</div>{m.klant_ontvangers.map((p) => <div key={p.email} className="truncate">{persoonTekst(p)}</div>)}</div>
        <div><div className={lbl}>Deelnemers</div>{m.deelnemers.length ? m.deelnemers.map((p) => <div key={p.email} className="truncate">{persoonTekst(p)}</div>) : <span className="text-gray-400">—</span>}</div>
        <div><div className={lbl}>Agenda</div>{agenda?.naam ?? '—'}{m.organisator_naam ? ` · organisator ${m.organisator_naam}` : ''}</div>
        <div><div className={lbl}>Ingepland door</div>{m.created_by_email ?? '—'} · {datumKort(m.created_at)}</div>
      </div>
      {m.beschrijving && <div><div className={lbl}>Beschrijving</div><p className="text-sm whitespace-pre-wrap">{m.beschrijving}</p></div>}
      {!actief && <p className="text-xs text-gray-500">Geannuleerd{m.geannuleerd_door ? ` door ${m.geannuleerd_door}` : ''}{m.geannuleerd_op ? ` op ${datumKort(m.geannuleerd_op)} ${uur(m.geannuleerd_op)}` : ''}.</p>}

      <div className="divide-y divide-gray-100 border-y border-gray-100">
        {rij('Google Agenda', stapAgenda(m),
          m.google_fout ? <p className="text-xs text-red-700">{m.google_fout}</p> : null,
          m.google_status === 'fout' ? knop('google', actief ? 'Opnieuw proberen' : 'Annulering opnieuw', { actie: 'opnieuw', stap: 'google' }, actief ? 'Agenda-stap opnieuw uitgevoerd.' : 'Annulering opnieuw geprobeerd.') : null)}
        {rij('Google Meet', stapMeet(m),
          m.meet_url && actief ? <div className="flex items-center gap-1.5"><a href={m.meet_url} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2 truncate">{m.meet_url}</a><Kopieer tekst={m.meet_url} /></div> : null,
          actief && m.google_status === 'ok' && !m.meet_url ? knop('meet', 'Meet-link aanvragen', { actie: 'opnieuw', stap: 'google' }, 'Meet-link opnieuw aangevraagd.') : null)}
        {rij('ClickUp', stapClickup(m),
          <>
            {m.clickup_task_id && <a href={`https://app.clickup.com/t/${m.clickup_task_id}`} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2 inline-flex items-center gap-1">Taak openen<ExternalLink className="h-3 w-3" /></a>}
            {m.clickup_fout && <p className={`text-xs ${m.clickup_status === 'fout' ? 'text-red-700' : 'text-gray-500'}`}>{m.clickup_fout}</p>}
          </>,
          m.clickup_status === 'fout' ? knop('clickup', 'Opnieuw proberen', { actie: 'opnieuw', stap: 'clickup' }, 'ClickUp-stap opnieuw uitgevoerd.') : null)}
        {rij('Herinnering', stapHerinnering(m, h),
          <>
            {h && <p className="text-xs text-gray-600">{momentLabel(h.moment)} · {h.status === 'verzonden' && h.verzonden_op ? `verstuurd ${datumKort(h.verzonden_op)} ${uur(h.verzonden_op)}` : `gepland ${datumKort(h.gepland_voor)} ${uur(h.gepland_voor)}`} · naar {h.ontvangers.map((p) => p.email).join(', ')}</p>}
            {h?.fout && <p className={`text-xs ${h.status === 'mislukt' ? 'text-red-700' : 'text-gray-500'}`}>{h.fout}</p>}
            {!h && actief && m.herinnering_aan && <p className="text-xs text-gray-500">Bij het inplannen was 24 en 2 uur vooraf al voorbij, dus er is geen herinnering gepland.</p>}
          </>,
          actief && h?.status === 'mislukt' ? knop('herinnering', 'Nu opnieuw versturen', { actie: 'herinnering_opnieuw' }, 'Herinnering opnieuw verstuurd.')
            : actief && komend && m.herinnering_aan && (!h || h.status === 'geannuleerd') && kiesHerinnering(m.starts_at) ? knop('plan', 'Herinnering plannen', { actie: 'opnieuw', stap: 'herinnering' }, 'Herinnering gepland.') : null)}
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

// ── Pagina ───────────────────────────────────────────────────────────────────

type Tab = 'komend' | 'voorbij' | 'geannuleerd'
type Venster = { soort: 'plan'; meeting: Meeting | null } | { soort: 'detail'; id: string } | { soort: 'annuleer'; meeting: Meeting } | null

export function MeetingsClient() {
  const router = useRouter()
  const params = useSearchParams()
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [opties, setOpties] = useState<Opties | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('komend')
  const [venster, setVenster] = useState<Venster>(null)

  const laad = useCallback(async () => {
    try { const j = await api<{ meetings: Meeting[] }>('/api/admin/meetings'); setMeetings(j.meetings); setFout(null) } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => {
    laad()
    api<Opties>('/api/admin/meetings?opties=1').then(setOpties).catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [laad])
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Klantmeetings</h1>
          <p className="text-sm text-gray-500">Google Agenda met Meet-link, ClickUp-taak en herinneringsmail. Alle tijden in Belgische tijd.</p>
        </div>
        {opties?.rechten.toevoegen && <button type="button" onClick={() => setVenster({ soort: 'plan', meeting: null })} className={`btn-primary ${focusRing}`}><Plus className="h-4 w-4" />Meeting inplannen</button>}
      </div>

      {problemen > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-center gap-2" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" />{problemen === 1 ? 'Eén komende meeting heeft' : `${problemen} komende meetings hebben`} een stap die misliep. Open de meeting om het opnieuw te proberen.
        </div>
      )}

      <div role="tablist" aria-label="Klantmeetings" className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 max-w-full overflow-x-auto">
        {([['komend', 'Komend'], ['voorbij', 'Voorbij'], ['geannuleerd', 'Geannuleerd']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${tab === k ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'} ${focusRing}`}>
            {l}<span className={`text-xs ${tab === k ? 'text-gray-400' : 'text-gray-500'}`}>{lijsten[k].length}</span>
          </button>
        ))}
      </div>

      {fout && <div className="card-base text-sm text-red-700">{fout}</div>}
      {!meetings && !fout && <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {meetings && zichtbaar.length === 0 && (
        <div className="card-base empty-state">
          <Video className="h-6 w-6 mx-auto mb-2 text-gray-300" aria-hidden />
          {tab === 'komend' ? 'Geen komende klantmeetings.' : tab === 'voorbij' ? 'Nog geen voorbije meetings.' : 'Geen geannuleerde meetings.'}
        </div>
      )}

      {meetings && zichtbaar.length > 0 && (
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
                    <span className="text-xs text-gray-500 tabular-nums">{uur(m.starts_at)}–{uur(m.ends_at)}</span>
                  </div>
                  <div className="text-xs text-gray-600 truncate">{m.klant_naam} · {m.klant_ontvangers.map((p) => p.naam || p.email).join(', ')}
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
        <PlanVenster opties={opties} bestaand={venster.meeting} onSluit={() => setVenster(venster.meeting ? { soort: 'detail', id: venster.meeting.id } : null)}
          onKlaar={(m, melding) => { toast.success(melding); laad(); setVenster({ soort: 'detail', id: m.id }) }} />
      )}
      {venster?.soort === 'detail' && opties && (
        <DetailVenster id={venster.id} opties={opties} onSluit={sluit} onVeranderd={laad}
          onWijzig={(m) => setVenster({ soort: 'plan', meeting: m })} onAnnuleer={(m) => setVenster({ soort: 'annuleer', meeting: m })} />
      )}
      {venster?.soort === 'annuleer' && (
        <AnnuleerVenster m={venster.meeting} onSluit={() => setVenster({ soort: 'detail', id: venster.meeting.id })}
          onKlaar={(m) => { toast.success('Meeting geannuleerd.'); laad(); setVenster({ soort: 'detail', id: m.id }) }} />
      )}
    </div>
  )
}
