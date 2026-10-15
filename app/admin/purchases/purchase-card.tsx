'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2, Paperclip, Plus, Clock, Trash2, Pencil, FileDown, History, Undo2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { formatEuro, formatDate } from '@/lib/utils'
import { FOUNDER_EMAILS, founderName } from '@/lib/founders'
import { PurchaseForm } from './purchase-form'

export type Approval = { id: string; approver_email: string; decision: string; comment: string | null; decided_at: string }
export type Purchase = {
  id: string; title: string; description: string | null; amount_excl: number; vat_pct: number
  supplier: string | null; category: string | null; requester_email: string | null; entry_date: string
  status: string; needs_approval: boolean; cost_entry_id: string | null; attachment_path: string | null
  // Aanpassen / verwijderen / bewijs
  reference?: string | null; version?: number
  deleted_at?: string | null; deleted_by_email?: string | null
  confirmed_at?: string | null; confirmed_by_email?: string | null
}
export type Certificaat = { version: number; certificate_no: string; file_name: string; status: 'actueel' | 'vervangen'; generated_at: string }
export type Wijziging = { id: number; version: number | null; actie: string; actor_email: string | null; oud: Record<string, unknown> | null; nieuw: Record<string, unknown> | null; opmerking: string | null; created_at: string }
export type Rechten = { bewerken: boolean; verwijderen: boolean; bewijs: boolean; herstellen: boolean; blokkade: string | null }

const STATUS: Record<string, { label: string; cls: string }> = {
  concept: { label: 'Concept', cls: 'bg-gray-100 text-gray-600' },
  pending: { label: 'Wacht op goedkeuring', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Goedgekeurd', cls: 'bg-green-100 text-green-700' },
  approved_under_threshold: { label: 'Goedgekeurd (onder drempel)', cls: 'bg-green-100 text-green-700' },
  rejected: { label: 'Afgekeurd', cls: 'bg-red-100 text-red-700' },
}
const VELD: Record<string, string> = { title: 'Titel', description: 'Omschrijving', amount_excl: 'Bedrag excl.', vat_pct: 'Btw %', supplier: 'Leverancier', category: 'Categorie', entry_date: 'Datum', status: 'Status', deleted_at: 'Verwijderd' }
const ACTIE: Record<string, string> = { gewijzigd: 'Aangepast', nieuwe_versie: 'Nieuwe versie', verwijderd: 'Verwijderd', hersteld: 'Hersteld' }

export function PurchaseCard({ purchase: p, approvals, currentEmail, attachmentUrl, rechten, certificaten = [], wijzigingen = [], archief = false }: {
  purchase: Purchase; approvals: Approval[]; currentEmail: string; attachmentUrl: string | null
  rechten?: Rechten; certificaten?: Certificaat[]; wijzigingen?: Wijziging[]; archief?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [bewerk, setBewerk] = useState(false)
  const [verwijderVenster, setVerwijderVenster] = useState(false)
  const [toonGeschiedenis, setToonGeschiedenis] = useState(false)

  const incl = Number(p.amount_excl) * (1 + Number(p.vat_pct) / 100)
  const me = currentEmail.toLowerCase()
  const required = FOUNDER_EMAILS.filter(e => e.toLowerCase() !== (p.requester_email ?? '').toLowerCase())
  const byEmail = new Map(approvals.map(a => [a.approver_email.toLowerCase(), a]))
  const myDecision = byEmail.get(me)
  const isRequiredApprover = required.map(e => e.toLowerCase()).includes(me)
  const isRequester = (p.requester_email ?? '').toLowerCase() === me
  const st = STATUS[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-600' }
  const r: Rechten = rechten ?? { bewerken: false, verwijderen: isRequester && (p.status === 'concept' || p.status === 'pending'), bewijs: isRequester, herstellen: false, blokkade: null }
  const actueel = certificaten.find((c) => c.status === 'actueel') ?? null
  const bevestigd = ['approved', 'approved_under_threshold'].includes(p.status)
  const nummer = p.reference ?? p.id.slice(0, 8).toUpperCase()

  const act = async (body: object) => {
    setBusy('x')
    try {
      const res = await fetch('/api/admin/purchases', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purchase_id: p.id, ...body }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setComment(''); router.refresh()
    } catch (e) { alert(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }
  // Verwijderen: soft-delete naar het archief; tegen dubbelklik beschermd met `busy`.
  const del = async () => {
    if (busy) return
    setBusy('del')
    try {
      const res = await fetch(`/api/admin/purchases/${p.id}`, { method: 'DELETE' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setVerwijderVenster(false)
      toast.success('De aanvraag werd succesvol verwijderd.')
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBusy(null) }
  }
  const herstel = async () => {
    if (busy) return
    setBusy('herstel')
    try {
      const res = await fetch(`/api/admin/purchases/${p.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'herstellen' }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('De aanvraag is hersteld.'); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Herstellen mislukt') } finally { setBusy(null) }
  }

  const canDecide = !archief && p.status === 'pending' && isRequiredApprover && !myDecision
  const canAddCost = !archief && ['approved', 'approved_under_threshold'].includes(p.status) && !p.cost_entry_id
  const toonWaarde = (veld: string, v: unknown) => (v === null || v === undefined || v === '' ? '—' : veld === 'amount_excl' ? formatEuro(Number(v)) : veld === 'vat_pct' ? `${v} %` : String(v))

  return (
    <div className={`border rounded-xl p-4 ${archief ? 'border-dashed border-gray-300 bg-gray-50/60' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium flex items-center gap-2 flex-wrap">
            {p.title}
            <span className={`status-badge text-xs ${st.cls}`}>{st.label}</span>
            {p.cost_entry_id && <span className="status-badge text-xs bg-blue-100 text-blue-700">In kosten</span>}
            {(p.version ?? 1) > 1 && <span className="status-badge text-xs bg-purple-100 text-purple-700" title="Deze aanvraag werd na bevestiging aangepast">Versie {p.version}</span>}
            {archief && <span className="status-badge text-xs bg-gray-200 text-gray-700">Verwijderd</span>}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            <span className="font-mono">{nummer}</span> · {formatDate(p.entry_date)} · {founderName(p.requester_email)}{p.supplier ? ` · ${p.supplier}` : ''}{p.category ? ` · ${p.category}` : ''}
          </div>
          {archief && p.deleted_at && <div className="text-xs text-gray-500 mt-0.5">Verwijderd op {formatDate(p.deleted_at)} door {founderName(p.deleted_by_email)}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold">{formatEuro(incl)}</div>
          <div className="text-[11px] text-gray-400">{formatEuro(Number(p.amount_excl))} excl. · {Number(p.vat_pct)}% btw</div>
        </div>
      </div>

      {p.description && <p className="text-sm text-gray-600 mb-2">{p.description}</p>}
      <div className="flex items-center gap-3 flex-wrap mb-1">
        {attachmentUrl && <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"><Paperclip className="h-3 w-3" />Bijlage</a>}
        {/* Bewijsdocument: één per bevestigde versie; downloaden geeft altijd hetzelfde bestand. */}
        {bevestigd && r.bewijs && (
          <a href={`/api/admin/purchases/${p.id}/bewijs`} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline" title={actueel ? `${actueel.certificate_no} · ${actueel.file_name}` : 'Bewijsdocument (wordt bij de eerste download aangemaakt)'}>
            <FileDown className="h-3 w-3" />Bewijsdocument downloaden{actueel ? <span className="text-gray-400">· {actueel.certificate_no}</span> : null}
          </a>
        )}
        {certificaten.filter((c) => c.status === 'vervangen').map((c) => (
          <a key={c.certificate_no} href={`/api/admin/purchases/${p.id}/bewijs?version=${c.version}`} className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:underline" title="Eerdere versie, vervangen"><FileDown className="h-3 w-3" />v{c.version} (vervangen)</a>
        ))}
        {wijzigingen.length > 0 && (
          <button type="button" onClick={() => setToonGeschiedenis((v) => !v)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"><History className="h-3 w-3" />Geschiedenis ({wijzigingen.length})</button>
        )}
      </div>
      {toonGeschiedenis && (
        <ul className="mb-2 rounded-lg bg-gray-50 border border-gray-100 p-2 space-y-1 text-[11px] text-gray-600">
          {wijzigingen.map((w) => (
            <li key={w.id}>
              <span className="text-gray-400">{new Date(w.created_at).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>{' '}
              <span className="font-medium">{ACTIE[w.actie] ?? w.actie}</span>{w.version ? ` (v${w.version})` : ''} · {founderName(w.actor_email)}
              {w.nieuw && w.actie !== 'verwijderd' && w.actie !== 'hersteld' && Object.keys(w.nieuw).length > 0 && (
                <span>: {Object.keys(w.nieuw).map((k) => `${VELD[k] ?? k} ${toonWaarde(k, w.oud?.[k])} → ${toonWaarde(k, w.nieuw?.[k])}`).join(' · ')}</span>
              )}
              {w.opmerking && <span className="text-gray-400"> — {w.opmerking}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* Goedkeuringsstatus */}
      {p.needs_approval && (
        <div className="mt-2 space-y-1.5">
          {required.map(email => {
            const a = byEmail.get(email.toLowerCase())
            return (
              <div key={email} className="flex items-center gap-2 text-xs">
                {a ? (a.decision === 'approved'
                  ? <Check className="h-3.5 w-3.5 text-green-600" />
                  : <X className="h-3.5 w-3.5 text-red-600" />)
                  : <Clock className="h-3.5 w-3.5 text-amber-500" />}
                <span className="font-medium">{founderName(email)}</span>
                <span className="text-gray-400">
                  {a ? (a.decision === 'approved' ? 'goedgekeurd' : 'afgekeurd') + ` · ${formatDate(a.decided_at)}` : 'moet nog goedkeuren'}
                  {a?.comment ? ` — ${a.comment}` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Acties */}
      {(canDecide || canAddCost || (isRequester && !archief && (p.status === 'concept' || p.status === 'pending')) || r.bewerken || r.verwijderen || (archief && r.herstellen)) && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          {canDecide && (
            <>
              <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Opmerking (optioneel)" className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg" />
              <div className="flex gap-2">
                <button onClick={() => act({ action: 'decide', decision: 'approved', comment })} disabled={busy !== null} className="btn-primary text-sm"><Check className="h-4 w-4" />Goedkeuren</button>
                <button onClick={() => act({ action: 'decide', decision: 'rejected', comment })} disabled={busy !== null} className="btn-danger text-sm"><X className="h-4 w-4" />Afkeuren</button>
              </div>
            </>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {canAddCost && (
              <button onClick={() => act({ action: 'add_cost' })} disabled={busy !== null} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Toevoegen als kost</button>
            )}
            {isRequester && !archief && p.status === 'concept' && (
              <button onClick={() => act({ action: 'submit' })} disabled={busy !== null} className="btn-primary text-sm">Indienen ter goedkeuring</button>
            )}
            {!archief && r.bewerken && (
              <button onClick={() => setBewerk(true)} disabled={busy !== null} className="btn-secondary text-sm" title={bevestigd ? 'Al bevestigd: een wijziging maakt een nieuwe versie en een nieuw bewijsdocument aan' : 'Aanvraag aanpassen'}><Pencil className="h-4 w-4" />Aanpassen</button>
            )}
            {!archief && !r.bewerken && r.blokkade && <span className="text-[11px] text-gray-400 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{r.blokkade}</span>}
            {archief && r.herstellen && (
              <button onClick={herstel} disabled={busy !== null} className="btn-secondary text-sm">{busy === 'herstel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}Herstellen</button>
            )}
            {/* Verwijderen staat bewust apart, rechts, ver van de gewone acties. */}
            {!archief && r.verwijderen && (
              <button onClick={() => setVerwijderVenster(true)} disabled={busy !== null} className="ml-auto text-xs text-red-500 hover:text-red-700 inline-flex items-center gap-1 pl-6"><Trash2 className="h-3 w-3" />Verwijderen</button>
            )}
          </div>
        </div>
      )}
      {busy && busy !== 'del' && <div className="mt-2"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>}

      {bewerk && (
        <PurchaseForm
          purchase={{ id: p.id, reference: p.reference ?? null, version: p.version ?? 1, status: p.status, title: p.title, description: p.description, amount_excl: Number(p.amount_excl), vat_pct: Number(p.vat_pct), supplier: p.supplier, category: p.category, entry_date: p.entry_date }}
          onClose={() => setBewerk(false)} />
      )}

      {verwijderVenster && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><Trash2 className="h-4 w-4 text-red-500" />Aanvraag verwijderen</h3>
            <p className="text-sm text-gray-700">Weet je zeker dat je aanvraag <b>{nummer}</b> wilt verwijderen? Deze actie verwijdert de aanvraag uit het actieve overzicht.</p>
            <p className="text-xs text-gray-500">{p.title}{p.supplier ? ` · ${p.supplier}` : ''} · {formatEuro(incl)} incl. btw. De aanvraag blijft in het archief, met geschiedenis en documenten.</p>
            {bevestigd && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Deze aanvraag is bevestigd en heeft een bewijsdocument. Dat document blijft bewaard in het archief.</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setVerwijderVenster(false)} disabled={busy === 'del'} className="btn-secondary text-sm">Annuleren</button>
              <button type="button" onClick={del} disabled={busy === 'del'} className="btn-danger text-sm">{busy === 'del' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Aanvraag verwijderen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
