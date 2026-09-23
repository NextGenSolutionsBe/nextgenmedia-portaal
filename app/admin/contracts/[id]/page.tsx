export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { createAdminSupabaseClient, trySignedUrl } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import { ChevronLeft, CheckCircle2, ExternalLink, Settings2 } from 'lucide-react'
import { ContractActions } from './contract-actions'
import { GetekendeDocumenten } from './getekende-documenten'
import { laatsteArchief } from '@/lib/contract-archief'
import { laatsteMeldingStatus, meldingOpnieuwNodig } from '@/lib/contract-archief-model'
import { ContractMailButton } from '@/components/admin/contract-mail-button'
import { ContractLinkManager } from './contract-link-manager'
import { ContractPdfPreview } from './contract-pdf-preview'
import { ContractTimeline } from './contract-timeline'
import { ContractFacturatie } from './contract-facturatie'
import { ContractNavigatie } from './contract-navigatie'
import { statusInfo, canonicalStatus } from '@/lib/contract-status'
import { ContracttypeBewerker } from './contracttype-bewerker'
import { typeVanContract, isNietToegewezen } from '@/lib/contracten/types'
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
    const [clientRowResult, pdfUrl, signedPdfStored, signedPdfFallback, archief] = await Promise.all([
      contract.client_id
        ? admin.from('clients').select('id, company_name, btw_nummer').eq('id', contract.client_id).maybeSingle()
        : Promise.resolve({ data: null }),
      trySignedUrl(admin, 'contracts', contract.pdf_path),
      isSigned ? trySignedUrl(admin, 'contracts', contract.signed_pdf_path) : Promise.resolve(null),
      isSigned ? trySignedUrl(admin, 'contracts', `signed/${contract.id}.pdf`) : Promise.resolve(null),
      // Nieuwste archiefversie (certificaatnummer, datum) — enkel relevant als getekend.
      isSigned ? laatsteArchief(admin, contract.id).catch(() => null) : Promise.resolve(null),
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
      archief,
    }
  } catch {
    return null
  }
}

export default async function ContractDetailPage({ params }: { params: { id: string } }) {
  const data = await getContract(params.id)
  if (!data) notFound()

  const { contract: c, clientName, clientId, clientBtw, signatures, events, pdfUrl, signedPdfUrl, archief } = data
  const style = statusInfo(c.status)
  const statusKey = canonicalStatus(c.status)
  const isSigned = statusKey === 'getekend'
  const signLink = `${baseUrl()}/sign/${c.access_token}`
  const meldingEvents = (events as { event_type: string; created_at: string; meta?: Record<string, unknown> | null }[])
  const laatsteMelding = laatsteMeldingStatus(meldingEvents)
  const meldingOpnieuw = isSigned && meldingOpnieuwNodig(meldingEvents, !!archief)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/admin/contracts" className="btn-secondary px-2 shrink-0" title="Terug naar het overzicht">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <ContractNavigatie contractId={c.id} />
        <div className="flex-1 min-w-0 basis-full sm:basis-auto">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-xl sm:text-2xl font-bold truncate">{c.title}</h1>
            <span className={`status-badge ${style.cls}`}>{style.label}</span>
            <span className={`status-badge ${isNietToegewezen(c.contract_type) ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
              {typeVanContract(c.contract_type)}
            </span>
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
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* PDF Preview — schakel tussen origineel en getekend/ingevuld */}
        <div className="lg:col-span-2 space-y-6">
          <ContractPdfPreview originalUrl={pdfUrl} signedUrl={signedPdfUrl} />
          {/* Getekende documenten: contract + certificaat uit het archief, met downloads/afdrukken en de Legal-melding. */}
          {isSigned && (
            <GetekendeDocumenten
              contractId={c.id}
              accessToken={c.access_token}
              heeftGetekendePdf={!!signedPdfUrl}
              heeftOrigineel={!!pdfUrl}
              certificaatNr={archief?.certificaat_nr ?? null}
              gearchiveerdOp={archief?.gearchiveerd_op ?? null}
              archiefVersie={archief?.versie ?? null}
              signedAt={c.signed_at ?? null}
              meldingOpnieuw={meldingOpnieuw}
              laatsteMelding={laatsteMelding}
            />
          )}
          {/* Facturatie: voorstel controleren en bevestigen, facturen van dit contract, voortgang. */}
          <ContractFacturatie
            contractId={c.id} clientId={clientId} serviceSlug={c.service_slug ?? null} contractTitle={c.title} isSigned={!!isSigned}
            expectedCount={c.expected_invoice_count ?? null} invoiceFrequency={c.invoice_frequency ?? null} expectedAmountExcl={c.expected_invoice_amount_excl ?? null}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Info */}
          <div className="card-base space-y-3">
            <h2 className="font-semibold text-sm">Details</h2>
            <div className="space-y-2 text-sm">
              <ContracttypeBewerker contractId={c.id} initieel={c.contract_type ?? null} />
              <div className="flex justify-between">
                <span className="text-gray-500">Aangemaakt:</span>
                <span>{formatDate(c.created_at)}</span>
              </div>
              {c.start_date && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Startdatum:</span>
                  <span>{formatDate(c.start_date)}</span>
                </div>
              )}
              {c.end_date && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Einddatum:</span>
                  <span>{formatDate(c.end_date)}</span>
                </div>
              )}
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
          <ContractActions contract={{ id: c.id, status: c.status, access_token: c.access_token, title: c.title, clientName }} />

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
