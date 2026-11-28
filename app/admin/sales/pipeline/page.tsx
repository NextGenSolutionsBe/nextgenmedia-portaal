import { redirect } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * De verkooppipeline is opgegaan in Projecten (2 nov 2026). Oude links
 * (?lead=<id>, ook in ClickUp-taken en meldingen) openen de kaart die bij die
 * lead hoort; anders het projectenbord.
 */
export default async function OudePipeline({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const lead = String(sp.lead ?? '')
  if (/^[0-9a-f-]{36}$/i.test(lead)) {
    const { data } = await createAdminSupabaseClient().from('opdrachten').select('id').eq('lead_id', lead).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (data?.id) redirect(`/admin/opdrachten?opdracht=${data.id}`)
  }
  redirect('/admin/opdrachten')
}
