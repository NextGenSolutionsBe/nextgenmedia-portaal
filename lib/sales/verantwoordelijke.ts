import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * De gebruiker achter een agenda (Bram, Marco…): via het e-mailadres in de
 * handtekening van de agendakoppeling (bram@…, marco@…). Zo wordt bij een
 * geboekte afspraak de eigenaar van de agenda automatisch verantwoordelijk.
 * Geen duidelijke match → null (dan toont de lead een rode melding).
 */
export async function gebruikerVoorAgenda(admin: SupabaseClient, agendaId: string | null | undefined): Promise<string | null> {
  if (!agendaId) return null
  try {
    const { data } = await admin.from('sales_calendar_connections').select('signature_email').eq('id', agendaId).maybeSingle()
    const email = String((data as { signature_email?: string | null } | null)?.signature_email ?? '').trim().toLowerCase()
    if (!email) return null
    const { data: lijst } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const u = (lijst?.users ?? []).find((x) => (x.email ?? '').toLowerCase() === email && !(x as { banned_until?: string | null }).banned_until)
    return u?.id ?? null
  } catch { return null }
}
