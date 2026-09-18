import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { SignatureZoneEditor } from './signature-zone-editor'

export default async function ContractSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = createAdminSupabaseClient()

  // Use select('*') so missing sig_* columns don't error
  const { data: contractRaw } = await admin
    .from('contracts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!contractRaw || contractRaw.status === 'signed') notFound()

  // Default sig fields in case the migration hasn't run yet
  const contract = {
    ...contractRaw,
    sig_page:   contractRaw.sig_page   ?? 1,
    sig_x_pct:  contractRaw.sig_x_pct  ?? 5,
    sig_y_pct:  contractRaw.sig_y_pct  ?? 25,
    sig_width:  contractRaw.sig_width   ?? 200,
    sig_height: contractRaw.sig_height  ?? 60,
  }

  let pdfUrl: string | null = null
  if (contract.pdf_path) {
    const { data: signData } = await admin.storage
      .from('contracts')
      .createSignedUrl(contract.pdf_path, 3600)
    pdfUrl = signData?.signedUrl ?? null
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href={`/admin/contracts/${id}`} className="btn-secondary px-2">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">AI-velden & handtekeningzone</h1>
          <p className="text-sm text-gray-500 mt-0.5">{contract.title}</p>
        </div>
      </div>

      <SignatureZoneEditor
        contractId={id}
        pdfUrl={pdfUrl}
        initialFields={Array.isArray(contractRaw.detected_fields) ? contractRaw.detected_fields : []}
        initialZone={{
          sig_page:   contract.sig_page,
          sig_x_pct:  contract.sig_x_pct,
          sig_y_pct:  contract.sig_y_pct,
          sig_width:  contract.sig_width,
          sig_height: contract.sig_height,
        }}
      />
    </div>
  )
}
