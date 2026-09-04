'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, Building2, Mail, ShieldCheck, Clock, Archive, RotateCcw, KeyRound, Copy, Check } from 'lucide-react'

type Bedrijf = { id: string; naam: string; is_eigen: boolean; email: string | null; actief: boolean }
type Lid = {
  id: string; bedrijf_id: string; email: string; naam: string | null
  actief: boolean; uitgenodigd_op: string | null
  /** 'klaar' = kan inloggen · 'wacht' = account bestaat maar is nooit gebruikt · 'geen' = nog geen account. */
  toestand: 'klaar' | 'wacht' | 'geen'
  kan_inloggen: boolean
  laatste_login: string | null
}

/**
 * Een sterk wachtwoord, in de BROWSER gemaakt.
 *
 * Bewust hier en niet op de server: zo staat het nergens in een log en gaat het
 * enkel over de lijn wanneer jij op opslaan klikt. Vier woorden-achtige blokken
 * zijn makkelijk door te bellen ("kx7m — streepje — ..."), en dat is precies wat
 * er met dit wachtwoord gebeurt.
 */
function maakWachtwoord(): string {
  // Zonder i/l/1/O/0: die haal je door de telefoon altijd door elkaar.
  const alfabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint32Array(16)
  crypto.getRandomValues(bytes)
  const tekens = [...bytes].map((n) => alfabet[n % alfabet.length])
  return [0, 4, 8, 12].map((i) => tekens.slice(i, i + 4).join('')).join('-')
}

/**
 * Beheer van de bedrijven in het Kantoor en wie er namens hen mag inloggen.
 *
 * Wachtwoorden komen hier bewust NIET voor. Je nodigt iemand uit op zijn
 * e-mailadres; hij kiest zelf een wachtwoord. Zo kent niemand bij ons ooit het
 * wachtwoord van een partner.
 */
export function PartnerBeheer() {
  const [bedrijven, setBedrijven] = useState<Bedrijf[]>([])
  const [leden, setLeden] = useState<Lid[]>([])
  const [laden, setLaden] = useState(true)
  const [nieuwBedrijf, setNieuwBedrijf] = useState('')
  const [eigenBedrijf, setEigenBedrijf] = useState(false)
  const [uitnodigenVoor, setUitnodigenVoor] = useState('')
  const [uitnodigEmail, setUitnodigEmail] = useState('')
  const [uitnodigNaam, setUitnodigNaam] = useState('')
  const [wachtwoord, setWachtwoord] = useState('')
  const [stuurMail, setStuurMail] = useState(false)
  const [bezig, setBezig] = useState(false)
  // Wat je net instelde, één keer zichtbaar met een kopieerknop. Daarna weg —
  // we bewaren het nergens, dus dit is je enige kans om het door te geven.
  const [gezet, setGezet] = useState<{ email: string; wachtwoord: string } | null>(null)
  const [gekopieerd, setGekopieerd] = useState(false)

  const laad = useCallback(async () => {
    setLaden(true)
    try {
      const res = await fetch('/api/kantoor/bedrijven')
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setBedrijven(j.bedrijven ?? [])
      setLeden(j.leden ?? [])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const voegBedrijfToe = async () => {
    if (!nieuwBedrijf.trim()) { toast.error('Geef een naam op'); return }
    setBezig(true)
    try {
      const res = await fetch('/api/kantoor/bedrijven', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actie: 'bedrijf', naam: nieuwBedrijf.trim(), is_eigen: eigenBedrijf }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Bedrijf toegevoegd.')
      setNieuwBedrijf(''); setEigenBedrijf(false); laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }

  const nodigUit = async () => {
    if (!uitnodigenVoor) { toast.error('Kies een bedrijf'); return }
    if (!uitnodigEmail.trim()) { toast.error('Vul een e-mailadres in'); return }
    setBezig(true)
    try {
      const res = await fetch('/api/kantoor/bedrijven', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actie: 'uitnodigen',
          bedrijf_id: uitnodigenVoor,
          email: uitnodigEmail.trim(),
          naam: uitnodigNaam.trim() || undefined,
          wachtwoord: wachtwoord || undefined,
          stuurMail,
        }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)

      if (j.wachtwoordGezet) {
        // Eén keer tonen: hierna staat dit nergens meer. Bewust géén mail met
        // het wachtwoord erin — dat geef je zelf door.
        setGezet({ email: uitnodigEmail.trim(), wachtwoord })
        toast.success('Toegang staat klaar. Geef het wachtwoord door.')
      } else if (j.bestaandAccount) {
        toast.success('Gekoppeld. Deze persoon logt in met zijn bestaande wachtwoord.')
      } else {
        toast.success('Toegang staat klaar.')
      }
      if (j.mailStatus && j.mailStatus !== 'verstuurd') {
        toast.warning(`De mail ging niet uit — ${j.mailStatus}`, { duration: 12000 })
      }

      setUitnodigEmail(''); setUitnodigNaam(''); setWachtwoord(''); setGekopieerd(false)
      laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }

  /** Wachtwoord (opnieuw) instellen voor een bestaand lid. */
  const zetWachtwoord = async (l: Lid) => {
    const nieuw = maakWachtwoord()
    const waarschuwing = l.kan_inloggen
      ? `

LET OP: dit account wordt al gebruikt. Het oude wachtwoord werkt hierna niet meer.`
      : ''
    if (!confirm(`Nieuw wachtwoord instellen voor ${l.email}?${waarschuwing}

Je krijgt het daarna één keer te zien om door te geven.`)) return
    try {
      const res = await fetch('/api/kantoor/bedrijven', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actie: 'wachtwoord', lid_id: l.id, wachtwoord: nieuw, bevestigd: true }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setGezet({ email: l.email, wachtwoord: nieuw })
      setGekopieerd(false)
      toast.success('Wachtwoord ingesteld.')
      laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Instellen mislukt') }
  }

  const kopieer = async (tekst: string) => {
    try {
      await navigator.clipboard.writeText(tekst)
      setGekopieerd(true)
    } catch { toast.error('Kopiëren lukte niet — selecteer het handmatig.') }
  }

  const verwijderBedrijf = async (b: Bedrijf) => {
    if (!confirm(`"${b.naam}" verwijderen?

Dit kan alleen als er nog geen opdrachten aan hangen. Uitnodigingen voor dit bedrijf verdwijnen mee; de accounts zelf blijven bestaan.`)) return
    try {
      const res = await fetch(`/api/kantoor/bedrijven?bedrijf=${b.id}`, { method: 'DELETE' })
      const j = await res.json()
      if (!res.ok) {
        // Er hangen opdrachten aan: verwijderen zou de cijfers veranderen.
        // Meteen de juiste uitweg aanbieden in plaats van enkel te weigeren.
        if (j.kanArchiveren && confirm(`${j.error}

Wil je "${b.naam}" nu op non-actief zetten? Dan verdwijnt het uit alle keuzelijsten, maar blijven de cijfers kloppen.`)) {
          await zetActief(b, false)
          return
        }
        throw new Error(j.error)
      }
      toast.success(`"${b.naam}" verwijderd.`)
      laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }

  const zetActief = async (b: Bedrijf, actief: boolean) => {
    try {
      const res = await fetch('/api/kantoor/bedrijven', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bedrijf_id: b.id, actief }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(actief ? `"${b.naam}" staat weer actief.` : `"${b.naam}" op non-actief gezet.`)
      laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bijwerken mislukt') }
  }

  const trekIn = async (l: Lid) => {
    if (!confirm(`Toegang van ${l.email} intrekken?\n\nHet account zelf blijft bestaan — enkel de koppeling met dit bedrijf gaat weg.`)) return
    try {
      const res = await fetch(`/api/kantoor/bedrijven?lid=${l.id}`, { method: 'DELETE' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Toegang ingetrokken.')
      laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Intrekken mislukt') }
  }

  if (laden) return <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>

  return (
    <div className="space-y-4 border-t border-gray-200 pt-8">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Building2 className="h-5 w-5" />Bedrijven en toegang
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Wie mag er meekijken en meewerken in het Kantoor.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-base p-4 space-y-2">
          <h3 className="text-sm font-semibold">Bedrijf toevoegen</h3>
          <input className="input-base" value={nieuwBedrijf} onChange={(e) => setNieuwBedrijf(e.target.value)}
            placeholder="Naam van het bedrijf" maxLength={120} />
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 rounded border-gray-300 accent-[#fff848]"
              checked={eigenBedrijf} onChange={(e) => setEigenBedrijf(e.target.checked)} />
            Dit is een eigen bedrijf van ons
          </label>
          <p className="text-[11px] text-gray-500">
            Eigen bedrijven tellen mee in jullie omzet en kosten; partners niet.
          </p>
          <button onClick={voegBedrijfToe} disabled={bezig} className="btn-secondary text-sm w-full">
            <Plus className="h-4 w-4" />Toevoegen
          </button>
        </div>

        <div className="card-base p-4 space-y-2">
          <h3 className="text-sm font-semibold">Partner toegang geven</h3>
          <select className="input-base" value={uitnodigenVoor} onChange={(e) => setUitnodigenVoor(e.target.value)}>
            <option value="">Voor welk bedrijf?</option>
            {/* Non-actieve bedrijven horen hier niet: daar mag niemand meer bij. */}
            {bedrijven.filter((b) => b.actief).map((b) => <option key={b.id} value={b.id}>{b.naam}</option>)}
          </select>
          <input className="input-base" type="email" value={uitnodigEmail}
            onChange={(e) => setUitnodigEmail(e.target.value)} placeholder="naam@bedrijf.be" />
          <input className="input-base" value={uitnodigNaam} maxLength={120}
            onChange={(e) => setUitnodigNaam(e.target.value)} placeholder="Naam (optioneel)" />

          {/* JIJ kiest het wachtwoord. De oude weg -- een uitnodigingsmail
              waarmee de partner er zelf een koos -- strandde te vaak: het
              account werd wel aangemaakt, de mail kwam niet aan, en in dit
              scherm stond hij dan als "toegevoegd" terwijl hij nergens in kon. */}
          <div className="flex gap-2">
            <input className="input-base font-mono text-sm" value={wachtwoord}
              onChange={(e) => setWachtwoord(e.target.value)} placeholder="Wachtwoord (min. 10 tekens)" />
            <button type="button" onClick={() => setWachtwoord(maakWachtwoord())}
              className="btn-secondary text-xs shrink-0" title="Sterk wachtwoord maken">
              <KeyRound className="h-3.5 w-3.5" />Maak er een
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 rounded border-gray-300 accent-[#fff848]"
              checked={stuurMail} onChange={(e) => setStuurMail(e.target.checked)} />
            Stuur hem een mailtje met de link
          </label>
          <p className="text-[11px] text-gray-500">
            Het wachtwoord staat <b>niet</b> in die mail &mdash; dat geef je zelf door.
            Bestaat het adres al als account, dan koppelen we het gewoon en blijft
            zijn eigen wachtwoord staan.
          </p>

          <button onClick={nodigUit} disabled={bezig} className="btn-secondary text-sm w-full">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Toegang geven
          </button>

          {/* Een keer zichtbaar. Daarna staat dit nergens meer -- ook niet bij ons. */}
          {gezet && (
            <div className="rounded-xl border border-[#fff848] bg-[#fff848]/15 p-3 space-y-1.5">
              <div className="text-[11px] uppercase tracking-wide text-gray-600">Geef dit door aan {gezet.email}</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm bg-white border border-gray-200 rounded-lg px-2 py-1.5 select-all break-all">
                  {gezet.wachtwoord}
                </code>
                <button type="button" onClick={() => kopieer(gezet.wachtwoord)}
                  className="btn-secondary text-xs shrink-0">
                  {gekopieerd ? <><Check className="h-3.5 w-3.5" />Gekopieerd</> : <><Copy className="h-3.5 w-3.5" />Kopieer</>}
                </button>
              </div>
              <p className="text-[11px] text-gray-600">
                Je ziet dit maar een keer. Sluit je dit venster, dan kun je enkel een nieuw wachtwoord instellen.
              </p>
              <button type="button" onClick={() => setGezet(null)} className="text-[11px] underline text-gray-500">
                Klaar, verberg dit
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {bedrijven.map((b) => {
          const eigen = leden.filter((l) => l.bedrijf_id === b.id)
          return (
            <div key={b.id} className="card-base p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className={`font-medium text-sm ${b.actief ? '' : 'text-gray-400'}`}>{b.naam}</span>
                {b.is_eigen && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#fff848] border border-yellow-400 text-gray-900">
                    eigen bedrijf
                  </span>
                )}
                {!b.actief && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-500">
                    non-actief
                  </span>
                )}
                <span className="text-xs text-gray-400 ml-auto">
                  {eigen.length} {eigen.length === 1 ? 'persoon' : 'personen'}
                </span>
                {b.actief ? (
                  <button onClick={() => zetActief(b, false)}
                    className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                    title="Op non-actief zetten — verdwijnt uit de keuzelijsten, cijfers blijven">
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button onClick={() => zetActief(b, true)}
                    className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-green-50 text-gray-400 hover:text-green-700"
                    title="Weer actief maken">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
                <button onClick={() => verwijderBedrijf(b)}
                  className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"
                  title="Bedrijf verwijderen">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {eigen.length === 0 ? (
                <p className="text-xs text-gray-400">Nog niemand uitgenodigd.</p>
              ) : (
                <div className="space-y-1">
                  {eigen.map((l) => (
                    <div key={l.id} className="flex items-center gap-2 text-xs">
                      {/* De toestand komt van het ECHTE account, niet van het
                          bestaan van een rij: een uitnodiging maakte vroeger al
                          een account aan waar niemand mee kon inloggen. */}
                      {l.toestand === 'klaar'
                        ? <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-label="Kan inloggen" />
                        : <Clock className="h-3.5 w-3.5 text-amber-500" aria-label="Kan nog niet inloggen" />}
                      <span className="text-gray-700">{l.email}</span>
                      {l.toestand === 'klaar' && (
                        <span className="text-gray-400">
                          {l.laatste_login
                            ? 'laatst ingelogd ' + new Date(l.laatste_login).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })
                            : 'kan inloggen'}
                        </span>
                      )}
                      {l.toestand === 'wacht' && <span className="text-amber-600">nog nooit ingelogd &mdash; geef een wachtwoord</span>}
                      {l.toestand === 'geen' && <span className="text-amber-600">nog geen account</span>}
                      <button onClick={() => zetWachtwoord(l)}
                        className="ml-auto h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                        title="Wachtwoord instellen">
                        <KeyRound className="h-3 w-3" />
                      </button>
                      <button onClick={() => trekIn(l)}
                        className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                        title="Toegang intrekken">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
