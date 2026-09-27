'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ShieldCheck, RotateCw, Smartphone, KeyRound } from 'lucide-react'
import { Logo } from '@/components/logo'
import { CodeInvoer } from '@/components/ui/code-invoer'

/** Alleen doorsturen binnen deze app: een meegegeven ?redirect= mag nooit naar
 *  een externe site wijzen (open-redirect). */
function safeRedirect(target: string): string {
  return target.startsWith('/') && !target.startsWith('//') ? target : '/admin'
}

type Methode = 'laden' | 'mail' | 'totp'

function VerifyForm() {
  const router = useRouter()
  const params = useSearchParams()
  const redirect = params.get('redirect') || '/admin'
  const supabase = createClient()

  const [methode, setMethode] = useState<Methode>('laden')
  const [herstel, setHerstel] = useState(false)          // herstelcode i.p.v. app-code
  const [code, setCode] = useState('')
  const [herstelcode, setHerstelcode] = useState('')
  const [sending, setSending] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [nogOver, setNogOver] = useState<number | null>(null)   // na een herstelcode
  const sentOnce = useRef(false)

  const send = useCallback(async () => {
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/auth/2fa/send', { method: 'POST' })
      // Niet ingelogd → terug naar stap 1.
      if (res.status === 401) { router.replace('/login'); return }
      const j = await res.json()
      // 403 = deze stap geldt niet voor dit account. NIET stil doorsturen: dat
      // maakte een verkeerd ingesteld werknemersaccount onzichtbaar. Toon het.
      if (res.status === 403) {
        setMethode('mail')
        setError('Voor dit account is de extra verificatie niet ingesteld. Neem contact op met NextGenMedia.')
        return
      }
      // Authenticator-app actief: geen mail, de app is de tweede factor.
      if (res.ok && j.methode === 'totp') { setMethode('totp'); return }
      setMethode('mail')
      // 429 = er is net al een code verstuurd. De vorige code is nog geldig.
      if (res.status === 429) { setInfo('Je code is al onderweg. Kijk in je mailbox.'); setCooldown(60); return }
      if (!res.ok) throw new Error(j.error ?? 'Code versturen mislukt')
      setInfo(`We stuurden een code naar ${j.sentTo}.`)
      setCooldown(60)
    } catch (e) {
      setMethode('mail')
      setError(e instanceof Error ? e.message : 'Code versturen mislukt')
    } finally { setSending(false) }
  }, [router])

  // Eén keer bij het openen: kijken welke tweede factor dit account heeft (en
  // bij de mailcode meteen een code sturen). Kwamen we hier terug ná een
  // geslaagde verificatie, dan werd de sessie niet herkend — dat melden we.
  useEffect(() => {
    if (sentOnce.current) return
    sentOnce.current = true
    if (sessionStorage.getItem('ngm_2fa_done') === '1') {
      sessionStorage.removeItem('ngm_2fa_done')
      setSending(false); setMethode('mail')
      setError('De verificatie lukte, maar je sessie werd daarna niet herkend. Log opnieuw in; blijft dit gebeuren, sta dan cookies toe voor deze site.')
      return
    }
    send()
  }, [send])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const verder = () => {
    try { sessionStorage.setItem('ngm_2fa_done', '1') } catch { /* private mode */ }
    // HARDE navigatie: zo beoordeelt de middleware de sessie opnieuw vanaf nul.
    window.location.replace(safeRedirect(redirect))
  }

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (verifying) return
    setVerifying(true); setError(null)
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(herstel ? { herstelcode } : { code }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'De code is ongeldig of verlopen.')
      if (j.methode === 'herstelcode') { setNogOver(j.herstelcodesOver ?? 0); setVerifying(false); return }
      verder()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'De code is ongeldig of verlopen.')
      setCode(''); setHerstelcode('')
      setVerifying(false)   // spinner altijd stoppen, anders lijkt het te hangen
    }
  }

  // App-code: meteen versturen zodra de 6 cijfers er staan (ook na plakken).
  useEffect(() => {
    if (methode === 'totp' && !herstel && code.length === 6 && !verifying && !error) verify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, methode, herstel])

  const cancel = async () => {
    try { await fetch('/api/auth/2fa/logout', { method: 'POST' }) } catch { }
    await supabase.auth.signOut()
    router.replace('/login')
  }

  if (nogOver !== null) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <KeyRound className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Je bent ingelogd met een herstelcode. Die code werkt niet meer. Je hebt er nog <b>{nogOver}</b> over.
            {' '}Maak nieuwe herstelcodes of stel je app opnieuw in via <b>Mijn account → Beveiliging</b>.
          </span>
        </div>
        <button type="button" onClick={verder} className="w-full py-2.5 bg-[#fff848] text-black font-semibold rounded-lg hover:bg-[#f5ee30] text-sm">Verder</button>
      </div>
    )
  }

  if (methode === 'laden') {
    return <div className="py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
  }

  const knopUit = verifying || sending || (herstel ? herstelcode.replace(/[\s-]/g, '').length < 12 : code.length !== 6)

  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="flex items-start gap-2 text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
        {methode === 'totp' ? <Smartphone className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" /> : <ShieldCheck className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" />}
        <span>
          {methode === 'totp'
            ? (herstel ? 'Voer een van je herstelcodes in. Elke code werkt maar één keer.' : 'Open je authenticator-app en voer de 6-cijferige code voor NextGen in.')
            : info ?? 'We sturen je een inlogcode per e-mail.'}
        </span>
      </div>

      {herstel ? (
        <div>
          <label htmlFor="herstelcode" className="block text-sm font-medium text-gray-700 mb-1">Herstelcode</label>
          <input id="herstelcode" autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false}
            value={herstelcode} onChange={(e) => setHerstelcode(e.target.value.toUpperCase().slice(0, 16))}
            className="input-base text-center text-lg tracking-widest font-mono" placeholder="XXXX-XXXX-XXXX" />
        </div>
      ) : (
        <div>
          <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">{methode === 'totp' ? 'Code uit je app' : 'Inlogcode'}</label>
          <CodeInvoer waarde={code} onWijzig={(v) => { setCode(v); if (error) setError(null) }} autoFocus disabled={verifying} />
          {methode === 'mail' && <p className="text-[11px] text-gray-400 mt-1">De code is 10 minuten geldig.</p>}
        </div>
      )}

      {error && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      <button type="submit" disabled={knopUit}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#fff848] text-black font-semibold rounded-lg hover:bg-[#f5ee30] transition-colors disabled:opacity-60 text-sm">
        {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Bevestigen
      </button>

      <div className="flex items-center justify-between gap-2 text-xs">
        {methode === 'mail' ? (
          <button type="button" onClick={send} disabled={sending || cooldown > 0}
            className="text-gray-500 hover:text-black disabled:opacity-50 flex items-center gap-1">
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
            {cooldown > 0 ? `Nieuwe code over ${cooldown}s` : 'Nieuwe code sturen'}
          </button>
        ) : (
          <button type="button" onClick={() => { setHerstel((h) => !h); setError(null); setCode(''); setHerstelcode('') }}
            className="text-gray-500 hover:text-black flex items-center gap-1">
            {herstel ? <Smartphone className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
            {herstel ? 'Code uit de app gebruiken' : 'Telefoon niet bij de hand? Herstelcode'}
          </button>
        )}
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
