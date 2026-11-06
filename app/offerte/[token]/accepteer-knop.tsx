'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'

/** "Offerte accepteren": één knop, dan je naam bevestigen. */
export function AccepteerKnop({ token, naamVoorstel, klant, accent, opAccent }: { token: string; naamVoorstel: string; klant: string | null; accent: string; opAccent: string }) {
  const [open, setOpen] = useState(false)
  const [naam, setNaam] = useState(naamVoorstel)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [klaar, setKlaar] = useState<string | null>(null)

  const doe = async () => {
    if (naam.trim().length < 2) { setFout('Vul je naam in.'); return }
    setBezig(true); setFout(null)
    try {
      const r = await fetch(`/api/offerte/${encodeURIComponent(token)}/accepteer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Er ging iets mis.')
      setKlaar(j.geaccepteerd_door || naam)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Er ging iets mis.') } finally { setBezig(false) }
  }

  if (klaar) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-green-900">
        <p className="font-semibold flex items-center gap-2"><CheckCircle2 className="h-5 w-5" />Bedankt, de offerte is geaccepteerd.</p>
        <p className="text-sm mt-1">We nemen snel contact op voor de volgende stap.</p>
      </div>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-semibold shadow-sm hover:opacity-90 transition"
        style={{ background: accent, color: opAccent }}>
        <CheckCircle2 className="h-5 w-5" />Offerte accepteren
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
      <p className="text-sm text-gray-700">Je aanvaardt deze offerte{klant ? ` namens ${klant}` : ''}. Vul je naam in en bevestig.</p>
      <input className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base" value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Voornaam en naam" autoFocus maxLength={120}
        onKeyDown={(e) => { if (e.key === 'Enter') void doe() }} />
      {fout && <p className="text-sm text-red-700">{fout}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={doe} disabled={bezig} className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold disabled:opacity-60" style={{ background: accent, color: opAccent }}>
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Ja, ik accepteer
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={bezig} className="rounded-xl px-4 py-3 border border-gray-200 text-gray-700">Annuleren</button>
      </div>
    </div>
  )
}
