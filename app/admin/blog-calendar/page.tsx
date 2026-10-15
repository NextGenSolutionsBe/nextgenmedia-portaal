export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { BlogCalendar, type CalEvent, type CalBlog } from './blog-calendar'

export default async function BlogCalendarPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams
  const admin = createAdminSupabaseClient()
  const [{ data: blogs }, { data: accounts }] = await Promise.all([
    admin.from('blogs').select('id, titel, slug, content, meta_title, meta_description, thumbnail_url, status, account_id, gegenereerd_op, gepubliceerd_op, publish_at, publish_mode, sync_status, foutmelding, tags').order('gegenereerd_op', { ascending: false }).limit(1000),
    admin.from('blog_accounts').select('id, name').order('name'),
  ])
  const nameById = new Map((accounts ?? []).map((a: { id: string; name: string }) => [a.id, a.name]))
  const day = (v: string | null) => (v ? v.slice(0, 10) : null)

  const rows = (blogs ?? []) as Omit<CalBlog, 'account_name'>[]
  const list: CalBlog[] = rows.map((b) => ({ ...b, account_name: b.account_id ? (nameById.get(b.account_id) ?? '—') : '—' }))

  const events: CalEvent[] = []
  for (const b of list) {
    if (b.status === 'klaar_voor_review' && b.gegenereerd_op) events.push({ date: day(b.gegenereerd_op)!, kind: 'review', blogId: b.id, account_id: b.account_id, titel: b.titel })
    if (b.gepubliceerd_op) events.push({ date: day(b.gepubliceerd_op)!, kind: 'published', blogId: b.id, account_id: b.account_id, titel: b.titel })
    if (b.status === 'goedgekeurd' && b.publish_at) events.push({ date: day(b.publish_at)!, kind: 'scheduled', blogId: b.id, account_id: b.account_id, titel: b.titel })
    else if (b.status === 'goedgekeurd' && !b.publish_at) events.push({ date: day(b.gegenereerd_op)!, kind: 'scheduled', blogId: b.id, account_id: b.account_id, titel: b.titel })
  }
  const { data: due } = await admin.from('blog_accounts').select('id, name, volgende_generatie_datum, active')
  for (const a of (due ?? []) as { id: string; name: string; volgende_generatie_datum: string | null; active: boolean }[]) {
    if (a.active && a.volgende_generatie_datum) events.push({ date: a.volgende_generatie_datum, kind: 'generation', titel: `Volgende bloggeneratie: ${a.name}`, account_id: a.id })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Blog Kalender</h1>
        <p className="text-sm text-gray-500 mt-0.5">Je werkplek voor blogs: nalezen, aanpassen, goedkeuren, inplannen en publiceren. Klik op een blog om te openen.</p>
      </div>
      <BlogCalendar events={events} blogs={list} accounts={(accounts ?? []) as { id: string; name: string }[]} initialAccount={account ?? ''} />
    </div>
  )
}
