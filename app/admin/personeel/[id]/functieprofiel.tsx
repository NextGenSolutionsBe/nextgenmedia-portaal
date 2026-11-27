'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, GraduationCap } from 'lucide-react'
import { LEEG_PROFIEL, profielLeeg, type Functieprofiel, type StudentStand } from '@/lib/team/rollen'

type Data = { profiel: Functieprofiel | null; student: StudentStand | null }

function useProfiel(id: string) {
  const [d, setD] = useState<Data | null>(null)
  useEffect(() => { fetch(`/api/admin/personeel/${id}/profiel`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { profiel: null, student: null })).then(setD).catch(() => setD({ profiel: null, student: null })) }, [id])
  return { d, setD }
}

/** Studenten: gewerkte uren dit kalenderjaar tegenover 650. Let op vanaf 80%. */
export function StudentUrenKaart({ id }: { id: string }) {
  const { d } = useProfiel(id)
  const s = d?.student
  if (!s) return null
  const kleur = s.niveau === 'over' ? 'bg-red-600' : s.niveau === 'let_op' ? 'bg-amber-500' : 'bg-black'
  return (
    <div className={`card-base space-y-2 ${s.niveau === 'over' ? 'border-red-200' : s.niveau === 'let_op' ? 'border-amber-200' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm flex items-center gap-2"><GraduationCap className="h-4 w-4" />Studentenuren {new Date().getFullYear()}</h3>
        <span className="text-sm font-semibold">{s.uren} / {s.grens} uur</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${kleur}`} style={{ width: `${Math.min(100, s.pct)}%` }} /></div>
      <p className="text-xs text-gray-500">
        {s.niveau === 'over' ? 'De grens van 650 uur is bereikt. Plan geen studentenuren meer dit jaar.' : s.niveau === 'let_op' ? `Nog ${s.over} uur. Vanaf 80% verschijnt er een melding.` : `Nog ${s.over} uur dit kalenderjaar.`} Telt alle geregistreerde uren behalve afgekeurde.
      </p>
    </div>
  )
}

const lijst = (v: string[]) => v.join('\n')
const regels = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean)

/** Functieprofiel in het personeelsdossier: doel, taken, verantwoordelijkheden, aan wie je rapporteert. */
export function FunctieprofielTab({ id }: { id: string }) {
  const { d, setD } = useProfiel(id)
  const [p, setP] = useState<Functieprofiel>(LEEG_PROFIEL)
  const [taken, setTaken] = useState('')
  const [verantw, setVerantw] = useState('')
  const [comp, setComp] = useState('')
  const [bezig, setBezig] = useState(false)
  useEffect(() => {
    if (!d) return
    const x = d.profiel ?? LEEG_PROFIEL
    setP(x); setTaken(lijst(x.taken)); setVerantw(lijst(x.verantwoordelijkheden)); setComp(lijst(x.competenties))
  }, [d])
  if (!d) return <div className="card-base py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/personeel/${id}/profiel`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profiel: { ...p, taken: regels(taken), verantwoordelijkheden: regels(verantw), competenties: regels(comp) } }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setD({ ...d, profiel: j.profiel }); toast.success('Functieprofiel bewaard.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15'
  return (
    <div className="space-y-4">
      <StudentUrenKaart id={id} />
      <div className="card-base space-y-3">
        <div>
          <h3 className="font-semibold">Functieprofiel</h3>
          <p className="text-xs text-gray-500">{profielLeeg(d.profiel) ? 'Nog niet ingevuld.' : 'Wat deze functie inhoudt. Elke wijziging staat in het logboek.'}</p>
        </div>
        <label className="block"><span className="text-xs font-medium text-gray-600">Doel van de functie</span><textarea className={INP} rows={2} value={p.doel} onChange={(e) => setP({ ...p, doel: e.target.value })} placeholder="Waarom bestaat deze functie?" /></label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-medium text-gray-600">Taken <span className="text-gray-400 font-normal">(één per regel)</span></span><textarea className={INP} rows={6} value={taken} onChange={(e) => setTaken(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Verantwoordelijkheden <span className="text-gray-400 font-normal">(één per regel)</span></span><textarea className={INP} rows={6} value={verantw} onChange={(e) => setVerantw(e.target.value)} /></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Rapporteert aan</span><input className={INP} value={p.rapporteert_aan} onChange={(e) => setP({ ...p, rapporteert_aan: e.target.value })} placeholder="bv. Bram" /></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Competenties <span className="text-gray-400 font-normal">(één per regel)</span></span><textarea className={INP} rows={3} value={comp} onChange={(e) => setComp(e.target.value)} /></label>
        </div>
        <div className="flex justify-end"><button type="button" onClick={bewaar} disabled={bezig} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button></div>
      </div>
    </div>
  )
}
