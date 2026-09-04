'use client'

import { useEffect, useState } from 'react'
import { UserCog, Plus, Loader2, X, Trash2, KeyRound, Power } from 'lucide-react'
import { toast } from 'sonner'
import { ADMIN_MODULES, VISIBLE_ADMIN_MODULES, STAFF_PRESETS } from '@/lib/staff'
import { LoginSettingsCard } from './login-settings-card'

type Staff = { id: string; name: string | null; email: string | null; active: boolean; permissions: string[]; created_at: string; last_login_at: string | null }

const moduleLabel = (k: string) => ADMIN_MODULES.find((m) => m.key === k)?.label ?? k

export default function WerknemersPage() {
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Staff | null>(null)

  const load = async () => {
    try { const r = await fetch('/api/admin/staff', { cache: 'no-store' }); const j = await r.json(); setStaff(j.staff ?? []) }
    catch { /* */ } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const toggleActive = async (s: Staff) => {
    try { const r = await fetch(`/api/admin/staff/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !s.active }) }); if (!r.ok) throw new Error((await r.json()).error); toast.success(s.active ? 'Gedeactiveerd' : 'Geactiveerd'); load() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const del = async (s: Staff) => {
    if (!confirm(`Werknemer ${s.email} verwijderen? Het login-account wordt ook verwijderd.`)) return
    try { const r = await fetch(`/api/admin/staff/${s.id}`, { method: 'DELETE' }); if (!r.ok) throw new Error((await r.json()).error); toast.success('Verwijderd'); load() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><UserCog className="h-6 w-6" />Werknemers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Interne accounts. Bepaal per werknemer welke dashboards/modules zichtbaar zijn.</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary shrink-0"><Plus className="h-4 w-4" />Nieuwe werknemer</button>
      </div>

      {loading ? (
        <div className="card-base text-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : staff.length === 0 ? (
        <div className="card-base text-center py-12 text-gray-400"><UserCog className="h-8 w-8 mx-auto mb-3 opacity-30" /><p className="text-sm">Nog geen werknemers</p></div>
      ) : (
        <div className="space-y-2">
          {staff.map((s) => (
            <div key={s.id} className="card-base flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2">{s.name || s.email}{!s.active && <span className="status-badge bg-red-100 text-red-600">Inactief</span>}</div>
                <div className="text-xs text-gray-400">{s.email}</div>
                <div className="text-[11px] text-gray-500 mt-1">Ziet: {s.permissions.length ? s.permissions.map(moduleLabel).join(', ') : 'geen modules'}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setEditing(s)} className="h-7 px-2 rounded-lg text-xs hover:bg-gray-100 text-gray-600">Bewerk</button>
                <button onClick={() => toggleActive(s)} title={s.active ? 'Deactiveren' : 'Activeren'} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600"><Power className="h-3.5 w-3.5" /></button>
                <button onClick={() => del(s)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Inloggen met of zonder code — geldt ook voor de adminaccounts zelf,
          dus staat dit bewust apart van de werknemerslijst hierboven. */}
      <LoginSettingsCard />

      {(creating || editing) && <Dialog staff={editing} onClose={() => { setCreating(false); setEditing(null) }} onDone={() => { setCreating(false); setEditing(null); load() }} />}
    </div>
  )
}

function Dialog({ staff, onClose, onDone }: { staff: Staff | null; onClose: () => void; onDone: () => void }) {
  const isEdit = !!staff
  const [name, setName] = useState(staff?.name ?? '')
  const [email, setEmail] = useState(staff?.email ?? '')
  const [password, setPassword] = useState('')
  const [perms, setPerms] = useState<string[]>(staff?.permissions ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (k: string) => setPerms((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k])
  const applyPreset = (modules: string[]) => setPerms(modules)

  const submit = async () => {
    if (!email.trim()) { setError('E-mail is verplicht'); return }
    if (!isEdit && password.length < 8) { setError('Wachtwoord van minstens 8 tekens vereist'); return }
    if (isEdit && password && password.length < 8) { setError('Wachtwoord moet minstens 8 tekens zijn'); return }
    setSaving(true); setError(null)
    try {
      const body = { name: name || null, email, permissions: perms, ...(password ? { password } : {}) }
      const url = isEdit ? `/api/admin/staff/${staff!.id}` : '/api/admin/staff'
      const r = await fetch(url, { method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error((await r.json()).error)
      toast.success(isEdit ? 'Opgeslagen' : 'Werknemer aangemaakt'); onDone()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setSaving(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">{isEdit ? 'Werknemer bewerken' : 'Nieuwe werknemer'}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Naam</label><input className={inp} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">E-mail *</label><input type="email" className={inp} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          </div>
          {/* Het adres is ook de login. Dat hoort erbij te staan, want anders
              wijzig je het en verandert er ongemerkt meer dan je dacht. */}
          {isEdit && email.trim().toLowerCase() !== (staff?.email ?? '').toLowerCase() && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Dit adres is ook waarmee deze werknemer inlogt. Na het opslaan werkt <b>{staff?.email}</b> niet
              meer om aan te melden; dat wordt <b>{email.trim()}</b>. Het wachtwoord en de rechten blijven zoals ze zijn.
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><KeyRound className="h-3 w-3 inline mr-1" />{isEdit ? 'Nieuw wachtwoord (optioneel)' : 'Wachtwoord *'}</label>
            <input type="text" className={inp} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isEdit ? 'Laat leeg om niet te wijzigen' : 'Min. 8 tekens'} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Snelkeuze</label>
            <div className="flex flex-wrap gap-1.5">
              {STAFF_PRESETS.map((p) => <button key={p.key} type="button" onClick={() => applyPreset(p.modules)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">{p.label}</button>)}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Zichtbare modules / dashboards</label>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {VISIBLE_ADMIN_MODULES.map((m) => (
                <label key={m.key} className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={perms.includes(m.key)} onChange={() => toggle(m.key)} />{m.label}</label>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Het Command Center is altijd zichtbaar. Werknemersbeheer blijft admin-only.</p>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={saving} className="btn-primary flex-1 justify-center">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{isEdit ? 'Opslaan' : 'Aanmaken'}</button>
            <button onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </div>
      </div>
    </div>
  )
}
