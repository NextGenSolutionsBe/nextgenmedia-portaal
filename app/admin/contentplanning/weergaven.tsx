'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus, StickyNote, Check, Loader2, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { isAchterstallig, isKlaar, maandVan, batchNr, BORD_BATCHES, BORD_MAANDELIJKS, opBordMaandelijks, type Reeks } from '@/lib/contentplanning/model'
import { StatusBadge, focusRing } from './bouwstenen'
import { KAART } from './werking'
import type { CpData, Doe, Notitie, Taak } from './types'
import { datumNl } from './types'

export type WeergaveProps = {
  data: CpData; taken: Taak[]; vandaag: string; anker: string; doe: Doe
  klantNaam: (id: string | null) => string | null
  notitiesVan: (taakId: string) => number
  reeksenOp: (d: string) => Reeks[]
  onTaak: (t: Taak | null, standaard?: Partial<Taak>) => void
  onKlant: (id: string) => void
  onDag: (d: string) => void
  onNotities: (scope: Partial<Notitie> & { titel: string }) => void
  vink: (t: Taak) => void
  verplaats: (t: Taak, datum: string | null) => void
  kanSchrijven: boolean
}

// ── Klantenbord ─────────────────────────────────────────────────────────────
// Altijd vier kolommen: Batch 1, Batch 2, Batch 3 (cycli van drie maanden) en
// Maandelijks (ook leeg). Maandelijks is het ritme van de klant, hetzelfde veld
// als op de klantfiche. Klanten slepen tussen de kolommen; nieuwe klant = naam +
// kolom. Klanten zonder batch (of in een andere batch) staan in een extra kolom,
// zodat er niemand verdwijnt.
type Kolom = { key: string; titel: string; nr: number | null; batchId: string | null; maandelijks?: boolean; klanten: string[] }
const MAANDELIJKS = '__maandelijks'
type NieuwKolom = number | typeof BORD_MAANDELIJKS

export function Klantenbord(p: WeergaveProps) {
  const { data, vandaag, anker } = p
  const st = data.instellingen.statussen
  const maand = maandVan(anker)
  const kan = data.kan.beheren
  const [sleepKlant, setSleepKlant] = useState<string | null>(null)
  const [doel, setDoel] = useState<string | null>(null)
  const [naam, setNaam] = useState('')
  const [nieuwNr, setNieuwNr] = useState<NieuwKolom>(1)
  const [bezig, setBezig] = useState(false)
  // Meteen tonen waar een klant naartoe gesleept is (bewaren volgt).
  const [lokaal, setLokaal] = useState<Record<string, string | null>>({})
  useEffect(() => { setLokaal({}) }, [data])

  const actief = data.cpKlanten.filter((k) => k.actief)
  const klanten = new Map(data.klanten.map((k) => [k.id, k]))
  const ritmes = new Map(data.cpKlanten.map((k) => [k.client_id, k.ritme]))
  const isMaandelijks = (cid: string) => (cid in lokaal ? lokaal[cid] === MAANDELIJKS : opBordMaandelijks(ritmes.get(cid)))
  const batchVan = (cid: string) => (cid in lokaal && lokaal[cid] !== MAANDELIJKS ? lokaal[cid] : klanten.get(cid)?.batch_id ?? null)
  const inBatch = actief.filter((k) => !isMaandelijks(k.client_id))
  const takenVan = useMemo(() => {
    const m = new Map<string, Taak[]>()
    for (const t of data.taken) { if (!t.cyclus_id) continue; const c = data.cycli.find((x) => x.id === t.cyclus_id); if (!c || c.maand !== maand) continue; const l = m.get(c.client_id) ?? []; l.push(t); m.set(c.client_id, l) }
    return m
  }, [data.taken, data.cycli, maand])
  const opNaam = (a: string, b: string) => (klanten.get(a)?.company_name ?? '').localeCompare(klanten.get(b)?.company_name ?? '', 'nl')

  const vast: Kolom[] = BORD_BATCHES.map((n) => {
    const b = data.batches.find((x) => batchNr(x.name) === n)
    const hier = (cid: string) => (b ? batchVan(cid) === b.id : batchVan(cid) === `nieuw-${n}`)
    return { key: `nr-${n}`, titel: `Batch ${n}`, nr: n, batchId: b?.id ?? null, klanten: inBatch.filter((k) => hier(k.client_id)).map((k) => k.client_id).sort(opNaam) }
  })
  const maandelijks: Kolom = { key: 'maandelijks', titel: 'Maandelijks', nr: null, batchId: null, maandelijks: true, klanten: actief.filter((k) => isMaandelijks(k.client_id)).map((k) => k.client_id).sort(opNaam) }
  const vasteIds = new Set(vast.map((k) => k.batchId).filter(Boolean))
  const overigeBatches: Kolom[] = data.batches.filter((b) => !vasteIds.has(b.id))
    .map((b) => ({ key: b.id, titel: b.name, nr: null, batchId: b.id, klanten: inBatch.filter((k) => batchVan(k.client_id) === b.id).map((k) => k.client_id).sort(opNaam) }))
    .filter((k) => k.klanten.length > 0)
  const zonder = inBatch.filter((k) => { const b = batchVan(k.client_id); return !b || (!b.startsWith('nieuw-') && !data.batches.some((x) => x.id === b)) }).map((k) => k.client_id).sort(opNaam)
  const kolommen: Kolom[] = [...vast, maandelijks, ...overigeBatches, ...(zonder.length ? [{ key: '__geen', titel: 'Nog geen batch', nr: null, batchId: null, klanten: zonder }] : [])]

  const naarKolom = async (cid: string, k: Kolom) => {
    if (!kan) return
    const naamK = klanten.get(cid)?.company_name ?? 'Klant'
    if (k.maandelijks) {
      if (isMaandelijks(cid)) return
      setLokaal((l) => ({ ...l, [cid]: MAANDELIJKS }))
      const r = await p.doe('bord.batch', { client_id: cid, batch_nr: BORD_MAANDELIJKS }, { melding: `${naamK} → Maandelijks` })
      if (!r) setLokaal((l) => { const n = { ...l }; delete n[cid]; return n })
      return
    }
    // Een maandelijkse klant naar zijn eigen batch (of naar "Nog geen batch") slepen verandert wel het ritme.
    if (!isMaandelijks(cid) && batchVan(cid) === k.batchId && k.batchId !== null) return
    if (k.key === '__geen' && !batchVan(cid) && !isMaandelijks(cid)) return
    setLokaal((l) => ({ ...l, [cid]: k.batchId ?? (k.nr ? `nieuw-${k.nr}` : null) }))
    const r = k.nr
      ? await p.doe('bord.batch', { client_id: cid, batch_nr: k.nr }, { melding: `${naamK} → ${k.titel}` })
      : k.key === '__geen'
        ? await p.doe('bord.batch', { client_id: cid, batch_nr: null }, { melding: `${naamK} uit de batch gehaald` })
        : await p.doe('klant.wijzig', { client_id: cid, batch_id: k.batchId }, { melding: `${naamK} → ${k.titel}` })
    if (!r) setLokaal((l) => { const n = { ...l }; delete n[cid]; return n })
  }
  const drop = (k: Kolom, e: React.DragEvent) => { setDoel(null); const cid = e.dataTransfer.getData('text/plain') || sleepKlant; setSleepKlant(null); if (cid && klanten.has(cid)) naarKolom(cid, k) }

  const maakNieuw = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!naam.trim() || bezig) return
    setBezig(true)
    const r = await p.doe('klant.nieuw', { naam: naam.trim(), batch_nr: nieuwNr }, { stil: true })
    setBezig(false)
    const waar = nieuwNr === BORD_MAANDELIJKS ? 'Maandelijks' : `Batch ${nieuwNr}`
    if (r) { toast.success(r.bestond ? `${naam.trim()} bestond al en staat nu in ${waar}.` : `${naam.trim()} toegevoegd aan ${waar}.`); setNaam('') }
  }

  const kaart = (cid: string) => {
    const k = klanten.get(cid)
    const tk = (takenVan.get(cid) ?? []).sort((a, b) => a.volgorde - b.volgorde)
    const open = tk.filter((t) => !isKlaar(t.status, st))
    const volgende = [...open].sort((a, b) => (a.werkdatum ?? '9999').localeCompare(b.werkdatum ?? '9999'))[0]
    const laat = open.some((t) => isAchterstallig(t, vandaag, st))
    const nNot = data.notities.filter((n) => n.client_id === cid && !n.taak_id).length
    return (
      <div key={cid} draggable={kan} onDragStart={(e) => { setSleepKlant(cid); e.dataTransfer.setData('text/plain', cid); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { setSleepKlant(null); setDoel(null) }}
        className={`group rounded-xl border-2 bg-cp-vlak p-3.5 space-y-2 shadow-sm transition-all ${laat ? 'border-orange-400' : 'border-cp-rand'} ${kan ? 'cursor-grab active:cursor-grabbing hover:border-cp-ink hover:shadow-md' : ''} ${sleepKlant === cid ? 'opacity-40 scale-[0.98]' : ''}`}>
        <div className="flex items-center gap-2">
          {kan && <GripVertical className="h-4 w-4 text-cp-zacht shrink-0" aria-hidden />}
          <button type="button" onClick={() => p.onKlant(cid)} className={`flex-1 min-w-0 text-left text-cp-basis font-bold truncate hover:underline ${focusRing} rounded`}>{k?.company_name ?? '—'}</button>
          {nNot > 0 && <StickyNote className="h-4 w-4 text-cp-zacht shrink-0" aria-label="heeft notities" />}
        </div>
        {volgende
          ? <div className="text-cp-klein"><b className="font-semibold">{volgende.titel}</b> <span className="text-cp-zacht">{volgende.werkdatum ? datumNl(volgende.werkdatum) : ''}</span> <StatusBadge status={volgende.status} statussen={st} klein /></div>
          : tk.length > 0 && <div className="text-cp-klein font-semibold inline-flex items-center gap-1"><Check className="h-4 w-4" />Alles klaar</div>}
        {laat && <div className="text-cp-klein text-orange-700 font-semibold inline-flex items-center gap-1"><AlertTriangle className="h-4 w-4" />Over tijd</div>}
        {/* Maandelijks: de batch blijft bepalen wanneer de kwartaalmeeting valt. */}
        {isMaandelijks(cid) && (() => { const b = data.batches.find((x) => x.id === batchVan(cid)); return <div className="text-cp-klein text-cp-zacht">{b ? `Kwartaal volgt ${b.name}` : 'Geen batch voor wat per kwartaal gebeurt'}</div> })()}
        {/* Telefoon/tablet: verplaatsen zonder slepen */}
        {kan && (
          <select className="md:hidden w-full h-10 rounded-lg border border-cp-rand bg-cp-vlak px-2 text-cp-klein" aria-label={`Batch van ${k?.company_name}`}
            value={kolommen.find((c) => c.klanten.includes(cid))?.key ?? ''} onChange={(e) => { const c = kolommen.find((x) => x.key === e.target.value); if (c) naarKolom(cid, c) }}>
            {kolommen.map((c) => <option key={c.key} value={c.key}>{c.titel}</option>)}
          </select>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {kan && (
        <form onSubmit={maakNieuw} className={`${KAART} p-4 flex items-center gap-3 flex-wrap`}>
          <input value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Naam nieuwe klant" aria-label="Naam nieuwe klant" maxLength={200}
            className="flex-1 min-w-[200px] h-12 rounded-xl border-2 border-cp-rand bg-cp-vlak px-4 text-cp-basis focus:outline-none focus:border-cp-ink" />
          <div role="radiogroup" aria-label="Batch of maandelijks" className="inline-flex flex-wrap rounded-xl border-2 border-cp-rand overflow-hidden">
            {[...BORD_BATCHES, BORD_MAANDELIJKS].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={nieuwNr === n} onClick={() => setNieuwNr(n)}
                className={`h-11 px-4 text-cp-basis font-semibold border-l-2 first:border-l-0 border-cp-rand transition-colors ${nieuwNr === n ? 'bg-cp-ink text-cp-op-ink' : 'bg-cp-vlak hover:bg-cp-achtergrond'} ${focusRing}`}>{n === BORD_MAANDELIJKS ? 'Maandelijks' : `Batch ${n}`}</button>
            ))}
          </div>
          <button type="submit" disabled={!naam.trim() || bezig} className={`inline-flex items-center gap-2 h-12 px-5 rounded-xl bg-cp-ink text-cp-op-ink text-cp-basis font-semibold disabled:opacity-40 hover:opacity-90 active:scale-[0.98] transition-all ${focusRing}`}>
            {bezig ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}Toevoegen
          </button>
        </form>
      )}
      <div className="flex gap-4 overflow-x-auto pb-2 snap-x md:grid md:overflow-visible" style={{ gridTemplateColumns: `repeat(${kolommen.length}, minmax(0, 1fr))` }}>
        {kolommen.map((k) => (
          <section key={k.key} onDragOver={(e) => { if (!kan) return; e.preventDefault(); setDoel(k.key) }} onDragLeave={() => setDoel((d) => (d === k.key ? null : d))} onDrop={(e) => { e.preventDefault(); drop(k, e) }}
            className={`snap-start shrink-0 w-[280px] md:w-auto rounded-cp border-2 p-3 space-y-3 transition-colors ${doel === k.key ? 'border-cp-ink bg-cp-vlak' : 'border-transparent bg-cp-achtergrond'} ${k.key === '__geen' ? 'border-dashed !border-cp-rand' : ''}`}>
            <div className="flex items-center justify-between px-1">
              <h3 className="text-cp-kop">{k.titel}</h3>
              <div className="flex items-center gap-2">
                <span className="h-8 min-w-8 px-2 inline-flex items-center justify-center rounded-full bg-cp-vlak border border-cp-rand text-cp-klein font-bold">{k.klanten.length}</span>
                {k.batchId && <button type="button" onClick={() => p.onNotities({ batch_id: k.batchId!, soort: 'afspraak', titel: `Notities · ${k.titel}` })} className={`h-8 w-8 inline-flex items-center justify-center rounded-lg text-cp-zacht hover:text-cp-ink hover:bg-cp-vlak ${focusRing}`} aria-label={`Notities bij ${k.titel}`}><StickyNote className="h-4 w-4" /></button>}
              </div>
            </div>
            <div className="space-y-2.5 min-h-[120px]">
              {k.klanten.length === 0
                ? <div className={`h-[120px] rounded-xl border-2 border-dashed flex items-center justify-center text-cp-klein text-cp-zacht ${doel === k.key ? 'border-cp-ink' : 'border-cp-rand'}`}>{kan ? 'Sleep een klant hierheen' : '—'}</div>
                : k.klanten.map(kaart)}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

export { StatusBadge }
