import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { followUp } from '@/lib/contract-status'
import { FEATURES } from '@/lib/features'
import { syncGezondheid, SYNC_VEROUDERD_MIN } from '@/lib/sales/clickup-agenda-sync'

// Eén bron voor meldingen + "Vandaag": alles live afgeleid uit bestaande data
// (geen nieuwe tabel). Gelezen/niet-gelezen wordt client-side in localStorage
// bijgehouden zodat er geen migratie of dataschrijven nodig is.

export type NotifPriority = 'high' | 'med' | 'low'
export type Notif = {
  id: string            // stabiel, bv. "invoice:<uuid>" → voor read-state
  kind: string          // invoice | contract | blog | website | client
  priority: NotifPriority
  title: string
  date: string | null
  href: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const thisMonth = () => new Date().toISOString().slice(0, 7)

export async function buildNotifications(): Promise<Notif[]> {
  let admin: ReturnType<typeof createAdminSupabaseClient>
  try { admin = createAdminSupabaseClient() } catch { return [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safe = async <T,>(p: PromiseLike<{ data: T[] | null }>): Promise<T[]> => { try { return (await p).data ?? [] } catch { return [] } }

  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const [invoices, contracts, blogs, webRequests, clients, clientMap] = await Promise.all([
    safe(admin.from('invoices').select('id, description, status, invoice_month, client_id').eq('status', 'te_factureren').limit(50)),
    safe(admin.from('contracts').select('id, title, status, sent_at, created_at, expires_at, client_id').limit(300)),
    safe(admin.from('blogs').select('id, titel, status').eq('status', 'goedgekeurd').limit(50)),
    safe(admin.from('webdesign_change_requests').select('id, title, status, created_at').eq('status', 'new').limit(50)),
    safe(admin.from('clients').select('id, company_name, created_at').gte('created_at', since).limit(50)),
    safe(admin.from('clients').select('id, company_name').limit(2000)),
  ]) as [
    { id: string; description?: string | null; status: string; invoice_month?: string | null; client_id?: string | null }[],
    { id: string; title: string; status: string; sent_at?: string | null; created_at?: string | null; expires_at?: string | null; client_id?: string | null }[],
    { id: string; titel: string; status: string }[],
    { id: string; title: string; status: string; created_at?: string | null }[],
    { id: string; company_name: string; created_at?: string | null }[],
    { id: string; company_name: string }[],
  ]

  const names = new Map(clientMap.map((c) => [c.id, c.company_name]))
  const out: Notif[] = []

  // ClickUp→Google-agendasync: ligt die stil, dan zien de setters niet wat er
  // in ClickUp gepland staat en kán er dubbel geboekt worden. Dat verdient de
  // hoogste prioriteit in de bel — naast de mail die de sync zelf al stuurt.
  try {
    const sync = await syncGezondheid()
    if (sync.actief && sync.verouderd) {
      out.push({
        id: `clickupsync:verouderd:${sync.laatsteOkOp ?? 'nooit'}`,
        kind: 'sales', priority: 'high',
        title: sync.laatsteOkOp
          ? `ClickUp-agendasync draait niet meer (laatste keer gelukt: ${Math.round(sync.minutenSindsOk ?? 0)} min geleden — hoort elke 10 min)`
          : `ClickUp-agendasync is nog nooit gelukt (hoort elke ${SYNC_VEROUDERD_MIN / 3} min te draaien)`,
        date: sync.laatsteOkOp?.slice(0, 10) ?? null,
        href: '/admin/sales/appointments',
      })
    } else if (sync.actief && sync.laatsteFout) {
      out.push({
        id: 'clickupsync:fout',
        kind: 'sales', priority: 'high',
        title: `ClickUp-agendasync geeft een fout: ${sync.laatsteFout.slice(0, 120)}`,
        date: todayISO(), href: '/admin/sales/appointments',
      })
    }
  } catch { /* meldingen mogen nooit stuklopen op de waakhond */ }

  for (const i of invoices) {
    const due = (i.invoice_month ?? '') <= thisMonth()
    out.push({
      id: `invoice:${i.id}`, kind: 'invoice', priority: due ? 'high' : 'med',
      title: `Factuur te versturen — ${i.client_id ? names.get(i.client_id) ?? '' : ''} ${i.description ?? ''}`.trim(),
      date: i.invoice_month ?? null, href: '/admin/invoices',
    })
  }
  for (const c of contracts) {
    const fu = followUp(c)
    if (!fu.needs) continue
    out.push({
      id: `contract:${c.id}`, kind: 'contract', priority: fu.level === 'urgent' ? 'high' : 'med',
      title: `Contract opvolgen — ${c.title} (${fu.reason})`, date: c.sent_at ?? c.created_at ?? null,
      href: `/admin/contracts/${c.id}`,
    })
  }
  // Blog-signalen enkel als de module aan staat (lib/features.ts).
  if (FEATURES.blogs) {
    for (const b of blogs) {
      out.push({ id: `blog:${b.id}`, kind: 'blog', priority: 'low', title: `Blog klaar voor publicatie — ${b.titel}`, date: null, href: '/admin/blog-calendar' })
    }
  }
  for (const w of webRequests) {
    out.push({ id: `website:${w.id}`, kind: 'website', priority: 'med', title: `Nieuwe websitefeedback — ${w.title}`, date: w.created_at ?? null, href: '/admin/services/website' })
  }
  for (const c of clients) {
    out.push({ id: `client:${c.id}`, kind: 'client', priority: 'low', title: `Nieuwe klant toegevoegd — ${c.company_name}`, date: c.created_at ?? null, href: `/admin/clients/${c.id}` })
  }

  const rank: Record<NotifPriority, number> = { high: 0, med: 1, low: 2 }
  return out.sort((a, b) => rank[a.priority] - rank[b.priority] || (b.date ?? '').localeCompare(a.date ?? ''))
}
