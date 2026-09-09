'use client'

import { useEffect, useState } from 'react'
import { Users, Plus, Loader2, X, Trash2, KeyRound, Mail, Power, Crown, Eye } from 'lucide-react'
import { toast } from 'sonner'
import {
  PORTAL_MODULES, MODULE_ACTIONS, MODULE_LABELS, MODULE_IMPLEMENTED, ACTION_LABELS, PRESETS,
  presetPermissions, permissionSummary, type Permissions, type PresetKey, type PortalModule,
} from '@/lib/portal-permissions'

type CU = {
  id: string; name: string | null; email: string | null; phone: string | null
  role_label: string | null; active: boolean; permissions: Permissions
  created_at: string; last_login_at: string | null
}

export function ClientUsers({ clientId, clientName, ownerEmail }: { clientId: string; clientName: string; ownerEmail?: string | null }) {
  const [users, setUsers] = useState<CU[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<CU | null>(null)

  const load = async () => {
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/users`, { cache: 'no-store' })
      const j = await res.json()
      setUsers(j.users ?? [])
    } catch { /* stil */ } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const toggleActive = async (u: CU) => {
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/users/${u.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !u.active }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success(u.active ? 'Gedeactiveerd' : 'Geactiveerd')
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  const del = async (u: CU) => {
    if (!confirm(`Subaccount ${u.email} verwijderen? Het login-account wordt ook verwijderd.`)) return
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/users/${u.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Subaccount verwijderd')
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  return (
    <div className="card-base space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-400" />
          Gebruikers & rechten
        </h2>
        <button onClick={() => setCreateOpen(true)} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Gebruiker</button>
      </div>

      {/* Hoofdaccount — altijd volledige toegang, niet bewerkbaar als subaccount */}
      <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-[#fff848] bg-[#fff848]/10">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            <Crown className="h-3.5 w-3.5 text-[#caa800]" />
            Hoofdaccount
            <span className="status-badge bg-[#fff848]/60 text-[#7a6a00]">Eigenaar</span>
          </div>
          <div className="text-xs text-gray-500 truncate">{ownerEmail || '—'}</div>
          <div className="text-[11px] text-gray-500 flex items-center gap-1"><Eye className="h-3 w-3" />Ziet: alle modules</div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-4 text-gray-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
      ) : users.length === 0 ? (
        <p className="text-sm text-gray-400">Nog geen extra gebruikers. Voeg een subaccount toe om rechten per persoon te beheren.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-gray-100">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {u.name || u.email}
                  <span className="status-badge bg-gray-100 text-gray-600">Subaccount</span>
                  {!u.active && <span className="status-badge bg-red-100 text-red-600">Inactief</span>}
                </div>
                <div className="text-xs text-gray-400 truncate">{u.email} · {u.role_label || '—'}</div>
                <div className="text-[11px] text-gray-500 truncate flex items-center gap-1"><Eye className="h-3 w-3 shrink-0" />Ziet: {permissionSummary(u.permissions)}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setEditing(u)} className="h-7 px-2 rounded-lg text-xs hover:bg-gray-100 text-gray-600">Bewerk</button>
                <button onClick={() => toggleActive(u)} title={u.active ? 'Deactiveren' : 'Activeren'} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-600"><Power className="h-3.5 w-3.5" /></button>
                <button onClick={() => del(u)} title="Verwijderen" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && <UserDialog clientId={clientId} clientName={clientName} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); load() }} />}
      {editing && <UserDialog clientId={clientId} clientName={clientName} user={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />}
    </div>
  )
}

function UserDialog({
  clientId, clientName, user, onClose, onDone,
}: { clientId: string; clientName: string; user?: CU; onClose: () => void; onDone: () => void }) {
  const isEdit = !!user
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [password, setPassword] = useState('')
  const [roleLabel, setRoleLabel] = useState<string>(user?.role_label ?? 'Eigenaar')
  const [perms, setPerms] = useState<Permissions>(user?.permissions ?? presetPermissions('eigenaar'))
  const [sendMail, setSendMail] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyPreset = (key: PresetKey) => {
    const p = PRESETS.find((x) => x.key === key)
    setPerms(presetPermissions(key))
    if (p) setRoleLabel(p.label)
  }

  const toggle = (m: PortalModule, a: string) => setPerms((p) => {
    const mod = { ...(p[m] ?? {}) }
    if (mod[a]) delete mod[a]; else mod[a] = true
    return { ...p, [m]: mod }
  })

  const submit = async () => {
    if (!email.trim()) { setError('E-mail is verplicht'); return }
    if (!isEdit && password.length < 8) { setError('Wachtwoord van minstens 8 tekens vereist'); return }
    if (isEdit && password && password.length < 8) { setError('Wachtwoord moet minstens 8 tekens zijn'); return }
    setSaving(true); setError(null)
    try {
      const body = {
        name: name || null, email, phone: phone || null, role_label: roleLabel,
        permissions: perms, ...(password ? { password } : {}),
      }
      const url = isEdit ? `/api/admin/clients/${clientId}/users/${user!.id}` : `/api/admin/clients/${clientId}/users`
      const res = await fetch(url, { method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)

      // Optioneel: handmatige toegangsmail (geen automail).
      if (!isEdit && sendMail) {
        const loginLink = `${window.location.origin}/login`
        const bodyText = `Beste ${name || email},\n\nJe hebt toegang gekregen tot het NextGenMedia klantenportaal van ${clientName}.\n\nLogin: ${email}\nTijdelijk wachtwoord: ${password}\n\nLog in via de knop hieronder en wijzig daarna je wachtwoord.\n\nMet vriendelijke groet,\nNextGenMedia`
        await fetch('/api/admin/email/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_email: email, to_client_id: clientId, subject: 'Toegang tot NextGenMedia portaal', body: bodyText, cta_text: 'Inloggen', cta_link: loginLink, kind: 'generic' }),
        }).catch(() => {})
      }
      toast.success(isEdit ? 'Opgeslagen' : 'Subaccount aangemaakt')
      onDone()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setSaving(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">{isEdit ? 'Gebruiker bewerken' : 'Nieuwe gebruiker'}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Naam</label><input className={inp} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className={lbl}>Rol/preset-naam</label><input className={inp} value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>E-mail *</label><input type="email" className={inp} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label className={lbl}>Telefoon</label><input className={inp} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          </div>
          <div>
            <label className={lbl}><KeyRound className="h-3 w-3 inline mr-1" />{isEdit ? 'Nieuw wachtwoord (optioneel)' : 'Wachtwoord *'}</label>
            <input type="text" className={inp} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isEdit ? 'Laat leeg om niet te wijzigen' : 'Min. 8 tekens'} />
          </div>

          <div>
            <label className={lbl}>Preset</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.key} onClick={() => applyPreset(p.key)} title={p.description} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">{p.label}</button>
              ))}
            </div>
          </div>

          {/* Rechtenmatrix */}
          <div className="border border-gray-100 rounded-xl p-3 space-y-2">
            <div className="text-xs font-medium text-gray-600">Rechten (handmatig aanpasbaar)</div>
            {PORTAL_MODULES.map((m) => {
              const live = MODULE_IMPLEMENTED[m]
              return (
                <div key={m} className={live ? '' : 'opacity-50'}>
                  <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    {MODULE_LABELS[m]}
                    {!live && <span className="status-badge bg-gray-100 text-gray-400 text-[9px]">Binnenkort</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                    {MODULE_ACTIONS[m].map((a) => (
                      <label key={a} className={`flex items-center gap-1 text-[11px] ${live ? 'text-gray-600' : 'text-gray-400 cursor-not-allowed'}`}>
                        <input type="checkbox" disabled={!live} checked={perms[m]?.[a] === true} onChange={() => toggle(m, a)} />
                        {ACTION_LABELS[a] ?? a}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {!isEdit && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={sendMail} onChange={(e) => setSendMail(e.target.checked)} />
              <Mail className="h-3.5 w-3.5 text-gray-400" /> Verstuur toegangsmail (met login + wachtwoord)
            </label>
          )}

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
