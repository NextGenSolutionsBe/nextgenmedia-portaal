import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { SignatureZoneEditor } from '@/app/admin/contracts/[id]/setup/signature-zone-editor'

export const dynamic = 'force-dynamic'

export default async function TemplateSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = createAdminSupabaseClient()

  const { data: tpl } = await admin.from('contract_templates').select('*').eq('id', id).maybeSingle()
  if (!tpl) notFound()

  let pdfUrl: string | null = null
  if (tpl.pdf_path) {
    const { data } = await admin.storage.from('contracts').createSignedUrl(tpl.pdf_path, 3600)
    pdfUrl = data?.signedUrl ?? null
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/admin/contracts/templates" className="btn-secondary px-2">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">Template: AI-velden & handtekeningzone</h1>
          <p className="text-sm text-gray-500 mt-0.5">{tpl.name}</p>
        </div>
      </div>

      <SignatureZoneEditor
        contractId={id}
        apiBase={`/api/admin/contract-templates/${id}`}
        pdfUrl={pdfUrl}
        initialFields={Array.isArray(tpl.detected_fields) ? tpl.detected_fields : []}
        initialZone={{
          sig_page:   tpl.sig_page   ?? 1,
          sig_x_pct:  tpl.sig_x_pct  ?? 5,
          sig_y_pct:  tpl.sig_y_pct  ?? 25,
          sig_width:  tpl.sig_width  ?? 200,
          sig_height: tpl.sig_height ?? 60,
        }}
      />
    </div>
  )
}
