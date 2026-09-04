import 'server-only'
import { cache } from 'react'
import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import {
  fullPermissions, can, MODULE_IMPLEMENTED, type Permissions, type PortalModule,
} from '@/lib/portal-permissions'
import { logAudit } from '@/lib/audit'

// Centrale portaal-resolver. Bepaalt voor de ingelogde gebruiker:
//  - bij welke klant hij hoort (owner of subaccount)
//  - of hij actief is
//  - welke rechten hij heeft
// Owners (clients.owner_user_id) krijgen automatisch alle rechten (Eigenaar),
// zodat bestaande klantaccounts exact blijven werken zoals vandaag.

export type PortalSession = {
  userId: string
  clientId: string
  isOwner: boolean
  active: boolean
  permissions: Permissions
  clientUserId: string | null
  email: string | null
  name: string | null
}

/**
 * Resolveert de portaalsessie van de huidige gebruiker, of null.
 *
 * Gedeeld binnen één verzoek (React cache): de layout, de pagina en elke
 * API-guard vroegen dit los van elkaar op, wat telkens drie netwerkoproepen
 * naar Supabase kostte. De uitkomst is identiek — enkel het aantal keer dat we
 * ernaar vragen verandert, en de cache leeft niet langer dan het verzoek.
 */
export const resolvePortalSession = cache(async (): Promise<PortalSession | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminSupabaseClient()

  // 1) Hoofdaccount (owner) → volledige rechten.
  const { data: ownClient } = await admin
    .from('clients').select('id').eq('owner_user_id', user.id).maybeSingle()
  if (ownClient?.id) {
    return {
      userId: user.id, clientId: ownClient.id, isOwner: true, active: true,
      permissions: fullPermissions(), clientUserId: null,
      email: user.email ?? null, name: (user.user_metadata?.full_name as string | undefined) ?? null,
    }
  }

  // 2) Subaccount → rechten uit client_users (lege rechten = volledige als fallback).
  type CURow = { id: string; client_id: string; active: boolean; permissions: unknown; email: string | null; name: string | null }
  let cu: CURow | null = null
  try {
    const { data } = await admin
      .from('client_users')
      .select('id, client_id, active, permissions, email, name')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    cu = (data as CURow | null) ?? null
  } catch {
    // Tabel nog niet gemigreerd → geen subaccounts mogelijk, maar app blijft werken.
    cu = null
  }
  if (cu) {
    const perms = (cu.permissions && typeof cu.permissions === 'object' && Object.keys(cu.permissions as object).length > 0)
      ? (cu.permissions as Permissions)
      : fullPermissions()
    return {
      userId: user.id, clientId: cu.client_id, isOwner: false, active: !!cu.active,
      permissions: perms, clientUserId: cu.id,
      email: cu.email ?? user.email ?? null, name: cu.name ?? null,
    }
  }

  return null
})

/** Heeft de sessie een bepaald recht? Owner mag altijd alles. */
export function sessionCan(session: PortalSession | null, module: PortalModule, action = 'view'): boolean {
  if (!session || !session.active) return false
  if (session.isOwner) return true
  return can(session.permissions, module, action)
}

type GuardOk = { ok: true; session: PortalSession }
type GuardErr = { ok: false; response: NextResponse }

/**
 * API-guard: controleert ingelogd + actief + (optioneel) module-/actierecht.
 * Gebruik in portal-routes:
 *   const g = await requirePortalPermission('tasks', 'complete'); if (!g.ok) return g.response
 *   // g.session.clientId is veilig te gebruiken
 */
export async function requirePortalPermission(module?: PortalModule, action = 'view'): Promise<GuardOk | GuardErr> {
  // Niet-geïmplementeerde module → duidelijke disabled-response (geen losse checks elders nodig).
  if (module && !MODULE_IMPLEMENTED[module]) {
    return { ok: false, response: NextResponse.json({ error: 'Deze module is nog niet beschikbaar' }, { status: 404 }) }
  }
  const session = await resolvePortalSession()
  if (!session) return { ok: false, response: NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 }) }
  if (!session.active) return { ok: false, response: NextResponse.json({ error: 'Account is gedeactiveerd' }, { status: 403 }) }
  if (module && !sessionCan(session, module, action)) {
    return { ok: false, response: NextResponse.json({ error: 'Geen toestemming voor deze actie' }, { status: 403 }) }
  }
  return { ok: true, session }
}

/**
 * Page-guard voor portaal-servercomponenten. Redirect naar /login als niet
 * ingelogd/inactief, naar /portal als geen view-recht op de module of als de
 * module nog niet bestaat. Geeft anders de sessie terug.
 */
export async function requirePortalView(module: PortalModule): Promise<PortalSession> {
  if (!MODULE_IMPLEMENTED[module]) redirect('/portal')
  const session = await resolvePortalSession()
  if (!session || !session.active) redirect('/login')
  if (!sessionCan(session, module, 'view')) redirect('/portal')
  return session
}

/**
 * Centrale contracttoegang voor het klantportaal (admin valt hier buiten).
 * Regels: contract moet aan session.clientId gekoppeld zijn + het juiste recht.
 * De publieke token-flow (externe ontvangers) loopt NIET via deze helper.
 */
export function canAccessContract(
  session: PortalSession | null,
  contract: { client_id?: string | null },
  action: 'view' | 'sign' | 'download' = 'view',
): boolean {
  if (!session || !session.active) return false
  if (!contract.client_id || contract.client_id !== session.clientId) return false
  return sessionCan(session, 'contracts', action)
}

/**
 * Eén audit-helper voor alle portaalacties — consistente actor-identiteit.
 * Vervangt de losse logAudit-blokken in de portal-routes.
 */
export async function logPortalAction(
  session: PortalSession,
  action: string,
  entity: { type?: string | null; id?: string | null },
  opts?: { meta?: Record<string, unknown>; req?: { headers: Headers } },
): Promise<void> {
  const kind = session.isOwner ? 'owner' : 'subaccount'
  const who = session.name || session.email || (session.isOwner ? 'hoofdaccount' : 'subaccount')
  const h = opts?.req?.headers
  const ip = h ? (h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null) : null
  const userAgent = h ? (h.get('user-agent') || null) : null
  await logAudit({
    action,
    entityType: entity.type ?? null,
    entityId: entity.id ?? null,
    summary: `${action} via portaal door ${who}`,
    actorUserId: session.userId,
    actorEmail: session.email,
    actorRole: session.isOwner ? 'client_owner' : 'client_subaccount',
    metadata: {
      actor_name: session.name, actor_email: session.email, auth_user_id: session.userId,
      client_id: session.clientId, kind, ...(opts?.meta ?? {}),
    },
    ip, userAgent,
  })
}

/** Best-effort: registreer de laatste login van een subaccount. */
export async function touchLastLogin(session: PortalSession): Promise<void> {
  if (!session.clientUserId) return
  try {
    const admin = createAdminSupabaseClient()
    await admin.from('client_users').update({ last_login_at: new Date().toISOString() }).eq('id', session.clientUserId)
  } catch { /* mag nooit breken */ }
}
