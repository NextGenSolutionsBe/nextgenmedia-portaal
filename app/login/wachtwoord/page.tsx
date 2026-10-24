'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, KeyRound, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/logo'

/**
 * Wachtwoord kiezen na een uitnodiging (Instellingen → Medewerkers →
 * "Uitnodiging versturen"). De link bevat een eenmalige token_hash; die wordt
 * hier ingewisseld voor een sessie, waarna de medewerker een wachtwoord zet.
 * Daarna loggen we die sessie weer uit: inloggen gebeurt langs de gewone weg
 * (met code), zodat de beveiliging voor iedereen gelijk blijft.
 */
export default function WachtwoordPage() {
  const [stap, setStap] = useState<'controle' | 'formulier' | 'klaar' | 'fout'>('controle')
  const [fout, setFout] = useState<string | null>(null)
  const [w1, setW1] = useState(''); const [w2, setW2] = useState('')
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const tokenHash = sp.get('token_hash')
    if (!tokenHash) { setFout('Deze link is onvolledig. Vraag een nieuwe uitnodiging aan een beheerder.'); setStap('fout'); return }
    const supabase = createClient()
    supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
      .then(({ error }) => {
        if (error) { setFout('Deze link is ongeldig of verlopen. Vraag een nieuwe uitnodiging aan een beheerder.'); setStap('fout') }
        else setStap('formulier')
      })
      .catch(() => { setFout('De link kon niet gecontroleerd worden. Probeer het later opnieuw.'); setStap('fout') })
  }, [])

  const bewaar = async (e: React.FormEvent) => {
    e.preventDefault(); setFout(null)
    if (w1.length < 8) { setFout('Kies een wachtwoord van minstens 8 tekens.'); return }
    if (w1 !== w2) { setFout('De twee wachtwoorden zijn niet gelijk.'); return }
    setBezig(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: w1 })
      if (error) throw new Error(error.message)
      await supabase.auth.signOut().catch(() => {})
      setStap('klaar')
    } catch (err) { setFout(err instanceof Error ? err.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex justify-center mb-6"><Logo /></div>
        {stap === 'controle' && <div className="text-center text-gray-400 py-6"><Loader2 className="h-5 w-5 animate-spin mx-auto" /><p className="text-sm mt-2">Link controleren…</p></div>}
        {stap === 'fout' && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{fout}</p>
            <Link href="/login" className="text-sm underline text-gray-600">Naar het inlogscherm</Link>
          </div>
        )}
        {stap === 'formulier' && (
          <form onSubmit={bewaar} className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2"><KeyRound className="h-5 w-5" />Kies je wachtwoord</h1>
              <p className="text-sm text-gray-500 mt-1">Minstens 8 tekens. Daarna log je in met je e-mailadres en dit wachtwoord.</p>
            </div>
            <input type="password" autoComplete="new-password" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg" placeholder="Nieuw wachtwoord" value={w1} onChange={(e) => setW1(e.target.value)} />
            <input type="password" autoComplete="new-password" className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg" placeholder="Herhaal het wachtwoord" value={w2} onChange={(e) => setW2(e.target.value)} />
            {fout && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{fout}</p>}
            <button type="submit" disabled={bezig} className="btn-primary w-full justify-center">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Wachtwoord opslaan</button>
          </form>
        )}
        {stap === 'klaar' && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto" />
            <p className="text-sm text-gray-700">Je wachtwoord is ingesteld. Je kunt nu inloggen.</p>
            <Link href="/login" className="btn-primary w-full justify-center">Naar inloggen</Link>
          </div>
        )}
      </div>
    </div>
  )
}
