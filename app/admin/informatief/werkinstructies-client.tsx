'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Check, Pencil, Archive, RotateCcw, History, ChevronDown, X } from 'lucide-react'
import { zoekVeld } from '@/lib/zoekveld'
import { leesStand, LEES_LABEL, sorteerInstructies, type Werkinstructie, type LeesStand } from '@/lib/team/werkinstructies'

type Data = {
  instructies: Werkinstructie[]
  gelezen: Record<string, number[]>
  lezers: Record<string, { naam: string; op: string }[]>
  magBeheren: boolean
  diensten: { slug: string; naam: string; bedrijf: string | null }[]
  sjablonen: { key: string; naam: string }[]
  fout?: string
}

const BEDRIJF: Record<string, string> = { nextgenmedia: 'NextGenMedia', nextgensolutions: 'NextGenSolutions' }
const datum = (s: string) => new Date(s).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })
const STAND_KLEUR: Record<LeesStand, string> = { gelezen: 'bg-green-50 text-green-800 border-green-200', nieuwe_versie: 'bg-amber-50 text-amber-800 border-amber-200', ongelezen: 'bg-gray-100 text-gray-700 border-gray-200' }

export function WerkinstructiesClient() {
  const [d, setD] = useState<Data | null>(null)
  const [archief, setArchief] = useState(false)
  const [zoek, setZoek] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [bewerk, setBewerk] = useState<Werkinstructie | 'nieuw' | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)

  const laad = useCallback(() => {
    fetch(`/api/admin/werkinstructies${archief ? '?archief=1' : ''}`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j) })
      .catch((e) => { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setD({ instructies: [], gelezen: {}, lezers: {}, magBeheren: false, diensten: [], sjablonen: [] }) })
  }, [archief])
  useEffect(() => { laad() }, [laad])

  const post = async (body: Record<string, unknown>, sleutel: string, ok?: string) => {
    setBezig(sleutel)
    try {
      const r = await fetch('/api/admin/werkinstructies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      if (ok) toast.success(ok)
      laad(); return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); return false } finally { setBezig(null) }
  }

  const lijst = useMemo(() => {
    const q = zoek.trim().toLowerCase()
    return sorteerInstructies((d?.instructies ?? []).filter((i) => !q || `${i.titel} ${i.inhoud}`.toLowerCase().includes(q)))
  }, [d, zoek])
  const dienstNaam = (s: string | null) => (s ? d?.diensten.find((x) => x.slug === s)?.naam ?? s : null)
  const rolNaam = (s: string | null) => (s ? d?.sjablonen.find((x) => x.key === s)?.naam ?? s : null)

  if (!d) return <div className="card-base py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const teLezen = lijst.filter((i) => !i.gearchiveerd_op && leesStand(i.versie, d.gelezen[i.id] ?? []) !== 'gelezen').length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input {...zoekVeld()} value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoeken" className="input-base !w-56 !py-1.5 text-sm" />
        {teLezen > 0 && <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">{teLezen} nog te lezen</span>}
        <div className="flex-1" />
        {d.magBeheren && <label className="text-xs text-gray-600 flex items-center gap-1.5"><input type="checkbox" checked={archief} onChange={(e) => setArchief(e.target.checked)} />Gearchiveerde tonen</label>}
        {d.magBeheren && <button type="button" onClick={() => setBewerk('nieuw')} className="btn-primary !py-1.5 !text-sm"><Plus className="h-4 w-4" />Nieuwe werkinstructie</button>}
      </div>
      {d.fout && <div className="card-base text-sm text-gray-500">{d.fout}</div>}
      {!lijst.length && !d.fout && <div className="card-base text-sm text-gray-500 text-center py-8">{zoek ? 'Niets gevonden.' : d.magBeheren ? 'Nog geen werkinstructies. Schrijf de eerste met de knop rechtsboven.' : 'Nog geen werkinstructies voor jou.'}</div>}
      <ul className="space-y-2">
        {lijst.map((i) => {
          const stand = leesStand(i.versie, d.gelezen[i.id] ?? [])
          const isOpen = open === i.id
          const labels = [i.bedrijf ? BEDRIJF[i.bedrijf] ?? i.bedrijf : null, dienstNaam(i.dienst_slug), rolNaam(i.rol_sjabloon)].filter(Boolean) as string[]
          return (
            <li key={i.id} className={`card-base !p-0 ${i.gearchiveerd_op ? 'opacity-60' : ''} ${i.soort === 'afspraken' ? 'ring-1 ring-gray-900' : ''}`}>
              <button type="button" onClick={() => setOpen(isOpen ? null : i.id)} className="w-full text-left px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{i.titel}{i.soort === 'afspraken' && <span className="ml-2 label-mono text-gray-500">Vaste pagina</span>}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px]">
                    {labels.length ? labels.map((l) => <span key={l} className="rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{l}</span>) : <span className="text-gray-400">Voor iedereen</span>}
                    <span className="text-gray-400">· versie {i.versie} · {datum(i.updated_at)}</span>
                  </div>
                </div>
                {!i.gearchiveerd_op && <span className={`shrink-0 text-[11px] border rounded-full px-2 py-0.5 ${STAND_KLEUR[stand]}`}>{LEES_LABEL[stand]}</span>}
                <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                  <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{i.inhoud}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!i.gearchiveerd_op && stand !== 'gelezen' && <button type="button" disabled={!!bezig} onClick={() => post({ actie: 'gelezen', id: i.id }, i.id, i.soort === 'afspraken' ? 'Bevestigd.' : 'Gelezen.')} className="btn-primary !py-1.5 !text-sm">{bezig === i.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{i.soort === 'afspraken' ? 'Ik bevestig deze afspraken' : 'Gelezen'}</button>}
                    {d.magBeheren && <button type="button" onClick={() => setBewerk(i)} className="btn-secondary !py-1.5 !text-sm"><Pencil className="h-3.5 w-3.5" />Aanpassen</button>}
                    {d.magBeheren && <Versies id={i.id} />}
                    {d.magBeheren && (i.gearchiveerd_op
                      ? <button type="button" disabled={!!bezig} onClick={() => post({ actie: 'terugzetten', id: i.id }, `a${i.id}`, 'Teruggezet.')} className="btn-secondary !py-1.5 !text-sm"><RotateCcw className="h-3.5 w-3.5" />Terugzetten</button>
                      : <button type="button" disabled={!!bezig} onClick={() => { if (confirm('Archiveren? De instructie verdwijnt uit de lijst; terugzetten kan.')) void post({ actie: 'archiveer', id: i.id }, `a${i.id}`, 'Gearchiveerd.') }} className="btn-secondary !py-1.5 !text-sm"><Archive className="h-3.5 w-3.5" />Archiveren</button>)}
                  </div>
                  {d.magBeheren && (
                    <div className="text-[11px] text-gray-500">
                      {(d.lezers[i.id] ?? []).length ? <>Versie {i.versie} gelezen door {(d.lezers[i.id] ?? []).map((l) => `${l.naam} (${datum(l.op)})`).join(', ')}.</> : `Versie ${i.versie} nog door niemand gelezen.`}
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {bewerk && <InstructieVenster i={bewerk === 'nieuw' ? null : bewerk} d={d} onSluit={() => setBewerk(null)} onBewaar={async (body) => { if (await post(body, 'bewaar', bewerk === 'nieuw' ? 'Werkinstructie toegevoegd.' : 'Bewaard.')) setBewerk(null) }} bezig={bezig === 'bewaar'} />}
    </div>
  )
}

function Versies({ id }: { id: string }) {
  const [v, setV] = useState<{ versie: number; titel: string; inhoud: string; opgeslagen_door: string | null; created_at: string }[] | null>(null)
  const [open, setOpen] = useState(false)
  const toon = () => {
    setOpen(true)
    if (!v) fetch(`/api/admin/werkinstructies?versies=${id}`, { cache: 'no-store' }).then((r) => r.json()).then((j) => setV(j.versies ?? [])).catch(() => setV([]))
  }
  return (
    <>
      <button type="button" onClick={toon} className="btn-secondary !py-1.5 !text-sm"><History className="h-3.5 w-3.5" />Versies</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="font-semibold">Eerdere versies</h3><button type="button" onClick={() => setOpen(false)} aria-label="Sluiten"><X className="h-4 w-4" /></button></div>
            {!v ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : v.map((x) => (
              <details key={x.versie} className="rounded-xl border border-gray-100 p-3">
                <summary className="cursor-pointer text-sm"><b>Versie {x.versie}</b> · {x.titel} <span className="text-gray-400">· {x.opgeslagen_door ?? '—'}, {datum(x.created_at)}</span></summary>
                <div className="text-sm text-gray-700 whitespace-pre-wrap mt-2">{x.inhoud}</div>
              </details>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function InstructieVenster({ i, d, onSluit, onBewaar, bezig }: { i: Werkinstructie | null; d: Data; onSluit: () => void; onBewaar: (b: Record<string, unknown>) => void; bezig: boolean }) {
  const [titel, setTitel] = useState(i?.titel ?? '')
  const [inhoud, setInhoud] = useState(i?.inhoud ?? '')
  const [bedrijf, setBedrijf] = useState(i?.bedrijf ?? '')
  const [dienst, setDienst] = useState(i?.dienst_slug ?? '')
  const [rol, setRol] = useState(i?.rol_sjabloon ?? '')
  const [afspraken, setAfspraken] = useState(i?.soort === 'afspraken')
  const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15'
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onSluit}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-semibold">{i ? 'Werkinstructie aanpassen' : 'Nieuwe werkinstructie'}</h3><button type="button" onClick={onSluit} aria-label="Sluiten"><X className="h-4 w-4" /></button></div>
        <label className="block"><span className="text-xs font-medium text-gray-600">Titel</span><input className={INP} value={titel} onChange={(e) => setTitel(e.target.value)} autoFocus /></label>
        <label className="block"><span className="text-xs font-medium text-gray-600">Instructie</span><textarea className={INP} rows={12} value={inhoud} onChange={(e) => setInhoud(e.target.value)} placeholder={'Stap 1: …\nStap 2: …'} /></label>
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="block"><span className="text-xs font-medium text-gray-600">Bedrijf</span><select className={INP} value={bedrijf} onChange={(e) => setBedrijf(e.target.value)}><option value="">Beide</option><option value="nextgenmedia">NextGenMedia</option><option value="nextgensolutions">NextGenSolutions</option></select></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Dienst</span><select className={INP} value={dienst} onChange={(e) => setDienst(e.target.value)}><option value="">Geen</option>{d.diensten.filter((x) => !bedrijf || !x.bedrijf || x.bedrijf === bedrijf).map((x) => <option key={x.slug} value={x.slug}>{x.naam}</option>)}</select></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Enkel voor rol</span><select className={INP} value={rol} onChange={(e) => setRol(e.target.value)}><option value="">Iedereen</option>{d.sjablonen.map((x) => <option key={x.key} value={x.key}>{x.naam}</option>)}</select></label>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={afspraken} onChange={(e) => setAfspraken(e.target.checked)} />Vaste pagina: gedragsafspraken en rolverdeling (bovenaan, iedereen bevestigt)</label>
        {i && <p className="text-[11px] text-gray-500">Pas je de titel of de tekst aan, dan wordt het versie {i.versie + 1} en vraagt de app iedereen ze opnieuw te lezen. Enkel labels aanpassen doet dat niet.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onSluit} className="btn-secondary" disabled={bezig}>Annuleren</button>
          <button type="button" disabled={bezig} onClick={() => onBewaar({ actie: i ? 'wijzig' : 'nieuw', id: i?.id, versie: i?.versie, titel, inhoud, bedrijf: bedrijf || null, dienst_slug: dienst || null, rol_sjabloon: rol || null, soort: afspraken ? 'afspraken' : 'instructie' })} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
        </div>
      </div>
    </div>
  )
}
