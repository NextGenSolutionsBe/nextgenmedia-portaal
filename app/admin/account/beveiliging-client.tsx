'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, ShieldAlert, Smartphone, KeyRound, Copy, Download, Check } from 'lucide-react'
import { CodeInvoer } from '@/components/ui/code-invoer'
import { Dialoog, INP } from '@/app/admin/instellingen/ui'

type Status = {
  actief: boolean
  geactiveerdOp: string | null
  herstelcodesOver: number
  beschikbaar: boolean
  verplicht: boolean
  email: string | null
}
type Setup = { qrSvg: string; geheim: string }

const datum = (s: string | null) => (s ? new Date(s).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? 'Er ging iets mis.')
  return j as T
}

/**
 * Beveiliging → Tweestapsverificatie (2FA) met een authenticator-app.
 * Inschakelen: QR scannen → code bevestigen → herstelcodes bewaren.
 * Uitschakelen en nieuwe herstelcodes vragen altijd wachtwoord + code.
 */
export function BeveiligingClient({ verplichtMelding }: { verplichtMelding: boolean }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [code, setCode] = useState('')
  const [bezig, setBezig] = useState(false)
  const [setupFout, setSetupFout] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [dialoog, setDialoog] = useState<'uit' | 'herstel' | null>(null)

  const laad = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/2fa/status', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Laden mislukt')
      setStatus(j as Status); setFout(null)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])

  const start = async () => {
    setBezig(true); setSetupFout(null); setCode('')
    try { setSetup(await post<Setup>('/api/auth/2fa/totp/setup')) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Starten mislukt') }
    finally { setBezig(false) }
  }

  const bevestig = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (bezig || code.length !== 6) return
    setBezig(true); setSetupFout(null)
    try {
      const j = await post<{ herstelcodes: string[] }>('/api/auth/2fa/totp/bevestig', { code })
      setSetup(null); setCodes(j.herstelcodes); setCode('')
      toast.success('Tweestapsverificatie met je app staat aan.')
      laad()
    } catch (e) {
      setSetupFout(e instanceof Error ? e.message : 'De code is ongeldig of verlopen.')
      setCode('')
    } finally { setBezig(false) }
  }

  // Meteen bevestigen zodra de 6 cijfers er staan (ook na plakken).
  useEffect(() => {
    if (setup && code.length === 6 && !bezig && !setupFout) bevestig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  if (fout) return <div className="card-base text-sm text-red-600">{fout}</div>
  if (!status) return <div className="card-base py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>

  return (
    <div className="space-y-4">
      {(verplichtMelding || status.verplicht) && !status.actief && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Tweestapsverificatie met een authenticator-app is verplicht. Koppel hieronder je app; anders vraagt de app het bij je volgende login.</span>
        </div>
      )}

      <div className="card-base">
        <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Beveiliging</div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Smartphone className="h-4 w-4 text-gray-400" />Tweestapsverificatie (2FA)</h2>
            <p className="text-sm text-gray-500 mt-0.5 max-w-xl">
              Met een authenticator-app zoals Google Authenticator, Microsoft Authenticator of 1Password. Bij het inloggen vul je naast je wachtwoord de code uit de app in.
            </p>
          </div>
          <span className={`status-badge ${status.actief ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            Status: {status.actief ? 'Actief' : 'Nog geen app'}
          </span>
        </div>

        {/* ── Niet actief ── */}
        {!status.actief && !setup && !codes && (
          <div className="mt-4 space-y-2">
            {!status.beschikbaar && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Dit is nog niet geconfigureerd op de server. Vraag een beheerder om de sleutel TOTP_ENC_KEY in te stellen.
              </p>
            )}
            <button type="button" onClick={start} disabled={bezig || !status.beschikbaar} className="btn-primary">
              {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}App koppelen
            </button>
          </div>
        )}

        {/* ── Instellen: QR + code ── */}
        {setup && (
          <form onSubmit={bevestig} className="mt-4 border-t border-gray-100 pt-4 space-y-4">
            <p className="text-sm text-gray-700">
              Scan deze QR-code met Google Authenticator, Microsoft Authenticator of een andere authenticator-app.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt="QR-code voor je authenticator-app"
                className="h-48 w-48 shrink-0 rounded-xl border border-gray-200 bg-white p-2 self-center sm:self-auto" />
              <div className="min-w-0 space-y-1.5">
                <div className="text-xs text-gray-500">Of voer deze configuratiesleutel handmatig in:</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="font-mono text-sm sm:text-base tracking-wider bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 break-all">{setup.geheim}</code>
                  <button type="button" className="btn-secondary !px-2.5" aria-label="Sleutel kopiëren"
                    onClick={() => navigator.clipboard.writeText(setup.geheim.replace(/\s/g, '')).then(() => toast.success('Sleutel gekopieerd'))}>
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-[11px] text-gray-400">Accountnaam: {status.email ?? 'je e-mailadres'} · uitgever: NextGen · type: tijdgebaseerd.</p>
              </div>
            </div>
            <div className="max-w-xs">
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">Voer de 6-cijferige code uit je authenticator-app in</label>
              <CodeInvoer waarde={code} onWijzig={(v) => { setCode(v); if (setupFout) setSetupFout(null) }} autoFocus disabled={bezig} />
            </div>
            {setupFout && <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{setupFout}</div>}
            <div className="flex gap-2 flex-wrap">
              <button type="submit" disabled={bezig || code.length !== 6} className="btn-primary">
                {bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bevestigen
              </button>
              <button type="button" onClick={() => { setSetup(null); setCode(''); setSetupFout(null) }} disabled={bezig} className="btn-secondary">Annuleren</button>
            </div>
            <p className="text-[11px] text-gray-400">2FA wordt pas actief nadat deze code klopt. De QR-code is 15 minuten geldig.</p>
          </form>
        )}

        {/* ── Herstelcodes (net aangemaakt) ── */}
        {codes && <Herstelcodes codes={codes} onKlaar={() => setCodes(null)} />}

        {/* ── Actief ── */}
        {status.actief && !codes && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <div className="rounded-xl border border-gray-200 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Actief sinds</div>
                <div className="font-medium">{datum(status.geactiveerdOp)}</div>
              </div>
              <div className={`rounded-xl border px-3 py-2.5 ${status.herstelcodesOver <= 2 ? 'border-amber-200 bg-amber-50' : 'border-gray-200'}`}>
                <div className="text-[11px] text-gray-500">Herstelcodes over</div>
                <div className="font-medium">{status.herstelcodesOver} van 8{status.herstelcodesOver <= 2 && <span className="text-xs text-amber-800 font-normal"> · maak nieuwe aan</span>}</div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn-secondary" onClick={() => setDialoog('herstel')}><KeyRound className="h-4 w-4" />Nieuwe herstelcodes</button>
              <button type="button" className="btn-secondary text-red-600" onClick={() => setDialoog('uit')}>App loskoppelen</button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 space-y-1">
        <div className="font-semibold text-gray-700">Telefoon kwijt of nieuwe telefoon?</div>
        <p>Log in met een herstelcode, kies hier <b>App loskoppelen</b> en koppel daarna je nieuwe telefoon. Ben je ook je herstelcodes kwijt, vraag dan een beheerder om je 2FA te resetten; bij je volgende login koppel je dan een nieuwe app.</p>
      </div>

      {dialoog === 'uit' && <Herbevestig soort="uit" onSluit={() => setDialoog(null)} onKlaar={() => { setDialoog(null); toast.success('App losgekoppeld. Koppel nu een nieuwe app; anders vraagt de app het bij je volgende login.'); laad() }} />}
      {dialoog === 'herstel' && <Herbevestig soort="herstel" onSluit={() => setDialoog(null)} onKlaar={(c) => { setDialoog(null); if (c) setCodes(c); laad() }} />}
    </div>
  )
}

function Herstelcodes({ codes, onKlaar }: { codes: string[]; onKlaar: () => void }) {
  const [bewaard, setBewaard] = useState(false)
  const tekst = `NextGen — herstelcodes voor tweestapsverificatie\nAangemaakt op ${new Date().toLocaleString('nl-BE')}\nElke code werkt één keer.\n\n${codes.join('\n')}\n`
  return (
    <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
      <div className="text-sm text-gray-800 font-medium">Bewaar deze herstelcodes op een veilige plaats. Iedere code kan slechts één keer worden gebruikt.</div>
      <p className="text-xs text-gray-500">Je ziet ze maar één keer. Gebruik een code als je je telefoon niet bij de hand hebt.</p>
      <ul className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
        {codes.map((c) => <li key={c} className="font-mono text-sm tracking-wider bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-center">{c}</li>)}
      </ul>
      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn-secondary" onClick={() => navigator.clipboard.writeText(tekst).then(() => toast.success('Gekopieerd'))}><Copy className="h-4 w-4" />Kopiëren</button>
        <button type="button" className="btn-secondary" onClick={() => {
          const url = URL.createObjectURL(new Blob([tekst], { type: 'text/plain' }))
          const a = document.createElement('a'); a.href = url; a.download = 'nextgen-herstelcodes.txt'; a.click(); URL.revokeObjectURL(url)
        }}><Download className="h-4 w-4" />Downloaden</button>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={bewaard} onChange={(e) => setBewaard(e.target.checked)} className="h-4 w-4" />
        Ik heb mijn herstelcodes veilig bewaard
      </label>
      <button type="button" className="btn-primary" disabled={!bewaard} onClick={onKlaar}><Check className="h-4 w-4" />Klaar</button>
    </div>
  )
}

/** Wachtwoord + tweede factor opnieuw vragen voor uitschakelen of nieuwe herstelcodes. */
function Herbevestig({ soort, onSluit, onKlaar }: { soort: 'uit' | 'herstel'; onSluit: () => void; onKlaar: (codes?: string[]) => void }) {
  const [wachtwoord, setWachtwoord] = useState('')
  const [code, setCode] = useState('')
  const [herstel, setHerstel] = useState(false)
  const [herstelcode, setHerstelcode] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  const verstuur = async (e: React.FormEvent) => {
    e.preventDefault()
    setBezig(true); setFout(null)
    try {
      if (soort === 'uit') {
        await post('/api/auth/2fa/totp/uitschakelen', herstel ? { wachtwoord, herstelcode } : { wachtwoord, code })
        onKlaar()
      } else {
        const j = await post<{ herstelcodes: string[] }>('/api/auth/2fa/herstelcodes', { wachtwoord, code })
        onKlaar(j.herstelcodes)
      }
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Het wachtwoord of de code is ongeldig.')
      setCode(''); setHerstelcode('')
    } finally { setBezig(false) }
  }

  const klaar = wachtwoord.length > 0 && (herstel ? herstelcode.replace(/[\s-]/g, '').length >= 12 : code.length === 6)
  return (
    <Dialoog titel={soort === 'uit' ? 'App loskoppelen' : 'Nieuwe herstelcodes'} onSluit={onSluit}>
      <form onSubmit={verstuur} className="space-y-4">
        <p className="text-sm text-gray-600">
          {soort === 'uit'
            ? 'Bevestig met je huidige wachtwoord en een code uit je app (of een herstelcode). Je app en herstelcodes worden verwijderd; koppel daarna meteen je nieuwe app. Andere ingelogde toestellen worden afgemeld.'
            : 'Bevestig met je huidige wachtwoord en een code uit je app. Al je vorige herstelcodes werken daarna niet meer. Andere ingelogde toestellen worden afgemeld.'}
        </p>
        <div>
          <label htmlFor="ww" className="block text-xs font-medium text-gray-600 mb-1">Huidig wachtwoord</label>
          <input id="ww" type="password" autoComplete="current-password" autoFocus className={INP} value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} />
        </div>
        {herstel ? (
          <div>
            <label htmlFor="hc" className="block text-xs font-medium text-gray-600 mb-1">Herstelcode</label>
            <input id="hc" autoComplete="off" autoCapitalize="characters" spellCheck={false} className={`${INP} font-mono tracking-widest text-center`}
              value={herstelcode} onChange={(e) => setHerstelcode(e.target.value.toUpperCase().slice(0, 16))} placeholder="XXXX-XXXX-XXXX" />
          </div>
        ) : (
          <div>
            <label htmlFor="code2" className="block text-xs font-medium text-gray-600 mb-1">Code uit je authenticator-app</label>
            <CodeInvoer id="code2" waarde={code} onWijzig={setCode} disabled={bezig} />
          </div>
        )}
        {soort === 'uit' && (
          <button type="button" className="text-xs text-gray-500 hover:text-black" onClick={() => { setHerstel((h) => !h); setCode(''); setHerstelcode('') }}>
            {herstel ? 'Code uit de app gebruiken' : 'Telefoon kwijt? Gebruik een herstelcode'}
          </button>
        )}
        {fout && <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fout}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onSluit} disabled={bezig} className="btn-secondary">Annuleren</button>
          <button type="submit" disabled={bezig || !klaar} className={soort === 'uit' ? 'btn-danger' : 'btn-primary'}>
            {bezig && <Loader2 className="h-4 w-4 animate-spin" />}{soort === 'uit' ? 'App loskoppelen' : 'Nieuwe codes maken'}
          </button>
        </div>
      </form>
    </Dialoog>
  )
}
