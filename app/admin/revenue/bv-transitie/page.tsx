export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { readPeriodParams } from '@/lib/finance-data'
import { BvClient } from './bv-client'

/**
 * BV-transitie — wat de zaakvoerders nog te goed hebben in de BV, hoe de
 * gezamenlijke winst van de overgangsmaanden verdeeld wordt, en een raming van
 * wat ieder op zijn eenmanszaak moet reserveren. Enkel voor admins.
 */
export default async function BvTransitiePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (!(await requireAdmin())) redirect('/admin/revenue/omzet')
  const { year } = readPeriodParams(await searchParams)

  const admin = createAdminSupabaseClient()
  const [rechten, kosten, verdeling, ez, aannames] = await Promise.all([
    admin.from('bv_rechten').select('*').order('datum').order('created_at'),
    admin.from('bv_kosten').select('*').order('datum').order('created_at'),
    admin.from('bv_winstverdeling').select('*'),
    admin.from('ez_fiscaal').select('*').eq('jaar', year),
    admin.from('ez_aannames').select('*').eq('jaar', year).maybeSingle(),
  ])

  return (
    <BvClient
      jaar={year}
      rechtenRijen={(rechten.data ?? []) as Record<string, unknown>[]}
      kostenRijen={(kosten.data ?? []) as Record<string, unknown>[]}
      verdelingRijen={(verdeling.data ?? []) as Record<string, unknown>[]}
      ezRijen={(ez.data ?? []) as Record<string, unknown>[]}
      aannamesRij={(aannames.data ?? null) as Record<string, unknown> | null}
    />
  )
}
