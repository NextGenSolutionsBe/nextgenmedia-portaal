'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, ShieldOff, KeyRound } from 'lucide-react'

type Account = {
  authUserId: string
  email: string | null
  name: string | null
  role: 'admin' | 'employee'
  active: boolean
  twoFactorRequired: boolean
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

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/login-settings', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setRows(j.accounts ?? [])
      setHint(j.hint ?? null)
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
            Wie moet er naast e-mail en wachtwoord ook de toegestuurde code invullen? Standaard iedereen.
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
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {a.name || a.email || 'Onbekend account'}
                  <span className="status-badge bg-gray-100 text-gray-600">
                    {a.role === 'admin' ? 'Admin' : 'Werknemer'}
                  </span>
                  {!a.active && <span className="status-badge bg-red-100 text-red-600">Inactief</span>}
                </div>
                {a.name && a.email && <div className="text-[11px] text-gray-400 truncate">{a.email}</div>}
              </div>

              <button
                onClick={() => toggle(a)}
                disabled={busy === a.authUserId || !!hint}
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
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-500 mt-3">
        Zet je de code uit, dan volstaat een wachtwoord om bij alles te raken waar dat account bij mag.
        Elke wijziging hier komt in het logboek. Klanten en partners loggen sowieso in zonder code.
      </p>
    </div>
  )
}
