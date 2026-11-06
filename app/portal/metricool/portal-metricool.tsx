'use client'

import { useCallback, useRef, useState } from 'react'
import { ExternalLink, MessageSquare } from 'lucide-react'
import { MetricoolCalendarView, type MetricoolCalPost } from '@/components/metricool/calendar-view'
import { METRICOOL_LOGIN_URL } from '@/lib/metricool-feedback'

/** Knop naar de loginpagina van Metricool, om er feedback te geven en posts goed te keuren. */
function FeedbackKnop({ url }: { url: string }) {
  return (
    <div className="card-base flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-gray-300 bg-gray-100">
      <div className="flex items-start gap-3 min-w-0">
        <MessageSquare className="h-5 w-5 shrink-0 mt-0.5 text-gray-700" />
        <div className="min-w-0">
          <p className="font-medium text-sm text-gray-900">Feedback op je geplande posts?</p>
          <p className="text-xs text-gray-600 mt-0.5">Log in bij Metricool om je posts te bekijken, er feedback op te geven en ze goed te keuren. Opent in een nieuw tabblad.</p>
        </div>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary w-full sm:w-auto justify-center shrink-0"
      >
        Inloggen bij Metricool
        <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  )
}

export function PortalMetricool() {
  const [posts, setPosts] = useState<MetricoolCalPost[]>([])
  const [loading, setLoading] = useState(false)
  const [notConfigured, setNotConfigured] = useState(false)
  const range = useRef<{ start: string; end: string } | null>(null)

  const fetchPosts = useCallback(async (start: string, end: string) => {
    range.current = { start, end }
    setLoading(true)
    try {
      const res = await fetch(`/api/portal/metricool/posts?start=${start}&end=${end}`)
      const j = await res.json()
      if (j.configured === false) setNotConfigured(true)
      setPosts(j.posts ?? [])
    } catch { setPosts([]) } finally { setLoading(false) }
  }, [])

  return (
    <div className="space-y-4">
      <FeedbackKnop url={METRICOOL_LOGIN_URL} />
      {notConfigured ? (
        <div className="card-base text-sm text-gray-500">De planning is momenteel niet beschikbaar. Neem gerust contact op met NextGenMedia.</div>
      ) : (
        <MetricoolCalendarView
          posts={posts}
          loading={loading}
          onRangeChange={fetchPosts}
          showClientName={false}
          colorMode="accent"
        />
      )}
    </div>
  )
}
