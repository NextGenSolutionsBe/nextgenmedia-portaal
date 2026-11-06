'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Hourglass, Loader2, X, Check, Mail } from 'lucide-react'
import { MailDialog } from '@/components/admin/mail-composer'
import { TERMIJN_KEUZES, deadlineNaDagen, geldigeTermijn, maandLabel, maandenTekst, type Tellingen } from '@/lib/content/deadline-model'

type Voorbereiding = {
  vandaag: string
  maanden: { maand: string; tellingen: Tellingen }[]
  klant: { naam: string; voornaam: string; email: string } | null
  deadlines: { id: string; maanden: string[]; deadline: string; status: string }[]
}

const langeDatum = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })

/**
 * "Goedkeuring aanvragen" — in de editworkflow van een klant: tegen wanneer moet
 * de klant de content goedkeuren (3, 5, 7 of n dagen; de datum wordt berekend),
 * eventueel de concepten meteen naar de klant sturen, en kiezen of de mail
 * meteen vertrekt. De mail gaat altijd via de gewone mailcomponent: met
 * voorbeeld en een eigen klik op "Verstuur", gekoppeld aan deze termijn.
 */
export function GoedkeuringAanvragen({ clientId, clients, onKlaar, className = 'btn-primary text-sm' }: {
  clientId: string
  /** Optioneel: een andere klant kiezen dan de klant waarin je werkt. */
  clients?: { id: string; company_name: string }[]
  onKlaar?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [mail, setMail] = useState<{ clientId: string; deadlineId: string } | null>(null)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}><Hourglass className="h-4 w-4" />Goedkeuring aanvragen</button>
      {open && (
        <Instellen
          startKlant={clientId} clients={clients}
          onSluit={() => setOpen(false)}
          onIngesteld={(r) => { setOpen(false); if (r.mail) setMail({ clientId: r.clientId, deadlineId: r.id }); else onKlaar?.() }}
        />
      )}
      {mail && (
        <MailDialog
          context={{ type: 'client', clientId: mail.clientId, kind: 'goedkeuring_aanvraag', deadlineId: mail.deadlineId }}
          onSent={(r) => toast.success(r.al_verstuurd ? 'Deze mail was al verstuurd.' : 'Mail verstuurd. De termijn staat bij de klant in het portaal.')}
          onClose={() => { setMail(null); onKlaar?.() }}
        />
      )}
    </>
  )
}

function Instellen({ startKlant, clients, onSluit, onIngesteld }: {
  startKlant: string
  clients?: { id: string; company_name: string }[]
  onSluit: () => void
  onIngesteld: (r: { id: string; clientId: string; mail: boolean }) => void
}) {
  const [klant, setKlant] = useState(startKlant)
  const [data, setData] = useState<Voorbereiding | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [maanden, setMaanden] = useState<string[]>([])
  const [dagen, setDagen] = useState<number>(5)
  const [ander, setAnder] = useState('')
  const [naarKlant, setNaarKlant] = useState(true)
  const [metMail, setMetMail] = useState(true)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    let weg = false
    setData(null); setFout(null)
    fetch(`/api/admin/social-content/deadlines?client_id=${klant}&open=1&voorbereiding=1`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j as Voorbereiding })
      .then((j) => {
        if (weg) return
        setData(j)
        // Vooraf aangeduid: de maanden (vanaf deze maand) waar iets klaarstaat of nog in concept staat.
        const huidig = j.vandaag.slice(0, 7)
        const met = j.maanden.filter((m) => m.maand >= huidig && (m.tellingen.bij_klant > 0 || m.tellingen.concept > 0)).map((m) => m.maand)
        setMaanden(met.slice(0, 3))
        setMetMail(!!j.klant?.email)
      })
      .catch((e) => { if (!weg) setFout(e instanceof Error ? e.message : 'Laden mislukt') })
    return () => { weg = true }
  }, [klant])

  const termijn = ander.trim() ? geldigeTermijn(ander) : dagen
  const deadline = data && termijn ? deadlineNaDagen(data.vandaag, termijn) : null
  const gekozen = useMemo(() => (data?.maanden ?? []).filter((m) => maanden.includes(m.maand)), [data, maanden])
  const klaar = gekozen.reduce((s, m) => s + m.tellingen.bij_klant, 0)
  const concepten = gekozen.reduce((s, m) => s + m.tellingen.concept, 0)
  const aanpassing = gekozen.reduce((s, m) => s + m.tellingen.feedback, 0)
  const lopend = (data?.deadlines ?? []).find((d) => d.status === 'open' && [...d.maanden].sort().join(',') === [...maanden].sort().join(','))
  const wachtend = klaar + (naarKlant ? concepten : 0)
  const geenMail = !data?.klant?.email

  const bewaar = async () => {
    if (!termijn || !maanden.length) return
    setBezig(true)
    try {
      const r = await fetch('/api/admin/social-content/deadlines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: klant, maanden, termijn_dagen: termijn, concepten_naar_klant: naarKlant && concepten > 0 }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(`${j.bijgewerkt ? 'Termijn bijgewerkt' : 'Termijn ingesteld'}: goedkeuren tegen ${langeDatum(j.deadline)}${j.naar_klant ? ` · ${j.naar_klant} concept(en) naar de klant` : ''}.`)
      onIngesteld({ id: j.id, clientId: klant, mail: metMail && !geenMail })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40" role="dialog" aria-modal="true" aria-label="Goedkeuring aanvragen">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><Hourglass className="h-4 w-4 text-amber-600" />Goedkeuring aanvragen</h3>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {clients && clients.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Klant</label>
              <select className="input-base" value={klant} onChange={(e) => setKlant(e.target.value)}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
          )}

          {fout ? <p className="text-sm text-red-600">{fout}</p> : !data ? <div className="py-6 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : (
            <>
              <div>
                <div className="text-xs font-medium text-gray-600 mb-1">Welke content? <span className="text-gray-400 font-normal">(maand van de geplande publicatie)</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {data.maanden.map(({ maand, tellingen }) => {
                    const aan = maanden.includes(maand)
                    const iets = tellingen.bij_klant + tellingen.concept
                    return (
                      <button key={maand} type="button" aria-pressed={aan} onClick={() => setMaanden((l) => (aan ? l.filter((x) => x !== maand) : [...l, maand]))}
                        className={`px-2.5 py-1.5 rounded-lg text-xs border text-left ${aan ? 'bg-black text-white border-black' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
                        <span className="font-medium">{aan && <Check className="h-3 w-3 inline mr-0.5 -mt-0.5" />}{maandLabel(maand)}</span>
                        <span className={`block text-[10px] ${aan ? 'text-white/70' : 'text-gray-400'}`}>{iets ? `${tellingen.bij_klant} klaar · ${tellingen.concept} concept` : 'niets gepland'}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-600 mb-1">Hoeveel dagen krijgt de klant?</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {TERMIJN_KEUZES.map((n) => {
                    const aan = !ander.trim() && dagen === n
                    return <button key={n} type="button" aria-pressed={aan} onClick={() => { setDagen(n); setAnder('') }} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${aan ? 'bg-black text-white border-black' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>{n} dagen</button>
                  })}
                  <label className="flex items-center gap-1.5 text-sm text-gray-600 ml-1">ander:
                    <input type="number" min={1} max={60} inputMode="numeric" className="input-base w-20 py-1.5" value={ander} onChange={(e) => setAnder(e.target.value)} placeholder="…" aria-label="Ander aantal dagen" />
                  </label>
                </div>
                <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${deadline ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-700'}`}>
                  {deadline ? <>Uiterlijk goedgekeurd op <b>{langeDatum(deadline)}</b>. Die dag telt nog volledig mee.</> : 'Kies een termijn van 1 tot 60 dagen.'}
                </div>
                {lopend && deadline && lopend.deadline !== deadline && (
                  <p className="text-[11px] text-gray-500 mt-1">Voor {maandenTekst(lopend.maanden)} loopt al een termijn tot {langeDatum(lopend.deadline)}. Die wordt bijgewerkt naar de nieuwe datum.</p>
                )}
              </div>

              {gekozen.length > 0 && (
                <div className="space-y-1.5 text-sm">
                  {concepten > 0 && (
                    <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" className="mt-0.5" checked={naarKlant} onChange={(e) => setNaarKlant(e.target.checked)} />
                      <span>{concepten} concept{concepten === 1 ? '' : 'en'} meteen naar de klant sturen <span className="text-gray-400">(status “Feedback gevraagd”)</span></span>
                    </label>
                  )}
                  {aanpassing > 0 && <p className="text-[11px] text-gray-500">{aanpassing} item{aanpassing === 1 ? '' : 's'} met een gevraagde aanpassing {aanpassing === 1 ? 'blijft' : 'blijven'} bij jullie staan.</p>}
                  {wachtend === 0 && <p className="text-[11px] text-amber-700">In deze maand(en) staat nog niets klaar voor de klant. De aftelklok verschijnt pas zodra er iets op goedkeuring wacht.</p>}
                  {wachtend > 0 && <p className="text-[11px] text-gray-500">{wachtend} item{wachtend === 1 ? '' : 's'} {wachtend === 1 ? 'wacht' : 'wachten'} straks op goedkeuring. De klant ziet de aftelling in het portaal.</p>}
                </div>
              )}

              <div className="rounded-lg border border-gray-200 p-3 space-y-1">
                <label className={`flex items-start gap-2 text-sm ${geenMail ? 'opacity-60' : 'cursor-pointer'}`}>
                  <input type="checkbox" className="mt-0.5" checked={metMail && !geenMail} disabled={geenMail} onChange={(e) => setMetMail(e.target.checked)} />
                  <span><Mail className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />Mail meteen versturen{data.klant?.voornaam ? ` naar ${data.klant.voornaam}` : ''}{data.klant?.email ? <span className="text-gray-400"> ({data.klant.email})</span> : null}</span>
                </label>
                <p className="text-[11px] text-gray-500 pl-6">{geenMail ? 'Deze klant heeft geen e-mailadres. Vul het in bij de klantgegevens om te kunnen mailen.' : 'Je ziet de mail eerst als voorbeeld en verstuurt hem zelf. Zonder vinkje kan je later mailen via “Herinnering”.'}</p>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button>
          <button type="button" onClick={bewaar} disabled={bezig || !data || !termijn || !maanden.length} className="btn-primary text-sm">
            {bezig && <Loader2 className="h-4 w-4 animate-spin" />}{metMail && !geenMail ? 'Termijn instellen en mail bekijken' : 'Termijn instellen'}
          </button>
        </div>
      </div>
    </div>
  )
}
