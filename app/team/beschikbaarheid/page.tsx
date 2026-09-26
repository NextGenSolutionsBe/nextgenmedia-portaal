'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Send, Undo2, Check } from 'lucide-react'
import { Kalender, kalenderBereik, beschikbaarheidSoort, type KalItem, type Weergave } from '@/components/personeel/kalender'
import { api, Chip, datumNl, dagLang, kortUur, vandaagBE, INP, LBL } from '@/components/personeel/ui'
import { BESCHIKBAARHEID_STATUS, type BeschikbaarheidStatus } from '@/lib/personeel/model'

type Rij = { id: string; datum: string; start_tijd: string; eind_tijd: string; opmerking: string | null; status: BeschikbaarheidStatus; goedgekeurd_start: string | null; goedgekeurd_eind: string | null; voorstel_start: string | null; voorstel_eind: string | null; reactie: string | null }

/**
 * Beschikbaarheid doorgeven: een dag kiezen, één of meer tijdsblokken, een
 * opmerking. Dit is een aanbod, nog geen planning — pas na goedkeuring wordt
 * het een werkblok in je planning. Zolang niets behandeld is, kan je intrekken.
 */
export default function BeschikbaarheidPagina() {
  const vandaag = vandaagBE()
  const [datum, setDatum] = useState(vandaag)
  const [blokken, setBlokken] = useState([{ start: '10:00', eind: '17:00' }])
  const [opmerking, setOpmerking] = useState('')
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [bezig, setBezig] = useState(false)
  const [weergave, setWeergave] = useState<Weergave>('maand')
  const [anker, setAnker] = useState(vandaag)

  const bereik = kalenderBereik(weergave, anker)
  const laad = useCallback(async () => {
    try {
      const van = bereik.van < vandaag ? bereik.van : vandaag
      const j = await api<{ beschikbaarheid: Rij[] }>(`/api/team/beschikbaarheid?van=${van}&tot=${bereik.tot > vandaag ? bereik.tot : vandaag}`)
      setRijen(j.beschikbaarheid)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [bereik.van, bereik.tot, vandaag])
  useEffect(() => { laad() }, [laad])

  const items = useMemo<KalItem[]>(() => (rijen ?? []).flatMap((r) => {
    const soort = beschikbaarheidSoort(r.status) ?? (r.status === 'ingetrokken' ? null : 'planning')
    if (!soort) return []
    return [{ id: r.id, datum: r.datum, start: kortUur(r.goedgekeurd_start ?? r.start_tijd), eind: kortUur(r.goedgekeurd_eind ?? r.eind_tijd), titel: BESCHIKBAARHEID_STATUS[r.status].label, soort, onClick: () => setDatum(r.datum) }]
  }), [rijen])

  const verstuur = async () => {
    setBezig(true)
    try {
      await api('/api/team/beschikbaarheid', { body: { datum, blokken, opmerking } })
      toast.success(`Beschikbaarheid voor ${datumNl(datum)} doorgegeven.`)
      setOpmerking(''); await laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Doorgeven mislukt') } finally { setBezig(false) }
  }
  const intrekken = async (id: string) => {
    if (!confirm('Deze beschikbaarheid intrekken?')) return
    try { await api(`/api/team/beschikbaarheid/${id}`, { method: 'DELETE' }); toast.success('Ingetrokken.'); await laad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const aanvaard = async (id: string) => {
    try { await api(`/api/team/beschikbaarheid/${id}`, { body: { actie: 'voorstel_aanvaarden' } }); toast.success('Voorstel aanvaard.'); await laad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  const komend = (rijen ?? []).filter((r) => r.datum >= vandaag && r.status !== 'ingetrokken').sort((a, b) => a.datum.localeCompare(b.datum) || a.start_tijd.localeCompare(b.start_tijd))

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Beschikbaarheid</h1>

      <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
        <div><label className={LBL}>Datum</label><input type="date" min={vandaag} className={INP} value={datum} onChange={(e) => setDatum(e.target.value)} /><div className="text-xs text-gray-500 mt-1 capitalize">{dagLang(datum)}</div></div>
        <div className="space-y-2">
          <div className={LBL}>Tijdsblokken</div>
          {blokken.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="time" className={INP} value={b.start} onChange={(e) => setBlokken((l) => l.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <span className="text-gray-400">–</span>
              <input type="time" className={INP} value={b.eind} onChange={(e) => setBlokken((l) => l.map((x, j) => (j === i ? { ...x, eind: e.target.value } : x)))} />
              {blokken.length > 1 && <button type="button" onClick={() => setBlokken((l) => l.filter((_, j) => j !== i))} className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600" aria-label="Blok verwijderen"><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
          <button type="button" onClick={() => setBlokken((l) => [...l, { start: '13:00', eind: '17:00' }])} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Tijdsblok toevoegen</button>
        </div>
        <div><label className={LBL}>Opmerking (optioneel)</label><textarea rows={2} className={INP} value={opmerking} onChange={(e) => setOpmerking(e.target.value)} placeholder="bv. liefst thuiswerk, na 15u op kantoor" /></div>
        <button type="button" disabled={bezig} onClick={verstuur} className="w-full h-12 rounded-xl bg-[#fff848] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">{bezig ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}Beschikbaarheid doorgeven</button>
        <p className="text-[11px] text-gray-500">Dit is nog geen planning. Je verantwoordelijke keurt het (deels) goed; dan verschijnt het werkblok in je planning.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Wat je doorgaf</h2>
        {rijen === null && <div className="py-6 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>}
        {rijen && komend.length === 0 && <div className="text-sm text-gray-400 bg-white rounded-xl border border-gray-100 p-4">Nog niets doorgegeven voor de komende dagen.</div>}
        {komend.map((r) => (
          <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">{datumNl(r.datum)} · {kortUur(r.start_tijd)}–{kortUur(r.eind_tijd)}</div>
              <Chip cls={BESCHIKBAARHEID_STATUS[r.status].chip}>{BESCHIKBAARHEID_STATUS[r.status].label}</Chip>
            </div>
            {r.status === 'gedeeltelijk' && r.goedgekeurd_start && <div className="text-xs text-teal-800">Ingepland: {kortUur(r.goedgekeurd_start)}–{kortUur(r.goedgekeurd_eind)}</div>}
            {r.opmerking && <div className="text-xs text-gray-500">{r.opmerking}</div>}
            {r.reactie && <div className="text-xs text-gray-700 bg-gray-50 rounded-lg px-2 py-1">Reactie: {r.reactie}</div>}
            {r.voorstel_start && r.status === 'ingediend' && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900 flex items-center justify-between gap-2">
                <span>Voorstel: {kortUur(r.voorstel_start)}–{kortUur(r.voorstel_eind)}</span>
                <button type="button" onClick={() => aanvaard(r.id)} className="btn-primary text-xs h-7 px-2"><Check className="h-3.5 w-3.5" />Aanvaarden</button>
              </div>
            )}
            {r.status === 'ingediend' && <button type="button" onClick={() => intrekken(r.id)} className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><Undo2 className="h-3.5 w-3.5" />Intrekken</button>}
          </div>
        ))}
      </section>

      <Kalender items={items} weergave={weergave} anker={anker} onWeergave={setWeergave} onAnker={setAnker} onDag={(d) => { if (d >= vandaag) { setDatum(d); window.scrollTo({ top: 0, behavior: 'smooth' }) } }} legenda={false} />
    </div>
  )
}
