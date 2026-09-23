'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronLeft, Loader2, Save, Upload, Trash2, RefreshCw, FileText, Lock, KeyRound, Mail, Ban, CheckCircle2, Plus, X, Camera, ShieldAlert } from 'lucide-react'
import { api, Avatar, Chip, datumNl, euro, INP, LBL } from '@/components/personeel/ui'
import { MEDEWERKER_TYPES, DOCUMENT_MAPPEN, ACCOUNT_LABEL, typeLabel, typeKleur, mapLabel, type AccountStatus } from '@/lib/personeel/model'
import { KOST_SOORTEN, LIJN_SUGGESTIES, type KostLijn, type KostSoort, type Tarief } from '@/lib/personeel/kost'
import { UrenTab } from '../uren-tab'
import { PlanningTab } from '../planning-tab'
import { KostenTab } from '../kosten-tab'

type Medewerker = Record<string, unknown> & {
  id: string; voornaam: string; achternaam: string | null; email: string | null; telefoon: string | null; type: string; functie: string | null; afdeling: string | null
  contracttype: string | null; startdatum: string | null; einddatum: string | null; actief: boolean; verantwoordelijke: string | null; standaard_werkdagen: number[]
  max_uren_dag: number | null; max_uren_week: number | null; max_uren_maand: number | null; interne_notities: string | null; foto_url: string | null
  auth_user_id: string | null; account_status: AccountStatus; uitnodiging_verzonden_at: string | null
}
type Doc = { id: string; map: string; naam: string; url: string | null; grootte: number | null; vervalt_op: string | null; verplicht: boolean; toegevoegd_door: string | null; gewijzigd_door: string | null; created_at: string; updated_at: string }
type TariefMet = Tarief & { opbouw: { basis: number; lasten: number; totaal: number }; per: { uur: number; dag: number; week: number; maand: number }; opmerking?: string | null }
type Log = { id: number; entiteit: string; actie: string; oud: unknown; nieuw: unknown; reden: string | null; actor_email: string | null; created_at: string }
type Dossier = {
  medewerker: Medewerker; gevoelig: { adres: string | null; geboortedatum: string | null; noodcontact: string | null; rijksregisternummer: string | null; iban: string | null } | null
  documenten: Doc[]; verborgenDocumenten: number; tarieven: TariefMet[] | null; logboek: Log[]; magFinancieel: boolean; magGevoelig: boolean
  intern: { gekoppeld: Intern | null; kandidaat: Intern | null }
}
type Intern = { id: string; email: string | null; name: string | null; rol?: string | null; permissions?: string[]; active?: boolean | null }

const TABS = [['gegevens', 'Gegevens'], ['documenten', 'Documenten'], ['kosten', 'Kosten'], ['uren', 'Uren'], ['planning', 'Planning'], ['account', 'Account'], ['logboek', 'Logboek']] as const
type Tab = (typeof TABS)[number][0]
const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

export function DossierClient({ id }: { id: string }) {
  const zoek = useSearchParams()
  const router = useRouter()
  const [d, setD] = useState<Dossier | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const tab = (TABS.some(([k]) => k === zoek.get('tab')) ? zoek.get('tab') : 'gegevens') as Tab
  const laad = useCallback(async () => {
    try { setD(await api<Dossier>(`/api/admin/personeel/${id}`)); setFout(null) } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [id])
  useEffect(() => { laad() }, [laad])

  if (fout) return <div className="card-base text-sm text-red-700">{fout}</div>
  if (!d) return <div className="py-16 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
  const m = d.medewerker
  const naam = [m.voornaam, m.achternaam].filter(Boolean).join(' ')
  const tabs = TABS.filter(([k]) => k !== 'kosten' || d.magFinancieel)

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/admin/personeel" className="btn-secondary px-2" title="Terug"><ChevronLeft className="h-4 w-4" /></Link>
        <Foto id={id} naam={naam} url={m.foto_url} onKlaar={laad} />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{naam}</h1>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <Chip cls={`${typeKleur(m.type)} border-transparent`}>{typeLabel(m.type)}</Chip>
            <Chip cls={m.actief ? 'bg-green-50 text-green-800 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}>{m.actief ? 'Actief' : 'Inactief'}</Chip>
            <Chip cls="bg-white text-gray-600 border-gray-200">{ACCOUNT_LABEL[m.account_status]}</Chip>
            {m.functie && <span className="text-sm text-gray-500">{m.functie}</span>}
          </div>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map(([k, l]) => <button key={k} type="button" onClick={() => router.replace(`/admin/personeel/${id}?tab=${k}`, { scroll: false })} className={`px-3 py-2 rounded-lg text-sm font-medium border whitespace-nowrap ${tab === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{l}</button>)}
      </div>
      {tab === 'gegevens' && <Gegevens d={d} onKlaar={laad} />}
      {tab === 'documenten' && <Documenten id={id} d={d} onKlaar={laad} />}
      {tab === 'kosten' && d.magFinancieel && <><Tarieven id={id} tarieven={d.tarieven ?? []} type={m.type} onKlaar={laad} /><KostenTab personeelId={id} /></>}
      {tab === 'uren' && <UrenTab personeelId={id} />}
      {tab === 'planning' && <PlanningTab personeelId={id} />}
      {tab === 'account' && <Account id={id} m={m} intern={d.intern} onKlaar={laad} />}
      {tab === 'logboek' && <Logboek log={d.logboek} />}
    </div>
  )
}

function Foto({ id, naam, url, onKlaar }: { id: string; naam: string; url: string | null; onKlaar: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [bezig, setBezig] = useState(false)
  const kies = async (f: File | null) => {
    if (!f) return
    setBezig(true)
    try { const fd = new FormData(); fd.append('file', f); await api(`/api/admin/personeel/${id}/foto`, { form: fd }); toast.success('Profielfoto bijgewerkt.'); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Uploaden mislukt') } finally { setBezig(false) }
  }
  return (
    <button type="button" onClick={() => ref.current?.click()} className="relative group" title="Profielfoto wijzigen">
      <Avatar naam={naam} url={url} groot />
      <span className="absolute inset-0 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">{bezig ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}</span>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => kies(e.target.files?.[0] ?? null)} />
    </button>
  )
}

function Gegevens({ d, onKlaar }: { d: Dossier; onKlaar: () => void }) {
  const m = d.medewerker
  const [f, setF] = useState({
    voornaam: m.voornaam, achternaam: m.achternaam ?? '', email: m.email ?? '', telefoon: m.telefoon ?? '', type: m.type, functie: m.functie ?? '', afdeling: m.afdeling ?? '',
    contracttype: m.contracttype ?? '', startdatum: m.startdatum ?? '', einddatum: m.einddatum ?? '', actief: m.actief, verantwoordelijke: m.verantwoordelijke ?? '',
    standaard_werkdagen: m.standaard_werkdagen ?? [], max_uren_dag: m.max_uren_dag ?? '', max_uren_week: m.max_uren_week ?? '', max_uren_maand: m.max_uren_maand ?? '', interne_notities: m.interne_notities ?? '',
  })
  const [g, setG] = useState({ adres: d.gevoelig?.adres ?? '', geboortedatum: d.gevoelig?.geboortedatum ?? '', noodcontact: d.gevoelig?.noodcontact ?? '', rijksregisternummer: d.gevoelig?.rijksregisternummer ?? '', iban: d.gevoelig?.iban ?? '' })
  const [bezig, setBezig] = useState<string | null>(null)
  const bewaar = async () => {
    setBezig('w')
    try { await api(`/api/admin/personeel/${m.id}`, { method: 'PATCH', body: { ...f, ...(m.auth_user_id ? { email: undefined } : {}) } }); toast.success('Gegevens bewaard.'); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(null) }
  }
  const bewaarGevoelig = async () => {
    setBezig('g')
    try { await api(`/api/admin/personeel/${m.id}/gevoelig`, { method: 'PUT', body: g }); toast.success('Gevoelige gegevens bewaard (versleuteld).'); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(null) }
  }
  const veld = (k: keyof typeof f, label: string, type = 'text') => <div><label className={LBL}>{label}</label><input type={type} className={INP} value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={k === 'email' && !!m.auth_user_id} /></div>
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card-base p-4 space-y-3">
        <h2 className="text-sm font-semibold">Contact en werk</h2>
        <div className="grid grid-cols-2 gap-3">
          {veld('voornaam', 'Voornaam *')}{veld('achternaam', 'Achternaam')}
          {veld('email', m.auth_user_id ? 'E-mailadres (login — wijzigen via Account)' : 'E-mailadres', 'email')}{veld('telefoon', 'Telefoon')}
          <div><label className={LBL}>Type medewerker</label><select className={INP} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{MEDEWERKER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
          {veld('functie', 'Functie')}{veld('afdeling', 'Afdeling')}{veld('contracttype', 'Contracttype')}
          {veld('startdatum', 'Startdatum', 'date')}{veld('einddatum', 'Einddatum', 'date')}
          {veld('verantwoordelijke', 'Interne verantwoordelijke')}
          <div><label className={LBL}>Status</label><select className={INP} value={f.actief ? '1' : '0'} onChange={(e) => setF({ ...f, actief: e.target.value === '1' })}><option value="1">Actief</option><option value="0">Inactief</option></select></div>
        </div>
        <div><div className={LBL}>Standaardwerkdagen</div><div className="flex gap-1">{DAGEN.map((dg, i) => { const n = i + 1; const aan = f.standaard_werkdagen.includes(n); return <button key={dg} type="button" onClick={() => setF({ ...f, standaard_werkdagen: aan ? f.standaard_werkdagen.filter((x) => x !== n) : [...f.standaard_werkdagen, n].sort() })} className={`h-8 w-9 rounded-lg text-xs font-medium border ${aan ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-600'}`}>{dg}</button> })}</div></div>
        <div className="grid grid-cols-3 gap-3">{veld('max_uren_dag', 'Max. u/dag', 'number')}{veld('max_uren_week', 'Max. u/week', 'number')}{veld('max_uren_maand', 'Max. u/maand', 'number')}</div>
        <div><label className={LBL}>Interne notities (nooit zichtbaar voor de medewerker)</label><textarea rows={3} className={INP} value={f.interne_notities} onChange={(e) => setF({ ...f, interne_notities: e.target.value })} /></div>
        <button type="button" disabled={bezig === 'w'} onClick={bewaar} className="btn-primary">{bezig === 'w' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren</button>
      </div>
      <div className="card-base p-4 space-y-3 h-fit">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><Lock className="h-4 w-4" />Persoonlijke gegevens</h2>
        {!d.magGevoelig ? <p className="text-sm text-gray-500">Enkel zichtbaar voor bevoegde admins (instellingenrecht op Personeel).</p> : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={LBL}>Adres</label><textarea rows={2} className={INP} value={g.adres} onChange={(e) => setG({ ...g, adres: e.target.value })} /></div>
              <div><label className={LBL}>Geboortedatum</label><input type="date" className={INP} value={g.geboortedatum} onChange={(e) => setG({ ...g, geboortedatum: e.target.value })} /></div>
              <div><label className={LBL}>Rijksregisternummer</label><input className={INP} value={g.rijksregisternummer} onChange={(e) => setG({ ...g, rijksregisternummer: e.target.value })} placeholder="enkel indien nodig" /></div>
              <div className="col-span-2"><label className={LBL}>Bankrekeningnummer (IBAN)</label><input className={INP} value={g.iban} onChange={(e) => setG({ ...g, iban: e.target.value })} /></div>
              <div className="col-span-2"><label className={LBL}>Noodcontact</label><input className={INP} value={g.noodcontact} onChange={(e) => setG({ ...g, noodcontact: e.target.value })} placeholder="naam, relatie, telefoon" /></div>
            </div>
            <p className="text-[11px] text-gray-500">Rijksregisternummer en IBAN worden versleuteld bewaard. In het logboek staat enkel wélk veld wijzigde, nooit de waarde.</p>
            <button type="button" disabled={bezig === 'g'} onClick={bewaarGevoelig} className="btn-primary">{bezig === 'g' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren</button>
          </>
        )}
      </div>
    </div>
  )
}

function Documenten({ id, d, onKlaar }: { id: string; d: Dossier; onKlaar: () => void }) {
  const [map, setMap] = useState('overeenkomst')
  const [vervalt, setVervalt] = useState('')
  const [bezig, setBezig] = useState<string | null>(null)
  const upload = async (f: File | null, vervang?: string, mp?: string) => {
    if (!f) return
    setBezig(vervang ?? 'nieuw')
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('map', mp ?? map); if (vervalt) fd.append('vervalt_op', vervalt); if (vervang) fd.append('vervang', vervang)
      await api(`/api/admin/personeel/${id}/documenten`, { form: fd }); toast.success(vervang ? 'Document vervangen.' : 'Document toegevoegd.'); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Uploaden mislukt') } finally { setBezig(null) }
  }
  const verwijder = async (doc: Doc) => {
    if (!confirm(`"${doc.naam}" definitief verwijderen?`)) return
    try { await api(`/api/admin/personeel/${id}/documenten?doc=${doc.id}`, { method: 'DELETE' }); toast.success('Verwijderd.'); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const zetVervalt = async (doc: Doc, v: string) => {
    try { await api(`/api/admin/personeel/${id}/documenten`, { method: 'PATCH', body: { doc: doc.id, vervalt_op: v || null } }); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const zichtbareMappen = DOCUMENT_MAPPEN.filter((mp) => d.magGevoelig || !['identiteit', 'payroll'].includes(mp.key))
  const vandaag = new Date().toISOString().slice(0, 10)
  return (
    <div className="space-y-4">
      <div className="card-base p-3 flex flex-wrap items-end gap-2">
        <div><label className={LBL}>Map</label><select className={INP} value={map} onChange={(e) => setMap(e.target.value)}>{zichtbareMappen.map((mp) => <option key={mp.key} value={mp.key}>{mp.label}</option>)}</select></div>
        <div><label className={LBL}>Vervalt op (optioneel)</label><input type="date" className={INP} value={vervalt} onChange={(e) => setVervalt(e.target.value)} /></div>
        <label className="btn-primary cursor-pointer">{bezig === 'nieuw' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Document uploaden<input type="file" className="hidden" onChange={(e) => { upload(e.target.files?.[0] ?? null); e.target.value = '' }} /></label>
      </div>
      {d.verborgenDocumenten > 0 && <div className="text-xs text-gray-500 flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" />{d.verborgenDocumenten} document{d.verborgenDocumenten === 1 ? '' : 'en'} in gevoelige mappen (identiteit, payroll) — enkel zichtbaar voor bevoegde admins.</div>}
      <div className="grid md:grid-cols-2 gap-3">
        {zichtbareMappen.map((mp) => {
          const docs = d.documenten.filter((x) => x.map === mp.key)
          return (
            <div key={mp.key} className="card-base p-3">
              <div className="text-sm font-semibold mb-2 flex items-center justify-between">{mp.label}<span className="text-xs text-gray-400 font-normal">{docs.length}</span></div>
              {docs.length === 0 && <div className="text-xs text-gray-400">Leeg{mp.key === 'overeenkomst' ? ' — de overeenkomst ontbreekt nog.' : '.'}</div>}
              <ul className="space-y-2">
                {docs.map((doc) => (
                  <li key={doc.id} className="rounded-lg border border-gray-100 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <a href={doc.url ?? '#'} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline truncate inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5 shrink-0" />{doc.naam}</a>
                      <span className="flex gap-1 shrink-0">
                        <label className="h-7 w-7 rounded hover:bg-gray-100 flex items-center justify-center cursor-pointer text-gray-500" title="Vervangen">{bezig === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}<input type="file" className="hidden" onChange={(e) => { upload(e.target.files?.[0] ?? null, doc.id, doc.map); e.target.value = '' }} /></label>
                        <button type="button" onClick={() => verwijder(doc)} className="h-7 w-7 rounded hover:bg-red-50 flex items-center justify-center text-gray-400 hover:text-red-600" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                      </span>
                    </div>
                    <div className="text-gray-500 mt-1 flex flex-wrap items-center gap-x-2">
                      <span>Toegevoegd door {doc.toegevoegd_door ?? '—'} op {datumNl(doc.created_at.slice(0, 10))}</span>
                      {doc.gewijzigd_door && doc.updated_at !== doc.created_at && <span>· aangepast door {doc.gewijzigd_door}</span>}
                      <label className="inline-flex items-center gap-1">· vervalt <input type="date" className={`border rounded px-1 py-0.5 ${doc.vervalt_op && doc.vervalt_op < vandaag ? 'border-red-300 text-red-700' : 'border-gray-200'}`} defaultValue={doc.vervalt_op ?? ''} onBlur={(e) => e.target.value !== (doc.vervalt_op ?? '') && zetVervalt(doc, e.target.value)} /></label>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-gray-500">Documenten staan in een afgeschermde opslag; links zijn telkens maar één uur geldig. {mapLabel('overeenkomst')} is verplicht: ontbreekt ze, dan verschijnt een melding.</p>
    </div>
  )
}

function Tarieven({ id, tarieven, type, onKlaar }: { id: string; tarieven: TariefMet[]; type: string; onKlaar: () => void }) {
  const laatste = tarieven[tarieven.length - 1]
  const [open, setOpen] = useState(false)
  const leeg = { geldig_vanaf: new Date().toISOString().slice(0, 10), basis_label: type === 'freelancer' || type === 'onderaannemer' ? 'Afgesproken uurprijs' : 'Brutouurloon', basis_uur: '', btw_pct: type === 'freelancer' || type === 'onderaannemer' ? '21' : '0', uren_per_dag: '8', uren_per_maand: '160', opmerking: '', lijnen: [] as KostLijn[] }
  const [f, setF] = useState(leeg)
  const [bezig, setBezig] = useState(false)
  const nieuwVanLaatste = () => {
    setF(laatste ? { ...leeg, basis_label: laatste.basis_label, basis_uur: String(laatste.basis_uur), btw_pct: String(laatste.btw_pct), uren_per_dag: String(laatste.uren_per_dag), uren_per_maand: String(laatste.uren_per_maand), lijnen: laatste.lijnen.filter((l) => l.soort !== 'eenmalig').map((l) => ({ ...l })) } : leeg)
    setOpen(true)
  }
  const bewaar = async () => {
    setBezig(true)
    try { await api(`/api/admin/personeel/${id}/tarieven`, { body: f }); toast.success('Nieuwe tariefversie bewaard; eerdere berekeningen blijven ongewijzigd.'); setOpen(false); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const verwijder = async (t: TariefMet) => {
    if (!confirm('Deze tariefversie verwijderen? Dat kan enkel zolang er nog geen goedgekeurde uren mee berekend zijn.')) return
    try { await api(`/api/admin/personeel/${id}/tarieven?tarief=${t.id}`, { method: 'DELETE' }); toast.success('Verwijderd.'); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const zetLijn = (i: number, k: keyof KostLijn, v: unknown) => setF((x) => ({ ...x, lijnen: x.lijnen.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }))
  return (
    <div className="card-base p-4 space-y-3 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h2 className="text-sm font-semibold">Kostprijs en tarieven</h2><p className="text-xs text-gray-500">Enkel voor admins met rechten op Financiën. De medewerker ziet hier nooit iets van. Een wijziging = een nieuwe versie met een startdatum; oude berekeningen veranderen niet.</p></div>
        <button type="button" onClick={nieuwVanLaatste} className="btn-primary text-sm"><Plus className="h-4 w-4" />{laatste ? 'Nieuwe tariefversie' : 'Tarief instellen'}</button>
      </div>
      {tarieven.length === 0 && !open && <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">Nog geen tarief. Goedgekeurde uren tellen voorlopig aan € 0 tot je hier een tarief invult.</div>}
      {[...tarieven].reverse().map((t, i) => (
        <div key={t.id} className={`rounded-xl border p-3 ${i === 0 ? 'border-gray-300' : 'border-gray-100 opacity-80'}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm font-semibold">Vanaf {datumNl(t.geldig_vanaf)}{t.geldig_tot ? ` t/m ${datumNl(t.geldig_tot)}` : ' · lopend'}</div>
            {i === 0 && <button type="button" onClick={() => verwijder(t)} className="text-xs text-gray-400 hover:text-red-600 inline-flex items-center gap-1"><Trash2 className="h-3 w-3" />Verwijderen</button>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2 text-center">
            {([['Per uur', t.per.uur], ['Per dag', t.per.dag], ['Per week', t.per.week], ['Per maand', t.per.maand]] as const).map(([l, v]) => <div key={l} className="rounded-lg bg-gray-50 p-2"><div className="text-[10px] text-gray-500">{l}</div><div className="text-sm font-semibold">{euro(v)}</div></div>)}
            <div className="rounded-lg bg-gray-50 p-2"><div className="text-[10px] text-gray-500">Basis + lasten /u</div><div className="text-xs font-medium">{euro(t.opbouw.basis)} + {euro(t.opbouw.lasten)}</div></div>
          </div>
          <div className="text-xs text-gray-600 mt-2">{t.basis_label}: {euro(t.basis_uur)}/u{t.btw_pct ? ` · btw ${t.btw_pct}% (apart)` : ''} · referentie {t.uren_per_dag} u/dag, {t.uren_per_maand} u/maand</div>
          {t.lijnen.length > 0 && <ul className="text-xs text-gray-600 mt-1 grid sm:grid-cols-2 gap-x-4">{t.lijnen.map((l) => <li key={l.id}>· {l.label}: {l.soort === 'pct' ? `${l.waarde}%` : euro(l.waarde)} {KOST_SOORTEN.find((k) => k.key === l.soort)?.eenheid.replace('€', '').replace('%', '')}{l.datum ? ` op ${datumNl(l.datum)}` : ''}</li>)}</ul>}
        </div>
      ))}
      {open && (
        <div className="rounded-xl border border-black p-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div><label className={LBL}>Geldig vanaf *</label><input type="date" className={INP} value={f.geldig_vanaf} onChange={(e) => setF({ ...f, geldig_vanaf: e.target.value })} /></div>
            <div><label className={LBL}>Omschrijving basis</label><input className={INP} value={f.basis_label} onChange={(e) => setF({ ...f, basis_label: e.target.value })} /></div>
            <div><label className={LBL}>Bedrag per uur (€, excl. btw)</label><input type="number" step="0.01" min={0} className={INP} value={f.basis_uur} onChange={(e) => setF({ ...f, basis_uur: e.target.value })} /></div>
            <div><label className={LBL}>Btw % (freelance/onderaanneming)</label><input type="number" step="0.01" min={0} className={INP} value={f.btw_pct} onChange={(e) => setF({ ...f, btw_pct: e.target.value })} /></div>
            <div><label className={LBL}>Referentie uren per dag</label><input type="number" step="0.5" min={1} className={INP} value={f.uren_per_dag} onChange={(e) => setF({ ...f, uren_per_dag: e.target.value })} /></div>
            <div><label className={LBL}>Referentie uren per maand</label><input type="number" step="1" min={1} className={INP} value={f.uren_per_maand} onChange={(e) => setF({ ...f, uren_per_maand: e.target.value })} /></div>
          </div>
          <div className="space-y-2">
            <div className={LBL}>Bijkomende kosten en lasten</div>
            {f.lijnen.map((l, i) => (
              <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
                <input className={`${INP} col-span-4`} value={l.label} onChange={(e) => zetLijn(i, 'label', e.target.value)} />
                <select className={`${INP} col-span-3`} value={l.soort} onChange={(e) => zetLijn(i, 'soort', e.target.value as KostSoort)}>{KOST_SOORTEN.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
                <input type="number" step="0.01" min={0} className={`${INP} col-span-2`} value={String(l.waarde)} onChange={(e) => zetLijn(i, 'waarde', e.target.value)} placeholder={l.soort === 'pct' ? '%' : '€'} />
                {l.soort === 'eenmalig' ? <input type="date" className={`${INP} col-span-2`} value={l.datum ?? ''} onChange={(e) => zetLijn(i, 'datum', e.target.value)} /> : <span className="col-span-2 text-[11px] text-gray-400">{KOST_SOORTEN.find((k) => k.key === l.soort)?.eenheid}</span>}
                <button type="button" onClick={() => setF((x) => ({ ...x, lijnen: x.lijnen.filter((_, j) => j !== i) }))} className="col-span-1 h-9 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 flex items-center justify-center"><X className="h-4 w-4" /></button>
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {LIJN_SUGGESTIES.map((s) => <button key={s.label} type="button" onClick={() => setF((x) => ({ ...x, lijnen: [...x.lijnen, { id: `l${Date.now()}${Math.random().toString(36).slice(2, 6)}`, label: s.label, soort: s.soort, waarde: 0, datum: s.soort === 'eenmalig' ? x.geldig_vanaf : null }] }))} className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] hover:bg-gray-50">+ {s.label}</button>)}
              <button type="button" onClick={() => setF((x) => ({ ...x, lijnen: [...x.lijnen, { id: `l${Date.now()}`, label: 'Eenmalige kost', soort: 'eenmalig', waarde: 0, datum: x.geldig_vanaf }] }))} className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] hover:bg-gray-50">+ Eenmalige kost</button>
            </div>
            <p className="text-[11px] text-gray-500">Er staan geen vaste percentages in: vul zelf in wat van toepassing is. % rekent op het bedrag per uur; €/dag telt per gewerkte dag; €/maand per maand met prestaties.</p>
          </div>
          <div><label className={LBL}>Opmerking</label><input className={INP} value={f.opmerking} onChange={(e) => setF({ ...f, opmerking: e.target.value })} /></div>
          <div className="flex gap-2"><button type="button" disabled={bezig} onClick={bewaar} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Tariefversie bewaren</button><button type="button" onClick={() => setOpen(false)} className="btn-secondary">Annuleren</button></div>
        </div>
      )}
    </div>
  )
}

function Account({ id, m, intern, onKlaar }: { id: string; m: Medewerker; intern: Dossier['intern']; onKlaar: () => void }) {
  const [email, setEmail] = useState(m.email ?? '')
  const [bezig, setBezig] = useState<string | null>(null)
  const doe = async (actie: string, bevestig?: string) => {
    if (bevestig && !confirm(bevestig)) return
    setBezig(actie)
    try {
      await api(`/api/admin/personeel/${id}/account`, { body: { actie, email } })
      toast.success({ koppelen: 'Bestaande login gekoppeld — één account voor portaal en inklokken.', aanmaken: 'Login aangemaakt. Verstuur nu de uitnodiging.', uitnodigen: 'Uitnodiging verstuurd.', reset: 'Link om het wachtwoord te herstellen verstuurd.', blokkeren: 'Login geblokkeerd.', deblokkeren: 'Login weer actief.' }[actie] ?? 'Klaar.')
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  const spin = (a: string) => bezig === a && <Loader2 className="h-4 w-4 animate-spin" />
  return (
    <div className="card-base p-4 space-y-4 max-w-2xl">
      <div><h2 className="text-sm font-semibold">Werknemersaccount</h2><p className="text-xs text-gray-500">Met deze login komt de medewerker in de eigen werkomgeving (app.nextgenmedia.be/team): inklokken, beschikbaarheid, planning en briefings. Nooit in het beheer en nooit financiële gegevens.</p></div>
      <div className="flex items-center gap-2 text-sm"><span className="text-gray-500">Status:</span><Chip cls="bg-white border-gray-200 text-gray-700">{ACCOUNT_LABEL[m.account_status]}</Chip>{m.uitnodiging_verzonden_at && <span className="text-xs text-gray-500">laatste mail {datumNl(m.uitnodiging_verzonden_at.slice(0, 10))}</span>}</div>
      {intern.gekoppeld && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 space-y-1">
          <div className="font-medium">Ook een interne login (werknemer)</div>
          <div className="text-xs">Rol: {intern.gekoppeld.rol ?? 'medewerker'} · modules: {(intern.gekoppeld.permissions ?? []).join(', ') || 'geen'}{intern.gekoppeld.active === false ? ' · inactief' : ''}</div>
          <div className="text-xs">Met dezelfde login werkt {m.voornaam} in het portaal én klokt ze in via “Mijn werk”. Rol, modules, (in)actief zetten en wachtwoord beheer je in <Link href="/admin/personeel?tab=accounts" className="underline">Accounts en rechten</Link>.</div>
        </div>
      )}
      {!m.auth_user_id && intern.kandidaat && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
          <div><b>{intern.kandidaat.email}</b> bestaat al als werknemerslogin. Koppel die in plaats van een tweede account aan te maken.</div>
          <button type="button" disabled={!!bezig} onClick={() => doe('koppelen')} className="btn-primary text-sm">{spin('koppelen') || <KeyRound className="h-4 w-4" />}Bestaande login koppelen</button>
        </div>
      )}
      {!m.auth_user_id ? (
        <div className="space-y-2">
          <div><label className={LBL}>E-mailadres voor de login</label><input type="email" className={INP} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button type="button" disabled={!!bezig || !email} onClick={() => doe('aanmaken')} className="btn-primary">{spin('aanmaken') || <KeyRound className="h-4 w-4" />}Login aanmaken</button>
          <p className="text-[11px] text-gray-500">Er vertrekt nog geen mail; dat doe je daarna met "Uitnodiging versturen".</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <div className="w-full text-sm">Login: <b>{m.email}</b></div>
          {m.account_status !== 'geblokkeerd' && <button type="button" disabled={!!bezig} onClick={() => doe('uitnodigen', `Uitnodiging sturen naar ${m.email}?`)} className="btn-primary">{spin('uitnodigen') || <Mail className="h-4 w-4" />}Uitnodiging versturen</button>}
          {m.account_status !== 'geblokkeerd' && <button type="button" disabled={!!bezig} onClick={() => doe('reset', `Een link om het wachtwoord opnieuw in te stellen sturen naar ${m.email}?`)} className="btn-secondary">{spin('reset') || <RefreshCw className="h-4 w-4" />}Wachtwoord opnieuw instellen</button>}
          {intern.gekoppeld ? null : m.account_status === 'geblokkeerd'
            ? <button type="button" disabled={!!bezig} onClick={() => doe('deblokkeren')} className="btn-secondary">{spin('deblokkeren') || <CheckCircle2 className="h-4 w-4" />}Deblokkeren</button>
            : <button type="button" disabled={!!bezig} onClick={() => doe('blokkeren', 'De login onmiddellijk blokkeren? Het dossier en alle uren blijven bewaard.')} className="btn-secondary text-red-600">{spin('blokkeren') || <Ban className="h-4 w-4" />}Blokkeren</button>}
        </div>
      )}
      <p className="text-[11px] text-gray-500">Mails vertrekken enkel via deze knoppen. De link om een wachtwoord te kiezen is ongeveer een uur geldig en werkt één keer.</p>
    </div>
  )
}

const ACTIE_LABEL: Record<string, string> = {
  aangemaakt: 'Dossier aangemaakt', gewijzigd: 'Gegevens gewijzigd', profielfoto_gewijzigd: 'Profielfoto gewijzigd', profielfoto_verwijderd: 'Profielfoto verwijderd', gevoelige_gegevens_bijgewerkt: 'Gevoelige gegevens bijgewerkt',
  tarief_toegevoegd: 'Tariefversie toegevoegd', tarief_verwijderd: 'Tariefversie verwijderd', document_toegevoegd: 'Document toegevoegd', document_vervangen: 'Document vervangen', document_gewijzigd: 'Document gewijzigd', document_verwijderd: 'Document verwijderd',
  login_aangemaakt: 'Login aangemaakt', uitnodiging_verstuurd: 'Uitnodiging verstuurd', wachtwoordreset_verstuurd: 'Wachtwoordlink verstuurd', login_geblokkeerd: 'Login geblokkeerd', login_gedeblokkeerd: 'Login gedeblokkeerd',
  ingeklokt: 'Ingeklokt', uitgeklokt: 'Uitgeklokt', sessie_gecorrigeerd: 'Sessie gecorrigeerd', sessie_afgesloten_door_admin: 'Sessie afgesloten door admin', sessie_goedgekeurd: 'Uren goedgekeurd', sessie_afgekeurd: 'Uren afgekeurd',
  correctie_gevraagd: 'Correctie gevraagd', goedkeuring_teruggedraaid: 'Goedkeuring teruggedraaid', opmerking: 'Interne opmerking', sessie_manueel_toegevoegd: 'Uren manueel geregistreerd', tijden_aangepast_door_medewerker: 'Tijden aangepast door medewerker', verslag_bijgewerkt: 'Werkverslag bijgewerkt',
  beschikbaarheid_ingediend: 'Beschikbaarheid ingediend', beschikbaarheid_ingetrokken: 'Beschikbaarheid ingetrokken', beschikbaarheid_goedgekeurd: 'Beschikbaarheid goedgekeurd', beschikbaarheid_gedeeltelijk: 'Beschikbaarheid deels goedgekeurd', beschikbaarheid_afgewezen: 'Beschikbaarheid afgewezen', uren_voorgesteld: 'Andere uren voorgesteld', voorstel_aanvaard: 'Voorstel aanvaard',
  ingepland: 'Ingepland', werkblok_gewijzigd: 'Werkblok gewijzigd', werkblok_geannuleerd: 'Werkblok geannuleerd', voortgang_bijgewerkt: 'Voortgang bijgewerkt',
  kost_geboekt: 'Kost geboekt in Financiën', kost_gecorrigeerd: 'Kost gecorrigeerd in Financiën', kost_ingetrokken: 'Kost ingetrokken in Financiën',
}

function Logboek({ log }: { log: Log[] }) {
  const toon = (x: unknown) => (x === null || x === undefined ? '' : typeof x === 'string' ? x : JSON.stringify(x, null, 0).slice(0, 400))
  return (
    <div className="card-base p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 text-xs text-gray-500">Alle wijzigingen met oude en nieuwe waarde, reden, tijdstip en wie het deed.</div>
      {log.length === 0 ? <div className="text-sm text-gray-400 text-center py-8">Nog geen activiteit.</div> : (
        <ul className="divide-y divide-gray-50">
          {log.map((r) => (
            <li key={r.id} className="px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-x-2"><span className="font-medium">{ACTIE_LABEL[r.actie] ?? r.actie}</span><span className="text-xs text-gray-400">{new Date(r.created_at).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })} · {r.actor_email ?? 'systeem'}</span></div>
              {r.reden && <div className="text-xs text-gray-600">Reden: {r.reden}</div>}
              {(r.oud !== null || r.nieuw !== null) && <div className="text-[11px] text-gray-500 font-mono break-all">{r.oud !== null && <span className="text-red-700">− {toon(r.oud)} </span>}{r.nieuw !== null && <span className="text-green-700">+ {toon(r.nieuw)}</span>}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
