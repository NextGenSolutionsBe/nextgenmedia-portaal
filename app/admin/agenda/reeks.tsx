'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Lock, Repeat, Trash2, SkipForward, Square, Pencil, ExternalLink } from 'lucide-react'
import { Modal } from '@/app/admin/materiaal/dialogen'
import { vandaag, kortDag, type Item } from '@/lib/agenda/model'
import { BLOK_TYPES, DAG_KORT, blokType, reeksTekst, weekdagVan, leesReeksItemId, type Reeks, type ReeksSoort } from '@/lib/agenda/reeksen'
import { api, MapKiezer, MapLabel, WieKiezer, Schakel, focusRing, type BoomData } from './gedeeld'

export const teamActie = <T = { ok: true; id?: string }>(body: Record<string, unknown>) => api<T>('/api/admin/agenda/team', body)

/**
 * Reeksen (verbeterplan fase 3): vaste blokken (Sales, Focuswerk, Overleg, Opleiding),
 * herhalende afspraken en herhalende taken. De app maakt nooit zelf een reeks: enkel wie
 * dit venster invult. Een keer overslaan, vanaf een dag stoppen of de reeks naar de prullenbak.
 */

const SOORTEN: { key: ReeksSoort; label: string; uitleg: string }[] = [
  { key: 'blok', label: 'Vast blok', uitleg: 'Tijd die vastligt, bv. sales of focuswerk' },
  { key: 'afspraak', label: 'Afspraak', uitleg: 'Een terugkerend moment, bv. weekoverleg' },
  { key: 'taak', label: 'Taak', uitleg: 'Iets dat telkens terugkomt, af te vinken' },
]

export function ReeksFormulier({ boom, bestaand, standaard, onSluit, onBewaard }: {
  boom: BoomData; bestaand?: Reeks | null; standaard?: { soort?: ReeksSoort; dag?: string; van?: string; tot?: string }
  onSluit: () => void; onBewaard: () => void
}) {
  const startDag = standaard?.dag ?? vandaag()
  const [soort, setSoort] = useState<ReeksSoort>(bestaand?.soort ?? standaard?.soort ?? 'blok')
  const [blok, setBlok] = useState(bestaand?.blok_type ?? 'focus')
  const [titel, setTitel] = useState(bestaand?.titel ?? '')
  const [dagen, setDagen] = useState<number[]>(bestaand?.dagen ?? [weekdagVan(startDag)])
  const [van, setVan] = useState(bestaand?.van ?? standaard?.van ?? '09:00')
  const [tot, setTot] = useState(bestaand?.tot ?? standaard?.tot ?? '11:00')
  const [metUur, setMetUur] = useState(bestaand ? !!bestaand.van : true)
  const [vanaf, setVanaf] = useState(bestaand?.start_datum ?? startDag)
  const [totDatum, setTotDatum] = useState(bestaand?.eind_datum ?? '')
  const [interval, setInterval] = useState(bestaand?.interval_weken ?? 1)
  const [wie, setWie] = useState<string[]>(bestaand?.personen ?? [boom.ik])
  const [lijst, setLijst] = useState<string | null>(bestaand?.lijst_id ?? null)
  const [prive, setPrive] = useState(bestaand?.prive ?? false)
  const [mapOpen, setMapOpen] = useState(false)
  const [bezig, setBezig] = useState(false)
  const uurNodig = soort !== 'taak' || metUur

  const bewaar = async () => {
    setBezig(true)
    try {
      await teamActie({
        actie: bestaand ? 'reeks.wijzig' : 'reeks.nieuw', id: bestaand?.id, soort, blok_type: soort === 'blok' ? blok : null,
        titel: titel.trim() || (soort === 'blok' ? blokType(blok).label : ''), dagen, interval_weken: interval,
        van: uurNodig ? van : null, tot: uurNodig ? tot : null, start_datum: vanaf, eind_datum: totDatum || null,
        personen: wie, lijst_id: lijst, prive,
      })
      toast.success(bestaand ? 'Reeks aangepast.' : 'Reeks gemaakt.')
      onBewaard()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  const chip = (aan: boolean) => `rounded-full border px-2.5 py-1 text-xs ${aan ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`
  return (
    <Modal titel={bestaand ? 'Reeks aanpassen' : 'Nieuwe reeks'} sub={reeksTekst({ dagen, interval_weken: interval, van: uurNodig ? van : null, tot: uurNodig ? tot : null })} onSluit={onSluit}
      voet={<><button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button><button type="button" onClick={bewaar} disabled={bezig || !dagen.length || !wie.length} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{bestaand ? 'Bewaren' : 'Reeks maken'}</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-1.5">
          {SOORTEN.map((s) => (
            <button key={s.key} type="button" onClick={() => setSoort(s.key)} aria-pressed={soort === s.key} title={s.uitleg}
              className={`rounded-xl border px-2 py-2 text-left ${soort === s.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 hover:border-gray-400'} ${focusRing}`}>
              <span className="block text-sm font-semibold">{s.label}</span><span className={`block text-[11px] leading-snug ${soort === s.key ? 'text-white/70' : 'text-gray-500'}`}>{s.uitleg}</span>
            </button>
          ))}
        </div>
        {soort === 'blok' && (
          <div className="flex flex-wrap gap-1.5">
            {BLOK_TYPES.map((b) => <button key={b.key} type="button" onClick={() => setBlok(b.key)} aria-pressed={blok === b.key} className={chip(blok === b.key)}><span className="inline-block h-2 w-2 rounded-full mr-1.5 align-middle" style={{ background: b.kleur }} />{b.label}</button>)}
          </div>
        )}
        <input value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} className="input-base" placeholder={soort === 'blok' ? `Titel (standaard: ${blokType(blok).label})` : soort === 'taak' ? 'Wat moet er telkens gebeuren?' : 'Waarover gaat de afspraak?'} aria-label="Titel" />
        <div>
          <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Op welke dagen</div>
          <div className="flex flex-wrap gap-1.5">
            {DAG_KORT.map((d, n) => <button key={d} type="button" onClick={() => setDagen(dagen.includes(n + 1) ? dagen.filter((x) => x !== n + 1) : [...dagen, n + 1].sort())} aria-pressed={dagen.includes(n + 1)} className={chip(dagen.includes(n + 1))}>{d}</button>)}
            <select value={interval} onChange={(e) => setInterval(Number(e.target.value))} className="input-base !w-auto !py-1 text-xs" aria-label="Om de hoeveel weken">
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 1 ? 'elke week' : `om de ${n} weken`}</option>)}
            </select>
          </div>
        </div>
        {soort === 'taak' && <Schakel aan={metUur} onWissel={() => setMetUur(!metUur)} label={<span className="text-sm">Met een uur</span>} />}
        {uurNodig && (
          <div className="flex items-center gap-2">
            <input type="time" step={300} value={van} onChange={(e) => setVan(e.target.value)} className="input-base !w-[7rem]" aria-label="Van" />
            <span className="text-gray-400">tot</span>
            <input type="time" step={300} value={tot} onChange={(e) => setTot(e.target.value)} className="input-base !w-[7rem]" aria-label="Tot" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600">Vanaf</span><input type="date" value={vanaf} onChange={(e) => setVanaf(e.target.value)} className="input-base !w-auto !py-1" aria-label="Vanaf" />
          <span className="text-gray-600">tot</span><input type="date" value={totDatum} min={vanaf} onChange={(e) => setTotDatum(e.target.value)} className="input-base !w-auto !py-1" aria-label="Tot (leeg = zonder einde)" />
          {!totDatum && <span className="text-xs text-gray-400">zonder einde</span>}
        </div>
        <div>
          <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Voor wie</div>
          <WieKiezer boom={boom} gekozen={wie} onWissel={(p) => setWie(wie.includes(p) ? wie.filter((x) => x !== p) : [...wie, p])} />
          {!boom.isAdmin && wie.some((p) => p !== boom.ik) && <p className="text-xs text-amber-700 mt-1">Enkel een zaakvoerder maakt een reeks voor iemand anders.</p>}
        </div>
        <div>
          <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Map {soort === 'taak' ? '' : '(optioneel)'}</div>
          <button type="button" onClick={() => setMapOpen(!mapOpen)} className={`w-full rounded-xl border border-gray-200 px-3 py-2 text-left text-sm hover:border-gray-400 ${focusRing}`}><MapLabel boom={boom} lijstId={lijst} leeg={soort === 'taak' ? 'Kies de map' : 'Geen map'} /></button>
          {mapOpen && <div className="mt-1.5 rounded-xl border border-gray-200"><MapKiezer vol boom={boom} gekozen={lijst} leeg={soort === 'taak' ? null : 'Geen map'} onKies={(l) => { setLijst(l); setMapOpen(false) }} /></div>}
        </div>
        <Schakel aan={prive} onWissel={() => setPrive(!prive)} label={<span className="text-sm flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" />Privé (anderen zien enkel &quot;Bezet&quot;)</span>} />
      </div>
    </Modal>
  )
}

/** Een keer uit een reeks: wat het is, en deze keer overslaan, vanaf hier stoppen, aanpassen of weg. */
export function ReeksVenster({ item, boom, onSluit, onVernieuw, onOpenItem }: { item: Item; boom: BoomData; onSluit: () => void; onVernieuw: () => void; onOpenItem: (id: string) => void }) {
  const keer = leesReeksItemId(item.id)
  const [reeks, setReeks] = useState<Reeks | null>(null)
  const [aanpassen, setAanpassen] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)
  useEffect(() => {
    if (!keer) return
    api<{ reeks: Reeks }>(`/api/admin/agenda/team?reeks=${keer.reeksId}`).then((j) => setReeks(j.reeks)).catch((e) => toast.error(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [keer?.reeksId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!keer) return null
  const mag = !!reeks && (boom.isAdmin || reeks.eigenaar_id === boom.ik || reeks.personen.includes(boom.ik))
  const doe = async (wat: string, body: Record<string, unknown>, klaar: string, terug?: Record<string, unknown>) => {
    setBezig(wat)
    try {
      const r = await teamActie<{ ok: true; id?: string }>(body)
      onVernieuw()
      if (wat === 'open' && r.id) { onOpenItem(r.id); return }
      toast.success(klaar, terug ? { action: { label: 'Ongedaan maken', onClick: () => { teamActie(terug).then(onVernieuw).catch(() => toast.error('Terugzetten mislukt')) } } } : undefined)
      onSluit()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  if (aanpassen && reeks) return <ReeksFormulier boom={boom} bestaand={reeks} onSluit={() => setAanpassen(false)} onBewaard={() => { setAanpassen(false); onVernieuw(); onSluit() }} />
  const knop = 'btn-secondary !py-1.5 !text-sm justify-start'
  return (
    <Modal titel={<span className="flex items-center gap-2">{item.reeks?.soort === 'blok' ? <Lock className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}{item.titel}</span>} sub={reeks ? `${reeksTekst(reeks)} · deze keer ${kortDag(keer.datum)}` : kortDag(keer.datum)} onSluit={onSluit}>
      {!reeks ? <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div> : (
        <div className="space-y-3">
          {reeks.soort === 'blok' && <p className="text-sm text-gray-600">{blokType(reeks.blok_type).label}: klanten kunnen hier geen meeting boeken; intern krijg je een waarschuwing.</p>}
          {reeks.lijst_id && <div className="text-sm"><MapLabel boom={boom} lijstId={reeks.lijst_id} /></div>}
          {!mag && <p className="text-sm text-gray-500">Enkel wie op deze reeks staat, kan ze aanpassen.</p>}
          {mag && (
            <div className="grid gap-1.5">
              {reeks.soort === 'taak' && <button type="button" disabled={!!bezig} onClick={() => doe('open', { actie: 'reeks.keer', id: item.id }, '')} className={knop}>{bezig === 'open' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}Deze keer openen als taak</button>}
              <button type="button" disabled={!!bezig} onClick={() => doe('over', { actie: 'reeks.overslaan', id: item.id }, `${kortDag(keer.datum)} overgeslagen.`, { actie: 'reeks.overslaan', id: item.id, terug: true })} className={knop}><SkipForward className="h-4 w-4" />Deze keer overslaan</button>
              <button type="button" disabled={!!bezig} onClick={() => setAanpassen(true)} className={knop}><Pencil className="h-4 w-4" />Reeks aanpassen</button>
              <button type="button" disabled={!!bezig} onClick={() => { if (confirm(`Vanaf ${kortDag(keer.datum)} stoppen? Wat voorbij is, blijft staan.`)) doe('stop', { actie: 'reeks.stop', id: keer.reeksId, datum: keer.datum }, 'Reeks gestopt.') }} className={knop}><Square className="h-4 w-4" />Vanaf deze keer stoppen</button>
              {boom.rechten.verwijderen && <button type="button" disabled={!!bezig} onClick={() => { if (confirm('De hele reeks naar de prullenbak? Keren die al een eigen taak werden, blijven staan.')) doe('weg', { actie: 'reeks.verwijder', id: keer.reeksId }, 'Reeks verwijderd.', { actie: 'reeks.verwijder', id: keer.reeksId, terug: true }) }} className={`${knop} text-red-700`}><Trash2 className="h-4 w-4" />Hele reeks verwijderen</button>}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
