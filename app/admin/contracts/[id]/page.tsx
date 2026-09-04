export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { createAdminSupabaseClient, trySignedUrl } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import { ChevronLeft, FileText, CheckCircle2, ExternalLink, Settings2, Download } from 'lucide-react'
import { ContractActions } from './contract-actions'
import { ContractMailButton } from '@/components/admin/contract-mail-button'
import { ContractLinkManager } from './contract-link-manager'
import { ContractPdfPreview } from './contract-pdf-preview'
import { ContractTimeline } from './contract-timeline'
import { ContractInvoices } from './contract-invoices'
import { statusInfo, canonicalStatus } from '@/lib/contract-status'
import { baseUrl } from '@/lib/email'

async function getContract(id: string) {
  try {
    const admin = createAdminSupabaseClient()

    // All independent reads in one round-trip. Client lookup chains off the
    // contract result below; everything else parallelizes.
    const [{ data: contract }, { data: signatures }, { data: events }] = await Promise.all([
      admin.from('contracts').select('*').eq('id', id).maybeSingle(),
      admin.from('contract_signatures').select('*').eq('contract_id', id).order('signed_at', { ascending: false }),
      admin.from('contract_events').select('*').eq('contract_id', id).order('created_at', { ascending: false }),
    ])

    if (!contract) return null

    // Parallelize the remaining I/O: client lookup + both signed URLs.
    // For signed PDFs we speculatively request both the stored path AND the
    // conventional `signed/{id}.pdf` fallback — whichever resolves wins.
    const isSigned = canonicalStatus(contract.status) === 'getekend'
    const [clientRowResult, pdfUrl, signedPdfStored, signedPdfFallback] = await Promise.all([
      contract.client_id
        ? admin.from('clients').select('id, company_name, btw_nummer').eq('id', contract.client_id).maybeSingle()
        : Promise.resolve({ data: null }),
      trySignedUrl(admin, 'contracts', contract.pdf_path),
      isSigned ? trySignedUrl(admin, 'contracts', contract.signed_pdf_path) : Promise.resolve(null),
      isSigned ? trySignedUrl(admin, 'contracts', `signed/${contract.id}.pdf`) : Promise.resolve(null),
    ])

    return {
      contract,
      clientName: clientRowResult.data?.company_name ?? null,
      clientId: clientRowResult.data?.id ?? null,
      clientBtw: (clientRowResult.data as { btw_nummer?: string | null } | null)?.btw_nummer ?? null,
      signatures: signatures ?? [],
      events: events ?? [],
      pdfUrl,
      signedPdfUrl: signedPdfStored ?? signedPdfFallback,
    }
  } catch {
    return null
  }
}

export default async function ContractDetailPage({ params }: { params: { id: string } }) {
  const data = await getContract(params.id)
  if (!data) notFound()

  const { contract: c, clientName, clientId, clientBtw, signatures, events, pdfUrl, signedPdfUrl } = data
  const style = statusInfo(c.status)
  const statusKey = canonicalStatus(c.status)
  const isSigned = statusKey === 'getekend'
  const signLink = `${baseUrl()}/sign/${c.access_token}`

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/admin/contracts" className="btn-secondary px-2 shrink-0">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-xl sm:text-2xl font-bold truncate">{c.title}</h1>
            <span className={`status-badge ${style.cls}`}>{style.label}</span>
          </div>
          {clientId && clientName && (
            <Link href={`/admin/clients/${clientId}`} className="text-sm text-gray-500 hover:text-black">
              {clientName}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {!isSigned && statusKey !== 'geannuleerd' && (
            <ContractMailButton
              contractId={c.id}
              contractTitle={c.title}
              signLink={signLink}
              defaultEmail={c.signer_email ?? null}
              signerName={c.signer_name ?? null}
              clientName={clientName}
              expiresAt={c.expires_at ?? null}
              label="Verstuur contractmail"
            />
          )}
          {!isSigned && (
            <Link
              href={`/admin/contracts/${c.id}/setup`}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">AI-velden & zone</span>
              <span className="sm:hidden">Velden</span>
            </Link>
          )}
          {isSigned && (
            <a
              href={`/api/admin/contracts/${c.id}/download?type=signed`}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Getekend contract</span>
              <span className="sm:hidden">Download</span>
            </a>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* PDF Preview — schakel tussen origineel en getekend/ingevuld */}
        <div className="lg:col-span-2">
          <ContractPdfPreview originalUrl={pdfUrl} signedUrl={signedPdfUrl} />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Info */}
          <div className="card-base space-y-3">
            <h2 className="font-semibold text-sm">Details</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Aangemaakt:</span>
                <span>{formatDate(c.created_at)}</span>
              </div>
              {c.sent_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Verstuurd:</span>
                  <span>{formatDate(c.sent_at)}</span>
                </div>
              )}
              {c.signed_at && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Getekend:</span>
                  <span>{formatDate(c.signed_at)}</span>
                </div>
              )}
              {c.signer_name && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Ondertekenaar:</span>
                  <span>{c.signer_name}</span>
                </div>
              )}
              {c.service_slug && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Dienst:</span>
                  <span className="capitalize">{c.service_slug.replace(/-/g, ' ')}</span>
                </div>
              )}
              {clientBtw && (
                <div className="flex justify-between">
                  <span className="text-gray-500">BTW:</span>
                  <span className="font-mono">{clientBtw}</span>
                </div>
              )}
              {c.signer_email && (
                <div className="flex justify-between">
                  <span className="text-gray-500">E-mail:</span>
                  <span className="truncate text-right max-w-[140px]">{c.signer_email}</span>
                </div>
              )}
            </div>
          </div>

          {/* Facturen gekoppeld aan dit contract */}
          <ContractInvoices
            contractId={c.id}
            clientId={clientId}
            serviceSlug={c.service_slug ?? null}
            contractTitle={c.title}
            expectedCount={c.expected_invoice_count ?? null}
            invoiceFrequency={c.invoice_frequency ?? null}
            expectedAmountExcl={c.expected_invoice_amount_excl ?? null}
          />

          {/* Sign link — only for unsigned contracts */}
          {!isSigned && statusKey !== 'geannuleerd' && (
            <>
              <div className="card-base space-y-3">
                <h2 className="font-semibold text-sm">Ondertekeningslink</h2>
                {c.expires_at && (
                  <p className="text-xs text-gray-500">
                    Verloopt op {formatDate(c.expires_at)}{statusKey === 'verlopen' ? ' — verlopen' : ''}
                  </p>
                )}
                <div className="flex gap-2">
                  <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1.5 truncate">
                    /sign/{c.access_token?.slice(0, 16)}...
                  </code>
                  <a href={`/sign/${c.access_token}`} target="_blank" rel="noreferrer" className="btn-secondary text-xs px-2">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
              <ContractLinkManager contractId={c.id} initialExpiresAt={c.expires_at ?? null} />
            </>
          )}

          {/* Signed PDF — only when signed */}
          {isSigned && (
            <div className="card-base space-y-3">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Getekend contract
              </h2>
              {signedPdfUrl ? (
                <div className="space-y-2">
                  <a
                    href={`/api/admin/contracts/${c.id}/download?type=signed`}
                    className="btn-primary w-full justify-center text-sm"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download getekende PDF
                  </a>
                  <p className="text-xs text-gray-400 text-center">
                    Handtekening is rechtstreeks op het contract geplaatst
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pdfUrl && (
                    <a
                      href={`/api/admin/contracts/${c.id}/download?type=original`}
                      className="btn-secondary w-full justify-center text-sm"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download origineel contract
                    </a>
                  )}
                  <a
                    href={`/sign/${c.access_token}/receipt`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary w-full justify-center text-sm"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Ondertekeningsbewijs
                  </a>
                  <p className="text-xs text-gray-400 text-center">
                    De ingebedde getekende PDF is niet beschikbaar — gebruik het origineel + bewijs als juridisch bewijs.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Setup link — only for unsigned contracts */}
          {!isSigned && c.pdf_path && (
            <div className="card-base space-y-2">
              <h2 className="font-semibold text-sm">Handtekeningzone</h2>
              <Link
                href={`/admin/contracts/${c.id}/setup`}
                className="btn-secondary w-full justify-center text-sm"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Zone instellen
              </Link>
            </div>
          )}

          {/* Actions */}
          <ContractActions contract={{ id: c.id, status: c.status, access_token: c.access_token }} />

          {/* Signatures */}
          {signatures.length > 0 && (
            <div className="card-base space-y-3">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Handtekeningen
              </h2>
              {signatures.map((sig: {
                id: string
                signer_name: string
                signer_email: string
                signed_at: string
                ip_address?: string | null
              }) => (
                <div key={sig.id} className="text-sm space-y-1">
                  <div className="font-medium">{sig.signer_name}</div>
                  <div className="text-gray-500">{sig.signer_email}</div>
                  <div className="text-xs text-gray-400">{formatDate(sig.signed_at)}</div>
                  {sig.ip_address && (
                    <div className="text-xs text-gray-400 font-mono">IP: {sig.ip_address}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Tijdlijn */}
          <div className="card-base space-y-3">
            <h2 className="font-semibold text-sm">Tijdlijn</h2>
            <ContractTimeline events={events} />
          </div>
        </div>
      </div>
    </div>
  )
}
