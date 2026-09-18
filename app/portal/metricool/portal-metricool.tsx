'use client'

import { useCallback, useRef, useState } from 'react'
import { MetricoolCalendarView, type MetricoolCalPost } from '@/components/metricool/calendar-view'

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

  if (notConfigured) {
    return <div className="card-base text-sm text-gray-500">De planning is momenteel niet beschikbaar. Neem gerust contact op met NextGenMedia.</div>
  }

  return (
    <MetricoolCalendarView
      posts={posts}
      loading={loading}
      onRangeChange={fetchPosts}
      showClientName={false}
      colorMode="accent"
    />
  )
}
