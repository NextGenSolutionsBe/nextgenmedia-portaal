'use client'

/**
 * Fase 4 (rollen, rechten en plug-and-play): nieuw account in vier stappen,
 * rolsjablonen, onboarding-checklist en vertrek (offboarding). Niets wordt
 * verwijderd; een uitnodiging vertrekt enkel na een uitdrukkelijk vinkje.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Check, Plus, ChevronLeft, ChevronRight, Mail, Pencil } from 'lucide-react'
import { VISIBLE_ADMIN_MODULES, ADMIN_MODULES } from '@/lib/staff'
import { STAFF_ROLLEN, ROL_LABEL, type Rol } from '@/lib/instellingen/model'
import { volledigeNaam, type Medewerker } from '@/lib/instellingen/medewerkers'
import { BEDRIJVEN, STAPPEN, foutInStap, sjabloonToepassen, voortgang, bedrijvenLabel, type RolSjabloon, type OnboardingStap, type Bedrijf, type StaffRol } from '@/lib/team/rollen'
import { Kop, Badge, Dialoog, INP, Laden, Veld, datumTijd } from './ui'

const API = '/api/admin/instellingen/medewerkers'
const moduleLabel = (k: string) => ADMIN_MODULES.find((m) => m.key === k)?.label ?? k
const zichtbaar = VISIBLE_ADMIN_MODULES.map((m) => m.key)

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as { error?: string }).error || 'Mislukt')
  return j as T
}

export function useSjablonen() {
  const [sjablonen, setSjablonen] = useState<RolSjabloon[] | null>(null)
  const laad = useCallback(() => fetch('/api/admin/instellingen/rollen', { cache: 'no-store' }).then((r) => json<{ sjablonen: RolSjabloon[] }>(r)).then((j) => setSjablonen(j.sjablonen)).catch(() => setSjablonen([])), [])
  useEffect(() => { void laad() }, [laad])
  return { sjablonen, laad }
}

// ── Toegang per bedrijf ──────────────────────────────────────────────────────

export function BedrijfKeuze({ waarde, onChange }: { waarde: string[]; onChange: (b: Bedrijf[]) => void }) {
  const keuze = waarde.length === 1 ? waarde[0] : 'alle'
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Toegang per bedrijf">
      {[{ key: 'alle', label: 'Alle bedrijven' }, ...BEDRIJVEN].map((b) => (
        <button key={b.key} type="button" role="radio" aria-checked={keuze === b.key} onClick={() => onChange(b.key === 'alle' ? [] : [b.key as Bedrijf])}
          className={`px-3 py-1.5 rounded-lg text-sm border ${keuze === b.key ? 'bg-black text-white border-black' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>{b.label}</button>
      ))}
    </div>
  )
}

function ModulesKiezer({ perms, setPerms }: { perms: string[]; setPerms: (p: string[]) => void }) {
  const wissel = (k: string) => setPerms(perms.includes(k) ? perms.filter((x) => x !== k) : [...perms, k])
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5 rounded-xl border border-gray-100 p-3">
      {VISIBLE_ADMIN_MODULES.map((m) => <label key={m.key} className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={perms.includes(m.key)} onChange={() => wissel(m.key)} />{m.label}</label>)}
    </div>
  )
}

// ── Nieuw account in vier stappen ────────────────────────────────────────────

export function NieuwAccount({ onSluit, onKlaar }: { onSluit: () => void; onKlaar: () => void }) {
  const { sjablonen } = useSjablonen()
  const [stap, setStap] = useState(0)
  const [voornaam, setVoornaam] = useState('')
  const [achternaam, setAchternaam] = useState('')
  const [email, setEmail] = useState('')
  const [functie, setFunctie] = useState('')
  const [sjabloon, setSjabloon] = useState<string | null>(null)
  const [rol, setRol] = useState<StaffRol>('medewerker')
  const [perms, setPerms] = useState<string[]>([])
  const [bedrijven, setBedrijven] = useState<Bedrijf[]>([])
  const [start, setStart] = useState('')
  const [eind, setEind] = useState('')
  const [uitnodigen, setUitnodigen] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  const kiesSjabloon = (s: RolSjabloon | null) => {
    setSjabloon(s?.key ?? null)
    if (!s) return
    const t = sjabloonToepassen(s, zichtbaar)
    setRol(t.rol); setPerms(t.permissions); setBedrijven(t.bedrijven)
    if (!functie.trim()) setFunctie(s.naam === 'Zaakvoerder' ? '' : s.naam)
  }
  const gekozen = sjablonen?.find((s) => s.key === sjabloon) ?? null
  const invoer = { voornaam, email, permissions: perms, start_datum: start || null, eind_datum: eind || null }

  const verder = () => { const f = foutInStap(stap, invoer); setFout(f); if (!f) setStap(stap + 1) }
  const maak = async () => {
    for (let i = 0; i < 3; i++) { const f = foutInStap(i, invoer); if (f) { setStap(i); setFout(f); return } }
    setBezig(true); setFout(null)
    try {
      const r = await json<{ id: string }>(await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voornaam, achternaam, email: email.trim(), functie, rol, permissions: perms, bedrijven, sjabloon, start_datum: start || null, eind_datum: eind || null }) }))
      if (uitnodigen) {
        try { await json(await fetch(`${API}/${r.id}/uitnodiging`, { method: 'POST' })); toast.success(`Account aangemaakt en uitnodiging verstuurd naar ${email.trim()}.`) }
        catch (e) { toast.error(`Account aangemaakt, maar de uitnodiging lukte niet: ${e instanceof Error ? e.message : 'onbekend'}. Probeer het opnieuw met het envelopje.`) }
      } else toast.success('Account aangemaakt. Verstuur de uitnodiging met het envelopje zodra de persoon mag inloggen.')
      onKlaar()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }

  return (
    <Dialoog titel="Nieuwe medewerker" onSluit={onSluit} breed>
      <div className="space-y-4">
        <ol className="flex gap-1.5 text-xs">
          {STAPPEN.map((s, i) => (
            <li key={s} className={`flex-1 rounded-lg px-2 py-1.5 border ${i === stap ? 'border-black bg-black text-white' : i < stap ? 'border-gray-200 bg-gray-50 text-gray-700' : 'border-gray-100 text-gray-400'}`}>
              <span className="font-mono mr-1">{i + 1}</span>{s}
            </li>
          ))}
        </ol>

        {stap === 0 && (
          <div className="grid sm:grid-cols-2 gap-2">
            <Veld label="Voornaam *"><input className={INP} value={voornaam} onChange={(e) => setVoornaam(e.target.value)} autoFocus /></Veld>
            <Veld label="Achternaam"><input className={INP} value={achternaam} onChange={(e) => setAchternaam(e.target.value)} /></Veld>
            <Veld label="E-mailadres (login) *"><input type="email" className={INP} value={email} onChange={(e) => setEmail(e.target.value)} /></Veld>
            <Veld label="Functie"><input className={INP} value={functie} onChange={(e) => setFunctie(e.target.value)} placeholder="bv. Contentmarketeer" /></Veld>
          </div>
        )}

        {stap === 1 && (
          <div className="space-y-3">
            {!sjablonen ? <Laden /> : (
              <div className="grid sm:grid-cols-2 gap-2">
                {sjablonen.filter((s) => s.actief).map((s) => (
                  <button key={s.key} type="button" onClick={() => kiesSjabloon(s)}
                    className={`text-left rounded-xl border p-3 transition-colors ${sjabloon === s.key ? 'border-black ring-1 ring-black' : 'border-gray-200 hover:border-gray-400'}`}>
                    <div className="font-semibold text-sm">{s.naam}</div>
                    {s.omschrijving && <div className="text-xs text-gray-500 mt-0.5">{s.omschrijving}</div>}
                    <div className="text-[11px] text-gray-400 mt-1">{s.modules.length ? `${s.modules.length} modules` : 'Alle modules'} · {bedrijvenLabel(s.bedrijven)}</div>
                  </button>
                ))}
              </div>
            )}
            <details className="rounded-xl border border-gray-100 p-3" open={!sjabloon}>
              <summary className="text-sm font-medium cursor-pointer">Rol, modules en bedrijf {gekozen ? 'nakijken' : 'zelf kiezen'}</summary>
              <div className="space-y-3 mt-3">
                <Veld label="Rol"><select className={INP} value={rol} onChange={(e) => setRol(e.target.value as StaffRol)}>{STAFF_ROLLEN.map((r) => <option key={r} value={r}>{ROL_LABEL[r as Rol]}</option>)}</select></Veld>
                <div><div className="text-xs font-medium text-gray-600 mb-1">Toegang</div><BedrijfKeuze waarde={bedrijven} onChange={setBedrijven} /></div>
                <div><div className="text-xs font-medium text-gray-600 mb-1">Modules</div><ModulesKiezer perms={perms} setPerms={setPerms} /></div>
              </div>
            </details>
          </div>
        )}

        {stap === 2 && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-2">
              <Veld label="Eerste werkdag"><input type="date" className={INP} value={start} onChange={(e) => setStart(e.target.value)} /></Veld>
              <Veld label="Laatste werkdag" hint="Leeg = onbepaalde duur. Bij een student of stagiair vul je ze in."><input type="date" className={INP} value={eind} onChange={(e) => setEind(e.target.value)} /></Veld>
            </div>
            <p className="text-xs text-gray-500">Het personeelsdossier en de plaats in de teamagenda komen er vanzelf bij.{gekozen?.onboarding.length ? ` De onboarding-checklist van ${gekozen.naam} (${gekozen.onboarding.length} stappen) ook.` : ''}</p>
          </div>
        )}

        {stap === 3 && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-gray-100 divide-y divide-gray-100">
              <Regel k="Naam" v={`${voornaam} ${achternaam}`.trim()} />
              <Regel k="Login" v={email.trim()} />
              {functie && <Regel k="Functie" v={functie} />}
              <Regel k="Sjabloon" v={gekozen?.naam ?? 'Geen (zelf gekozen)'} />
              <Regel k="Rol" v={ROL_LABEL[rol as Rol]} />
              <Regel k="Toegang" v={bedrijvenLabel(bedrijven)} />
              <Regel k="Modules" v={perms.map(moduleLabel).join(', ')} />
              {(start || eind) && <Regel k="Periode" v={`${start || '…'} tot ${eind || 'onbepaald'}`} />}
            </div>
            <label className="flex items-start gap-2 rounded-xl border border-gray-200 p-3 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={uitnodigen} onChange={(e) => setUitnodigen(e.target.checked)} />
              <span><b className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />Nu de uitnodiging versturen</b><br /><span className="text-xs text-gray-500">Er vertrekt een mail naar {email.trim() || 'dit adres'} met een link om een wachtwoord te kiezen. Zonder vinkje vertrekt er niets; dat kan later met het envelopje.</span></span>
            </label>
          </div>
        )}

        {fout && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{fout}</div>}
        <div className="flex gap-2 justify-between pt-1">
          <button type="button" onClick={stap ? () => { setFout(null); setStap(stap - 1) } : onSluit} className="btn-secondary" disabled={bezig}>{stap ? <><ChevronLeft className="h-4 w-4" />Terug</> : 'Annuleren'}</button>
          {stap < 3
            ? <button type="button" onClick={verder} className="btn-primary">Verder<ChevronRight className="h-4 w-4" /></button>
            : <button type="button" onClick={maak} disabled={bezig} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Account aanmaken</button>}
        </div>
      </div>
    </Dialoog>
  )
}

const Regel = ({ k, v }: { k: string; v: string }) => <div className="flex gap-3 px-3 py-1.5"><span className="w-20 shrink-0 text-gray-500">{k}</span><span className="min-w-0">{v || '—'}</span></div>

// ── Onboarding ───────────────────────────────────────────────────────────────

export function OnboardingVenster({ m, onSluit, onVeranderd }: { m: Medewerker; onSluit: () => void; onVeranderd: () => void }) {
  const { sjablonen } = useSjablonen()
  const [stappen, setStappen] = useState<OnboardingStap[] | null>(null)
  const [nieuw, setNieuw] = useState('')
  const [bezig, setBezig] = useState<string | null>(null)
  useEffect(() => { fetch(`${API}/${m.id}/onboarding`, { cache: 'no-store' }).then((r) => json<{ stappen: OnboardingStap[] }>(r)).then((j) => setStappen(j.stappen)).catch(() => setStappen([])) }, [m.id])
  const doe = async (body: Record<string, unknown>, sleutel: string) => {
    setBezig(sleutel)
    try { const j = await json<{ stappen: OnboardingStap[] }>(await fetch(`${API}/${m.id}/onboarding`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); setStappen(j.stappen); onVeranderd() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  const v = voortgang(stappen ?? [])
  return (
    <Dialoog titel={`Onboarding · ${volledigeNaam(m)}`} onSluit={onSluit}>
      {!stappen ? <Laden /> : (
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1"><span>{v.gedaan} van {v.totaal} stappen</span><span>{v.pct}%</span></div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-black transition-all" style={{ width: `${v.pct}%` }} /></div>
          </div>
          {stappen.length === 0 && (
            <div className="text-sm text-gray-500 space-y-2">
              <p>Nog geen checklist. Neem die van een sjabloon over:</p>
              <div className="flex flex-wrap gap-1.5">{(sjablonen ?? []).filter((s) => s.onboarding.length).map((s) => <button key={s.key} type="button" disabled={!!bezig} onClick={() => doe({ actie: 'sjabloon', sjabloon: s.key }, 'sj')} className="btn-secondary !py-1 !text-xs">{s.naam}</button>)}</div>
            </div>
          )}
          <ul className="space-y-1">
            {stappen.map((s) => (
              <li key={s.id}>
                <label className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={!!s.gedaan_op} disabled={bezig === s.id} onChange={(e) => doe({ actie: 'zet', stap: s.id, gedaan: e.target.checked }, s.id)} />
                  <span className="text-sm flex-1"><span className={s.gedaan_op ? 'line-through text-gray-400' : ''}>{s.titel}</span>{s.gedaan_op && <span className="block text-[11px] text-gray-400">{s.gedaan_door ?? ''} · {datumTijd(s.gedaan_op)}</span>}</span>
                </label>
              </li>
            ))}
          </ul>
          <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (nieuw.trim()) { void doe({ actie: 'erbij', titel: nieuw }, 'erbij'); setNieuw('') } }}>
            <input className={INP} value={nieuw} onChange={(e) => setNieuw(e.target.value)} placeholder="Stap toevoegen" />
            <button type="submit" className="btn-secondary" disabled={!nieuw.trim() || !!bezig}><Plus className="h-4 w-4" /></button>
          </form>
          <p className="text-[11px] text-gray-400">{m.voornaam ?? 'De medewerker'} ziet deze lijst ook bij Mijn account en kan zelf afvinken.</p>
        </div>
      )}
    </Dialoog>
  )
}

// ── Vertrek (offboarding) ────────────────────────────────────────────────────

type Offboarding = { punten: { tekst: string; open: boolean }[]; op: string | null; door: string | null; notitie: string | null; taken: { id: string; titel: string }[]; stand: { login: boolean; icalLinks: number; eindDatum: string | null } }

export function OffboardingVenster({ m, onSluit, onKlaar }: { m: Medewerker; onSluit: () => void; onKlaar: () => void }) {
  const [o, setO] = useState<Offboarding | null>(null)
  const [eind, setEind] = useState(m.eindDatum ?? new Date().toISOString().slice(0, 10))
  const [notitie, setNotitie] = useState('')
  const [blokkeren, setBlokkeren] = useState(true)
  const [ical, setIcal] = useState(true)
  const [bezig, setBezig] = useState(false)
  useEffect(() => {
    fetch(`${API}/${m.id}/offboarding`, { cache: 'no-store' }).then((r) => json<Offboarding>(r)).then((j) => { setO(j); setNotitie(j.notitie ?? ''); if (j.stand.eindDatum) setEind(j.stand.eindDatum) }).catch((e) => { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); onSluit() })
  }, [m.id, onSluit])
  const bewaar = async () => {
    setBezig(true)
    try {
      const j = await json<Offboarding & { gedaan: string[] }>(await fetch(`${API}/${m.id}/offboarding`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eind_datum: eind || null, notitie, blokkeren, ical_intrekken: ical }) }))
      toast.success(j.gedaan.length ? `Vastgelegd: ${j.gedaan.join(', ')}.` : 'Notitie bewaard.')
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel={`Vertrek · ${volledigeNaam(m)}`} onSluit={onSluit} breed>
      {!o ? <Laden /> : (
        <div className="space-y-4 text-sm">
          <p className="text-gray-600">Niets wordt verwijderd: taken, dossier, uren en geschiedenis blijven staan. Je kan het account later weer activeren.</p>
          <ul className="rounded-xl border border-gray-100 divide-y divide-gray-100">
            {o.punten.map((p) => <li key={p.tekst} className="flex items-center gap-2 px-3 py-2">{p.open ? <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" /> : <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />}<span>{p.tekst}</span></li>)}
          </ul>
          {o.taken.length > 0 && (
            <details className="rounded-xl border border-gray-100 p-3">
              <summary className="cursor-pointer font-medium">Open taken ({o.taken.length}{o.taken.length >= 30 ? '+' : ''})</summary>
              <ul className="mt-2 space-y-0.5 text-xs text-gray-600">{o.taken.map((t) => <li key={t.id}><a href={`/admin/agenda?item=${t.id}`} className="hover:underline">{t.titel}</a></li>)}</ul>
              <p className="text-[11px] text-gray-400 mt-2">Geef ze door in de agenda (Wie aanpassen). Ze blijven staan tot iemand ze afvinkt.</p>
            </details>
          )}
          <div className="grid sm:grid-cols-2 gap-2">
            <Veld label="Laatste werkdag"><input type="date" className={INP} value={eind} onChange={(e) => setEind(e.target.value)} /></Veld>
            <Veld label="Notitie (optioneel)"><input className={INP} value={notitie} onChange={(e) => setNotitie(e.target.value)} placeholder="bv. einde stage" /></Veld>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={blokkeren} onChange={(e) => setBlokkeren(e.target.checked)} />Inloggen meteen blokkeren</label>
          {o.stand.icalLinks > 0 && <label className="flex items-center gap-2"><input type="checkbox" checked={ical} onChange={(e) => setIcal(e.target.checked)} />Agenda-abonnementen intrekken</label>}
          {o.op && <p className="text-[11px] text-gray-400">Eerder vastgelegd door {o.door ?? '—'} op {datumTijd(o.op)}.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onSluit} className="btn-secondary" disabled={bezig}>Annuleren</button>
            <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Vertrek vastleggen</button>
          </div>
        </div>
      )}
    </Dialoog>
  )
}

// ── Rolsjablonen ─────────────────────────────────────────────────────────────

export function Rolsjablonen({ isAdmin }: { isAdmin: boolean }) {
  const { sjablonen, laad } = useSjablonen()
  const [bewerk, setBewerk] = useState<RolSjabloon | 'nieuw' | null>(null)
  if (!sjablonen) return <div className="card-base"><Laden /></div>
  return (
    <div className="card-base">
      <Kop titel="Rolsjablonen" tekst="Vertrekpunt voor een nieuw account: rol, modules, bedrijf, startpagina en onboarding. Achteraf pas je alles per persoon aan."
        rechts={isAdmin ? <button type="button" onClick={() => setBewerk('nieuw')} className="btn-secondary"><Plus className="h-4 w-4" />Nieuw sjabloon</button> : undefined} />
      <ul className="divide-y divide-gray-100">
        {sjablonen.map((s) => (
          <li key={s.key} className={`flex items-start gap-3 py-2.5 ${s.actief ? '' : 'opacity-50'}`}>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm flex items-center gap-1.5 flex-wrap">{s.naam}{!s.actief && <Badge kleur="grijs">uit</Badge>}{s.bedrijven.length > 0 && <Badge kleur={s.bedrijven[0] === 'nextgensolutions' ? 'blauw' : 'grijs'}>{bedrijvenLabel(s.bedrijven)}</Badge>}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{ROL_LABEL[s.rol as Rol]} · {s.modules.length ? s.modules.map(moduleLabel).join(', ') : 'alle modules'} · {s.onboarding.length} onboardingstappen{s.startpagina ? ` · start op ${s.startpagina}` : ''}</div>
            </div>
            {isAdmin && <button type="button" onClick={() => setBewerk(s)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600" title="Aanpassen" aria-label={`${s.naam} aanpassen`}><Pencil className="h-3.5 w-3.5" /></button>}
          </li>
        ))}
      </ul>
      {bewerk && <SjabloonVenster s={bewerk === 'nieuw' ? null : bewerk} onSluit={() => setBewerk(null)} onKlaar={() => { setBewerk(null); void laad() }} />}
    </div>
  )
}

function SjabloonVenster({ s, onSluit, onKlaar }: { s: RolSjabloon | null; onSluit: () => void; onKlaar: () => void }) {
  const [naam, setNaam] = useState(s?.naam ?? '')
  const [key, setKey] = useState(s?.key ?? '')
  const [omschrijving, setOmschrijving] = useState(s?.omschrijving ?? '')
  const [rol, setRol] = useState<StaffRol>(s?.rol ?? 'medewerker')
  const [perms, setPerms] = useState<string[]>(s?.modules ?? [])
  const [bedrijven, setBedrijven] = useState<Bedrijf[]>(s?.bedrijven ?? [])
  const [onboarding, setOnboarding] = useState((s?.onboarding ?? []).join('\n'))
  const [startpagina, setStartpagina] = useState(s?.startpagina ?? '')
  const [actief, setActief] = useState(s?.actief ?? true)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const sleutelUitNaam = (n: string) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 's_$1').slice(0, 40)
  const bewaar = async () => {
    setBezig(true); setFout(null)
    try {
      await json(await fetch('/api/admin/instellingen/rollen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nieuw: !s, key: s?.key ?? (key || sleutelUitNaam(naam)), naam, omschrijving, rol, modules: perms, bedrijven, onboarding: onboarding.split('\n'), startpagina, actief, volgorde: s?.volgorde ?? 99 }) }))
      toast.success('Sjabloon bewaard.'); onKlaar()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel={s ? `Sjabloon · ${s.naam}` : 'Nieuw sjabloon'} onSluit={onSluit} breed>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-2">
          <Veld label="Naam *"><input className={INP} value={naam} onChange={(e) => { setNaam(e.target.value); if (!s) setKey(sleutelUitNaam(e.target.value)) }} /></Veld>
          <Veld label="Rol"><select className={INP} value={rol} onChange={(e) => setRol(e.target.value as StaffRol)}>{STAFF_ROLLEN.map((r) => <option key={r} value={r}>{ROL_LABEL[r as Rol]}</option>)}</select></Veld>
          <Veld label="Korte omschrijving" breed><input className={INP} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} /></Veld>
          <Veld label="Startpagina na inloggen" hint="Een pad in de app, bv. /admin/agenda. Leeg = Command Center."><input className={INP} value={startpagina} onChange={(e) => setStartpagina(e.target.value)} placeholder="/admin" /></Veld>
          <Veld label="Status"><label className="flex items-center gap-2 text-sm h-[38px]"><input type="checkbox" checked={actief} onChange={(e) => setActief(e.target.checked)} />Te kiezen bij een nieuw account</label></Veld>
        </div>
        <div><div className="text-xs font-medium text-gray-600 mb-1">Toegang</div><BedrijfKeuze waarde={bedrijven} onChange={setBedrijven} /></div>
        <div><div className="text-xs font-medium text-gray-600 mb-1">Modules <span className="text-gray-400 font-normal">(geen = alle)</span></div><ModulesKiezer perms={perms} setPerms={setPerms} /></div>
        <Veld label="Onboarding-checklist" hint="Eén stap per regel."><textarea className={INP} rows={8} value={onboarding} onChange={(e) => setOnboarding(e.target.value)} /></Veld>
        {fout && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{fout}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onSluit} className="btn-secondary" disabled={bezig}>Annuleren</button>
          <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
        </div>
      </div>
    </Dialoog>
  )
}

