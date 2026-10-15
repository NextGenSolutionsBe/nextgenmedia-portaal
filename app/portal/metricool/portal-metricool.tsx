'use client'

import { useCallback, useRef, useState } from 'react'
import { ExternalLink, MessageSquare } from 'lucide-react'
import { MetricoolCalendarView, type MetricoolCalPost } from '@/components/metricool/calendar-view'

/** Knop naar Metricool om feedback te geven — enkel als er een (gevalideerde) link is. */
function FeedbackKnop({ url }: { url: string }) {
  return (
    <div className="card-base flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-[#fff848]/60 bg-[#fff848]/10">
      <div className="flex items-start gap-3 min-w-0">
        <MessageSquare className="h-5 w-5 shrink-0 mt-0.5 text-gray-700" />
        <div className="min-w-0">
          <p className="font-medium text-sm text-gray-900">Feedback op je geplande posts?</p>
          <p className="text-xs text-gray-600 mt-0.5">Bekijk, becommentarieer en keur je posts goed in Metricool. De link opent in een nieuw tabblad.</p>
        </div>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary w-full sm:w-auto justify-center shrink-0"
      >
        Feedback geven in Metricool
        <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  )
}

export function PortalMetricool({ feedbackUrl = null }: { feedbackUrl?: string | null }) {
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
      {feedbackUrl && <FeedbackKnop url={feedbackUrl} />}
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
