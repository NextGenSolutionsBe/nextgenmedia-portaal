'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ContentCalendar, type SocialContentItem, type SocialContentStatus } from '@/components/calendar/content-calendar'

export function PortalCalendar({
  initialItems, clientId, canApprove = true, canFeedback = true, canEdit = false,
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
  /** De klant mag zijn contentplanner zelf aanpassen (portaalrecht social_media.edit). */
  canEdit?: boolean
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

  // Zelf aanpassen: titel, caption, script, media-notities, datum, type, kanalen.
  const handleUpdate = async (id: string, patch: Partial<SocialContentItem>) => {
    const r = await fetch('/api/portal/social-content/item', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j.error || 'Opslaan mislukt'); throw new Error(j.error || 'Opslaan mislukt') }
    if (j.item) setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...j.item } : it)))
    toast.success(j.ongewijzigd ? 'Niets gewijzigd.' : 'Aanpassing bewaard.')
  }
  const handleMove = async (id: string, planned_date: string) => handleUpdate(id, { planned_date })

  return (
    <ContentCalendar
      items={items}
      mode="client"
      actions={{
        onApprove: canApprove ? handleApprove : undefined,
        onRequestChanges: canFeedback ? handleRequestChanges : undefined,
        onUpdate: canEdit ? handleUpdate : undefined,
        onMove: canEdit ? handleMove : undefined,
      }}
    />
  )
}
