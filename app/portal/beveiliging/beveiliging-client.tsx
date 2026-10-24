'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, Smartphone, KeyRound, Copy, Download, Check, RefreshCcw, ShieldOff } from 'lucide-react'
import { CodeInvoer } from '@/components/ui/code-invoer'
import { Dialoog, INP } from '@/app/admin/instellingen/ui'

/**
 * Tweestapsverificatie voor klantaccounts — VRIJWILLIG.
 *  Inschakelen:  wachtwoord → QR + handmatige sleutel → code bevestigen → herstelcodes (één keer)
 *  Actief:       nieuwe herstelcodes · opnieuw instellen (nieuwe telefoon) · uitschakelen
 *                — telkens wachtwoord + code uit de app of een herstelcode
 * De server doet alle controles; deze pagina toont enkel wat de server teruggeeft.
 */

type Status = { actief: boolean; geactiveerdOp: string | null; herstelcodesOver: number; beschikbaar: boolean; email: string | null }
type Setup = { qrSvg: string; geheim: string; opnieuw: boolean }
type Actie = 'aan' | 'uit' | 'herstel' | 'opnieuw'

const datum = (s: string | null) => (s ? new Date(s).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? 'Er ging iets mis.')
  return j as T
}

export function PortaalBeveiliging() {
  const [status, setStatus] = useState<Status | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [dialoog, setDialoog] = useState<Actie | null>(null)

  const laad = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/2fa/status', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Laden mislukt')
      setStatus(j as Status); setFout(null)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])

  if (fout) return <div className="card-base text-sm text-red-600">{fout}</div>
  if (!status) return <div className="card-base py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>

  return (
    <div className="space-y-4">
      <div className="card-base">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Smartphone className="h-4 w-4 text-gray-400" />Tweestapsverificatie</h2>
            <p className="text-sm text-gray-500 mt-0.5 max-w-xl">
              Met een authenticator-app zoals Google Authenticator, Microsoft Authenticator of 1Password. Bij het inloggen geef je naast je wachtwoord ook de code uit de app. Dit is optioneel.
            </p>
          </div>
          <span className={`status-badge ${status.actief ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{status.actief ? 'Ingeschakeld' : 'Uitgeschakeld'}</span>
        </div>

        {!status.actief && !setup && !codes && (
          <div className="mt-4 space-y-2">
            {!status.beschikbaar && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Tweestapsverificatie is tijdelijk niet beschikbaar. Probeer het later opnieuw.</p>}
            <button type="button" onClick={() => setDialoog('aan')} disabled={!status.beschikbaar} className="btn-primary"><ShieldCheck className="h-4 w-4" />Inschakelen</button>
          </div>
        )}

        {setup && (
          <Instellen setup={setup} email={status.email} onAnnuleer={() => setSetup(null)}
            onKlaar={(c) => { setSetup(null); setCodes(c); toast.success(setup.opnieuw ? 'Je nieuwe app is ingesteld.' : 'Tweestapsverificatie staat aan.'); laad() }} />
        )}

        {codes && <Herstelcodes codes={codes} onKlaar={() => setCodes(null)} />}

        {status.actief && !codes && !setup && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <div className="rounded-xl border border-gray-200 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Ingeschakeld sinds</div>
                <div className="font-medium">{datum(status.geactiveerdOp)}</div>
              </div>
              <div className={`rounded-xl border px-3 py-2.5 ${status.herstelcodesOver <= 2 ? 'border-amber-200 bg-amber-50' : 'border-gray-200'}`}>
                <div className="text-[11px] text-gray-500">Herstelcodes over</div>
                <div className="font-medium">{status.herstelcodesOver} van 8{status.herstelcodesOver <= 2 && <span className="text-xs text-amber-800 font-normal"> · maak nieuwe aan</span>}</div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn-secondary" onClick={() => setDialoog('herstel')}><KeyRound className="h-4 w-4" />Nieuwe herstelcodes</button>
              <button type="button" className="btn-secondary" onClick={() => setDialoog('opnieuw')}><RefreshCcw className="h-4 w-4" />Nieuwe telefoon instellen</button>
              <button type="button" className="btn-secondary text-red-600" onClick={() => setDialoog('uit')}><ShieldOff className="h-4 w-4" />Uitschakelen</button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600 space-y-1">
        <div className="font-semibold text-gray-700">Telefoon kwijt of nieuwe telefoon?</div>
        <p>Log in met een van je herstelcodes en kies hier <b>Nieuwe telefoon instellen</b>. Ben je ook je herstelcodes kwijt, neem dan contact op met NextGenMedia: wij kunnen je tweestapsverificatie resetten nadat we je identiteit hebben gecontroleerd. Bij elke wijziging krijg je een e-mail.</p>
      </div>

      {dialoog && (
        <Herbevestig soort={dialoog} onSluit={() => setDialoog(null)}
          onKlaar={(r) => {
            setDialoog(null)
            if (r.setup) setSetup(r.setup)
            if (r.codes) setCodes(r.codes)
            if (dialoog === 'uit') toast.success('Tweestapsverificatie is uitgeschakeld.')
            laad()
          }} />
      )}
    </div>
  )
}

/** QR + handmatige sleutel + code uit de (nieuwe) app → bevestigen. */
function Instellen({ setup, email, onAnnuleer, onKlaar }: { setup: Setup; email: string | null; onAnnuleer: () => void; onKlaar: (codes: string[]) => void }) {
  const [code, setCode] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const bevestig = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (bezig || code.length !== 6) return
    setBezig(true); setFout(null)
    try { onKlaar((await post<{ herstelcodes: string[] }>('/api/auth/2fa/totp/bevestig', { code })).herstelcodes) }
    catch (e) { setFout(e instanceof Error ? e.message : 'De code is ongeldig of verlopen.'); setCode('') }
    finally { setBezig(false) }
  }
  useEffect(() => {
    if (code.length === 6 && !bezig && !fout) bevestig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])
  return (
    <form onSubmit={bevestig} className="mt-4 border-t border-gray-100 pt-4 space-y-4">
      <p className="text-sm text-gray-700">{setup.opnieuw ? 'Scan deze QR-code met de app op je nieuwe telefoon. Je huidige app blijft werken tot je hieronder een code uit de nieuwe app bevestigt.' : 'Scan deze QR-code met je authenticator-app.'}</p>
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt="QR-code voor je authenticator-app" className="h-48 w-48 shrink-0 rounded-xl border border-gray-200 bg-white p-2 self-center sm:self-auto" />
        <div className="min-w-0 space-y-1.5">
          <div className="text-xs text-gray-500">Kan je niet scannen? Voer deze sleutel handmatig in:</div>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-sm sm:text-base tracking-wider bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 break-all">{setup.geheim}</code>
            <button type="button" className="btn-secondary !px-2.5" aria-label="Sleutel kopiëren" onClick={() => navigator.clipboard.writeText(setup.geheim.replace(/\s/g, '')).then(() => toast.success('Sleutel gekopieerd'))}><Copy className="h-4 w-4" /></button>
          </div>
          <p className="text-[11px] text-gray-400">Account: {email ?? 'je e-mailadres'} · uitgever: NextGen · type: tijdgebaseerd. Deze sleutel wordt maar één keer getoond.</p>
        </div>
      </div>
      <div className="max-w-xs">
        <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">Voer de 6-cijferige code uit de app in</label>
        <CodeInvoer waarde={code} onWijzig={(v) => { setCode(v); if (fout) setFout(null) }} autoFocus disabled={bezig} />
      </div>
      {fout && <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fout}</div>}
      <div className="flex gap-2 flex-wrap">
        <button type="submit" disabled={bezig || code.length !== 6} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bevestigen</button>
        <button type="button" onClick={onAnnuleer} disabled={bezig} className="btn-secondary">Annuleren</button>
      </div>
      <p className="text-[11px] text-gray-400">{setup.opnieuw ? 'De nieuwe app' : 'Tweestapsverificatie'} wordt pas actief nadat deze code klopt. De QR-code is 15 minuten geldig.</p>
    </form>
  )
}

function Herstelcodes({ codes, onKlaar }: { codes: string[]; onKlaar: () => void }) {
  const [bewaard, setBewaard] = useState(false)
  const tekst = `NextGenMedia — herstelcodes voor tweestapsverificatie\nAangemaakt op ${new Date().toLocaleString('nl-BE')}\nElke code werkt één keer.\n\n${codes.join('\n')}\n`
  return (
    <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
      <div className="text-sm text-gray-800 font-medium">Bewaar deze herstelcodes op een veilige plaats. Iedere code werkt maar één keer.</div>
      <p className="text-xs text-gray-500">Je ziet ze nu voor het laatst. Gebruik een code als je je telefoon niet bij de hand hebt.</p>
      <ul className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
        {codes.map((c) => <li key={c} className="font-mono text-sm tracking-wider bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-center">{c}</li>)}
      </ul>
      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn-secondary" onClick={() => navigator.clipboard.writeText(tekst).then(() => toast.success('Gekopieerd'))}><Copy className="h-4 w-4" />Kopiëren</button>
        <button type="button" className="btn-secondary" onClick={() => {
          const url = URL.createObjectURL(new Blob([tekst], { type: 'text/plain' }))
          const a = document.createElement('a'); a.href = url; a.download = 'nextgenmedia-herstelcodes.txt'; a.click(); URL.revokeObjectURL(url)
        }}><Download className="h-4 w-4" />Downloaden</button>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={bewaard} onChange={(e) => setBewaard(e.target.checked)} className="h-4 w-4" />Ik heb mijn herstelcodes veilig bewaard</label>
      <button type="button" className="btn-primary" disabled={!bewaard} onClick={onKlaar}><Check className="h-4 w-4" />Klaar</button>
    </div>
  )
}

const TITEL: Record<Actie, string> = { aan: 'Tweestapsverificatie inschakelen', uit: 'Tweestapsverificatie uitschakelen', herstel: 'Nieuwe herstelcodes', opnieuw: 'Nieuwe telefoon instellen' }
const UITLEG: Record<Actie, string> = {
  aan: 'Bevestig eerst je huidige wachtwoord. Daarna scan je een QR-code met je authenticator-app.',
  uit: 'Bevestig met je wachtwoord en een code uit je app (of een herstelcode). Daarna log je weer in met enkel je wachtwoord. Andere ingelogde toestellen worden afgemeld.',
  herstel: 'Bevestig met je wachtwoord en een code uit je app (of een herstelcode). Al je vorige herstelcodes werken daarna niet meer. Andere ingelogde toestellen worden afgemeld.',
  opnieuw: 'Bevestig met je wachtwoord en een code uit je huidige app (of een herstelcode). Daarna scan je een nieuwe QR-code met je nieuwe telefoon.',
}

/** Wachtwoord (+ tweede factor, behalve bij inschakelen) opnieuw vragen. */
function Herbevestig({ soort, onSluit, onKlaar }: { soort: Actie; onSluit: () => void; onKlaar: (r: { setup?: Setup; codes?: string[] }) => void }) {
  const [wachtwoord, setWachtwoord] = useState('')
  const [code, setCode] = useState('')
  const [herstel, setHerstel] = useState(false)
  const [herstelcode, setHerstelcode] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const factor = herstel ? { herstelcode } : { code }

  const verstuur = async (e: React.FormEvent) => {
    e.preventDefault()
    setBezig(true); setFout(null)
    try {
      if (soort === 'aan') {
        const s = await post<{ qrSvg: string; geheim: string }>('/api/auth/2fa/totp/setup', { wachtwoord })
        onKlaar({ setup: { ...s, opnieuw: false } })
      } else if (soort === 'opnieuw') {
        const s = await post<{ qrSvg: string; geheim: string }>('/api/auth/2fa/totp/opnieuw', { wachtwoord, ...factor })
        onKlaar({ setup: { ...s, opnieuw: true } })
      } else if (soort === 'herstel') {
        onKlaar({ codes: (await post<{ herstelcodes: string[] }>('/api/auth/2fa/herstelcodes', { wachtwoord, ...factor })).herstelcodes })
      } else {
        await post('/api/auth/2fa/totp/uitschakelen', { wachtwoord, ...factor })
        onKlaar({})
      }
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Het wachtwoord of de code is ongeldig.')
      setCode(''); setHerstelcode('')
    } finally { setBezig(false) }
  }

  const klaar = wachtwoord.length > 0 && (soort === 'aan' || (herstel ? herstelcode.replace(/[\s-]/g, '').length >= 12 : code.length === 6))
  return (
    <Dialoog titel={TITEL[soort]} onSluit={onSluit}>
      <form onSubmit={verstuur} className="space-y-4">
        <p className="text-sm text-gray-600">{UITLEG[soort]}</p>
        <div>
          <label htmlFor="ww" className="block text-xs font-medium text-gray-600 mb-1">Huidig wachtwoord</label>
          <input id="ww" type="password" autoComplete="current-password" autoFocus className={INP} value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} />
        </div>
        {soort !== 'aan' && (herstel ? (
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
        ))}
        {soort !== 'aan' && (
          <button type="button" className="text-xs text-gray-500 hover:text-black" onClick={() => { setHerstel((h) => !h); setCode(''); setHerstelcode('') }}>
            {herstel ? 'Code uit de app gebruiken' : 'Telefoon niet bij de hand? Gebruik een herstelcode'}
          </button>
        )}
        {fout && <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fout}</div>}
        <div className="flex gap-2 justify-end flex-wrap">
          <button type="button" onClick={onSluit} disabled={bezig} className="btn-secondary">Annuleren</button>
          <button type="submit" disabled={bezig || !klaar} className={soort === 'uit' ? 'btn-danger' : 'btn-primary'}>
            {bezig && <Loader2 className="h-4 w-4 animate-spin" />}{soort === 'aan' ? 'Verder' : soort === 'uit' ? 'Uitschakelen' : soort === 'herstel' ? 'Nieuwe codes maken' : 'Verder'}
          </button>
        </div>
      </form>
    </Dialoog>
  )
}
