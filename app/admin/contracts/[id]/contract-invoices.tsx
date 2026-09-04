'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Receipt, Loader2, Plus, Link2, Unlink, Save } from 'lucide-react'
import { toast } from 'sonner'
import { formatEuro } from '@/lib/utils'
import { normalizeInvoiceStatus, INVOICE_STATUS_LABEL, INVOICE_STATUS_CLS } from '@/lib/invoices'

type Inv = { id: string; description: string | null; invoice_month: string; amount_excl: number; amount_incl: number; status: string; contract_id: string | null; client_id: string | null }

const FREQUENCIES = [
  { value: '', label: '—' },
  { value: 'eenmalig', label: 'Eenmalig' },
  { value: 'maandelijks', label: 'Maandelijks' },
  { value: 'kwartaal', label: 'Per kwartaal' },
  { value: 'aangepast', label: 'Aangepast' },
]

export function ContractInvoices({
  contractId, clientId, serviceSlug, contractTitle,
  expectedCount, invoiceFrequency, expectedAmountExcl,
}: {
  contractId: string
  clientId: string | null
  serviceSlug: string | null
  contractTitle: string
  expectedCount: number | null
  invoiceFrequency: string | null
  expectedAmountExcl: number | null
}) {
  const router = useRouter()
  const [linked, setLinked] = useState<Inv[]>([])
  const [candidates, setCandidates] = useState<Inv[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Facturatie-instellingen
  const [expCount, setExpCount] = useState(expectedCount != null ? String(expectedCount) : '')
  const [freq, setFreq] = useState(invoiceFrequency ?? '')
  const [expAmount, setExpAmount] = useState(expectedAmountExcl != null ? String(expectedAmountExcl) : '')
  const [savingSettings, setSavingSettings] = useState(false)

  const [linkId, setLinkId] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/contracts/${contractId}/invoices`, { cache: 'no-store' })
      const j = await res.json()
      setLinked(j.linked ?? []); setCandidates(j.candidates ?? [])
    } catch { /* */ } finally { setLoading(false) }
  }, [contractId])
  useEffect(() => { load() }, [load])

  const expected = expCount ? parseInt(expCount, 10) || 0 : 0
  const sentCount = linked.filter((i) => normalizeInvoiceStatus(i.status) === 'verstuurd').length
  const totalExcl = linked.filter((i) => normalizeInvoiceStatus(i.status) !== 'geannuleerd').reduce((s, i) => s + Number(i.amount_excl || 0), 0)
  const totalIncl = linked.filter((i) => normalizeInvoiceStatus(i.status) !== 'geannuleerd').reduce((s, i) => s + Number(i.amount_incl || 0), 0)
  const pct = expected > 0 ? Math.min(100, Math.round((sentCount / expected) * 100)) : (linked.length > 0 ? 100 : 0)

  const saveSettings = async () => {
    setSavingSettings(true)
    try {
      const res = await fetch(`/api/admin/contracts/${contractId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invoice_settings', expected_invoice_count: expCount || null, invoice_frequency: freq || null, expected_invoice_amount_excl: expAmount || null }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Facturatie-instellingen opgeslagen'); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setSavingSettings(false) }
  }

  const linkExisting = async () => {
    if (!linkId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/contracts/${contractId}/invoices`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: linkId }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setLinkId(''); toast.success('Factuur gekoppeld'); await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBusy(false) }
  }

  const unlink = async (invId: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/contracts/${contractId}/invoices?invoice_id=${invId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Ontkoppeld'); await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBusy(false) }
  }

  return (
    <div className="card-base space-y-4">
      <h2 className="font-semibold text-sm flex items-center gap-2"><Receipt className="h-4 w-4 text-gray-400" />Facturen gekoppeld aan dit contract</h2>

      {/* Facturatie-instellingen */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Verwacht aantal</label>
          <input type="number" min="0" className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={expCount} onChange={(e) => setExpCount(e.target.value)} placeholder="6" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Frequentie</label>
          <select className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={freq} onChange={(e) => setFreq(e.target.value)}>
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">€ excl./factuur</label>
          <input type="number" min="0" step="0.01" className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder="750" />
        </div>
      </div>
      <button onClick={saveSettings} disabled={savingSettings} className="btn-secondary text-xs">{savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Instellingen opslaan</button>

      {/* Voortgang */}
      <div>
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-gray-600">{sentCount}{expected > 0 ? ` van ${expected}` : ''} facturen verstuurd</span>
          <span className="font-semibold">{pct}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#fff848] rounded-full" style={{ width: `${pct}%` }} /></div>
        <div className="text-[11px] text-gray-400 mt-1">{linked.length} gekoppeld · totaal {formatEuro(totalExcl)} excl. · {formatEuro(totalIncl)} incl.</div>
      </div>

      {/* Gekoppelde facturen */}
      {loading ? (
        <div className="text-center py-3 text-gray-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
      ) : linked.length > 0 ? (
        <div className="space-y-1.5">
          {linked.map((i) => {
            const st = normalizeInvoiceStatus(i.status)
            return (
              <div key={i.id} className="flex items-center justify-between gap-2 text-sm py-1.5 px-2 rounded-lg border border-gray-100">
                <div className="min-w-0">
                  <div className="truncate">{i.description || 'Factuur'} <span className="text-gray-400 text-xs">· {i.invoice_month}</span></div>
                  <div className="text-xs text-gray-400">{formatEuro(i.amount_incl)} incl.</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`status-badge ${INVOICE_STATUS_CLS[st]}`}>{INVOICE_STATUS_LABEL[st]}</span>
                  <button onClick={() => unlink(i.id)} disabled={busy} title="Ontkoppelen" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400"><Unlink className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-400">Nog geen facturen gekoppeld.</p>
      )}

      {/* Koppelen / aanmaken */}
      <div className="flex flex-wrap gap-2 items-end pt-1 border-t border-gray-100">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[11px] text-gray-500 mb-1">Bestaande factuur koppelen</label>
          <select className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
            <option value="">{candidates.length ? '— Kies factuur —' : 'Geen koppelbare facturen'}</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{(c.description || 'Factuur')} · {c.invoice_month} · {formatEuro(c.amount_incl)}</option>)}
          </select>
        </div>
        <button onClick={linkExisting} disabled={busy || !linkId} className="btn-secondary text-xs"><Link2 className="h-3.5 w-3.5" />Koppelen</button>
        <button onClick={() => setShowCreate((v) => !v)} className="btn-primary text-xs"><Plus className="h-3.5 w-3.5" />Nieuwe factuur</button>
      </div>

      {showCreate && (
        <CreateInvoice
          contractId={contractId} clientId={clientId} serviceSlug={serviceSlug} contractTitle={contractTitle}
          defaultAmount={expAmount}
          onDone={() => { setShowCreate(false); load() }}
        />
      )}
    </div>
  )
}

function CreateInvoice({ contractId, clientId, serviceSlug, contractTitle, defaultAmount, onDone }: {
  contractId: string; clientId: string | null; serviceSlug: string | null; contractTitle: string; defaultAmount: string; onDone: () => void
}) {
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [amount, setAmount] = useState(defaultAmount || '')
  const [description, setDescription] = useState(contractTitle)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!amount) { toast.error('Bedrag vereist'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'one_time', client_id: clientId, service_slug: serviceSlug, invoice_month: month, amount_excl: Number(amount), description, contract_id: contractId }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Factuur aangemaakt vanuit contract'); onDone()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setSaving(false) }
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-2 bg-gray-50">
      <div className="grid grid-cols-3 gap-2">
        <div><label className="block text-[11px] text-gray-500 mb-1">Maand</label><input type="month" className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        <div><label className="block text-[11px] text-gray-500 mb-1">€ excl.</label><input type="number" min="0" step="0.01" className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label className="block text-[11px] text-gray-500 mb-1">Omschrijving</label><input className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>
      <button onClick={submit} disabled={saving} className="btn-primary text-xs">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Aanmaken + koppelen</button>
    </div>
  )
}
