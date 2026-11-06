'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Video, Clock, ArrowLeft, Check, AlertTriangle, CalendarCheck } from 'lucide-react'
import { datumLang, uur, isEmail } from '@/lib/meetings/model'
import { Tijdkiezer, type Dag } from './tijdkiezer'

/**
 * Publieke boekingspagina. Stap 1 een vrij moment, stap 2 je gegevens, stap 3
 * nakijken en bevestigen. De server controleert alles opnieuw; deze pagina
 * toont enkel wat hij teruggeeft.
 */

const lbl = 'block text-xs font-medium text-gray-700 mb-1'
const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15'
const nieuweSleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '')

type Resultaat = { id: string; startsAt: string; endsAt: string; meetUrl: string | null; beheerUrl: string | null; bevestigingVerstuurd: boolean; herhaald?: boolean }

export function BoekClient() {
  const [dagen, setDagen] = useState<Dag[] | null>(null)
  const [laadFout, setLaadFout] = useState<string | null>(null)
  const [stap, setStap] = useState<'tijd' | 'gegevens' | 'controle' | 'klaar'>('tijd')
  const [start, setStart] = useState<string | null>(null)
  const [naam, setNaam] = useState('')
  const [email, setEmail] = useState('')
  const [bedrijf, setBedrijf] = useState('')
  const [reden, setReden] = useState('')
  const [website, setWebsite] = useState('')
  const [sleutel, setSleutel] = useState(nieuweSleutel)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [res, setRes] = useState<Resultaat | null>(null)

  const laad = useCallback(async () => {
    setDagen(null); setLaadFout(null)
    try {
      const r = await fetch('/api/boeken/beschikbaarheid', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Online boeken is even niet mogelijk.')
      setDagen(j.dagen ?? [])
    } catch (e) { setLaadFout(e instanceof Error ? e.message : 'Online boeken is even niet mogelijk.') }
  }, [])
  useEffect(() => { laad() }, [laad])

  // Pas in de browser uitlezen: de server rendert in UTC en dat zou niet overeenkomen.
  const [browserTz, setBrowserTz] = useState('Europe/Brussels')
  useEffect(() => { try { setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone) } catch { /* standaard */ } }, [])
  const naamFout = naam.trim().length > 0 && naam.trim().length < 2
  const mailFout = email.trim() !== '' && !isEmail(email)
  const gegevensOk = naam.trim().length >= 2 && isEmail(email)

  async function boek() {
    if (!start) return
    setBezig(true); setFout(null)
    try {
      const r = await fetch('/api/boeken', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aanvraag_sleutel: sleutel, start, naam, email, bedrijf, reden, website }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.status === 409) {
        // Net bezet geraakt: terug naar de tijden, met een verse lijst.
        setFout(j.error || 'Dit tijdstip is net niet meer beschikbaar. Kies een ander moment.')
        setStart(null); setSleutel(nieuweSleutel()); setStap('tijd'); await laad(); return
      }
      if (!r.ok) throw new Error(j.error || 'Boeken lukt nu niet. Probeer het later opnieuw.')
      setRes(j as Resultaat); setStap('klaar')
    } catch (e) { setFout(e instanceof Error ? e.message : 'Boeken lukt nu niet.') } finally { setBezig(false) }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Plan een gratis kennismaking</h1>
        <p className="text-sm text-gray-600 mt-1">Een meeting van 30 minuten via Google Meet, zonder kosten. Kies een moment dat je past.</p>
        <p className="text-sm text-gray-600 mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" aria-hidden />30 minuten</span>
          <span className="inline-flex items-center gap-1.5"><Video className="h-4 w-4" aria-hidden />Google Meet</span>
          <span className="font-medium">Boek minstens 3 dagen vooraf.</span>
        </p>
      </div>

      {fout && stap !== 'klaar' && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{fout}</p>}

      {stap === 'tijd' && (
        <section className="card-base space-y-3">
          <h2 className="font-medium">1. Kies een moment</h2>
          <p className="text-xs text-gray-500">Alle tijden in Belgische tijd (Europe/Brussels), tussen 11:00 en 17:00.{browserTz !== 'Europe/Brussels' && ` Je toestel staat op ${browserTz}.`}</p>
          {laadFout && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2" role="status">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <div><p>{laadFout}</p><button type="button" onClick={laad} className="underline mt-1">Opnieuw proberen</button></div>
            </div>
          )}
          {!dagen && !laadFout && <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label="Laden" /></div>}
          {dagen && <Tijdkiezer dagen={dagen} gekozen={start} onKies={(s) => { setStart(s); setFout(null); setStap('gegevens') }} />}
        </section>
      )}

      {stap === 'gegevens' && start && (
        <section className="card-base space-y-3">
          <h2 className="font-medium">2. Je gegevens</h2>
          <p className="text-sm">Gekozen: <strong className="first-letter:uppercase">{datumLang(start)} om {uur(start)}</strong> <button type="button" onClick={() => setStap('tijd')} className="underline text-xs ml-1">wijzigen</button></p>
          <div><label className={lbl} htmlFor="kb-naam">Naam</label><input id="kb-naam" className={INP} value={naam} maxLength={120} autoComplete="name" onChange={(e) => setNaam(e.target.value)} aria-invalid={naamFout} /></div>
          <div>
            <label className={lbl} htmlFor="kb-email">E-mailadres</label>
            <input id="kb-email" type="email" inputMode="email" autoComplete="email" className={`${INP} ${mailFout ? 'border-red-300' : ''}`} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={mailFout} />
            {mailFout && <p className="text-xs text-red-700 mt-1">Dit e-mailadres is niet geldig.</p>}
            <p className="text-xs text-gray-500 mt-1">Hierop krijg je de bevestiging, de uitnodiging van Google Agenda en de herinnering.</p>
          </div>
          <div><label className={lbl} htmlFor="kb-bedrijf">Bedrijf <span className="font-normal text-gray-500">(optioneel)</span></label><input id="kb-bedrijf" className={INP} value={bedrijf} maxLength={160} autoComplete="organization" onChange={(e) => setBedrijf(e.target.value)} /></div>
          <div><label className={lbl} htmlFor="kb-reden">Waarover wil je praten? <span className="font-normal text-gray-500">(optioneel)</span></label><textarea id="kb-reden" rows={3} className={INP} value={reden} maxLength={1000} onChange={(e) => setReden(e.target.value)} /></div>
          <div className="hidden" aria-hidden><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label></div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setStap('tijd')} className="btn-secondary"><ArrowLeft className="h-4 w-4" />Terug</button>
            <button type="button" disabled={!gegevensOk} onClick={() => setStap('controle')} className="btn-primary">Nakijken</button>
          </div>
        </section>
      )}

      {stap === 'controle' && start && (
        <section className="card-base space-y-3">
          <h2 className="font-medium">3. Klopt alles?</h2>
          <dl className="text-sm divide-y divide-gray-100">
            {[
              ['Datum', datumLang(start)],
              ['Tijd', `${uur(start)} – ${uur(new Date(new Date(start).getTime() + 30 * 60000).toISOString())}`],
              ['Tijdzone', 'Belgische tijd (Europe/Brussels)'],
              ['Duur', '30 minuten, gratis'],
              ['Naam', naam.trim()],
              ['E-mail', email.trim().toLowerCase()],
              ...(bedrijf.trim() ? [['Bedrijf', bedrijf.trim()]] : []),
            ].map(([k, v]) => <div key={k} className="flex gap-3 py-1.5"><dt className="w-24 shrink-0 text-gray-500">{k}</dt><dd className={`min-w-0 break-words ${k === 'Datum' ? 'first-letter:uppercase' : ''}`}>{v}</dd></div>)}
          </dl>
          <div className="flex gap-2 justify-end">
            <button type="button" disabled={bezig} onClick={() => setStap('gegevens')} className="btn-secondary"><ArrowLeft className="h-4 w-4" />Terug</button>
            <button type="button" disabled={bezig} onClick={boek} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bevestig je boeking</button>
          </div>
        </section>
      )}

      {stap === 'klaar' && res && (
        <section className="card-base space-y-3" role="status">
          <h2 className="font-medium flex items-center gap-2"><CalendarCheck className="h-5 w-5" aria-hidden />Je meeting staat vast</h2>
          <p className="text-sm first-letter:uppercase">{datumLang(res.startsAt)} om {uur(res.startsAt)} (Belgische tijd), 30 minuten.</p>
          {res.meetUrl && <p className="text-sm">Google Meet: <a className="underline break-all" href={res.meetUrl} target="_blank" rel="noreferrer">{res.meetUrl}</a></p>}
          <p className="text-sm text-gray-600">
            {res.bevestigingVerstuurd ? <>We stuurden een bevestiging naar <strong>{email.trim().toLowerCase()}</strong>. </> : <>De bevestigingsmail kon niet verstuurd worden; we nemen zelf contact op. </>}
            Je krijgt ook een uitnodiging van Google Agenda en de dag ervoor een korte herinnering.
          </p>
          {res.beheerUrl && <p className="text-sm"><a className="underline" href={res.beheerUrl}>Verplaatsen of annuleren</a> <span className="text-gray-500">(deze link staat ook in je mail)</span></p>}
        </section>
      )}
    </div>
  )
}
