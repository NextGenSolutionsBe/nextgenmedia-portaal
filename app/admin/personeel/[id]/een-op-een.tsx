'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import type { Actiepunt } from '@/lib/ritme/model'

type Gesprek = { id: string; datum: string; notities: string | null; afspraken: Actiepunt[]; met_naam: string | null }
const dag = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

/**
 * 1-op-1's (verbeterplan fase 7, punt 95): per gesprek de datum, notities en
 * afspraken (wie, wat, aan wie, tegen wanneer). Zichtbaar voor de
 * zaakvoerders, de medewerker (Mijn account) en wie het gesprek voerde.
 * Er wordt niets ingepland.
 */
export function EenOpEenTab({ id }: { id: string }) {
  const [lijst, setLijst] = useState<Gesprek[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [bewerk, setBewerk] = useState<Gesprek | null>(null)
  const laad = useCallback(() => {
    fetch(`/api/admin/personeel/${id}/een-op-een`, { cache: 'no-store' }).then((r) => r.json()).then((j) => { setLijst(j.gesprekken ?? []); setFout(j.fout ?? j.error ?? null) }).catch(() => setFout('Laden mislukt'))
  }, [id])
  useEffect(() => { laad() }, [laad])
  const bewaar = async (g: Partial<Gesprek> & { weg?: boolean }) => {
    try {
      const r = await fetch(`/api/admin/personeel/${id}/een-op-een`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(g) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      toast.success(g.weg ? 'Verborgen.' : 'Bewaard.'); setBewerk(null); laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
  }
  if (!lijst) return <div className="card-base py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-sm text-gray-500">Enkel voor de zaakvoerders, de medewerker en wie het gesprek voerde.</p><button type="button" onClick={() => setBewerk({ id: '', datum: vandaag(), notities: '', afspraken: [], met_naam: null })} className="btn-primary text-sm"><Plus className="h-4 w-4" />Gesprek</button></div>
      {fout && <div className="card-base text-sm text-gray-500">{fout}</div>}
      {bewerk && <Formulier g={bewerk} onBewaar={bewaar} onAnnuleer={() => setBewerk(null)} />}
      {!lijst.length && !bewerk && !fout && <div className="card-base text-sm text-gray-500 text-center py-6">Nog geen 1-op-1's.</div>}
      {lijst.map((g) => (
        <div key={g.id} className="card-base space-y-1.5">
          <div className="flex items-center gap-2"><span className="font-semibold text-sm flex-1 capitalize">{dag(g.datum)}</span><span className="text-xs text-gray-500">{g.met_naam}</span><button type="button" onClick={() => setBewerk(g)} className="btn-secondary !py-1 text-xs">Aanpassen</button><button type="button" onClick={() => { if (confirm('Dit gesprek verbergen?')) void bewaar({ id: g.id, weg: true }) }} className="h-7 w-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400" aria-label="Verbergen"><Trash2 className="h-3.5 w-3.5" /></button></div>
          {g.notities && <p className="text-sm whitespace-pre-wrap text-gray-800">{g.notities}</p>}
          {g.afspraken.length > 0 && <ul className="text-sm list-disc pl-5">{g.afspraken.map((a) => <li key={a.id}>{a.tekst} <span className="text-gray-500">· {a.wie}{a.aan_wie ? ` aan ${a.aan_wie}` : ''}{a.tegen ? ` · tegen ${a.tegen.split('-').reverse().join('/')}` : ''}</span></li>)}</ul>}
        </div>
      ))}
    </div>
  )
}

function Formulier({ g, onBewaar, onAnnuleer }: { g: Gesprek; onBewaar: (g: Partial<Gesprek>) => void; onAnnuleer: () => void }) {
  const [datum, setDatum] = useState(g.datum)
  const [notities, setNotities] = useState(g.notities ?? '')
  const [afspraken, setAfspraken] = useState<Actiepunt[]>(g.afspraken)
  const [n, setN] = useState({ tekst: '', wie: '', aan_wie: '', tegen: '' })
  return (
    <div className="card-base space-y-2">
      <input type="date" className="input-base !w-44" value={datum} onChange={(e) => setDatum(e.target.value)} aria-label="Datum" />
      <textarea className="input-base" rows={6} value={notities} onChange={(e) => setNotities(e.target.value)} placeholder="Hoe gaat het, wat loopt goed, wat kan beter, wat heb je nodig?" aria-label="Notities" />
      <div className="label-mono text-gray-500">Afspraken</div>
      <ul className="text-sm space-y-1">{afspraken.map((a) => <li key={a.id} className="flex gap-2"><span className="flex-1">{a.tekst} <span className="text-gray-500">· {a.wie}{a.aan_wie ? ` aan ${a.aan_wie}` : ''}</span></span><button type="button" onClick={() => setAfspraken(afspraken.filter((x) => x.id !== a.id))} className="text-gray-400" aria-label="Weghalen"><Trash2 className="h-3.5 w-3.5" /></button></li>)}</ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_110px_110px_140px_auto]">
        <input className="input-base" value={n.tekst} onChange={(e) => setN({ ...n, tekst: e.target.value })} placeholder="Afspraak" aria-label="Afspraak" />
        <input className="input-base" value={n.wie} onChange={(e) => setN({ ...n, wie: e.target.value })} placeholder="Wie?" aria-label="Wie" />
        <input className="input-base" value={n.aan_wie} onChange={(e) => setN({ ...n, aan_wie: e.target.value })} placeholder="Aan wie?" aria-label="Aan wie" />
        <input type="date" className="input-base" value={n.tegen} onChange={(e) => setN({ ...n, tegen: e.target.value })} aria-label="Tegen wanneer" />
        <button type="button" disabled={n.tekst.trim().length < 3 || !n.wie.trim()} onClick={() => { setAfspraken([...afspraken, { id: crypto.randomUUID(), tekst: n.tekst, wie: n.wie, aan_wie: n.aan_wie || null, tegen: n.tegen || null }]); setN({ tekst: '', wie: '', aan_wie: '', tegen: '' }) }} className="btn-secondary text-sm"><Plus className="h-4 w-4" /></button>
      </div>
      <div className="flex justify-end gap-2"><button type="button" onClick={onAnnuleer} className="btn-secondary text-sm">Annuleren</button><button type="button" onClick={() => onBewaar({ id: g.id || undefined, datum, notities, afspraken })} className="btn-primary text-sm">Bewaren</button></div>
    </div>
  )
}
