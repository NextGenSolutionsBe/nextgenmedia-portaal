'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, PenLine } from 'lucide-react'
import { HandtekeningVak } from '@/components/admin/handtekening-vak'
import { VOORWAARDEN_URL, PRIVACY_PAD } from '@/lib/voorwaarden'
import { OFFERTE_AKKOORD_VOORWAARDEN, OFFERTE_AKKOORD_PRIVACY } from '@/lib/offertes'

/**
 * "Offerte accepteren": naam, twee verplichte vinkjes (algemene voorwaarden en
 * privacyverklaring, met een linkje om ze te lezen) en wie wil, tekent ook.
 * De handtekening komt met datum en uur op de pdf.
 */
export function AccepteerKnop({ token, naamVoorstel, klant, accent, opAccent }: { token: string; naamVoorstel: string; klant: string | null; accent: string; opAccent: string }) {
  const [open, setOpen] = useState(false)
  const [naam, setNaam] = useState(naamVoorstel)
  const [voorwaarden, setVoorwaarden] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [tekenen, setTekenen] = useState(false)
  const [png, setPng] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [klaar, setKlaar] = useState<{ naam: string; getekend: boolean } | null>(null)

  const doe = async () => {
    if (naam.trim().length < 2) { setFout('Vul je naam in.'); return }
    if (!voorwaarden || !privacy) { setFout('Vink aan dat je akkoord gaat met de algemene voorwaarden en de privacyverklaring.'); return }
    if (tekenen && !png) { setFout('Teken je handtekening, of kies om zonder handtekening te aanvaarden.'); return }
    setBezig(true); setFout(null)
    try {
      const r = await fetch(`/api/offerte/${encodeURIComponent(token)}/accepteer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naam, akkoord_voorwaarden: voorwaarden, akkoord_privacy: privacy, handtekening: tekenen ? png : null }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Er ging iets mis.')
      setKlaar({ naam: j.geaccepteerd_door || naam, getekend: tekenen && !!png })
    } catch (e) { setFout(e instanceof Error ? e.message : 'Er ging iets mis.') } finally { setBezig(false) }
  }

  if (klaar) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-green-900 w-full">
        <p className="font-semibold flex items-center gap-2"><CheckCircle2 className="h-5 w-5" />Bedankt, de offerte is aanvaard.</p>
        <p className="text-sm mt-1">{klaar.getekend ? 'Je handtekening staat met datum en uur op de pdf. ' : ''}We nemen snel contact op voor de volgende stap.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-3 text-sm underline">Pdf met je akkoord bekijken</button>
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-semibold shadow-sm hover:opacity-90 transition"
        style={{ background: accent, color: opAccent }}>
        <CheckCircle2 className="h-5 w-5" />Offerte aanvaarden
      </button>
    )
  }

  const vink = (aan: boolean, zet: (v: boolean) => void, tekst: string, link: string, linkTekst: string) => (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={aan} onChange={(e) => zet(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 accent-gray-900" />
      <span className="text-sm text-gray-800">
        {tekst}
        <a href={link} target="_blank" rel="noreferrer" className="block mt-0.5 text-[11px] text-gray-400 underline underline-offset-2 hover:text-gray-700">{linkTekst}</a>
      </span>
    </label>
  )

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 w-full">
      <p className="text-sm text-gray-700">Je aanvaardt deze offerte{klant ? ` namens ${klant}` : ''}.</p>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="akkoord-naam">Voornaam en naam</label>
        <input id="akkoord-naam" className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base" value={naam} onChange={(e) => setNaam(e.target.value)} autoComplete="name" autoFocus maxLength={120} />
      </div>
      <div className="space-y-3">
        {vink(voorwaarden, setVoorwaarden, OFFERTE_AKKOORD_VOORWAARDEN, VOORWAARDEN_URL, 'Lees nu de algemene voorwaarden')}
        {vink(privacy, setPrivacy, OFFERTE_AKKOORD_PRIVACY, PRIVACY_PAD, 'Lees nu de privacyverklaring')}
      </div>
      <div className="rounded-xl border border-gray-200 p-3 space-y-2">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={tekenen} onChange={(e) => { setTekenen(e.target.checked); if (!e.target.checked) setPng(null) }} className="h-5 w-5 rounded border-gray-300 accent-gray-900" />
          <span className="text-sm text-gray-800 flex items-center gap-1.5"><PenLine className="h-4 w-4" />Ik zet ook mijn handtekening <span className="text-gray-400">(niet verplicht)</span></span>
        </label>
        {tekenen && (
          <div className="space-y-1">
            <HandtekeningVak onChange={setPng} hoogte={150} />
            <p className="text-[11px] text-gray-500">Je handtekening komt met de datum en het uur op de offerte.</p>
          </div>
        )}
      </div>
      {fout && <p className="text-sm text-red-700" role="alert">{fout}</p>}
      <div className="flex flex-col sm:flex-row gap-2">
        <button type="button" onClick={doe} disabled={bezig} className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold disabled:opacity-60" style={{ background: accent, color: opAccent }}>
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Ja, ik aanvaard de offerte
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={bezig} className="rounded-xl px-4 py-3 border border-gray-200 text-gray-700">Annuleren</button>
      </div>
    </div>
  )
}
