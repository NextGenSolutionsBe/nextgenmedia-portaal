'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Search, Loader2, Clock, CalendarClock, AlertCircle, Timer } from 'lucide-react'
import { Dialoog } from '@/app/admin/instellingen/ui'
import { api, Avatar, Chip, euro, uren, datumNl, kortUur, INP, LBL } from '@/components/personeel/ui'
import { MEDEWERKER_TYPES, typeLabel, typeKleur, ACCOUNT_LABEL, type AccountStatus } from '@/lib/personeel/model'

type Mw = {
  id: string; voornaam: string; achternaam: string | null; email: string | null; type: string; functie: string | null; actief: boolean; foto_url: string | null
  account_status: AccountStatus; uren: number; goedgekeurd: number; gepland: number; kost: number | null; kostVerwacht: number | null
  volgende: { datum: string; start_tijd: string; eind_tijd: string; taak: string | null; project: string | null } | null
  openUren: number; openBeschikbaar: number; actiefIngeklokt: boolean
}
type Antwoord = { medewerkers: Mw[]; van: string; tot: string; magFinancieel: boolean }

const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())
const maandBereik = (ym: string) => { const [j, m] = ym.split('-').map(Number); return { van: `${ym}-01`, tot: `${ym}-${String(new Date(Date.UTC(j, m, 0)).getUTCDate()).padStart(2, '0')}` } }

/** Personeelsoverzicht: per medewerker een kaart (dossier), met zoeken, filteren en sorteren. */
export function OverzichtTab() {
  const router = useRouter()
  const [data, setData] = useState<Antwoord | null>(null)
  const [periode, setPeriode] = useState(() => maandBereik(vandaag().slice(0, 7)))
  const [zoek, setZoek] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState<'actief' | 'inactief' | ''>('actief')
  const [functie, setFunctie] = useState('')
  const [sorteer, setSorteer] = useState<'naam' | 'uren' | 'kost' | 'volgende'>('naam')
  const [nieuw, setNieuw] = useState(false)

  const laad = useCallback(async () => {
    try { setData(await api<Antwoord>(`/api/admin/personeel?van=${periode.van}&tot=${periode.tot}`)) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [periode.van, periode.tot])
  useEffect(() => { laad() }, [laad])

  const functies = useMemo(() => [...new Set((data?.medewerkers ?? []).map((m) => m.functie).filter(Boolean) as string[])].sort(), [data])
  const lijst = useMemo(() => {
    const q = zoek.trim().toLowerCase()
    const uit = (data?.medewerkers ?? []).filter((m) => {
      if (q && !`${m.voornaam} ${m.achternaam ?? ''} ${m.email ?? ''} ${m.functie ?? ''}`.toLowerCase().includes(q)) return false
      if (type && m.type !== type) return false
      if (status === 'actief' && !m.actief) return false
      if (status === 'inactief' && m.actief) return false
      if (functie && m.functie !== functie) return false
      return true
    })
    const naam = (m: Mw) => `${m.voornaam} ${m.achternaam ?? ''}`
    uit.sort((a, b) => {
      if (sorteer === 'uren') return b.uren - a.uren || naam(a).localeCompare(naam(b), 'nl')
      if (sorteer === 'kost') return (b.kost ?? 0) - (a.kost ?? 0) || naam(a).localeCompare(naam(b), 'nl')
      if (sorteer === 'volgende') return (a.volgende ? `${a.volgende.datum}${a.volgende.start_tijd}` : '9').localeCompare(b.volgende ? `${b.volgende.datum}${b.volgende.start_tijd}` : '9')
      return naam(a).localeCompare(naam(b), 'nl')
    })
    return uit
  }, [data, zoek, type, status, functie, sorteer])

  const sel = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm'
  return (
    <div className="space-y-4">
      <div className="card-base p-3 flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[200px]"><Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" /><input className={`${INP} pl-8`} placeholder="Zoek op naam, e-mail of functie…" value={zoek} onChange={(e) => setZoek(e.target.value)} /></div>
        <select className={sel} value={type} onChange={(e) => setType(e.target.value)}><option value="">Alle types</option>{MEDEWERKER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        <select className={sel} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="actief">Actief</option><option value="inactief">Inactief</option><option value="">Actief en inactief</option></select>
        <select className={sel} value={functie} onChange={(e) => setFunctie(e.target.value)}><option value="">Alle functies</option>{functies.map((f) => <option key={f} value={f}>{f}</option>)}</select>
        <select className={sel} value={sorteer} onChange={(e) => setSorteer(e.target.value as typeof sorteer)}><option value="naam">Sorteer: naam</option><option value="uren">Sorteer: gewerkte uren</option>{data?.magFinancieel && <option value="kost">Sorteer: personeelskost</option>}<option value="volgende">Sorteer: eerstvolgend werkmoment</option></select>
        <label className="text-xs text-gray-500">Periode<input type="month" className={`${sel} block`} value={periode.van.slice(0, 7)} onChange={(e) => e.target.value && setPeriode(maandBereik(e.target.value))} /></label>
        <button type="button" onClick={() => setNieuw(true)} className="btn-primary text-sm"><Plus className="h-4 w-4" />Medewerker toevoegen</button>
      </div>

      {!data ? <div className="py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : lijst.length === 0 ? (
        <div className="card-base text-center py-12 text-sm text-gray-400">Geen medewerkers voor deze filters.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lijst.map((m) => {
            const naam = [m.voornaam, m.achternaam].filter(Boolean).join(' ')
            return (
              <Link key={m.id} href={`/admin/personeel/${m.id}`} prefetch={false} className={`card-base p-4 space-y-3 hover:shadow-md transition-shadow ${m.actief ? '' : 'opacity-60'}`}>
                <div className="flex items-start gap-3">
                  <Avatar naam={naam} url={m.foto_url} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{naam}</div>
                    <div className="text-xs text-gray-500 truncate">{m.functie ?? 'Geen functie'}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <Chip cls={`${typeKleur(m.type)} border-transparent`} klein>{typeLabel(m.type)}</Chip>
                      <Chip cls={m.actief ? 'bg-green-50 text-green-800 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'} klein>{m.actief ? 'Actief' : 'Inactief'}</Chip>
                      <Chip cls="bg-white text-gray-500 border-gray-200" klein>{ACCOUNT_LABEL[m.account_status] ?? m.account_status}</Chip>
                      {m.actiefIngeklokt && <Chip cls="bg-sky-100 text-sky-800 border-sky-200" klein><Timer className="h-3 w-3" />Ingeklokt</Chip>}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 p-2"><div className="text-[10px] text-gray-500">Gewerkt</div><div className="text-sm font-semibold">{uren(m.uren)}</div></div>
                  <div className="rounded-lg bg-gray-50 p-2"><div className="text-[10px] text-gray-500">Goedgekeurd</div><div className="text-sm font-semibold text-green-700">{uren(m.goedgekeurd)}</div></div>
                  <div className="rounded-lg bg-gray-50 p-2"><div className="text-[10px] text-gray-500">Gepland</div><div className="text-sm font-semibold text-blue-700">{uren(m.gepland)}</div></div>
                </div>
                {data.magFinancieel && <div className="text-xs text-gray-600 flex justify-between"><span>Personeelskost (goedgekeurd)</span><b>{euro(m.kost)}</b></div>}
                <div className="text-xs text-gray-600 flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5 text-gray-400" />{m.volgende ? <>Volgende: {datumNl(m.volgende.datum)} {kortUur(m.volgende.start_tijd)}–{kortUur(m.volgende.eind_tijd)}{m.volgende.taak ? ` · ${m.volgende.taak}` : ''}</> : 'Geen werkmoment gepland'}</div>
                {(m.openUren > 0 || m.openBeschikbaar > 0) && (
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {m.openUren > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5"><Clock className="h-3 w-3" />{m.openUren} urenregistratie{m.openUren === 1 ? '' : 's'} te controleren</span>}
                    {m.openBeschikbaar > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5"><AlertCircle className="h-3 w-3" />{m.openBeschikbaar} beschikbaarhe{m.openBeschikbaar === 1 ? 'id' : 'den'}</span>}
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}
      {nieuw && <NieuweMedewerker onSluit={() => setNieuw(false)} onKlaar={(id) => { setNieuw(false); router.push(`/admin/personeel/${id}`) }} />}
    </div>
  )
}

function NieuweMedewerker({ onSluit, onKlaar }: { onSluit: () => void; onKlaar: (id: string) => void }) {
  const [f, setF] = useState({ voornaam: '', achternaam: '', email: '', telefoon: '', type: 'student', functie: '', startdatum: '' })
  const [bezig, setBezig] = useState(false)
  const bewaar = async () => {
    setBezig(true)
    try { const r = await api<{ id: string }>('/api/admin/personeel', { body: f }); toast.success('Medewerker toegevoegd.'); onKlaar(r.id) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel="Medewerker toevoegen" onSluit={onSluit}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={LBL}>Voornaam *</label><input className={INP} value={f.voornaam} onChange={(e) => setF({ ...f, voornaam: e.target.value })} /></div>
        <div><label className={LBL}>Achternaam</label><input className={INP} value={f.achternaam} onChange={(e) => setF({ ...f, achternaam: e.target.value })} /></div>
        <div className="col-span-2"><label className={LBL}>E-mailadres</label><input type="email" className={INP} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nodig voor een login" /></div>
        <div><label className={LBL}>Type</label><select className={INP} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{MEDEWERKER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
        <div><label className={LBL}>Functie</label><input className={INP} value={f.functie} onChange={(e) => setF({ ...f, functie: e.target.value })} /></div>
        <div><label className={LBL}>Telefoon</label><input className={INP} value={f.telefoon} onChange={(e) => setF({ ...f, telefoon: e.target.value })} /></div>
        <div><label className={LBL}>Startdatum</label><input type="date" className={INP} value={f.startdatum} onChange={(e) => setF({ ...f, startdatum: e.target.value })} /></div>
      </div>
      <p className="text-xs text-gray-500 mt-3">Overige gegevens, documenten, tarieven en de login vul je daarna in het dossier in.</p>
      <div className="flex justify-end gap-2 pt-4"><button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button><button type="button" disabled={bezig || !f.voornaam.trim()} onClick={bewaar} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Toevoegen</button></div>
    </Dialoog>
  )
}
