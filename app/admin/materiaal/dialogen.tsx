'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Check, Search, Undo2, Camera, Eye, FileText, Paperclip, Sparkles, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { alsJpeg, naamMetExtensie } from '@/lib/foto-naar-jpeg'
import { perStuk, regelsUit, type FactuurVoorstel } from '@/lib/materiaal/factuur'
import { INP } from '@/app/admin/instellingen/ui'
import { ONTLENER_TYPES, datumKort, datumLang, naamVan, vandaagBE } from '@/lib/materiaal/model'
import type { Data, Item, Ontlener, Uitlening, Doe } from './types'
import { zoekVeld } from '@/lib/zoekveld'

export const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1'
const lbl = 'block text-xs font-medium text-gray-700 mb-1'
const nieuweSleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)
/** Nu als waarde voor <input type="datetime-local"> (lokale tijd van de browser). */
const nuLokaal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const lokaalVan = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

export function Modal({ titel, sub, onSluit, children, voet, breed }: { titel: ReactNode; sub?: ReactNode; onSluit: () => void; children: ReactNode; voet?: ReactNode; breed?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40" role="dialog" aria-modal="true">
      <div className={`bg-white w-full ${breed ? 'sm:max-w-2xl' : 'sm:max-w-md'} rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] flex flex-col overflow-hidden`}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
          <div className="flex-1 min-w-0"><h3 className="font-semibold text-gray-900">{titel}</h3>{sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}</div>
          <button type="button" onClick={onSluit} className={`h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 ${focusRing}`} aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        {voet && <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex gap-2 justify-end flex-wrap">{voet}</div>}
      </div>
    </div>
  )
}

/** Zoekbare keuze van een medewerker. */
function KiesOntlener({ ontleners, waarde, onKies, actiefPer }: { ontleners: Ontlener[]; waarde: string; onKies: (id: string) => void; actiefPer: Map<string, number> }) {
  const [q, setQ] = useState('')
  const lijst = ontleners.filter((o) => !o.gearchiveerd_op && `${naamVan(o)} ${o.email ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  const gekozen = ontleners.find((o) => o.id === waarde)
  return (
    <div className="space-y-1.5">
      {gekozen ? (
        <div className="flex items-center gap-2 rounded-lg border border-black bg-gray-100 px-3 py-2 text-sm">
          <span className="flex-1 font-medium">{naamVan(gekozen)}{!gekozen.email && <span className="ml-2 text-[11px] text-amber-700">geen e-mailadres</span>}</span>
          <button type="button" onClick={() => onKies('')} className="text-xs underline">wijzigen</button>
        </div>
      ) : (
        <>
          <div className="relative"><Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" /><input {...zoekVeld()} autoFocus className={`${INP} pl-9`} placeholder="Zoek medewerker…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Zoek medewerker" /></div>
          <ul className="max-h-48 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200">
            {lijst.map((o) => (
              <li key={o.id}><button type="button" onClick={() => onKies(o.id)} className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${focusRing}`}>
                <span className="flex-1">{naamVan(o)}{o.type && <span className="text-[11px] text-gray-500"> · {ONTLENER_TYPES.find((t) => t.key === o.type)?.label}</span>}</span>
                {(actiefPer.get(o.id) ?? 0) > 0 && <span className="text-[11px] text-orange-700">{actiefPer.get(o.id)} in gebruik</span>}
              </button></li>
            ))}
            {lijst.length === 0 && <li className="px-3 py-3 text-xs text-gray-500">Niemand gevonden. Voeg de persoon toe onder Medewerkers.</li>}
          </ul>
        </>
      )}
    </div>
  )
}

/** Uitlenen: één item (standaard) of meerdere items aan dezelfde persoon. */
export function UitleenDialoog({ data, items, ontlenerId, meerdere, doe, onSluit }: { data: Data; items: Item[]; ontlenerId?: string; meerdere?: boolean; doe: Doe; onSluit: () => void }) {
  const [ontlener, setOntlener] = useState(ontlenerId ?? '')
  const [gekozen, setGekozen] = useState<string[]>(items.map((i) => i.id))
  const [op, setOp] = useState(nuLokaal())
  const [verwacht, setVerwacht] = useState('')
  const [opmerking, setOpmerking] = useState('')
  const [zoek, setZoek] = useState('')
  const [bezig, setBezig] = useState(false)
  const sleutel = useRef(nieuweSleutel())
  const actief = useMemo(() => new Set(data.uitleningen.filter((u) => !u.teruggebracht_op && !u.geannuleerd_op).map((u) => u.item_id)), [data.uitleningen])
  const beschikbaar = data.items.filter((i) => !i.gearchiveerd_op && !actief.has(i.id))
  const actiefPer = useMemo(() => { const m = new Map<string, number>(); for (const u of data.uitleningen) if (!u.teruggebracht_op && !u.geannuleerd_op) m.set(u.ontlener_id, (m.get(u.ontlener_id) ?? 0) + 1); return m }, [data.uitleningen])
  const bevestig = async () => {
    if (!ontlener) { toast.error('Kies aan wie je uitleent.'); return }
    if (!gekozen.length) { toast.error('Kies minstens één materiaalitem.'); return }
    if (verwacht && verwacht < op.slice(0, 10)) { toast.error('De verwachte retourdatum ligt vóór de uitleendatum.'); return }
    setBezig(true)
    const r = await doe('uitlenen', { item_ids: gekozen, ontlener_id: ontlener, uitgeleend_op: new Date(op).toISOString(), verwacht_terug: verwacht || null, opmerking: opmerking || null, sleutel: sleutel.current }, { stil: true })
    setBezig(false)
    if (!r) return
    const wie = naamVan(data.ontleners.find((o) => o.id === ontlener))
    const fouten = (r.fouten as string[] | undefined) ?? []
    toast.success(`${Number(r.uitgeleend)} item${Number(r.uitgeleend) === 1 ? '' : 's'} uitgeleend aan ${wie}.${r.mail === 'verzonden' ? ' Bevestigingsmail verzonden.' : r.mail === 'geen_email' ? ' Geen mail: e-mailadres ontbreekt.' : r.mail === 'mislukt' ? ' De mail is mislukt — opnieuw verzenden kan via Activiteiten.' : ''}`)
    if (fouten.length) toast.warning(fouten.join(' · '))
    onSluit()
  }
  const titel = items.length === 1 && !meerdere ? items[0].naam : 'Materiaal uitlenen'
  return (
    <Modal titel={titel} sub={items.length === 1 && !meerdere ? 'Uitlenen' : 'Meerdere items aan dezelfde persoon'} onSluit={onSluit}
      voet={<><button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button><button type="button" onClick={bevestig} disabled={bezig || !ontlener || !gekozen.length} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bevestigen &amp; uitlenen</button></>}>
      {meerdere && (
        <div>
          <label className={lbl}>Materiaal ({gekozen.length} gekozen)</label>
          <input {...zoekVeld()} className={`${INP} mb-1.5`} placeholder="Zoek materiaal…" value={zoek} onChange={(e) => setZoek(e.target.value)} aria-label="Zoek materiaal" />
          <ul className="max-h-44 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200">
            {beschikbaar.filter((i) => `${i.naam} ${i.merk ?? ''} ${i.serienummer ?? ''}`.toLowerCase().includes(zoek.trim().toLowerCase())).map((i) => (
              <li key={i.id}><label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"><input type="checkbox" className="h-4 w-4" checked={gekozen.includes(i.id)} onChange={(e) => setGekozen(e.target.checked ? [...gekozen, i.id] : gekozen.filter((x) => x !== i.id))} /><span className="flex-1">{i.naam}</span>{i.serienummer && <span className="text-[11px] text-gray-400">{i.serienummer}</span>}</label></li>
            ))}
            {beschikbaar.length === 0 && <li className="px-3 py-3 text-xs text-gray-500">Geen beschikbaar materiaal.</li>}
          </ul>
        </div>
      )}
      <div><label className={lbl}>Uitlenen aan</label><KiesOntlener ontleners={data.ontleners} waarde={ontlener} onKies={setOntlener} actiefPer={actiefPer} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lbl}>Uitleendatum</label><input type="datetime-local" className={INP} value={op} onChange={(e) => setOp(e.target.value)} /></div>
        <div><label className={lbl}>Verwachte retour <span className="text-gray-400 font-normal">— optioneel</span></label><input type="date" className={INP} value={verwacht} min={vandaagBE()} onChange={(e) => setVerwacht(e.target.value)} /></div>
      </div>
      <div><label className={lbl}>Opmerking <span className="text-gray-400 font-normal">— optioneel</span></label><input className={INP} value={opmerking} onChange={(e) => setOpmerking(e.target.value)} placeholder="bv. met 2 batterijen en lader" /></div>
      <p className="text-[11px] text-gray-500">Na bevestigen krijgt de persoon automatisch een bevestigingsmail (registratie, geen handtekening).</p>
    </Modal>
  )
}

/** Terugnemen: één klik + bevestiging dat het materiaal fysiek terug is. */
export function TerugDialoog({ item, uitlening, ontlener, doe, onSluit }: { item: Item; uitlening: Uitlening; ontlener: Ontlener | undefined; doe: Doe; onSluit: () => void }) {
  const [opmerking, setOpmerking] = useState('')
  const [bezig, setBezig] = useState(false)
  const bevestig = async () => {
    setBezig(true)
    const r = await doe('terugnemen', { uitlening_id: uitlening.id, terug_opmerking: opmerking || null }, { stil: true })
    setBezig(false)
    if (!r) return
    toast.success(`${item.naam} is terug en weer beschikbaar.${r.mail === 'verzonden' ? ' Bevestigingsmail verzonden.' : r.mail === 'mislukt' ? ' De mail is mislukt — opnieuw verzenden kan via Activiteiten.' : r.mail === 'geen_email' ? ' Geen mail: e-mailadres ontbreekt.' : ''}`)
    onSluit()
  }
  return (
    <Modal titel={item.naam} sub="Terugnemen" onSluit={onSluit}
      voet={<><button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button><button type="button" onClick={bevestig} disabled={bezig} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}Bevestigen als teruggebracht</button></>}>
      <dl className="grid grid-cols-[150px_1fr] gap-y-1 text-sm">
        <dt className="text-gray-500">Momenteel uitgeleend aan</dt><dd className="font-medium">{naamVan(ontlener)}</dd>
        <dt className="text-gray-500">Uitgeleend sinds</dt><dd>{datumLang(uitlening.uitgeleend_op)}</dd>
        {uitlening.verwacht_terug && <><dt className="text-gray-500">Verwacht terug</dt><dd>{datumLang(uitlening.verwacht_terug)}</dd></>}
      </dl>
      <p className="text-sm font-medium">Bevestig je dat dit materiaal fysiek is teruggebracht?</p>
      <div><label className={lbl}>Staat van het materiaal <span className="text-gray-400 font-normal">— optioneel</span></label><input className={INP} value={opmerking} onChange={(e) => setOpmerking(e.target.value)} placeholder="bv. in orde / kras op de lens" /></div>
    </Modal>
  )
}

/** Materiaal toevoegen of bewerken. Met een foto of pdf van de factuur vult de app alles over het toestel in. */
export function ItemFormulier({ data, item, doe, onSluit }: { data: Data; item: Item | null; doe: Doe; onSluit: () => void }) {
  const [v, setV] = useState<Velden>(() => ({
    naam: item?.naam ?? '', categorie_id: item?.categorie_id ?? '', merk: item?.merk ?? '', model: item?.model ?? '', serienummer: item?.serienummer ?? '',
    aankoopdatum: item?.aankoopdatum ?? '', aankoopwaarde: item?.aankoopwaarde === null || item?.aankoopwaarde === undefined ? '' : String(item.aankoopwaarde).replace('.', ','), opmerkingen: item?.opmerkingen ?? '',
    omschrijving: item?.omschrijving ?? '', inhoud: (item?.inhoud ?? []).join('\n'), kenmerken: (item?.kenmerken ?? []).join('\n'),
    leverancier: item?.leverancier ?? '', factuurnummer: item?.factuurnummer ?? '', garantie_tot: item?.garantie_tot ?? '',
  }))
  const [nieuweCat, setNieuweCat] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [bezig, setBezig] = useState(false)
  // De factuur: net opgeladen (nog niet bewaard), of de huidige weghalen.
  const [factuur, setFactuur] = useState<{ pad: string; naam: string } | null>(null)
  const [factuurWeg, setFactuurWeg] = useState(false)
  const [laden, setLaden] = useState(false)
  const [lezing, setLezing] = useState<Lezing | null>(null)
  const [stuk, setStuk] = useState(0)
  const camera = useRef<HTMLInputElement>(null)
  const kiezer = useRef<HTMLInputElement>(null)
  const laatste = useRef(v)
  laatste.current = v
  const zet = (k: keyof Velden, w: string) => setV((x) => ({ ...x, [k]: w }))
  const huidigeFactuur = item?.factuur_pad && !factuurWeg && !factuur ? item : null
  const catId = (naam: string | null) => (naam ? data.categorieen.find((c) => c.naam === naam)?.id ?? '' : '')

  // Een toestel van de factuur in het formulier zetten: enkel lege velden, of alles bij een bewuste keuze.
  const vulIn = (p: FactuurVoorstel, s: Stuk, alles: boolean) => {
    const cur = laatste.current
    const nieuw: Partial<Velden> = {
      naam: s.naam, categorie_id: catId(s.categorie), merk: s.merk ?? '', model: s.model ?? '', serienummer: s.serienummer ?? '',
      aankoopdatum: p.datum ?? '', aankoopwaarde: s.prijs_excl !== null ? s.prijs_excl.toFixed(2).replace('.', ',') : '',
      omschrijving: s.omschrijving ?? '', inhoud: s.inhoud.join('\n'), kenmerken: s.kenmerken.join('\n'),
      leverancier: p.leverancier ?? '', factuurnummer: p.factuurnummer ?? '', garantie_tot: p.garantie_tot ?? '',
    }
    // Bij een bewuste keuze hoort alles van het toestel zelf bij dat toestel (ook een leeg serienummer);
    // wat van de hele factuur is (datum, leverancier …) vult enkel aan.
    const VAN_TOESTEL: (keyof Velden)[] = ['naam', 'categorie_id', 'merk', 'model', 'serienummer', 'aankoopwaarde', 'omschrijving', 'inhoud', 'kenmerken']
    const uit = { ...cur }
    for (const [k, w] of Object.entries(nieuw) as [keyof Velden, string][]) {
      if (alles && VAN_TOESTEL.includes(k)) uit[k] = w
      else if (w && (alles || !cur[k].trim())) uit[k] = w
    }
    setV(uit)
  }

  const leesFactuur = async (pad: string) => {
    setLezing({ status: 'bezig' })
    try {
      const r = await fetch('/api/admin/materiaal/factuur', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'lezen', pad }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'De factuur lezen lukte niet. Vul de gegevens zelf in.')
      const p = j as FactuurVoorstel
      const stuks = perStuk(p.toestellen)
      if (!stuks.length) { setLezing({ status: 'fout', fout: p.opmerking || 'Geen toestel gevonden op deze factuur.' }); return }
      setLezing({ status: 'klaar', voorstel: p, stuks, vorige: { ...laatste.current } })
      setStuk(0)
      vulIn(p, stuks[0], false)
    } catch (e) { setLezing({ status: 'fout', fout: e instanceof Error ? e.message : 'De factuur lezen lukte niet.' }) }
  }

  const laadFactuurOp = async (bestand?: File) => {
    if (!bestand) return
    setLaden(true)
    try {
      const f = await alsJpeg(bestand)
      if (f.size > 25 * 1024 * 1024) throw new Error('Het bestand is groter dan 25 MB.')
      const naam = naamMetExtensie(f, 'factuur')
      const r = await fetch('/api/admin/materiaal/factuur', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'upload', naam, grootte: f.size }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Opladen mislukt')
      const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: j.contentType, upsert: false })
      if (error) throw new Error(error.message)
      setFactuur({ pad: j.pad, naam })
      void leesFactuur(j.pad)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally {
      setLaden(false)
      if (camera.current) camera.current.value = ''
      if (kiezer.current) kiezer.current.value = ''
    }
  }

  const lichaam = (w: Velden, cat: string) => ({
    ...w, categorie_id: cat, inhoud: regelsUit(w.inhoud), kenmerken: regelsUit(w.kenmerken),
    factuur: factuur ?? undefined, factuur_weg: !factuur && factuurWeg,
  })

  const bewaar = async () => {
    if (!v.naam.trim()) { toast.error('Geef het materiaal een naam.'); return }
    setBezig(true)
    let cat = v.categorie_id
    if (cat === '__nieuw') {
      const rc = await doe('categorie.maak', { naam: nieuweCat }, { stil: true })
      if (!rc) { setBezig(false); return }
      cat = String(rc.id)
    }
    if (!cat) { setBezig(false); toast.error('Kies een categorie.'); return }
    const r = await doe(item ? 'item.wijzig' : 'item.maak', { ...lichaam(v, cat), ...(item ? { id: item.id } : {}) }, { stil: true })
    if (r && foto) {
      const fd = new FormData(); fd.append('item_id', String(r.id)); fd.append('file', foto)
      const f = await fetch('/api/admin/materiaal/foto', { method: 'POST', body: fd })
      if (!f.ok) toast.warning(`Opgeslagen, maar de foto niet: ${(await f.json().catch(() => ({}))).error ?? 'fout'}`)
    }
    setBezig(false)
    if (r) { toast.success(item ? 'Materiaal bijgewerkt.' : `${v.naam} toegevoegd.`); onSluit() }
  }

  // Alle toestellen van de factuur in één keer (elk stuk apart, met de factuur erbij).
  const voegAllesToe = async () => {
    if (lezing?.status !== 'klaar') return
    const p = lezing.voorstel
    const reserve = (v.categorie_id && v.categorie_id !== '__nieuw' ? v.categorie_id : '') || catId('Overige') || data.categorieen[0]?.id || ''
    if (!reserve) { toast.error('Maak eerst een categorie.'); return }
    const perNaam = new Map<string, number>()
    for (const s of lezing.stuks) perNaam.set(s.naam, (perNaam.get(s.naam) ?? 0) + 1)
    setBezig(true)
    let ok = 0
    const fouten: string[] = []
    for (const s of lezing.stuks) {
      const naam = (perNaam.get(s.naam) ?? 0) > 1 ? `${s.naam} (${s.volgnummer})` : s.naam
      const w: Velden = {
        naam, categorie_id: '', merk: s.merk ?? '', model: s.model ?? '', serienummer: s.serienummer ?? '',
        aankoopdatum: p.datum ?? '', aankoopwaarde: s.prijs_excl !== null ? String(s.prijs_excl) : '', opmerkingen: '',
        omschrijving: s.omschrijving ?? '', inhoud: s.inhoud.join('\n'), kenmerken: s.kenmerken.join('\n'),
        leverancier: p.leverancier ?? '', factuurnummer: p.factuurnummer ?? '', garantie_tot: p.garantie_tot ?? '',
      }
      const r = await doe('item.maak', lichaam(w, catId(s.categorie) || reserve), { stil: true })
      if (r) ok++; else fouten.push(naam)
    }
    setBezig(false)
    if (ok) toast.success(`${ok} ${ok === 1 ? 'toestel' : 'toestellen'} toegevoegd met de factuur erbij.`)
    if (fouten.length) toast.warning(`Niet toegevoegd: ${fouten.join(', ')}`)
    if (!fouten.length) onSluit()
  }

  const ongedaan = () => { if (lezing?.status === 'klaar') setV(lezing.vorige); setLezing(null) }
  const anders = lezing?.status === 'klaar' && (() => {
    const s = lezing.stuks[stuk]
    return (!!s.naam && s.naam !== v.naam) || (!!s.serienummer && s.serienummer !== v.serienummer) || (!!lezing.voorstel.datum && lezing.voorstel.datum !== v.aankoopdatum)
  })()

  return (
    <Modal titel={item ? 'Materiaal bewerken' : 'Materiaal toevoegen'} onSluit={onSluit} breed
      voet={<><button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button><button type="button" onClick={bewaar} disabled={bezig || laden} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{item ? 'Opslaan' : 'Toevoegen'}</button></>}>
      {/* Factuur: foto of pdf, de app leest wat het toestel is */}
      <section className="space-y-2">
        <span className={lbl}>Factuur</span>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => laadFactuurOp(e.target.files?.[0])} />
        <input ref={kiezer} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => laadFactuurOp(e.target.files?.[0])} />
        {huidigeFactuur && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <FileText className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="truncate flex-1 min-w-0">{huidigeFactuur.factuur_naam ?? 'Factuur'}</span>
            <a href={`/api/admin/materiaal/factuur?item_id=${huidigeFactuur.id}`} target="_blank" rel="noreferrer" className="h-8 px-2 rounded-lg inline-flex items-center gap-1 text-xs hover:bg-gray-100"><Eye className="h-3.5 w-3.5" />Bekijken</a>
            <button type="button" onClick={() => setFactuurWeg(true)} className="h-8 px-2 rounded-lg inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />Weghalen</button>
          </div>
        )}
        {factuurWeg && !factuur && <p className="text-xs text-amber-800">De factuur gaat weg bij het opslaan. <button type="button" onClick={() => setFactuurWeg(false)} className="underline">Ongedaan maken</button></p>}
        {factuur && <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900"><Check className="h-4 w-4 shrink-0" /><span className="truncate flex-1 min-w-0">{factuur.naam}</span></div>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => camera.current?.click()} disabled={laden} className={`${factuur || huidigeFactuur ? 'btn-secondary' : 'btn-primary'} text-sm justify-center`}>
            {laden ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{factuur || huidigeFactuur ? 'Nieuwe foto' : 'Foto van de factuur'}
          </button>
          <button type="button" onClick={() => kiezer.current?.click()} disabled={laden} className="btn-secondary text-sm justify-center"><Paperclip className="h-4 w-4" />{factuur || huidigeFactuur ? 'Ander bestand' : 'Pdf of foto kiezen'}</button>
        </div>
        {!lezing && !factuur && !huidigeFactuur && <p className="text-[11px] text-gray-500">Trek een foto van de factuur of kies de pdf: de app vult in wat het toestel is, wat erbij zit, het serienummer en de aankoop.</p>}
        {lezing?.status === 'bezig' && <p className="text-xs text-gray-600 inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />De factuur wordt gelezen…</p>}
        {lezing?.status === 'fout' && <p className="text-xs text-amber-800">{lezing.fout}</p>}
        {lezing?.status === 'klaar' && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2.5 text-sm space-y-2">
            <p className="flex items-start gap-1.5 text-violet-950">
              <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Van de factuur{[lezing.voorstel.leverancier, lezing.voorstel.factuurnummer, lezing.voorstel.datum ? datumKort(lezing.voorstel.datum) : null].filter(Boolean).length ? `: ${[lezing.voorstel.leverancier, lezing.voorstel.factuurnummer, lezing.voorstel.datum ? datumKort(lezing.voorstel.datum) : null].filter(Boolean).join(' · ')}` : ''}. Kijk alles na voor je opslaat.</span>
            </p>
            {lezing.voorstel.zekerheid > 0 && lezing.voorstel.zekerheid < 0.6 && <p className="text-xs text-amber-800">De app is niet zeker van wat ze las.</p>}
            {lezing.stuks.length > 1 && (
              <div className="space-y-1.5">
                <p className="text-xs text-violet-950">Op deze factuur staan {lezing.stuks.length} toestellen. Welk vul je hier in?</p>
                <ul className="space-y-1">
                  {lezing.stuks.map((s, i) => (
                    <li key={i}><button type="button" onClick={() => { setStuk(i); vulIn(lezing.voorstel, s, true) }} aria-pressed={stuk === i}
                      className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-xs flex items-center gap-2 ${stuk === i ? 'border-violet-900 bg-white' : 'border-violet-200 bg-white/60 hover:bg-white'}`}>
                      <span className={`h-3.5 w-3.5 rounded-full border shrink-0 ${stuk === i ? 'border-violet-900 bg-violet-900' : 'border-violet-300'}`} />
                      <span className="flex-1 min-w-0">
                        <b className="font-semibold block truncate">{s.naam}</b>
                        <span className="text-[11px] text-gray-600">{[s.serienummer ? `serienummer ${s.serienummer}` : null, s.prijs_excl !== null ? `${eurBedrag(s.prijs_excl)} excl. btw` : null].filter(Boolean).join(' · ') || 'geen serienummer op de factuur'}</span>
                      </span>
                    </button></li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              {!item && lezing.stuks.length > 1 && <button type="button" onClick={voegAllesToe} disabled={bezig} className="text-xs px-2.5 py-1 rounded-full bg-violet-900 text-white inline-flex items-center gap-1 disabled:opacity-50">{bezig ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Alle {lezing.stuks.length} apart toevoegen</button>}
              {anders && <button type="button" onClick={() => vulIn(lezing.voorstel, lezing.stuks[stuk], true)} className="text-xs px-2.5 py-1 rounded-full bg-violet-900 text-white inline-flex items-center gap-1"><Check className="h-3 w-3" />Alles overnemen</button>}
              <button type="button" onClick={ongedaan} className="text-xs px-2.5 py-1 rounded-full border border-violet-200 bg-white inline-flex items-center gap-1 text-violet-900"><Undo2 className="h-3 w-3" />Ongedaan maken</button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide">Het toestel</h4>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className={lbl}>Naam *</label><input className={INP} value={v.naam} onChange={(e) => zet('naam', e.target.value)} placeholder="bv. Sony A7 IV" /></div>
          <div><label className={lbl}>Categorie *</label>
            <select className={INP} value={v.categorie_id} onChange={(e) => zet('categorie_id', e.target.value)}><option value="">— kies —</option>{data.categorieen.map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}{data.kan.beheren && <option value="__nieuw">+ Nieuwe categorie…</option>}</select>
            {v.categorie_id === '__nieuw' && <input className={`${INP} mt-1`} value={nieuweCat} onChange={(e) => setNieuweCat(e.target.value)} placeholder="Naam van de categorie" />}
          </div>
          <div><label className={lbl}>Merk</label><input className={INP} value={v.merk} onChange={(e) => zet('merk', e.target.value)} /></div>
          <div><label className={lbl}>Model</label><input className={INP} value={v.model} onChange={(e) => zet('model', e.target.value)} /></div>
          <div><label className={lbl}>Serienummer / inventarisnummer</label><input className={INP} value={v.serienummer} onChange={(e) => zet('serienummer', e.target.value)} /></div>
          <div><label className={lbl}>Foto van het toestel</label><label className={`${INP} flex items-center gap-2 cursor-pointer text-gray-600`}><Camera className="h-4 w-4" /><span className="truncate">{foto ? foto.name : item?.foto_url ? 'Foto vervangen…' : 'Foto kiezen…'}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="hidden" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} /></label></div>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide">Wat is het</h4>
        <div><label className={lbl}>Omschrijving</label><textarea rows={2} className={INP} value={v.omschrijving} onChange={(e) => zet('omschrijving', e.target.value)} placeholder="bv. Full-frame systeemcamera voor foto en 4K-video." /></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className={lbl}>Wat zit erbij <span className="text-gray-400 font-normal">— één per regel</span></label><textarea rows={4} className={INP} value={v.inhoud} onChange={(e) => zet('inhoud', e.target.value)} placeholder={'Batterij NP-FZ100\nLader BC-QZ1\nDraagriem'} /></div>
          <div><label className={lbl}>Kenmerken <span className="text-gray-400 font-normal">— één per regel</span></label><textarea rows={4} className={INP} value={v.kenmerken} onChange={(e) => zet('kenmerken', e.target.value)} placeholder={'33 MP full-frame sensor\n4K 60p, 10-bit'} /></div>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide">Aankoop</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div><label className={lbl}>Aankoopdatum</label><input type="date" className={INP} value={v.aankoopdatum} onChange={(e) => zet('aankoopdatum', e.target.value)} /></div>
          <div><label className={lbl}>Waarde (€, excl. btw)</label><input className={INP} inputMode="decimal" value={v.aankoopwaarde} onChange={(e) => zet('aankoopwaarde', e.target.value)} /></div>
          <div><label className={lbl}>Garantie tot</label><input type="date" className={INP} value={v.garantie_tot} onChange={(e) => zet('garantie_tot', e.target.value)} /></div>
          <div><label className={lbl}>Leverancier</label><input className={INP} value={v.leverancier} onChange={(e) => zet('leverancier', e.target.value)} placeholder="bv. Kamera Express" /></div>
          <div><label className={lbl}>Factuurnummer</label><input className={INP} value={v.factuurnummer} onChange={(e) => zet('factuurnummer', e.target.value)} /></div>
        </div>
      </section>

      <div><label className={lbl}>Opmerkingen</label><textarea rows={2} className={INP} value={v.opmerkingen} onChange={(e) => zet('opmerkingen', e.target.value)} /></div>
      <p className="text-[11px] text-gray-500">Elk fysiek toestel apart registreren: twee identieke lenzen = twee items.</p>
    </Modal>
  )
}

const eurBedrag = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })

type Velden = {
  naam: string; categorie_id: string; merk: string; model: string; serienummer: string; aankoopdatum: string; aankoopwaarde: string; opmerkingen: string
  omschrijving: string; inhoud: string; kenmerken: string; leverancier: string; factuurnummer: string; garantie_tot: string
}
type Stuk = ReturnType<typeof perStuk>[number]
type Lezing = { status: 'bezig' } | { status: 'fout'; fout: string } | { status: 'klaar'; voorstel: FactuurVoorstel; stuks: Stuk[]; vorige: Velden }

/** Medewerker (ontlener) toevoegen of bewerken. Uit Personeel: naam komt uit Personeel. */
export function OntlenerFormulier({ ontlener, doe, onSluit }: { ontlener: Ontlener | null; doe: Doe; onSluit: () => void }) {
  const [v, setV] = useState({ voornaam: ontlener?.voornaam ?? '', achternaam: ontlener?.achternaam ?? '', email: ontlener?.email ?? '', telefoon: ontlener?.telefoon ?? '', type: ontlener?.type ?? '' })
  const [bezig, setBezig] = useState(false)
  const uitPersoneel = !!ontlener?.personeel_id
  const bewaar = async () => {
    setBezig(true)
    const r = await doe(ontlener ? 'ontlener.wijzig' : 'ontlener.maak', { ...v, type: v.type || null, ...(ontlener ? { id: ontlener.id } : {}) }, { stil: true })
    setBezig(false)
    if (r) { toast.success(ontlener ? 'Medewerker bijgewerkt.' : `${v.voornaam} toegevoegd.`); onSluit() }
  }
  return (
    <Modal titel={ontlener ? 'Medewerker bewerken' : 'Medewerker toevoegen'} sub={uitPersoneel ? 'Gekoppeld aan Personeel: de naam beheer je daar.' : 'Bv. een externe freelancer — een account is niet nodig.'} onSluit={onSluit}
      voet={<><button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button><button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{ontlener ? 'Opslaan' : 'Toevoegen'}</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lbl}>Voornaam *</label><input className={INP} disabled={uitPersoneel} value={v.voornaam} onChange={(e) => setV({ ...v, voornaam: e.target.value })} /></div>
        <div><label className={lbl}>Achternaam *</label><input className={INP} disabled={uitPersoneel} value={v.achternaam} onChange={(e) => setV({ ...v, achternaam: e.target.value })} /></div>
        <div className="col-span-2"><label className={lbl}>E-mailadres * <span className="text-gray-400 font-normal">— voor de bevestigingsmails</span></label><input type="email" className={INP} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
        <div><label className={lbl}>Type</label><select className={INP} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}><option value="">—</option>{ONTLENER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
        <div><label className={lbl}>Telefoon</label><input className={INP} value={v.telefoon} onChange={(e) => setV({ ...v, telefoon: e.target.value })} /></div>
      </div>
    </Modal>
  )
}

/** Foutieve registratie corrigeren of annuleren — altijd met reden, zichtbaar in de activiteiten. */
export function CorrectieDialoog({ uitlening, item, doe, onSluit }: { uitlening: Uitlening; item: Item | undefined; doe: Doe; onSluit: () => void }) {
  const [uit, setUit] = useState(lokaalVan(uitlening.uitgeleend_op))
  const [verwacht, setVerwacht] = useState(uitlening.verwacht_terug ?? '')
  const [terug, setTerug] = useState(lokaalVan(uitlening.teruggebracht_op))
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  const voer = async (annuleer: boolean) => {
    if (!reden.trim()) { toast.error('Geef de reden van de correctie.'); return }
    if (annuleer && !confirm('Deze registratie annuleren? Ze blijft zichtbaar in de historie, maar telt niet meer als uitlening.')) return
    setBezig(true)
    const body: Record<string, unknown> = { uitlening_id: uitlening.id, reden }
    if (!annuleer) {
      if (uit !== lokaalVan(uitlening.uitgeleend_op)) body.uitgeleend_op = new Date(uit).toISOString()
      if (verwacht !== (uitlening.verwacht_terug ?? '')) body.verwacht_terug = verwacht || null
      if (uitlening.teruggebracht_op && terug !== lokaalVan(uitlening.teruggebracht_op)) body.teruggebracht_op = new Date(terug).toISOString()
    }
    const r = await doe(annuleer ? 'uitlening.annuleer' : 'uitlening.corrigeer', body, { stil: true })
    setBezig(false)
    if (r) { toast.success(annuleer ? 'Registratie geannuleerd.' : 'Correctie bewaard.'); onSluit() }
  }
  return (
    <Modal titel="Registratie corrigeren" sub={item?.naam} onSluit={onSluit}
      voet={<><button type="button" onClick={() => voer(true)} disabled={bezig} className="btn-secondary text-sm text-red-700 mr-auto">Registratie annuleren</button><button type="button" onClick={onSluit} className="btn-secondary text-sm">Sluiten</button><button type="button" onClick={() => voer(false)} disabled={bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Correctie bewaren</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lbl}>Uitleendatum</label><input type="datetime-local" className={INP} value={uit} onChange={(e) => setUit(e.target.value)} /></div>
        <div><label className={lbl}>Verwachte retour</label><input type="date" className={INP} value={verwacht} onChange={(e) => setVerwacht(e.target.value)} /></div>
        {uitlening.teruggebracht_op && <div><label className={lbl}>Retourdatum</label><input type="datetime-local" className={INP} value={terug} onChange={(e) => setTerug(e.target.value)} /></div>}
      </div>
      <div><label className={lbl}>Reden *</label><input className={INP} value={reden} onChange={(e) => setReden(e.target.value)} placeholder="bv. verkeerde datum ingegeven" /></div>
      <p className="text-[11px] text-gray-500">De oorspronkelijke gegevens blijven zichtbaar in de activiteitenlog.</p>
    </Modal>
  )
}
