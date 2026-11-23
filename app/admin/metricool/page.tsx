export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { PERIODES, isNetwerk, netwerkenMetData, periodeVan, samenvatting, type PeriodeSoort } from '@/lib/metricool-stats'
import { laadRijen, laadStatistieken } from '@/lib/metricool-stats-server'
import { Statistieken } from '@/app/portal/metricool/statistieken'
import { MetricoolClient } from './metricool-client'
import { Overzicht, type OverzichtRij } from './overzicht'
import { BijwerkenKnop } from './bijwerken-knop'

type Zoek = { tab?: string; klant?: string; periode?: string; netwerk?: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const plusDagen = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

/**
 * Metricool in de admin: Statistieken (alle klanten naast elkaar, klik = dezelfde
 * weergave als de klant in de klantapp) en Planning (de geplande posts en het koppelen).
 * Alle cijfers komen uit onze databank; de planner haalt ze bij Metricool.
 */
export default async function MetricoolPage({ searchParams }: { searchParams: Zoek }) {
  if (!(await magIk('metricool', 'bekijken'))) redirect('/admin')
  const tab = searchParams.tab === 'planning' ? 'planning' : 'statistieken'
  const soort: PeriodeSoort = PERIODES.some((p) => p.key === searchParams.periode) ? (searchParams.periode as PeriodeSoort) : '30d'

  const tabs = (
    <div className="flex gap-1 border-b border-gray-200">
      {([['statistieken', 'Statistieken', '/admin/metricool'], ['planning', 'Planning', '/admin/metricool?tab=planning']] as const).map(([k, label, href]) => (
        <Link key={k} href={href} prefetch={false}
          className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-gray-900 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
          {label}
        </Link>
      ))}
    </div>
  )
  const kop = (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold">Metricool</h1>
      <p className="text-sm text-gray-500 mt-0.5">{tab === 'planning' ? 'Enkel lezen. Plannen en goedkeuren gebeurt in Metricool.' : 'Hoe de socialemediakanalen van elke klant het doen.'}</p>
    </div>
  )

  if (tab === 'planning') {
    return <div className="space-y-6 animate-fade-in">{kop}{tabs}<MetricoolClient /></div>
  }

  const admin = createAdminSupabaseClient()
  const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  const periode = periodeVan(soort, vandaag)

  // ── Eén klant: dezelfde weergave als in de klantapp ─────────────────────────
  if (searchParams.klant && UUID.test(searchParams.klant)) {
    const { data: klant } = await admin.from('clients').select('id, company_name, metricool_blog_id').eq('id', searchParams.klant).maybeSingle()
    const blog = klant?.metricool_blog_id ? String(klant.metricool_blog_id) : null
    if (!klant || !blog) redirect('/admin/metricool')
    const data = await laadStatistieken(admin, blog)
    const netwerk = isNetwerk(searchParams.netwerk) ? searchParams.netwerk : 'alle'
    const magBijwerken = !!(await magIk('metricool', 'aanpassen'))
    return (
      <div className="space-y-6 animate-fade-in">
        {kop}
        {tabs}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Link href={`/admin/metricool?periode=${soort}`} prefetch={false} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"><ArrowLeft className="h-4 w-4" />Alle klanten</Link>
            <h2 className="text-lg font-semibold mt-1">
              <Link href={`/admin/clients/${klant.id}`} prefetch={false} className="hover:underline">{klant.company_name}</Link>
            </h2>
          </div>
          {magBijwerken && <BijwerkenKnop blogId={blog} />}
        </div>
        <Statistieken data={data} periode={periode} netwerk={netwerk} pad="/admin/metricool" vast={{ klant: klant.id }} />
      </div>
    )
  }

  // ── Overzicht: alle klanten met een Metricool-merk ──────────────────────────
  const { data: klanten } = await admin.from('clients').select('id, company_name, metricool_blog_id')
    .not('metricool_blog_id', 'is', null).order('company_name')
  const lijst = ((klanten ?? []) as { id: string; company_name: string; metricool_blog_id: string | number | null }[])
    .map((k) => ({ ...k, blog: String(k.metricool_blog_id ?? '').trim() })).filter((k) => k.blog)
  const blogs = Array.from(new Set(lijst.map((k) => k.blog)))
  // Vanaf de vorige periode (en een week ervoor, voor de stand van de volgers bij de start).
  const vanaf = plusDagen(periode.vorigeVan, -7)
  const [perBlog, syncs] = await Promise.all([
    Promise.all(blogs.map(async (b) => [b, await laadRijen(admin, b, vanaf)] as const)).then((x) => new Map(x)),
    blogs.length
      ? admin.from('metricool_sync').select('blog_id, laatst_op').in('blog_id', blogs).then((r) => new Map(((r.data ?? []) as { blog_id: string; laatst_op: string | null }[]).map((s) => [s.blog_id, s.laatst_op])))
      : Promise.resolve(new Map<string, string | null>()),
  ])
  const rijen: OverzichtRij[] = lijst.map((k) => {
    const r = perBlog.get(k.blog) ?? []
    return { clientId: k.id, naam: k.company_name, laatstOp: syncs.get(k.blog) ?? null, netwerken: netwerkenMetData(r), cijfers: samenvatting(r, periode, 'alle') }
  })
  // Klanten met cijfers eerst (meeste volgers bovenaan), zonder cijfers onderaan.
  const volgers = (r: OverzichtRij) => r.cijfers.find((c) => c.kpi === 'volgers')?.waarde ?? -1
  rijen.sort((a, b) => volgers(b) - volgers(a) || a.naam.localeCompare(b.naam, 'nl'))

  return (
    <div className="space-y-6 animate-fade-in">
      {kop}
      {tabs}
      <Overzicht rijen={rijen} periode={periode} />
    </div>
  )
}
