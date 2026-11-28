'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowDownLeft, ArrowUpRight, Check, ExternalLink, Loader2, Mail, RotateCcw, Trash2, X } from 'lucide-react'
import { deadlineTekst } from '@/lib/sales/lead-taken'
import { FILTERS, type MailTaakFilter } from '@/lib/mail-opvolging/taken'
import type { MailTaak } from '@/lib/mail-opvolging/taken-server'
import { MERK_STIJL } from '@/lib/merk-mail'

type Lid = { id: number; naam: string; email: string }
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const voornaam = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0] || '—'
const dagKort = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/mail-taken', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j
}

/**
 * Taken uit de mail: wat we beloofden of wat de klant vroeg. Per voorstel:
 * Zet taak (wordt een ClickUp-taak) of Verwijder. Wat al in ClickUp staat of
 * daar afgesloten is, verschuift vanzelf naar Nog te doen of Gedaan.
 */
export function MailTaken({ leden, ik, onIngepland }: { leden: Lid[]; ik: number | null; onIngepland: () => void }) {
  const [taken, setTaken] = useState<MailTaak[] | null>(null)
  const [filter, setFilter] = useState<MailTaakFilter>('beslissen')
  const [open, setOpen] = useState<string | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [meer, setMeer] = useState(false)

  const laad = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/mail-taken', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) setTaken(j.taken ?? [])
    } catch { setTaken([]) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const tel = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, (taken ?? []).filter((t) => t.filter === f.key).length])) as Record<MailTaakFilter, number>, [taken])
  const lijst = useMemo(() => (taken ?? []).filter((t) => t.filter === filter), [taken, filter])

  const actie = async (t: MailTaak, soort: 'verwijder' | 'terug') => {
    setBezig(t.id)
    try { await post({ actie: soort, id: t.id }); await laad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  if (taken === null || !taken.length) return null
  const chip = (aan: boolean) => `text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${aan ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`
  const vd = vandaag()

  return (
    <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Mail className="h-4 w-4 text-blue-700" />
        <h3 className="text-sm font-semibold text-gray-900">Uit de mail</h3>
        <span className="text-[11px] text-gray-500">wat we beloofden of wat de klant vroeg</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
        {FILTERS.map((f) => <button key={f.key} type="button" onClick={() => { setFilter(f.key); setMeer(false) }} className={chip(filter === f.key)}>{f.label}{tel[f.key] ? ` (${tel[f.key]})` : ''}</button>)}
      </div>
      {lijst.length === 0 ? (
        <p className="text-sm text-gray-400 py-1">{filter === 'beslissen' ? 'Niets te beslissen.' : 'Niets hier.'}</p>
      ) : (
        <ul className="divide-y divide-blue-100/80">
          {lijst.slice(0, meer ? 60 : 6).map((t) => {
            const dl = t.deadline ? deadlineTekst(t.deadline, vd) : null
            const Pijl = t.mail?.richting === 'uit' ? ArrowUpRight : ArrowDownLeft
            return (
              <li key={t.id} className="py-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 leading-snug">{t.wat}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                      {t.klant && (t.opdracht_id ? <Link href={`/admin/opdrachten?opdracht=${t.opdracht_id}`} className="font-medium text-gray-700 hover:text-black underline decoration-gray-300">{t.klant}</Link> : <span className="font-medium text-gray-700">{t.klant}</span>)}
                      {t.mail && <span className="inline-flex items-center gap-0.5"><Pijl className="h-3 w-3" />{t.wie === 'wij' ? 'beloofd' : 'gevraagd'} op {dagKort(t.mail.op)}</span>}
                      {dl && <span className={dl.telaat ? 'text-red-700 font-medium' : dl.vandaag ? 'text-amber-700 font-medium' : ''}>· {dl.tekst}</span>}
                      {t.toegewezen && <span>· {voornaam(t.toegewezen)}</span>}
                    </p>
                    {t.citaat && <p className="text-[11px] text-gray-500 italic mt-0.5 line-clamp-2">“{t.citaat}”</p>}
                    {t.reden && t.filter !== 'beslissen' && <p className="text-[11px] text-gray-600 mt-0.5">{t.reden}{t.clickup_naam ? `: ${t.clickup_naam}` : ''}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {t.filter === 'beslissen' && (
                      <>
                        <button type="button" onClick={() => setOpen(open === t.id ? null : t.id)} className="btn-primary text-xs h-7"><Check className="h-3.5 w-3.5" />Zet taak</button>
                        <button type="button" onClick={() => actie(t, 'verwijder')} disabled={bezig === t.id} className="h-7 w-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-white hover:text-red-600" title="Verwijder: niets te doen">{bezig === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
                      </>
                    )}
                    {t.filter === 'verwijderd' && <button type="button" onClick={() => actie(t, 'terug')} disabled={bezig === t.id} className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1"><RotateCcw className="h-3 w-3" />Terugzetten</button>}
                    {t.clickup_url && <a href={t.clickup_url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-800 p-1" title="Openen in ClickUp"><ExternalLink className="h-3.5 w-3.5" /></a>}
                  </div>
                </div>
                {open === t.id && <ZetTaak t={t} leden={leden} ik={ik} onSluit={() => setOpen(null)} onKlaar={() => { setOpen(null); toast.success('Staat in ClickUp.'); laad(); onIngepland() }} />}
              </li>
            )
          })}
        </ul>
      )}
      {lijst.length > 6 && !meer && <button type="button" onClick={() => setMeer(true)} className="text-xs text-gray-500 hover:text-black mt-1">Meer tonen ({lijst.length - 6})</button>}
    </div>
  )
}

function ZetTaak({ t, leden, ik, onSluit, onKlaar }: { t: MailTaak; leden: Lid[]; ik: number | null; onSluit: () => void; onKlaar: () => void }) {
  const [omschrijving, setOmschrijving] = useState(t.wat)
  const [wie, setWie] = useState<number | null>(ik)
  const [deadline, setDeadline] = useState(t.deadline && t.deadline >= vandaag() ? t.deadline : '')
  const [merk, setMerk] = useState<'nextgenmedia' | 'nextgensolutions'>('nextgenmedia')
  const [bezig, setBezig] = useState(false)
  const VOORAAN = ['bram', 'marco', 'chiara']
  const gesorteerd = [...leden].sort((a, b) => {
    const ia = VOORAAN.indexOf(voornaam(a.naam).toLowerCase()), ib = VOORAAN.indexOf(voornaam(b.naam).toLowerCase())
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.naam.localeCompare(b.naam)
  })
  const zet = async () => {
    if (!wie) { toast.error('Kies voor wie.'); return }
    setBezig(true)
    try { await post({ actie: 'zet', id: t.id, omschrijving, deadline: deadline || null, assignee_id: wie, merk }); onKlaar() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); setBezig(false) }
  }
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2.5 space-y-2">
      <input className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg" value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} maxLength={200} aria-label="Wat" />
      <div className="flex gap-2 flex-wrap items-center">
        <select className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={wie ?? ''} onChange={(e) => setWie(e.target.value ? Number(e.target.value) : null)} aria-label="Voor wie">
          <option value="">Voor wie?</option>
          {gesorteerd.map((l) => <option key={l.id} value={l.id}>{l.naam}</option>)}
        </select>
        <input type="date" min={vandaag()} className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="Deadline" title="Leeg = over twee werkdagen" />
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
          {(['nextgenmedia', 'nextgensolutions'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMerk(m)} className={`px-2 py-1 rounded-md text-xs ${merk === m ? 'text-white' : 'text-gray-600'}`} style={merk === m ? { background: MERK_STIJL[m].kleur } : undefined}>{m === 'nextgenmedia' ? 'NGM' : 'NGS'}</button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={zet} disabled={bezig || !omschrijving.trim()} className="btn-primary text-xs h-8 flex-1 justify-center">{bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}In ClickUp zetten</button>
        <button type="button" onClick={onSluit} className="btn-secondary text-xs h-8"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  )
}
