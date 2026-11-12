'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, ShieldOff, Smartphone, RotateCcw, QrCode, Copy, Download, Check } from 'lucide-react'
import { CodeInvoer } from '@/components/ui/code-invoer'
import { Dialoog, INP } from '@/app/admin/instellingen/ui'

type Account = {
  authUserId: string
  email: string | null
  name: string | null
  role: 'admin' | 'employee'
  active: boolean
  totpActief: boolean
  vrijgesteld: boolean
  vrijgesteldTot: string | null
}

type Actie = { soort: 'uitschakelen' | 'resetten' | 'koppelen'; a: Account }

const API = '/api/admin/login-settings/2fa'
const naamVan = (a: Account) => a.name || a.email || 'dit account'
const tot = (s: string) => new Date(s).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? 'Mislukt')
  return j as T
}

/**
 * Tweestapsverificatie per intern account — enkel nog met een authenticator-app.
 * Wie nog geen app heeft, koppelt er een bij de volgende login. Een admin kan
 * voor een ander account: tijdelijk uitschakelen, weer aanzetten, resetten
 * (nieuwe telefoon) of zelf een app koppelen (de persoon scant de QR met zijn
 * telefoon). Gevoelige acties vragen het eigen wachtwoord (+ eigen app-code).
 */
export function LoginSettingsCard() {
  const [rows, setRows] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [ikHebApp, setIkHebApp] = useState(false)
  const [meId, setMeId] = useState<string | null>(null)
  const [actie, setActie] = useState<Actie | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/login-settings', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setRows(j.accounts ?? []); setIkHebApp(!!j.ikHebApp); setMeId(j.meId ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const aanzetten = async (a: Account) => {
    setBusy(a.authUserId)
    try {
      await post({ actie: 'aanzetten', authUserId: a.authUserId })
      toast.success(`2FA weer verplicht voor ${naamVan(a)}.`)
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBusy(null) }
  }

  const uit = rows.filter((r) => r.vrijgesteld).length
  const zonderApp = rows.filter((r) => !r.totpActief && !r.vrijgesteld).length
  const knop = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50'

  return (
    <div className="card-base">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-gray-400" />Tweestapsverificatie
          </h2>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            Elk intern account logt in met e-mail, wachtwoord én een code uit een authenticator-app. Wie nog geen app heeft,
            koppelt er een bij de volgende login — of je koppelt ze hier samen met die persoon.
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {zonderApp > 0 && <span className="status-badge bg-blue-100 text-blue-700">{zonderApp} nog zonder app</span>}
          {uit > 0 && <span className="status-badge bg-amber-100 text-amber-800">{uit} met 2FA uit</span>}
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">Geen interne accounts gevonden.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {rows.map((a) => {
            const zelf = a.authUserId === meId
            return (
              <div key={a.authUserId} className="flex items-center gap-3 py-2.5 flex-wrap sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium flex items-center gap-x-2 gap-y-1 flex-wrap">
                    {a.name || a.email || 'Onbekend account'}
                    <span className="status-badge bg-gray-100 text-gray-600">{a.role === 'admin' ? 'Admin' : 'Werknemer'}</span>
                    {!a.active && <span className="status-badge bg-red-100 text-red-600">Inactief</span>}
                    {a.vrijgesteld ? (
                      <span className="status-badge bg-amber-100 text-amber-800"><ShieldOff className="h-3 w-3 inline -mt-0.5 mr-0.5" />2FA uit {a.vrijgesteldTot ? `tot ${tot(a.vrijgesteldTot)}` : 'tot weer aangezet'}</span>
                    ) : a.totpActief ? (
                      <span className="status-badge bg-green-100 text-green-700"><ShieldCheck className="h-3 w-3 inline -mt-0.5 mr-0.5" />App gekoppeld</span>
                    ) : (
                      <span className="status-badge bg-blue-100 text-blue-700" title="Moet bij de volgende login een app koppelen"><Smartphone className="h-3 w-3 inline -mt-0.5 mr-0.5" />Nog geen app</span>
                    )}
                  </div>
                  {a.name && a.email && <div className="text-[11px] text-gray-400 truncate">{a.email}</div>}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {zelf ? (
                    <Link href="/admin/account" className={`${knop} bg-white text-gray-600 border-gray-200 hover:bg-gray-50`}>Via Mijn account</Link>
                  ) : (<>
                    {!a.totpActief && (
                      <button onClick={() => setActie({ soort: 'koppelen', a })} className={`${knop} bg-white text-gray-700 border-gray-200 hover:bg-gray-50`}>
                        <QrCode className="h-3.5 w-3.5" />App koppelen
                      </button>
                    )}
                    {a.totpActief && (
                      <button onClick={() => setActie({ soort: 'resetten', a })} className={`${knop} bg-white text-gray-700 border-gray-200 hover:bg-gray-50`} title="Nieuwe telefoon of app kwijt">
                        <RotateCcw className="h-3.5 w-3.5" />Resetten
                      </button>
                    )}
                    {a.vrijgesteld ? (
                      <button onClick={() => aanzetten(a)} disabled={busy === a.authUserId} className={`${knop} bg-green-50 text-green-700 border-green-200 hover:bg-green-100`}>
                        {busy === a.authUserId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}Weer aanzetten
                      </button>
                    ) : (
                      <button onClick={() => setActie({ soort: 'uitschakelen', a })} className={`${knop} bg-white text-amber-800 border-amber-200 hover:bg-amber-50`}>
                        <ShieldOff className="h-3.5 w-3.5" />Tijdelijk uitschakelen
                      </button>
                    )}
                  </>)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-gray-500 mt-3">
        Uitschakelen, resetten en koppelen vragen je eigen wachtwoord{ikHebApp ? ' en een code uit je eigen app' : ''}. Elke wijziging komt in het logboek.
        Klanten en partners loggen in zonder tweede stap.
      </p>
      {actie && <ActieDialoog actie={actie} metCode={ikHebApp} onSluit={() => setActie(null)} onKlaar={() => { setActie(null); load() }} />}
    </div>
  )
}

/**
 * Eén dialoog voor de drie gevoelige acties. Eerst herbevestigen (eigen
 * wachtwoord + eigen app-code); bij koppelen daarna de QR voor die persoon,
 * diens code, en tot slot diens herstelcodes.
 */
function ActieDialoog({ actie, metCode, onSluit, onKlaar }: { actie: Actie; metCode: boolean; onSluit: () => void; onKlaar: () => void }) {
  const { soort, a } = actie
  const [wachtwoord, setWachtwoord] = useState('')
  const [code, setCode] = useState('')
  const [duur, setDuur] = useState<'24u' | '7d' | 'onbeperkt'>('24u')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [qr, setQr] = useState<{ qrSvg: string; geheim: string } | null>(null)
  const [doelCode, setDoelCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [bewaard, setBewaard] = useState(false)

  const titel = { uitschakelen: '2FA tijdelijk uitschakelen', resetten: 'App resetten', koppelen: 'App koppelen' }[soort]

  const herbevestig = async (e: React.FormEvent) => {
    e.preventDefault()
    setBezig(true); setFout(null)
    try {
      const basis = { authUserId: a.authUserId, wachtwoord, code: metCode ? code : undefined }
      if (soort === 'uitschakelen') {
        await post({ ...basis, actie: 'uitschakelen', duur })
        toast.success(`2FA uitgeschakeld voor ${naamVan(a)}.`); onKlaar()
      } else if (soort === 'resetten') {
        await post({ ...basis, actie: 'resetten' })
        toast.success(`Gereset. ${naamVan(a)} koppelt bij de volgende login een nieuwe app.`); onKlaar()
      } else {
        setQr(await post<{ qrSvg: string; geheim: string }>({ ...basis, actie: 'koppel_start' }))
      }
    } catch (e) { setFout(e instanceof Error ? e.message : 'Mislukt'); setCode('') } finally { setBezig(false) }
  }

  const bevestigKoppeling = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (bezig || doelCode.length !== 6) return
    setBezig(true); setFout(null)
    try {
      const j = await post<{ herstelcodes: string[] }>({ actie: 'koppel_bevestig', authUserId: a.authUserId, doelCode })
      setCodes(j.herstelcodes); toast.success(`App gekoppeld voor ${naamVan(a)}.`)
    } catch (e) { setFout(e instanceof Error ? e.message : 'De code is ongeldig of verlopen.'); setDoelCode('') } finally { setBezig(false) }
  }

  // Herstelcodes van die persoon: één keer tonen, om door te geven.
  if (codes) {
    const tekst = `NextGen — herstelcodes voor ${a.email ?? naamVan(a)}\nElke code werkt één keer.\n\n${codes.join('\n')}\n`
    return (
      <Dialoog titel="App gekoppeld" onSluit={() => bewaard && onKlaar()}>
        <div className="space-y-3">
          <p className="text-sm text-gray-700">Geef deze herstelcodes aan <b>{naamVan(a)}</b>. Iedere code kan slechts één keer worden gebruikt en je ziet ze maar één keer.</p>
          <ul className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            {codes.map((c) => <li key={c} className="font-mono text-sm tracking-wider bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-center">{c}</li>)}
          </ul>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn-secondary" onClick={() => navigator.clipboard.writeText(tekst).then(() => toast.success('Gekopieerd'))}><Copy className="h-4 w-4" />Kopiëren</button>
            <button type="button" className="btn-secondary" onClick={() => {
              const url = URL.createObjectURL(new Blob([tekst], { type: 'text/plain' }))
              const el = document.createElement('a'); el.href = url; el.download = 'nextgen-herstelcodes.txt'; el.click(); URL.revokeObjectURL(url)
            }}><Download className="h-4 w-4" />Downloaden</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" className="h-4 w-4" checked={bewaard} onChange={(e) => setBewaard(e.target.checked)} />De herstelcodes zijn doorgegeven of veilig bewaard</label>
          <div className="flex justify-end"><button type="button" className="btn-primary" disabled={!bewaard} onClick={onKlaar}><Check className="h-4 w-4" />Klaar</button></div>
        </div>
      </Dialoog>
    )
  }

  // Koppelen, stap 2: de persoon scant de QR en geeft de code uit zijn telefoon.
  if (qr) {
    return (
      <Dialoog titel={titel} onSluit={onSluit}>
        <form onSubmit={bevestigKoppeling} className="space-y-4">
          <p className="text-sm text-gray-700">Laat <b>{naamVan(a)}</b> deze QR-code scannen met Google Authenticator, Microsoft Authenticator of een andere authenticator-app op de eigen telefoon.</p>
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(qr.qrSvg)}`} alt="QR-code voor de authenticator-app" className="h-44 w-44 shrink-0 rounded-xl border border-gray-200 bg-white p-2 self-center sm:self-auto" />
            <div className="min-w-0 space-y-1">
              <div className="text-xs text-gray-500">Of de configuratiesleutel handmatig invoeren:</div>
              <code className="block font-mono text-sm tracking-wider bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 break-all">{qr.geheim}</code>
            </div>
          </div>
          <div className="max-w-xs">
            <label htmlFor="dc" className="block text-xs font-medium text-gray-600 mb-1">6-cijferige code uit de app van {naamVan(a)}</label>
            <CodeInvoer id="dc" waarde={doelCode} onWijzig={(v) => { setDoelCode(v); if (fout) setFout(null) }} autoFocus disabled={bezig} />
          </div>
          {fout && <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fout}</div>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onSluit} disabled={bezig} className="btn-secondary">Annuleren</button>
            <button type="submit" disabled={bezig || doelCode.length !== 6} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Koppeling bevestigen</button>
          </div>
          <p className="text-[11px] text-gray-400">De QR-code is 15 minuten geldig. Pas na een geldige code is de app gekoppeld.</p>
        </form>
      </Dialoog>
    )
  }

  // Stap 1 (alle acties): wat gebeurt er + herbevestigen.
  return (
    <Dialoog titel={titel} onSluit={onSluit}>
      <form onSubmit={herbevestig} className="space-y-4">
        <p className="text-sm text-gray-600">
          {soort === 'uitschakelen' && <><b>{naamVan(a)}</b> logt in die periode in met alleen e-mail en wachtwoord. Een gekoppelde app blijft bewaard en werkt daarna weer.</>}
          {soort === 'resetten' && <>De app en herstelcodes van <b>{naamVan(a)}</b> worden verwijderd en die persoon wordt overal afgemeld. Bij de volgende login koppelt die een nieuwe app (of je koppelt ze hier samen).</>}
          {soort === 'koppelen' && <>Je koppelt een authenticator-app voor <b>{naamVan(a)}</b>. Doe dit samen met die persoon: die scant straks de QR-code met de eigen telefoon.</>}
        </p>
        {soort === 'uitschakelen' && (
          <div className="flex gap-1.5 flex-wrap">
            {([['24u', '24 uur'], ['7d', '7 dagen'], ['onbeperkt', 'Tot ik het weer aanzet']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setDuur(k)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${duur === k ? 'bg-black text-white border-black' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </div>
        )}
        <div>
          <label htmlFor="aw" className="block text-xs font-medium text-gray-600 mb-1">Jouw wachtwoord</label>
          <input id="aw" type="password" autoComplete="current-password" autoFocus className={INP} value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} />
        </div>
        {metCode && (
          <div>
            <label htmlFor="ac" className="block text-xs font-medium text-gray-600 mb-1">Code uit jouw authenticator-app</label>
            <CodeInvoer id="ac" waarde={code} onWijzig={setCode} disabled={bezig} />
          </div>
        )}
        {fout && <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{fout}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onSluit} disabled={bezig} className="btn-secondary">Annuleren</button>
          <button type="submit" disabled={bezig || !wachtwoord || (metCode && code.length !== 6)} className={soort === 'koppelen' ? 'btn-primary' : 'btn-danger'}>
            {bezig && <Loader2 className="h-4 w-4 animate-spin" />}{soort === 'uitschakelen' ? 'Uitschakelen' : soort === 'resetten' ? 'Resetten' : 'Verder naar de QR-code'}
          </button>
        </div>
      </form>
    </Dialoog>
  )
}
