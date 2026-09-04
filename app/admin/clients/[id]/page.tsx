export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatDate, formatEuro, SERVICE_LABELS, daysUntil } from '@/lib/utils'
import Link from 'next/link'
import { ChevronLeft, Globe, Calendar, FileText } from 'lucide-react'
import { ClientEditForm } from './client-edit-form'
import { DeleteClientButton } from './delete-client-button'
import { PortalAccessCard } from './portal-access-card'
import { CredentialsCard } from '@/components/credentials-card'
import { ClientUsers } from './client-users'
import { ClientHub } from './client-hub'
import { ClientLifecycleBlock } from './client-lifecycle'
import { ClientMonths } from './client-months'
import { ClientTasks } from './client-tasks'
import { ClientBlogs } from './client-blogs'
import { FEATURES } from '@/lib/features'
import { ClientCms } from './client-cms'

async function getClient(id: string) {
  const admin = createAdminSupabaseClient()

  // Fetch the client first — this alone decides 404 vs render.
  // select('*') so a missing column can never turn into a silent null result.
  const { data: client } = await admin
    .from('clients')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!client) {
    return { client: null, services: [], contracts: [], scontracts: [] }
  }

  // Secondary data — Supabase resolves with { data, error }, never throws,
  // so a missing table/column just yields null (page still renders).
  const [{ data: services }, { data: contracts }, { data: scontracts }] = await Promise.all([
    admin.from('client_services').select('*').eq('client_id', id),
    admin.from('contracts').select('*').eq('client_id', id).order('created_at', { ascending: false }),
    admin.from('service_contracts').select('*').eq('client_id', id),
  ])

  return {
    client,
    services: services ?? [],
    contracts: contracts ?? [],
    scontracts: scontracts ?? [],
  }
}

function ContractStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-blue-100 text-blue-700',
    viewed: 'bg-amber-100 text-amber-700',
    signed: 'bg-green-100 text-green-700',
    expired: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-600',
  }
  const labels: Record<string, string> = {
    draft: 'Concept', sent: 'Verstuurd', viewed: 'Bekeken',
    signed: 'Getekend', expired: 'Verlopen', cancelled: 'Geannuleerd',
  }
  return (
    <span className={`status-badge ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[status] ?? status}
    </span>
  )
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { client, services, contracts, scontracts } = await getClient(id)

  if (!client) notFound()

  const activeServices = services.filter((s: { active: boolean }) => s.active)
  const hasSocial = activeServices.some((s: { service_slug: string }) => s.service_slug === 'social-media')
  const hasWebdesign = activeServices.some((s: { service_slug: string }) => s.service_slug === 'webdesign')

  const activeServiceSlugs = activeServices.map((s: any) => s.service_slug)

  // Build portal access data — all services that have a client_services record
  const portalAccessServices = services.map((svc: any) => {
    const signedContract = contracts.find((c: any) =>
      c.service_slug === svc.service_slug && c.status === 'signed'
    )
    return {
      service_slug: svc.service_slug as string,
      active: svc.active as boolean,
      signed_contract_id: signedContract?.id ?? null,
    }
  }).filter((s: any) =>
    // Only show services that matter for portal access
    ['social-media', 'webdesign'].includes(s.service_slug)
  )
  const socialService = scontracts.find((s: any) => s.service_slug === 'social-media')
  const socialConfig = (socialService as any)?.config ?? {}
  const adsService = services.find((s: any) => s.service_slug === 'ads')
  const adsConfig = (adsService as any)?.config ?? {}
  const webdesignService = services.find((s: any) => s.service_slug === 'webdesign')
  const webdesignConfig = (webdesignService as any)?.config ?? {}

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/clients" className="btn-secondary px-2">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{client.company_name}</h1>
          {client.niche && <p className="text-sm text-gray-500">{client.niche}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasSocial && (
            <Link href={`/admin/services/social-media?client=${id}`} className="btn-secondary">
              <Calendar className="h-4 w-4" />
              Kalender
            </Link>
          )}
          <Link href="/admin/contracts/new" className="btn-primary">
            <FileText className="h-4 w-4" />
            Nieuw contract
          </Link>
          <DeleteClientButton clientId={id} companyName={client.company_name} />
        </div>
      </div>

      {/* Centrale hub: klikbaar overzicht van alles wat aan deze klant hangt */}
      <ClientHub clientId={id} btw={client.btw_nummer ?? null} />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Info */}
        <div className="space-y-4">
          {/* Contact info */}
          <div className="card-base space-y-3">
            <h2 className="font-semibold text-sm text-gray-900">Contactgegevens</h2>
            {client.contact_name && (
              <div className="text-sm">
                <span className="text-gray-500">Contactpersoon:</span>{' '}
                <span className="font-medium">{client.contact_name}</span>
              </div>
            )}
            {client.website_url && (
              <a href={client.website_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 text-sm text-gray-700 hover:text-black">
                <Globe className="h-4 w-4 text-gray-400" />
                {client.website_url.replace(/^https?:\/\//, '')}
              </a>
            )}
            {client.btw_nummer && (
              <div className="text-sm">
                <span className="text-gray-500">BTW:</span>{' '}
                <span className="font-medium font-mono">{client.btw_nummer}</span>
              </div>
            )}
          </div>

          {/* Login credentials */}
          <CredentialsCard
            endpoint={`/api/admin/clients/${id}/credentials`}
            email={client.email ?? null}
          />

          {/* Subaccounts & rechten */}
          <div id="gebruikers" className="scroll-mt-20">
            <ClientUsers clientId={id} clientName={client.company_name} ownerEmail={client.email ?? null} />
          </div>

          {/* Klant Lifecycle (batch, contract, reviews) */}
          <ClientLifecycleBlock clientId={id} companyName={client.company_name} />

          {/* Gepland in maanden */}
          <ClientMonths clientId={id} />

          {/* Klanttaken */}
          <div id="taken" className="scroll-mt-20">
            <ClientTasks clientId={id} />
          </div>

          {/* Blogs — tijdelijk verborgen via lib/features.ts */}
          {FEATURES.blogs && <ClientBlogs clientId={id} />}

          {/* Website-CMS (Framer) */}
          <ClientCms clientId={id} />

          {/* Revenue */}
          <div className="card-base space-y-3">
            <h2 className="font-semibold text-sm text-gray-900">Omzet</h2>
            <div className="text-2xl font-bold">
              {client.revenue_value ? formatEuro(client.revenue_value) : '—'}
            </div>
            {client.revenue_type && (
              <span className={`status-badge ${client.revenue_type === 'recurring' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                {client.revenue_type === 'recurring' ? 'Recurring' : 'Eenmalig'}
              </span>
            )}
          </div>

          {/* Contract period — from service_contracts */}
          {scontracts.length > 0 && (() => {
            const sc = (scontracts.find((s: { service_slug: string }) => s.service_slug === 'social-media') ?? scontracts[0]) as {
              start_date: string | null
              end_date: string | null
              duration_months: number | null
            }
            const daysLeft = daysUntil(sc.end_date)
            return (
              <div className="card-base space-y-3">
                <h2 className="font-semibold text-sm text-gray-900">Contractperiode</h2>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Start:</span>
                    <span>{formatDate(sc.start_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Einde:</span>
                    <span>{formatDate(sc.end_date)}</span>
                  </div>
                  {sc.duration_months && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Duur:</span>
                      <span>{sc.duration_months} maanden</span>
                    </div>
                  )}
                </div>
                {daysLeft !== null && (
                  <div className={`text-sm font-medium ${daysLeft < 0 ? 'text-red-600' : daysLeft <= 14 ? 'text-amber-600' : 'text-green-600'}`}>
                    {daysLeft < 0
                      ? `${Math.abs(daysLeft)} dagen verlopen`
                      : `${daysLeft} dagen resterend`}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Diensten — ALL services (active + inactive) with contract status */}
          <div className="card-base space-y-3">
            <h2 className="font-semibold text-sm text-gray-900">Diensten</h2>
            <div className="space-y-1.5">
              {services.length === 0 ? (
                <p className="text-sm text-gray-400">Geen diensten</p>
              ) : (
                services.map((s: { id: string; service_slug: string; active: boolean }) => {
                  const slugContract = contracts.find((c: any) => c.service_slug === s.service_slug)
                  return (
                    <div key={s.id} className="flex items-start justify-between gap-2 py-1.5 px-2 rounded-lg bg-gray-50">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900">
                          {SERVICE_LABELS[s.service_slug] ?? s.service_slug}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {slugContract
                            ? `Contract: ${slugContract.status === 'signed' ? 'Getekend' : slugContract.status === 'sent' ? 'Verstuurd' : slugContract.status === 'draft' ? 'Concept' : slugContract.status}`
                            : 'Geen contract'}
                        </div>
                      </div>
                      <span className={`status-badge shrink-0 ${s.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                        {s.active ? 'Actief' : 'Inactief'}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Portal access management */}
          {portalAccessServices.length > 0 && (
            <PortalAccessCard clientId={id} services={portalAccessServices} />
          )}
        </div>

        {/* Right: Contracts + edit */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contracts */}
          <div className="card-base">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Contracten</h2>
              <Link href="/admin/contracts/new" className="btn-secondary text-xs">
                <FileText className="h-3.5 w-3.5" />
                Nieuw contract
              </Link>
            </div>
            {contracts.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-6">
                Nog geen contracten voor deze klant
              </div>
            ) : (
              <div className="space-y-2">
                {contracts.map((c: {
                  id: string
                  title: string
                  status: string
                  service_slug: string | null
                  sent_at: string | null
                  signed_at: string | null
                  created_at: string
                }) => (
                  <Link
                    key={c.id}
                    href={`/admin/contracts/${c.id}`}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div>
                      <div className="text-sm font-medium">{c.title}</div>
                      <div className="text-xs text-gray-400 flex items-center gap-2">
                        <span>
                          {c.signed_at
                            ? `Getekend op ${formatDate(c.signed_at)}`
                            : c.sent_at
                            ? `Verstuurd op ${formatDate(c.sent_at)}`
                            : `Aangemaakt op ${formatDate(c.created_at)}`}
                        </span>
                        {c.service_slug && (
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] uppercase tracking-wide">
                            {SERVICE_LABELS[c.service_slug] ?? c.service_slug}
                          </span>
                        )}
                      </div>
                    </div>
                    <ContractStatusBadge status={c.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Social Media config */}
          {hasSocial && (() => {
            const sc = scontracts.find((s: { service_slug: string }) => s.service_slug === 'social-media') as {
              config?: { posts?: number; reels?: number; stories?: number; channels?: string[] } | null
            } | undefined
            const cfg = sc?.config ?? {}
            return (
              <div className="card-base">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-gray-900">Social Media</h2>
                  <Link href={`/admin/services/social-media?client=${id}`} className="btn-secondary text-xs">
                    <Calendar className="h-3.5 w-3.5" />
                    Kalender openen
                  </Link>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <div className="text-2xl font-bold">{cfg.posts ?? 0}</div>
                    <div className="text-xs text-gray-500 mt-1">Posts/maand</div>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <div className="text-2xl font-bold">{cfg.reels ?? 0}</div>
                    <div className="text-xs text-gray-500 mt-1">Reels/maand</div>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <div className="text-2xl font-bold">{cfg.stories ?? 0}</div>
                    <div className="text-xs text-gray-500 mt-1">Stories/maand</div>
                  </div>
                </div>
                {cfg.channels && cfg.channels.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {cfg.channels.map((p: string) => (
                      <span key={p} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Edit form */}
          <ClientEditForm
            client={client}
            services={activeServiceSlugs}
            socialConfig={socialConfig}
            adsConfig={adsConfig}
            webdesignConfig={webdesignConfig}
          />
        </div>
      </div>
    </div>
  )
}
