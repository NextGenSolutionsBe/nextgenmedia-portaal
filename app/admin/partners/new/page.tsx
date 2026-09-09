'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Loader2 } from 'lucide-react'

const ROLES = [
  { slug: 'photographer', label: 'Fotograaf' },
  { slug: 'videographer', label: 'Videograaf' },
  { slug: 'editor', label: 'Editor' },
  { slug: 'designer', label: 'Designer' },
  { slug: 'copywriter', label: 'Copywriter' },
  { slug: 'developer', label: 'Developer' },
  { slug: 'strategist', label: 'Strateeg' },
  { slug: 'other', label: 'Overig' },
]

export default function NewPartnerPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const [form, setForm] = useState({
    full_name: '',
    company_name: '',
    email: '',
    password: '',
    phone: '',
    vat_number: '',
    iban: '',
    roles: [] as string[],
    hourly_rate: '',
    region: '',
    bio: '',
    notes: '',
  })

  const toggleRole = (slug: string) => {
    setForm((p) => ({
      ...p,
      roles: p.roles.includes(slug) ? p.roles.filter((r) => r !== slug) : [...p.roles, slug],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.roles.length === 0) { setError('Selecteer minstens één rol'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
          default_commission_pct: 10, // auto-calculated from tenure; year 1 = 10%
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      if (json.inviteLink) {
        setInviteLink(json.inviteLink)
      } else {
        // Hard redirect — guarantees the partners list shows the new partner
        window.location.href = '/admin/partners'
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'input-base'
  const lbl = 'block text-sm font-medium text-gray-700 mb-1'

  if (inviteLink) {
    return (
      <div className="max-w-lg text-center space-y-4 animate-fade-in py-12">
        <div className="h-14 w-14 mx-auto rounded-full bg-green-100 flex items-center justify-center">
          <span className="text-2xl">✓</span>
        </div>
        <h2 className="text-xl font-bold">Partner aangemaakt</h2>
        <p className="text-sm text-gray-500">Kopieer de uitnodigingslink en stuur die naar de partner:</p>
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm break-all text-left">
          {inviteLink}
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => navigator.clipboard.writeText(inviteLink)}
            className="btn-secondary"
          >
            Kopiëren
          </button>
          <Link href="/admin/partners" className="btn-primary">Naar partners</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/admin/partners" className="btn-secondary px-2">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Partner toevoegen</h1>
          <p className="text-sm text-gray-500">Maak een partneraccount aan</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card-base space-y-4">
          <h2 className="font-semibold">Persoonsgegevens</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Volledige naam *</label>
              <input required className={inp} value={form.full_name} onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Bedrijfsnaam</label>
              <input className={inp} value={form.company_name} onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>E-mail *</label>
              <input required type="email" className={inp} value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Telefoon</label>
              <input className={inp} value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>BTW-nummer</label>
              <input className={inp} value={form.vat_number} onChange={(e) => setForm((p) => ({ ...p, vat_number: e.target.value }))} placeholder="BE0000000000" />
            </div>
            <div>
              <label className={lbl}>IBAN</label>
              <input className={inp} value={form.iban} onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value }))} placeholder="BE00 0000 0000 0000" />
            </div>
            <div>
              <label className={lbl}>Regio</label>
              <input className={inp} value={form.region} onChange={(e) => setForm((p) => ({ ...p, region: e.target.value }))} placeholder="Brussel, Antwerpen, ..." />
            </div>
            <div>
              <label className={lbl}>Wachtwoord (optioneel)</label>
              <input type="password" minLength={8} className={inp} value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder="Leeg = uitnodigingslink" />
            </div>
          </div>
        </div>

        <div className="card-base space-y-4">
          <h2 className="font-semibold">Expertise & tarieven</h2>
          <div>
            <label className={lbl}>Rollen / expertise *</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
              {ROLES.map((r) => (
                <button
                  key={r.slug}
                  type="button"
                  onClick={() => toggleRole(r.slug)}
                  className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                    form.roles.includes(r.slug)
                      ? 'border-[#fff848] bg-[#fff848]/10 text-black'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Uurtarief (€)</label>
              <input type="number" min="0" className={inp} value={form.hourly_rate} onChange={(e) => setForm((p) => ({ ...p, hourly_rate: e.target.value }))} placeholder="75" />
            </div>
            <div>
              <label className={lbl}>Commissietrap (automatisch)</label>
              <div className="flex gap-1.5 mt-1">
                {[{ label: 'Jaar 1', pct: 10 }, { label: 'Jaar 2', pct: 8 }, { label: 'Jaar 3+', pct: 5 }].map((t) => (
                  <div key={t.label} className="flex-1 text-center py-2 rounded-lg border border-gray-200 text-xs text-gray-400">
                    <div className="font-bold text-gray-600">{t.pct}%</div>
                    <div>{t.label}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">Automatisch berekend op basis van partnerduur</p>
            </div>
          </div>
        </div>

        <div className="card-base space-y-4">
          <h2 className="font-semibold">Bijkomende info</h2>
          <div>
            <label className={lbl}>Bio</label>
            <textarea rows={3} className={inp} value={form.bio} onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))} placeholder="Kort profiel..." />
          </div>
          <div>
            <label className={lbl}>Interne notities</label>
            <textarea rows={2} className={inp} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Partner aanmaken
          </button>
          <Link href="/admin/partners" className="btn-secondary">Annuleren</Link>
        </div>
      </form>
    </div>
  )
}
