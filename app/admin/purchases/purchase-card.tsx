'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Loader2, Paperclip, Plus, Clock, Trash2 } from 'lucide-react'
import { formatEuro, formatDate } from '@/lib/utils'
import { FOUNDER_EMAILS, founderName } from '@/lib/founders'

export type Approval = { id: string; approver_email: string; decision: string; comment: string | null; decided_at: string }
export type Purchase = {
  id: string; title: string; description: string | null; amount_excl: number; vat_pct: number
  supplier: string | null; category: string | null; requester_email: string | null; entry_date: string
  status: string; needs_approval: boolean; cost_entry_id: string | null; attachment_path: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  concept: { label: 'Concept', cls: 'bg-gray-100 text-gray-600' },
  pending: { label: 'Wacht op goedkeuring', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Goedgekeurd', cls: 'bg-green-100 text-green-700' },
  approved_under_threshold: { label: 'Goedgekeurd (onder drempel)', cls: 'bg-green-100 text-green-700' },
  rejected: { label: 'Afgekeurd', cls: 'bg-red-100 text-red-700' },
}

export function PurchaseCard({ purchase: p, approvals, currentEmail, attachmentUrl }: {
  purchase: Purchase; approvals: Approval[]; currentEmail: string; attachmentUrl: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [comment, setComment] = useState('')

  const incl = Number(p.amount_excl) * (1 + Number(p.vat_pct) / 100)
  const me = currentEmail.toLowerCase()
  const required = FOUNDER_EMAILS.filter(e => e.toLowerCase() !== (p.requester_email ?? '').toLowerCase())
  const byEmail = new Map(approvals.map(a => [a.approver_email.toLowerCase(), a]))
  const myDecision = byEmail.get(me)
  const isRequiredApprover = required.map(e => e.toLowerCase()).includes(me)
  const isRequester = (p.requester_email ?? '').toLowerCase() === me
  const st = STATUS[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-600' }

  const act = async (body: object) => {
    setBusy('x')
    try {
      const res = await fetch('/api/admin/purchases', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purchase_id: p.id, ...body }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setComment(''); router.refresh()
    } catch (e) { alert(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }
  const del = async () => {
    if (!confirm('Aanvraag verwijderen?')) return
    setBusy('x')
    try { const res = await fetch(`/api/admin/purchases?id=${p.id}`, { method: 'DELETE' }); if (res.ok) router.refresh() } finally { setBusy(null) }
  }

  const canDecide = p.status === 'pending' && isRequiredApprover && !myDecision
  const canAddCost = ['approved', 'approved_under_threshold'].includes(p.status) && !p.cost_entry_id

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium flex items-center gap-2 flex-wrap">
            {p.title}
            <span className={`status-badge text-xs ${st.cls}`}>{st.label}</span>
            {p.cost_entry_id && <span className="status-badge text-xs bg-blue-100 text-blue-700">In kosten</span>}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {formatDate(p.entry_date)} · {founderName(p.requester_email)}{p.supplier ? ` · ${p.supplier}` : ''}{p.category ? ` · ${p.category}` : ''}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold">{formatEuro(incl)}</div>
          <div className="text-[11px] text-gray-400">{formatEuro(Number(p.amount_excl))} excl. · {Number(p.vat_pct)}% btw</div>
        </div>
      </div>

      {p.description && <p className="text-sm text-gray-600 mb-2">{p.description}</p>}
      {attachmentUrl && <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mb-2"><Paperclip className="h-3 w-3" />Bijlage</a>}

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
      {(canDecide || canAddCost || (isRequester && (p.status === 'concept' || p.status === 'pending'))) && (
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
          {canAddCost && (
            <button onClick={() => act({ action: 'add_cost' })} disabled={busy !== null} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Toevoegen als kost</button>
          )}
          {isRequester && p.status === 'concept' && (
            <button onClick={() => act({ action: 'submit' })} disabled={busy !== null} className="btn-primary text-sm">Indienen ter goedkeuring</button>
          )}
          {isRequester && (p.status === 'concept' || p.status === 'pending') && (
            <button onClick={del} disabled={busy !== null} className="text-xs text-red-500 hover:text-red-700 inline-flex items-center gap-1"><Trash2 className="h-3 w-3" />Verwijderen</button>
          )}
        </div>
      )}
      {busy && <div className="mt-2"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>}
    </div>
  )
}
