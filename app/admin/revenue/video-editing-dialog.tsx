'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, X, Clapperboard, AlertTriangle, RefreshCw } from 'lucide-react'
import { berekenVideoKost, leesUren, type VideoBerekening, type VideoTarief } from '@/lib/kosten/video-editing'

/**
 * Kost "Video editing student": student kiezen, datum en uren invullen; de
 * berekening verschijnt meteen op basis van het tarief uit Personeel dat op
 * die datum geldt. Bij opslaan wordt alles als momentopname bewaard.
 */

type Medewerker = { id: string; naam: string; type: string; actief: boolean }
type Bestaand = { id: string; cost_date: string | null; client_id?: string | null; berekening?: (Partial<VideoBerekening> & { naam?: string; omschrijving?: string }) | null; personeel_id?: string | null }

const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'
const eur = (n: number) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(n)

export function VideoEditingDialog({ bestaand, onClose }: { bestaand?: Bestaand | null; onClose: () => void }) {
  const router = useRouter()
  const isEdit = !!bestaand
  const vandaag = new Date().toISOString().slice(0, 10)
  const [mensen, setMensen] = useState<Medewerker[]>([])
  const [klanten, setKlanten] = useState<{ id: string; company_name: string }[]>([])
  const [pid, setPid] = useState(bestaand?.personeel_id ?? '')
  const [datum, setDatum] = useState(bestaand?.cost_date ? String(bestaand.cost_date).slice(0, 10) : vandaag)
  const [uren, setUren] = useState(bestaand?.berekening?.uren ? String(bestaand.berekening.uren).replace('.', ',') : '')
  const [omschrijving, setOmschrijving] = useState(bestaand?.berekening?.omschrijving ?? 'Video editing')
  const [klant, setKlant] = useState(bestaand?.client_id ?? '')
  const [tarief, setTarief] = useState<VideoTarief | null | undefined>(undefined)
  const [herbereken, setHerbereken] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [dubbel, setDubbel] = useState<string | null>(null)
  const sleutel = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)
  const bezigRef = useRef(false)

  useEffect(() => {
    fetch('/api/admin/costs/video-editing', { cache: 'no-store' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setMensen(j.medewerkers); setKlanten(j.klanten) })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [])
  // Bij bewerken: de opgeslagen tarieven (momentopname). Anders: het tarief dat op de datum geldt.
  const snapshot: VideoTarief | null = bestaand?.berekening?.loon_uur !== undefined ? {
    tarief_id: String(bestaand.berekening.tarief_id ?? ''), geldig_vanaf: String(bestaand.berekening.geldig_vanaf ?? ''), basis_label: String(bestaand.berekening.basis_label ?? ''),
    loon_uur: Number(bestaand.berekening.loon_uur), totaal_uur: Number(bestaand.berekening.totaal_uur), lasten_uur: Number(bestaand.berekening.lasten_uur ?? 0), btw_pct: Number(bestaand.berekening.btw_pct ?? 0),
  } : null
  useEffect(() => {
    if ((isEdit && !herbereken) || !pid || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) { setTarief(undefined); return }
    let weg = false
    fetch(`/api/admin/costs/video-editing?personeel_id=${pid}&datum=${datum}`, { cache: 'no-store' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); if (!weg) setTarief(j.tarief) })
      .catch((e) => { if (!weg) { setFout(e instanceof Error ? e.message : 'Tarief laden mislukt'); setTarief(null) } })
    return () => { weg = true }
  }, [pid, datum, isEdit, herbereken])

  const gebruikt = isEdit && !herbereken ? snapshot : tarief ?? null
  const u = leesUren(uren)
  const ber = gebruikt && u ? berekenVideoKost(u, gebruikt) : null
  const persoon = mensen.find((m) => m.id === pid)

  const bewaar = async (bevestigDubbel = false) => {
    if (bezigRef.current) return
    setFout(null)
    if (!pid) { setFout('Kies een student of medewerker.'); return }
    if (!u) { setFout('Geef het aantal uren (bv. 2,5).'); return }
    if (!ber) { setFout('Er is geen bruikbaar tarief voor deze datum.'); return }
    bezigRef.current = true; setBezig(true)
    try {
      const r = await fetch('/api/admin/costs/video-editing', {
        method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: bestaand!.id, datum, uren, omschrijving, client_id: klant || null, herbereken_tarief: herbereken } : { personeel_id: pid, datum, uren, omschrijving, client_id: klant || null, sleutel: sleutel.current, bevestig_dubbel: bevestigDubbel }),
      })
      const j = await r.json()
      if (r.status === 409 && j.code === 'mogelijk_dubbel') { setDubbel(j.error); return }
      if (!r.ok) throw new Error(j.error)
      toast.success(isEdit ? 'Kost bijgewerkt.' : `Kost geboekt: ${eur(ber.bedrag)}.`)
      onClose(); router.refresh()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { bezigRef.current = false; setBezig(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Video editing student">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Clapperboard className="h-4 w-4" />{isEdit ? 'Video editing wijzigen' : 'Video editing student'}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className={lbl}>Student / medewerker *</label>
            {isEdit ? <div className="text-sm font-medium">{bestaand?.berekening?.naam ?? persoon?.naam ?? '—'}</div> : (
              <select className={inp} value={pid} onChange={(e) => setPid(e.target.value)}>
                <option value="">— kies —</option>
                {mensen.filter((m) => m.actief).map((m) => <option key={m.id} value={m.id}>{m.naam}{m.type === 'student' ? ' · student' : ''}</option>)}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Datum van de prestatie *</label><input type="date" className={inp} value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
            <div><label className={lbl}>Aantal uren *</label><input className={inp} inputMode="decimal" value={uren} onChange={(e) => setUren(e.target.value)} placeholder="bv. 2,5" autoFocus={!isEdit} /></div>
          </div>
          <div><label className={lbl}>Omschrijving</label><input className={inp} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} /></div>
          <div>
            <label className={lbl}>Klant of project <span className="text-gray-400 font-normal">— optioneel</span></label>
            <select className={inp} value={klant} onChange={(e) => setKlant(e.target.value)}><option value="">— geen —</option>{klanten.map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}</select>
          </div>

          {/* Berekening */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm space-y-1" aria-live="polite">
            {isEdit && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer mb-1"><input type="checkbox" checked={herbereken} onChange={(e) => setHerbereken(e.target.checked)} /><RefreshCw className="h-3 w-3" />Actueel tarief van de datum gebruiken (anders blijft het opgeslagen tarief)</label>
            )}
            {!pid && !isEdit ? <p className="text-xs text-gray-500">Kies een student om het tarief op te halen.</p>
              : gebruikt === null && tarief !== undefined ? (
                <p className="text-xs text-amber-900 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>Voor {persoon?.naam ?? 'deze medewerker'} is op deze datum geen uurtarief ingevuld. <Link href={pid ? `/admin/personeel/${pid}?tab=tarief` : '/admin/personeel'} className="underline">Vul het tarief in bij Personeel</Link>; de app gebruikt geen standaardtarief.</span></p>
              ) : !gebruikt ? <p className="text-xs text-gray-500 flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Tarief ophalen…</p>
              : (
                <>
                  <div className="flex justify-between text-xs text-gray-600"><span>{gebruikt.basis_label || 'Uurloon'} (loon / vergoeding)</span><span className="tabular-nums">{eur(gebruikt.loon_uur)} / u</span></div>
                  {gebruikt.lasten_uur > 0.004 ? <div className="flex justify-between text-xs text-gray-600"><span>Totale kost voor het bedrijf</span><span className="tabular-nums">{eur(gebruikt.totaal_uur)} / u</span></div>
                    : <div className="text-[11px] text-gray-500">Geen werkgevers- of payrollkosten in het tarief: de kost is de loonkost op basis van het uurloon.</div>}
                  {ber ? (
                    <div className="border-t border-gray-200 pt-1.5 mt-1 space-y-0.5">
                      <div className="flex justify-between"><span>Loon student: {String(ber.uren).replace('.', ',')} u × {eur(ber.loon_uur)}</span><b className="tabular-nums">{eur(ber.loon)}</b></div>
                      {ber.heeftBedrijfskost
                        ? <div className="flex justify-between"><span>Totale kost: {String(ber.uren).replace('.', ',')} u × {eur(ber.totaal_uur)}</span><b className="tabular-nums">{eur(ber.totaal)}</b></div>
                        : <div className="flex justify-between"><span>Loonkost op basis van uurloon</span><b className="tabular-nums">{eur(ber.loon)}</b></div>}
                      <div className="text-[11px] text-gray-500">Geboekt als kost: <b>{eur(ber.bedrag)}</b> excl. btw{ber.btw_pct ? ` (+ ${ber.btw_pct} % btw)` : ''} · tarief geldig vanaf {gebruikt.geldig_vanaf.split('-').reverse().join('/')}</div>
                    </div>
                  ) : <p className="text-xs text-gray-500">Vul de uren in voor de berekening.</p>}
                </>
              )}
          </div>

          {dubbel && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2">
              <p>{dubbel}</p>
              <div className="flex gap-2"><button type="button" onClick={() => { setDubbel(null); bewaar(true) }} className="btn-primary text-xs">Ja, toch boeken</button><button type="button" onClick={() => setDubbel(null)} className="btn-secondary text-xs">Nee</button></div>
            </div>
          )}
          {fout && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{fout}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => bewaar()} disabled={bezig || !ber} className="btn-primary flex-1">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{isEdit ? 'Opslaan' : 'Kost boeken'}</button>
            <button type="button" onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
          <p className="text-[11px] text-gray-400">Registreert enkel de kost; er wordt niets betaald. Uren, tarieven en berekening worden bewaard zoals nu getoond.</p>
        </div>
      </div>
    </div>
  )
}
