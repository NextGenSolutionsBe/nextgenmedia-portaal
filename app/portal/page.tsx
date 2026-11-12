export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate, SERVICE_LABELS, daysUntil } from '@/lib/utils'
import Link from 'next/link'
import { Calendar, FileText, Globe, Clock, ArrowRight } from 'lucide-react'
import { resolvePortalSession, sessionCan } from '@/lib/portal-auth'
import { getLang } from '@/lib/i18n-server'
import { t } from '@/lib/i18n'
import { goedkeuringenVoorKlant } from '@/lib/content/goedkeuring-deadlines'
import { kalenderRechtenVoorSessie } from '@/lib/content/kalender-beheer-server'
import { kanGoedkeuren } from '@/lib/content/kalender-rol'
import { GoedkeuringOverzicht } from '@/components/portal/goedkeuring-overzicht'
import { UitgelichtNieuws, Snelkoppelingen, PartnersStrook } from '@/components/portal/dashboard/snelkoppelingen'
import { MODULE_IMPLEMENTED, type PortalModule } from '@/lib/portal-permissions'
import { metExtra } from '@/lib/nieuwsbrieven-server'
import type { Nieuwsbrief } from '@/lib/nieuwsbrieven'
import type { Partner } from '@/lib/partners'
import { meetingTeam } from '@/lib/meetings/klantboeking-server'
import { portaalEvents } from '@/lib/events-server'

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

  // Contentkalender: enkel tonen als de rol van de klant hem opent ("Geen toegang" = nergens),
  // en de vraag om goed te keuren enkel aan wie mag goedkeuren.
  const kalender = services.some((s) => s.service_slug === 'social-media') ? await kalenderRechtenVoorSessie(admin, session) : null
  const hasSocial = !!kalender?.bekijken
  const magGoedkeuren = !!kalender && kanGoedkeuren(kalender)
  const pendingScripts = magGoedkeuren ? (pendingScriptsCount ?? 0) : 0
  const hasWebdesign = services.some((s) => s.service_slug === 'webdesign')
  // Wat op goedkeuring wacht, per aangevraagde termijn, met de aftelling — bovenaan.
  const goedkeuringen = magGoedkeuren ? await goedkeuringenVoorKlant(admin, clientId) : []
  const pendingContracts = canContracts ? contracts.filter((c) => ['sent', 'viewed'].includes(c.status)) : []

  // Dashboard: uitgelicht nieuws, snelkoppelingen en partners, enkel voor modules met recht.
  const magModule = (m: PortalModule) => MODULE_IMPLEMENTED[m] && sessionCan(session, m, 'view')
  const mag = { diensten: magModule('diensten'), consultancy: magModule('consultancy'), founders: magModule('founders'), meetings: magModule('meetings'), bestanden: magModule('files'), events: magModule('events') }
  const [{ data: nieuwsRij }, team, evts, { data: partnerRijen }] = await Promise.all([
    magModule('nieuws')
      ? admin.from('nieuwsbrieven').select('id, titel, slug, categorie, categorie_label, samenvatting, cover_pad, cover_youtube_id, cover_formaat, cover_embed, blokken, uitgelicht, gepubliceerd_op, auteur_naam')
        .eq('status', 'gepubliceerd').eq('uitgelicht', true).order('gepubliceerd_op', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    mag.meetings ? meetingTeam(admin).catch(() => []) : Promise.resolve([]),
    mag.events ? portaalEvents(admin, clientId).catch(() => []) : Promise.resolve([]),
    magModule('partners') ? admin.from('onze_partners').select('*').eq('zichtbaar', true).order('volgorde').order('created_at') : Promise.resolve({ data: [] }),
  ])
  const nieuwsItem = nieuwsRij ? (() => { const { blokken: _b, ...rest } = metExtra(nieuwsRij as Nieuwsbrief); void _b; return rest })() : null
  const komend = evts.filter((e) => e.status === 'gepubliceerd' && Date.parse(e.einde_op) > Date.now())
  const volgend = komend.find((e) => e.mijn.length > 0) ?? komend[0] ?? null
  const eventMini = volgend ? { id: volgend.id, titel: volgend.titel, start_op: volgend.start_op, einde_op: volgend.einde_op, prijs_cents: volgend.prijs_cents, ingeschreven: volgend.mijn.length > 0 } : null

  // Social media contract config (posts/reels/stories come from service_contracts.config)
  const socialSC = serviceContracts.find((sc) => sc.service_slug === 'social-media')
  const socialCfg = socialSC?.config ?? {}
  const days = daysUntil(socialSC?.end_date ?? null)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">{t(lang, 'dash.welcome', { name: client.company_name })}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t(lang, 'dash.subtitle')}</p>
      </div>

      <GoedkeuringOverzicht goedkeuringen={goedkeuringen} lang={lang} />

      {/* Alerts */}
      {(pendingContracts.length > 0 || pendingScripts > 0) && (
        <div className="space-y-2">
          {pendingContracts.map((c) => (
            <Link
              key={c.id}
              href={canSign ? `/sign/${c.access_token}` : '/portal/contracts'}
              className="flex items-center justify-between gap-3 p-4 bg-gray-100 border border-gray-900 rounded-xl"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-5 w-5 text-gray-700 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{c.title}</div>
                  <div className="text-xs text-gray-500">{t(lang, 'dash.contractPending')}</div>
                </div>
              </div>
              <span className="btn-primary text-xs shrink-0">{t(lang, 'dash.sign')}</span>
            </Link>
          ))}
          {pendingScripts > 0 && (
            <Link
              href="/portal/social-media"
              className="flex items-center justify-between gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Clock className="h-5 w-5 text-amber-600 shrink-0" />
                <div>
                  <div className="font-medium text-sm text-amber-800">
                    {t(lang, pendingScripts === 1 ? 'dash.scriptsOne' : 'dash.scriptsOther', { n: pendingScripts })}
                  </div>
                  <div className="text-xs text-amber-600">{t(lang, 'dash.scriptsReview')}</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-amber-600 shrink-0" />
            </Link>
          )}
        </div>
      )}

      {nieuwsItem && <UitgelichtNieuws item={nieuwsItem} />}

      <Snelkoppelingen mag={mag} team={team.map((t) => ({ id: t.id, voornaam: t.voornaam, foto_url: t.foto_url }))} event={eventMini} aantalEvents={komend.length} />

      {/* Services grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {hasSocial && (
          <Link href="/portal/social-media" className="card-base hover:shadow-md transition-shadow group">
            <Calendar className="h-6 w-6 text-gray-900 mb-3" />
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

      <PartnersStrook partners={(partnerRijen ?? []) as Partner[]} />
    </div>
  )
}
