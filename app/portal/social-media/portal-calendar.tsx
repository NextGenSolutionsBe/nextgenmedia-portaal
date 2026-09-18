'use client'

import { useState } from 'react'
import { ContentCalendar, type SocialContentItem, type SocialContentStatus } from '@/components/calendar/content-calendar'

export function PortalCalendar({
  initialItems, clientId, canApprove = true, canFeedback = true,
}: {
  initialItems: Array<{
    id: string; client_id: string; planned_date: string; platform: string;
    platforms: string[]; content_type: string; title: string;
    caption: string | null; script: string | null;
    media_notes: string | null; status: string; client_feedback: string | null;
    reviewed_at: string | null; created_at: string;
  }>
  clientId: string
  canApprove?: boolean
  canFeedback?: boolean
}) {
  void clientId
  const [items, setItems] = useState<SocialContentItem[]>(initialItems as unknown as SocialContentItem[])

  const handleApprove = async (id: string) => {
    await fetch('/api/portal/social-content/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision: 'approved' }),
    })
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, status: 'approved' as SocialContentStatus } : it))
  }

  const handleRequestChanges = async (id: string, feedback: string) => {
    await fetch('/api/portal/social-content/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision: 'changes_requested', feedback }),
    })
    setItems((prev) => prev.map((it) => it.id === id ? {
      ...it,
      status: 'changes_requested' as SocialContentStatus,
      client_feedback: feedback,
    } : it))
  }

  return (
    <ContentCalendar
      items={items}
      mode="client"
      actions={{
        onApprove: canApprove ? handleApprove : undefined,
        onRequestChanges: canFeedback ? handleRequestChanges : undefined,
      }}
    />
  )
}
