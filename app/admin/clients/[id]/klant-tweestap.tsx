'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Dialoog, INP } from '@/app/admin/instellingen/ui'
import { CodeInvoer } from '@/components/ui/code-invoer'

/**
 * Tweestapsverificatie van de portaalaccounts van deze klant. De klant schakelt
 * ze zelf in (vrijwillig). NextGenMedia ziet enkel de status — nooit het geheim
 * of de herstelcodes — en kan ze resetten als iemand telefoon én herstelcodes
 * kwijt is: met een reden en de eigen herbevestiging. De klant krijgt een mail.
 */
type Account = { authUserId: string; naam: string | null; email: string | null; eigenaar: boolean; actief: boolean; sinds: string | null; herstelcodesOver: number }

export function KlantTweestap({ clientId }: { clientId: string }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [reset, setReset] = useState<Account | null>(null)
  const laad = useCallback(() => {
    fetch(`/api/admin/clients/${clientId}/tweestap`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setAccounts(j.accounts) })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [clientId])
  useEffect(() => { laad() }, [laad])
  if (fout) return null
  if (!accounts) return <div className="card-base py-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-gray-400" /></div>
  if (accounts.length === 0) return null
  return (
    <div className="card-base space-y-3">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-4 w-4 text-gray-400 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm">Tweestapsverificatie portaal</h2>
          <p className="text-[11px] text-gray-500">De klant schakelt dit zelf in via Beveiliging. Resetten enkel als iemand telefoon én herstelcodes kwijt is en je de identiteit hebt gecontroleerd.</p>
        </div>
      </div>
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">
        {accounts.map((a) => (
          <li key={a.authUserId} className="px-3 py-2 flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="truncate">{a.naam || a.email}{a.eigenaar && <span className="text-[10px] text-gray-500"> · eigenaar</span>}</div>
              {a.naam && a.email && <div className="text-[11px] text-gray-500 truncate">{a.email}</div>}
            </div>
            <span className={`status-badge ${a.actief ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
              {a.actief ? `Aan${a.sinds ? ` sinds ${new Date(a.sinds).toLocaleDateString('nl-BE')}` : ''} · ${a.herstelcodesOver} codes` : 'Uit'}
            </span>
            {a.actief && <button type="button" className="btn-secondary text-xs text-red-600" onClick={() => setReset(a)}>Resetten</button>}
          </li>
        ))}
      </ul>
      {reset && <ResetDialoog clientId={clientId} account={reset} onSluit={() => setReset(null)} onKlaar={() => { setReset(null); toast.success('Tweestapsverificatie gereset. De klant kreeg een e-mail.'); laad() }} />}
    </div>
  )
}

function ResetDialoog({ clientId, account, onSluit, onKlaar }: { clientId: string; account: Account; onSluit: () => void; onKlaar: () => void }) {
  const [reden, setReden] = useState('')
  const [wachtwoord, setWachtwoord] = useState('')
  const [code, setCode] = useState('')
  const [bevestigd, setBevestigd] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const verstuur = async (e: React.FormEvent) => {
    e.preventDefault()
    setBezig(true); setFout(null)
    try {
      const r = await fetch(`/api/admin/clients/${clientId}/tweestap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authUserId: account.authUserId, reden, wachtwoord, code: code || undefined }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Resetten mislukt')
      onKlaar()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Resetten mislukt'); setCode('') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel="Tweestapsverificatie resetten" onSluit={onSluit}>
      <form onSubmit={verstuur} className="space-y-3">
        <p className="text-sm text-gray-600">Voor <b>{account.naam || account.email}</b>. De app en herstelcodes worden verwijderd en alle sessies afgemeld. Het account logt daarna in met e-mail + wachtwoord en kan zelf opnieuw een app koppelen. De klant krijgt een e-mail en de reset komt in het logboek.</p>
        <div>
          <label htmlFor="reden" className="block text-xs font-medium text-gray-600 mb-1">Reden (verplicht)</label>
          <textarea id="reden" rows={2} className={INP} value={reden} onChange={(e) => setReden(e.target.value)} placeholder="bv. telefoon verloren, identiteit telefonisch gecontroleerd" />
        </div>
        <div>
          <label htmlFor="ww" className="block text-xs font-medium text-gray-600 mb-1">Jouw wachtwoord</label>
          <input id="ww" type="password" autoComplete="current-password" className={INP} value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} />
        </div>
        <div>
          <label htmlFor="code3" className="block text-xs font-medium text-gray-600 mb-1">Code uit jouw authenticator-app <span className="text-gray-400">(als je er een hebt)</span></label>
          <CodeInvoer id="code3" waarde={code} onWijzig={setCode} disabled={bezig} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bevestigd} onChange={(e) => setBevestigd(e.target.checked)} />Ik heb de identiteit van deze persoon gecontroleerd</label>
        {fout && <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fout}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onSluit} disabled={bezig} className="btn-secondary">Annuleren</button>
          <button type="submit" disabled={bezig || !bevestigd || reden.trim().length < 5 || !wachtwoord} className="btn-danger">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Resetten</button>
        </div>
      </form>
    </Dialoog>
  )
}
