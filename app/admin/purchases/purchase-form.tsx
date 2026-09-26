'use client'

import { leesGetal } from '@/lib/getal'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2, Pencil, AlertTriangle, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { readJson, fileTooBig, MAX_UPLOAD_MB } from '@/lib/upload'

const euro = (n: number) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const euro2 = (n: number) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const CATEGORIES = ['Hardware', 'Software', 'Marketing', 'Materiaal', 'Reiskosten', 'Overige']
const THRESHOLD = 1000

/** De velden die bij het aanpassen vooringevuld en gewijzigd kunnen worden. */
export type BewerkbareAanvraag = {
  id: string; reference: string | null; version: number; status: string
  title: string; description: string | null; amount_excl: number; vat_pct: number
  supplier: string | null; category: string | null; entry_date: string
}
const BEVESTIGD = ['approved', 'approved_under_threshold']
const LABEL: Record<string, string> = { title: 'Titel', description: 'Omschrijving', amount_excl: 'Bedrag excl. btw', vat_pct: 'Btw %', supplier: 'Leverancier', category: 'Categorie', entry_date: 'Datum' }

/**
 * Hetzelfde formulier voor aanmaken én aanpassen. Zonder `purchase` gedraagt
 * het zich exact zoals vroeger (knop "Aankoop aanvragen" + dialoog). Mét
 * `purchase` opent het meteen, vooringevuld, en toont vóór het opslaan een
 * overzicht van de wijzigingen; opslaan gebeurt pas na "Wijzigingen opslaan".
 */
export function PurchaseForm({ purchase, onClose }: { purchase?: BewerkbareAanvraag; onClose?: () => void } = {}) {
  const router = useRouter()
  const bewerken = !!purchase
  const [open, setOpen] = useState(bewerken)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const leeg = { title: '', description: '', amount_excl: '', vat_pct: '21', supplier: '', category: 'Hardware', entry_date: today }
  const start = purchase ? {
    title: purchase.title ?? '', description: purchase.description ?? '', amount_excl: String(Number(purchase.amount_excl)), vat_pct: String(Number(purchase.vat_pct)),
    supplier: purchase.supplier ?? '', category: purchase.category ?? 'Hardware', entry_date: (purchase.entry_date ?? today).slice(0, 10),
  } : leeg
  const [form, setForm] = useState(start)
  const [file, setFile] = useState<File | null>(null)
  const [overzicht, setOverzicht] = useState(false)
  const [opmerking, setOpmerking] = useState('')

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'
  const excl = leesGetal(form.amount_excl) ?? 0
  const incl = excl * (1 + (leesGetal(form.vat_pct) ?? 0) / 100)
  const needsApproval = incl > THRESHOLD
  const wasBevestigd = !!purchase && BEVESTIGD.includes(purchase.status)

  const sluit = () => { setOpen(false); setOverzicht(false); onClose?.() }

  // ── Aanmaken (ongewijzigd gedrag) ──
  const submit = async (concept: boolean, e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Titel is verplicht'); return }
    if (excl <= 0) { setError('Bedrag is verplicht'); return }
    if (fileTooBig(file)) { setError(`Bijlage te groot — max ${MAX_UPLOAD_MB} MB.`); return }
    setLoading(true); setError(null)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      fd.append('concept', String(concept))
      if (file) fd.append('attachment', file)
      const res = await fetch('/api/admin/purchases', { method: 'POST', body: fd })
      await readJson(res)
      setOpen(false)
      setForm(leeg); setFile(null)
      router.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Fout') } finally { setLoading(false) }
  }

  // ── Aanpassen: eerst het overzicht, dan pas opslaan ──
  const wijzigingen = purchase ? (Object.keys(LABEL) as (keyof typeof form)[]).map((k) => {
    const was = k === 'amount_excl' || k === 'vat_pct' ? String(Number(start[k])) : (start[k] ?? '')
    const wordt = k === 'amount_excl' || k === 'vat_pct' ? String(Number(form[k]) || 0) : (form[k] ?? '')
    return was !== wordt ? { veld: k, was, wordt } : null
  }).filter((x): x is { veld: keyof typeof form; was: string; wordt: string } => x !== null) : []

  const naarOverzicht = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Titel is verplicht'); return }
    if (excl <= 0) { setError('Bedrag is verplicht'); return }
    const btw = leesGetal(form.vat_pct) ?? NaN
    if (!Number.isFinite(btw) || btw < 0 || btw > 100) { setError('Btw % moet tussen 0 en 100 liggen'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.entry_date)) { setError('Datum is verplicht'); return }
    if (wijzigingen.length === 0) { setError('Er is niets gewijzigd.'); return }
    setError(null); setOverzicht(true)
  }
  const bewaar = async () => {
    if (!purchase) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/admin/purchases/${purchase.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, opmerking }) })
      const j = await readJson(res)
      toast.success('De aanvraag werd succesvol aangepast.')
      if (j.goedkeuringenVervallen) toast.info('De eerder gegeven goedkeuringen zijn vervallen; de aanvraag wacht opnieuw op goedkeuring.')
      if (j.certificaat && typeof j.certificaat === 'object') toast.info(`Nieuw bewijsdocument aangemaakt (${(j.certificaat as { certificate_no: string }).certificate_no}).`)
      sluit(); router.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Fout'); setOverzicht(false) } finally { setLoading(false) }
  }
  const toon = (veld: string, v: string) => (veld === 'amount_excl' ? euro2(Number(v) || 0) : veld === 'vat_pct' ? `${v} %` : (v || '—'))

  if (!open) return <button onClick={() => setOpen(true)} className="btn-primary"><Plus className="h-4 w-4" />Aankoop aanvragen</button>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="font-semibold flex items-center gap-2">{bewerken ? <><Pencil className="h-4 w-4 text-gray-400" />Aanvraag aanpassen{purchase?.reference ? <span className="text-xs font-normal text-gray-400">{purchase.reference} · versie {purchase.version}</span> : null}</> : 'Aankoopaanvraag'}</h3>
          <button onClick={sluit} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        {bewerken && overzicht ? (
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-700">Controleer de wijzigingen vóór je opslaat.</p>
            {wasBevestigd && (
              <div className="text-sm rounded-lg px-3 py-2.5 border bg-amber-50 border-amber-200 text-amber-900 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Deze aanvraag is al bevestigd. Een wijziging maakt een nieuwe versie en een nieuw bewijsdocument aan. Het huidige bewijsdocument blijft bewaard als vervangen.{needsApproval ? ' De aanvraag moet opnieuw goedgekeurd worden door de twee andere zaakvoerders.' : ''}</span>
              </div>
            )}
            {!wasBevestigd && purchase?.status === 'pending' && wijzigingen.some((w) => ['title', 'amount_excl', 'vat_pct', 'supplier'].includes(w.veld)) && (
              <div className="text-sm rounded-lg px-3 py-2.5 border bg-amber-50 border-amber-200 text-amber-900">Eerder gegeven goedkeuringen vervallen door deze wijziging; de zaakvoerders moeten opnieuw goedkeuren.</div>
            )}
            <div className="table-wrap"><table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-500"><th className="py-1.5">Veld</th><th className="py-1.5">Was</th><th className="py-1.5">Wordt</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {wijzigingen.map((w) => (
                  <tr key={w.veld}><td className="py-1.5 font-medium">{LABEL[w.veld]}</td><td className="py-1.5 text-gray-500 line-through">{toon(w.veld, w.was)}</td><td className="py-1.5 font-semibold">{toon(w.veld, w.wordt)}</td></tr>
                ))}
              </tbody>
            </table></div>
            <div className={`text-sm rounded-lg px-3 py-2.5 border ${needsApproval ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
              Nieuw totaal incl. btw: <span className="font-semibold">{euro2(incl)}</span> · {needsApproval ? <span className="text-amber-700">boven €{THRESHOLD} → goedkeuring nodig</span> : <span className="text-green-700">onder €{THRESHOLD} → geen goedkeuring vereist</span>}
            </div>
            <div><label className={lbl}>Interne opmerking (optioneel, komt in de geschiedenis)</label><input className={inp} value={opmerking} onChange={(e) => setOpmerking(e.target.value)} placeholder="bv. offerte aangepast door leverancier" /></div>
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={bewaar} disabled={loading} className="btn-primary flex-1">{loading && <Loader2 className="h-4 w-4 animate-spin" />}Wijzigingen opslaan</button>
              <button type="button" onClick={() => setOverzicht(false)} disabled={loading} className="btn-secondary"><ArrowLeft className="h-4 w-4" />Terug</button>
              <button type="button" onClick={sluit} disabled={loading} className="btn-secondary">Annuleren</button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => (bewerken ? naarOverzicht(e) : submit(false, e))} className="p-5 space-y-4">
            {bewerken && wasBevestigd && (
              <div className="text-sm rounded-lg px-3 py-2.5 border bg-amber-50 border-amber-200 text-amber-900 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Deze aanvraag is al bevestigd. Een wijziging maakt een nieuwe versie en een nieuw bewijsdocument aan.</span>
              </div>
            )}
            <div><label className={lbl}>Titel *</label><input required className={inp} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="bv. MacBook Pro" /></div>
            <div><label className={lbl}>Omschrijving</label><textarea rows={2} className={inp} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Bedrag excl. btw (€) *</label><input required type="text" inputMode="decimal" className={inp} value={form.amount_excl} onChange={e => setForm(p => ({ ...p, amount_excl: e.target.value }))} placeholder="2300" /></div>
              <div><label className={lbl}>BTW %</label><input type="text" inputMode="decimal" className={inp} value={form.vat_pct} onChange={e => setForm(p => ({ ...p, vat_pct: e.target.value }))} /></div>
              <div><label className={lbl}>Leverancier</label><input className={inp} value={form.supplier} onChange={e => setForm(p => ({ ...p, supplier: e.target.value }))} /></div>
              <div><label className={lbl}>Categorie</label><select className={inp} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              <div><label className={lbl}>Datum</label><input type="date" className={inp} value={form.entry_date} onChange={e => setForm(p => ({ ...p, entry_date: e.target.value }))} /></div>
              {!bewerken && <div><label className={lbl}>Bijlage (optioneel)</label><input type="file" className="text-xs w-full" onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>}
            </div>

            {excl > 0 && (
              <div className={`text-sm rounded-lg px-3 py-2.5 border ${needsApproval ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                Incl. btw: <span className="font-semibold">{euro(incl)}</span> ·{' '}
                {needsApproval ? <span className="text-amber-700">boven €{THRESHOLD} → goedkeuring door de twee andere zaakvoerders nodig</span>
                  : <span className="text-green-700">onder €{THRESHOLD} → geen goedkeuring vereist</span>}
              </div>
            )}

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
            {bewerken ? (
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={loading} className="btn-primary flex-1">Wijzigingen bekijken</button>
                <button type="button" onClick={sluit} disabled={loading} className="btn-secondary">Annuleren</button>
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={loading} className="btn-primary flex-1">{loading && <Loader2 className="h-4 w-4 animate-spin" />}{needsApproval ? 'Indienen ter goedkeuring' : 'Registreren'}</button>
                <button type="button" onClick={(e) => submit(true, e)} disabled={loading} className="btn-secondary">Opslaan als concept</button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
