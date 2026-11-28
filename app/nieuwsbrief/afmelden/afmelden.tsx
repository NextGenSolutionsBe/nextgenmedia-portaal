'use client'

import { useState } from 'react'
import { CircleCheck, Loader2 } from 'lucide-react'

export function Afmelden({ email, token }: { email: string; token: string }) {
  const [stand, setStand] = useState<'vraag' | 'bezig' | 'klaar'>('vraag')
  const [fout, setFout] = useState<string | null>(null)
  const meldAf = async () => {
    setStand('bezig'); setFout(null)
    try {
      const r = await fetch('/api/nieuwsbrief/afmelden', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e: email, t: token }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Afmelden mislukt')
      setStand('klaar')
    } catch (e) { setFout(e instanceof Error ? e.message : 'Afmelden mislukt'); setStand('vraag') }
  }
  if (stand === 'klaar') return (
    <>
      <h1 className="text-xl font-semibold flex items-center gap-2"><CircleCheck className="h-5 w-5 text-green-600" />Je bent afgemeld</h1>
      <p className="text-sm text-gray-600">{email} krijgt geen nieuwsbrief meer per mail. In je klantapp kan je het nieuws nog altijd lezen.</p>
    </>
  )
  return (
    <>
      <h1 className="text-xl font-semibold">Afmelden voor de nieuwsbrief?</h1>
      <p className="text-sm text-gray-600">We sturen geen nieuwsbrief meer naar <b>{email}</b>. Andere mails over je projecten blijven gewoon komen.</p>
      {fout && <p className="text-sm text-red-700" role="alert">{fout}</p>}
      <button type="button" onClick={meldAf} disabled={stand === 'bezig'} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 text-white font-semibold py-3">{stand === 'bezig' && <Loader2 className="h-4 w-4 animate-spin" />}Afmelden</button>
    </>
  )
}
