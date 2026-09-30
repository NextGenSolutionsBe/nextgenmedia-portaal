'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Save, X } from 'lucide-react'
import { WeekKalender, WeekNavigatie, maandagVan, plusDagen, type WkItem, type WkSelectie } from '@/components/personeel/week-kalender'
import { api, dagLang, kortUur, vandaagBE, INP, LBL } from '@/components/personeel/ui'

type Beschikbaar = { id: string; datum: string; start_tijd: string; eind_tijd: string; status: string }
type Blok = { id: string; datum: string; start_tijd: string; eind_tijd: string; taak: string | null; project: string | null; klant: string | null; status: string; bevestiging: string | null }

const GROEN = '#16a34a'
const ZWART = '#111827'
const UREN = Array.from({ length: (23 - 6) * 4 + 1 }, (_, i) => { const m = 6 * 60 + i * 15; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` })

/**
 * Wanneer ben je vrij? Sleep in de kalender over de uren waarop je kunt werken
 * (op je telefoon: tik = één uur, of gebruik "Snel toevoegen"). Het wordt meteen
 * bewaard — geen knop "wijzigen", geen bevestiging. Klik op een blok om het aan
 * te passen of te verwijderen. NextGenMedia kan je binnen die uren inboeken; je
 * krijgt dan een mail en bevestigt in je planning.
 */
export default function BeschikbaarheidPagina() {
  const vandaag = vandaagBE()
  const [maandag, setMaandag] = useState(maandagVan(vandaag))
  const [vrij, setVrij] = useState<Beschikbaar[] | null>(null)
  const [blokken, setBlokken] = useState<Blok[]>([])
  const [bezig, setBezig] = useState(false)
  const [open, setOpen] = useState<Beschikbaar | null>(null)
  const [snel, setSnel] = useState({ datum: vandaag, start: '10:00', eind: '17:00' })

  const laad = useCallback(async () => {
    try {
      const j = await api<{ beschikbaarheid: Beschikbaar[]; planning: Blok[] }>(`/api/team/planning?van=${maandag}&tot=${plusDagen(maandag, 6)}`)
      setVrij(j.beschikbaarheid.filter((b) => ['ingediend', 'goedgekeurd', 'gedeeltelijk'].includes(b.status)))
      setBlokken(j.planning.filter((p) => p.status !== 'geannuleerd' && p.bevestiging !== 'geweigerd'))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [maandag])
  useEffect(() => { laad() }, [laad])

  const voegToe = async (datum: string, start: string, eind: string) => {
    if (datum < vandaag) { toast.error('Een dag in het verleden kan je niet meer doorgeven.'); return }
    setBezig(true)
    try {
      await api('/api/team/beschikbaarheid', { body: { datum, blokken: [{ start, eind }] } })
      toast.success(`Beschikbaar op ${dagLang(datum)}, ${start}–${eind}.`)
      await laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  const items = useMemo<WkItem[]>(() => [
    ...(vrij ?? []).map((b) => ({ id: `b${b.id}`, datum: b.datum, start: kortUur(b.start_tijd), eind: kortUur(b.eind_tijd), laan: 'ik', kleur: GROEN, soort: 'beschikbaar' as const, titel: 'Beschikbaar', onClick: () => setOpen(b) })),
    ...blokken.map((p) => ({
      id: `p${p.id}`, datum: p.datum, start: kortUur(p.start_tijd), eind: kortUur(p.eind_tijd), laan: 'ik', kleur: ZWART, soort: 'werkblok' as const,
      titel: p.taak || p.project || 'Ingeboekt', sub: p.klant, status: (p.bevestiging === 'te_bevestigen' ? 'te_bevestigen' : 'bevestigd') as WkItem['status'],
      onClick: () => { window.location.href = `/team/planning?blok=${p.id}` },
    })),
  ], [vrij, blokken])

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold">Wanneer ben je beschikbaar?</h1>
        <p className="text-sm text-gray-500">Sleep over de uren waarop je kunt werken — het wordt meteen bewaard. Op je telefoon: tik op een uur, of gebruik snel toevoegen. Klik op een groen blok om het aan te passen.</p>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <WeekNavigatie maandag={maandag} onMaandag={setMaandag} vandaag={vandaag} />
        {bezig && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {vrij === null ? <div className="py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : (
        <WeekKalender maandag={maandag} items={items} vandaag={vandaag}
          onSelectie={(s: WkSelectie) => voegToe(s.datum, s.start, s.eind)} />
      )}

      <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: 'rgba(22,163,74,0.18)', borderLeft: `3px solid ${GROEN}` }} />Beschikbaar</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: ZWART }} />Ingeboekt</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: `repeating-linear-gradient(135deg, ${ZWART}, ${ZWART} 3px, #6b7280 3px, #6b7280 6px)` }} />Wacht op jouw bevestiging</span>
      </div>

      {open && <BewerkBlok b={open} onSluit={() => setOpen(null)} onKlaar={async () => { setOpen(null); await laad() }} />}

      {/* Snel toevoegen (handig op de telefoon) */}
      <form className="card-base p-3 space-y-2" onSubmit={(e) => { e.preventDefault(); voegToe(snel.datum, snel.start, snel.eind) }}>
        <div className="text-sm font-semibold">Snel toevoegen</div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className={LBL}>Dag</label><input type="date" className={INP} min={vandaag} value={snel.datum} onChange={(e) => setSnel((s) => ({ ...s, datum: e.target.value }))} /></div>
          <div><label className={LBL}>Van</label><select className={INP} value={snel.start} onChange={(e) => setSnel((s) => ({ ...s, start: e.target.value }))}>{UREN.map((u) => <option key={u}>{u}</option>)}</select></div>
          <div><label className={LBL}>Tot</label><select className={INP} value={snel.eind} onChange={(e) => setSnel((s) => ({ ...s, eind: e.target.value }))}>{UREN.map((u) => <option key={u}>{u}</option>)}</select></div>
        </div>
        <button type="submit" disabled={bezig} className="btn-primary w-full justify-center"><Plus className="h-4 w-4" />Beschikbaar zetten</button>
      </form>
    </div>
  )
}

/** Een blok aanpassen of verwijderen — meteen bewaard, geen extra bevestiging. */
function BewerkBlok({ b, onSluit, onKlaar }: { b: Beschikbaar; onSluit: () => void; onKlaar: () => void }) {
  const [start, setStart] = useState(kortUur(b.start_tijd))
  const [eind, setEind] = useState(kortUur(b.eind_tijd))
  const [bezig, setBezig] = useState(false)
  const doe = async (methode: 'PATCH' | 'DELETE') => {
    setBezig(true)
    try {
      await api(`/api/team/beschikbaarheid/${b.id}`, methode === 'PATCH' ? { method: 'PATCH', body: { start, eind } } : { method: 'DELETE' })
      toast.success(methode === 'PATCH' ? 'Aangepast.' : 'Verwijderd.')
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="card-base p-3 space-y-2 border-green-200">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Beschikbaar op {dagLang(b.datum)}</div>
        <button type="button" onClick={onSluit} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={LBL}>Van</label><select className={INP} value={start} onChange={(e) => setStart(e.target.value)}>{UREN.map((u) => <option key={u}>{u}</option>)}</select></div>
        <div><label className={LBL}>Tot</label><select className={INP} value={eind} onChange={(e) => setEind(e.target.value)}>{UREN.map((u) => <option key={u}>{u}</option>)}</select></div>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={bezig} onClick={() => doe('PATCH')} className="btn-primary flex-1 justify-center"><Save className="h-4 w-4" />Opslaan</button>
        <button type="button" disabled={bezig} onClick={() => doe('DELETE')} className="btn-secondary text-red-600"><Trash2 className="h-4 w-4" />Verwijderen</button>
      </div>
    </div>
  )
}
