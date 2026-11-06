'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Loader2, MapPin, Monitor, Trash2, Video } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import { laadAfbeeldingOp } from '@/lib/marketing-upload'
import { publiekeUrl } from '@/lib/marketing-media'
import { EVENT_SOORTEN, SOORT_LABEL, leesPrijs, prijsTekst, type EventSoort } from '@/lib/events'

export type Formulier = {
  titel: string; soort: EventSoort; soort_label: string; samenvatting: string; beschrijving: string; cover_pad: string; spreker: string
  datum: string; start: string; einde: string; einddatum: string
  vorm: 'online' | 'locatie'; locatie: string; met_meet: boolean
  capaciteit: string; prijs: string; inschrijven_tot: string; agenda_id: string
}

export const leegFormulier = (agenda: string | null): Formulier => ({
  titel: '', soort: 'workshop', soort_label: '', samenvatting: '', beschrijving: '', cover_pad: '', spreker: '',
  datum: '', start: '10:00', einde: '11:00', einddatum: '',
  vorm: 'online', locatie: '', met_meet: false,
  capaciteit: '', prijs: '', inschrijven_tot: '', agenda_id: agenda ?? '',
})

const LBL = 'block text-xs font-medium text-gray-600 mb-1'
const plusMinuten = (u: string, min: number) => {
  const [h, m] = u.split(':').map(Number)
  const t = Math.min(23 * 60 + 59, h * 60 + m + min)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const DUUR: { label: string; min?: number; vast?: [string, string] }[] = [
  { label: '1 uur', min: 60 }, { label: '1u30', min: 90 }, { label: '2 uur', min: 120 }, { label: '3 uur', min: 180 },
  { label: 'Halve dag', min: 240 }, { label: 'Hele dag', vast: ['09:00', '17:00'] },
]

/**
 * Het formulier om een event in te plannen. Geen eigen opslag: de ouder
 * bewaart (concept, publiceren of wijzigingen) en kent de status.
 */
export function EventFormulier({ f, zet, agendas, agendaVast, gepubliceerd }: {
  f: Formulier
  zet: (patch: Partial<Formulier>) => void
  agendas: { id: string; naam: string; gekoppeld: boolean }[]
  agendaVast: boolean
  gepubliceerd: boolean
}) {
  const [meerdaags, setMeerdaags] = useState(!!f.einddatum && f.einddatum !== f.datum)
  const [laden, setLaden] = useState(false)
  const bestand = useRef<HTMLInputElement>(null)
  const prijs = leesPrijs(f.prijs)

  const kiesCover = async (file: File | undefined) => {
    if (!file) return
    setLaden(true)
    try { const r = await laadAfbeeldingOp('/api/admin/events/upload', file); zet({ cover_pad: r.pad }) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') }
    finally { setLaden(false); if (bestand.current) bestand.current.value = '' }
  }

  return (
    <div className="space-y-5">
      {/* Soort */}
      <div>
        <span className={LBL}>Wat is het?</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Soort event">
          {EVENT_SOORTEN.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={f.soort === s}
              onClick={() => zet({ soort: s, ...(s === 'webinar' ? { vorm: 'online' as const } : {}) })}
              className={`px-3 py-1.5 rounded-full text-sm border ${f.soort === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>
              {s === 'andere' ? 'Andere: zelf typen…' : SOORT_LABEL[s].enkel}
            </button>
          ))}
        </div>
        {f.soort === 'andere' && <input className={`${INP} mt-2 max-w-xs`} value={f.soort_label} onChange={(e) => zet({ soort_label: e.target.value })} placeholder="Bv. Masterclass, Netwerkavond" maxLength={40} aria-label="Eigen soort" autoFocus />}
      </div>

      <div>
        <label className={LBL} htmlFor="ev-titel">Titel</label>
        <input id="ev-titel" className={INP} value={f.titel} onChange={(e) => zet({ titel: e.target.value })} placeholder="bv. Workshop: scrollstoppende reels in 2 uur" maxLength={140} />
      </div>

      {/* Wanneer */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
          <div className="col-span-2 sm:col-span-1"><label className={LBL} htmlFor="ev-datum">Datum</label><input id="ev-datum" type="date" className={INP} value={f.datum} onChange={(e) => zet({ datum: e.target.value, ...(meerdaags ? {} : { einddatum: '' }) })} /></div>
          <div><label className={LBL} htmlFor="ev-start">Van</label><input id="ev-start" type="time" step={300} className={INP} value={f.start} onChange={(e) => zet({ start: e.target.value })} /></div>
          <div><label className={LBL} htmlFor="ev-einde">Tot</label><input id="ev-einde" type="time" step={300} className={INP} value={f.einde} onChange={(e) => zet({ einde: e.target.value })} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {DUUR.map((d) => (
            <button key={d.label} type="button" onClick={() => zet(d.vast ? { start: d.vast[0], einde: d.vast[1] } : { einde: plusMinuten(f.start || '10:00', d.min!) })}
              className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:border-gray-400">{d.label}</button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={meerdaags} onChange={(e) => { setMeerdaags(e.target.checked); if (!e.target.checked) zet({ einddatum: '' }) }} />Meerdere dagen
          </label>
        </div>
        {meerdaags && <div className="max-w-[220px]"><label className={LBL} htmlFor="ev-einddatum">Laatste dag</label><input id="ev-einddatum" type="date" min={f.datum || undefined} className={INP} value={f.einddatum} onChange={(e) => zet({ einddatum: e.target.value })} /></div>}
      </div>

      {/* Waar */}
      <div className="space-y-2">
        <span className={LBL}>Waar</span>
        <div className="grid grid-cols-2 gap-2">
          {([['online', Monitor, 'Online', 'Met Google Meet-link'], ['locatie', MapPin, 'Op locatie', 'Met adres']] as const).map(([k, Icon, t, sub]) => (
            <button key={k} type="button" onClick={() => zet({ vorm: k })} aria-pressed={f.vorm === k}
              className={`flex items-center gap-2.5 rounded-xl border p-3 text-left ${f.vorm === k ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200 hover:border-gray-400'}`}>
              <Icon className="h-5 w-5 text-gray-600 shrink-0" />
              <span className="min-w-0"><span className="block text-sm font-medium">{t}</span><span className="block text-xs text-gray-500">{sub}</span></span>
            </button>
          ))}
        </div>
        {f.vorm === 'locatie' && (
          <>
            <input className={INP} value={f.locatie} onChange={(e) => zet({ locatie: e.target.value })} placeholder="Straat en nummer, postcode en gemeente" aria-label="Adres" maxLength={300} />
            <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={f.met_meet} onChange={(e) => zet({ met_meet: e.target.checked })} /><Video className="h-4 w-4 text-gray-500" />Ook online volgen via Google Meet</label>
          </>
        )}
      </div>

      {/* Plaatsen, prijs, inschrijven tot */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div><label className={LBL} htmlFor="ev-cap">Plaatsen</label><input id="ev-cap" inputMode="numeric" className={INP} value={f.capaciteit} onChange={(e) => zet({ capaciteit: e.target.value.replace(/[^\d]/g, '') })} placeholder="Onbeperkt" /></div>
        <div>
          <label className={LBL} htmlFor="ev-prijs">Prijs (€ excl. btw)</label>
          <input id="ev-prijs" inputMode="decimal" className={INP} value={f.prijs} onChange={(e) => zet({ prijs: e.target.value })} placeholder="Gratis" />
          <p className={`text-[11px] mt-1 ${prijs === null ? 'text-red-600' : 'text-gray-500'}`}>{prijs === null ? 'Geen geldig bedrag' : prijsTekst(prijs)}</p>
        </div>
        <div className="col-span-2 sm:col-span-1"><label className={LBL} htmlFor="ev-tot">Inschrijven tot</label><input id="ev-tot" type="date" max={f.datum || undefined} className={INP} value={f.inschrijven_tot} onChange={(e) => zet({ inschrijven_tot: e.target.value })} /><p className="text-[11px] text-gray-500 mt-1">Leeg: tot het begint</p></div>
      </div>
      {prijs !== null && prijs > 0 && <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">Wie inschrijft, gaat akkoord met een Peppol-factuur achteraf. Er wordt niets betaald in de app; je ziet per inschrijving wat nog te factureren is.</p>}

      {/* Inhoud */}
      <div><label className={LBL} htmlFor="ev-spreker">Door (spreker of begeleider)</label><input id="ev-spreker" className={INP} value={f.spreker} onChange={(e) => zet({ spreker: e.target.value })} placeholder="bv. Bram van NextGenMedia" maxLength={160} /></div>
      <div>
        <label className={LBL} htmlFor="ev-samenvatting">In één zin</label>
        <input id="ev-samenvatting" className={INP} value={f.samenvatting} onChange={(e) => zet({ samenvatting: e.target.value })} placeholder="Wat neemt de klant mee naar huis?" maxLength={300} />
      </div>
      <div>
        <label className={LBL} htmlFor="ev-beschrijving">Beschrijving</label>
        <textarea id="ev-beschrijving" rows={7} className={INP} value={f.beschrijving} onChange={(e) => zet({ beschrijving: e.target.value })} placeholder={'Programma, voor wie, wat mee te brengen…\n\n- Lijstjes met een streepje\n**vet** en *cursief* mag ook'} />
      </div>

      {/* Cover */}
      <div>
        <span className={LBL}>Coverfoto</span>
        {f.cover_pad ? (
          <div className="relative rounded-xl overflow-hidden border border-gray-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={publiekeUrl(f.cover_pad) ?? ''} alt="" className="w-full aspect-[16/7] object-cover" />
            <button type="button" onClick={() => zet({ cover_pad: '' })} className="absolute top-2 right-2 h-8 w-8 rounded-lg bg-white/90 flex items-center justify-center hover:bg-white" aria-label="Foto verwijderen"><Trash2 className="h-4 w-4" /></button>
          </div>
        ) : (
          <button type="button" onClick={() => bestand.current?.click()} disabled={laden} className="w-full rounded-xl border border-dashed border-gray-300 py-6 flex flex-col items-center gap-1 text-sm text-gray-500 hover:border-gray-400">
            {laden ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            {laden ? 'Opladen…' : 'Foto kiezen (liggend werkt het best)'}
          </button>
        )}
        <input ref={bestand} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => kiesCover(e.target.files?.[0])} />
      </div>

      {/* Google */}
      <div>
        <label className={LBL} htmlFor="ev-agenda">Google-agenda</label>
        <select id="ev-agenda" className={INP} value={f.agenda_id} disabled={agendaVast} onChange={(e) => zet({ agenda_id: e.target.value })}>
          <option value="">Standaardagenda van NextGenMedia</option>
          {agendas.map((a) => <option key={a.id} value={a.id} disabled={!a.gekoppeld}>{a.naam}{a.gekoppeld ? '' : ' (koppeling verlopen)'}</option>)}
        </select>
        <p className="text-[11px] text-gray-500 mt-1">
          {agendaVast ? 'Na publiceren blijft het event in deze agenda.' : gepubliceerd ? '' : 'Bij publiceren komt het event in deze agenda; online events krijgen meteen een Google Meet-link. Inschrijvers komen op de gastenlijst en zien elkaar niet.'}
        </p>
      </div>
    </div>
  )
}
