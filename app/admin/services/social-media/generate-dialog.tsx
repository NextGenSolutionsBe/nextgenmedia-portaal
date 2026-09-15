'use client'

import { useState, useEffect } from 'react'
import { X, Loader2, CalendarDays, Sparkles, CheckCircle2, Info } from 'lucide-react'
import { KANALEN, normaliseerKanalen } from '@/lib/social-platforms'

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
]

// Kanalen komen uit één lijst (lib/social-platforms.ts): Instagram en Facebook
// staan daar samen als Meta, want je plant er nooit apart voor.
const ALL_PLATFORMS = KANALEN

interface ClientConfig {
  niche: string
  company_name: string
  start_date: string | null
  postsPerMonth: number
  reelsPerMonth: number
  storiesPerMonth: number
  channels: string[]
}

interface SelectedMonth { year: number; month: number }

interface GenerateDialogProps {
  clientId: string
  onClose: () => void
  onGenerated: () => void
}

function getDefaultMonths(startDate: string | null): SelectedMonth[] {
  const base = startDate ? new Date(startDate) : new Date()
  return [0, 1, 2].map(offset => {
    const d = new Date(base.getFullYear(), base.getMonth() + offset, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
}

function getMonthOptions(): SelectedMonth[] {
  const now = new Date()
  // Current month + 12 months ahead = 13 selectable months
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })
}

type Step = 'config' | 'confirm' | 'success'

export function GenerateDialog({ clientId, onClose, onGenerated }: GenerateDialogProps) {
  const [config, setConfig] = useState<ClientConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [selectedMonths, setSelectedMonths] = useState<SelectedMonth[]>([])
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [postsPerMonth, setPostsPerMonth] = useState(0)
  const [reelsPerMonth, setReelsPerMonth] = useState(0)
  const [storiesPerMonth, setStoriesPerMonth] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [step, setStep] = useState<Step>('config')
  const [success, setSuccess] = useState<{ created: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/social-content/generate?clientId=${clientId}`)
      .then(r => r.json())
      .then((json: ClientConfig) => {
        setConfig(json)
        setPostsPerMonth(json.postsPerMonth)
        setReelsPerMonth(json.reelsPerMonth)
        setStoriesPerMonth(json.storiesPerMonth)
        setSelectedMonths(getDefaultMonths(json.start_date))
        // Pre-select the platforms the client has configured (admin can adjust)
        // Oude klantinstellingen kunnen nog 'instagram'/'facebook' bevatten;
        // normaliseren maakt daar één keer Meta van in plaats van twee vinkjes.
        const kanalen = normaliseerKanalen(json.channels)
        setSelectedPlatforms(kanalen.length > 0 ? kanalen : ['meta'])
      })
      .catch(() => setError('Kan configuratie niet laden'))
      .finally(() => setLoadingConfig(false))
  }, [clientId])

  const togglePlatform = (slug: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(slug) ? prev.filter(p => p !== slug) : [...prev, slug]
    )
  }

  const monthOptions = getMonthOptions()
  const isSelected = (y: number, m: number) => selectedMonths.some(s => s.year === y && s.month === m)

  const toggleMonth = (year: number, month: number) => {
    setSelectedMonths(prev => {
      const exists = prev.some(s => s.year === year && s.month === month)
      const next = exists
        ? prev.filter(s => !(s.year === year && s.month === month))
        : [...prev, { year, month }]
      return next.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))
    })
  }

  const totalPerMonth = postsPerMonth + reelsPerMonth + storiesPerMonth
  const totalItems = totalPerMonth * selectedMonths.length

  const doGenerate = async () => {
    setGenerating(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/social-content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          months: selectedMonths,
          postsPerMonth,
          reelsPerMonth,
          storiesPerMonth,
          channels: selectedPlatforms.length > 0 ? selectedPlatforms : ['meta'],
          niche: config?.niche ?? '',
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      setSuccess({ created: json.created })
      setStep('success')
      onGenerated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij genereren')
      setStep('config')
    } finally {
      setGenerating(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848] text-center font-semibold'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#c5b800]" />
            <h3 className="font-semibold">
              {step === 'confirm' ? 'Bevestig planning' : 'Content inplannen'}
            </h3>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loadingConfig ? (
          <div className="flex items-center justify-center py-14 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Laden...
          </div>

        ) : step === 'success' && success ? (
          /* Success state */
          <div className="p-8 text-center space-y-4">
            <div className="h-14 w-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-7 w-7 text-green-600" />
            </div>
            <div>
              <div className="font-semibold text-gray-900 text-lg">{success.created} contentmomenten ingepland</div>
              <div className="text-sm text-gray-500 mt-1">
                De kalender is bijgewerkt. Scripts zijn leeg — voeg ze manueel toe.
              </div>
            </div>
            <button onClick={onClose} className="btn-primary mt-2">
              Kalender bekijken
            </button>
          </div>

        ) : step === 'confirm' ? (
          /* Confirmation step */
          <div className="p-5 space-y-5">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <div className="font-medium text-blue-800">Nieuwe items worden toegevoegd</div>
                  <div className="text-blue-700 text-xs mt-0.5">
                    Bestaande content blijft volledig behouden. Je kan dezelfde maanden meerdere keren genereren (bv. één keer per platform).
                  </div>
                </div>
              </div>
            </div>

            {/* Summary recap */}
            <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1.5">
              <div className="flex justify-between text-gray-500">
                <span>Maanden</span>
                <span className="font-medium text-gray-900">
                  {selectedMonths.map(m => MONTH_NAMES[m.month]).join(', ')}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Nieuwe items</span>
                <span className="font-medium text-gray-900">{totalItems}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Platformen</span>
                <span className="font-medium text-gray-900 capitalize">
                  {selectedPlatforms.join(', ')}
                </span>
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={doGenerate}
                disabled={generating}
                className="btn-primary flex-1"
              >
                {generating
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Sparkles className="h-4 w-4" />}
                {generating ? 'Genereren...' : 'Bevestig & genereer'}
              </button>
              <button
                type="button"
                onClick={() => setStep('config')}
                className="btn-secondary"
                disabled={generating}
              >
                Terug
              </button>
            </div>
          </div>

        ) : (
          /* Config step */
          <div className="p-5 space-y-5">

            {/* Client label */}
            {config?.company_name && (
              <div className="text-sm text-gray-500">
                Planning voor{' '}
                <span className="font-medium text-gray-900">{config.company_name}</span>
                {config.niche && <span className="text-gray-400"> · {config.niche}</span>}
              </div>
            )}

            {/* Month selector */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Maanden <span className="text-gray-400">(meerdere mogelijk)</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {monthOptions.map(({ year, month }) => (
                  <button
                    key={`${year}-${month}`}
                    type="button"
                    onClick={() => toggleMonth(year, month)}
                    className={`px-2 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
                      isSelected(year, month)
                        ? 'border-[#fff848] bg-[#fff848]/10 text-black'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {MONTH_NAMES[month]}
                    <span className="block text-gray-400 font-normal text-[11px]">{year}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Platform multi-select — admin chooses per generation */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Platformen <span className="text-gray-400">(meerdere mogelijk)</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {ALL_PLATFORMS.map(({ slug, label }) => (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => togglePlatform(slug)}
                    className={`px-2.5 py-2 rounded-xl border text-xs font-medium transition-colors ${
                      selectedPlatforms.includes(slug)
                        ? 'border-[#fff848] bg-[#fff848]/10 text-black'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                Tip: genereer per platform afzonderlijk voor maximale controle.
              </p>
            </div>

            {/* Frequency inputs */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Frequentie per maand
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: 'Posts', value: postsPerMonth, set: setPostsPerMonth },
                  { label: 'Reels', value: reelsPerMonth, set: setReelsPerMonth },
                  { label: 'Stories', value: storiesPerMonth, set: setStoriesPerMonth },
                ].map(({ label, value, set }) => (
                  <div key={label} className="text-center">
                    <label className="block text-xs text-gray-400 mb-1">{label}</label>
                    <input
                      type="number"
                      min="0"
                      max="31"
                      className={inp}
                      value={value}
                      onChange={e => set(Math.max(0, Math.min(31, Number(e.target.value))))}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Summary card */}
            {selectedMonths.length > 0 && totalPerMonth > 0 && selectedPlatforms.length > 0 && (
              <div className="bg-[#fff848]/10 border border-[#fff848]/40 rounded-xl p-3.5">
                <div className="flex items-center gap-2 font-semibold text-gray-900 text-sm mb-1">
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  {totalItems} contentmomenten over {selectedMonths.length} maand{selectedMonths.length !== 1 ? 'en' : ''}
                </div>
                <div className="text-xs text-gray-500 space-y-0.5">
                  <div>
                    {[
                      postsPerMonth > 0 && `${postsPerMonth} posts`,
                      reelsPerMonth > 0 && `${reelsPerMonth} reels`,
                      storiesPerMonth > 0 && `${storiesPerMonth} stories`,
                    ].filter(Boolean).join(' · ')} per maand op {selectedPlatforms.join(', ')}
                  </div>
                  <div className="text-gray-400">
                    Bestaande items blijven behouden — nieuwe items worden toegevoegd.
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {/* Primary CTA */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setStep('confirm')}
                disabled={selectedMonths.length === 0 || totalPerMonth === 0 || selectedPlatforms.length === 0}
                className="btn-primary flex-1"
              >
                <Sparkles className="h-4 w-4" />
                Genereer planning
              </button>
              <button type="button" onClick={onClose} className="btn-secondary">
                Annuleer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
