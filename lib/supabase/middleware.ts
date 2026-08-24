import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { pathToModule, canSeeModule, STAFF_API_WHITELIST, isStaffApiDenied, modulesForApiPath } from '@/lib/staff'
import { isDisabledPath } from '@/lib/features'
import { verifyToken, TWO_FA_COOKIE, twoFactorRequired } from '@/lib/two-factor'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

// Rol/rechten worden via de service-role client gelezen (bypasst RLS). Reden:
// user_roles heeft een RESTRICTIVE admin-only policy, waardoor een niet-admin
// zijn EIGEN rol-rij niet via de user-sessie kan lezen → role undefined →
// redirect-loop bij inloggen (werknemers). De service-role lezing is
// betrouwbaar en is sowieso het primaire beveiligingsmodel van dit platform.
// Valt terug op de user-client als de service-role key ontbreekt.
function roleReader(fallback: ReturnType<typeof createServerClient>) {
  try { return createAdminSupabaseClient() } catch { return fallback }
}

/**
 * Kopieert de cookies die Supabase op de doorloop-response zette (o.a. een
 * vernieuwd auth-token) naar een nieuwe response. Nodig bij elke redirect:
 * NextResponse.redirect() begint met een lege set cookies, waardoor een net
 * vernieuwde sessie verloren zou gaan → uitgelogd raken of een redirect-lus.
 */
function copyAuthCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie)
  return to
}

export async function updateSession(request: NextRequest) {
  /**
   * Zonder deze twee waarden gooit createServerClient hieronder, klapt de hele
   * middleware, en toont Vercel een kale 500 met MIDDLEWARE_INVOCATION_FAILED.
   * Daar staat niet in wát er ontbreekt, dus dan zoek je lang.
   *
   * We blokkeren bewust alles: de middleware is de toegangspoort, en zonder
   * Supabase kunnen we niemand herkennen. Doorlaten zou iedereen binnenlaten.
   *
   * LET OP bij het instellen: NEXT_PUBLIC_-waarden worden tijdens de BUILD in
   * de code gebakken. Ze in Vercel invullen is niet genoeg — er moet daarna
   * opnieuw gedeployd worden.
   */
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const ontbreekt = [
      !process.env.NEXT_PUBLIC_SUPABASE_URL ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY' : null,
    ].filter(Boolean).join(' en ')
    return new NextResponse(
      `Deze omgeving is niet volledig ingesteld: ${ontbreekt} ontbreekt.\n\n` +
      'Zet die in Vercel bij Settings → Environment Variables en deploy daarna opnieuw. ' +
      'Een NEXT_PUBLIC_-waarde wordt tijdens de build ingebakken, dus enkel invullen volstaat niet.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }

  let supabaseResponse = NextResponse.next({ request })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServerClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options?: unknown }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2])
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  // Uitgeschakelde features (lib/features.ts) centraal dichtzetten — voor
  // IEDEREEN, ook admin, zodat een verborgen module ook niet via een directe URL
  // bereikbaar is. De code blijft bestaan; enkel de toegang is geblokkeerd.
  if (isDisabledPath(path)) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Niet beschikbaar' }, { status: 404 })
    return NextResponse.redirect(new URL(user ? '/admin' : '/login', request.url))
  }

  // Admin-API's: werknemers centraal per module afschermen (de route-guards
  // controleren identiteit; dit is de module-laag). Admin passeert altijd.
  if (path.startsWith('/api/admin')) {
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const db = roleReader(supabase)
    const { data: roleData } = await db
      .from('user_roles').select('role').eq('user_id', user.id).limit(1).maybeSingle()

    // Interne accounts moeten óók de tweestapsverificatie hebben doorlopen —
    // anders zou een geldig wachtwoord alleen al volstaan voor de API's.
    const twoFaOk = await verifyToken(request.cookies.get(TWO_FA_COOKIE)?.value, user.id)

    if (roleData?.role === 'admin') {
      // Een account kan van de code vrijgesteld zijn (login_settings). We vragen
      // dat pas op als de code ontbreekt, zodat de normale weg geen extra
      // databasebevraging kost.
      if (!twoFaOk && await twoFactorRequired(db, user.id)) {
        return NextResponse.json({ error: 'Verificatie vereist', code: '2fa_required' }, { status: 401 })
      }
      return supabaseResponse
    }

    // Geen admin → enkel actieve werknemers, binnen hun modules.
    const { data: staff } = await db
      .from('staff_members').select('active, permissions').eq('auth_user_id', user.id).maybeSingle()
    const activeStaff = !!staff && staff.active !== false
    if (!activeStaff) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!twoFaOk && await twoFactorRequired(db, user.id)) {
      return NextResponse.json({ error: 'Verificatie vereist', code: '2fa_required' }, { status: 401 })
    }
    if (isStaffApiDenied(path)) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (STAFF_API_WHITELIST.some((p) => path === p || path.startsWith(p + '?'))) return supabaseResponse
    const perms = Array.isArray(staff!.permissions) ? (staff!.permissions as string[]) : []
    // Toegang tot een dashboard = alle acties in dat dashboard. Gedeelde endpoints
    // geven meerdere modules; de werknemer passeert met één ervan. Ongemapte
    // admin-API's blijven dicht (default-deny).
    const allowedModules = modulesForApiPath(path)
    if (!allowedModules || !allowedModules.some((m) => canSeeModule(perms, m))) {
      return NextResponse.json({ error: 'Geen toegang tot deze module' }, { status: 403 })
    }
    return supabaseResponse
  }

  // Public routes
  if (
    path === '/login' ||
    path === '/login/verify' ||   // stap 2 van het inloggen (eigen controle in de pagina)
    path === '/' ||
    path.startsWith('/sign/') ||
    path.startsWith('/_next') ||
    path.startsWith('/api') ||
    // Ontdekkingspaden moeten een EERLIJK antwoord geven, niet een omleiding.
    // Claude zoekt hier de OAuth-gegevens van de MCP-connector. Kreeg het een
    // 307 naar /login, dan las het onze inlogpagina als een kapotte
    // "sign-in service" — vandaar die registratiefout. Laten passeren betekent
    // hier een nette 404, en dat is precies wat "geen OAuth" hoort te zeggen.
    path.startsWith('/.well-known/') ||
    path === '/favicon.ico'
  ) {
    return supabaseResponse
  }

  // Not logged in → redirect to login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', path)
    return NextResponse.redirect(url)
  }

  // Fetch role (via service-role — zie roleReader hierboven)
  const db = roleReader(supabase)
  const { data: roleData } = await db
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  let role = roleData?.role as string | undefined

  // staff_members = bron van waarheid voor werknemers. Het app_role-enum bevat
  // mogelijk (nog) geen 'employee', waardoor de rol-rij kan ontbreken; een
  // actieve staff-rij maakt de gebruiker sowieso werknemer. Enkel opzoeken als
  // de rol geen bekende non-employee is (bespaart een query voor admin/klant/partner).
  let staff: { active?: boolean; permissions?: string[] } | null = null
  if (role !== 'admin' && role !== 'client' && role !== 'freelancer') {
    const { data } = await db
      .from('staff_members')
      .select('active, permissions')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    staff = data
    if (staff && staff.active !== false) role = 'employee'
  }

  // Interne accounts (admin + werknemer): tweestapsverificatie verplicht.
  // Klanten en partners loggen gewoon met wachtwoord in.
  if ((role === 'admin' || role === 'employee') && path.startsWith('/admin')) {
    const twoFaOk = await verifyToken(request.cookies.get(TWO_FA_COOKIE)?.value, user.id)
    // Vrijgesteld? Dan volstaat e-mail + wachtwoord. Staat er niets ingesteld,
    // dan blijft de code verplicht — zie twoFactorRequired().
    if (!twoFaOk && await twoFactorRequired(db, user.id)) {
      const url = request.nextUrl.clone()
      url.pathname = '/login/verify'
      url.search = ''
      url.searchParams.set('redirect', path)
      // BELANGRIJK: een verse NextResponse.redirect() gooit de cookies weg die
      // Supabase op supabaseResponse zette bij een tokenvernieuwing. Zonder die
      // cookies raakt de sessie verlopen en beland je in een inlog-lus. Daarom
      // kopiëren we ze mee.
      return copyAuthCookies(supabaseResponse, NextResponse.redirect(url))
    }
  }

  // Role-based routing
  if (path.startsWith('/admin')) {
    // Admin = volledige toegang. Werknemer = enkel toegestane modules.
    if (role === 'admin') {
      // ok
    } else if (role === 'employee') {
      // Inactieve werknemer → geen toegang.
      if (staff && staff.active === false) {
        return NextResponse.redirect(new URL('/login', request.url))
      }
      // Werknemersbeheer is altijd admin-only.
      if (path.startsWith('/admin/werknemers')) {
        return NextResponse.redirect(new URL('/admin', request.url))
      }
      const moduleKey = pathToModule(path)
      if (moduleKey) {
        const perms = Array.isArray(staff?.permissions) ? (staff!.permissions as string[]) : []
        if (!canSeeModule(perms, moduleKey)) {
          return NextResponse.redirect(new URL('/admin', request.url))
        }
      }
    } else {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }
  if (path.startsWith('/portal') && role !== 'client') {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (path.startsWith('/partner') && role !== 'freelancer') {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return supabaseResponse
}
