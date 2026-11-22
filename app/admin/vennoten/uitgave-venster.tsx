'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Archive, Check, CircleStop, Eye, Loader2, Paperclip, Repeat, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { leesGetal } from '@/lib/getal'
import {
  FREQ, FREQUENTIES, VENNOTEN, betaaldata, isLopend, terugkerendStand, volgendeBetaling,
  type Frequentie, type Terugkerend, type Uitgave, type Vennoot,
} from '@/lib/vennoot-uitgaven'
import type { VennotenData } from '@/lib/vennoot-uitgaven-server'
import { AkkoordChips, Venster, bedragTekst, dag, eur, inp, lbl, post } from './gedeeld'

export type Soort = 'eenmalig' | 'terugkerend'
const DAG = /^\d{4}-\d{2}-\d{2}$/

/**
 * Eén venster voor een uitgave: eenmalig (bonnetje, datum) of terugkerend
 * (lease, huur, abonnement: hoe vaak, eerste betaling, eventueel een einde).
 * Bij een nieuwe uitgave kies je bovenaan; een bestaande blijft wat ze is.
 */
export function UitgaveVenster({ u, t, begin = 'eenmalig', beginVennoot, data, vandaag, onArchiveer, onSchrap, onSluit, onKlaar }: {
  u?: Uitgave | null; t?: Terugkerend | null; begin?: Soort; beginVennoot: Vennoot | null; data: VennotenData; vandaag: string
  onArchiveer?: () => void; onSchrap?: () => void; onSluit: () => void; onKlaar: (m: string) => void
}) {
  const bestaand = u ?? t ?? null
  const [soort, setSoort] = useState<Soort>(t ? 'terugkerend' : u ? 'eenmalig' : begin)
  const [v, setV] = useState({
    vennoot: (bestaand?.vennoot ?? beginVennoot ?? '') as Vennoot | '',
    omschrijving: bestaand?.omschrijving ?? '', doel: bestaand?.doel ?? '',
    bedrag: bestaand ? bedragTekst(bestaand.bedrag) : '',
    datum: u?.datum ?? vandaag,
    frequentie: (t?.frequentie ?? 'maand') as Frequentie,
    start: t?.start_datum ?? vandaag,
    eindAan: !!t?.eind_datum, eind: t?.eind_datum ?? '',
  })
  const [bon, setBon] = useState<{ pad: string; naam: string } | null>(null)
  const [bonWeg, setBonWeg] = useState(false)
  const huidigeBon = bestaand?.bewijs_pad && !bonWeg && !bon ? bestaand : null
  const [laden, setLaden] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [stoppen, setStoppen] = useState<string | null>(null)
  const [akBezig, setAkBezig] = useState(false)
  const kiezer = useRef<HTMLInputElement>(null)
  const terug = soort === 'terugkerend'

  const laadBonOp = async (f?: File) => {
    if (!f) return
    if (f.size > 25 * 1024 * 1024) { toast.error('Het bestand is groter dan 25 MB.'); return }
    setLaden(true)
    try {
      const naam = f.name && /\.[a-z0-9]+$/i.test(f.name) ? f.name : `bon.${(f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`
      const r = await fetch('/api/admin/vennoten/bon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam, grootte: f.size }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Opladen mislukt')
      const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: j.contentType, upsert: false })
      if (error) throw new Error(error.message)
      setBon({ pad: j.pad, naam })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally { setLaden(false); if (kiezer.current) kiezer.current.value = '' }
  }

  const bewaar = async () => {
    setBezig(true)
    try {
      const gemeen = { id: bestaand?.id, vennoot: v.vennoot, omschrijving: v.omschrijving, doel: v.doel, bedrag: v.bedrag, bon, bon_weg: !bon && bonWeg }
      if (terug) {
        await post({ ...gemeen, actie: t ? 'terugkerend.wijzig' : 'terugkerend.nieuw', frequentie: v.frequentie, start_datum: v.start, eind_datum: v.eindAan ? v.eind : '' })
        onKlaar(t ? 'Terugkerende uitgave aangepast.' : 'Terugkerende uitgave bewaard. Elke betaling telt vanzelf mee.')
      } else {
        await post({ ...gemeen, actie: u ? 'wijzig' : 'nieuw', datum: v.datum })
        onKlaar(u ? 'Uitgave aangepast.' : 'Uitgave bewaard.')
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(false) }
  }
  const stop = async () => {
    if (!t || !stoppen) return
    setBezig(true)
    try { await post({ actie: 'terugkerend.stop', id: t.id, datum: stoppen }); onKlaar('Gestopt. Wat al betaald is, blijft meetellen.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Stoppen mislukt'); setBezig(false) }
  }
  const akkoord = async () => {
    if (!t) return
    setAkBezig(true)
    try { await post({ actie: 'terugkerend.akkoord', id: t.id }); onKlaar('Akkoord gegeven.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Akkoord mislukt'); setAkBezig(false) }
  }

  // Wat de afspraak tot vandaag betekent.
  const b = leesGetal(v.bedrag)
  const plan = terug && DAG.test(v.start) ? { start_datum: v.start, eind_datum: v.eindAan && DAG.test(v.eind) ? v.eind : null, frequentie: v.frequentie } : null
  const betaald = plan ? betaaldata(plan, vandaag) : []
  const volgende = plan ? volgendeBetaling(plan, vandaag) : null
  const naam = v.vennoot ? data.namen[v.vennoot] : null
  const titel = t ? 'Terugkerende uitgave' : u ? 'Uitgave aanpassen' : 'Nieuwe uitgave'

  return (
    <Venster titel={titel} onSluit={onSluit}>
      {!bestaand && (
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-100" role="group" aria-label="Soort uitgave">
          {(['eenmalig', 'terugkerend'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSoort(s)} aria-pressed={soort === s}
              className={`h-9 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 ${soort === s ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}>
              {s === 'terugkerend' && <Repeat className="h-3.5 w-3.5" />}{s === 'eenmalig' ? 'Eenmalig' : 'Terugkerend'}
            </button>
          ))}
        </div>
      )}
      {terug && !bestaand && <p className="text-xs text-gray-500 -mt-2">Lease, huur, een abonnement: een vast bedrag elke maand, elk kwartaal of elk jaar.</p>}

      <div>
        <span className={lbl}>Voor wie</span>
        <div className="grid grid-cols-3 gap-2">
          {VENNOTEN.map((k) => (
            <button key={k} type="button" onClick={() => setV({ ...v, vennoot: k })} aria-pressed={v.vennoot === k} className={`h-10 rounded-lg border text-sm font-medium ${v.vennoot === k ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}>{data.namen[k]}</button>
          ))}
        </div>
      </div>
      <label className="block"><span className={lbl}>Wat</span><input className={inp} value={v.omschrijving} onChange={(e) => setV({ ...v, omschrijving: e.target.value })} placeholder={terug ? 'bv. Lease wagen, huur parkeerplaats' : 'bv. Fiets, broodje bij klantbezoek'} maxLength={200} /></label>
      <label className="block"><span className={lbl}>Waarvoor dient het</span><textarea rows={2} className={inp} value={v.doel} onChange={(e) => setV({ ...v, doel: e.target.value })} placeholder={terug ? 'bv. Klantbezoeken en shoots' : 'bv. Woon-werkverkeer, lunch tijdens bezoek bij Era Nobis'} maxLength={500} /></label>

      {terug ? (
        <>
          <div>
            <span className={lbl}>Hoe vaak</span>
            <div className="grid grid-cols-3 gap-2">
              {FREQUENTIES.map((f) => (
                <button key={f} type="button" onClick={() => setV({ ...v, frequentie: f })} aria-pressed={v.frequentie === f} className={`h-10 rounded-lg border text-sm font-medium ${v.frequentie === f ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}>{FREQ[f].elke}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={lbl}>Eerste betaling</span><input type="date" className={inp} value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></label>
            <label className="block"><span className={lbl}>Bedrag per keer (€)</span><input inputMode="decimal" className={inp} value={v.bedrag} onChange={(e) => setV({ ...v, bedrag: e.target.value })} placeholder="0,00" /></label>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={v.eindAan} onChange={(e) => setV({ ...v, eindAan: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
              Heeft een einddatum
            </label>
            {v.eindAan && (
              <label className="block mt-2"><span className={lbl}>Laatste betaling tot en met</span><input type="date" className={inp} value={v.eind} min={v.start} onChange={(e) => setV({ ...v, eind: e.target.value })} /></label>
            )}
          </div>
          {plan && b !== null && b > 0 && (
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-3.5 py-3 text-sm text-gray-800 space-y-1">
              <p><b className="font-semibold">{eur(b)} {FREQ[v.frequentie].per}</b>{naam ? ` voor ${naam}` : ''}, vanaf {dag(v.start)}{plan.eind_datum ? ` tot en met ${dag(plan.eind_datum)}` : ''}.</p>
              <p className="text-xs text-gray-500">
                {betaald.length
                  ? `Tot vandaag ${betaald.length} ${betaald.length === 1 ? 'betaling' : 'betalingen'} (${eur(betaald.length * b)}), die tellen meteen mee.`
                  : `De eerste betaling is op ${dag(v.start)}; vanaf dan telt ze mee.`}
                {volgende && betaald.length ? ` Volgende: ${dag(volgende)}.` : ''}
                {!t && data.ik ? ' Alle drie geven één keer akkoord op de afspraak; door te bewaren ga jij al akkoord.' : ''}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Wanneer</span><input type="date" className={inp} value={v.datum} max={vandaag} onChange={(e) => setV({ ...v, datum: e.target.value })} /></label>
          <label className="block"><span className={lbl}>Bedrag (€, incl. btw)</span><input inputMode="decimal" className={inp} value={v.bedrag} onChange={(e) => setV({ ...v, bedrag: e.target.value })} placeholder="0,00" /></label>
        </div>
      )}

      <div>
        <span className={lbl}>{terug ? 'Contract of factuur (mag later)' : 'Bonnetje of factuur'}</span>
        <input ref={kiezer} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => laadBonOp(e.target.files?.[0])} />
        {huidigeBon && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 mb-2 text-sm">
            <Paperclip className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="truncate flex-1 min-w-0">{huidigeBon.bewijs_naam ?? 'Document'}</span>
            <a href={`/api/admin/vennoten/bon?pad=${encodeURIComponent(huidigeBon.bewijs_pad!)}`} target="_blank" rel="noreferrer" className="h-8 px-2 rounded-lg inline-flex items-center gap-1 text-xs hover:bg-gray-100"><Eye className="h-3.5 w-3.5" />Bekijken</a>
            <button type="button" onClick={() => setBonWeg(true)} className="h-8 px-2 rounded-lg inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />Weghalen</button>
          </div>
        )}
        {bonWeg && !bon && <p className="text-xs text-amber-800 mb-2">Het document gaat weg bij het bewaren. <button type="button" onClick={() => setBonWeg(false)} className="underline">Ongedaan maken</button></p>}
        <button type="button" onClick={() => kiezer.current?.click()} disabled={laden} className="btn-secondary text-sm w-full justify-center">
          {laden ? <Loader2 className="h-4 w-4 animate-spin" /> : bon ? <Check className="h-4 w-4 text-green-600" /> : <Paperclip className="h-4 w-4" />}
          {bon ? bon.naam : huidigeBon ? 'Ander document kiezen' : 'Foto trekken of bestand kiezen'}
        </button>
        {!terug && <p className="text-[11px] text-gray-500 mt-1">Op je gsm kan je meteen een foto trekken. Een pdf van een factuur kan ook.</p>}
      </div>

      {t && (
        <div className="space-y-1.5">
          <span className={lbl}>Akkoord op de afspraak</span>
          <AkkoordChips stand={terugkerendStand(t, data.terugkerendAkkoorden)} namen={data.namen} ik={data.ik} bezig={akBezig} onAkkoord={akkoord} />
          {data.terugkerendAkkoorden.some((a) => a.terugkerend_id === t.id) && <p className="text-xs text-gray-500">Pas je iets aan, dan geven alle drie opnieuw akkoord. Wat al betaald is, telt altijd mee.</p>}
        </div>
      )}
      {u && data.akkoorden.some((a) => a.uitgave_id === u.id) && <p className="text-xs text-gray-500">Er staat al akkoord op deze uitgave. Pas je iets aan, dan geven Marco, Bram en Chiara opnieuw akkoord.</p>}

      <button type="button" onClick={bewaar} disabled={bezig || laden || !v.vennoot} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{bestaand ? 'Wijzigingen bewaren' : 'Bewaren'}</button>

      {t && isLopend(t, vandaag) && (
        stoppen === null ? (
          <button type="button" onClick={() => setStoppen(vandaag < t.start_datum ? t.start_datum : vandaag)} className="btn-secondary w-full justify-center text-sm"><CircleStop className="h-4 w-4" />Stoppen</button>
        ) : (
          <div className="rounded-xl border border-gray-200 p-3 space-y-2">
            <label className="block"><span className={lbl}>Laatste betaling die nog telt, tot en met</span><input type="date" className={inp} value={stoppen} min={t.start_datum} onChange={(e) => setStoppen(e.target.value)} /></label>
            <p className="text-xs text-gray-500">Wat tot dan betaald is, blijft meetellen. Daarna niet meer.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setStoppen(null)} className="btn-secondary justify-center text-sm">Annuleren</button>
              <button type="button" onClick={stop} disabled={bezig || !DAG.test(stoppen)} className="btn-primary justify-center text-sm"><CircleStop className="h-4 w-4" />Stoppen</button>
            </div>
          </div>
        )
      )}
      {onArchiveer && <button type="button" onClick={onArchiveer} className="btn-secondary w-full justify-center text-sm"><Archive className="h-4 w-4" />Archiveren</button>}
      {onSchrap && <button type="button" onClick={onSchrap} className="w-full text-xs text-gray-500 underline">Was een vergissing? Schrappen (telt dan helemaal niet mee)</button>}
    </Venster>
  )
}
