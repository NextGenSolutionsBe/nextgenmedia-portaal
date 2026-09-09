export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, Repeat, FileText, TrendingUp } from 'lucide-react'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatEuro } from '@/lib/utils'
import {
  thisMonthYM, shiftYM, monthLabel, expandRevenueForMonth, recurringActiveInMonth,
  type RevenueEntry, type RecurringInvoice,
} from '@/lib/invoices'

export default async function FacturatiePlannerPage() {
  const admin = createAdminSupabaseClient()
  const base = thisMonthYM()
  const months = [0, 1, 2].map((d) => shiftYM(base, d))

  const [{ data: revenue }, { data: recurring }, { data: invoices }] = await Promise.all([
    admin.from('revenue_entries').select('*'),
    admin.from('recurring_invoices').select('*'),
    admin.from('invoices').select('invoice_month, amount_excl, status').in('invoice_month', months),
  ])

  const revRows = (revenue ?? []) as RevenueEntry[]
  const recRows = (recurring ?? []) as RecurringInvoice[]
  const invRows = (invoices ?? []) as { invoice_month: string; amount_excl: number; status: string }[]

  const cards = months.map((m) => {
    const prognose = expandRevenueForMonth(revRows, m).reduce((s, x) => s + x.amount_excl, 0)
    const recCount = recRows.filter((r) => recurringActiveInMonth(r, m)).length
    const eenmaligCount = invRows.filter((i) => i.invoice_month === m && i.status !== 'geannuleerd').length
    return { month: m, prognose, recCount, eenmaligCount, totaal: recCount + eenmaligCount }
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <Link href="/admin/invoices" className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1 mb-1"><ArrowLeft className="h-3.5 w-3.5" />Terug naar Facturen</Link>
        <h1 className="text-2xl font-bold">Facturatieplanner</h1>
        <p className="text-sm text-gray-500 mt-0.5">Wat komt eraan? Overzicht van de komende 3 maanden.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.month} className="card-base">
            <div className="font-semibold capitalize mb-3">{monthLabel(c.month)}</div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span className="text-gray-500 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />Facturen</span><b>{c.totaal}</b></div>
              <div className="flex items-center justify-between"><span className="text-gray-500 flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5" />Recurring</span><span>{c.recCount}</span></div>
              <div className="flex items-center justify-between"><span className="text-gray-500 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />Eenmalig</span><span>{c.eenmaligCount}</span></div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-2 mt-2"><span className="text-gray-500 flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" />Verwachte omzet</span><b className="text-green-600">{formatEuro(c.prognose)}</b></div>
            </div>
            <Link href={`/admin/invoices`} className="btn-secondary text-xs mt-4 w-full justify-center">Open maand</Link>
          </div>
        ))}
      </div>
    </div>
  )
}
