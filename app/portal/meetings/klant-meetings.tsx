'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Video, Clock, ArrowLeft, Check, AlertTriangle, CalendarCheck, Plus, X, Users, CalendarX, MoveRight } from 'lucide-react'
import { datumLang, uur, isEmail } from '@/lib/meetings/model'
import { Tijdkiezer, type Dag } from '@/app/boeken/tijdkiezer'

/**
 * Klantapp — Meeting boeken en Mijn meetings. Stap 1 een vrij moment, stap 2
 * deelnemers en onderwerp, stap 3 nakijken en bevestigen. De server controleert
 * alles opnieuw; deze pagina toont enkel wat hij teruggeeft (nooit iets uit
 * onze agenda behalve vrije begintijden).
 */

type Meeting = {
  id: string; status: string; titel: string; startsAt: string; endsAt: string; meetUrl: string | null
  magAnnuleren: boolean; magVerplaatsen: boolean; onderwerp: string | null
  deelnemers: { naam: string | null; email: string }[]; organisator: string
}
type Overzicht = {
  meetings: Meeting[]
  profiel: { naam: string | null; email: string | null; bedrijf: string }
  magBoeken: boolean
  regels: { duurMinuten: number; minVooraf: string; venster: string; tijdzone: string }
}
type Rij = { naam: string; email: string }

const lbl = 'block text-xs font-medium text-gray-700 mb-1'
const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15'
const knop = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1'
const nieuweSleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '')
const CONTACT = <>Lukt het niet? Mail ons op <a className="underline underline-offset-2" href="mailto:info@nextgenmedia.be">info@nextgenmedia.be</a>.</>

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(j.error || 'Er ging iets mis.') as Error & { status?: number }; e.status = r.status; throw e }
  return j as T
}

function Wanneer({ m }: { m: { startsAt: string; endsAt: string } }) {
  return <span className="first-letter:uppercase inline-block">{datumLang(m.startsAt)}, {uur(m.startsAt)}–{uur(m.endsAt)}</span>
}

/** Vrije momenten ophalen en kiezen (ook voor verplaatsen). */
function MomentKiezer({ verplaats, huidig, gekozen, onKies }: { verplaats?: string; huidig?: string; gekozen: string | null; onKies: (s: string) => void }) {
  const [dagen, setDagen] = useState<Dag[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const laad = useCallback(async () => {
    setDagen(null); setFout(null)
    try {
      const j = await api<{ dagen: Dag[] }>(`/api/portal/meetings/beschikbaarheid${verplaats ? `?verplaats=${verplaats}` : ''}`)
      // Bij verplaatsen is het huidige moment geen keuze.
      const t = huidig ? Date.parse(huidig) : NaN
      setDagen(j.dagen.map((d) => ({ ...d, slots: d.slots.filter((x) => Date.parse(x.start) !== t) })).filter((d) => d.slots.length))
    } catch (e) { setFout(e instanceof Error ? e.message : 'Boeken is tijdelijk niet mogelijk.') }
  }, [verplaats, huidig])
  useEffect(() => { laad() }, [laad])
  if (fout) return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2" role="alert">
      <p className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{fout}</p>
      <button type="button" onClick={laad} className={`btn-secondary !py-1 text-xs ${knop}`}>Opnieuw proberen</button>
    </div>
  )
  if (!dagen) return <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label="Vrije momenten laden" /></div>
  return <Tijdkiezer dagen={dagen} gekozen={gekozen} onKies={onKies} />
}

export function KlantMeetings() {
  const [data, setData] = useState<Overzicht | null>(null)
  const [laadFout, setLaadFout] = useState<string | null>(null)
  const laad = useCallback(async () => {
    try { setData(await api<Overzicht>('/api/portal/meetings')); setLaadFout(null) } catch (e) { setLaadFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])

  if (laadFout) return <div className="card-base text-sm text-red-700">{laadFout}</div>
  if (!data) return <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const komend = data.meetings.filter((m) => m.status === 'ingepland' && Date.parse(m.endsAt) > Date.now())
  const ander = data.meetings.filter((m) => !komend.includes(m)).reverse().slice(0, 5)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
      {data.magBoeken
        ? <Boeken data={data} onGeboekt={laad} />
        : <div className="card-base text-sm text-gray-600">Je kan de meetings van je organisatie bekijken, maar niet zelf boeken. Vraag het aan de beheerder van jullie account.</div>}
      <section className="space-y-3" aria-labelledby="mijn-meetings">
        <h2 id="mijn-meetings" className="text-base font-semibold">Mijn meetings</h2>
        {komend.length === 0 && <div className="card-base text-sm text-gray-500">Nog geen geplande meetings.</div>}
        <ul className="space-y-2">
          {komend.map((m) => <li key={m.id}><MeetingKaart m={m} magBeheren={data.magBoeken} onVeranderd={laad} /></li>)}
        </ul>
        {ander.length > 0 && (
          <details className="text-sm">
            <summary className={`cursor-pointer text-gray-600 ${knop}`}>Voorbij of geannuleerd ({ander.length})</summary>
            <ul className="mt-2 space-y-1.5">
              {ander.map((m) => (
                <li key={m.id} className="text-gray-500"><Wanneer m={m} /> · {m.status === 'geannuleerd' ? 'geannuleerd' : 'voorbij'}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}

function MeetingKaart({ m, magBeheren, onVeranderd }: { m: Meeting; magBeheren: boolean; onVeranderd: () => void }) {
  const [modus, setModus] = useState<'niets' | 'verplaats' | 'annuleer'>('niets')
  const [nieuw, setNieuw] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  async function doe(body: Record<string, unknown>, ok: string) {
    setBezig(true); setFout(null)
    try {
      await api(`/api/portal/meetings/${m.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      toast.success(ok); setModus('niets'); setNieuw(null); onVeranderd()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Er ging iets mis.') } finally { setBezig(false) }
  }
  return (
    <div className="card-base !p-4 space-y-2">
      <div className="flex items-start gap-3">
        <CalendarCheck className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium"><Wanneer m={m} /></div>
          <div className="text-xs text-gray-600">30 minuten · Belgische tijd · met {m.organisator}</div>
          {m.onderwerp && <div className="text-sm text-gray-700 mt-1 break-words">{m.onderwerp}</div>}
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Users className="h-3 w-3" aria-hidden />{m.deelnemers.map((d) => d.naam || d.email).join(', ')}</div>
        </div>
      </div>
      {m.meetUrl && (
        <a href={m.meetUrl} target="_blank" rel="noreferrer" className={`flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium hover:border-gray-400 ${knop}`}>
          <Video className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{m.meetUrl.replace(/^https?:\/\//, '')}</span>
        </a>
      )}
      {magBeheren && modus === 'niets' && (m.magVerplaatsen || m.magAnnuleren) && (
        <div className="flex gap-2 flex-wrap">
          {m.magVerplaatsen && <button type="button" onClick={() => setModus('verplaats')} className={`btn-secondary !py-1.5 text-xs ${knop}`}><MoveRight className="h-3.5 w-3.5" />Verplaatsen</button>}
          {m.magAnnuleren && <button type="button" onClick={() => setModus('annuleer')} className={`btn-secondary !py-1.5 text-xs ${knop}`}><CalendarX className="h-3.5 w-3.5" />Annuleren</button>}
        </div>
      )}
      {modus === 'verplaats' && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <p className="text-sm font-medium">Kies een nieuw moment</p>
          <MomentKiezer verplaats={m.id} huidig={m.startsAt} gekozen={nieuw} onKies={setNieuw} />
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => { setModus('niets'); setNieuw(null); setFout(null) }} className={`btn-secondary !py-1.5 text-xs ${knop}`}><X className="h-3.5 w-3.5" />Toch niet</button>
            <button type="button" disabled={!nieuw || bezig} onClick={() => doe({ actie: 'verplaats', start: nieuw }, 'Verplaatst. Je krijgt een bevestiging en een bijgewerkte uitnodiging.')} className={`btn-primary !py-1.5 text-xs ${knop}`}>
              {bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{nieuw ? `Verplaatsen naar ${uur(nieuw)}` : 'Verplaatsen'}
            </button>
          </div>
        </div>
      )}
      {modus === 'annuleer' && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <p className="text-sm">Deze meeting annuleren? Iedereen die uitgenodigd is, krijgt een annulering van Google Agenda.</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => { setModus('niets'); setFout(null) }} className={`btn-secondary !py-1.5 text-xs ${knop}`}>Nee, laten staan</button>
            <button type="button" disabled={bezig} onClick={() => doe({ actie: 'annuleer' }, 'Je meeting is geannuleerd.')} className={`btn-danger !py-1.5 text-xs ${knop}`}>
              {bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarX className="h-3.5 w-3.5" />}Ja, annuleren
            </button>
          </div>
        </div>
      )}
      {fout && <p className="text-sm text-red-700" role="alert">{fout} {CONTACT}</p>}
      {!m.magVerplaatsen && !m.magAnnuleren && magBeheren && <p className="text-xs text-gray-500">Wijzigen kan niet meer. {CONTACT}</p>}
    </div>
  )
}

function Boeken({ data, onGeboekt }: { data: Overzicht; onGeboekt: () => void }) {
  const [stap, setStap] = useState<'tijd' | 'gegevens' | 'controle' | 'klaar'>('tijd')
  const [start, setStart] = useState<string | null>(null)
  const [naam, setNaam] = useState(data.profiel.naam ?? '')
  const [email, setEmail] = useState(data.profiel.email ?? '')
  const [extra, setExtra] = useState<Rij[]>([])
  const [onderwerp, setOnderwerp] = useState('')
  const [sleutel, setSleutel] = useState(nieuweSleutel)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [klaar, setKlaar] = useState<{ startsAt: string; endsAt: string; meetUrl: string | null; bevestigingVerstuurd: boolean } | null>(null)
  const [kiezerSleutel, setKiezerSleutel] = useState(0)

  const extraGeldig = extra.filter((r) => r.email.trim())
  const extraFout = extraGeldig.some((r) => !isEmail(r.email.trim()))
  const gegevensOk = naam.trim().length >= 2 && isEmail(email.trim()) && !extraFout

  async function boek() {
    if (!start) return
    setBezig(true); setFout(null)
    try {
      const r = await api<{ startsAt: string; endsAt: string; meetUrl: string | null; bevestigingVerstuurd: boolean }>('/api/portal/meetings', {
        method: 'POST',
        body: JSON.stringify({ aanvraag_sleutel: sleutel, start, naam: naam.trim(), email: email.trim(), onderwerp: onderwerp.trim(), deelnemers: extraGeldig.map((x) => ({ naam: x.naam.trim(), email: x.email.trim() })) }),
      })
      setKlaar(r); setStap('klaar'); onGeboekt()
    } catch (e) {
      const status = (e as { status?: number }).status
      setFout(e instanceof Error ? e.message : 'Boeken lukt nu niet.')
      // Intussen bezet: terug naar de tijden, vers opgehaald, met een nieuwe aanvraagsleutel.
      if (status === 409) { setStart(null); setStap('tijd'); setKiezerSleutel((x) => x + 1); setSleutel(nieuweSleutel()) }
    } finally { setBezig(false) }
  }
  const opnieuw = () => { setStap('tijd'); setStart(null); setKlaar(null); setFout(null); setOnderwerp(''); setExtra([]); setSleutel(nieuweSleutel()); setKiezerSleutel((x) => x + 1) }

  return (
    <section className="card-base space-y-4" aria-labelledby="boeken-titel">
      <div>
        <h2 id="boeken-titel" className="text-base font-semibold">Nieuwe meeting</h2>
        <p className="text-xs text-gray-600 mt-0.5 flex items-center gap-1.5 flex-wrap"><Clock className="h-3.5 w-3.5" aria-hidden />Gratis · 30 minuten · tussen {data.regels.venster} (Belgische tijd) · {data.regels.minVooraf}</p>
      </div>

      {fout && stap !== 'klaar' && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{fout}</p>}

      {stap === 'tijd' && (
        <>
          <MomentKiezer key={kiezerSleutel} gekozen={start} onKies={(s) => { setStart(s); setFout(null) }} />
          <button type="button" disabled={!start} onClick={() => setStap('gegevens')} className={`btn-primary w-full sm:w-auto justify-center ${knop}`}>Verder{start ? `: ${uur(start)}` : ''}</button>
        </>
      )}

      {stap === 'gegevens' && start && (
        <div className="space-y-3">
          <p className="text-sm"><b><Wanneer m={{ startsAt: start, endsAt: new Date(Date.parse(start) + 30 * 60000).toISOString() }} /></b></p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={lbl} htmlFor="km-naam">Naam</label><input id="km-naam" className={INP} value={naam} onChange={(e) => setNaam(e.target.value)} autoComplete="name" /></div>
            <div><label className={lbl} htmlFor="km-mail">E-mailadres</label><input id="km-mail" type="email" className={INP} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              {email.trim() && !isEmail(email.trim()) && <p className="text-xs text-red-700 mt-1">Vul een geldig e-mailadres in.</p>}</div>
          </div>
          <div>
            <div className={lbl}>Collega&apos;s uitnodigen <span className="font-normal text-gray-500">(optioneel)</span></div>
            <div className="space-y-2">
              {extra.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input className={INP} placeholder="Naam" value={r.naam} onChange={(e) => setExtra(extra.map((x, j) => j === i ? { ...x, naam: e.target.value } : x))} aria-label={`Naam collega ${i + 1}`} />
                  <input className={INP} type="email" placeholder="naam@bedrijf.be" value={r.email} onChange={(e) => setExtra(extra.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} aria-label={`E-mail collega ${i + 1}`} />
                  <button type="button" onClick={() => setExtra(extra.filter((_, j) => j !== i))} className={`btn-secondary !px-2 ${knop}`} aria-label="Verwijderen"><X className="h-4 w-4" /></button>
                </div>
              ))}
              {extra.length < 5 && <button type="button" onClick={() => setExtra([...extra, { naam: '', email: '' }])} className={`text-sm underline underline-offset-2 inline-flex items-center gap-1 ${knop}`}><Plus className="h-3.5 w-3.5" />Collega toevoegen</button>}
              {extraFout && <p className="text-xs text-red-700">Een van de e-mailadressen klopt niet.</p>}
            </div>
          </div>
          <div><label className={lbl} htmlFor="km-onderwerp">Waarover wil je het hebben? <span className="font-normal text-gray-500">(optioneel)</span></label>
            <textarea id="km-onderwerp" className={`${INP} min-h-[80px]`} maxLength={300} value={onderwerp} onChange={(e) => setOnderwerp(e.target.value)} placeholder="Bv. nieuwe campagne in het voorjaar" /></div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => setStap('tijd')} className={`btn-secondary ${knop}`}><ArrowLeft className="h-4 w-4" />Ander moment</button>
            <button type="button" disabled={!gegevensOk} onClick={() => setStap('controle')} className={`btn-primary ${knop}`}>Nakijken</button>
          </div>
        </div>
      )}

      {stap === 'controle' && start && (
        <div className="space-y-3">
          <dl className="divide-y divide-gray-100 text-sm">
            <div className="py-2 grid grid-cols-[110px_1fr] gap-2"><dt className="text-gray-500">Wanneer</dt><dd className="font-medium"><Wanneer m={{ startsAt: start, endsAt: new Date(Date.parse(start) + 30 * 60000).toISOString() }} /></dd></div>
            <div className="py-2 grid grid-cols-[110px_1fr] gap-2"><dt className="text-gray-500">Tijdzone</dt><dd>Belgische tijd (Europe/Brussels)</dd></div>
            <div className="py-2 grid grid-cols-[110px_1fr] gap-2"><dt className="text-gray-500">Duur</dt><dd>30 minuten, gratis</dd></div>
            <div className="py-2 grid grid-cols-[110px_1fr] gap-2"><dt className="text-gray-500">Waar</dt><dd>Google Meet (de link komt in de uitnodiging)</dd></div>
            <div className="py-2 grid grid-cols-[110px_1fr] gap-2"><dt className="text-gray-500">Uitnodiging</dt><dd className="break-words">{naam.trim()} &lt;{email.trim()}&gt;{extraGeldig.map((x) => <div key={x.email}>{x.naam.trim() ? `${x.naam.trim()} ` : ''}&lt;{x.email.trim()}&gt;</div>)}</dd></div>
            {onderwerp.trim() && <div className="py-2 grid grid-cols-[110px_1fr] gap-2"><dt className="text-gray-500">Onderwerp</dt><dd className="whitespace-pre-wrap break-words">{onderwerp.trim()}</dd></div>}
          </dl>
          <p className="text-xs text-gray-500">Na bevestigen krijgt iedereen een uitnodiging van Google Agenda. De dag ervoor sturen we een korte herinnering.</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => setStap('gegevens')} className={`btn-secondary ${knop}`}><ArrowLeft className="h-4 w-4" />Terug</button>
            <button type="button" disabled={bezig} onClick={boek} className={`btn-primary ${knop}`}>{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bevestigen en boeken</button>
          </div>
        </div>
      )}

      {stap === 'klaar' && klaar && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 font-medium"><Check className="h-5 w-5" />Je meeting staat vast</p>
          <p className="text-sm"><Wanneer m={klaar} /> (Belgische tijd)</p>
          {klaar.meetUrl && <a href={klaar.meetUrl} target="_blank" rel="noreferrer" className={`flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium hover:border-gray-400 ${knop}`}><Video className="h-4 w-4" />{klaar.meetUrl.replace(/^https?:\/\//, '')}</a>}
          <p className="text-sm text-gray-600">{klaar.bevestigingVerstuurd ? `De bevestiging is verstuurd naar ${email.trim()}.` : 'De meeting staat vast, maar de bevestigingsmail kon niet vertrekken. De uitnodiging van Google Agenda komt wel aan; wij sturen de bevestiging opnieuw.'}</p>
          <button type="button" onClick={opnieuw} className={`btn-secondary ${knop}`}>Nog een meeting boeken</button>
        </div>
      )}
      {stap !== 'klaar' && <p className="text-xs text-gray-500">{CONTACT}</p>}
    </section>
  )
}
