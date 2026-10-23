'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, MessagesSquare, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { INP, Schakelaar, OpslaanBalk, Dialoog } from '@/app/admin/instellingen/ui'
import { ALLE_NETWERKEN, NETWERK_LABEL } from '@/lib/metricool-inbox-parse'

/**
 * Community management per klant: aan/uit, kanalen (Metricool-merken) en de
 * afspraken waarmee Claude indeelt en voorstellen schrijft. Uitzetten wist
 * niets: de klant verdwijnt enkel uit de sync, de MCP en de inbox.
 */
type Cheat = { trefwoord: string; antwoord: string; link: string }
type Voorbeeld = { comment: string; antwoord: string }
type Inst = { actief: boolean; klant_keurt_goed: boolean; tone_of_voice: string | null; regels: string | null; cheat_sheet: Cheat[]; voorbeeldantwoorden: Voorbeeld[]; bijgewerkt_op: string | null; bijgewerkt_door: string | null }
type Kanaal = { id: string; naam: string; metricool_blog_id: string; netwerken: string[]; actief: boolean; laatst_gesynct: string | null; laatste_fout: string | null }
type Data = { instellingen: Inst | null; kanalen: Kanaal[]; standaardregels: string; open: number; magInstellen: boolean }
type Tekstdeel = { tone_of_voice: string; regels: string; cheat_sheet: Cheat[]; voorbeeldantwoorden: Voorbeeld[] }

const leeg = (i: Inst | null): Tekstdeel => ({ tone_of_voice: i?.tone_of_voice ?? '', regels: i?.regels ?? '', cheat_sheet: i?.cheat_sheet ?? [], voorbeeldantwoorden: i?.voorbeeldantwoorden ?? [] })
const tijd = (v: string | null) => (v ? new Date(v).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nog nooit')

async function api(pad: string, method: string, body?: unknown) {
  const r = await fetch(pad, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? 'Mislukt')
  return j
}

export function ClientCommunity({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [verborgen, setVerborgen] = useState(false)
  const [tekst, setTekst] = useState<Tekstdeel>(leeg(null))
  const [bezig, setBezig] = useState(false)
  const [nieuwKanaal, setNieuwKanaal] = useState(false)

  const laad = useCallback(() => {
    fetch(`/api/admin/community/instellingen?clientId=${clientId}`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setData(j); setTekst(leeg(j.instellingen)) })
      .catch(() => setVerborgen(true))
  }, [clientId])
  useEffect(() => { laad() }, [laad])

  const vuil = useMemo(() => !!data && JSON.stringify(tekst) !== JSON.stringify(leeg(data.instellingen)), [tekst, data])
  if (verborgen) return null
  if (!data) return <div className="card-base py-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-gray-400" /></div>

  const inst = data.instellingen
  const mag = data.magInstellen
  const bewaar = async (wijz: Record<string, unknown>, melding: string) => {
    setBezig(true)
    try { await api('/api/admin/community/instellingen', 'PUT', { clientId, ...wijz }); toast.success(melding); laad() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const kanaal = async (id: string, wijz: Record<string, unknown>) => {
    try { await api('/api/admin/community/kanalen', 'PATCH', { id, ...wijz }); laad() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
  }

  return (
    <div id="community" className="card-base space-y-5 scroll-mt-20">
      <div className="flex items-start gap-3 flex-wrap">
        <MessagesSquare className="h-4 w-4 text-gray-400 mt-1" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-gray-900">Community management</h2>
          <p className="text-xs text-gray-500">{inst?.actief ? `Aan · ${data.open} open bericht(en)` : 'Uit — geen sync, niet in de inbox of de MCP. Bestaande berichten blijven bewaard.'}</p>
        </div>
        {inst?.actief && <Link href={`/admin/community?klant=${clientId}`} className="btn-secondary text-xs">Inbox openen</Link>}
        <Schakelaar aan={!!inst?.actief} disabled={!mag || bezig} label="Community management aan of uit"
          onChange={(v) => bewaar({ actief: v }, v ? 'Community management staat aan.' : 'Community management staat uit. Er werd niets gewist.')} />
      </div>

      {/* Kanalen */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Kanalen (Metricool-merken)</h3>
          {mag && <button type="button" className="btn-secondary text-xs" onClick={() => setNieuwKanaal(true)}><Plus className="h-3.5 w-3.5" />Kanaal</button>}
        </div>
        {data.kanalen.length === 0 && <p className="text-sm text-gray-400">Nog geen kanaal gekoppeld.</p>}
        <ul className="space-y-2">
          {data.kanalen.map((k) => (
            <li key={k.id} className={`rounded-lg border p-3 space-y-2 ${k.actief ? 'border-gray-200' : 'border-gray-100 bg-gray-50'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <input className={`${INP} sm:max-w-xs`} defaultValue={k.naam} disabled={!mag} aria-label="Naam van het kanaal"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== k.naam) kanaal(k.id, { naam: v }) }} />
                <span className="text-[11px] text-gray-400">Metricool {k.metricool_blog_id}</span>
                <span className="flex-1" />
                <span className="text-xs text-gray-500">{k.actief ? 'Actief' : 'Uit'}</span>
                <Schakelaar aan={k.actief} disabled={!mag} label={`Kanaal ${k.naam} aan of uit`} onChange={(v) => kanaal(k.id, { actief: v })} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {ALLE_NETWERKEN.map((n) => (
                  <label key={n} className="inline-flex items-center gap-1.5 text-sm">
                    <input type="checkbox" disabled={!mag} checked={k.netwerken.includes(n)}
                      onChange={(e) => kanaal(k.id, { netwerken: e.target.checked ? [...k.netwerken, n] : k.netwerken.filter((x) => x !== n) })} />
                    {NETWERK_LABEL[n]}
                  </label>
                ))}
              </div>
              <div className="text-[11px] text-gray-400">Laatst gesynchroniseerd: {tijd(k.laatst_gesynct)}</div>
              {k.laatste_fout && <div className="text-xs text-red-700 bg-red-50 rounded-md px-2 py-1 flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{k.laatste_fout}</div>}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
        <div>
          <div className="text-sm font-medium">Klant keurt vragen en kritiek goed</div>
          <div className="text-xs text-gray-500">{inst?.klant_keurt_goed === false ? 'Nee: wij handelen alles af.' : 'Ja: vragen en kritiek gaan naar de klant.'}</div>
        </div>
        <Schakelaar aan={inst?.klant_keurt_goed !== false} disabled={!mag || bezig} label="Klant keurt vragen en kritiek goed"
          onChange={(v) => bewaar({ klant_keurt_goed: v }, 'Bewaard.')} />
      </div>

      {/* Afspraken */}
      <section className="space-y-4">
        <div>
          <label htmlFor="cm-tov" className="block text-xs font-medium text-gray-600 mb-1">Tone of voice</label>
          <textarea id="cm-tov" rows={3} className={INP} disabled={!mag} value={tekst.tone_of_voice} onChange={(e) => setTekst({ ...tekst, tone_of_voice: e.target.value })} />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label htmlFor="cm-regels" className="block text-xs font-medium text-gray-600">Regels</label>
            {mag && !tekst.regels.trim() && <button type="button" className="text-xs underline text-gray-600" onClick={() => setTekst({ ...tekst, regels: data.standaardregels })}>Standaardregels overnemen</button>}
          </div>
          <textarea id="cm-regels" rows={6} className={INP} disabled={!mag} value={tekst.regels} placeholder={data.standaardregels} onChange={(e) => setTekst({ ...tekst, regels: e.target.value })} />
          {!tekst.regels.trim() && <p className="text-[11px] text-gray-400 mt-1">Leeg: de standaardregels (in grijs) gelden als voorstel. Ze worden pas de regels van deze klant als je ze bewaart.</p>}
        </div>

        <Lijst titel="Cheat sheet" mag={mag} leegTekst="Geen trefwoorden." rijen={tekst.cheat_sheet}
          nieuw={{ trefwoord: '', antwoord: '', link: '' }} onChange={(r) => setTekst({ ...tekst, cheat_sheet: r })}
          velden={[{ k: 'trefwoord', label: 'Trefwoord', ph: 'webinar' }, { k: 'antwoord', label: 'Antwoord', ph: 'Inschrijven kan via…' }, { k: 'link', label: 'Link', ph: 'https://…' }]} />
        <Lijst titel="Voorbeeldantwoorden" mag={mag} leegTekst="Geen voorbeelden." rijen={tekst.voorbeeldantwoorden}
          nieuw={{ comment: '', antwoord: '' }} onChange={(r) => setTekst({ ...tekst, voorbeeldantwoorden: r })}
          velden={[{ k: 'comment', label: 'Comment', ph: 'Mooi!' }, { k: 'antwoord', label: 'Antwoord', ph: 'Dank je!' }]} />

        {mag && <OpslaanBalk vuil={vuil} bezig={bezig} onOpslaan={() => bewaar(tekst, 'Afspraken bewaard.')} onAnnuleer={() => setTekst(leeg(inst))}
          bijgewerkt={inst?.bijgewerkt_op ? { op: inst.bijgewerkt_op, door: inst.bijgewerkt_door } : null} />}
      </section>

      {nieuwKanaal && <NieuwKanaal clientId={clientId} onSluit={() => setNieuwKanaal(false)} onKlaar={() => { setNieuwKanaal(false); toast.success('Kanaal toegevoegd.'); laad() }} />}
    </div>
  )
}

function Lijst<T extends Record<string, string>>({ titel, rijen, velden, nieuw, onChange, mag, leegTekst }: {
  titel: string; rijen: T[]; velden: { k: keyof T & string; label: string; ph: string }[]; nieuw: T; onChange: (r: T[]) => void; mag: boolean; leegTekst: string
}) {
  const zet = (i: number, k: keyof T, v: string) => onChange(rijen.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-gray-600">{titel}</span>
        {mag && <button type="button" className="btn-secondary text-xs" onClick={() => onChange([...rijen, { ...nieuw }])}><Plus className="h-3.5 w-3.5" />Toevoegen</button>}
      </div>
      {rijen.length === 0 && <p className="text-sm text-gray-400">{leegTekst}</p>}
      <ul className="space-y-2">
        {rijen.map((r, i) => (
          <li key={i} className="flex gap-2 items-start rounded-lg border border-gray-100 p-2">
            <div className={`flex-1 grid gap-2 grid-cols-1 ${velden.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              {velden.map((v) => (
                <textarea key={v.k} rows={v.k === 'trefwoord' || v.k === 'link' ? 1 : 2} className={INP} disabled={!mag} aria-label={v.label}
                  placeholder={v.ph} value={r[v.k] ?? ''} onChange={(e) => zet(i, v.k, e.target.value)} />
              ))}
            </div>
            {mag && <button type="button" className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Verwijderen" onClick={() => onChange(rijen.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function NieuwKanaal({ clientId, onSluit, onKlaar }: { clientId: string; onSluit: () => void; onKlaar: () => void }) {
  const [merken, setMerken] = useState<{ blogId: string; name: string }[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [blogId, setBlogId] = useState('')
  const [naam, setNaam] = useState('')
  const [netwerken, setNetwerken] = useState<string[]>(['instagram', 'facebook'])
  const [bezig, setBezig] = useState(false)
  useEffect(() => {
    fetch('/api/admin/community/kanalen?merken=1', { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setMerken(j.merken) })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Merken laden mislukt'))
  }, [])
  const voegToe = async () => {
    setBezig(true)
    try { await api('/api/admin/community/kanalen', 'POST', { clientId, metricool_blog_id: blogId, naam, netwerken }); onKlaar() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel="Kanaal toevoegen" onSluit={onSluit}>
      <div className="space-y-3">
        {fout && <p className="text-sm text-red-600">{fout}</p>}
        {!merken && !fout && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        {merken && (
          <>
            <div>
              <label htmlFor="cm-merk" className="block text-xs font-medium text-gray-600 mb-1">Metricool-merk</label>
              <select id="cm-merk" className={INP} value={blogId} onChange={(e) => { setBlogId(e.target.value); const m = merken.find((x) => x.blogId === e.target.value); if (m && !naam) setNaam(m.name) }}>
                <option value="">Kies een merk…</option>
                {merken.map((m) => <option key={m.blogId} value={m.blogId}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cm-naam" className="block text-xs font-medium text-gray-600 mb-1">Naam</label>
              <input id="cm-naam" className={INP} value={naam} onChange={(e) => setNaam(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {ALLE_NETWERKEN.map((n) => (
                <label key={n} className="inline-flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={netwerken.includes(n)} onChange={(e) => setNetwerken(e.target.checked ? [...netwerken, n] : netwerken.filter((x) => x !== n))} />
                  {NETWERK_LABEL[n]}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={onSluit}>Annuleren</button>
              <button type="button" className="btn-primary" disabled={!blogId || !naam.trim() || bezig} onClick={voegToe}>{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Toevoegen</button>
            </div>
          </>
        )}
      </div>
    </Dialoog>
  )
}
