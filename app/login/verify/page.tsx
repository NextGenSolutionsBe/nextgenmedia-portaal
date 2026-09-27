'use client'

import { useCallback, useEffect, useRef, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Smartphone, KeyRound, Copy, Download, Check } from 'lucide-react'
import { Logo } from '@/components/logo'
import { CodeInvoer } from '@/components/ui/code-invoer'

/** Alleen doorsturen binnen deze app: een meegegeven ?redirect= mag nooit naar
 *  een externe site wijzen (open-redirect). */
function safeRedirect(target: string): string {
  return target.startsWith('/') && !target.startsWith('//') ? target : '/admin'
}

type Stap = 'laden' | 'code' | 'koppelen' | 'fout'

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? 'De code is ongeldig of verlopen.')
  return j as T
}

/**
 * Tweede stap van het inloggen — enkel met een authenticator-app.
 *  · app gekoppeld  → code uit de app (of een herstelcode)
 *  · nog geen app   → eerst een app koppelen (QR + code), herstelcodes bewaren
 * De server markeert pas daarna deze sessie; niets hier kan dat omzeilen.
 */
function VerifyForm() {
  const router = useRouter()
  const params = useSearchParams()
  const redirect = params.get('redirect') || '/admin'
  const supabase = createClient()

  const [stap, setStap] = useState<Stap>('laden')
  const [email, setEmail] = useState<string | null>(null)
  const [herstel, setHerstel] = useState(false)
  const [code, setCode] = useState('')
  const [herstelcode, setHerstelcode] = useState('')
  const [bezig, setBezig] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nogOver, setNogOver] = useState<number | null>(null)
  const [qr, setQr] = useState<{ qrSvg: string; geheim: string } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [bewaard, setBewaard] = useState(false)
  const [gekopieerd, setGekopieerd] = useState(false)
  const eenKeer = useRef(false)

  const verder = useCallback(() => {
    try { sessionStorage.setItem('ngm_2fa_done', '1') } catch { /* private mode */ }
    // HARDE navigatie: zo beoordeelt de middleware de sessie opnieuw vanaf nul.
    window.location.replace(safeRedirect(redirect))
  }, [redirect])

  const startKoppelen = useCallback(async () => {
    setBezig(true); setError(null)
    try { setQr(await post<{ qrSvg: string; geheim: string }>('/api/auth/2fa/totp/setup')) }
    catch (e) { setError(e instanceof Error ? e.message : 'Starten mislukt') }
    finally { setBezig(false) }
  }, [])

  // Eén keer bij het openen: welke stap heeft dit account nodig?
  useEffect(() => {
    if (eenKeer.current) return
    eenKeer.current = true
    if (sessionStorage.getItem('ngm_2fa_done') === '1') {
      sessionStorage.removeItem('ngm_2fa_done')
      setStap('fout')
      setError('De verificatie lukte, maar je sessie werd daarna niet herkend. Log opnieuw in; blijft dit gebeuren, sta dan cookies toe voor deze site.')
      return
    }
    ;(async () => {
      try {
        const r = await fetch('/api/auth/2fa/stap', { cache: 'no-store' })
        if (r.status === 401) { router.replace('/login'); return }
        const j = await r.json().catch(() => ({}))
        if (r.status === 403) { setStap('fout'); setError('Voor dit account is de extra verificatie niet van toepassing. Neem contact op met NextGenMedia.'); return }
        if (!r.ok) throw new Error(j.error ?? 'Laden mislukt')
        setEmail(j.email ?? null)
        setStap(j.stap === 'koppelen' ? 'koppelen' : 'code')
        if (j.stap === 'koppelen') startKoppelen()
      } catch (e) { setStap('fout'); setError(e instanceof Error ? e.message : 'Laden mislukt') }
    })()
  }, [router, startKoppelen])

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (bezig) return
    setBezig(true); setError(null)
    try {
      const j = await post<{ methode: string; herstelcodesOver?: number }>('/api/auth/2fa/verify', herstel ? { herstelcode } : { code })
      if (j.methode === 'herstelcode') { setNogOver(j.herstelcodesOver ?? 0); setBezig(false); return }
      verder()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'De code is ongeldig of verlopen.')
      setCode(''); setHerstelcode('')
      setBezig(false)
    }
  }

  const bevestigKoppeling = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (bezig || code.length !== 6) return
    setBezig(true); setError(null)
    try {
      const j = await post<{ herstelcodes: string[] }>('/api/auth/2fa/totp/bevestig', { code })
      setCodes(j.herstelcodes)
    } catch (e) { setError(e instanceof Error ? e.message : 'De code is ongeldig of verlopen.'); setCode('') }
    finally { setBezig(false) }
  }

  // Meteen versturen zodra de 6 cijfers er staan (ook na plakken).
  useEffect(() => {
    if (code.length !== 6 || bezig || error) return
    if (stap === 'code' && !herstel) verify()
    if (stap === 'koppelen' && qr && !codes) bevestigKoppeling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const cancel = async () => {
    try { await fetch('/api/auth/2fa/logout', { method: 'POST' }) } catch { }
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const foutBlok = error && <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
  const annuleren = <button type="button" onClick={cancel} className="text-xs text-gray-400 hover:text-gray-700">Annuleren</button>

  if (stap === 'laden') return <div className="py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
  if (stap === 'fout') return <div className="space-y-4">{foutBlok}<div className="text-right">{annuleren}</div></div>

  // Na een herstelcode: melden hoeveel er nog over zijn.
  if (nogOver !== null) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <KeyRound className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Je bent ingelogd met een herstelcode. Die code werkt niet meer; je hebt er nog <b>{nogOver}</b> over. Maak nieuwe herstelcodes of koppel je app opnieuw via <b>Mijn account → Beveiliging</b>.</span>
        </div>
        <button type="button" onClick={verder} className="w-full py-2.5 bg-[#fff848] text-black font-semibold rounded-lg hover:bg-[#f5ee30] text-sm">Verder</button>
      </div>
    )
  }

  // Koppelen, laatste stap: herstelcodes bewaren.
  if (stap === 'koppelen' && codes) {
    const tekst = `NextGen — herstelcodes voor tweestapsverificatie${email ? ` (${email})` : ''}\nElke code werkt één keer.\n\n${codes.join('\n')}\n`
    return (
      <div className="space-y-3">
        <div className="text-sm font-medium text-gray-900">Je app is gekoppeld.</div>
        <p className="text-sm text-gray-600">Bewaar deze herstelcodes op een veilige plaats. Iedere code kan slechts één keer worden gebruikt.</p>
        <ul className="grid grid-cols-2 gap-1.5">
          {codes.map((c) => <li key={c} className="font-mono text-xs sm:text-sm tracking-wider bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-center">{c}</li>)}
        </ul>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1 justify-center" onClick={() => navigator.clipboard.writeText(tekst).then(() => setGekopieerd(true))}>{gekopieerd ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{gekopieerd ? 'Gekopieerd' : 'Kopiëren'}</button>
          <button type="button" className="btn-secondary flex-1 justify-center" onClick={() => {
            const url = URL.createObjectURL(new Blob([tekst], { type: 'text/plain' }))
            const a = document.createElement('a'); a.href = url; a.download = 'nextgen-herstelcodes.txt'; a.click(); URL.revokeObjectURL(url)
          }}><Download className="h-4 w-4" />Downloaden</button>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" className="h-4 w-4" checked={bewaard} onChange={(e) => setBewaard(e.target.checked)} />Ik heb mijn herstelcodes veilig bewaard</label>
        <button type="button" disabled={!bewaard} onClick={verder} className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#fff848] text-black font-semibold rounded-lg hover:bg-[#f5ee30] disabled:opacity-60 text-sm"><Check className="h-4 w-4" />Verder</button>
      </div>
    )
  }

  // Koppelen: QR scannen + code.
  if (stap === 'koppelen') {
    return (
      <form onSubmit={bevestigKoppeling} className="space-y-4">
        <div className="flex items-start gap-2 text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
          <Smartphone className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" />
          <span>Voor dit account is een authenticator-app verplicht. Scan deze QR-code met Google Authenticator, Microsoft Authenticator of een andere authenticator-app.</span>
        </div>
        {qr ? (
          <div className="space-y-2 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.qrSvg)}`} alt="QR-code voor je authenticator-app" className="h-44 w-44 mx-auto rounded-xl border border-gray-200 bg-white p-2" />
            <div className="text-[11px] text-gray-500">Of voer deze configuratiesleutel handmatig in:</div>
            <code className="block font-mono text-sm tracking-wider bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 break-all">{qr.geheim}</code>
          </div>
        ) : (
          <div className="py-6 text-center">
            {bezig ? <Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" /> : <button type="button" onClick={startKoppelen} className="btn-secondary">QR-code opnieuw laden</button>}
          </div>
        )}
        <div>
          <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">Voer de 6-cijferige code uit je authenticator-app in</label>
          <CodeInvoer waarde={code} onWijzig={(v) => { setCode(v); if (error) setError(null) }} disabled={bezig || !qr} />
        </div>
        {foutBlok}
        <button type="submit" disabled={bezig || code.length !== 6 || !qr}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#fff848] text-black font-semibold rounded-lg hover:bg-[#f5ee30] transition-colors disabled:opacity-60 text-sm">
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Bevestigen
        </button>
        <div className="flex items-center justify-between text-xs">
          <button type="button" onClick={() => { setCode(''); startKoppelen() }} disabled={bezig} className="text-gray-500 hover:text-black">Nieuwe QR-code</button>
          {annuleren}
        </div>
      </form>
    )
  }

  // App gekoppeld: code of herstelcode.
  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="flex items-start gap-2 text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
        {herstel ? <KeyRound className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" /> : <Smartphone className="h-4 w-4 mt-0.5 text-gray-400 shrink-0" />}
        <span>{herstel ? 'Voer een van je herstelcodes in. Elke code werkt maar één keer.' : 'Open je authenticator-app en voer de 6-cijferige code voor NextGen in.'}</span>
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
          <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">Code uit je app</label>
          <CodeInvoer waarde={code} onWijzig={(v) => { setCode(v); if (error) setError(null) }} autoFocus disabled={bezig} />
        </div>
      )}
      {foutBlok}
      <button type="submit" disabled={bezig || (herstel ? herstelcode.replace(/[\s-]/g, '').length < 12 : code.length !== 6)}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#fff848] text-black font-semibold rounded-lg hover:bg-[#f5ee30] transition-colors disabled:opacity-60 text-sm">
        {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Bevestigen
      </button>
      <div className="flex items-center justify-between gap-2 text-xs">
        <button type="button" onClick={() => { setHerstel((h) => !h); setError(null); setCode(''); setHerstelcode('') }} className="text-gray-500 hover:text-black flex items-center gap-1">
          {herstel ? <Smartphone className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
          {herstel ? 'Code uit de app gebruiken' : 'Telefoon niet bij de hand? Herstelcode'}
        </button>
        {annuleren}
      </div>
      {!herstel && <p className="text-[11px] text-gray-400">Telefoon én herstelcodes kwijt? Vraag een beheerder om je 2FA te resetten.</p>}
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
          <p className="text-sm text-gray-500 mt-1">Tweestapsverificatie met je authenticator-app</p>
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
