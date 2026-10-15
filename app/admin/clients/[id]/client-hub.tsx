import Link from 'next/link'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatEuro } from '@/lib/utils'
import { FileText, Newspaper, TrendingUp, Receipt, Users, Globe, Calendar, ListChecks } from 'lucide-react'
import { canonicalStatus } from '@/lib/contract-status'
import { FEATURES } from '@/lib/features'

// Klant als centrale hub: één klikbaar overzicht van alles wat aan deze klant hangt.
// Alles afgeleid uit bestaande data (geen nieuwe tabellen), met deep-links.
export async function ClientHub({ clientId, btw }: { clientId: string; btw?: string | null }) {
  const admin = createAdminSupabaseClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safe = async <T,>(p: PromiseLike<T>, fallback: T): Promise<T> => { try { return await p } catch { return fallback } }
  const countOf = async (table: string, build: (q: any) => any): Promise<number> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try { const { count } = await build(admin.from(table).select('id', { count: 'exact', head: true })); return count ?? 0 } catch { return 0 }
  }

  const [
    contractRows, blogAccounts, invoiceRows, subaccounts, services, openTasks,
  ] = await Promise.all([
    safe(admin.from('contracts').select('status').eq('client_id', clientId).then((r) => r.data ?? []), [] as { status: string }[]),
    safe(admin.from('blog_accounts').select('id').eq('client_id', clientId).then((r) => r.data ?? []), [] as { id: string }[]),
    safe(admin.from('invoices').select('status, amount_excl').eq('client_id', clientId).then((r) => r.data ?? []), [] as { status: string; amount_excl: number | null }[]),
    countOf('client_users', (q) => q.eq('client_id', clientId)),
    safe(admin.from('client_services').select('service_slug, active').eq('client_id', clientId).then((r) => r.data ?? []), [] as { service_slug: string; active: boolean }[]),
    countOf('client_tasks', (q) => q.eq('client_id', clientId).neq('status', 'done')),
  ])

  const blogCount = blogAccounts.length === 0 ? 0
    : await countOf('blogs', (q) => q.in('account_id', blogAccounts.map((a) => a.id)))

  const contractCount = contractRows.length
  // Omzet van deze klant = som van zijn facturen (excl. btw, geannuleerde niet mee).
  const omzetTotal = invoiceRows
    .filter((i) => i.status !== 'geannuleerd')
    .reduce((s, i) => s + Number(i.amount_excl ?? 0), 0)
  const invoicesToSend = invoiceRows.filter((i) => i.status === 'te_factureren').length
  const signedContracts = contractRows.filter((c) => canonicalStatus(c.status) === 'getekend').length
  const hasWebsite = services.some((s) => s.service_slug === 'webdesign' && s.active)
  const hasSocial = services.some((s) => s.service_slug === 'social-media' && s.active)

  const tiles: { icon: React.ElementType; value: string; label: string; href: string; accent?: string }[] = [
    { icon: FileText, value: String(contractCount), label: signedContracts ? `contracten · ${signedContracts} getekend` : 'contracten', href: '/admin/contracts' },
    ...(FEATURES.blogs ? [{ icon: Newspaper, value: String(blogCount), label: 'blogs', href: '/admin/blogs' }] : []),
    { icon: TrendingUp, value: formatEuro(omzetTotal), label: 'omzet', href: '/admin/invoices' },
    { icon: Receipt, value: String(invoicesToSend), label: 'te versturen', href: '/admin/invoices', accent: invoicesToSend > 0 ? 'text-amber-600' : undefined },
    { icon: Users, value: String(subaccounts), label: 'gebruikers', href: `/admin/clients/${clientId}#gebruikers` },
    { icon: Globe, value: hasWebsite ? '1' : '0', label: 'website', href: '/admin/services/website' },
    { icon: Calendar, value: hasSocial ? '1' : '0', label: 'social media', href: '/admin/services/social-media' },
    { icon: ListChecks, value: String(openTasks), label: 'open taken', href: `/admin/clients/${clientId}#taken`, accent: openTasks > 0 ? 'text-amber-600' : undefined },
  ]

  return (
    <div className="space-y-2">
      {btw && (
        <div className="text-xs text-gray-500">BTW: <span className="font-mono font-medium text-gray-700">{btw}</span></div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      {tiles.map((t, i) => (
        <Link key={i} href={t.href} className="card-base !p-3 hover:ring-2 hover:ring-gray-200 transition-shadow text-center">
          <t.icon className="h-4 w-4 mx-auto text-gray-400 mb-1" />
          <div className={`text-lg font-bold leading-tight truncate ${t.accent ?? ''}`}>{t.value}</div>
          <div className="text-[11px] text-gray-400 leading-tight">{t.label}</div>
        </Link>
      ))}
      </div>
    </div>
  )
}
