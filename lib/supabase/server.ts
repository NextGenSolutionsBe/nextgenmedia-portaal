import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { type SupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { createAdminSupabaseClient } from './admin-client'

// De service-role client woont in een eigen bestand (zie daar waarom), maar
// blijft hier gewoon beschikbaar zodat bestaande imports ongemoeid blijven.
export { createAdminSupabaseClient }

export async function createClient() {
  const cookieStore = await cookies()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createServerClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAll(cookiesToSet: any[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: unknown }) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
            )
          } catch {
            // Server Component — cookies worden genegeerd
          }
        },
      },
    }
  )
}

// ── Wie ben je? Eén keer per verzoek vragen, niet vier keer ──────────────────
//
// De layout, de pagina en elke guard stelden allemaal dezelfde twee vragen:
// "wie ben je" en "welke rol heb je". Dat waren vier opeenvolgende netwerk-
// oproepen naar Supabase (Frankfurt → Ierland) vóór er ook maar één byte
// pagina-inhoud opgehaald werd.
//
// React's cache() lost dat op: de eerste aanroep binnen één verzoek doet het
// werk, de rest krijgt hetzelfde antwoord terug. De cache leeft precies zo lang
// als het verzoek — niets lekt naar de volgende bezoeker, en niets wordt
// hergebruikt over gebruikers heen. Het antwoord is dus even vers als voorheen;
// enkel het aantal keer dat we het opvragen verandert.

/** De ingelogde gebruiker. Gedeeld binnen één verzoek. */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ?? null
})

/**
 * De rol uit user_roles, via service-role (bypasst de restrictive RLS die een
 * werknemer zijn eigen rij niet laat lezen → login-loop).
 */
export const getUserRole = cache(async (userId: string): Promise<string | undefined> => {
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle()
    return (data as { role?: string } | null)?.role
  } catch {
    return undefined
  }
})

/** De staff-rij (actief + rechten). staff_members is de bron van waarheid. */
export const getStaffRow = cache(async (
  userId: string,
): Promise<{ active?: boolean; permissions?: string[] } | null> => {
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from('staff_members')
      .select('active, permissions')
      .eq('auth_user_id', userId)
      .maybeSingle()
    return (data as { active?: boolean; permissions?: string[] } | null) ?? null
  } catch {
    return null
  }
})

/**
 * Server-side admin guard. Returns the authenticated User when the caller has
 * the `admin` role, otherwise null. Use as: `const user = await requireAdmin();
 * if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })`.
 * Rol wordt via service-role gelezen (RLS-proof — zie memory: login-loop les).
 */
export async function requireAdmin(): Promise<User | null> {
  const user = await getSessionUser()
  if (!user) return null
  return (await getUserRole(user.id)) === 'admin' ? user : null
}

/**
 * Is deze gebruiker een ACTIEVE interne werknemer (staff_members)?
 * Service-role lezing; staff_members is de bron van waarheid voor werknemer-zijn.
 */
export async function isActiveStaff(userId: string): Promise<boolean> {
  const staff = await getStaffRow(userId)
  return !!staff && staff.active !== false
}

/**
 * Staff-guard voor module-API's: admin óf actieve werknemer.
 * PER-MODULE afscherming voor werknemers gebeurt centraal in de middleware
 * (pathToModule op /api/admin-paden); deze guard is de identiteitslaag.
 * Gevoelige routes (staff-beheer, AI, credentials, …) blijven requireAdmin gebruiken.
 */
export async function requireStaff(): Promise<User | null> {
  const user = await getSessionUser()
  if (!user) return null
  if ((await getUserRole(user.id)) === 'admin') return user
  return (await isActiveStaff(user.id)) ? user : null
}

/**
 * Best-effort signed URL. Returns null on any failure (missing object, bucket,
 * network error). Use for non-critical previews/downloads where the caller
 * gracefully handles a null URL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function trySignedUrl(admin: SupabaseClient<any>, bucket: string, path: string | null | undefined, ttlSeconds = 3600): Promise<string | null> {
  if (!path) return null
  try {
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, ttlSeconds)
    if (error) return null
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}

/**
 * Insert a row, automatically dropping any column the live schema doesn't have.
 * PostgREST reports a missing column as code PGRST204 with the column name in the
 * message. We strip that column and retry, so a write succeeds regardless of which
 * migrations have been applied. Returns the same shape as a normal insert().select().
 *
 * Pass `required` to guarantee certain keys are never dropped (if one of those is
 * missing the error is surfaced instead of silently swallowed).
 */
export async function insertResilient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any>,
  table: string,
  payload: Record<string, unknown>,
  options?: { select?: string; required?: string[] },
): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> {
  const selectCols = options?.select ?? 'id'
  const required = new Set(options?.required ?? [])
  const working = { ...payload }
  const maxAttempts = Object.keys(working).length + 1

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await admin
      .from(table)
      .insert(working)
      .select(selectCols)
      .single()

    if (!error) return { data: (data as unknown) as Record<string, unknown>, error: null }

    // Detect "column X does not exist" / schema-cache miss
    const code = (error as { code?: string }).code
    const msg = error.message ?? ''
    const isMissingColumn =
      code === 'PGRST204' ||
      code === '42703' ||
      /could not find the '.*' column|column .* does not exist/i.test(msg)

    if (!isMissingColumn) return { data: null, error }

    // Extract the offending column name from the message
    const match = msg.match(/'([^']+)' column/i) || msg.match(/column "?([a-z0-9_]+)"?/i)
    const badCol = match?.[1]

    if (!badCol || !(badCol in working) || required.has(badCol)) {
      // Can't recover — surface the error
      return { data: null, error }
    }

    delete working[badCol]
  }

  return { data: null, error: { message: 'Insert mislukt na meerdere pogingen' } }
}
