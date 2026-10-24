export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { VestingClient } from './vesting-client'
import { directeKostenVoorContracten } from '@/lib/facturen/kosten-data'
import { factuurUitRij } from '@/lib/vesting'

/**
 * Vestigingsprincipe — het contractmodel van de samenwerkingsovereenkomst.
 *
 * De data komt hier binnen; het rekenen gebeurt in lib/vesting.ts en de
 * weergave in vesting-client.tsx. Enkel voor admins: dit is de aandelen-
 * verdeling tussen de zaakvoerders.
 */
export default async function VestingPage() {
  if (!(await requireAdmin())) redirect('/admin')

  const admin = createAdminSupabaseClient()
  const [inst, contracten, wam, kosten, oud, termijnen, moduleContracten, klanten, contractTermijnen] = await Promise.all([
    admin.from('vesting_instellingen').select('*').eq('id', 1).maybeSingle(),
    admin.from('vesting_contracten').select('*').order('ondertekend_op').order('nr'),
    admin.from('vesting_wam').select('*').order('nr'),
    admin.from('vesting_wam_kosten').select('*').order('datum'),
    admin.from('vesting_revenue').select('*').order('entry_date'),
    admin.from('vesting_wam_termijnen').select('*').order('factuurdatum').order('volgnr'),
    // De Contractenmodule: waar een vestingcontract aan gekoppeld kan worden.
    admin.from('contracts').select('id, title, status, client_id, start_date, end_date, signed_at, service_slug, clients ( company_name )').order('created_at', { ascending: false }).limit(500),
    admin.from('clients').select('id, company_name, sales_verantwoordelijke, appointment_setter').order('company_name'),
    // De facturen (termijnen) per vestingcontract.
    admin.from('vesting_contract_termijnen').select('*').order('factuurdatum').order('volgnr'),
  ])

  // Directe kosten op de facturen van gekoppelde contracten → aftrek in de
  // nettoberekening (afgeleid; het handmatige veld blijft bestaan).
  let contractRijen = (contracten.data ?? []) as Record<string, unknown>[]
  try {
    const ids = Array.from(new Set(contractRijen.map((r) => r.contract_id).filter(Boolean))) as string[]
    const kosten = await directeKostenVoorContracten(admin, ids)
    contractRijen = contractRijen.map((r) => {
      const k = r.contract_id ? kosten.get(String(r.contract_id)) : undefined
      return k ? { ...r, directe_kosten_facturen: k.directeKosten, kostenstatus_facturen: k.status, facturen_gekoppeld: k.aantalFacturen } : r
    })
  } catch { /* kostenlaag nog niet beschikbaar */ }

  // Facturen uit Facturen die aan de gekoppelde contracten hangen: die bepalen
  // of een termijn gefactureerd en betaald is.
  let facturen: ReturnType<typeof factuurUitRij>[] = []
  try {
    const ids = Array.from(new Set(contractRijen.map((r) => r.contract_id).filter(Boolean))) as string[]
    if (ids.length) {
      const { data } = await admin.from('invoices')
        .select('id, reference, invoice_date, invoice_month, amount_excl, amount_incl, status, betaalstatus, betaald_bedrag, betaald_op, cancelled_at, credited_at, contract_id')
        .in('contract_id', ids)
      facturen = ((data ?? []) as Record<string, unknown>[]).map(factuurUitRij)
    }
  } catch { /* facturen niet beschikbaar → enkel handmatige status */ }

  return (
    <VestingClient
      instellingenRij={(inst.data ?? null) as Record<string, unknown> | null}
      contractRijen={contractRijen}
      wamRijen={(wam.data ?? []) as Record<string, unknown>[]}
      kostRijen={(kosten.data ?? []) as Record<string, unknown>[]}
      oudeRegistraties={(oud.data ?? []) as Record<string, unknown>[]}
      termijnRijen={(termijnen.data ?? []) as Record<string, unknown>[]}
      contractTermijnRijen={(contractTermijnen.data ?? []) as Record<string, unknown>[]}
      facturen={facturen}
      moduleContracten={(moduleContracten.data ?? []) as unknown as Record<string, unknown>[]}
      klanten={((klanten.data ?? []) as { id: string; company_name: string | null; sales_verantwoordelijke?: string | null; appointment_setter?: string | null }[]).map((k) => ({ id: k.id, naam: k.company_name ?? '—', closer: k.sales_verantwoordelijke ?? null, setter: k.appointment_setter ?? null }))}
    />
  )
}
