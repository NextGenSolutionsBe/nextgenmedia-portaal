export const dynamic = 'force-dynamic'

import { createClient, createAdminSupabaseClient, trySignedUrl } from '@/lib/supabase/server'
import { ShoppingCart, Clock } from 'lucide-react'
import { FOUNDER_EMAILS } from '@/lib/founders'
import { PurchaseForm } from './purchase-form'
import { FoundersSetup } from './founders-setup'
import { PurchaseCard, type Purchase, type Approval } from './purchase-card'

export default async function PurchasesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const currentEmail = user?.email ?? ''

  const admin = createAdminSupabaseClient()
  const [{ data: pRows }, { data: aRows }] = await Promise.all([
    admin.from('purchases').select('*').order('created_at', { ascending: false }),
    admin.from('purchase_approvals').select('*'),
  ])
  const purchases = (pRows ?? []) as Purchase[]
  const approvalsByPurchase: Record<string, Approval[]> = {}
  for (const a of (aRows ?? []) as (Approval & { purchase_id: string })[]) (approvalsByPurchase[a.purchase_id] ??= []).push(a)

  // Signed URLs voor bijlagen
  const urls: Record<string, string | null> = {}
  await Promise.all(purchases.filter(p => p.attachment_path).map(async p => { urls[p.id] = await trySignedUrl(admin, 'contracts', p.attachment_path) }))

  const me = currentEmail.toLowerCase()
  const needsMe = purchases.filter(p => p.status === 'pending'
    && FOUNDER_EMAILS.filter(e => e.toLowerCase() !== (p.requester_email ?? '').toLowerCase()).map(e => e.toLowerCase()).includes(me)
    && !(approvalsByPurchase[p.id] ?? []).some(a => a.approver_email.toLowerCase() === me))

  const render = (list: Purchase[]) => list.map(p => (
    <PurchaseCard key={p.id} purchase={p} approvals={approvalsByPurchase[p.id] ?? []} currentEmail={currentEmail} attachmentUrl={urls[p.id] ?? null} />
  ))

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Aankopen</h1>
          <p className="text-sm text-gray-500 mt-0.5">Aankopen boven €1.000 (incl. btw) vereisen goedkeuring van de twee andere zaakvoerders</p>
        </div>
        <PurchaseForm />
      </div>

      <FoundersSetup />

      {needsMe.length > 0 && (
        <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-amber-500" />Vereist jouw goedkeuring <span className="status-badge bg-amber-100 text-amber-700 text-xs">{needsMe.length}</span></h2>
          <div className="space-y-3">{render(needsMe)}</div>
        </div>
      )}

      <div>
        <h2 className="font-semibold mb-3 flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-gray-400" />Alle aanvragen</h2>
        {purchases.length === 0 ? (
          <div className="card-base text-center py-10 text-gray-400"><ShoppingCart className="h-8 w-8 mx-auto mb-3 opacity-30" /><p className="text-sm">Nog geen aankoopaanvragen</p></div>
        ) : (
          <div className="space-y-3">{render(purchases)}</div>
        )}
      </div>
    </div>
  )
}
