import 'server-only'
import { ontvangersVan, type Ontvanger } from './opleveringen-ontvangers'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => Promise<{ data: { user: any } | null }> } } }

/**
 * Alle mogelijke ontvangers van een opleveringsmail voor één klant: het
 * hoofdaccount, de subaccounts en het algemene e-mailadres van de klant.
 */
export async function laadOntvangers(admin: Admin, clientId: string): Promise<{ klant: string | null; ontvangers: Ontvanger[] }> {
  const { data: klant } = await admin.from('clients').select('id, company_name, contact_name, email, owner_user_id').eq('id', clientId).maybeSingle()
  if (!klant) return { klant: null, ontvangers: [] }
  let eigenaar: { email: string | null; naam: string | null } | null = null
  if (klant.owner_user_id) {
    try {
      const { data } = await admin.auth.admin.getUserById(klant.owner_user_id)
      const u = data?.user
      if (u?.email) eigenaar = { email: u.email, naam: (u.user_metadata?.full_name as string | undefined) || klant.contact_name || null }
    } catch { /* zonder hoofdaccount */ }
  }
  let gebruikers: { email: string | null; name: string | null; active: boolean | null; permissions: unknown }[] = []
  try {
    const { data } = await admin.from('client_users').select('email, name, active, permissions').eq('client_id', clientId).order('created_at')
    gebruikers = data ?? []
  } catch { /* tabel nog niet gemigreerd */ }
  return { klant: klant.company_name ?? null, ontvangers: ontvangersVan({ klantEmail: klant.email, eigenaar, gebruikers }) }
}
