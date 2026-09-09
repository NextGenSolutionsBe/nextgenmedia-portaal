'use client'

import { useState } from 'react'
import { ChevronLeft, Loader2, X } from 'lucide-react'
import Link from 'next/link'

const SERVICES = [
  { slug: 'social-media',           label: 'Social Media Management' },
  { slug: 'webdesign',              label: 'Website' },
  { slug: 'foto-video',             label: 'Foto & Videografie' },
  { slug: 'grafisch-ontwerp',       label: 'Grafisch Ontwerp' },
  { slug: 'marketing-consultancy',  label: 'Marketing Consultancy' },
  { slug: 'ads',                    label: 'Google Advertising' },
]

const PLATFORMS = [
  { slug: 'meta',      label: 'Meta (Facebook/Instagram)' },
  { slug: 'linkedin',  label: 'LinkedIn' },
  { slug: 'tiktok',    label: 'TikTok' },
  { slug: 'pinterest', label: 'Pinterest' },
  { slug: 'twitter',   label: 'Twitter/X' },
]

const DURATION_PRESETS = [1, 3, 6, 12, 18, 24, 36]

type ServiceCfg = { start_month: string; contract_months: number }

const now = new Date()
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

export default function NewClientPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    password: '',
    niche: '',
    website_url: '',
    btw_nummer: '',
    services: [] as string[],
    platforms: [] as string[],
    posts_per_month: '0',
    reels_per_month: '0',
    stories_per_month: '0',
    webdesign_maintenance_included: false,
    maintenance_start_date: '',
    maintenance_months: '12',
    website_platform: '',
    website_admin_url: '',
    framer_project_url: '',
    framer_api_key: '',
    cms_enabled: false,
    ads_budget: '',
  })

  const [serviceConfig, setServiceConfig] = useState<Record<string, ServiceCfg>>({})

  const getServiceCfg = (slug: string): ServiceCfg =>
    serviceConfig[slug] ?? { start_month: thisMonth, contract_months: 12 }

  const updateServiceCfg = (slug: string, patch: Partial<ServiceCfg>) =>
    setServiceConfig(prev => ({
      ...prev,
      [slug]: { ...getServiceCfg(slug), ...patch },
    }))

  const toggleService = (slug: string) => {
    const isSelected = form.services.includes(slug)
    setForm(p => ({
      ...p,
      services: isSelected
        ? p.services.filter(s => s !== slug)
        : [...p.services, slug],
    }))
    if (!isSelected) {
      setServiceConfig(prev => ({
        ...prev,
        [slug]: prev[slug] ?? { start_month: thisMonth, contract_months: 12 },
      }))
    }
  }

  const togglePlatform = (slug: string) =>
    setForm(p => ({
      ...p,
      platforms: p.platforms.includes(slug)
        ? p.platforms.filter(s => s !== slug)
        : [...p.platforms, slug],
    }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.services.length === 0) { setError('Selecteer minstens één dienst'); return }
    setLoading(true)
    setError(null)
    try {
      const service_configs: Record<string, ServiceCfg> = {}
      for (const slug of form.services) service_configs[slug] = getServiceCfg(slug)

      const res = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: form.company_name,
          contact_name: form.contact_name,
          email: form.email,
          password: form.password,
          niche: form.niche,
          website_url: form.website_url,
          btw_nummer: form.btw_nummer,
          services: form.services,
          platforms: form.platforms,
          posts_per_month: parseInt(form.posts_per_month) || 0,
          reels_per_month: parseInt(form.reels_per_month) || 0,
          stories_per_month: parseInt(form.stories_per_month) || 0,
          webdesign_maintenance_included: form.webdesign_maintenance_included,
          maintenance_start_date: form.maintenance_start_date,
          maintenance_months: parseInt(form.maintenance_months) || 12,
          website_platform: form.website_platform === '' ? null : form.website_platform,
          website_admin_url: form.website_admin_url,
          framer_project_url: form.framer_project_url,
          framer_api_key: form.framer_api_key,
          cms_enabled: form.cms_enabled,
          ads_budget: form.ads_budget ? parseFloat(form.ads_budget) : null,
          service_configs,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Mislukt')
      // Hard redirect — bypasses Router Cache so the clients list always shows the new client
      window.location.href = `/admin/clients/${json.clientId}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'input-base'
  const lbl = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/admin/clients" className="btn-secondary px-2">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Klant toevoegen</h1>
          <p className="text-sm text-gray-500">Maak een nieuw klantenaccount aan</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Bedrijfsgegevens */}
        <div className="card-base space-y-4">
          <h2 className="font-semibold text-gray-900">Bedrijfsgegevens</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Bedrijfsnaam *</label>
              <input required className={inp} value={form.company_name}
                onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))} placeholder="Bedrijf NV" />
            </div>
            <div>
              <label className={lbl}>Contactpersoon</label>
              <input className={inp} value={form.contact_name}
                onChange={e => setForm(p => ({ ...p, contact_name: e.target.value }))} placeholder="Jan Janssen" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Niche</label>
              <input className={inp} value={form.niche}
                onChange={e => setForm(p => ({ ...p, niche: e.target.value }))} placeholder="Horeca, Retail, ..." />
            </div>
            <div>
              <label className={lbl}>Website URL</label>
              <input className={inp} type="url" value={form.website_url}
                onChange={e => setForm(p => ({ ...p, website_url: e.target.value }))} placeholder="https://bedrijf.be" />
            </div>
            <div>
              <label className={lbl}>BTW-nummer</label>
              <input className={inp} value={form.btw_nummer}
                onChange={e => setForm(p => ({ ...p, btw_nummer: e.target.value }))} placeholder="BE0123456789" />
            </div>
          </div>
        </div>

        {/* Accounttoegang */}
        <div className="card-base space-y-4">
          <h2 className="font-semibold text-gray-900">Accounttoegang</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>E-mailadres *</label>
              <input required type="email" className={inp} value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="klant@bedrijf.be" />
            </div>
            <div>
              <label className={lbl}>Wachtwoord *</label>
              <input required type="password" minLength={8} className={inp} value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Min. 8 tekens" />
            </div>
          </div>
        </div>

        {/* Diensten */}
        <div className="card-base space-y-4">
          <h2 className="font-semibold text-gray-900">Actieve diensten</h2>

          {/* Toggle grid */}
          <div className="grid grid-cols-2 gap-2">
            {SERVICES.map(s => (
              <button
                key={s.slug}
                type="button"
                onClick={() => toggleService(s.slug)}
                className={`px-3 py-2.5 rounded-lg border text-sm font-medium text-left transition-colors ${
                  form.services.includes(s.slug)
                    ? 'border-[#fff848] bg-[#fff848]/10 text-black'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Per-service config panels */}
          {form.services.length > 0 && (
            <div className="space-y-3 pt-1">
              {form.services.map(slug => {
                const service = SERVICES.find(s => s.slug === slug)!
                const cfg = getServiceCfg(slug)
                return (
                  <div key={slug} className="border border-gray-200 rounded-xl p-4 space-y-4 bg-gray-50/60">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-800">{service.label}</span>
                      <button
                        type="button"
                        onClick={() => toggleService(slug)}
                        className="h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:bg-gray-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Startmaand + Duur */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={lbl}>Startmaand</label>
                        <input
                          type="month"
                          className={inp}
                          value={cfg.start_month}
                          onChange={e => updateServiceCfg(slug, { start_month: e.target.value })}
                        />
                      </div>
                      {(slug === 'social-media' || (slug === 'webdesign' && form.webdesign_maintenance_included)) && (
                      <div>
                        <label className={lbl}>Contractduur</label>
                        <div className="flex flex-wrap gap-1.5 mt-0.5">
                          {DURATION_PRESETS.map(m => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => updateServiceCfg(slug, { contract_months: m })}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                cfg.contract_months === m
                                  ? 'bg-black text-white border-black'
                                  : 'border-gray-200 text-gray-600 bg-white hover:border-gray-400'
                              }`}
                            >
                              {m}m
                            </button>
                          ))}
                        </div>
                      </div>
                      )}
                    </div>

                    {/* Social Media settings */}
                    {slug === 'social-media' && (
                      <div className="space-y-3 border-t border-gray-100 pt-3">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div>
                            <label className={lbl}>Posts/maand</label>
                            <input type="number" min="0" max="60" className={inp} value={form.posts_per_month}
                              onChange={e => setForm(p => ({ ...p, posts_per_month: e.target.value }))} />
                          </div>
                          <div>
                            <label className={lbl}>Reels/maand</label>
                            <input type="number" min="0" max="60" className={inp} value={form.reels_per_month}
                              onChange={e => setForm(p => ({ ...p, reels_per_month: e.target.value }))} />
                          </div>
                          <div>
                            <label className={lbl}>Stories/maand</label>
                            <input type="number" min="0" max="60" className={inp} value={form.stories_per_month}
                              onChange={e => setForm(p => ({ ...p, stories_per_month: e.target.value }))} />
                          </div>
                        </div>
                        <div>
                          <label className={lbl}>Kanalen</label>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {PLATFORMS.map(p => (
                              <button
                                key={p.slug}
                                type="button"
                                onClick={() => togglePlatform(p.slug)}
                                className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                                  form.platforms.includes(p.slug)
                                    ? 'border-[#fff848] bg-[#fff848]/10 text-black'
                                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                }`}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Website settings */}
                    {slug === 'webdesign' && (
                      <div className="border-t border-gray-100 pt-3 space-y-3">
                        {/* Hoe is de site gebouwd? Interne administratie — de klant ziet dit nooit. */}
                        <div>
                          <label className={lbl}>Type website</label>
                          <div className="flex gap-1.5 flex-wrap">
                            {[{ v: 'framer', l: 'Framer' }, { v: 'custom', l: 'Custom code' }].map(o => (
                              <button key={o.v} type="button"
                                onClick={() => setForm(p => ({ ...p, website_platform: p.website_platform === o.v ? '' : o.v }))}
                                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${form.website_platform === o.v ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                                {o.l}
                              </button>
                            ))}
                          </div>
                        </div>

                        {form.website_platform === 'framer' && (
                          <div className="space-y-2">
                            <label className="flex items-center gap-3 cursor-pointer">
                              <input type="checkbox" checked={form.cms_enabled}
                                onChange={e => setForm(p => ({ ...p, cms_enabled: e.target.checked }))}
                                className="h-4 w-4 rounded border-gray-300 accent-[#fff848]" />
                              <span className="text-sm text-gray-700">CMS inbegrepen — klant beheert de inhoud in het portaal</span>
                            </label>
                            {form.cms_enabled && (
                              <>
                                <div>
                                  <label className={lbl}>Projectlink of project-ID</label>
                                  <input className={inp} value={form.framer_project_url}
                                    onChange={e => setForm(p => ({ ...p, framer_project_url: e.target.value }))}
                                    placeholder="https://framer.com/projects/…" />
                                </div>
                                <div>
                                  <label className={lbl}>API-sleutel</label>
                                  <input className={inp} type="password" autoComplete="off" value={form.framer_api_key}
                                    onChange={e => setForm(p => ({ ...p, framer_api_key: e.target.value }))}
                                    placeholder="Site Settings → General → API key" />
                                  <p className="text-[11px] text-gray-400 mt-1">Blijft op de server; de inhoud wordt meteen opgehaald na het aanmaken.</p>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {form.website_platform === 'custom' && (
                          <div>
                            <label className={lbl}>Link naar het beheerplatform</label>
                            <input className={inp} type="url" value={form.website_admin_url}
                              onChange={e => setForm(p => ({ ...p, website_admin_url: e.target.value }))}
                              placeholder="https://beheer.klant.be" />
                            <p className="text-[11px] text-gray-400 mt-1">De klant krijgt hier een knop naar toe in zijn portaal.</p>
                          </div>
                        )}

                        <div className="space-y-2">
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={form.webdesign_maintenance_included}
                              onChange={e => setForm(p => ({ ...p, webdesign_maintenance_included: e.target.checked }))}
                              className="h-4 w-4 rounded border-gray-300 accent-[#fff848]"
                            />
                            <span className="text-sm text-gray-700">Onderhoud inbegrepen</span>
                          </label>
                          {form.webdesign_maintenance_included && (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className={lbl}>Startdatum onderhoud</label>
                                <input className={inp} type="date" value={form.maintenance_start_date}
                                  onChange={e => setForm(p => ({ ...p, maintenance_start_date: e.target.value }))} />
                              </div>
                              <div>
                                <label className={lbl}>Looptijd (maanden)</label>
                                <input className={inp} type="number" min={1} value={form.maintenance_months}
                                  onChange={e => setForm(p => ({ ...p, maintenance_months: e.target.value }))} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Ads settings */}
                    {slug === 'ads' && (
                      <div className="border-t border-gray-100 pt-3">
                        <label className={lbl}>Maandelijks advertentiebudget (€)</label>
                        <input type="number" min="0" className={inp} value={form.ads_budget}
                          onChange={e => setForm(p => ({ ...p, ads_budget: e.target.value }))} placeholder="500" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Klant aanmaken
          </button>
          <Link href="/admin/clients" className="btn-secondary">Annuleren</Link>
        </div>
      </form>
    </div>
  )
}
