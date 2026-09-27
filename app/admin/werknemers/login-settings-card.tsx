'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, ShieldOff, KeyRound, Smartphone, RotateCcw } from 'lucide-react'
import { CodeInvoer } from '@/components/ui/code-invoer'
import { Dialoog, INP } from '@/app/admin/instellingen/ui'

type Account = {
  authUserId: string
  email: string | null
  name: string | null
  role: 'admin' | 'employee'
  active: boolean
  twoFactorRequired: boolean
  totpActief: boolean
}

/**
 * Wie moet er bij het inloggen een code invullen?
 *
 * Standaard iedereen met een intern account. Hier kan dat per persoon uitgezet
 * worden — dan volstaan e-mail en wachtwoord. Klanten en partners staan hier
 * niet tussen: die krijgen sowieso nooit een code.
 */
export function LoginSettingsCard() {
  const [rows, setRows] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // Staat de tabel er nog niet, dan zeggen we dat meteen — anders lijkt het
  // alsof alles goed staat tot je op de knop drukt.
  const [hint, setHint] = useState<string | null>(null)
  const [reset, setReset] = useState<Account | null>(null)
  const [uitzetten, setUitzetten] = useState<Account | null>(null)
  const [ikHebApp, setIkHebApp] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/login-settings', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setRows(j.accounts ?? [])
      setHint(j.hint ?? null)
      setIkHebApp(!!j.ikHebApp)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = async (a: Account) => {
    const next = !a.twoFactorRequired
    if (!next && !confirm(
      `Inlogcode uitzetten voor ${a.email ?? 'dit account'}?\n\n` +
      'Vanaf dan volstaat een e-mailadres en wachtwoord om binnen te raken. ' +
      'Raakt dat wachtwoord bij iemand anders, dan is er niets meer dat hem tegenhoudt.',
    )) return

    setBusy(a.authUserId)
    try {
      const r = await fetch('/api/admin/login-settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authUserId: a.authUserId, twoFactorRequired: next }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setRows((prev) => prev.map((x) => (x.authUserId === a.authUserId ? { ...x, twoFactorRequired: next } : x)))
      toast.success(next ? 'Code weer verplicht.' : 'Code uitgezet voor dit account.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Wijzigen mislukt') } finally { setBusy(null) }
  }

  const without = rows.filter((r) => !r.twoFactorRequired).length

  return (
    <div className="card-base">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-gray-400" />Inloggen met code
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Interne accounts met hun rol en 2FA-status. Wie moet er naast e-mail en wachtwoord ook een code invullen? Standaard iedereen: per e-mail, of via een authenticator-app als die persoon dat instelde.
          </p>
        </div>
        {without > 0 && (
          <span className="status-badge bg-amber-100 text-amber-800">
            {without} account{without === 1 ? '' : 's'} zonder code
          </span>
        )}
      </div>

      {hint && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {hint}
        </p>
      )}

      {loading ? (
        <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">Geen interne accounts gevonden.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {rows.map((a) => (
            <div key={a.authUserId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium flex items-center gap-x-2 gap-y-1 flex-wrap">
                  {a.name || a.email || 'Onbekend account'}
                  <span className="status-badge bg-gray-100 text-gray-600">
                    {a.role === 'admin' ? 'Admin' : 'Werknemer'}
                  </span>
                  {!a.active && <span className="status-badge bg-red-100 text-red-600">Inactief</span>}
                  <span className={`status-badge ${a.totpActief ? 'bg-green-100 text-green-700' : a.twoFactorRequired ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'}`}
                    title={a.totpActief ? 'Authenticator-app actief' : a.twoFactorRequired ? 'Code per e-mail bij het inloggen' : 'Geen tweede stap: wachtwoord volstaat'}>
                    <Smartphone className="h-3 w-3 inline -mt-0.5 mr-0.5" />2FA: {a.totpActief ? 'app' : a.twoFactorRequired ? 'mailcode' : 'uit'}
                  </span>
                </div>
                {a.name && a.email && <div className="text-[11px] text-gray-400 truncate">{a.email}</div>}
              </div>

              {a.role === 'employee' ? (
                a.twoFactorRequired || a.totpActief ? (
                  <button onClick={() => setUitzetten(a)} disabled={!!hint}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border bg-white text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-50">
                    <ShieldOff className="h-3.5 w-3.5" />2FA uitzetten
                  </button>
                ) : (
                  <button onClick={() => toggle(a)} disabled={busy === a.authUserId || !!hint}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border bg-green-50 text-green-700 border-green-200 hover:bg-green-100 disabled:opacity-50">
                    {busy === a.authUserId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}2FA aanzetten
                  </button>
                )
              ) : (<>
              {a.totpActief && (
                <button onClick={() => setReset(a)} title="App-2FA resetten (telefoon en herstelcodes kwijt)"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">
                  <RotateCcw className="h-3.5 w-3.5" /><span className="hidden sm:inline">2FA resetten</span>
                </button>
              )}
              <button
                onClick={() => toggle(a)}
                disabled={busy === a.authUserId || !!hint || a.totpActief}
                title={a.twoFactorRequired ? 'Code uitzetten voor dit account' : 'Code weer verplicht maken'}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  a.twoFactorRequired
                    ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                    : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                } disabled:opacity-50`}>
                {busy === a.authUserId
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : a.twoFactorRequired ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
                {a.twoFactorRequired ? 'Met code' : 'Zonder code'}
              </button>
              </>)}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-500 mt-3">
        Zet je de code uit, dan volstaat een wachtwoord om bij alles te raken waar dat account bij mag.
        Elke wijziging hier komt in het logboek. Klanten en partners loggen sowieso in zonder code.
        De 2FA van een werknemer zet je uit met je eigen wachtwoord{ikHebApp ? ' en een code uit je eigen app' : ''}; een eventuele authenticator-app van die werknemer wordt dan verwijderd.
        Bij een admin kun je een app enkel resetten, met je eigen wachtwoord en app-code.
      </p>
      {reset && <ResetDialoog account={reset} onSluit={() => setReset(null)} onKlaar={() => { setReset(null); load() }} />}
      {uitzetten && <UitzetDialoog account={uitzetten} metCode={ikHebApp} onSluit={() => setUitzetten(null)} onKlaar={() => { setUitzetten(null); load() }} />}
    </div>
  )
}

/**
 * Herstelpad als iemand telefoon én herstelcodes kwijt is. De admin bevestigt
 * met het EIGEN wachtwoord en de EIGEN app-code; de server controleert alles.
 */
function ResetDialoog({ account, onSluit, onKlaar }: { account: Account; onSluit: () => void; onKlaar: () => void }) {
  const [wachtwoord, setWachtwoord] = useState('')
  const [code, setCode] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const verstuur = async (e: React.FormEvent) => {
    e.preventDefault()
    setBezig(true); setFout(null)
    try {
      const r = await fetch('/api/admin/login-settings/reset-2fa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authUserId: account.authUserId, wachtwoord, code }) })
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? 'Resetten mislukt')
      toast.success('2FA gereset. Die persoon logt nu in met een code per e-mail en stelt een nieuwe app in.')
      onKlaar()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Resetten mislukt'); setCode('') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel="2FA resetten" onSluit={onSluit}>
      <form onSubmit={verstuur} className="space-y-4">
        <p className="text-sm text-gray-600">
          De authenticator-app en herstelcodes van <b>{account.name || account.email}</b> worden verwijderd en die persoon wordt overal afgemeld. Doe dit enkel als je zeker weet dat het om die persoon gaat (bv. telefonisch of persoonlijk bevestigd).
        </p>
        <div>
          <label htmlFor="rw" className="block text-xs font-medium text-gray-600 mb-1">Jouw wachtwoord</label>
          <input id="rw" type="password" autoComplete="current-password" autoFocus className={INP} value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rc" className="block text-xs font-medium text-gray-600 mb-1">Code uit jouw authenticator-app</label>
          <CodeInvoer id="rc" waarde={code} onWijzig={setCode} disabled={bezig} />
        </div>
        {fout && <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fout}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onSluit} disabled={bezig} className="btn-secondary">Annuleren</button>
          <button type="submit" disabled={bezig || !wachtwoord || code.length !== 6} className="btn-danger">
            {bezig && <Loader2 className="h-4 w-4 animate-spin" />}2FA resetten
          </button>
        </div>
      </form>
    </Dialoog>
  )
}

/**
 * 2FA van een werknemer volledig uitzetten (app + code bij het inloggen).
 * De admin bevestigt met het eigen wachtwoord, en met de eigen app-code als
 * die admin zelf een authenticator-app heeft. De server controleert alles.
 */
function UitzetDialoog({ account, metCode, onSluit, onKlaar }: { account: Account; metCode: boolean; onSluit: () => void; onKlaar: () => void }) {
  const [wachtwoord, setWachtwoord] = useState('')
  const [code, setCode] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const verstuur = async (e: React.FormEvent) => {
    e.preventDefault()
    setBezig(true); setFout(null)
    try {
      const r = await fetch('/api/admin/login-settings/2fa-uitzetten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authUserId: account.authUserId, wachtwoord, code: metCode ? code : undefined }) })
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? 'Uitzetten mislukt')
      toast.success(`2FA uitgezet voor ${account.name || account.email}.`)
      onKlaar()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Uitzetten mislukt'); setCode('') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel="2FA uitzetten" onSluit={onSluit}>
      <form onSubmit={verstuur} className="space-y-4">
        <p className="text-sm text-gray-600">
          <b>{account.name || account.email}</b> logt daarna in met enkel e-mail en wachtwoord.
          {account.totpActief ? ' De authenticator-app en herstelcodes van die persoon worden verwijderd.' : ''}
          {' '}Weer aanzetten kan met één klik; de werknemer kan zelf opnieuw een app instellen via Mijn account.
        </p>
        <div>
          <label htmlFor="uw" className="block text-xs font-medium text-gray-600 mb-1">Jouw wachtwoord</label>
          <input id="uw" type="password" autoComplete="current-password" autoFocus className={INP} value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} />
        </div>
        {metCode && (
          <div>
            <label htmlFor="uc" className="block text-xs font-medium text-gray-600 mb-1">Code uit jouw authenticator-app</label>
            <CodeInvoer id="uc" waarde={code} onWijzig={setCode} disabled={bezig} />
          </div>
        )}
        {fout && <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fout}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onSluit} disabled={bezig} className="btn-secondary">Annuleren</button>
          <button type="submit" disabled={bezig || !wachtwoord || (metCode && code.length !== 6)} className="btn-danger">
            {bezig && <Loader2 className="h-4 w-4 animate-spin" />}2FA uitzetten
          </button>
        </div>
      </form>
    </Dialoog>
  )
}
