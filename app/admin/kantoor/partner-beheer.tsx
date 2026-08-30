'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, Building2, Mail, ShieldCheck, Clock } from 'lucide-react'

type Bedrijf = { id: string; naam: string; is_eigen: boolean; email: string | null; actief: boolean }
type Lid = {
  id: string; bedrijf_id: string; email: string; naam: string | null
  actief: boolean; actief_account: boolean; uitgenodigd_op: string | null
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
  const [bezig, setBezig] = useState(false)

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
        body: JSON.stringify({ actie: 'uitnodigen', bedrijf_id: uitnodigenVoor, email: uitnodigEmail.trim() }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      if (j.mailStatus && j.mailStatus !== 'verstuurd') {
        toast.warning(`Toegang staat klaar, maar de mail ging niet uit — ${j.mailStatus}`, { duration: 12000 })
      } else {
        toast.success('Uitgenodigd. Hij kiest zelf een wachtwoord.')
      }
      setUitnodigEmail(''); laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Uitnodigen mislukt') } finally { setBezig(false) }
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
          <h3 className="text-sm font-semibold">Iemand uitnodigen</h3>
          <select className="input-base" value={uitnodigenVoor} onChange={(e) => setUitnodigenVoor(e.target.value)}>
            <option value="">Voor welk bedrijf?</option>
            {bedrijven.map((b) => <option key={b.id} value={b.id}>{b.naam}</option>)}
          </select>
          <input className="input-base" type="email" value={uitnodigEmail}
            onChange={(e) => setUitnodigEmail(e.target.value)} placeholder="naam@bedrijf.be" />
          <p className="text-[11px] text-gray-500">
            Hij krijgt een uitnodiging en kiest <b>zelf</b> een wachtwoord. Wij zien dat nooit.
          </p>
          <button onClick={nodigUit} disabled={bezig} className="btn-secondary text-sm w-full">
            <Mail className="h-4 w-4" />Uitnodiging sturen
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {bedrijven.map((b) => {
          const eigen = leden.filter((l) => l.bedrijf_id === b.id)
          return (
            <div key={b.id} className="card-base p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-sm">{b.naam}</span>
                {b.is_eigen && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#fff848] border border-yellow-400 text-gray-900">
                    eigen bedrijf
                  </span>
                )}
                <span className="text-xs text-gray-400 ml-auto">
                  {eigen.length} {eigen.length === 1 ? 'persoon' : 'personen'}
                </span>
              </div>
              {eigen.length === 0 ? (
                <p className="text-xs text-gray-400">Nog niemand uitgenodigd.</p>
              ) : (
                <div className="space-y-1">
                  {eigen.map((l) => (
                    <div key={l.id} className="flex items-center gap-2 text-xs">
                      {l.actief_account
                        ? <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-label="Account actief" />
                        : <Clock className="h-3.5 w-3.5 text-amber-500" aria-label="Uitnodiging verstuurd" />}
                      <span className="text-gray-700">{l.email}</span>
                      {!l.actief_account && <span className="text-amber-600">wacht op activatie</span>}
                      <button onClick={() => trekIn(l)}
                        className="ml-auto h-6 w-6 flex items-center justify-center rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
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
