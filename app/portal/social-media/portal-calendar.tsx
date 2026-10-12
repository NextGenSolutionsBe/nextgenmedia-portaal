'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, X, Loader2 } from 'lucide-react'
import { ContentCalendar, type SocialContentItem, type SocialContentStatus } from '@/components/calendar/content-calendar'
import { KANAAL_SLUGS, kanaalLabel } from '@/lib/social-platforms'

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
  // Zelf inplannen en een eigen concept weer verwijderen.
  const [nieuwOp, setNieuwOp] = useState<string | null>(null)
  const handleStatus = async (id: string, status: SocialContentStatus, extra?: Record<string, unknown>) => {
    const r = await fetch('/api/portal/social-content/item', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, actie: 'status', status, ...(extra ?? {}) }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j.error || 'Status wijzigen mislukt'); throw new Error(j.error) }
    if (j.item) setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...j.item } : it)))
    toast.success(status === 'published' ? 'Gemarkeerd als gepubliceerd.' : 'Status gewijzigd.')
  }
  const laadActiviteit = async (id: string) => { const r = await fetch(`/api/portal/social-content/item?activiteit=${id}`, { cache: 'no-store' }); const j = await r.json().catch(() => ({})); return r.ok ? j.activiteit ?? [] : [] }
  const handleDelete = async (id: string) => {
    const r = await fetch(`/api/portal/social-content/item?id=${id}`, { method: 'DELETE' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j.error || 'Verwijderen mislukt'); throw new Error(j.error) }
    setItems((prev) => prev.filter((it) => it.id !== id))
    toast.success('Item verwijderd.')
  }

  return (
    <div className="space-y-3">
    {canEdit && (
      <div className="flex justify-end">
        <button type="button" onClick={() => setNieuwOp(new Date().toISOString().slice(0, 10))} className="btn-primary text-sm"><Plus className="h-4 w-4" />Content inplannen</button>
      </div>
    )}
    <ContentCalendar
      items={items}
      mode="client"
      actions={{
        onApprove: canApprove ? handleApprove : undefined,
        onRequestChanges: canFeedback ? handleRequestChanges : undefined,
        onUpdate: canEdit ? handleUpdate : undefined,
        onMove: canEdit ? handleMove : undefined,
        onCreateOnDay: canEdit ? (d: string) => setNieuwOp(d) : undefined,
        onDelete: canEdit ? handleDelete : undefined,
        onSetStatus: canEdit ? handleStatus : undefined,
        onLaadActiviteit: laadActiviteit,
      }}
    />
    {nieuwOp && <NieuwItem datum={nieuwOp} onSluit={() => setNieuwOp(null)} onAangemaakt={(it) => { setItems((prev) => [...prev, it]); setNieuwOp(null) }} />}
    </div>
  )
}

/** Zelf een nieuw item inplannen: komt bij NextGenMedia binnen als concept. */
function NieuwItem({ datum, onSluit, onAangemaakt }: { datum: string; onSluit: () => void; onAangemaakt: (it: SocialContentItem) => void }) {
  const [v, setV] = useState({ title: '', planned_date: datum, planned_time: '', content_type: 'post', platforms: ['meta'] as string[], caption: '', script: '', status: 'draft' as 'draft' | 'scheduled' })
  const [bezig, setBezig] = useState(false)
  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'
  const bewaar = async () => {
    if (!v.title.trim()) { toast.error('Geef het item een titel.'); return }
    if (!v.platforms.length) { toast.error('Kies minstens één kanaal.'); return }
    setBezig(true)
    try {
      const r = await fetch('/api/portal/social-content/item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...v, planned_time: v.planned_time || null }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Inplannen mislukt')
      toast.success(v.status === 'scheduled' ? 'Ingepland. Ons team ziet het meteen.' : 'Bewaard als concept. Ons team ziet het meteen.')
      onAangemaakt(j.item as SocialContentItem)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Inplannen mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40" role="dialog" aria-modal="true" aria-label="Content inplannen">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between"><h3 className="font-semibold">Content inplannen</h3><button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button></div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div><label className={lbl}>Titel *</label><input autoFocus className={inp} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="bv. Nieuwe collectie in de kijker" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Datum *</label><input type="date" className={inp} value={v.planned_date} onChange={(e) => setV({ ...v, planned_date: e.target.value })} /></div>
            <div><label className={lbl}>Tijdstip</label><input type="time" className={inp} value={v.planned_time} onChange={(e) => setV({ ...v, planned_time: e.target.value })} /></div>
            <div className="col-span-2"><label className={lbl}>Type</label><select className={inp} value={v.content_type} onChange={(e) => setV({ ...v, content_type: e.target.value })}>{['post', 'reel', 'story', 'carousel'].map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          </div>
          <div><label className={lbl}>Kanalen *</label>
            <div className="flex flex-wrap gap-1.5">{KANAAL_SLUGS.map((k) => { const aan = v.platforms.includes(k); return <button key={k} type="button" aria-pressed={aan} onClick={() => setV({ ...v, platforms: aan ? v.platforms.filter((x) => x !== k) : [...v.platforms, k] })} className={`px-2.5 py-1 rounded-full text-xs font-medium border ${aan ? 'border-[#fff848] bg-[#fff848]/10 text-black' : 'border-gray-200 text-gray-500'}`}>{kanaalLabel(k)}</button> })}</div>
          </div>
          <div><label className={lbl}>Caption</label><textarea rows={3} className={inp} value={v.caption} onChange={(e) => setV({ ...v, caption: e.target.value })} /></div>
          <div><label className={lbl}>Script / hook / CTA</label><textarea rows={4} className={inp} value={v.script} onChange={(e) => setV({ ...v, script: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={v.status === 'scheduled'} onChange={(e) => setV({ ...v, status: e.target.checked ? 'scheduled' : 'draft' })} />Meteen inplannen (anders als concept bewaren)</label>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2"><button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button><button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Inplannen</button></div>
      </div>
    </div>
  )
}
