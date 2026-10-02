'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Check, Ban, Plus, Wallet, Clock, Pencil, Trash2 } from 'lucide-react'
import { formatEuro, formatDate } from '@/lib/utils'
import { readJson, fileTooBig, MAX_UPLOAD_MB } from '@/lib/upload'
import { Dialoog, Bevestig, INP } from '@/app/admin/instellingen/ui'
import { GetalInvoer } from '@/components/ui/getal-invoer'

export type Payment = {
  id: string
  direction: string
  amount: number
  paid_on: string
  note: string | null
  status: string
  created_by_role: string | null
  created_at: string
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'In afwachting', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Goedgekeurd', cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Geannuleerd', cls: 'bg-gray-100 text-gray-600' },
}

type Vraag =
  | { soort: 'annuleer'; p: Payment }
  | { soort: 'verwijder'; p: Payment }

export function PartnerPayments({ partnerId, payments }: { partnerId: string; payments: Payment[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ direction: 'we_pay_partner', amount: null as number | null, paid_on: today, note: '' })
  const [proof, setProof] = useState<File | null>(null)
  const [bewerk, setBewerk] = useState<Payment | null>(null)
  const [bewerkForm, setBewerkForm] = useState({ amount: null as number | null, paid_on: today, note: '' })
  const [vraag, setVraag] = useState<Vraag | null>(null)

  const register = async () => {
    if (!form.amount || form.amount <= 0) { setError('Geef een geldig bedrag'); return }
    if (fileTooBig(proof)) { setError(`Bewijs te groot — max ${MAX_UPLOAD_MB} MB.`); return }
    setBusy('new'); setError(null)
    try {
      const fd = new FormData()
      fd.append('direction', form.direction); fd.append('amount', String(form.amount))
      fd.append('paid_on', form.paid_on); fd.append('note', form.note)
      if (proof) fd.append('proof', proof)
      const res = await fetch(`/api/admin/partners/${partnerId}/payments`, { method: 'POST', body: fd })
      await readJson(res)
      setOpen(false); setForm({ direction: 'we_pay_partner', amount: null, paid_on: today, note: '' }); setProof(null)
      toast.success('Betaling geregistreerd.')
      router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }

  const patch = async (payment_id: string, body: Record<string, unknown>, ok: string) => {
    setBusy(payment_id)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/payments`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id, ...body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Bijwerken mislukt')
      toast.success(ok)
      router.refresh()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bijwerken mislukt')
      return false
    } finally { setBusy(null) }
  }

  const setStatus = (payment_id: string, status: 'approved' | 'cancelled') =>
    patch(payment_id, { status }, status === 'approved' ? 'Betaling goedgekeurd.' : 'Betaling geannuleerd.')

  const openBewerk = (p: Payment) => {
    setBewerkForm({ amount: Math.abs(Number(p.amount)), paid_on: p.paid_on?.slice(0, 10) ?? today, note: p.note ?? '' })
    setBewerk(p)
  }

  const bewaarBewerk = async () => {
    if (!bewerk) return
    if (!bewerkForm.amount || bewerkForm.amount <= 0) { toast.error('Geef een geldig bedrag'); return }
    const ok = await patch(bewerk.id, { amount: bewerkForm.amount, paid_on: bewerkForm.paid_on, note: bewerkForm.note }, 'Betaling bijgewerkt.')
    if (ok) setBewerk(null)
  }

  const verwijder = async (p: Payment) => {
    setBusy(p.id)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/payments?payment_id=${p.id}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Verwijderen mislukt')
      toast.success('Betaling verwijderd.')
      setVraag(null)
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBusy(null) }
  }

  const pending = payments.filter((p) => p.status === 'pending')
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="card-base">
      <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Wallet className="h-4 w-4 text-[#c5b800]" />Betalingen</h2>
          <p className="text-xs text-gray-500 mt-0.5">Goedgekeurde betalingen vereffenen het saldo. Een goedgekeurde betaling annuleer je eerst voor je ze kunt verwijderen.</p>
        </div>
        <button onClick={() => { setError(null); setOpen(true) }} className="btn-primary text-sm"><Plus className="h-4 w-4" />Betaling registreren</button>
      </div>

      {pending.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />{pending.length} betaling{pending.length === 1 ? '' : 'en'} in afwachting van goedkeuring
        </div>
      )}

      {payments.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">Nog geen betalingen geregistreerd.</p>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => {
            const wePay = p.direction === 'we_pay_partner'
            const st = STATUS[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-600' }
            const magWeg = p.status !== 'approved'
            return (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    <span className={wePay ? 'text-green-600' : 'text-red-600'}>{wePay ? 'Wij betalen partner' : 'Partner betaalt ons'}</span>
                    {' · '}{formatEuro(Math.abs(p.amount))}
                  </div>
                  <div className="text-xs text-gray-400 break-words">{formatDate(p.paid_on)} · {p.created_by_role === 'partner' ? 'door partner' : 'door admin'}{p.note ? ` · ${p.note}` : ''}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`status-badge text-xs ${st.cls}`}>{st.label}</span>
                  {p.status === 'pending' && (
                    <>
                      <button onClick={() => setStatus(p.id, 'approved')} disabled={busy === p.id} className="btn-secondary text-xs" title="Goedkeuren">
                        {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Goedkeuren
                      </button>
                      <button onClick={() => setStatus(p.id, 'cancelled')} disabled={busy === p.id} className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50" title="Afkeuren">
                        <Ban className="h-3.5 w-3.5" />Afkeuren
                      </button>
                    </>
                  )}
                  {p.status === 'approved' && (
                    <button onClick={() => setVraag({ soort: 'annuleer', p })} disabled={busy === p.id}
                      className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100" title="Annuleren">
                      <Ban className="h-3.5 w-3.5" />Annuleren
                    </button>
                  )}
                  <button onClick={() => openBewerk(p)} disabled={busy === p.id}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Bewerken" aria-label="Bewerken">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => magWeg
                      ? setVraag({ soort: 'verwijder', p })
                      : toast.info('Een goedgekeurde betaling telt mee in het saldo. Annuleer ze eerst; daarna kun je ze verwijderen.', { duration: 8000 })}
                    disabled={busy === p.id}
                    className={`h-7 w-7 inline-flex items-center justify-center rounded-lg ${magWeg ? 'text-red-500 hover:bg-red-50' : 'text-gray-300 hover:bg-gray-100'}`}
                    title={magWeg ? 'Verwijderen' : 'Annuleer eerst om te verwijderen'} aria-label="Verwijderen">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {open && (
        <Dialoog titel="Betaling registreren" onSluit={() => busy !== 'new' && setOpen(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              {([['we_pay_partner', 'Wij betalen partner'], ['partner_pays_us', 'Partner betaalt ons']] as const).map(([val, label]) => (
                <button key={val} type="button" onClick={() => setForm((f) => ({ ...f, direction: val }))}
                  className={`text-left rounded-lg border p-3 text-sm transition-colors ${form.direction === val ? 'border-[#fff848] bg-[#fff848]/10 ring-1 ring-[#fff848]' : 'border-gray-200 hover:border-gray-300'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div>
              <label className={lbl}>Bedrag (€)</label>
              <GetalInvoer className={INP} waarde={form.amount} min={0} placeholder="500"
                onWaarde={(n) => setForm((f) => ({ ...f, amount: n }))} />
            </div>
            <div>
              <label className={lbl}>Datum</label>
              <input type="date" className={INP} value={form.paid_on} onChange={(e) => setForm((f) => ({ ...f, paid_on: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Opmerking (optioneel)</label>
              <textarea rows={2} className={INP} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Bewijs (optioneel)</label>
              <input type="file" className="text-xs max-w-full" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
            </div>
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex gap-2 pt-1 flex-wrap">
              <button onClick={register} disabled={busy === 'new'} className="btn-primary flex-1 justify-center">{busy === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Registreren (goedgekeurd)</button>
              <button onClick={() => setOpen(false)} className="btn-secondary">Annuleer</button>
            </div>
          </div>
        </Dialoog>
      )}

      {bewerk && (
        <Dialoog titel="Betaling bewerken" onSluit={() => busy !== bewerk.id && setBewerk(null)}>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              {bewerk.direction === 'we_pay_partner' ? 'Wij betalen partner' : 'Partner betaalt ons'} · {STATUS[bewerk.status]?.label ?? bewerk.status}
              {bewerk.status === 'approved' && ' — een ander bedrag verandert meteen het openstaande saldo.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Bedrag (€)</label>
                <GetalInvoer className={INP} waarde={bewerkForm.amount} min={0}
                  onWaarde={(n) => setBewerkForm((f) => ({ ...f, amount: n }))} />
              </div>
              <div>
                <label className={lbl}>Datum</label>
                <input type="date" className={INP} value={bewerkForm.paid_on} onChange={(e) => setBewerkForm((f) => ({ ...f, paid_on: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className={lbl}>Opmerking</label>
              <textarea rows={2} className={INP} value={bewerkForm.note} onChange={(e) => setBewerkForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setBewerk(null)} disabled={busy === bewerk.id} className="btn-secondary">Annuleren</button>
              <button onClick={bewaarBewerk} disabled={busy === bewerk.id} className="btn-primary">
                {busy === bewerk.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Opslaan
              </button>
            </div>
          </div>
        </Dialoog>
      )}

      {vraag?.soort === 'annuleer' && (
        <Bevestig
          titel="Betaling annuleren?"
          tekst={<>Deze goedgekeurde betaling van <b>{formatEuro(Math.abs(vraag.p.amount))}</b> telt daarna niet meer mee in het saldo.</>}
          bevestigLabel="Annuleren"
          bezig={busy === vraag.p.id}
          onBevestig={async () => { if (await setStatus(vraag.p.id, 'cancelled')) setVraag(null) }}
          onAnnuleer={() => setVraag(null)}
        />
      )}
      {vraag?.soort === 'verwijder' && (
        <Bevestig
          titel="Betaling verwijderen?"
          tekst={<>De betaling van <b>{formatEuro(Math.abs(vraag.p.amount))}</b> op {formatDate(vraag.p.paid_on)} ({STATUS[vraag.p.status]?.label.toLowerCase() ?? vraag.p.status}) verdwijnt definitief, samen met het bewijs.</>}
          bevestigLabel="Verwijderen"
          gevaarlijk
          bezig={busy === vraag.p.id}
          onBevestig={() => verwijder(vraag.p)}
          onAnnuleer={() => setVraag(null)}
        />
      )}
    </div>
  )
}
