import { createAdminSupabaseClient, trySignedUrl } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import { FileText, CheckCircle2, Download, Eye, Clock } from 'lucide-react'
import { canonicalStatus, statusInfo } from '@/lib/contract-status'
import { requirePortalView, canAccessContract } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export default async function PortalContractsPage() {
  const session = await requirePortalView('contracts')
  // Alle contracten op deze pagina horen bij session.clientId; rechten centraal via canAccessContract.
  const canSign = canAccessContract(session, { client_id: session.clientId }, 'sign')
  const canDownload = canAccessContract(session, { client_id: session.clientId }, 'download')

  const admin = createAdminSupabaseClient()

  // Use select('*') so missing columns (e.g. signed_pdf_path before migration) never
  // cause a silent PostgREST error that returns null data.
  const { data: contractsRaw, error: fetchErr } = await admin
    .from('contracts')
    .select('*')
    .eq('client_id', session.clientId)
    .order('created_at', { ascending: false })

  if (fetchErr) {
    console.error('[portal/contracts] fetch error:', fetchErr.message)
  }

  const contracts = await Promise.all(
    (contractsRaw ?? []).map(async (c) => {
      // Both signed and original URLs in parallel
      const [signedPdfUrl, originalPdfUrl] = await Promise.all([
        // Try stored path, then conventional fallback
        (async () => {
          const url = await trySignedUrl(admin, 'contracts', c.signed_pdf_path, 3600 * 24)
          if (url) return url
          return trySignedUrl(admin, 'contracts', `signed/${c.id}.pdf`, 3600 * 24)
        })(),
        trySignedUrl(admin, 'contracts', c.pdf_path, 3600),
      ])
      return { ...c, signedPdfUrl, originalPdfUrl }
    })
  )

  // Contracts waiting for signature — include verzonden/geopend; exclude klaar_voor_verzenden (not yet sent to client)
  const pendingContracts = contracts.filter((c) => ['verzonden', 'geopend', 'ingevuld'].includes(canonicalStatus(c.status)))
  const signedContracts = contracts.filter((c) => canonicalStatus(c.status) === 'getekend')
  const otherContracts = contracts.filter((c) => !['verzonden', 'geopend', 'ingevuld', 'getekend'].includes(canonicalStatus(c.status)))

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Contracten</h1>
        <p className="text-sm text-gray-500 mt-0.5">Overzicht van uw contracten</p>
      </div>

      {contracts.length === 0 ? (
        <div className="card-base text-center py-12 text-gray-400">
          <FileText className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nog geen contracten beschikbaar</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* ── Pending: sign now ── */}
          {pendingContracts.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                Wacht op uw handtekening ({pendingContracts.length})
              </h2>
              <div className="space-y-3">
                {pendingContracts.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border-2 border-[#fff848] bg-[#fff848]/5"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 bg-amber-100">
                        <FileText className="h-5 w-5 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{c.title}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {c.sent_at ? `Verstuurd op ${formatDate(c.sent_at)}` : formatDate(c.created_at)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.originalPdfUrl && (
                        <a
                          href={c.originalPdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-secondary text-xs flex-1 sm:flex-none justify-center"
                          title="Bekijk contract"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Bekijken
                        </a>
                      )}
                      {canSign && (
                        <Link
                          href={`/sign/${c.access_token}`}
                          className="btn-primary text-xs flex-1 sm:flex-none justify-center"
                        >
                          ✍️ Ondertekenen
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Signed contracts ── */}
          {signedContracts.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Ondertekende contracten ({signedContracts.length})
              </h2>
              <div className="space-y-3">
                {signedContracts.map((c) => {
                  const viewUrl = c.signedPdfUrl ?? c.originalPdfUrl
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-4 p-4 rounded-xl border border-gray-200 bg-white"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 bg-green-100">
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{c.title}</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {c.signed_at ? `Getekend op ${formatDate(c.signed_at)}` : formatDate(c.created_at)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {viewUrl && (
                          <a
                            href={viewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-secondary text-xs"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Bekijken
                          </a>
                        )}
                        {c.signedPdfUrl && canDownload && (
                          <a
                            href={c.signedPdfUrl}
                            download
                            className="btn-secondary text-xs"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Downloaden
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── Other (draft / cancelled / expired) ── */}
          {otherContracts.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 mb-2">Overige</h2>
              <div className="space-y-2">
                {otherContracts.map((c) => {
                  const style = statusInfo(c.status)
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-4 py-3 px-4 rounded-xl border border-gray-100 bg-white"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-4 w-4 text-gray-300 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate text-gray-500">{c.title}</div>
                          <div className="text-xs text-gray-400">{formatDate(c.created_at)}</div>
                        </div>
                      </div>
                      <span className={`status-badge ${style.cls} shrink-0`}>{style.label}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  )
}
