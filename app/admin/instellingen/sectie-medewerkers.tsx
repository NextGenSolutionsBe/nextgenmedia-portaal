'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, Loader2, Power, Archive, RotateCcw, Mail, Pencil, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react'
import { VISIBLE_ADMIN_MODULES, STAFF_PRESETS, ADMIN_MODULES } from '@/lib/staff'
import { STAFF_ROLLEN, ROL_LABEL, ROLLEN, type Rol } from '@/lib/instellingen/model'
import { volledigeNaam, type Medewerker } from '@/lib/instellingen/medewerkers'
import { LoginSettingsCard } from '@/app/admin/werknemers/login-settings-card'
import { Kop, Badge, Bevestig, Dialoog, INP, Laden, datumTijd, Veld } from './ui'

const moduleLabel = (k: string) => ADMIN_MODULES.find((m) => m.key === k)?.label ?? k
const API = '/api/admin/instellingen/medewerkers'

type Vraag =
  | { soort: 'deactiveer' | 'activeer' | 'archiveer' | 'herstel' | 'uitnodiging'; m: Medewerker }

/**
 * Medewerkers: overzicht + beheer. Zelfstandig (haalt eigen data op), zodat
 * hetzelfde scherm ook onder /admin/werknemers kan staan — één plek, één bron.
 */
export function SectieMedewerkers({ isAdmin }: { isAdmin: boolean }) {
  const [rijen, setRijen] = useState<Medewerker[] | null>(null)
  const [ik, setIk] = useState<string | null>(null)
  const [toonArchief, setToonArchief] = useState(false)
  const [nieuw, setNieuw] = useState(false)
  const [bewerk, setBewerk] = useState<Medewerker | null>(null)
  const [vraag, setVraag] = useState<Vraag | null>(null)
  const [bezig, setBezig] = useState(false)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(API, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setRijen(j.medewerkers ?? []); setIk(j.ik ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setRijen([]) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const voerUit = async () => {
    if (!vraag) return
    setBezig(true)
    const { soort, m } = vraag
    try {
      let r: Response
      if (soort === 'deactiveer' || soort === 'activeer') r = await fetch(`${API}/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actief: soort === 'activeer' }) })
      else if (soort === 'archiveer') r = await fetch(`${API}/${m.id}`, { method: 'DELETE' })
      else if (soort === 'herstel') r = await fetch(`${API}/${m.id}`, { method: 'POST' })
      else r = await fetch(`${API}/${m.id}/uitnodiging`, { method: 'POST' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Mislukt')
      toast.success({ deactiveer: 'Account gedeactiveerd. Inloggen is niet meer mogelijk.', activeer: 'Account weer actief.', archiveer: 'De medewerker werd gearchiveerd. Niets is definitief verwijderd.', herstel: 'Medewerker hersteld.', uitnodiging: `Uitnodiging verstuurd naar ${m.email}.` }[soort])
      setVraag(null); laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }

  if (!rijen) return <Laden />
  const zichtbaar = rijen.filter((m) => toonArchief || !m.gearchiveerd)
  const actieveHoofd = rijen.filter((m) => m.isAdmin && m.actief).length
  const archief = rijen.filter((m) => m.gearchiveerd).length

  return (
    <div className="space-y-4">
      <div className="card-base">
        <Kop titel="Medewerkers" tekst="Interne accounts: hoofdbeheerders en werknemers, hun rol, functie en modules. Verwijderen archiveert; er wordt nooit iets definitief gewist. Een uitnodigingsmail vertrekt enkel als je dat uitdrukkelijk bevestigt."
          rechts={isAdmin ? <button type="button" onClick={() => setNieuw(true)} className="btn-primary"><Plus className="h-4 w-4" />Nieuwe medewerker</button> : undefined} />
        <div className="flex items-center gap-3 mb-3 text-xs text-gray-500 flex-wrap">
          <span>{rijen.filter((m) => !m.gearchiveerd).length} accounts · {actieveHoofd} actieve hoofdbeheerder{actieveHoofd === 1 ? '' : 's'}</span>
          {archief > 0 && <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={toonArchief} onChange={(e) => setToonArchief(e.target.checked)} />Toon gearchiveerde ({archief})</label>}
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide">
              <th className="px-2 py-2 font-medium">Naam</th><th className="px-2 py-2 font-medium">Functie</th><th className="px-2 py-2 font-medium">Rol</th><th className="px-2 py-2 font-medium">Modules</th><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">Laatste login</th><th className="px-2 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {zichtbaar.map((m) => {
                const zelf = !!ik && m.authUserId === ik
                return (
                  <tr key={m.id} className={m.gearchiveerd ? 'opacity-60' : ''}>
                    <td className="px-2 py-2.5">
                      <div className="font-medium flex items-center gap-1.5">{volledigeNaam(m)}{zelf && <Badge kleur="blauw">jij</Badge>}</div>
                      <div className="text-[11px] text-gray-400">{m.email}</div>
                    </td>
                    <td className="px-2 py-2.5 text-gray-700">{m.functie ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-2 py-2.5"><Badge kleur={m.rol === 'hoofdbeheerder' ? 'amber' : m.rol === 'beheerder' ? 'blauw' : 'grijs'}>{ROL_LABEL[m.rol]}</Badge></td>
                    <td className="px-2 py-2.5 text-[11px] text-gray-600 max-w-[220px]">{m.permissions === null ? 'Alle modules' : m.permissions.length ? m.permissions.map(moduleLabel).join(', ') : <span className="text-amber-700">geen modules</span>}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1 flex-wrap">
                        {m.gearchiveerd ? <Badge kleur="grijs">Gearchiveerd</Badge> : m.actief ? <Badge kleur="groen">Actief</Badge> : <Badge kleur="rood">Inactief</Badge>}
                        <span title={m.tweeFactor ? 'Inloggen met code' : 'Inloggen zonder code'}>{m.tweeFactor ? <ShieldCheck className="h-3.5 w-3.5 text-green-600" /> : <ShieldOff className="h-3.5 w-3.5 text-amber-600" />}</span>
                      </div>
                      {m.uitnodigingOp && <div className="text-[10px] text-gray-400 mt-0.5">uitgenodigd {datumTijd(m.uitnodigingOp)}</div>}
                    </td>
                    <td className="px-2 py-2.5 text-xs text-gray-500 whitespace-nowrap">{m.laatsteLogin ? datumTijd(m.laatsteLogin) : 'nog nooit'}</td>
                    <td className="px-2 py-2.5">
                      {isAdmin && (
                        <div className="flex items-center justify-end gap-0.5">
                          <Knop titel="Bewerken" onClick={() => setBewerk(m)}><Pencil className="h-3.5 w-3.5" /></Knop>
                          {!m.gearchiveerd && !zelf && <Knop titel={m.actief ? 'Deactiveren' : 'Activeren'} onClick={() => setVraag({ soort: m.actief ? 'deactiveer' : 'activeer', m })}><Power className={`h-3.5 w-3.5 ${m.actief ? '' : 'text-green-600'}`} /></Knop>}
                          {!m.isAdmin && !m.gearchiveerd && m.email && <Knop titel="Uitnodiging versturen" onClick={() => setVraag({ soort: 'uitnodiging', m })}><Mail className="h-3.5 w-3.5" /></Knop>}
                          {!m.isAdmin && !m.gearchiveerd && !zelf && <Knop titel="Verwijderen (archiveren)" rood onClick={() => setVraag({ soort: 'archiveer', m })}><Archive className="h-3.5 w-3.5" /></Knop>}
                          {m.gearchiveerd && <Knop titel="Herstellen" onClick={() => setVraag({ soort: 'herstel', m })}><RotateCcw className="h-3.5 w-3.5" /></Knop>}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-500 mt-3">Rollen: {ROLLEN.map((r) => `${r.label} — ${r.uitleg}`).join(' · ')}</p>
      </div>

      {/* Inlogcode per account (bestaand onderdeel, hier op zijn plaats). */}
      {isAdmin && <LoginSettingsCard />}

      {(nieuw || bewerk) && <Formulier m={bewerk} onSluit={() => { setNieuw(false); setBewerk(null) }} onKlaar={() => { setNieuw(false); setBewerk(null); laad() }} />}

      {vraag && (
        <Bevestig bezig={bezig} onAnnuleer={() => setVraag(null)} onBevestig={voerUit}
          gevaarlijk={vraag.soort === 'deactiveer' || vraag.soort === 'archiveer'}
          titel={{ deactiveer: 'Account deactiveren', activeer: 'Account activeren', archiveer: 'Medewerker verwijderen', herstel: 'Medewerker herstellen', uitnodiging: 'Uitnodiging versturen' }[vraag.soort]}
          bevestigLabel={{ deactiveer: 'Deactiveren', activeer: 'Activeren', archiveer: 'Verwijderen (archiveren)', herstel: 'Herstellen', uitnodiging: 'Ja, verstuur de uitnodiging' }[vraag.soort]}
          tekst={{
            deactiveer: <><b>{volledigeNaam(vraag.m)}</b> kan daarna niet meer inloggen. Gegevens, rechten en geschiedenis blijven bewaard; je kunt het account later opnieuw activeren.</>,
            activeer: <><b>{volledigeNaam(vraag.m)}</b> kan daarna weer inloggen met de bestaande rechten.</>,
            archiveer: <><b>{volledigeNaam(vraag.m)}</b> wordt gearchiveerd: het account kan niet meer inloggen en verdwijnt uit de lijst. Er wordt niets definitief verwijderd; herstellen kan altijd via "Toon gearchiveerde".</>,
            herstel: <><b>{volledigeNaam(vraag.m)}</b> komt terug in de lijst en kan weer inloggen met de vroegere rechten.</>,
            uitnodiging: <>Er vertrekt nu een e-mail naar <b>{vraag.m.email}</b> met een link om een wachtwoord te kiezen en in te loggen. Dit gebeurt alleen als je hier bevestigt.</>,
          }[vraag.soort]} />
      )}
    </div>
  )
}

function Knop({ titel, onClick, children, rood }: { titel: string; onClick: () => void; children: ReactNode; rood?: boolean }) {
  return <button type="button" title={titel} aria-label={titel} onClick={onClick} className={`h-7 w-7 flex items-center justify-center rounded-lg ${rood ? 'hover:bg-red-50 text-red-500' : 'hover:bg-gray-100 text-gray-600'}`}>{children}</button>
}

function Formulier({ m, onSluit, onKlaar }: { m: Medewerker | null; onSluit: () => void; onKlaar: () => void }) {
  const isEdit = !!m
  const admin = !!m?.isAdmin
  const [voornaam, setVoornaam] = useState(m?.voornaam ?? '')
  const [achternaam, setAchternaam] = useState(m?.achternaam ?? '')
  const [email, setEmail] = useState(m?.email ?? '')
  const [functie, setFunctie] = useState(m?.functie ?? '')
  const [rol, setRol] = useState<Rol>(m && m.rol !== 'hoofdbeheerder' ? m.rol : 'medewerker')
  const [password, setPassword] = useState('')
  const [perms, setPerms] = useState<string[]>(m?.permissions ?? [])
  const [saving, setSaving] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const toggle = (k: string) => setPerms((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))

  const submit = async () => {
    setFout(null)
    if (!voornaam.trim()) { setFout('Voornaam is verplicht.'); return }
    if (!admin && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setFout('Vul een geldig e-mailadres in.'); return }
    if (password && password.length < 8) { setFout('Een wachtwoord telt minstens 8 tekens.'); return }
    setSaving(true)
    try {
      const body = admin ? { voornaam, achternaam } : { voornaam, achternaam, email: email.trim(), functie, rol, permissions: perms, ...(password ? { password } : {}) }
      const r = await fetch(isEdit ? `${API}/${m!.id}` : API, { method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Mislukt')
      toast.success(isEdit ? 'Medewerker bijgewerkt.' : j.uitnodigingNodig ? 'Medewerker aangemaakt. Verstuur een uitnodiging zodra je wilt dat hij of zij kan inloggen.' : 'Medewerker aangemaakt.')
      onKlaar()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Mislukt') } finally { setSaving(false) }
  }

  return (
    <Dialoog titel={isEdit ? `${admin ? 'Hoofdbeheerder' : 'Medewerker'} bewerken` : 'Nieuwe medewerker'} onSluit={onSluit} breed>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-2">
          <Veld label="Voornaam *"><input className={INP} value={voornaam} onChange={(e) => setVoornaam(e.target.value)} /></Veld>
          <Veld label="Achternaam"><input className={INP} value={achternaam} onChange={(e) => setAchternaam(e.target.value)} /></Veld>
          {!admin && <>
            <Veld label="E-mailadres (login) *"><input type="email" className={INP} value={email} onChange={(e) => setEmail(e.target.value)} /></Veld>
            <Veld label="Functie"><input className={INP} value={functie} onChange={(e) => setFunctie(e.target.value)} placeholder="bv. Contentmarketeer" /></Veld>
            <Veld label="Rol" hint={ROLLEN.find((r) => r.key === rol)?.uitleg}>
              <select className={INP} value={rol} onChange={(e) => setRol(e.target.value as Rol)}>{STAFF_ROLLEN.map((r) => <option key={r} value={r}>{ROL_LABEL[r]}</option>)}</select>
            </Veld>
            <Veld label={<span><KeyRound className="h-3 w-3 inline mr-1" />{isEdit ? 'Nieuw wachtwoord (optioneel)' : 'Wachtwoord (optioneel)'}</span>}
              hint={isEdit ? 'Laat leeg om niet te wijzigen.' : 'Laat leeg en verstuur daarna een uitnodiging: dan kiest de medewerker zelf een wachtwoord.'}>
              <input type="text" autoComplete="off" className={INP} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 tekens" />
            </Veld>
          </>}
        </div>
        {isEdit && !admin && email.trim().toLowerCase() !== (m?.email ?? '').toLowerCase() && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Dit adres is ook de login. Na het opslaan werkt <b>{m?.email}</b> niet meer om aan te melden; dat wordt <b>{email.trim()}</b>.</div>
        )}
        {!admin && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-600">Zichtbare modules</label>
              <div className="flex flex-wrap gap-1">{STAFF_PRESETS.map((p) => <button key={p.key} type="button" onClick={() => setPerms(p.modules)} className="text-[11px] px-2 py-0.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50">{p.label}</button>)}</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5 rounded-xl border border-gray-100 p-3">
              {VISIBLE_ADMIN_MODULES.map((mod) => <label key={mod.key} className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={perms.includes(mod.key)} onChange={() => toggle(mod.key)} />{mod.label}</label>)}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Wat iemand binnen een module mag (toevoegen, aanpassen, …) volgt uit de rol: zie Gebruikersrechten. Het Command Center is altijd zichtbaar.</p>
          </div>
        )}
        {admin && <p className="text-xs text-gray-500">Een hoofdbeheerder heeft altijd alle modules en rechten. E-mailadres en wachtwoord van een hoofdbeheerder wijzig je via het eigen account.</p>}
        {fout && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{fout}</div>}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onSluit} className="btn-secondary" disabled={saving}>Annuleren</button>
          <button type="button" onClick={submit} disabled={saving} className="btn-primary">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{isEdit ? 'Wijzigingen opslaan' : 'Aanmaken'}</button>
        </div>
      </div>
    </Dialoog>
  )
}
