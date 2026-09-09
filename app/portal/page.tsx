export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate, SERVICE_LABELS, daysUntil } from '@/lib/utils'
import Link from 'next/link'
import { Calendar, FileText, Globe, Clock, ArrowRight } from 'lucide-react'
import { resolvePortalSession, sessionCan } from '@/lib/portal-auth'
import { getLang } from '@/lib/i18n-server'
import { t } from '@/lib/i18n'

export default async function PortalDashboard() {
  const session = await resolvePortalSession()
  if (!session || !session.active) redirect('/login')
  const clientId = session.clientId
  const lang = await getLang()

  const admin = createAdminSupabaseClient()
  const { data: client } = await admin
    .from('clients').select('id, company_name').eq('id', clientId).maybeSingle()
  if (!client) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-sm">{t(lang, 'dash.noProfile')}</p>
      </div>
    )
  }
  const canContracts = sessionCan(session, 'contracts', 'view')
  const canSign = sessionCan(session, 'contracts', 'sign')

  // Separate parallel queries — avoids PostgREST FK join failures
  const [
    { data: clientServicesRaw },
    { data: serviceContractsRaw },
    { data: contractsRaw },
    { count: pendingScriptsCount },
  ] = await Promise.all([
    admin.from('client_services').select('*').eq('client_id', clientId),
    admin.from('service_contracts').select('*').eq('client_id', clientId),
    admin
      .from('contracts')
      .select('id, title, status, signed_at, sent_at, access_token')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(5),
    // Exacte telling van scripts die op goedkeuring wachten (geen limiet).
    admin
      .from('social_content_items')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'ready_for_review'),
  ])

  const pendingScripts = pendingScriptsCount ?? 0

  const services = (clientServicesRaw ?? []).filter((s: { active: boolean }) => s.active) as Array<{
    id: string
    service_slug: string
    active: boolean
  }>
  const serviceContracts = (serviceContractsRaw ?? []) as Array<{
    service_slug: string
    start_date: string | null
    end_date: string | null
    config: Record<string, unknown> | null
  }>
  const contracts = contractsRaw ?? []

  const hasSocial = services.some((s) => s.service_slug === 'social-media')
  const hasWebdesign = services.some((s) => s.service_slug === 'webdesign')
  const pendingContracts = canContracts ? contracts.filter((c) => ['sent', 'viewed'].includes(c.status)) : []

  // Social media contract config (posts/reels/stories come from service_contracts.config)
  const socialSC = serviceContracts.find((sc) => sc.service_slug === 'social-media')
  const socialCfg = socialSC?.config ?? {}
  const days = daysUntil(socialSC?.end_date ?? null)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">{t(lang, 'dash.welcome', { name: client.company_name })}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t(lang, 'dash.subtitle')}</p>
      </div>

      {/* Alerts */}
      {(pendingContracts.length > 0 || pendingScripts > 0) && (
        <div className="space-y-2">
          {pendingContracts.map((c) => (
            <Link
              key={c.id}
              href={canSign ? `/sign/${c.access_token}` : '/portal/contracts'}
              className="flex items-center justify-between p-4 bg-[#fff848]/10 border border-[#fff848] rounded-xl"
            >
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-gray-700" />
                <div>
                  <div className="font-medium text-sm">{c.title}</div>
                  <div className="text-xs text-gray-500">{t(lang, 'dash.contractPending')}</div>
                </div>
              </div>
              <span className="btn-primary text-xs">{t(lang, 'dash.sign')}</span>
            </Link>
          ))}
          {pendingScripts > 0 && (
            <Link
              href="/portal/social-media"
              className="flex items-center justify-between p-4 bg-amber-50 border border-amber-200 rounded-xl"
            >
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-amber-600" />
                <div>
                  <div className="font-medium text-sm text-amber-800">
                    {t(lang, pendingScripts === 1 ? 'dash.scriptsOne' : 'dash.scriptsOther', { n: pendingScripts })}
                  </div>
                  <div className="text-xs text-amber-600">{t(lang, 'dash.scriptsReview')}</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-amber-600" />
            </Link>
          )}
        </div>
      )}

      {/* Services grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {hasSocial && (
          <Link href="/portal/social-media" className="card-base hover:shadow-md transition-shadow group">
            <Calendar className="h-8 w-8 text-[#fff848] mb-3" />
            <h2 className="font-semibold mb-1">{t(lang, 'card.social.title')}</h2>
            <p className="text-sm text-gray-500">{t(lang, 'card.social.desc')}</p>
            {!!(socialCfg.posts || socialCfg.reels || socialCfg.stories) && (
              <div className="mt-3 text-xs text-gray-400">
                {t(lang, 'card.social.perMonth', { posts: Number(socialCfg.posts ?? 0), reels: Number(socialCfg.reels ?? 0), stories: Number(socialCfg.stories ?? 0) })}
              </div>
            )}
          </Link>
        )}

        <Link href="/portal/contracts" className="card-base hover:shadow-md transition-shadow">
          <FileText className="h-8 w-8 text-gray-400 mb-3" />
          <h2 className="font-semibold mb-1">{t(lang, 'card.contracts.title')}</h2>
          <p className="text-sm text-gray-500">{t(lang, 'card.contracts.desc')}</p>
          {pendingContracts.length > 0 && (
            <div className="mt-3 status-badge bg-amber-100 text-amber-700">
              {t(lang, 'card.contracts.pending', { n: pendingContracts.length })}
            </div>
          )}
        </Link>

        {hasWebdesign && (
          <Link href="/portal/website" className="card-base hover:shadow-md transition-shadow">
            <Globe className="h-8 w-8 text-gray-400 mb-3" />
            <h2 className="font-semibold mb-1">{t(lang, 'card.website.title')}</h2>
            <p className="text-sm text-gray-500">{t(lang, 'card.website.desc')}</p>
          </Link>
        )}
      </div>

      {/* Contract info — from service_contracts */}
      {socialSC?.end_date && (
        <div className="card-base">
          <h2 className="font-semibold mb-3">{t(lang, 'contract.info')}</h2>
          <div className="grid sm:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-gray-500 text-xs mb-1">{t(lang, 'contract.start')}</div>
              <div className="font-medium">{formatDate(socialSC.start_date)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs mb-1">{t(lang, 'contract.end')}</div>
              <div className="font-medium">{formatDate(socialSC.end_date)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs mb-1">{t(lang, 'contract.remaining')}</div>
              <div
                className={`font-medium ${
                  days !== null && days < 0
                    ? 'text-red-600'
                    : days !== null && days <= 30
                    ? 'text-amber-600'
                    : 'text-green-600'
                }`}
              >
                {days !== null && days < 0
                  ? t(lang, 'contract.expired', { n: Math.abs(days) })
                  : t(lang, 'contract.days', { n: days ?? 0 })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active services */}
      {services.length > 0 && (
        <div className="card-base">
          <h2 className="font-semibold mb-3">{t(lang, 'dash.activeServices')}</h2>
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <span
                key={s.service_slug}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-full font-medium"
              >
                {SERVICE_LABELS[s.service_slug] ?? s.service_slug}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
