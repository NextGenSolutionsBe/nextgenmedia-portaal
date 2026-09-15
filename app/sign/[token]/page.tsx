export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { FileText, CheckCircle2, Clock } from 'lucide-react'
import { SignatureForm } from './signature-form'
import { Logo } from '@/components/logo'
import { logContractEvent } from '@/lib/contract-audit'

export default async function SignContractPage({ params }: { params: { token: string } }) {
  const admin = createAdminSupabaseClient()

  const { data: contract, error } = await admin
    .from('contracts')
    .select('*')
    .eq('access_token', params.token)
    .maybeSingle()

  if (error) console.error('[sign page] error:', error.message)
  if (!contract) notFound()

  // ── Vervaldatum: verlopen tekenlink blokkeert toegang ──────────────────────
  const alreadySignedStatus = contract.status === 'signed' || contract.status === 'getekend'
  let isExpired = false
  if (!alreadySignedStatus && contract.expires_at) {
    const today = new Date().toISOString().slice(0, 10)
    if (String(contract.expires_at).slice(0, 10) < today) {
      isExpired = true
      // Best-effort: markeer verlopen + log (één keer).
      if (contract.status !== 'expired') {
        // NIET stil wegslikken. Deze update faalde jarenlang op een te enge
        // CHECK-constraint zonder dat iemand het merkte; de status "Verlopen"
        // bestond wel in het scherm maar werd nooit bereikt. De ontvanger mag
        // er niets van merken, maar wij willen het in de logs zien.
        const { error } = await admin.from('contracts').update({ status: 'expired' }).eq('id', contract.id)
        if (error) console.error('[sign page] status → expired mislukt:', error.message)
        try { await logContractEvent(admin, contract.id, 'expired', { meta: { via: 'sign-page' } }) } catch { }
      }
    }
  }

  if (isExpired) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center gap-3">
          <Logo className="h-8 w-8" />
          <span className="font-bold text-sm">NextGenMedia</span>
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center max-w-md">
            <div className="h-12 w-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Clock className="h-6 w-6 text-red-600" />
            </div>
            <h1 className="font-semibold text-lg mb-1">Deze tekenlink is verlopen.</h1>
            <p className="text-sm text-gray-500">Neem contact op met NextGenMedia voor een nieuwe ondertekeningslink.</p>
          </div>
        </div>
      </div>
    )
  }

  // ── Audit: geopend (best-effort) + status naar 'bekeken' indien nog verzonden ─
  if (!alreadySignedStatus) {
    try { await logContractEvent(admin, contract.id, 'opened', { meta: { via: 'sign-page' } }) } catch { }
    if (contract.status === 'sent') {
      const { error } = await admin.from('contracts').update({ status: 'viewed' }).eq('id', contract.id)
      if (error) console.error('[sign page] status → viewed mislukt:', error.message)
    }
  }

  // Fetch client details for pre-filled name/email/company
  let companyName: string | null = null
  let contactName: string | null = null
  let contactEmail: string | null = null

  if (contract.client_id) {
    const { data: clientRow } = await admin
      .from('clients')
      .select('company_name, contact_name, email')
      .eq('id', contract.client_id)
      .maybeSingle()
    companyName = clientRow?.company_name ?? null
    contactName = clientRow?.contact_name ?? null
    contactEmail = clientRow?.email ?? null
  }

  // Resolve signer name/email: contract overrides → client contact → client email
  const signerName = contract.signer_name || contactName || companyName || ''
  const signerEmail = contract.signer_email || contactEmail || ''

  const alreadySigned = alreadySignedStatus

  // Document server-side streamen via een app-route (geen verlopende signed-URL).
  const pdfUrl = contract.pdf_path ? `/sign/${params.token}/document` : null

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Logo className="h-8 w-8" />
          <span className="font-bold text-sm">NextGenMedia</span>
        </div>
        <span className="text-xs text-gray-400 hidden sm:block">Contractondertekening</span>
      </header>

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 space-y-5">
        {/* Title */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">{contract.title}</h1>
          {companyName && (
            <p className="text-sm text-gray-500 mt-0.5">{companyName}</p>
          )}
        </div>

        {alreadySigned ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
            <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <h2 className="font-semibold text-green-800 mb-1">Contract reeds ondertekend</h2>
            <p className="text-sm text-green-700">Dit contract is al ondertekend. Bekijk het hieronder of ga terug naar uw portaal.</p>
          </div>
        ) : (
          <div className="bg-[#fff848]/20 border border-[#fff848] rounded-xl p-4 text-sm text-gray-700">
            <strong className="font-semibold">Lees het contract</strong> aandachtig door en zet daarna uw handtekening onderaan.
          </div>
        )}

        {/* PDF viewer */}
        {pdfUrl ? (
          <div className="card-base p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-medium">Contractdocument</span>
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-xs text-gray-400 hover:text-black flex items-center gap-1"
              >
                Openen ↗
              </a>
            </div>
            {/* Taller on desktop, shorter on mobile to leave room for signing */}
            <iframe
              src={pdfUrl}
              className="w-full"
              style={{ height: 'min(60vh, 500px)' }}
              title="Contract PDF"
            />
          </div>
        ) : (
          <div className="card-base text-center py-8 text-gray-400">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">PDF-document niet beschikbaar</p>
          </div>
        )}

        {/* Signature form — only for unsigned contracts */}
        {!alreadySigned && (
          <SignatureForm
            contractId={contract.id}
            token={params.token}
            signerName={signerName}
            signerEmail={signerEmail}
            fields={Array.isArray(contract.detected_fields) ? contract.detected_fields : []}
          />
        )}
      </div>
    </div>
  )
}
