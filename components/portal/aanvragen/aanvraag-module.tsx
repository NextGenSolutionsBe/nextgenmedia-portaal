'use client'

import { TeamFotoKaart, GeenVoorkeur } from '@/components/portal/team-foto-kaart'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, ArrowLeft, ArrowRight, Check, Paperclip, X, UserRound, Sparkles, CalendarDays, MapPin, FileText, Send,
  ChevronDown, ExternalLink, Info, CircleCheck, Upload,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  catalogus, vindType, veldenVan, locatieNodig, DAGEN, TIJDSTIPPEN, CONSULTANCY_TARIEF, STATUS, antwoordRegels, timingTekst,
  type AanvraagSoort, type AanvraagType, type Veld,
} from '@/lib/aanvragen/model'
import { MAX_BESTANDEN, MAX_BYTES, mimeToegestaan } from '@/lib/aanvragen/bestanden'

/**
 * Klantportaal — Diensten aanvragen en Consultancy aanvragen. Eén flow in
 * stappen (kiezen, details, timing, expert, nakijken) en het overzicht "Mijn
 * aanvragen" met de status en een eventuele offerte. Een aanvraag is geen
 * boeking: de klant geeft wensen en timing door, wij plannen in.
 */

type Expert = { id: string; naam: string; rollen: string[]; expertises: string[]; foto_url: string | null; specialist?: boolean }
type Bestand = { pad: string; bestandsnaam: string; mimetype: string; grootte: number }
type Aanvraag = {
  id: string; soort: AanvraagSoort; type: string; type_label: string; wat: string; briefing: string | null; aandachtspunten: string | null
  antwoorden: Record<string, unknown>; periode_van: string | null; periode_tot: string | null; voorkeursdagen: string[]; tijdstippen: string[]
  locatie: string | null; deadline: string | null; expert_naam: string | null; status: string; status_label: string; reden_klant: string | null; mag_intrekken: boolean
  offerte: { titel: string | null; notitie: string | null; status: 'open' | 'aanvaard' | 'geweigerd'; verstuurd_op: string | null; beslist_op: string | null; heeft_bestand: boolean; url: string | null } | null
  bestanden: { id: string; bestandsnaam: string; grootte: number | null }[]; ingediend_door: string | null; created_at: string
}

const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15 focus:border-gray-900'
const LBL = 'block text-xs font-medium text-gray-700 mb-1'
const knop = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1'
const nieuweSleutel = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '')
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const datumKort = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })
const grootte = (n: number | null) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`)

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis.')
  return j as T
}

export function AanvraagModule({ soort }: { soort: AanvraagSoort }) {
  const [aanvragen, setAanvragen] = useState<Aanvraag[] | null>(null)
  const [laadFout, setLaadFout] = useState<string | null>(null)
  const [tab, setTab] = useState<'nieuw' | 'mijn'>('nieuw')
  const laad = useCallback(async () => {
    try { const j = await api<{ aanvragen: Aanvraag[] }>(`/api/portal/aanvragen?soort=${soort}`); setAanvragen(j.aanvragen); setLaadFout(null) }
    catch (e) { setLaadFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [soort])
  useEffect(() => { laad() }, [laad])
  const offertes = (aanvragen ?? []).filter((a) => a.offerte?.status === 'open')

  return (
    <div className="space-y-4">
      {offertes.length > 0 && (
        <button type="button" onClick={() => setTab('mijn')} className={`w-full text-left rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 flex items-center gap-2 ${knop}`}>
          <FileText className="h-4 w-4 shrink-0" />
          <span className="flex-1">{offertes.length === 1 ? 'Er staat een offerte klaar voor jou.' : `Er staan ${offertes.length} offertes klaar voor jou.`} Bekijk en beslis in “Mijn aanvragen”.</span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </button>
      )}
      <div className="flex gap-1.5 lg:hidden" role="tablist">
        {(['nieuw', 'mijn'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${tab === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200'} ${knop}`}>
            {k === 'nieuw' ? 'Nieuwe aanvraag' : `Mijn aanvragen${aanvragen?.length ? ` (${aanvragen.length})` : ''}`}
          </button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start">
        <div className={tab === 'nieuw' ? '' : 'hidden lg:block'}><NieuweAanvraag soort={soort} onVerstuurd={() => laad()} /></div>
        <section className={`space-y-3 ${tab === 'mijn' ? '' : 'hidden lg:block'}`} aria-labelledby="mijn-aanvragen">
          <h2 id="mijn-aanvragen" className="text-base font-semibold">Mijn aanvragen</h2>
          {laadFout && <div className="card-base text-sm text-red-700">{laadFout}</div>}
          {!aanvragen && !laadFout && <div className="card-base flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
          {aanvragen?.length === 0 && <div className="card-base text-sm text-gray-500">Nog geen aanvragen. Je eerste aanvraag verschijnt hier, met de status en een eventuele offerte.</div>}
          <ul className="space-y-2">{aanvragen?.map((a) => <li key={a.id}><AanvraagKaart a={a} onVeranderd={laad} /></li>)}</ul>
        </section>
      </div>
    </div>
  )
}

/** Enkel de lijst "Mijn aanvragen" van één soort (bv. op de pagina Founders of Flanders). */
export function MijnAanvragen({ soort, ververs = 0, leeg }: { soort: AanvraagSoort; ververs?: number; leeg: string }) {
  const [aanvragen, setAanvragen] = useState<Aanvraag[] | null>(null)
  const laad = useCallback(async () => {
    try { setAanvragen((await api<{ aanvragen: Aanvraag[] }>(`/api/portal/aanvragen?soort=${soort}`)).aanvragen) } catch { setAanvragen([]) }
  }, [soort])
  useEffect(() => { laad() }, [laad, ververs])
  if (aanvragen === null) return <div className="card-base flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  if (!aanvragen.length) return <div className="card-base text-sm text-gray-500">{leeg}</div>
  return <ul className="space-y-2">{aanvragen.map((a) => <li key={a.id}><AanvraagKaart a={a} onVeranderd={laad} /></li>)}</ul>
}

// ── Nieuwe aanvraag ──────────────────────────────────────────────────────────

const STAPPEN = ['Kiezen', 'Details', 'Timing', 'Expert', 'Nakijken'] as const

function NieuweAanvraag({ soort, onVerstuurd }: { soort: AanvraagSoort; onVerstuurd: () => void }) {
  const [stap, setStap] = useState(0)
  const [type, setType] = useState<string | null>(null)
  const [wat, setWat] = useState('')
  const [briefing, setBriefing] = useState('')
  const [aandachtspunten, setAandachtspunten] = useState('')
  const [antwoorden, setAntwoorden] = useState<Record<string, string | string[]>>({})
  const [periodeVan, setPeriodeVan] = useState('')
  const [periodeTot, setPeriodeTot] = useState('')
  const [dagen, setDagen] = useState<string[]>([])
  const [tijden, setTijden] = useState<string[]>([])
  const [locatie, setLocatie] = useState('')
  const [deadline, setDeadline] = useState('')
  const [expert, setExpert] = useState<string>('')
  const [experts, setExperts] = useState<Expert[] | null>(null)
  const [bestanden, setBestanden] = useState<Bestand[]>([])
  const [uploaden, setUploaden] = useState<string[]>([])
  const [sleutel, setSleutel] = useState(nieuweSleutel)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [klaar, setKlaar] = useState(false)
  const top = useRef<HTMLDivElement>(null)

  const t: AanvraagType | null = type ? vindType(soort, type) : null
  const velden: Veld[] = t ? veldenVan(soort, t) : []
  const locatieRegel = t ? locatieNodig(soort, t, antwoorden) : 'geen'

  // Experts laden zodra de dienst gekozen is (enkel wie past).
  useEffect(() => {
    if (!type) return
    setExperts(null); setExpert('')
    api<{ experts: Expert[] }>(`/api/portal/aanvragen/experts?soort=${soort}&type=${type}`).then((j) => setExperts(j.experts)).catch(() => setExperts([]))
  }, [soort, type])

  const leeg = (v: Veld) => !(Array.isArray(antwoorden[v.key]) ? (antwoorden[v.key] as string[]).length : String(antwoorden[v.key] ?? '').trim())
  const probleem = (s: number): string | null => {
    if (s >= 0 && !t) return soort === 'dienst' ? 'Kies een dienst.' : 'Kies een soort consultancy.'
    if (s >= 1 && t) {
      if (wat.trim().length < 5) return `Vul in: ${t.watLabel.toLowerCase().replace(/[?.]$/, '')}.`
      // "Waar?" (consultancy) staat bij Timing, niet bij Details.
      for (const v of velden) if (v.key !== 'vorm' && v.verplicht && leeg(v)) return `Vul in: ${v.label.replace(/[?.]$/, '').toLowerCase()}.`
    }
    if (s >= 2 && velden.some((v) => v.key === 'vorm' && v.verplicht && leeg(v))) return 'Kies of het gesprek online of op locatie doorgaat.'
    if (s >= 2) {
      if (!periodeVan) return 'Kies een gewenste datum.'
      if (periodeVan < vandaag()) return 'De gewenste datum ligt in het verleden.'
      if (periodeVan && periodeTot && periodeTot < periodeVan) return 'Het einde van de periode ligt vóór het begin.'
      if (periodeTot && periodeTot < vandaag()) return 'De gewenste periode ligt in het verleden.'
      if (deadline && deadline < vandaag()) return 'De deadline ligt in het verleden.'
      if (locatieRegel === 'verplicht' && locatie.trim().length < 3) return soort === 'consultancy' ? 'Vul het adres in.' : 'Vul de locatie in.'
    }
    if (s >= 4 && uploaden.length) return 'Wacht tot de bestanden opgeladen zijn.'
    return null
  }
  const verder = () => {
    const p = probleem(stap)
    if (p) { setFout(p); return }
    setFout(null); setStap(stap + 1); top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const terug = () => { setFout(null); setStap(Math.max(0, stap - 1)) }

  async function upload(lijst: FileList | null) {
    if (!lijst) return
    for (const f of Array.from(lijst)) {
      if (bestanden.length + uploaden.length >= MAX_BESTANDEN) { toast.error(`Hoogstens ${MAX_BESTANDEN} bestanden.`); break }
      if (!mimeToegestaan(f.type)) { toast.error(`${f.name}: dit bestandstype kunnen we niet aannemen.`); continue }
      if (f.size > MAX_BYTES) { toast.error(`${f.name} is te groot (max. 100 MB).`); continue }
      setUploaden((u) => [...u, f.name])
      try {
        const a = await api<{ pad: string; token: string; bucket: string }>('/api/portal/aanvragen/upload', { method: 'POST', body: JSON.stringify({ soort, mimetype: f.type, grootte: f.size }) })
        const { error } = await createClient().storage.from(a.bucket).uploadToSignedUrl(a.pad, a.token, f, { contentType: f.type })
        if (error) throw new Error(error.message)
        setBestanden((b) => [...b, { pad: a.pad, bestandsnaam: f.name, mimetype: f.type, grootte: f.size }])
      } catch (e) { toast.error(`${f.name}: ${e instanceof Error ? e.message : 'opladen mislukt'}`) } finally { setUploaden((u) => u.filter((x) => x !== f.name)) }
    }
  }

  async function verstuur() {
    const p = probleem(4)
    if (p) { setFout(p); return }
    setBezig(true); setFout(null)
    try {
      await api('/api/portal/aanvragen', {
        method: 'POST',
        body: JSON.stringify({
          aanvraag_sleutel: sleutel, soort, type, wat, briefing, aandachtspunten, antwoorden, periode_van: periodeVan || null, periode_tot: periodeTot || null,
          voorkeursdagen: dagen, tijdstippen: tijden, locatie: locatieRegel === 'geen' ? null : locatie, deadline: deadline || null, expert_id: expert || null, bestanden,
        }),
      })
      setKlaar(true); onVerstuurd()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Versturen mislukt') } finally { setBezig(false) }
  }
  const opnieuw = () => {
    setStap(0); setType(null); setWat(''); setBriefing(''); setAandachtspunten(''); setAntwoorden({}); setPeriodeVan(''); setPeriodeTot(''); setDagen([]); setTijden([])
    setLocatie(''); setDeadline(''); setExpert(''); setBestanden([]); setSleutel(nieuweSleutel()); setKlaar(false); setFout(null)
  }

  if (klaar) {
    return (
      <section className="card-base space-y-4">
        <p className="flex items-center gap-2 text-base font-semibold"><CircleCheck className="h-5 w-5 text-green-600" />Aanvraag ontvangen</p>
        <p className="text-sm text-gray-700">Bedankt. Je aanvraag voor <b>{t?.label}</b> staat bij ons. Dit is nog geen boeking of bevestigde opdracht.</p>
        <ol className="text-sm text-gray-700 space-y-2">
          <li className="flex gap-2"><span className="h-5 w-5 rounded-full bg-gray-900 text-white text-[11px] flex items-center justify-center shrink-0">1</span>We bekijken je aanvraag en wie ze best opvolgt.</li>
          <li className="flex gap-2"><span className="h-5 w-5 rounded-full bg-gray-900 text-white text-[11px] flex items-center justify-center shrink-0">2</span>{soort === 'consultancy' ? `We bepalen de duur (${CONSULTANCY_TARIEF}) en sturen indien nodig eerst een offerte.` : 'Valt het binnen je contract, dan plannen we het in. Zo niet, dan krijg je eerst een offerte.'}</li>
          <li className="flex gap-2"><span className="h-5 w-5 rounded-full bg-gray-900 text-white text-[11px] flex items-center justify-center shrink-0">3</span>De status en een eventuele offerte volg je hier bij “Mijn aanvragen”.</li>
        </ol>
        <button type="button" onClick={opnieuw} className={`btn-secondary ${knop}`}>Nog een aanvraag</button>
      </section>
    )
  }

  return (
    <section className="card-base space-y-5" aria-labelledby="nieuwe-aanvraag">
      <div ref={top} className="scroll-mt-24">
        <h2 id="nieuwe-aanvraag" className="text-base font-semibold">Nieuwe aanvraag</h2>
        <ol className="mt-3 flex items-center gap-1.5 text-[11px]" aria-label="Stappen">
          {STAPPEN.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5 min-w-0">
              <span className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 font-semibold ${i < stap ? 'bg-gray-900 text-white' : i === stap ? 'bg-gray-900 text-white ring-2 ring-gray-900/20' : 'bg-gray-100 text-gray-500'}`}>{i < stap ? <Check className="h-3 w-3" /> : i + 1}</span>
              <span className={`hidden sm:inline truncate ${i === stap ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>{s}</span>
              {i < STAPPEN.length - 1 && <span className="w-3 sm:w-5 h-px bg-gray-200 shrink-0" />}
            </li>
          ))}
        </ol>
      </div>

      {stap === 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">{soort === 'dienst' ? 'Waarmee kunnen we je helpen?' : 'Waarover wil je advies, een workshop of een scan?'}</p>
          <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label={soort === 'dienst' ? 'Dienst' : 'Consultancy'}>
            {catalogus(soort).map((x) => (
              <button key={x.key} type="button" role="radio" aria-checked={type === x.key} onClick={() => { setType(x.key); setAntwoorden({}); setFout(null) }}
                className={`text-left rounded-xl border px-3 py-2.5 transition ${type === x.key ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200 hover:border-gray-400'} ${knop}`}>
                <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{x.label}</span>{type === x.key && <Check className="h-4 w-4 shrink-0" />}</span>
                <span className="block text-xs text-gray-600 mt-0.5">{x.uitleg}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {stap === 1 && t && (
        <div className="space-y-3">
          <p className="text-sm"><b>{t.label}</b></p>
          {velden.filter((v) => v.key === 'onderwerp').map((v) => <VeldInvoer key={v.key} v={v} waarde={antwoorden[v.key]} zet={(w) => setAntwoorden({ ...antwoorden, [v.key]: w })} />)}
          <div><label className={LBL} htmlFor="av-wat">{t.watLabel} *</label><textarea id="av-wat" rows={4} className={INP} value={wat} maxLength={3000} onChange={(e) => setWat(e.target.value)} placeholder={t.watPlaceholder} /></div>
          {velden.filter((v) => v.key !== 'onderwerp' && v.key !== 'vorm').map((v) => <VeldInvoer key={v.key} v={v} waarde={antwoorden[v.key]} zet={(w) => setAntwoorden({ ...antwoorden, [v.key]: w })} />)}
          <div><label className={LBL} htmlFor="av-brief">{soort === 'consultancy' ? 'Wat wil je na afloop weten of kunnen?' : 'Briefing'} <span className="font-normal text-gray-500">(optioneel)</span></label>
            <textarea id="av-brief" rows={3} className={INP} value={briefing} maxLength={5000} onChange={(e) => setBriefing(e.target.value)} placeholder={soort === 'consultancy' ? 'Bv. een concreet plan om meer leads uit onze website te halen.' : 'Doelgroep, stijl, voorbeelden die je mooi vindt, wat zeker niet mag…'} /></div>
          <div><label className={LBL} htmlFor="av-aandacht">Aandachtspunten <span className="font-normal text-gray-500">(optioneel)</span></label>
            <textarea id="av-aandacht" rows={2} className={INP} value={aandachtspunten} maxLength={3000} onChange={(e) => setAandachtspunten(e.target.value)} placeholder="Bv. toegang tot het pand pas vanaf 9 uur, of een product dat zeker in beeld moet." /></div>
        </div>
      )}

      {stap === 2 && t && (
        <div className="space-y-4">
          <p className="text-xs text-gray-600 flex gap-1.5"><Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />Kies de dag waarop je het graag zou hebben. Je reserveert geen tijdslot in onze agenda: wij bekijken het en laten je weten wanneer het lukt.</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={LBL} htmlFor="av-van">Gewenste datum *</label><input id="av-van" type="date" min={vandaag()} required className={INP} value={periodeVan} onChange={(e) => setPeriodeVan(e.target.value)} /></div>
            <div><label className={LBL} htmlFor="av-tot">Flexibel tot <span className="font-normal text-gray-500">(optioneel)</span></label><input id="av-tot" type="date" min={periodeVan || vandaag()} className={INP} value={periodeTot} onChange={(e) => setPeriodeTot(e.target.value)} /></div>
          </div>
          <Chips label="Voorkeursdagen" opties={DAGEN.map((d) => ({ key: d.key, label: d.label }))} gekozen={dagen} zet={setDagen} />
          <Chips label="Voorkeur tijdstip" opties={TIJDSTIPPEN.map((d) => ({ key: d.key, label: d.label }))} gekozen={tijden} zet={setTijden} />
          <div><label className={LBL} htmlFor="av-deadline">Gewenste deadline <span className="font-normal text-gray-500">(optioneel)</span></label><input id="av-deadline" type="date" min={vandaag()} className={`${INP} sm:max-w-[14rem]`} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
          {soort === 'consultancy' && velden.filter((v) => v.key === 'vorm').map((v) => <VeldInvoer key={v.key} v={v} waarde={antwoorden[v.key]} zet={(w) => setAntwoorden({ ...antwoorden, [v.key]: w })} />)}
          {locatieRegel !== 'geen' && (
            <div><label className={LBL} htmlFor="av-locatie">{soort === 'consultancy' ? 'Adres' : 'Locatie'} {locatieRegel === 'verplicht' ? '*' : <span className="font-normal text-gray-500">(indien relevant)</span>}</label>
              <input id="av-locatie" className={INP} value={locatie} maxLength={300} onChange={(e) => setLocatie(e.target.value)} placeholder="Straat en nummer, gemeente" /></div>
          )}
        </div>
      )}

      {stap === 3 && t && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold">Kies jouw expert</p>
            <p className="text-xs text-gray-600">Een voorkeur, geen garantie: wij bevestigen wie je aanvraag opvolgt. Onder elke naam staat waarvoor je bij die persoon terechtkunt.</p>
          </div>
          {experts === null ? <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label="Experts laden" /></div> : (
            <div className="space-y-3" role="radiogroup" aria-label="Expert">
              <GeenVoorkeur tekst="Geen voorkeur" sub="Wij kiezen de juiste expert voor je aanvraag" gekozen={expert === ''} onKies={() => setExpert('')} />
              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 gap-4">
                {experts.map((e) => <TeamFotoKaart key={e.id} gekozen={expert === e.id} onKies={() => setExpert(e.id)} naam={e.naam} sub={e.rollen.join(' · ')} foto={e.foto_url} tags={e.expertises} label={e.specialist ? 'Juiste persoon voor deze dienst' : null} />)}
              </div>
            </div>
          )}
          {experts?.length === 0 && <p className="text-xs text-gray-500">Voor deze aanvraag kiezen we zelf de juiste expert.</p>}
        </div>
      )}

      {stap === 4 && t && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold mb-1">Bestanden of referenties <span className="font-normal text-gray-500">(optioneel)</span></p>
            <label className={`flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-300 px-3 py-5 text-sm text-gray-600 cursor-pointer hover:border-gray-500 ${knop}`}>
              <Upload className="h-5 w-5" /><span>Klik om bestanden te kiezen</span><span className="text-[11px] text-gray-500">PDF, Word, Excel, PowerPoint, foto’s of video · max. 100 MB · max. {MAX_BESTANDEN}</span>
              <input type="file" multiple className="sr-only" onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
            </label>
            {(bestanden.length > 0 || uploaden.length > 0) && (
              <ul className="mt-2 space-y-1">
                {bestanden.map((b) => (
                  <li key={b.pad} className="flex items-center gap-2 text-sm rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5">
                    <Paperclip className="h-3.5 w-3.5 shrink-0" /><span className="truncate flex-1">{b.bestandsnaam}</span><span className="text-[11px] text-gray-500">{grootte(b.grootte)}</span>
                    <button type="button" onClick={() => setBestanden(bestanden.filter((x) => x.pad !== b.pad))} aria-label={`${b.bestandsnaam} weghalen`} className={`h-6 w-6 rounded hover:bg-gray-200 flex items-center justify-center ${knop}`}><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
                {uploaden.map((n) => <li key={n} className="flex items-center gap-2 text-sm text-gray-500 px-2.5 py-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />{n}</li>)}
              </ul>
            )}
          </div>
          <Samenvatting soort={soort} t={t} wat={wat} briefing={briefing} aandachtspunten={aandachtspunten} antwoorden={antwoorden}
            timing={timingTekst({ periode_van: periodeVan || null, periode_tot: periodeTot || null, voorkeursdagen: dagen, tijdstippen: tijden, deadline: deadline || null })}
            locatie={locatieRegel === 'geen' ? null : locatie.trim() || null} expert={expert ? experts?.find((e) => e.id === expert)?.naam ?? null : null} bestanden={bestanden.length} />
          <p className="text-xs text-gray-600 flex gap-1.5"><Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {soort === 'consultancy' ? `Consultancy kost ${CONSULTANCY_TARIEF}. Wij bepalen de benodigde duur en sturen indien nodig eerst een offerte. Je boekt hier geen afspraak.` : 'Een aanvraag is geen boeking of bevestigde opdracht. Wij bekijken ze en laten je weten wat de volgende stap is.'}</p>
        </div>
      )}

      {fout && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{fout}</p>}

      <div className="flex gap-2 flex-wrap">
        {stap > 0 && <button type="button" onClick={terug} className={`btn-secondary ${knop}`}><ArrowLeft className="h-4 w-4" />Terug</button>}
        {stap < 4
          ? <button type="button" onClick={verder} className={`btn-primary ${knop}`}>{stap === 3 ? 'Nakijken' : 'Verder'}<ArrowRight className="h-4 w-4" /></button>
          : <button type="button" onClick={verstuur} disabled={bezig || uploaden.length > 0} className={`btn-primary ${knop}`}>{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Aanvraag versturen</button>}
      </div>
    </section>
  )
}

function VeldInvoer({ v, waarde, zet }: { v: Veld; waarde: string | string[] | undefined; zet: (w: string | string[]) => void }) {
  const id = `av-${v.key}`
  const label = <>{v.label}{v.verplicht ? ' *' : <span className="font-normal text-gray-500"> (optioneel)</span>}</>
  if (v.type === 'meerkeuze') return <Chips label={label} opties={(v.opties ?? []).map((o) => ({ key: o, label: o }))} gekozen={Array.isArray(waarde) ? waarde : []} zet={zet} />
  if (v.type === 'keuze') return (
    <div><label className={LBL} htmlFor={id}>{label}</label>
      <select id={id} className={INP} value={typeof waarde === 'string' ? waarde : ''} onChange={(e) => zet(e.target.value)}>
        <option value="">Kies…</option>{(v.opties ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select></div>
  )
  return (
    <div><label className={LBL} htmlFor={id}>{label}</label>
      {v.type === 'lang'
        ? <textarea id={id} rows={3} className={INP} value={typeof waarde === 'string' ? waarde : ''} onChange={(e) => zet(e.target.value)} placeholder={v.placeholder} />
        : <input id={id} type={v.type === 'url' ? 'url' : 'text'} inputMode={v.type === 'url' ? 'url' : undefined} className={INP} value={typeof waarde === 'string' ? waarde : ''} onChange={(e) => zet(e.target.value)} placeholder={v.placeholder} />}
    </div>
  )
}

function Chips({ label, opties, gekozen, zet }: { label: React.ReactNode; opties: { key: string; label: string }[]; gekozen: string[]; zet: (w: string[]) => void }) {
  return (
    <fieldset>
      <legend className={LBL}>{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {opties.map((o) => {
          const aan = gekozen.includes(o.key)
          return <button key={o.key} type="button" aria-pressed={aan} onClick={() => zet(aan ? gekozen.filter((x) => x !== o.key) : [...gekozen, o.key])}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${aan ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'} ${knop}`}>{o.label}</button>
        })}
      </div>
    </fieldset>
  )
}

function Samenvatting({ soort, t, wat, briefing, aandachtspunten, antwoorden, timing, locatie, expert, bestanden }: {
  soort: AanvraagSoort; t: AanvraagType; wat: string; briefing: string; aandachtspunten: string; antwoorden: Record<string, unknown>
  timing: string[]; locatie: string | null; expert: string | null; bestanden: number
}) {
  const regels = antwoordRegels(soort, t.key, antwoorden)
  const rij = (l: string, w: React.ReactNode) => <div className="py-2 grid grid-cols-[120px_1fr] gap-2"><dt className="text-gray-500">{l}</dt><dd className="break-words whitespace-pre-wrap">{w}</dd></div>
  return (
    <div>
      <p className="text-sm font-semibold mb-1">Nakijken</p>
      <dl className="divide-y divide-gray-100 text-sm border-y border-gray-100">
        {rij(soort === 'dienst' ? 'Dienst' : 'Consultancy', <b>{t.label}</b>)}
        {rij(t.watLabel.replace(/\?$/, ''), wat.trim())}
        {regels.map((r) => <div key={r.label}>{rij(r.label, r.waarde)}</div>)}
        {briefing.trim() && rij(soort === 'consultancy' ? 'Doel' : 'Briefing', briefing.trim())}
        {aandachtspunten.trim() && rij('Aandachtspunten', aandachtspunten.trim())}
        {rij('Timing', timing.length ? timing.map((x) => <div key={x}>{x}</div>) : <span className="text-gray-500">Geen voorkeur opgegeven</span>)}
        {locatie && rij('Locatie', locatie)}
        {rij('Expert', expert ? `${expert} (voorkeur)` : 'Geen voorkeur')}
        {rij('Bestanden', bestanden ? `${bestanden} bestand${bestanden === 1 ? '' : 'en'}` : 'Geen')}
        {soort === 'consultancy' && rij('Tarief', CONSULTANCY_TARIEF)}
      </dl>
    </div>
  )
}

// ── Mijn aanvragen ───────────────────────────────────────────────────────────

function AanvraagKaart({ a, onVeranderd }: { a: Aanvraag; onVeranderd: () => void }) {
  const [open, setOpen] = useState(a.offerte?.status === 'open')
  const [bezig, setBezig] = useState(false)
  const [weiger, setWeiger] = useState(false)
  const [reden, setReden] = useState('')
  const chip = STATUS[a.status as keyof typeof STATUS]?.chip ?? 'bg-gray-100 text-gray-700 border-gray-200'
  const regels = useMemo(() => antwoordRegels(a.soort, a.type, a.antwoorden), [a])
  const timing = timingTekst(a)

  async function actie(body: Record<string, unknown>, ok: string) {
    setBezig(true)
    try { await api(`/api/portal/aanvragen/${a.id}`, { method: 'PATCH', body: JSON.stringify({ soort: a.soort, ...body }) }); toast.success(ok); setWeiger(false); onVeranderd() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="card-base !p-0 overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={`w-full text-left p-3.5 flex items-start gap-3 ${knop}`}>
        {a.soort === 'consultancy' ? <Sparkles className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> : <FileText className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{a.type_label}</span>
          <span className="block text-xs text-gray-600 truncate">{a.wat}</span>
          <span className="block text-[11px] text-gray-500 mt-0.5">Aangevraagd op {datumKort(a.created_at)}{a.ingediend_door ? ` door ${a.ingediend_door}` : ''}</span>
        </span>
        <span className="flex flex-col items-end gap-1 shrink-0">
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${chip}`}>{a.status_label}</span>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 space-y-3 border-t border-gray-100 pt-3 text-sm">
          {a.offerte && (
            <div className={`rounded-lg border p-3 space-y-2 ${a.offerte.status === 'open' ? 'border-violet-200 bg-violet-50' : 'border-gray-200 bg-gray-50'}`}>
              <p className="font-semibold flex items-center gap-1.5"><FileText className="h-4 w-4" />{a.offerte.titel ?? 'Offerte'}</p>
              {a.offerte.notitie && <p className="text-gray-700 whitespace-pre-wrap">{a.offerte.notitie}</p>}
              <a href={`/api/portal/aanvragen/${a.id}/bestand?soort=${a.soort}&offerte=1`} target="_blank" rel="noreferrer" className={`btn-secondary !py-1.5 text-xs w-fit ${knop}`}><ExternalLink className="h-3.5 w-3.5" />Offerte openen</a>
              {a.offerte.status === 'open' && !weiger && (
                <div className="flex gap-2 flex-wrap">
                  <button type="button" disabled={bezig} onClick={() => actie({ actie: 'offerte', besluit: 'aanvaard' }, 'Offerte aanvaard. We plannen dit in en houden je op de hoogte.')} className={`btn-primary !py-1.5 text-xs ${knop}`}>{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Offerte aanvaarden</button>
                  <button type="button" disabled={bezig} onClick={() => setWeiger(true)} className={`btn-secondary !py-1.5 text-xs ${knop}`}>Weigeren</button>
                </div>
              )}
              {weiger && (
                <div className="space-y-2">
                  <textarea rows={2} className={INP} value={reden} onChange={(e) => setReden(e.target.value)} placeholder="Waarom niet? (optioneel, helpt ons een beter voorstel te doen)" aria-label="Reden" />
                  <div className="flex gap-2">
                    <button type="button" disabled={bezig} onClick={() => actie({ actie: 'offerte', besluit: 'geweigerd', reden }, 'Offerte geweigerd. We nemen contact met je op.')} className={`btn-danger !py-1.5 text-xs ${knop}`}>Offerte weigeren</button>
                    <button type="button" onClick={() => setWeiger(false)} className={`btn-secondary !py-1.5 text-xs ${knop}`}>Toch niet</button>
                  </div>
                </div>
              )}
              {a.offerte.status !== 'open' && <p className="text-xs text-gray-600">{a.offerte.status === 'aanvaard' ? 'Je aanvaardde deze offerte' : 'Je weigerde deze offerte'}{a.offerte.beslist_op ? ` op ${datumKort(a.offerte.beslist_op)}` : ''}.</p>}
            </div>
          )}
          {a.status === 'afgewezen' && a.reden_klant && <p className="rounded-lg border border-red-100 bg-red-50 p-2.5 text-red-800">{a.reden_klant}</p>}
          <div className="whitespace-pre-wrap break-words">{a.wat}</div>
          {regels.length > 0 && <dl className="text-xs space-y-0.5">{regels.map((r) => <div key={r.label} className="flex gap-1"><dt className="text-gray-500">{r.label}:</dt><dd>{r.waarde}</dd></div>)}</dl>}
          {a.briefing && <div><p className="text-xs text-gray-500">{a.soort === 'consultancy' ? 'Doel' : 'Briefing'}</p><p className="whitespace-pre-wrap break-words">{a.briefing}</p></div>}
          {a.aandachtspunten && <div><p className="text-xs text-gray-500">Aandachtspunten</p><p className="whitespace-pre-wrap break-words">{a.aandachtspunten}</p></div>}
          {(timing.length > 0 || a.locatie) && (
            <div className="text-xs text-gray-700 space-y-0.5">
              {timing.map((x) => <p key={x} className="flex gap-1.5"><CalendarDays className="h-3.5 w-3.5 shrink-0" />{x}</p>)}
              {a.locatie && <p className="flex gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0" />{a.locatie}</p>}
            </div>
          )}
          <p className="text-xs text-gray-700 flex gap-1.5"><UserRound className="h-3.5 w-3.5 shrink-0" />Expertvoorkeur: {a.expert_naam ?? 'geen voorkeur'}</p>
          {a.bestanden.length > 0 && (
            <ul className="space-y-1">{a.bestanden.map((b) => (
              <li key={b.id}><a href={`/api/portal/aanvragen/${a.id}/bestand?soort=${a.soort}&bestand=${b.id}`} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2 inline-flex items-center gap-1"><Paperclip className="h-3 w-3" />{b.bestandsnaam}</a></li>
            ))}</ul>
          )}
          {a.mag_intrekken && (
            <button type="button" disabled={bezig} onClick={() => { if (window.confirm('Deze aanvraag intrekken?')) actie({ actie: 'intrekken' }, 'Aanvraag ingetrokken.') }} className={`text-xs underline text-gray-600 hover:text-black ${knop}`}>Aanvraag intrekken</button>
          )}
        </div>
      )}
    </div>
  )
}
