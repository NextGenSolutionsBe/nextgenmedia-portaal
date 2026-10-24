import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { PrintButton } from '@/components/print-button'
import { CheckCircle2, FileText, Shield } from 'lucide-react'

function formatDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('nl-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('nl-BE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Brussels',
  }) + ' (CET/CEST)'
}

export default async function ReceiptPage({ params }: { params: { token: string } }) {
  const admin = createAdminSupabaseClient()

  const { data: contract } = await admin
    .from('contracts')
    .select('*')
    .eq('access_token', params.token)
    .maybeSingle()

  // Buiten de app ondertekend: er is geen elektronische handtekening om te bewijzen.
  if (!contract || contract.status !== 'signed' || contract.ondertekening_wijze === 'manueel') notFound()

  // Fetch client name
  let companyName: string | null = null
  if (contract.client_id) {
    const { data: clientRow } = await admin
      .from('clients')
      .select('company_name')
      .eq('id', contract.client_id)
      .maybeSingle()
    companyName = clientRow?.company_name ?? null
  }

  // Fetch signature record (most recent)
  const { data: sig } = await admin
    .from('contract_signatures')
    .select('*')
    .eq('contract_id', contract.id)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Generate signed URL for signature image
  let signatureImgUrl: string | null = null
  if (sig?.signature_url) {
    signatureImgUrl = sig.signature_url
  }

  const referenceId = `NGM-${contract.id.slice(0, 8).toUpperCase()}`

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gray-900 flex items-center justify-center">
            <span className="font-bold text-white text-xs">N</span>
          </div>
          <span className="font-bold text-sm">NextGenMedia</span>
        </div>
        <PrintButton />
      </header>

      {/* Print header (only visible when printing) */}
      <div className="hidden print:flex items-center justify-between px-0 pb-6 border-b border-gray-300 mb-8">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-gray-900 flex items-center justify-center">
            <span className="font-bold text-white text-sm">N</span>
          </div>
          <div>
            <div className="font-bold text-gray-900">NextGenMedia</div>
            <div className="text-xs text-gray-500">Ondertekeningsbewijs</div>
          </div>
        </div>
        <div className="text-right text-xs text-gray-400">
          <div>Ref: {referenceId}</div>
          <div>Gegenereerd op {new Date().toLocaleDateString('nl-BE')}</div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 print:py-0 print:px-0">

        {/* Status banner */}
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 flex items-center gap-4 mb-8 print:rounded-none print:border-green-300">
          <div className="h-14 w-14 bg-green-100 rounded-full flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-7 w-7 text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-green-900">Contract ondertekend</h1>
            <p className="text-sm text-green-700 mt-0.5">
              Dit document bevestigt de digitale ondertekening van het contract hieronder.
            </p>
          </div>
        </div>

        {/* Contract details */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm mb-6 print:shadow-none print:rounded-none print:border-gray-300">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-100">
            <FileText className="h-4 w-4 text-gray-400" />
            <span className="font-semibold text-gray-900">Contractgegevens</span>
          </div>
          <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-400 mb-1">Contract</div>
              <div className="font-medium text-gray-900">{contract.title}</div>
            </div>
            {companyName && (
              <div>
                <div className="text-xs text-gray-400 mb-1">Klant</div>
                <div className="font-medium text-gray-900">{companyName}</div>
              </div>
            )}
            <div>
              <div className="text-xs text-gray-400 mb-1">Referentienummer</div>
              <div className="font-mono text-gray-700">{referenceId}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Status</div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                <CheckCircle2 className="h-3 w-3" />
                Getekend
              </span>
            </div>
          </div>
        </div>

        {/* Signer details */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm mb-6 print:shadow-none print:rounded-none print:border-gray-300">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-100">
            <Shield className="h-4 w-4 text-gray-400" />
            <span className="font-semibold text-gray-900">Ondertekeningsgegevens</span>
          </div>
          <div className="px-6 py-4 space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-400 mb-1">Naam ondertekenaar</div>
                <div className="font-medium text-gray-900">{contract.signer_name ?? sig?.signer_name ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">E-mailadres</div>
                <div className="text-gray-700">{contract.signer_email ?? sig?.signer_email ?? '—'}</div>
              </div>
              {sig?.signer_phone && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">Telefoon</div>
                  <div className="text-gray-700">{sig.signer_phone}</div>
                </div>
              )}
              {sig?.signer_vat && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">BTW-nummer</div>
                  <div className="text-gray-700">{sig.signer_vat}</div>
                </div>
              )}
              {sig?.signer_address && (
                <div className="sm:col-span-2">
                  <div className="text-xs text-gray-400 mb-1">Adres</div>
                  <div className="text-gray-700">{sig.signer_address}</div>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-gray-100">
              <div className="text-xs text-gray-400 mb-1">Tijdstip van ondertekening</div>
              <div className="font-medium text-gray-900">{formatDateTime(contract.signed_at ?? sig?.signed_at)}</div>
            </div>

            {sig?.ip_address && (
              <div>
                <div className="text-xs text-gray-400 mb-1">IP-adres</div>
                <div className="font-mono text-xs text-gray-600">{sig.ip_address}</div>
              </div>
            )}
          </div>
        </div>

        {/* Signature image */}
        {signatureImgUrl && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm mb-6 print:shadow-none print:rounded-none print:border-gray-300">
            <div className="px-6 py-4 border-b border-gray-100">
              <span className="font-semibold text-gray-900 text-sm">Digitale handtekening</span>
            </div>
            <div className="px-6 py-4">
              <div className="border border-gray-200 rounded-xl bg-gray-50 p-4 flex items-center justify-center" style={{ minHeight: 120 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={signatureImgUrl}
                  alt="Handtekening"
                  className="max-h-28 max-w-full object-contain"
                />
              </div>
              <p className="text-xs text-gray-400 mt-2 text-center">
                Digitale handtekening · {formatDateLong(contract.signed_at ?? sig?.signed_at)}
              </p>
            </div>
          </div>
        )}

        {/* Legal notice */}
        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-6 py-5 text-xs text-gray-500 space-y-2 print:rounded-none print:border-gray-300">
          <div className="font-semibold text-gray-700 mb-2">Juridische verklaring</div>
          <p>
            Dit document is een officieel ondertekeningsbewijs voor het contract &ldquo;{contract.title}&rdquo;,
            dat digitaal werd ondertekend via het NextGenMedia klantportaal.
          </p>
          <p>
            De digitale handtekening is tot stand gekomen door de vrije, geïnformeerde en ondubbelzinnige
            toestemming van de ondertekenaar, in overeenstemming met de Belgische wetgeving inzake
            elektronische handtekeningen (Wet van 21 juli 2016 en Verordening (EU) Nr. 910/2014 — eIDAS).
          </p>
          <p>
            De tijdstempel en het IP-adres zijn vastgelegd op het moment van ondertekening als aanvullend
            bewijs van authenticiteit. Dit document mag niet worden gewijzigd na ondertekening.
          </p>
          <p className="pt-1 border-t border-gray-200">
            NextGenMedia · Ref: {referenceId} · Gegenereerd op {new Date().toLocaleDateString('nl-BE')}
          </p>
        </div>

      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white; }
          .print\\:hidden { display: none !important; }
          .print\\:flex { display: flex !important; }
          .print\\:block { display: block !important; }
        }
      `}</style>
    </div>
  )
}
