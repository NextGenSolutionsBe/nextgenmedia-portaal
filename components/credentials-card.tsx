'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Eye, EyeOff, Loader2, Check, Copy, Mail } from 'lucide-react'

/**
 * Admin-only login credentials card for a client or partner.
 * Lets the admin view/change the login email and set/reset + reveal the
 * password (only passwords the admin has set are stored & viewable).
 */
export function CredentialsCard({
  endpoint,
  email,
}: {
  endpoint: string            // e.g. /api/admin/clients/<id>/credentials
  email: string | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  // Enkel om het NIEUW ingetypte wachtwoord zichtbaar te maken tijdens invoeren.
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'email' | 'pw' | null>(null)

  const [form, setForm] = useState({ email: email ?? '', password: '' })

  const copy = (text: string, what: 'email' | 'pw') => {
    navigator.clipboard.writeText(text)
    setCopied(what)
    setTimeout(() => setCopied(null), 1500)
  }

  const save = async () => {
    setError(null)
    const payload: { email?: string; password?: string } = {}
    if (form.email.trim() && form.email.trim() !== email) payload.email = form.email.trim()
    if (form.password) payload.password = form.password
    if (!payload.email && !payload.password) { setEditing(false); return }
    if (payload.password && payload.password.length < 8) { setError('Wachtwoord moet minstens 8 tekens zijn'); return }

    setLoading(true)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setForm((p) => ({ ...p, password: '' }))
      setEditing(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="card-base space-y-3">
      <h2 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-gray-400" />
        Login-gegevens
      </h2>

      {!editing ? (
        <div className="space-y-3">
          {/* Email */}
          <div>
            <div className="text-xs text-gray-500 mb-1">E-mailadres</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 truncate">
                {email || '—'}
              </code>
              {email && (
                <button onClick={() => copy(email, 'email')} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Kopiëren">
                  {copied === 'email' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          </div>

          {/* Wachtwoord — bewust NIET opvraagbaar. Wachtwoorden worden alleen
              gehasht bewaard door Supabase Auth; een leesbare kopie zou bij een
              datalek alle klantwachtwoorden prijsgeven. Wel: opnieuw instellen. */}
          <div>
            <div className="text-xs text-gray-500 mb-1">Wachtwoord</div>
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
              Wachtwoorden worden versleuteld bewaard en zijn niet op te vragen — ook niet door ons.
              Kwijt? Stel hieronder een nieuw wachtwoord in en geef dat door.
            </p>
          </div>

          <button onClick={() => { setEditing(true); setForm({ email: email ?? '', password: '' }) }} className="btn-secondary w-full text-sm">
            <Mail className="h-3.5 w-3.5" />
            E-mail / wachtwoord aanpassen
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className={lbl}>E-mailadres</label>
            <input type="email" className={inp} value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Nieuw wachtwoord</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                className={inp}
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                placeholder="Laat leeg om niet te wijzigen"
                minLength={8}
              />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded text-gray-400 hover:text-gray-700">
                {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Min. 8 tekens. Noteer het nu — het is later niet meer op te vragen.</p>
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex gap-2">
            <button onClick={save} disabled={loading} className="btn-primary flex-1 justify-center text-sm">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Opslaan
            </button>
            <button onClick={() => { setEditing(false); setError(null) }} className="btn-secondary text-sm">Annuleer</button>
          </div>
        </div>
      )}
    </div>
  )
}
