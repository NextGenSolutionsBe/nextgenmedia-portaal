'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Mail, Search, Loader2, X, RefreshCw, AlertTriangle } from 'lucide-react'
import { MAIL_STATUS, mailStatusVan } from '@/lib/contracten/mailstatus'

/**
 * Verzonden contractmails: per verzendpoging ontvanger, cc, onderwerp, datum,
 * medewerker, ondertekenlink/versie, status en berichtreferentie — en de
 * werkelijk verstuurde inhoud. Gebruikt in het contractdetail (één contract) en
 * als overzicht in de Contracten-module (doorzoekbaar).
 */

type Rij = {
  id: string; contract_id: string | null; to_email: string; cc: string | null; subject: string; status: string | null; error: string | null
  provider_id: string | null; provider_status: string | null; provider_status_op: string | null; sent_by_email: string | null; created_at: string
  bijlage: string | null; template_name: string | null; contract_titel?: string | null; klant?: string | null
}
type Volledig = Rij & { body: string | null; html: string | null; from_email: string | null; bcc: string | null }

const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '—')
const statusVan = (m: Rij) => mailStatusVan([{ status: m.status, created_at: m.created_at, provider_status: m.provider_status }], null)

export function MailStatusChip({ m }: { m: Rij }) {
  const s = MAIL_STATUS[statusVan(m)]
  return <span title={s.uitleg} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${s.cls}`}>{s.label}</span>
}

export function VerzondenMails({ contractId, compact }: { contractId?: string; compact?: boolean }) {
  const [mails, setMails] = useState<Rij[] | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const laad = useCallback(async (zoek = '') => {
    try {
      const qs = new URLSearchParams(); if (contractId) qs.set('contract_id', contractId); if (zoek) qs.set('q', zoek)
      const r = await fetch(`/api/admin/contracts/mails?${qs}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setMails(j.mails)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setMails([]) }
  }, [contractId])
  useEffect(() => { laad() }, [laad])
  useEffect(() => { if (contractId) return; const t = setTimeout(() => laad(q.trim()), 300); return () => clearTimeout(t) }, [q, contractId, laad])

  return (
    <div className={compact ? 'card-base space-y-2' : 'space-y-3'}>
      <div className="flex items-center gap-2 flex-wrap">
        {compact && <h2 className="font-semibold text-sm flex items-center gap-1.5"><Mail className="h-4 w-4 text-gray-400" />Verzonden mails</h2>}
        {!contractId && (
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="Zoek op klant, contract of ontvanger…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Zoeken in verzonden mails" />
          </div>
        )}
        {!mails && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>
      {mails && mails.length === 0 && <p className="text-sm text-gray-400">{contractId ? 'Er werd voor dit contract nog geen mail vanuit de app verstuurd (of er zijn geen mailgegevens bewaard).' : 'Geen verzonden contractmails gevonden.'}</p>}
      {mails && mails.length > 0 && (
        <ul className={`divide-y divide-gray-100 ${compact ? '' : 'card-base p-0'} rounded-xl border border-gray-100`}>
          {mails.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => setOpen(m.id)} className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{m.subject}</div>
                  <div className="text-[11px] text-gray-500 truncate">Aan {m.to_email}{m.cc ? ` · cc ${m.cc}` : ''} · {dt(m.created_at)}{m.sent_by_email ? ` · door ${m.sent_by_email}` : ''}</div>
                  {!contractId && <div className="text-[11px] text-gray-500 truncate">{m.klant ?? 'Geen klant'} · {m.contract_titel ?? <span className="italic">niet aan een contract gekoppeld</span>}</div>}
                  {m.error && <div className="text-[11px] text-red-700 truncate flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{m.error}</div>}
                </div>
                <MailStatusChip m={m} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <MailDetail id={open} onSluit={() => setOpen(null)} onVernieuwd={() => laad(q.trim())} />}
    </div>
  )
}

function MailDetail({ id, onSluit, onVernieuwd }: { id: string; onSluit: () => void; onVernieuwd: () => void }) {
  const [m, setM] = useState<Volledig | null>(null)
  const [bezig, setBezig] = useState(false)
  const laad = useCallback(async () => {
    const r = await fetch(`/api/admin/contracts/mails?id=${id}`, { cache: 'no-store' })
    const j = await r.json(); if (!r.ok) { toast.error(j.error); onSluit(); return }
    setM(j.mail)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { laad() }, [laad])
  const vernieuw = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/contracts/mails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'status' }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(j.provider_status ? `Status bij de mailprovider: ${j.provider_status}` : 'Nog geen status bij de mailprovider.')
      await laad(); onVernieuwd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  const rij = (k: string, v: React.ReactNode) => <><dt className="text-gray-500">{k}</dt><dd className="min-w-0 break-words">{v}</dd></>
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40" role="dialog" aria-modal="true" aria-label="Verzonden mail">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
          <div className="flex-1 min-w-0"><h3 className="font-semibold truncate">{m?.subject ?? 'Mail'}</h3>{m && <div className="mt-1"><MailStatusChip m={m} /></div>}</div>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        {!m ? <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" /></div> : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
              {rij('Verzonden op', dt(m.created_at))}
              {rij('Door', m.sent_by_email ?? '—')}
              {rij('Van', m.from_email ?? '—')}
              {rij('Aan', m.to_email)}
              {m.cc && rij('Cc', m.cc)}
              {m.bcc && rij('Bcc', m.bcc)}
              {rij('Contract', m.contract_id ? <Link href={`/admin/contracts/${m.contract_id}`} className="underline">openen</Link> : 'niet gekoppeld')}
              {rij('Ondertekenlink / versie', m.bijlage ?? '—')}
              {rij('Status', <>{MAIL_STATUS[statusVan(m)].label}{m.provider_status ? ` · mailprovider: ${m.provider_status}${m.provider_status_op ? ` (${dt(m.provider_status_op)})` : ''}` : ''}</>)}
              {m.error && rij('Foutmelding', <span className="text-red-700">{m.error}</span>)}
              {rij('Berichtreferentie', m.provider_id ?? '—')}
            </dl>
            {m.provider_id && <button type="button" onClick={vernieuw} disabled={bezig} className="btn-secondary text-xs">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Afleverstatus opvragen</button>}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Verstuurde inhoud</div>
              {m.html ? <iframe title="Verstuurde mail" sandbox="" srcDoc={m.html} className="w-full h-[420px] rounded-lg border border-gray-200 bg-white" />
                : m.body ? <><pre className="whitespace-pre-wrap text-sm text-gray-800 rounded-lg border border-gray-200 bg-gray-50 p-3 font-sans">{m.body}</pre><p className="text-[11px] text-gray-500 mt-1">Van deze oudere mail is enkel de tekst bewaard, niet de opgemaakte versie.</p></>
                : <p className="text-sm text-gray-400">Geen inhoud bewaard.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
