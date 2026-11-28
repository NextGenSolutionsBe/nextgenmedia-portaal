'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Plus, ShieldCheck, Archive, Pencil } from 'lucide-react'
import { CARE_STATUSSEN, type CareItem } from '@/lib/ngs/levering'
import { Venster, inp, lbl, dagKort, eurCent } from '../ui'
import { CareDetailVenster } from './care-detail'

export type CareRij = CareItem & { klant?: string | null; volgende?: string | null; teLaat?: number | null }

export async function lever(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/nextgensolutions/levering', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
  return j as Record<string, unknown>
}

/** Care-register: wat we voor een klant draaien en wanneer het nagekeken moet worden. */
export function CareLijst({ items, onVernieuw, nieuw }: { items: CareRij[]; onVernieuw: () => void; nieuw?: { client_id?: string | null; project_id?: string | null } }) {
  const [bewerk, setBewerk] = useState<CareRij | 'nieuw' | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const doe = async (body: Record<string, unknown>, sleutel: string, ok: string) => {
    setBezig(sleutel)
    try { await lever(body); toast.success(ok); onVernieuw() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  return (
    <div className="space-y-2">
      {!items.length && <p className="text-xs text-gray-500">Nog niets in Care.</p>}
      <ul className="space-y-1.5">
        {items.map((c) => (
          <li key={c.id} className={`rounded-xl border px-3 py-2.5 ${c.teLaat ? 'border-amber-200 bg-amber-50/50' : 'border-gray-100'}`}>
            <div className="flex items-start gap-2">
              <ShieldCheck className={`h-4 w-4 mt-0.5 shrink-0 ${c.status === 'actief' ? 'text-gray-900' : 'text-gray-300'}`} />
              <div className="flex-1 min-w-0">
                <button type="button" onClick={() => setDetail(c.id)} className="text-sm font-medium text-left hover:underline">{c.naam}{c.klant ? <span className="text-gray-500 font-normal"> · {c.klant}</span> : null}{c.pakket ? <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide rounded-full border border-gray-200 px-1.5 py-0.5 text-gray-600">{c.pakket}</span> : null}</button>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {CARE_STATUSSEN.find((s) => s.key === c.status)?.label}
                  {c.care_contract ? ` · Care-contract${c.maandbedrag ? ` ${eurCent(c.maandbedrag)}/m` : ''}` : ''}
                  {c.systemen.length ? ` · ${c.systemen.join(', ')}` : ''}
                  {c.laatste_controle ? ` · laatst nagekeken ${dagKort(c.laatste_controle)}` : ''}
                  {c.teLaat ? <span className="text-amber-800 font-medium"> · controle {c.teLaat} dag{c.teLaat === 1 ? '' : 'en'} te laat</span> : c.volgende ? ` · volgende ${dagKort(c.volgende)}` : ''}
                </div>
              </div>
              <div className="flex gap-0.5 shrink-0">
                {c.status === 'actief' && <button type="button" title="Vandaag nagekeken" aria-label="Vandaag nagekeken" disabled={!!bezig} onClick={() => doe({ actie: 'care.gecontroleerd', id: c.id }, `c${c.id}`, 'Controle genoteerd.')} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-gray-100">{bezig === `c${c.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</button>}
                <button type="button" title="Aanpassen" aria-label="Aanpassen" onClick={() => setBewerk(c)} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-gray-100"><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" title="Archiveren" aria-label="Archiveren" disabled={!!bezig} onClick={() => { if (confirm(`${c.naam} uit Care halen? Het blijft bewaard.`)) void doe({ actie: 'care.archiveer', id: c.id }, `a${c.id}`, 'Gearchiveerd.') }} className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-gray-100"><Archive className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setBewerk('nieuw')} className="btn-secondary !py-1.5 !text-sm"><Plus className="h-4 w-4" />In Care opnemen</button>
      {detail && <CareDetailVenster id={detail} onSluit={() => setDetail(null)} onVernieuw={onVernieuw} />}
      {bewerk && <CareVenster c={bewerk === 'nieuw' ? null : bewerk} basis={nieuw} onSluit={() => setBewerk(null)} onKlaar={() => { setBewerk(null); onVernieuw() }} />}
    </div>
  )
}

function CareVenster({ c, basis, onSluit, onKlaar }: { c: CareRij | null; basis?: { client_id?: string | null; project_id?: string | null }; onSluit: () => void; onKlaar: () => void }) {
  const [v, setV] = useState(() => ({
    naam: c?.naam ?? '', omschrijving: c?.omschrijving ?? '', systemen: (c?.systemen ?? []).join('\n'), status: c?.status ?? 'actief',
    care_contract: c?.care_contract ?? false, maandbedrag: c?.maandbedrag ? String(c.maandbedrag).replace('.', ',') : '',
    controle_elke_dagen: c?.controle_elke_dagen ? String(c.controle_elke_dagen) : '30', laatste_controle: c?.laatste_controle ?? '', notitie: c?.notitie ?? '',
  }))
  const [bezig, setBezig] = useState(false)
  const zet = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }))
  const bewaar = async () => {
    setBezig(true)
    try {
      await lever({ actie: 'care.bewaar', id: c?.id, client_id: c?.client_id ?? basis?.client_id ?? null, project_id: c?.project_id ?? basis?.project_id ?? null, ...v })
      toast.success('Bewaard.'); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); setBezig(false) }
  }
  return (
    <Venster titel={c ? c.naam : 'In Care opnemen'} sub="Wat we draaien voor de klant en hoe vaak we het nakijken." onSluit={onSluit}>
      <label className="block"><span className={lbl}>Automatisatie of systeem *</span><input className={inp} value={v.naam} onChange={(e) => zet({ naam: e.target.value })} placeholder="bv. Offertes uit de mailbox" autoFocus /></label>
      <label className="block"><span className={lbl}>Wat het doet</span><textarea rows={2} className={inp} value={v.omschrijving} onChange={(e) => zet({ omschrijving: e.target.value })} /></label>
      <label className="block"><span className={lbl}>Systemen <span className="font-normal text-gray-400">(één per regel)</span></span><textarea rows={2} className={inp} value={v.systemen} onChange={(e) => zet({ systemen: e.target.value })} placeholder={'Make\nTeamleader'} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={lbl}>Status</span><select className={inp} value={v.status} onChange={(e) => zet({ status: e.target.value as typeof v.status })}>{CARE_STATUSSEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        <label className="block"><span className={lbl}>Nakijken om de … dagen</span><input inputMode="numeric" className={inp} value={v.controle_elke_dagen} onChange={(e) => zet({ controle_elke_dagen: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="block"><span className={lbl}>Laatst nagekeken</span><input type="date" className={inp} value={v.laatste_controle} onChange={(e) => zet({ laatste_controle: e.target.value })} /></label>
        <label className="block"><span className={lbl}>Care-contract (€/maand)</span><input inputMode="decimal" className={inp} value={v.maandbedrag} onChange={(e) => zet({ maandbedrag: e.target.value, care_contract: e.target.value ? true : v.care_contract })} placeholder="geen" /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.care_contract} onChange={(e) => zet({ care_contract: e.target.checked })} />Valt onder een Care-contract</label>
      <label className="block"><span className={lbl}>Notitie</span><textarea rows={2} className={inp} value={v.notitie} onChange={(e) => zet({ notitie: e.target.value })} /></label>
      <button type="button" onClick={bewaar} disabled={bezig || !v.naam.trim()} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bewaren</button>
    </Venster>
  )
}
