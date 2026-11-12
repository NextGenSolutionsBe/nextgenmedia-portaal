'use client'

import { useEffect, useState } from 'react'
import { Loader2, KeyRound, ShieldCheck, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/logo'
import { controleerNieuwWachtwoord } from '@/lib/klant-account'

/**
 * Welkom in de klantapp: de klant kiest zelf een wachtwoord en kan meteen
 * tweestapsverificatie aanzetten (QR-code scannen met een authenticator-app).
 */
export function Welkom({ token }: { token: string }) {
  const [stap, setStap] = useState<'controle' | 'wachtwoord' | 'tweestap' | 'fout'>('controle')
  const [email, setEmail] = useState('')
  const [fout, setFout] = useState<string | null>(null)
  const [w1, setW1] = useState(''); const [w2, setW2] = useState('')
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/activeren', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Deze link werkt niet.')
        const supabase = createClient()
        await supabase.auth.signOut().catch(() => {})
        const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: j.token_hash })
        if (error) throw new Error('Deze link werkt niet meer. Laat het ons weten en we sturen een nieuwe.')
        setEmail(j.email); setStap('wachtwoord')
      } catch (e) { setFout(e instanceof Error ? e.message : 'Deze link werkt niet.'); setStap('fout') }
    })()
  }, [token])

  const bewaar = async (e: React.FormEvent) => {
    e.preventDefault(); setFout(null)
    const f = controleerNieuwWachtwoord(w1, email)
    if (f) { setFout(f); return }
    if (w1 !== w2) { setFout('De twee wachtwoorden zijn niet gelijk.'); return }
    setBezig(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: w1 })
      if (error) throw new Error(/should be different|same/i.test(error.message) ? 'Kies een ander wachtwoord.' : error.message)
      await fetch('/api/auth/activeren', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, klaar: true }) }).catch(() => null)
      setStap('tweestap')
    } catch (err) { setFout(err instanceof Error ? err.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex justify-center mb-6"><Logo /></div>

        {stap === 'controle' && <div className="text-center text-gray-400 py-6"><Loader2 className="h-5 w-5 animate-spin mx-auto" /><p className="text-sm mt-2">Je link controleren…</p></div>}

        {stap === 'fout' && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{fout}</p>
            <a href="/login" className="text-sm underline text-gray-600">Naar het inlogscherm</a>
          </div>
        )}

        {stap === 'wachtwoord' && (
          <form onSubmit={bewaar} className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><KeyRound className="h-5 w-5" />Kies je wachtwoord</h1>
              <p className="text-sm text-gray-500 mt-1">Je logt in met <b className="text-gray-800">{email}</b>.</p>
            </div>
            <input type="email" autoComplete="username" value={email} readOnly hidden />
            <label className="block text-xs text-gray-600">Nieuw wachtwoord
              <input type="password" autoComplete="new-password" autoFocus className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base" value={w1} onChange={(e) => setW1(e.target.value)} />
            </label>
            <label className="block text-xs text-gray-600">Nog een keer
              <input type="password" autoComplete="new-password" className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base" value={w2} onChange={(e) => setW2(e.target.value)} />
            </label>
            <p className="text-[11px] text-gray-400">Minstens 10 tekens. Een zin die je makkelijk onthoudt, werkt prima.</p>
            {fout && <p className="text-sm text-red-700" role="alert">{fout}</p>}
            <button type="submit" disabled={bezig} className="btn-primary w-full justify-center">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Wachtwoord bewaren</button>
          </form>
        )}

        {stap === 'tweestap' && (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2"><CheckCircle2 className="h-4 w-4 shrink-0" />Je wachtwoord staat. Je bent ingelogd.</p>
            <div>
              <h2 className="font-semibold text-gray-900 flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Tweestapsverificatie</h2>
              <p className="text-sm text-gray-600 mt-1">Extra veilig: bij het inloggen geef je naast je wachtwoord ook een code uit een app op je gsm, zoals Google Authenticator of Microsoft Authenticator. Je scant één keer een QR-code en klaar.</p>
            </div>
            <a href="/portal/beveiliging?instellen=1" className="btn-primary w-full justify-center"><ShieldCheck className="h-4 w-4" />Nu instellen</a>
            <a href="/portal" className="btn-secondary w-full justify-center">Later, naar de klantapp</a>
          </div>
        )}
      </div>
    </div>
  )
}
