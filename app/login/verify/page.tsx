'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ShieldCheck, RotateCw } from 'lucide-react'
import { Logo } from '@/components/logo'

/** Alleen doorsturen binnen deze app: een meegegeven ?redirect= mag nooit naar
 *  een externe site wijzen (open-redirect). */
function safeRedirect(target: string): string {
  return target.startsWith('/') && !target.startsWith('//') ? target : '/admin'
}

function VerifyForm() {
  const router = useRouter()
  const params = useSearchParams()
  const redirect = params.get('redirect') || '/admin'
  const supabase = createClient()

  const [code, setCode] = useState('')
  const [sending, setSending] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const sentOnce = useRef(false)

  const send = useCallback(async () => {
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/auth/2fa/send', { method: 'POST' })
      // Niet ingelogd → terug naar stap 1. Geen intern account (klant/partner) →
      // deze stap geldt niet voor hen; stuur ze naar hun eigen portaal.
      if (res.status === 401) { router.replace('/login'); return }
      const j = await res.json()
      // 403 = deze stap geldt niet voor dit account. NIET stil doorsturen: dat
      // maakte een verkeerd ingesteld werknemersaccount onzichtbaar (eindeloze
      // lus zonder code én zonder melding). Toon het gewoon.
      if (res.status === 403) {
        setError('Voor dit account is de extra verificatie niet ingesteld. Neem contact op met NextGenMedia.')
        return
      }
      // 429 = er is net al een code verstuurd. Dat is geen fout: de vorige code
      // is nog geldig, dus melden we het rustig i.p.v. met een rode foutmelding.
      if (res.status === 429) { setInfo('Je code is al onderweg. Kijk in je mailbox.'); setCooldown(60); return }
      if (!res.ok) throw new Error(j.error ?? 'Code versturen mislukt')
      setInfo(`We stuurden een code naar ${j.sentTo}.`)
      setCooldown(60)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Code versturen mislukt')
    } finally { setSending(false) }
  }, [router])

  // Eén keer automatisch een code sturen bij het openen van deze pagina.
  // Zijn we hier terechtgekomen ná een geslaagde verificatie? Dan is het cookie
  // niet bewaard (bv. cookies geblokkeerd) — dat melden we, i.p.v. eindeloos
  // opnieuw codes te sturen.
  useEffect(() => {
    if (sentOnce.current) return
    sentOnce.current = true
    if (sessionStorage.getItem('ngm_2fa_done') === '1') {
      sessionStorage.removeItem('ngm_2fa_done')
      setSending(false)
      setError('De verificatie lukte, maar je browser bewaarde de beveiligingscookie niet. Sta cookies toe voor deze site (of schakel een privacy-blokkering uit) en probeer opnieuw.')
      return
    }
    send()
  }, [send])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    setVerifying(true); setError(null)
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Verificatie mislukt')
      // Markeren dat de code klopte: belanden we tóch weer hier, dan weten we
      // dat het cookie niet bewaard is en tonen we dat als uitleg.
      try { sessionStorage.setItem('ngm_2fa_done', '1') } catch { /* private mode */ }
      // HARDE navigatie: een client-side router.replace kan een gecachete
      // RSC-payload serveren waarin het net gezette cookie nog niet meetelt,
      // waardoor de middleware je terugstuurt naar deze pagina (eindeloos laden).
      // Een volledige paginalading stuurt het cookie gegarandeerd mee.
      window.location.replace(safeRedirect(redirect))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verificatie mislukt')
      setCode('')
      setVerifying(false)   // spinner altijd stoppen, anders lijkt het te hangen
    }
  }

  const cancel = async () => {
    // Ook de verificatie-cookie wissen, zodat opnieuw inloggen weer een code vraagt.
    try { await fetch('/api/auth/2fa/logout', { method: 'POST' }) } catch { }
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="flex items-start gap-2 text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
        <ShieldCheck className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" />
        <span>{info ?? 'We sturen je een inlogcode per e-mail.'}</span>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Inlogcode</label>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="input-base text-center text-2xl tracking-[0.4em] font-semibold tabular"
          placeholder="••••••"
        />
        <p className="text-[11px] text-gray-400 mt-1">De code is 10 minuten geldig.</p>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      <button
        type="submit"
        disabled={verifying || sending || code.length !== 6}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#fff848] text-black font-semibold rounded-lg hover:bg-[#f5ee30] transition-colors disabled:opacity-60 text-sm"
      >
        {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Bevestigen
      </button>

      <div className="flex items-center justify-between text-xs">
        <button type="button" onClick={send} disabled={sending || cooldown > 0}
          className="text-gray-500 hover:text-black disabled:opacity-50 flex items-center gap-1">
          {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
          {cooldown > 0 ? `Nieuwe code over ${cooldown}s` : 'Nieuwe code sturen'}
        </button>
        <button type="button" onClick={cancel} className="text-gray-400 hover:text-gray-700">Annuleren</button>
      </div>
    </form>
  )
}

export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Logo className="inline-flex h-14 w-14 rounded-2xl mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">Verificatie</h1>
          <p className="text-sm text-gray-500 mt-1">Extra beveiliging voor interne accounts</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <Suspense fallback={<div className="h-48 animate-pulse bg-gray-100 rounded-lg" />}>
            <VerifyForm />
          </Suspense>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">NextGenMedia © {new Date().getFullYear()}</p>
      </div>
    </div>
  )
}
