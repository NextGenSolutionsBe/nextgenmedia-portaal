'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Video, CalendarX, CalendarClock, ArrowLeft, Check, AlertTriangle } from 'lucide-react'
import { datumLang, uur } from '@/lib/meetings/model'
import { Tijdkiezer, type Dag } from '../tijdkiezer'

/**
 * De eigen boeking beheren met de persoonlijke link (/boeken/beheer#t=…). Het
 * token staat achter # en gaat dus nooit mee in een verzoek naar de server
 * als adres; we sturen het enkel in de body naar onze eigen API.
 */

type Boeking = { status: string; naam: string | null; titel: string; startsAt: string; endsAt: string; tijdzone: string; meetUrl: string | null; magAnnuleren: boolean; magVerplaatsen: boolean }

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch('/api/boeken/beheer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || 'Er ging iets mis.'), { status: r.status })
  return j as T
}

export function BeheerClient() {
  const [token, setToken] = useState<string | null>(null)
  const [b, setB] = useState<Boeking | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [modus, setModus] = useState<'bekijk' | 'annuleer' | 'tijd' | 'controle'>('bekijk')
  const [dagen, setDagen] = useState<Dag[] | null>(null)
  const [nieuw, setNieuw] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [melding, setMelding] = useState<string | null>(null)

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t')
    setToken(t)
    if (!t) setFout('Deze link is onvolledig. Gebruik de volledige link uit je bevestigingsmail.')
  }, [])
  const laad = useCallback(async () => {
    if (!token) return
    try { setB((await api<{ boeking: Boeking }>({ token, actie: 'lees' })).boeking); setFout(null) } catch (e) { setFout(e instanceof Error ? e.message : 'Er ging iets mis.') }
  }, [token])
  useEffect(() => { laad() }, [laad])

  async function tijden() {
    setModus('tijd'); setDagen(null); setFout(null)
    try { setDagen((await api<{ dagen: Dag[] }>({ token, actie: 'tijden' })).dagen) } catch (e) { setFout(e instanceof Error ? e.message : 'Er ging iets mis.'); setModus('bekijk') }
  }
  async function doe(actie: 'annuleer' | 'verplaats') {
    setBezig(true); setFout(null)
    try {
      const r = await api<{ boeking: Boeking }>({ token, actie, start: nieuw })
      setB(r.boeking); setModus('bekijk'); setNieuw(null)
      setMelding(actie === 'annuleer' ? 'Je meeting is geannuleerd.' : 'Je meeting is verplaatst. Je krijgt een nieuwe bevestiging en een bijgewerkte uitnodiging van Google Agenda.')
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Er ging iets mis.')
      if ((e as { status?: number }).status === 409) { setNieuw(null); await tijden() }
    } finally { setBezig(false) }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-semibold">Je meeting met NextGenMedia</h1>
      {melding && <p className="rounded-lg border border-gray-900 bg-white p-3 text-sm" role="status">{melding}</p>}
      {fout && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2" role="alert"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />{fout}</p>}
      {!b && !fout && <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label="Laden" /></div>}

      {b && modus === 'bekijk' && (
        <section className="card-base space-y-3">
          {b.status === 'geannuleerd' ? (
            <>
              <p className="text-sm">Deze meeting is geannuleerd.</p>
              <a className="btn-primary inline-flex" href="/boeken">Nieuwe meeting boeken</a>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">{b.naam ? `Hallo ${b.naam}, ` : ''}dit is je geplande meeting:</p>
              <p className="text-lg font-medium first-letter:uppercase">{datumLang(b.startsAt)} om {uur(b.startsAt)}</p>
              <p className="text-sm text-gray-600">Belgische tijd (Europe/Brussels) · 30 minuten</p>
              {b.meetUrl && <p className="text-sm flex items-center gap-2"><Video className="h-4 w-4" aria-hidden /><a className="underline break-all" href={b.meetUrl} target="_blank" rel="noreferrer">{b.meetUrl}</a></p>}
              {(b.magVerplaatsen || b.magAnnuleren) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {b.magVerplaatsen && <button type="button" onClick={tijden} className="btn-secondary"><CalendarClock className="h-4 w-4" />Verplaatsen</button>}
                  {b.magAnnuleren && <button type="button" onClick={() => setModus('annuleer')} className="btn-danger"><CalendarX className="h-4 w-4" />Annuleren</button>}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {b && modus === 'annuleer' && (
        <section className="card-base space-y-3">
          <p className="text-sm">Weet je zeker dat je de meeting van <strong className="first-letter:uppercase">{datumLang(b.startsAt)} om {uur(b.startsAt)}</strong> wil annuleren?</p>
          <div className="flex gap-2 justify-end">
            <button type="button" disabled={bezig} onClick={() => setModus('bekijk')} className="btn-secondary"><ArrowLeft className="h-4 w-4" />Terug</button>
            <button type="button" disabled={bezig} onClick={() => doe('annuleer')} className="btn-danger">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarX className="h-4 w-4" />}Ja, annuleren</button>
          </div>
        </section>
      )}

      {b && modus === 'tijd' && (
        <section className="card-base space-y-3">
          <h2 className="font-medium">Kies een nieuw moment</h2>
          <p className="text-xs text-gray-500">Belgische tijd, tussen 11:00 en 17:00. Boek minstens 3 dagen vooraf.</p>
          {!dagen && <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label="Laden" /></div>}
          {dagen && <Tijdkiezer dagen={dagen} gekozen={nieuw} onKies={(s) => { setNieuw(s); setModus('controle') }} />}
          <button type="button" onClick={() => setModus('bekijk')} className="btn-secondary"><ArrowLeft className="h-4 w-4" />Terug</button>
        </section>
      )}

      {b && modus === 'controle' && nieuw && (
        <section className="card-base space-y-3">
          <p className="text-sm">Verplaatsen van <span className="first-letter:uppercase">{datumLang(b.startsAt)} om {uur(b.startsAt)}</span></p>
          <p className="text-sm">naar <strong className="first-letter:uppercase">{datumLang(nieuw)} om {uur(nieuw)}</strong> (Belgische tijd, 30 minuten)?</p>
          <div className="flex gap-2 justify-end">
            <button type="button" disabled={bezig} onClick={() => setModus('tijd')} className="btn-secondary"><ArrowLeft className="h-4 w-4" />Ander moment</button>
            <button type="button" disabled={bezig} onClick={() => doe('verplaats')} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bevestig</button>
          </div>
        </section>
      )}
    </div>
  )
}
