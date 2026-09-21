import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { listSetters } from '@/lib/sales/setters'

/**
 * Wie kan verantwoordelijke zijn voor een lead, en onder welke naam staat
 * iemand in de statistieken? Keyed op de AUTH-gebruiker (dat is wat
 * sales_leads.assigned_to en sales_activiteiten.medewerker_id bevatten).
 *
 * Twee bronnen: actieve setterprofielen met een gekoppelde gebruiker, en
 * actieve werknemers met toegang tot de verkoopmodule. Geen tarieven of
 * commissies — enkel id en naam.
 */
export type SalesMedewerker = { id: string; naam: string }

export async function listSalesMedewerkers(): Promise<SalesMedewerker[]> {
  const uit = new Map<string, string>()
  try {
    for (const s of await listSetters()) {
      if (s.active !== false && s.auth_user_id) uit.set(s.auth_user_id, s.name)
    }
  } catch { /* setters optioneel */ }
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('staff_members')
      .select('auth_user_id, name, email, active, permissions, verwijderd_at')
      .not('auth_user_id', 'is', null)
    for (const r of (data ?? []) as {
      auth_user_id: string | null; name: string | null; email: string | null
      active: boolean | null; permissions: unknown; verwijderd_at?: string | null
    }[]) {
      if (!r.auth_user_id || r.active === false || r.verwijderd_at) continue
      const perms = Array.isArray(r.permissions) ? (r.permissions as string[]) : []
      if (!perms.includes('sales')) continue
      if (!uit.has(r.auth_user_id)) uit.set(r.auth_user_id, r.name || r.email?.split('@')[0] || 'Medewerker')
    }
  } catch { /* staff_members optioneel */ }
  return [...uit.entries()]
    .map(([id, naam]) => ({ id, naam }))
    .sort((a, b) => a.naam.localeCompare(b.naam))
}
