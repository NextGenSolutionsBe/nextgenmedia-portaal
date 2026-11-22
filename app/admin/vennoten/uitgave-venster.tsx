'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Archive, Camera, Check, CircleStop, Eye, Loader2, Paperclip, Repeat, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { leesGetal } from '@/lib/getal'
import {
  FREQ, FREQUENTIES, VENNOTEN, betaaldata, delenVan, gelijkVerdeeld, isLopend, terugkerendStand, volgendeBetaling,
  type BonVoorstel, type Frequentie, type Terugkerend, type Uitgave, type Vennoot,
} from '@/lib/vennoot-uitgaven'
import type { VennotenData } from '@/lib/vennoot-uitgaven-server'
import { AkkoordChips, Venster, bedragTekst, dag, eur, inp, lbl, post } from './gedeeld'

export type Soort = 'eenmalig' | 'terugkerend'
const DAG = /^\d{4}-\d{2}-\d{2}$/
const MAX_PX = 2000

/**
 * Een foto van een bonnetje verkleinen naar JPEG (max. 2000 px): sneller op te
 * laden en leesbaar voor de AI (een iPhone-foto in HEIC wordt zo ook JPEG).
 * Lukt het niet, dan gaat het origineel.
 */
async function alsJpeg(f: File): Promise<File> {
  if (!f.type.startsWith('image/') || f.type === 'image/gif') return f
  if ((f.type === 'image/jpeg' || f.type === 'image/png') && f.size < 900 * 1024) return f
  try {
    const beeld = await createImageBitmap(f)
    const schaal = Math.min(1, MAX_PX / Math.max(beeld.width, beeld.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(beeld.width * schaal); canvas.height = Math.round(beeld.height * schaal)
    canvas.getContext('2d')?.drawImage(beeld, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85))
    if (!blob) return f
    return new File([blob], (f.name || 'bon').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return f }
}

type Lezing = { status: 'bezig' } | { status: 'fout'; fout: string } | { status: 'klaar'; voorstel: BonVoorstel; vorige: Record<string, unknown> }

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
  // Voor wie: één vennoot, of (eenmalig) meerdere = de kost verdelen.
  const [wie, setWie] = useState<Vennoot[]>(u ? delenVan(u).map((d) => d.vennoot) : t ? [t.vennoot] : beginVennoot ? [beginVennoot] : [])
  const [zelfVerdelen, setZelfVerdelen] = useState(() => {
    if (!u || delenVan(u).length < 2) return false
    const gelijk = gelijkVerdeeld(u.bedrag, delenVan(u).map((d) => d.vennoot))
    return delenVan(u).some((d) => gelijk[d.vennoot] !== d.bedrag)
  })
  const [delen, setDelen] = useState<Partial<Record<Vennoot, string>>>(() => Object.fromEntries((u ? delenVan(u) : []).map((d) => [d.vennoot, bedragTekst(d.bedrag)])))
  const [datumAangeraakt, setDatumAangeraakt] = useState(!!u)
  const [lezing, setLezing] = useState<Lezing | null>(null)
  const [v, setV] = useState({
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
  const camera = useRef<HTMLInputElement>(null)
  const laatste = useRef({ v, datumAangeraakt })
  laatste.current = { v, datumAangeraakt }
  const terug = soort === 'terugkerend'
  const verdeeld = !terug && wie.length > 1
  const kiesWie = (k: Vennoot) => {
    if (terug) { setWie([k]); return }
    setWie((l) => (l.includes(k) ? l.filter((x) => x !== k) : VENNOTEN.filter((x) => x === k || l.includes(x))))
  }
  const kiesSoort = (s: Soort) => { setSoort(s); if (s === 'terugkerend' && wie.length > 1) setWie([wie[0]]) }

  // Het bonnetje lezen (enkel bij een eenmalige uitgave): vult in wat nog leeg is, de rest kan je overnemen.
  const lees = async (pad: string) => {
    setLezing({ status: 'bezig' })
    try {
      const r = await fetch('/api/admin/vennoten/bon/lezen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Het bonnetje lezen lukte niet. Vul de gegevens zelf in.')
      const p = j as BonVoorstel
      if (!p.omschrijving && !p.datum && p.bedrag === null) { setLezing({ status: 'fout', fout: p.opmerking || 'Niets leesbaars gevonden. Vul de gegevens zelf in.' }); return }
      // De velden zoals ze nu zijn (ook als er intussen getypt werd).
      const cur = laatste.current.v
      setLezing({ status: 'klaar', voorstel: p, vorige: { ...cur } })
      setV({
        ...cur,
        omschrijving: p.omschrijving && !cur.omschrijving.trim() ? p.omschrijving : cur.omschrijving,
        datum: p.datum && !laatste.current.datumAangeraakt ? p.datum : cur.datum,
        bedrag: p.bedrag !== null && !cur.bedrag.trim() ? bedragTekst(p.bedrag) : cur.bedrag,
      })
    } catch (e) { setLezing({ status: 'fout', fout: e instanceof Error ? e.message : 'Het bonnetje lezen lukte niet.' }) }
  }

  const laadBonOp = async (bestand?: File) => {
    if (!bestand) return
    setLaden(true)
    try {
      const f = await alsJpeg(bestand)
      if (f.size > 25 * 1024 * 1024) throw new Error('Het bestand is groter dan 25 MB.')
      const naam = f.name && /\.[a-z0-9]+$/i.test(f.name) ? f.name : `bon.${(f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`
      const r = await fetch('/api/admin/vennoten/bon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam, grootte: f.size }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Opladen mislukt')
      const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: j.contentType, upsert: false })
      if (error) throw new Error(error.message)
      setBon({ pad: j.pad, naam })
      if (!terug) void lees(j.pad)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally {
      setLaden(false)
      if (kiezer.current) kiezer.current.value = ''
      if (camera.current) camera.current.value = ''
    }
  }

  const bewaar = async () => {
    setBezig(true)
    try {
      const gemeen = { id: bestaand?.id, vennoot: wie[0], omschrijving: v.omschrijving, doel: v.doel, bedrag: v.bedrag, bon, bon_weg: !bon && bonWeg }
      if (terug) {
        await post({ ...gemeen, actie: t ? 'terugkerend.wijzig' : 'terugkerend.nieuw', frequentie: v.frequentie, start_datum: v.start, eind_datum: v.eindAan ? v.eind : '' })
        onKlaar(t ? 'Terugkerende uitgave aangepast.' : 'Terugkerende uitgave bewaard. Elke betaling telt vanzelf mee.')
      } else {
        await post({ ...gemeen, actie: u ? 'wijzig' : 'nieuw', datum: v.datum, vennoten: wie, verdeling: verdeeld && zelfVerdelen ? delen : undefined })
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
  const naam = wie[0] ? data.namen[wie[0]] : null
  // Verdelen: gelijk (tot op de cent) of zelf gekozen; de som moet het totaal zijn.
  const gelijk = b !== null && b > 0 ? gelijkVerdeeld(b, wie) : null
  const somDelen = wie.reduce((t, k) => t + (leesGetal(delen[k] ?? '') ?? 0), 0)
  const verschil = b !== null ? Math.round((b - somDelen) * 100) / 100 : 0
  const zetZelf = (aan: boolean) => {
    setZelfVerdelen(aan)
    if (aan && gelijk) setDelen(Object.fromEntries(wie.map((k) => [k, bedragTekst(gelijk[k] ?? 0)])))
  }
  // Wat het bonnetje anders zegt dan wat er nu staat (om over te nemen).
  const anders = lezing?.status === 'klaar' ? {
    omschrijving: !!lezing.voorstel.omschrijving && lezing.voorstel.omschrijving !== v.omschrijving,
    datum: !!lezing.voorstel.datum && lezing.voorstel.datum !== v.datum,
    bedrag: lezing.voorstel.bedrag !== null && leesGetal(v.bedrag) !== lezing.voorstel.bedrag,
  } : null
  const neemOver = () => {
    if (lezing?.status !== 'klaar') return
    const p = lezing.voorstel
    setV((cur) => ({ ...cur, omschrijving: p.omschrijving ?? cur.omschrijving, datum: p.datum ?? cur.datum, bedrag: p.bedrag !== null ? bedragTekst(p.bedrag) : cur.bedrag }))
  }
  const ongedaan = () => {
    if (lezing?.status !== 'klaar') return
    setV((cur) => ({ ...cur, ...(lezing.vorige as Partial<typeof cur>) }))
    setLezing(null)
  }

  const bonBlok = (
    <div>
      <span className={lbl}>{terug ? 'Contract of factuur (mag later)' : 'Bonnetje of factuur'}</span>
      <input ref={kiezer} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => laadBonOp(e.target.files?.[0])} />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => laadBonOp(e.target.files?.[0])} />
      {huidigeBon && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 mb-2 text-sm">
          <Paperclip className="h-4 w-4 text-gray-400 shrink-0" />
          <span className="truncate flex-1 min-w-0">{huidigeBon.bewijs_naam ?? 'Document'}</span>
          <a href={`/api/admin/vennoten/bon?pad=${encodeURIComponent(huidigeBon.bewijs_pad!)}`} target="_blank" rel="noreferrer" className="h-8 px-2 rounded-lg inline-flex items-center gap-1 text-xs hover:bg-gray-100"><Eye className="h-3.5 w-3.5" />Bekijken</a>
          <button type="button" onClick={() => setBonWeg(true)} className="h-8 px-2 rounded-lg inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />Weghalen</button>
        </div>
      )}
      {bonWeg && !bon && <p className="text-xs text-amber-800 mb-2">Het document gaat weg bij het bewaren. <button type="button" onClick={() => setBonWeg(false)} className="underline">Ongedaan maken</button></p>}
      {bon && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 mb-2 text-sm text-green-900">
          <Check className="h-4 w-4 shrink-0" /><span className="truncate flex-1 min-w-0">{bon.naam}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => camera.current?.click()} disabled={laden} className={`${bon || huidigeBon ? 'btn-secondary' : 'btn-primary'} text-sm justify-center`}>
          {laden ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{bon || huidigeBon ? 'Nieuwe foto' : 'Foto trekken'}
        </button>
        <button type="button" onClick={() => kiezer.current?.click()} disabled={laden} className="btn-secondary text-sm justify-center"><Paperclip className="h-4 w-4" />{bon || huidigeBon ? 'Ander bestand' : 'Bestand kiezen'}</button>
      </div>
      {!terug && !lezing && !bon && !huidigeBon && <p className="text-[11px] text-gray-500 mt-1.5">Trek een foto van het bonnetje: de app leest wat het is, de datum en het bedrag.</p>}
      {!terug && lezing?.status === 'bezig' && <p className="mt-2 text-xs text-gray-600 inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Het bonnetje wordt gelezen…</p>}
      {!terug && lezing?.status === 'fout' && <p className="mt-2 text-xs text-amber-800">{lezing.fout}</p>}
      {!terug && lezing?.status === 'klaar' && (
        <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5 text-sm space-y-1.5">
          <p className="flex items-start gap-1.5 text-violet-950">
            <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Van het bonnetje: {[lezing.voorstel.winkel, lezing.voorstel.datum ? dag(lezing.voorstel.datum) : null, lezing.voorstel.bedrag !== null ? eur(lezing.voorstel.bedrag) : null].filter(Boolean).join(' · ') || 'weinig leesbaar'}. Kijk het na.</span>
          </p>
          {lezing.voorstel.opmerking && <p className="text-xs text-amber-800">{lezing.voorstel.opmerking}</p>}
          {lezing.voorstel.zekerheid > 0 && lezing.voorstel.zekerheid < 0.6 && <p className="text-xs text-amber-800">De app is niet zeker van wat ze las.</p>}
          <div className="flex gap-2 flex-wrap">
            {anders && (anders.omschrijving || anders.datum || anders.bedrag) && <button type="button" onClick={neemOver} className="text-xs px-2.5 py-1 rounded-full bg-violet-900 text-white inline-flex items-center gap-1"><Check className="h-3 w-3" />Overnemen</button>}
            <button type="button" onClick={ongedaan} className="text-xs px-2.5 py-1 rounded-full border border-violet-200 bg-white inline-flex items-center gap-1 text-violet-900"><Undo2 className="h-3 w-3" />Ongedaan maken</button>
          </div>
        </div>
      )}
    </div>
  )
  const titel = t ? 'Terugkerende uitgave' : u ? 'Uitgave aanpassen' : 'Nieuwe uitgave'

  return (
    <Venster titel={titel} onSluit={onSluit}>
      {!bestaand && (
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-100" role="group" aria-label="Soort uitgave">
          {(['eenmalig', 'terugkerend'] as const).map((s) => (
            <button key={s} type="button" onClick={() => kiesSoort(s)} aria-pressed={soort === s}
              className={`h-9 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-1.5 ${soort === s ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}>
              {s === 'terugkerend' && <Repeat className="h-3.5 w-3.5" />}{s === 'eenmalig' ? 'Eenmalig' : 'Terugkerend'}
            </button>
          ))}
        </div>
      )}
      {terug && !bestaand && <p className="text-xs text-gray-500 -mt-2">Lease, huur, een abonnement: een vast bedrag elke maand, elk kwartaal of elk jaar.</p>}

      {!terug && bonBlok}

      <div>
        <span className={lbl}>Voor wie</span>
        <div className="grid grid-cols-3 gap-2">
          {VENNOTEN.map((k) => (
            <button key={k} type="button" onClick={() => kiesWie(k)} aria-pressed={wie.includes(k)} className={`h-10 rounded-lg border text-sm font-medium inline-flex items-center justify-center gap-1 ${wie.includes(k) ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}>
              {!terug && wie.includes(k) && <Check className="h-3.5 w-3.5" />}{data.namen[k]}
            </button>
          ))}
        </div>
        {!terug && wie.length === 1 && <p className="text-[11px] text-gray-500 mt-1.5">Voor meer dan één vennoot? Tik er nog een aan en de kost wordt verdeeld.</p>}
        {verdeeld && (
          <div className="mt-2 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm space-y-2">
            {!zelfVerdelen ? (
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-800">
                  {gelijk ? <>Gelijk verdeeld: {wie.map((k) => `${data.namen[k]} ${eur(gelijk[k] ?? 0)}`).join(' · ')}</> : <>Gelijk verdeeld over {wie.map((k) => data.namen[k]).join(' en ')}</>}
                </span>
                <button type="button" onClick={() => zetZelf(true)} className="text-xs underline text-gray-600 shrink-0">Anders verdelen</button>
              </div>
            ) : (
              <>
                <div className={`grid gap-2 ${wie.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {wie.map((k) => (
                    <label key={k} className="block"><span className={lbl}>{data.namen[k]} (€)</span>
                      <input inputMode="decimal" className={`${inp} bg-white`} value={delen[k] ?? ''} onChange={(e) => setDelen({ ...delen, [k]: e.target.value })} placeholder="0,00" />
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={b === null ? 'text-gray-500' : Math.abs(verschil) < 0.005 ? 'text-green-700' : 'text-red-600'}>
                    {b === null ? 'Vul eerst het totaal in.' : Math.abs(verschil) < 0.005 ? `Samen ${eur(b)}, klopt.` : verschil > 0 ? `Nog ${eur(verschil)} te verdelen.` : `${eur(-verschil)} te veel.`}
                  </span>
                  <button type="button" onClick={() => zetZelf(false)} className="underline text-gray-600">Gelijk verdelen</button>
                </div>
              </>
            )}
          </div>
        )}
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
          <label className="block"><span className={lbl}>Wanneer</span><input type="date" className={inp} value={v.datum} max={vandaag} onChange={(e) => { setDatumAangeraakt(true); setV({ ...v, datum: e.target.value }) }} /></label>
          <label className="block"><span className={lbl}>{verdeeld ? 'Totaal (€, incl. btw)' : 'Bedrag (€, incl. btw)'}</span><input inputMode="decimal" className={inp} value={v.bedrag} onChange={(e) => setV({ ...v, bedrag: e.target.value })} placeholder="0,00" /></label>
        </div>
      )}

      {terug && bonBlok}

      {t && (
        <div className="space-y-1.5">
          <span className={lbl}>Akkoord op de afspraak</span>
          <AkkoordChips stand={terugkerendStand(t, data.terugkerendAkkoorden)} namen={data.namen} ik={data.ik} bezig={akBezig} onAkkoord={akkoord} />
          {data.terugkerendAkkoorden.some((a) => a.terugkerend_id === t.id) && <p className="text-xs text-gray-500">Pas je iets aan, dan geven alle drie opnieuw akkoord. Wat al betaald is, telt altijd mee.</p>}
        </div>
      )}
      {u && data.akkoorden.some((a) => a.uitgave_id === u.id) && <p className="text-xs text-gray-500">Er staat al akkoord op deze uitgave. Pas je iets aan, dan geven Marco, Bram en Chiara opnieuw akkoord.</p>}

      <button type="button" onClick={bewaar} disabled={bezig || laden || !wie.length || (verdeeld && zelfVerdelen && Math.abs(verschil) >= 0.005)} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{bestaand ? 'Wijzigingen bewaren' : 'Bewaren'}</button>

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
