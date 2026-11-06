'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Ban, CalendarDays, CalendarPlus, Check, Clock, Loader2, MapPin, Mic, Monitor, Plus, Trash2, UserPlus, Users, Video, X } from 'lucide-react'
import { NieuwsInhoud } from '@/components/nieuws/nieuws-inhoud'
import {
  soortLabel, DICHT_LABEL, MAX_DEELNEMERS_PER_INSCHRIJVING, akkoordTekst, euro, googleAgendaLink, heeftMeet, inschrijvingOpen, prijsTekst, wanneerTekst, aftelling,
} from '@/lib/events'
import type { PortaalEvent } from '@/lib/events-server'
import { AftelBlokken, Omslag, hoofdletter, uurKort, useNu } from './events-ui'

type Ik = { naam: string; email: string }

export function EventDetail({ e, ik, magInschrijven, appLink }: { e: PortaalEvent; ik: Ik; magInschrijven: boolean; appLink: string }) {
  const router = useRouter()
  const [dialoog, setDialoog] = useState<null | 'zelf' | 'collega'>(null)
  const [uit, setUit] = useState<string | null>(null)
  const nu = useNu(30_000)
  const open = inschrijvingOpen(e, e.bezet)
  const ikIngeschreven = e.mijn.some((m) => m.email.toLowerCase() === ik.email.toLowerCase())
  const teamIngeschreven = e.mijn.length > 0
  const geannuleerd = e.status === 'geannuleerd'
  const bezig = nu !== null && aftelling(e.start_op, e.einde_op, nu).fase === 'bezig'
  const binnenkort = nu !== null && Date.parse(e.start_op) - nu < 60 * 60_000 && Date.parse(e.einde_op) > nu
  const vrij = e.capaciteit != null ? Math.max(0, e.capaciteit - e.bezet) : null
  const begonnen = nu !== null && Date.parse(e.start_op) <= nu

  const schrijfUit = async (id: string, naam: string) => {
    if (!window.confirm(`${naam} uitschrijven? De plaats gaat terug naar iemand anders.`)) return
    setUit(id)
    try {
      const r = await fetch(`/api/portal/events/inschrijving/${id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Uitschrijven lukte niet')
      toast.success(`${naam} is uitgeschreven.`)
      router.refresh()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Mislukt') }
    finally { setUit(null) }
  }

  return (
    <div className="space-y-6 animate-fade-in pb-24 lg:pb-0">
      <Link href="/portal/events" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"><ArrowLeft className="h-4 w-4" />Alle workshops & events</Link>

      <div className="relative rounded-3xl overflow-hidden">
        <div className="aspect-[16/10] sm:aspect-[21/9]"><Omslag e={e} /></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8 text-white space-y-2">
          <span className="inline-block rounded-full bg-white text-gray-900 text-xs font-semibold px-2.5 py-1">{soortLabel(e)}</span>
          <h1 className="text-2xl sm:text-4xl font-bold leading-tight text-white">{e.titel}</h1>
          {e.samenvatting && <p className="text-sm sm:text-base text-white/80 max-w-2xl">{e.samenvatting}</p>}
        </div>
      </div>

      {geannuleerd && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3 text-sm text-red-800">
          <Ban className="h-5 w-5 shrink-0" /><span>Dit event is geannuleerd. Was je ingeschreven, dan kreeg je een bericht in je agenda. Er komt geen factuur.</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px] items-start">
        <div className="space-y-6 min-w-0">
          {!geannuleerd && !begonnen && <AftelBlokken start={e.start_op} einde={e.einde_op} />}
          {!geannuleerd && bezig && <AftelBlokken start={e.start_op} einde={e.einde_op} />}

          {teamIngeschreven && !geannuleerd && (
            <section className="rounded-2xl border border-green-200 bg-green-50 p-4 sm:p-5 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-green-900"><Check className="h-5 w-5" />{ikIngeschreven ? 'Je bent ingeschreven' : 'Iemand van jullie team is ingeschreven'}</div>
              <ul className="space-y-1.5">
                {e.mijn.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate"><b className="font-medium">{m.naam}</b> <span className="text-green-800/70">· {m.email}</span></span>
                    {magInschrijven && !begonnen && (
                      <button type="button" onClick={() => schrijfUit(m.id, m.naam)} disabled={uit === m.id} className="shrink-0 inline-flex items-center gap-1 text-xs text-green-900/70 hover:text-red-700">
                        {uit === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}Uitschrijven
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                {e.meet_url && (
                  <a href={e.meet_url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${binnenkort || bezig ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-white text-gray-900 border border-green-200 hover:bg-green-100'}`}>
                    <Video className="h-4 w-4" />{bezig ? 'Nu deelnemen' : 'Deelnemen via Google Meet'}
                  </a>
                )}
                <a href={`/api/portal/events/${e.id}/ics`} className="inline-flex items-center gap-2 rounded-xl bg-white border border-green-200 px-4 py-2.5 text-sm font-medium hover:bg-green-100"><CalendarPlus className="h-4 w-4" />Zet in je agenda</a>
                <a href={googleAgendaLink(e, appLink)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white border border-green-200 px-4 py-2.5 text-sm font-medium hover:bg-green-100">Google Agenda</a>
              </div>
              <p className="text-xs text-green-900/70">De bevestiging staat in je mailbox. De dag voordien krijg je een herinnering{heeftMeet(e) ? ' met de Meet-link' : ''}.</p>
            </section>
          )}

          {e.beschrijving && (
            <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
              <NieuwsInhoud blokken={[{ id: 'beschrijving', type: 'tekst', tekst: e.beschrijving }]} />
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-6 space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <Info icoon={CalendarDays} label="Wanneer">{hoofdletter(wanneerTekst(e))}</Info>
            <Info icoon={e.vorm === 'online' ? Monitor : MapPin} label="Waar">
              {e.vorm === 'online' ? 'Online via Google Meet' : <>{e.locatie}{e.met_meet && <span className="block text-xs text-gray-500">Ook online te volgen via Google Meet</span>}</>}
              {e.vorm === 'locatie' && e.locatie && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.locatie)}`} target="_blank" rel="noreferrer" className="block text-xs underline text-gray-500 mt-0.5">Route</a>}
            </Info>
            {e.spreker && <Info icoon={Mic} label="Door">{e.spreker}</Info>}
            <Info icoon={Users} label="Plaatsen">
              {e.capaciteit != null ? (
                <>
                  <span>{vrij === 0 ? 'Volzet' : `Nog ${vrij} van de ${e.capaciteit}`}</span>
                  <span className="mt-1.5 block h-1.5 rounded-full bg-gray-100 overflow-hidden"><span className="block h-full bg-gray-900" style={{ width: `${Math.min(100, (e.bezet / e.capaciteit) * 100)}%` }} /></span>
                </>
              ) : 'Geen maximum'}
            </Info>
            {e.inschrijven_tot && <Info icoon={Clock} label="Inschrijven tot">{new Date(e.inschrijven_tot).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })}</Info>}
            <div className="flex items-baseline justify-between border-t border-gray-100 pt-4">
              <span className="text-sm text-gray-500">Prijs</span>
              <span className="text-lg font-bold">{prijsTekst(e.prijs_cents)}</span>
            </div>
            {e.prijs_cents > 0 && <p className="text-xs text-gray-500 -mt-2">Je betaalt niets in de app. Na je inschrijving krijg je een Peppol-factuur.</p>}
            <div className="hidden lg:block">
              <Knop e={e} open={open} ikIngeschreven={ikIngeschreven} magInschrijven={magInschrijven} onKies={setDialoog} />
            </div>
          </div>
        </aside>
      </div>

      {/* Gsm: de knop altijd onderaan in beeld */}
      {!geannuleerd && (open.open || !ikIngeschreven) && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate">{prijsTekst(e.prijs_cents)}</div>
              <div className="text-xs text-gray-500 truncate">{uurKort(e.start_op)} · {vrij != null ? (vrij === 0 ? 'volzet' : `nog ${vrij} plaatsen`) : 'plaatsen genoeg'}</div>
            </div>
            <div className="shrink-0"><Knop e={e} open={open} ikIngeschreven={ikIngeschreven} magInschrijven={magInschrijven} onKies={setDialoog} compact /></div>
          </div>
        </div>
      )}

      {dialoog && <InschrijfDialoog e={e} ik={ik} zelf={dialoog === 'zelf' && !ikIngeschreven} onSluit={() => setDialoog(null)} onKlaar={() => router.refresh()} />}
    </div>
  )
}

function Info({ icoon: Icoon, label, children }: { icoon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="h-9 w-9 shrink-0 rounded-xl bg-gray-100 flex items-center justify-center"><Icoon className="h-4 w-4 text-gray-600" /></span>
      <div className="min-w-0 text-sm">
        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</div>
        <div className="text-gray-900">{children}</div>
      </div>
    </div>
  )
}

function Knop({ e, open, ikIngeschreven, magInschrijven, onKies, compact }: {
  e: PortaalEvent; open: ReturnType<typeof inschrijvingOpen>; ikIngeschreven: boolean; magInschrijven: boolean; onKies: (k: 'zelf' | 'collega') => void; compact?: boolean
}) {
  if (e.status === 'geannuleerd') return null
  if (!open.open) return <div className={`rounded-xl bg-gray-100 text-gray-600 text-sm font-medium text-center ${compact ? 'px-4 py-3' : 'px-4 py-3 w-full'}`}>{DICHT_LABEL[open.reden]}</div>
  if (!magInschrijven) return <p className="text-xs text-gray-500">Vraag de beheerder van jullie account om je in te schrijven.</p>
  if (ikIngeschreven) {
    return <button type="button" onClick={() => onKies('collega')} className={`inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white font-semibold text-sm hover:bg-gray-50 ${compact ? 'px-4 py-3' : 'w-full px-4 py-3'}`}><UserPlus className="h-4 w-4" />Collega inschrijven</button>
  }
  return <button type="button" onClick={() => onKies('zelf')} className={`inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 text-white font-semibold text-sm hover:bg-gray-800 ${compact ? 'px-5 py-3' : 'w-full px-4 py-3.5'}`}>Inschrijven</button>
}

// ── Inschrijven ──────────────────────────────────────────────────────────────

function InschrijfDialoog({ e, ik, zelf: zelfStart, onSluit, onKlaar }: { e: PortaalEvent; ik: Ik; zelf: boolean; onSluit: () => void; onKlaar: () => void }) {
  const [zelf, setZelf] = useState(zelfStart)
  const [collegas, setCollegas] = useState<{ naam: string; email: string }[]>(zelfStart ? [] : [{ naam: '', email: '' }])
  const [akkoord, setAkkoord] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [klaar, setKlaar] = useState<number | null>(null)
  const ikAlIngeschreven = e.mijn.some((m) => m.email.toLowerCase() === ik.email.toLowerCase())
  const ingevuld = collegas.filter((c) => c.naam.trim() || c.email.trim())
  const aantal = (zelf ? 1 : 0) + ingevuld.length
  const vrij = e.capaciteit != null ? Math.max(0, e.capaciteit - e.bezet) : null
  const maxExtra = Math.min(MAX_DEELNEMERS_PER_INSCHRIJVING - (zelf ? 1 : 0), vrij != null ? vrij - (zelf ? 1 : 0) : 99)
  const betalend = e.prijs_cents > 0

  useEffect(() => {
    const f = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !bezig) onSluit() }
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f)
  }, [bezig, onSluit])

  const verstuur = async () => {
    setFout(null)
    if (aantal === 0) { setFout('Kies wie er komt.'); return }
    if (betalend && !akkoord) { setFout('Vink het akkoord met de factuur aan.'); return }
    setBezig(true)
    try {
      const r = await fetch(`/api/portal/events/${e.id}/inschrijven`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zelf, collegas: ingevuld, akkoord }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Inschrijven lukte niet')
      setKlaar(j.aantal ?? aantal)
      onKlaar()
    } catch (err) { setFout(err instanceof Error ? err.message : 'Mislukt') }
    finally { setBezig(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={() => !bezig && onSluit()}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-label="Inschrijven">
        {klaar !== null ? (
          <div className="p-6 text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-full bg-green-100 flex items-center justify-center"><Check className="h-7 w-7 text-green-600" /></div>
            <div>
              <h2 className="text-xl font-semibold">Je staat op de lijst</h2>
              <p className="text-sm text-gray-600 mt-1">{klaar === 1 ? 'Er komt zo een bevestiging' : `${klaar} mensen krijgen zo een bevestiging`} per mail{heeftMeet(e) ? ' met de Google Meet-link' : ''} en een agendabestand. De dag voordien volgt een herinnering.</p>
              {betalend && <p className="text-xs text-gray-500 mt-2">De Peppol-factuur van {euro(e.prijs_cents * klaar)} excl. btw volgt achteraf.</p>}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <a href={`/api/portal/events/${e.id}/ics`} className="btn-secondary justify-center"><CalendarPlus className="h-4 w-4" />Zet in je agenda</a>
              <button type="button" onClick={onSluit} className="btn-primary justify-center">Klaar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-3xl sm:rounded-t-2xl">
              <div className="min-w-0">
                <h2 className="font-semibold">Inschrijven</h2>
                <p className="text-sm text-gray-500 truncate">{e.titel} · {new Date(e.start_op).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short' })} {uurKort(e.start_op)}</p>
              </div>
              <button type="button" onClick={onSluit} disabled={bezig} className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-5">
              <div className="space-y-2">
                <div className="text-sm font-medium">Wie komt er?</div>
                {ikAlIngeschreven ? (
                  <p className="text-sm text-gray-500 flex items-center gap-2"><Check className="h-4 w-4 text-green-600" />Jij bent al ingeschreven.</p>
                ) : (
                  <label className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${zelf ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200'}`}>
                    <input type="checkbox" checked={zelf} onChange={(ev) => setZelf(ev.target.checked)} className="h-4 w-4" />
                    <span className="min-w-0"><span className="block text-sm font-medium">Ikzelf{ik.naam ? ` · ${ik.naam}` : ''}</span><span className="block text-xs text-gray-500 truncate">{ik.email}</span></span>
                  </label>
                )}
                {collegas.map((c, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 p-3 space-y-2">
                    <div className="flex items-center justify-between"><span className="text-xs font-medium text-gray-500">Collega {i + 1}</span>
                      <button type="button" onClick={() => setCollegas(collegas.filter((_, j) => j !== i))} className="h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Collega weghalen"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input className="input-base" placeholder="Naam" value={c.naam} onChange={(ev) => setCollegas(collegas.map((x, j) => (j === i ? { ...x, naam: ev.target.value } : x)))} aria-label={`Naam collega ${i + 1}`} autoComplete="off" />
                      <input className="input-base" type="email" inputMode="email" placeholder="E-mailadres" value={c.email} onChange={(ev) => setCollegas(collegas.map((x, j) => (j === i ? { ...x, email: ev.target.value } : x)))} aria-label={`E-mail collega ${i + 1}`} autoComplete="off" />
                    </div>
                  </div>
                ))}
                {collegas.length < maxExtra && (
                  <button type="button" onClick={() => setCollegas([...collegas, { naam: '', email: '' }])} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-black"><Plus className="h-4 w-4" />Collega toevoegen</button>
                )}
                {vrij != null && <p className="text-xs text-gray-500">Nog {vrij} {vrij === 1 ? 'plaats' : 'plaatsen'} vrij.</p>}
              </div>

              {betalend ? (
                <div className="rounded-xl bg-gray-50 p-4 space-y-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{aantal || 1} × {euro(e.prijs_cents)}</span>
                    <span className="text-base font-bold">{euro(e.prijs_cents * Math.max(1, aantal))} <span className="text-xs font-normal text-gray-500">excl. btw</span></span>
                  </div>
                  <label className="flex items-start gap-3 text-sm cursor-pointer">
                    <input type="checkbox" checked={akkoord} onChange={(ev) => setAkkoord(ev.target.checked)} className="h-4 w-4 mt-0.5 shrink-0" />
                    <span className="text-gray-700">{akkoordTekst(e, Math.max(1, aantal))}</span>
                  </label>
                </div>
              ) : (
                <p className="text-sm text-gray-600 flex items-center gap-2"><Check className="h-4 w-4 text-green-600" />Gratis. Je krijgt een bevestiging per mail{heeftMeet(e) ? ' met de Meet-link' : ''}.</p>
              )}

              {fout && <p role="alert" className="text-sm text-red-600">{fout}</p>}
              <button type="button" onClick={verstuur} disabled={bezig || aantal === 0 || (betalend && !akkoord)} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 text-white font-semibold px-4 py-3.5 hover:bg-gray-800 disabled:opacity-40">
                {bezig && <Loader2 className="h-4 w-4 animate-spin" />}{aantal > 1 ? `${aantal} mensen inschrijven` : 'Inschrijven'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
