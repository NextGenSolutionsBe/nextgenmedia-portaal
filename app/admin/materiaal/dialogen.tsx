'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Check, Search, Undo2, Camera } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import { ONTLENER_TYPES, datumLang, naamVan, vandaagBE } from '@/lib/materiaal/model'
import type { Data, Item, Ontlener, Uitlening, Doe } from './types'

export const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1'
const lbl = 'block text-xs font-medium text-gray-700 mb-1'
const nieuweSleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)
/** Nu als waarde voor <input type="datetime-local"> (lokale tijd van de browser). */
const nuLokaal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const lokaalVan = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

export function Modal({ titel, sub, onSluit, children, voet, breed }: { titel: ReactNode; sub?: ReactNode; onSluit: () => void; children: ReactNode; voet?: ReactNode; breed?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
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
        <div className="flex items-center gap-2 rounded-lg border border-black bg-[#fff848]/20 px-3 py-2 text-sm">
          <span className="flex-1 font-medium">{naamVan(gekozen)}{!gekozen.email && <span className="ml-2 text-[11px] text-amber-700">geen e-mailadres</span>}</span>
          <button type="button" onClick={() => onKies('')} className="text-xs underline">wijzigen</button>
        </div>
      ) : (
        <>
          <div className="relative"><Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" /><input autoFocus className={`${INP} pl-9`} placeholder="Zoek medewerker…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Zoek medewerker" /></div>
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
          <input className={`${INP} mb-1.5`} placeholder="Zoek materiaal…" value={zoek} onChange={(e) => setZoek(e.target.value)} aria-label="Zoek materiaal" />
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

/** Materiaal toevoegen of bewerken. */
export function ItemFormulier({ data, item, doe, onSluit }: { data: Data; item: Item | null; doe: Doe; onSluit: () => void }) {
  const [v, setV] = useState({
    naam: item?.naam ?? '', categorie_id: item?.categorie_id ?? '', merk: item?.merk ?? '', model: item?.model ?? '', serienummer: item?.serienummer ?? '',
    aankoopdatum: item?.aankoopdatum ?? '', aankoopwaarde: item?.aankoopwaarde === null || item?.aankoopwaarde === undefined ? '' : String(item.aankoopwaarde).replace('.', ','), opmerkingen: item?.opmerkingen ?? '',
  })
  const [nieuweCat, setNieuweCat] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [bezig, setBezig] = useState(false)
  const zet = (k: keyof typeof v, w: string) => setV((x) => ({ ...x, [k]: w }))
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
    const r = await doe(item ? 'item.wijzig' : 'item.maak', { ...v, categorie_id: cat, ...(item ? { id: item.id } : {}) }, { stil: true })
    if (r && foto) {
      const fd = new FormData(); fd.append('item_id', String(r.id)); fd.append('file', foto)
      const f = await fetch('/api/admin/materiaal/foto', { method: 'POST', body: fd })
      if (!f.ok) toast.warning(`Opgeslagen, maar de foto niet: ${(await f.json().catch(() => ({}))).error ?? 'fout'}`)
    }
    setBezig(false)
    if (r) { toast.success(item ? 'Materiaal bijgewerkt.' : `${v.naam} toegevoegd.`); onSluit() }
  }
  return (
    <Modal titel={item ? 'Materiaal bewerken' : 'Materiaal toevoegen'} onSluit={onSluit} breed
      voet={<><button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button><button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{item ? 'Opslaan' : 'Toevoegen'}</button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className={lbl}>Naam *</label><input autoFocus className={INP} value={v.naam} onChange={(e) => zet('naam', e.target.value)} placeholder="bv. Sony A7 IV" /></div>
        <div><label className={lbl}>Categorie *</label>
          <select className={INP} value={v.categorie_id} onChange={(e) => zet('categorie_id', e.target.value)}><option value="">— kies —</option>{data.categorieen.map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}{data.kan.beheren && <option value="__nieuw">+ Nieuwe categorie…</option>}</select>
          {v.categorie_id === '__nieuw' && <input className={`${INP} mt-1`} value={nieuweCat} onChange={(e) => setNieuweCat(e.target.value)} placeholder="Naam van de categorie" />}
        </div>
        <div><label className={lbl}>Merk</label><input className={INP} value={v.merk} onChange={(e) => zet('merk', e.target.value)} /></div>
        <div><label className={lbl}>Model</label><input className={INP} value={v.model} onChange={(e) => zet('model', e.target.value)} /></div>
        <div><label className={lbl}>Serienummer / inventarisnummer</label><input className={INP} value={v.serienummer} onChange={(e) => zet('serienummer', e.target.value)} /></div>
        <div><label className={lbl}>Foto</label><label className={`${INP} flex items-center gap-2 cursor-pointer text-gray-600`}><Camera className="h-4 w-4" /><span className="truncate">{foto ? foto.name : item?.foto_url ? 'Foto vervangen…' : 'Foto kiezen…'}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="hidden" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} /></label></div>
        <div><label className={lbl}>Aankoopdatum</label><input type="date" className={INP} value={v.aankoopdatum} onChange={(e) => zet('aankoopdatum', e.target.value)} /></div>
        <div><label className={lbl}>Aankoopwaarde (€)</label><input className={INP} inputMode="decimal" value={v.aankoopwaarde} onChange={(e) => zet('aankoopwaarde', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className={lbl}>Opmerkingen</label><textarea rows={2} className={INP} value={v.opmerkingen} onChange={(e) => zet('opmerkingen', e.target.value)} /></div>
      </div>
      <p className="text-[11px] text-gray-500">Elk fysiek toestel apart registreren: twee identieke lenzen = twee items.</p>
    </Modal>
  )
}

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
