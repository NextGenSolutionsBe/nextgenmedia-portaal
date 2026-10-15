'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronLeft, Loader2, Save, Upload, Trash2, RefreshCw, FileText, Lock, KeyRound, Mail, Ban, CheckCircle2, Plus, X, Camera, ShieldAlert, Pencil } from 'lucide-react'
import { api, Avatar, Chip, datumNl, euro, INP, LBL } from '@/components/personeel/ui'
import { MEDEWERKER_TYPES, DOCUMENT_MAPPEN, ACCOUNT_LABEL, typeLabel, typeKleur, mapLabel, type AccountStatus } from '@/lib/personeel/model'
import { KOST_SOORTEN, LIJN_SUGGESTIES, type KostLijn, type KostSoort, type Tarief } from '@/lib/personeel/kost'
import { Bevestig, Dialoog } from '@/app/admin/instellingen/ui'
import { PlanningTab } from '../planning-tab'

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
  historiek?: { sessies: number; kostenposten: number; planning: number }
  intern: { gekoppeld: Intern | null; kandidaat: Intern | null }
}
type Intern = { id: string; email: string | null; name: string | null; rol?: string | null; permissions?: string[]; active?: boolean | null }

// Inklokken, uren en kosten zijn weg: dossier, planning (beschikbaarheid + inboekingen), account en logboek.
const TABS = [['gegevens', 'Gegevens'], ['documenten', 'Documenten'], ['planning', 'Planning'], ['tarief', 'Tarief'], ['account', 'Account'], ['logboek', 'Logboek']] as const
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
  // Tarieven zijn financieel: het tabblad enkel voor wie Financiën mag zien.
  const tabs = TABS.filter(([k]) => k !== 'tarief' || d.magFinancieel)

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
      {tab === 'planning' && <PlanningTab personeelId={id} />}
      {tab === 'tarief' && d.magFinancieel && <TariefTab id={id} tarieven={d.tarieven ?? []} onKlaar={laad} />}
      {tab === 'account' && <Account id={id} m={m} intern={d.intern} onKlaar={laad} />}
      {tab === 'logboek' && <Logboek log={d.logboek} />}
    </div>
  )
}

function Foto({ id, naam, url, onKlaar }: { id: string; naam: string; url: string | null; onKlaar: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [bezig, setBezig] = useState(false)
  const [vraagWis, setVraagWis] = useState(false)
  const kies = async (f: File | null) => {
    if (!f) return
    setBezig(true)
    try { const fd = new FormData(); fd.append('file', f); await api(`/api/admin/personeel/${id}/foto`, { form: fd }); toast.success('Profielfoto bijgewerkt.'); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Uploaden mislukt') } finally { setBezig(false) }
  }
  const wis = async () => {
    setBezig(true)
    try { await api(`/api/admin/personeel/${id}/foto`, { method: 'DELETE' }); toast.success('Profielfoto verwijderd.'); setVraagWis(false); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => ref.current?.click()} className="relative group block" title="Profielfoto wijzigen">
        <Avatar naam={naam} url={url} groot />
        <span className="absolute inset-0 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">{bezig ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}</span>
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { kies(e.target.files?.[0] ?? null); e.target.value = '' }} />
      </button>
      {url && (
        <button type="button" onClick={() => setVraagWis(true)} disabled={bezig} className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-white border border-red-200 text-red-600 shadow-sm flex items-center justify-center hover:bg-red-50" title="Profielfoto verwijderen" aria-label="Profielfoto verwijderen">
          <Trash2 className="h-3 w-3" />
        </button>
      )}
      {vraagWis && (
        <Bevestig titel="Profielfoto verwijderen" gevaarlijk bevestigLabel="Verwijderen" bezig={bezig}
          tekst={<>De profielfoto van <strong>{naam}</strong> verwijderen?</>}
          onBevestig={wis} onAnnuleer={() => setVraagWis(false)} />
      )}
    </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {veld('voornaam', 'Voornaam *')}{veld('achternaam', 'Achternaam')}
          {veld('email', m.auth_user_id ? 'E-mailadres (login — wijzigen via Account)' : 'E-mailadres', 'email')}{veld('telefoon', 'Telefoon')}
          <div><label className={LBL}>Type medewerker</label><select className={INP} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{MEDEWERKER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
          {veld('functie', 'Functie')}{veld('afdeling', 'Afdeling')}{veld('contracttype', 'Contracttype')}
          {veld('startdatum', 'Startdatum', 'date')}{veld('einddatum', 'Einddatum', 'date')}
          {veld('verantwoordelijke', 'Interne verantwoordelijke')}
          <div><label className={LBL}>Status</label><select className={INP} value={f.actief ? '1' : '0'} onChange={(e) => setF({ ...f, actief: e.target.value === '1' })}><option value="1">Actief</option><option value="0">Inactief</option></select></div>
        </div>
        <div><div className={LBL}>Standaardwerkdagen</div><div className="flex flex-wrap gap-1">{DAGEN.map((dg, i) => { const n = i + 1; const aan = f.standaard_werkdagen.includes(n); return <button key={dg} type="button" onClick={() => setF({ ...f, standaard_werkdagen: aan ? f.standaard_werkdagen.filter((x) => x !== n) : [...f.standaard_werkdagen, n].sort() })} className={`h-8 w-9 rounded-lg text-xs font-medium border ${aan ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-600'}`}>{dg}</button> })}</div></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{veld('max_uren_dag', 'Max. u/dag', 'number')}{veld('max_uren_week', 'Max. u/week', 'number')}{veld('max_uren_maand', 'Max. u/maand', 'number')}</div>
        <div><label className={LBL}>Interne notities (nooit zichtbaar voor de medewerker)</label><textarea rows={3} className={INP} value={f.interne_notities} onChange={(e) => setF({ ...f, interne_notities: e.target.value })} /></div>
        <button type="button" disabled={bezig === 'w'} onClick={bewaar} className="btn-primary">{bezig === 'w' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren</button>
      </div>
      <div className="card-base p-4 space-y-3 h-fit">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><Lock className="h-4 w-4" />Persoonlijke gegevens</h2>
        {!d.magGevoelig ? <p className="text-sm text-gray-500">Enkel zichtbaar voor bevoegde admins (instellingenrecht op Personeel).</p> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><label className={LBL}>Adres</label><textarea rows={2} className={INP} value={g.adres} onChange={(e) => setG({ ...g, adres: e.target.value })} /></div>
              <div><label className={LBL}>Geboortedatum</label><input type="date" className={INP} value={g.geboortedatum} onChange={(e) => setG({ ...g, geboortedatum: e.target.value })} /></div>
              <div><label className={LBL}>Rijksregisternummer</label><input className={INP} value={g.rijksregisternummer} onChange={(e) => setG({ ...g, rijksregisternummer: e.target.value })} placeholder="enkel indien nodig" /></div>
              <div className="sm:col-span-2"><label className={LBL}>Bankrekeningnummer (IBAN)</label><input className={INP} value={g.iban} onChange={(e) => setG({ ...g, iban: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={LBL}>Noodcontact</label><input className={INP} value={g.noodcontact} onChange={(e) => setG({ ...g, noodcontact: e.target.value })} placeholder="naam, relatie, telefoon" /></div>
            </div>
            <p className="text-[11px] text-gray-500">Rijksregisternummer en IBAN worden versleuteld bewaard. In het logboek staat enkel wélk veld wijzigde, nooit de waarde.</p>
            <button type="button" disabled={bezig === 'g'} onClick={bewaarGevoelig} className="btn-primary">{bezig === 'g' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren</button>
          </>
        )}
      </div>
      <Verwijderzone d={d} onKlaar={onKlaar} />
    </div>
  )
}

/**
 * Definitief verwijderen kan enkel zolang er geen historiek is (uren,
 * kostenposten, planning). Anders enkel op inactief zetten.
 */
function Verwijderzone({ d, onKlaar }: { d: Dossier; onKlaar: () => void }) {
  const router = useRouter()
  const m = d.medewerker
  const naam = [m.voornaam, m.achternaam].filter(Boolean).join(' ')
  const h = d.historiek ?? { sessies: 1, kostenposten: 0, planning: 0 }
  const heeftHistoriek = h.sessies > 0 || h.kostenposten > 0 || h.planning > 0
  const [open, setOpen] = useState(false)
  const [invoer, setInvoer] = useState('')
  const [bezig, setBezig] = useState(false)
  const klopt = invoer.trim().toLowerCase() === naam.trim().toLowerCase()

  const deactiveer = async () => {
    setBezig(true)
    try { await api(`/api/admin/personeel/${m.id}`, { method: 'PATCH', body: { actief: false } }); toast.success('Medewerker op inactief gezet.'); onKlaar() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  const verwijder = async () => {
    if (!klopt) return
    setBezig(true)
    try {
      await api(`/api/admin/personeel/${m.id}`, { method: 'DELETE', body: { bevestig_naam: invoer } })
      toast.success('Dossier definitief verwijderd.')
      router.push('/admin/personeel')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt'); setBezig(false) }
  }

  const delen = [h.sessies && `${h.sessies} urenregistratie${h.sessies === 1 ? '' : 's'}`, h.kostenposten && `${h.kostenposten} kostenpost${h.kostenposten === 1 ? '' : 'en'}`, h.planning && `${h.planning} planningsblok${h.planning === 1 ? '' : 'ken'}`].filter(Boolean)
  return (
    <div className="card-base p-4 space-y-2 lg:col-span-2 border-red-100">
      <h2 className="text-sm font-semibold text-red-700 flex items-center gap-1.5"><ShieldAlert className="h-4 w-4" />Dossier verwijderen</h2>
      {heeftHistoriek ? (
        <>
          <p className="text-sm text-gray-600">
            {naam} heeft al {delen.length ? delen.join(', ') : 'historiek'}. Die historiek moet bewaard blijven, dus dit dossier kan enkel op <b>inactief</b> gezet worden.
          </p>
          {m.actief && <button type="button" disabled={bezig} onClick={deactiveer} className="btn-secondary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}Op inactief zetten</button>}
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600">Er zijn nog geen uren, kostenposten of planning. Je kan dit dossier definitief verwijderen, inclusief documenten{m.auth_user_id ? ' en de login die enkel voor dit dossier bestaat' : ''}.</p>
          <button type="button" onClick={() => { setInvoer(''); setOpen(true) }} className="btn-danger text-sm"><Trash2 className="h-4 w-4" />Definitief verwijderen</button>
        </>
      )}
      {open && (
        <Dialoog titel="Dossier definitief verwijderen" onSluit={() => !bezig && setOpen(false)}>
          <div className="space-y-3">
            <p className="text-sm text-gray-700">Dit kan niet ongedaan gemaakt worden. Typ <b>{naam}</b> om te bevestigen.</p>
            <input className={INP} value={invoer} onChange={(e) => setInvoer(e.target.value)} placeholder={naam} autoFocus />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setOpen(false)} disabled={bezig} className="btn-secondary">Annuleren</button>
              <button type="button" onClick={verwijder} disabled={!klopt || bezig} className="btn-danger">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Definitief verwijderen</button>
            </div>
          </div>
        </Dialoog>
      )}
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
  const [bewerk, setBewerk] = useState<Doc | null>(null)
  const [wis, setWis] = useState<Doc | null>(null)
  const verwijder = async (doc: Doc) => {
    setBezig(`wis-${doc.id}`)
    try { await api(`/api/admin/personeel/${id}/documenten?doc=${doc.id}`, { method: 'DELETE' }); toast.success('Verwijderd.'); setWis(null); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
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
                        <button type="button" onClick={() => setBewerk(doc)} className="h-7 w-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-500" title="Naam, map of verplicht aanpassen"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setWis(doc)} className="h-7 w-7 rounded hover:bg-red-50 flex items-center justify-center text-red-400 hover:text-red-600" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                      </span>
                    </div>
                    <div className="text-gray-500 mt-1 flex flex-wrap items-center gap-x-2">
                      {doc.verplicht && <span className="text-amber-700 font-medium">Verplicht ·</span>}
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
      {bewerk && <DocBewerk id={id} doc={bewerk} mappen={zichtbareMappen} onSluit={() => setBewerk(null)} onKlaar={() => { setBewerk(null); onKlaar() }} />}
      {wis && (
        <Bevestig titel="Document verwijderen" gevaarlijk bevestigLabel="Verwijderen" bezig={bezig === `wis-${wis.id}`}
          tekst={<><strong>{wis.naam}</strong> definitief verwijderen, ook uit de opslag?</>}
          onBevestig={() => verwijder(wis)} onAnnuleer={() => setWis(null)} />
      )}
    </div>
  )
}

function DocBewerk({ id, doc, mappen, onSluit, onKlaar }: { id: string; doc: Doc; mappen: { key: string; label: string }[]; onSluit: () => void; onKlaar: () => void }) {
  const [naam, setNaam] = useState(doc.naam)
  const [map, setMap] = useState(doc.map)
  const [verplicht, setVerplicht] = useState(doc.verplicht)
  const [vervalt, setVervalt] = useState(doc.vervalt_op ?? '')
  const [bezig, setBezig] = useState(false)
  const bewaar = async () => {
    if (!naam.trim()) { toast.error('De naam mag niet leeg zijn.'); return }
    setBezig(true)
    try {
      await api(`/api/admin/personeel/${id}/documenten`, { method: 'PATCH', body: { doc: doc.id, naam: naam.trim(), map, verplicht, vervalt_op: vervalt || null } })
      toast.success('Document bijgewerkt.')
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel="Document bewerken" onSluit={onSluit}>
      <div className="space-y-3">
        <div><label className={LBL}>Naam</label><input className={INP} value={naam} maxLength={200} onChange={(e) => setNaam(e.target.value)} /></div>
        <div><label className={LBL}>Map</label><select className={INP} value={map} onChange={(e) => setMap(e.target.value)}>{mappen.map((mp) => <option key={mp.key} value={mp.key}>{mp.label}</option>)}</select></div>
        <div><label className={LBL}>Vervalt op</label><input type="date" className={INP} value={vervalt} onChange={(e) => setVervalt(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verplicht} onChange={(e) => setVerplicht(e.target.checked)} className="h-4 w-4 accent-black" />Verplicht document</label>
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button>
          <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren</button>
        </div>
      </div>
    </Dialoog>
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

/**
 * Uurtarief — versies, nooit herschreven. Een wijziging = een nieuwe versie met
 * een startdatum; de vorige wordt afgesloten. Zo blijven eerder geboekte kosten
 * (bv. video editing) exact wat ze waren.
 */
function TariefTab({ id, tarieven, onKlaar }: { id: string; tarieven: TariefMet[]; onKlaar: () => void }) {
  const vandaag = new Date().toISOString().slice(0, 10)
  const [open, setOpen] = useState(tarieven.length === 0)
  const [v, setV] = useState({ geldig_vanaf: vandaag, basis_label: 'Brutouurloon', basis_uur: '', btw_pct: '0', opmerking: '' })
  const [lijnen, setLijnen] = useState<KostLijn[]>([])
  const [bezig, setBezig] = useState(false)
  const getal = (x: string) => { const n = Number(String(x).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
  const basis = getal(v.basis_uur)
  const extraUur = lijnen.reduce((t, l) => t + (l.soort === 'pct' ? (basis * l.waarde) / 100 : l.soort === 'per_uur' ? l.waarde : 0), 0)
  const bewaar = async () => {
    if (!(basis > 0)) { toast.error('Vul het uurloon of de uurvergoeding in.'); return }
    setBezig(true)
    try {
      await api(`/api/admin/personeel/${id}/tarieven`, { body: { ...v, basis_uur: basis, btw_pct: getal(v.btw_pct), lijnen } })
      toast.success('Tarief bewaard. Eerdere kosten blijven ongewijzigd.'); setOpen(false); setLijnen([]); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const verwijder = async (tid: string) => {
    if (!confirm('Deze (meest recente) tariefversie verwijderen? De vorige versie loopt dan weer door.')) return
    try { await api(`/api/admin/personeel/${id}/tarieven?tarief=${tid}`, { method: 'DELETE' }); toast.success('Tariefversie verwijderd.'); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }
  const nieuwsteEerst = [...tarieven].sort((a, b) => b.geldig_vanaf.localeCompare(a.geldig_vanaf))
  return (
    <div className="space-y-4">
      <div className="card-base space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-sm">Uurtarief</h2>
          {!open && <button type="button" onClick={() => setOpen(true)} className="btn-primary text-xs"><Plus className="h-3.5 w-3.5" />Nieuwe tariefversie</button>}
        </div>
        <p className="text-[11px] text-gray-500">Gebruikt voor kosten zoals video editing. Een wijziging maakt een nieuwe versie vanaf een datum; eerder geboekte kosten veranderen niet.</p>
        {nieuwsteEerst.length === 0 ? <p className="text-sm text-amber-800">Nog geen tarief ingevuld.</p> : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {nieuwsteEerst.map((t, i) => (
              <li key={t.id} className="px-3 py-2 text-sm flex items-start gap-3 flex-wrap">
                <div className="min-w-[150px]"><div className="font-medium">Vanaf {datumNl(t.geldig_vanaf)}</div><div className="text-[11px] text-gray-500">{t.geldig_tot ? `tot ${datumNl(t.geldig_tot)}` : 'loopt'}</div></div>
                <div className="flex-1 text-xs text-gray-700 space-y-0.5">
                  <div>{t.basis_label}: <b>{euro(t.basis_uur)}</b> / u</div>
                  {t.opbouw.lasten > 0.004 ? <div>Totale kost voor het bedrijf: <b>{euro(t.opbouw.totaal)}</b> / u <span className="text-gray-500">(+ {euro(t.opbouw.lasten)} werkgevers-/andere kosten)</span></div> : <div className="text-gray-500">Geen werkgevers- of payrollkosten ingevuld → kost = loonkost op basis van uurloon.</div>}
                  {t.lijnen.length > 0 && <div className="text-gray-500">{t.lijnen.map((l) => `${l.label}: ${l.waarde}${KOST_SOORTEN.find((k) => k.key === l.soort)?.eenheid ?? ''}`).join(' · ')}</div>}
                </div>
                {i === 0 && <button type="button" onClick={() => verwijder(t.id)} className="text-gray-400 hover:text-red-600" aria-label="Meest recente tariefversie verwijderen"><Trash2 className="h-4 w-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && (
        <div className="card-base space-y-3">
          <h3 className="font-semibold text-sm">Nieuwe tariefversie</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><label className={LBL}>Geldig vanaf</label><input type="date" className={INP} value={v.geldig_vanaf} onChange={(e) => setV({ ...v, geldig_vanaf: e.target.value })} /></div>
            <div><label className={LBL}>Soort</label><select className={INP} value={v.basis_label} onChange={(e) => setV({ ...v, basis_label: e.target.value })}><option>Brutouurloon</option><option>Uurvergoeding student</option><option>Afgesproken uurprijs</option></select></div>
            <div><label className={LBL}>Bedrag per uur (€)</label><input className={INP} inputMode="decimal" value={v.basis_uur} onChange={(e) => setV({ ...v, basis_uur: e.target.value })} placeholder="bv. 14" /></div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between"><label className={LBL}>Bijkomende kosten voor het bedrijf <span className="text-gray-400 font-normal">— enkel als ze betrouwbaar gekend zijn</span></label></div>
            {lijnen.map((l, i) => (
              <div key={l.id} className="grid grid-cols-[1fr_150px_90px_auto] gap-1.5 items-center">
                <input className={INP} value={l.label} onChange={(e) => setLijnen(lijnen.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Omschrijving" />
                <select className={INP} value={l.soort} onChange={(e) => setLijnen(lijnen.map((x, j) => (j === i ? { ...x, soort: e.target.value as KostSoort } : x)))} aria-label="Soort">{KOST_SOORTEN.filter((k) => k.key !== 'eenmalig').map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
                <input className={INP} inputMode="decimal" value={String(l.waarde)} onChange={(e) => setLijnen(lijnen.map((x, j) => (j === i ? { ...x, waarde: getal(e.target.value) } : x)))} aria-label="Waarde" />
                <button type="button" onClick={() => setLijnen(lijnen.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Verwijderen"><X className="h-4 w-4" /></button>
              </div>
            ))}
            <div className="flex gap-1 flex-wrap">{LIJN_SUGGESTIES.filter((s) => s.soort !== 'eenmalig').slice(0, 5).map((s) => <button key={s.label} type="button" onClick={() => setLijnen([...lijnen, { id: `l${Date.now()}${lijnen.length}`, label: s.label, soort: s.soort, waarde: 0 }])} className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] hover:border-gray-400">+ {s.label}</button>)}</div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={LBL}>Btw die de medewerker aanrekent (%)</label><input className={INP} inputMode="decimal" value={v.btw_pct} onChange={(e) => setV({ ...v, btw_pct: e.target.value })} /><p className="text-[11px] text-gray-500 mt-0.5">Student of werknemer: 0.</p></div>
            <div><label className={LBL}>Opmerking</label><input className={INP} value={v.opmerking} onChange={(e) => setV({ ...v, opmerking: e.target.value })} /></div>
          </div>
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">
            Per uur: loon {euro(basis)}{extraUur > 0 ? <> · totale kost {euro(basis + extraUur)} (zonder dag-/maandkosten)</> : <> · zonder bijkomende kosten = loonkost op basis van uurloon</>}
          </div>
          <div className="flex gap-2"><button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Tarief bewaren</button>{tarieven.length > 0 && <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-sm">Annuleren</button>}</div>
        </div>
      )}
    </div>
  )
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
