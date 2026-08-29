import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { pathToModule, canSeeModule, STAFF_API_WHITELIST, isStaffApiDenied, modulesForApiPath } from '@/lib/staff'
import { isDisabledPath } from '@/lib/features'
import { verifyToken, TWO_FA_COOKIE, twoFactorRequired } from '@/lib/two-factor'
// Bewust uit admin-client.ts en NIET uit server.ts: die laatste gebruikt
// React's cache(), en dat bestaat niet in de edge-runtime waar deze middleware
// draait. Zie de toelichting in lib/supabase/admin-client.ts.
import { createAdminSupabaseClient } from '@/lib/supabase/admin-client'

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

// ── Rol doorgeven aan de layout ──────────────────────────────────────────────
//
// De middleware heeft de rol en de modulerechten al opgezocht. Zonder deze
// headers deed app/admin/layout.tsx datzelfde werk nog eens over: twee extra
// netwerkoproepen naar Supabase, achter elkaar, vóór er pagina-inhoud kwam.
//
// LET OP — DIT IS BEVEILIGINGSGEVOELIG. Een bezoeker kan zelf een header met
// deze naam meesturen. Daarom wordt in doorgeven() ELKE binnenkomende variant
// eerst weggegooid en pas daarna onze eigen waarde gezet, en loopt IEDERE
// doorloop-return via die functie — nooit rechtstreeks via supabaseResponse.
// De layout controleert bovendien of het meegegeven gebruikers-id overeenkomt
// met de werkelijke sessie, en valt anders terug op de database.
const HDR_USER = 'x-ngm-user'
const HDR_ROLE = 'x-ngm-role'
const HDR_MODULES = 'x-ngm-modules'
const ONZE_HEADERS = [HDR_USER, HDR_ROLE, HDR_MODULES]

// ── Nooit onbeperkt wachten ──────────────────────────────────────────────────
//
// Deze middleware draait vóór ELK verzoek. Blijft één databaselezing hangen,
// dan hangt daarmee de hele app — en kapt Vercel het af met een 504 waar de
// bezoeker alleen "This Routing Middleware has timed out" van ziet.
//
// Deze lezingen duren normaal één à twee milliseconden. Drie seconden is dus
// bijzonder ruim; wie daar overheen gaat, is stuk en niet traag.
const DB_TIJDSLIMIET_MS = 3000

/** Wacht hooguit `ms` op een belofte; daarna `terugval`. */
async function metTijdslimiet<T>(belofte: PromiseLike<T>, ms: number, terugval: T): Promise<T> {
  let klok: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(belofte),
      new Promise<T>((los) => { klok = setTimeout(() => los(terugval), ms) }),
    ])
  } catch {
    // Een mislukte lezing behandelen we als "onbekend", net als een tijdsoverschrijding.
    return terugval
  } finally {
    if (klok) clearTimeout(klok)
  }
}

/** Uitkomst van een lezing: gelukt (met of zonder rij), of niet gelukt. */
type Lezing<T> = { ok: true; data: T | null } | { ok: false }

/** Eén databaselezing, met tijdslimiet. Traag of stuk → `{ ok: false }`. */
function lees<T>(vraag: PromiseLike<{ data: T | null }>): Promise<Lezing<T>> {
  return metTijdslimiet<Lezing<T>>(
    Promise.resolve(vraag).then((r) => ({ ok: true as const, data: r.data })),
    DB_TIJDSLIMIET_MS,
    { ok: false },
  )
}

/**
 * Antwoord wanneer we de rechten niet kunnen ophalen.
 *
 * Bewust GEEN doorlaten: zonder rol weten we niet of iemand admin is, en dan
 * hoort de deur dicht te blijven. Ook bewust geen omleiding naar /login — dat
 * zou lijken alsof je uitgelogd bent terwijl je sessie prima in orde is. Een
 * eerlijke 503 met "probeer opnieuw" is duidelijker en zelfherstellend.
 */
function databankOnbereikbaar(path: string): NextResponse {
  if (path.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'De databank reageert even niet. Probeer het zo opnieuw.' },
      { status: 503, headers: { 'Retry-After': '5' } },
    )
  }
  return new NextResponse(
    `<!doctype html><html lang="nl"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Even geen verbinding</title>
     <style>
       body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f9fafb;color:#111;
            display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1.5rem}
       .k{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:2rem;max-width:26rem;text-align:center}
       h1{font-size:1.125rem;margin:0 0 .5rem}
       p{color:#4b5563;font-size:.9rem;line-height:1.5;margin:0 0 1.25rem}
       a{display:inline-block;background:#fff848;color:#111;text-decoration:none;font-weight:600;
         font-size:.875rem;padding:.6rem 1.1rem;border-radius:10px}
     </style></head><body><div class="k">
       <h1>Even geen verbinding met de databank</h1>
       <p>Je bent nog gewoon ingelogd. Dit duurt meestal een paar seconden.</p>
       <a href="${path.replace(/"/g, '&quot;')}">Opnieuw proberen</a>
     </div></body></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '5' } },
  )
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

  /**
   * De enige manier waarop een verzoek deze middleware levend verlaat.
   *
   * Bouwt een verse doorloop-response waarin onze eigen headers eerst worden
   * WEGGEGOOID (wat de bezoeker ook meestuurde) en daarna eventueel opnieuw
   * gezet met wat wij zelf hebben vastgesteld. Gebruik dit overal in plaats van
   * `return supabaseResponse`: zo kan een meegestuurde `x-ngm-role: admin`
   * nooit bij de layout aankomen.
   */
  const doorgeven = (identiteit?: { userId: string; role: string; modules?: string[] }) => {
    const headers = new Headers(request.headers)
    for (const h of ONZE_HEADERS) headers.delete(h)
    if (identiteit) {
      headers.set(HDR_USER, identiteit.userId)
      headers.set(HDR_ROLE, identiteit.role)
      if (identiteit.modules) headers.set(HDR_MODULES, JSON.stringify(identiteit.modules))
    }
    // De cookies van supabaseResponse (o.a. een vernieuwd auth-token) moeten
    // mee — zie copyAuthCookies hierboven voor waarom dat niet vanzelf gaat.
    return copyAuthCookies(supabaseResponse, NextResponse.next({ request: { headers } }))
  }

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

  /**
   * Wie is dit? Via getClaims(), NIET via getUser().
   *
   * getUser() belt bij ELK verzoek naar de Auth-server van Supabase om de token
   * te laten nakijken. Dat is een netwerkoproep per paginabezoek, per API-call
   * én per vooruit opgehaalde link — tienduizenden per week. Wordt die server
   * even traag, dan hangt deze middleware, en dan is de HELE app onbereikbaar
   * (504 MIDDLEWARE_INVOCATION_TIMEOUT).
   *
   * Dit project ondertekent zijn tokens met ES256 (asymmetrisch, na te kijken
   * op /auth/v1/.well-known/jwks.json). Daardoor controleert getClaims() de
   * handtekening LOKAAL met WebCrypto; de publieke sleutel wordt gecachet.
   * Even veilig — een token vervalsen kan niet zonder de private sleutel —
   * maar zonder de afhankelijkheid van een externe dienst per verzoek.
   *
   * Eén verschil om te weten: een token blijft geldig tot het verloopt (een
   * uur). Zet je iemand middenin dat uur op non-actief, dan verliest die de
   * toegang niet via de token maar via de rol- en staff-controle hieronder —
   * die leest wél live uit de databank.
   */
  const path = request.nextUrl.pathname

  type Wie = { id: string; email?: string }
  /**
   * `null` = niet ingelogd (een geldig antwoord).
   * `'onbekend'` = we kónden het niet vaststellen. Dat is iets ánders dan
   * uitgelogd: iemand met een prima sessie mag daar niet om buitengezet worden.
   */
  let user: Wie | null | 'onbekend' = 'onbekend'
  try {
    // getClaims kan gooien (bv. als de publieke sleutel niet opgehaald raakt).
    // Ongevangen zou dat de hele middleware laten klappen — een 500 op élke
    // pagina. Vandaar dit vangnet, mét tijdslimiet.
    const res = await metTijdslimiet(
      supabase.auth.getClaims(),
      DB_TIJDSLIMIET_MS,
      null as Awaited<ReturnType<typeof supabase.auth.getClaims>> | null,
    )
    if (res) {
      const sub = res.data?.claims?.sub
      user = sub ? { id: sub as string, email: res.data?.claims?.email as string | undefined } : null
    }
  } catch {
    user = 'onbekend'
  }

  // Lukte de lokale controle niet, probeer dan alsnog de oude weg (navraag bij
  // de Auth-server). Zo blijft een hapering in de sleutelcache onzichtbaar.
  if (user === 'onbekend') {
    try {
      const res = await metTijdslimiet(
        supabase.auth.getUser(),
        DB_TIJDSLIMIET_MS,
        null as Awaited<ReturnType<typeof supabase.auth.getUser>> | null,
      )
      if (res) user = res.data.user ? { id: res.data.user.id, email: res.data.user.email } : null
    } catch {
      user = 'onbekend'
    }
  }

  // Allebei mislukt: eerlijk zeggen dat het even niet lukt. Publieke paden
  // mogen gewoon door — die hebben geen identiteit nodig.
  if (user === 'onbekend' && (path.startsWith('/admin') || path.startsWith('/api/admin')
    || path.startsWith('/portal') || path.startsWith('/partner'))) {
    return databankOnbereikbaar(path)
  }
  if (user === 'onbekend') user = null

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
    const rol = await lees<{ role?: string }>(
      db.from('user_roles').select('role').eq('user_id', user.id).limit(1).maybeSingle(),
    )
    if (!rol.ok) return databankOnbereikbaar(path)
    const roleData = rol.data

    // Interne accounts moeten óók de tweestapsverificatie hebben doorlopen —
    // anders zou een geldig wachtwoord alleen al volstaan voor de API's.
    // verifyToken rekent enkel lokaal; geen tijdslimiet nodig.
    const twoFaOk = await verifyToken(request.cookies.get(TWO_FA_COOKIE)?.value, user.id)
    // Bij twijfel de code vragen: een tijdsoverschrijding mag nooit een
    // vrijstelling opleveren.
    const codeVerplicht = () => metTijdslimiet(twoFactorRequired(db, user.id), DB_TIJDSLIMIET_MS, true)

    if (roleData?.role === 'admin') {
      // Een account kan van de code vrijgesteld zijn (login_settings). We vragen
      // dat pas op als de code ontbreekt, zodat de normale weg geen extra
      // databasebevraging kost.
      if (!twoFaOk && await codeVerplicht()) {
        return NextResponse.json({ error: 'Verificatie vereist', code: '2fa_required' }, { status: 401 })
      }
      return doorgeven()
    }

    // Geen admin → enkel actieve werknemers, binnen hun modules.
    const staffLezing = await lees<{ active?: boolean; permissions?: unknown }>(
      db.from('staff_members').select('active, permissions').eq('auth_user_id', user.id).maybeSingle(),
    )
    if (!staffLezing.ok) return databankOnbereikbaar(path)
    const staff = staffLezing.data
    const activeStaff = !!staff && staff.active !== false
    if (!activeStaff) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!twoFaOk && await codeVerplicht()) {
      return NextResponse.json({ error: 'Verificatie vereist', code: '2fa_required' }, { status: 401 })
    }
    if (isStaffApiDenied(path)) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (STAFF_API_WHITELIST.some((p) => path === p || path.startsWith(p + '?'))) return doorgeven()
    const perms = Array.isArray(staff!.permissions) ? (staff!.permissions as string[]) : []
    // Toegang tot een dashboard = alle acties in dat dashboard. Gedeelde endpoints
    // geven meerdere modules; de werknemer passeert met één ervan. Ongemapte
    // admin-API's blijven dicht (default-deny).
    const allowedModules = modulesForApiPath(path)
    if (!allowedModules || !allowedModules.some((m) => canSeeModule(perms, m))) {
      return NextResponse.json({ error: 'Geen toegang tot deze module' }, { status: 403 })
    }
    return doorgeven()
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
    return doorgeven()
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
  const rolLezing = await lees<{ role?: string }>(
    db.from('user_roles').select('role').eq('user_id', user.id).limit(1).maybeSingle(),
  )
  // Geen rol kunnen lezen = niet weten of iemand admin is. Dan de deur dicht
  // houden en dat eerlijk zeggen, in plaats van 25 seconden blijven hangen.
  if (!rolLezing.ok) return databankOnbereikbaar(path)

  let role = rolLezing.data?.role as string | undefined

  // staff_members = bron van waarheid voor werknemers. Het app_role-enum bevat
  // mogelijk (nog) geen 'employee', waardoor de rol-rij kan ontbreken; een
  // actieve staff-rij maakt de gebruiker sowieso werknemer. Enkel opzoeken als
  // de rol geen bekende non-employee is (bespaart een query voor admin/klant/partner).
  let staff: { active?: boolean; permissions?: string[] } | null = null
  if (role !== 'admin' && role !== 'client' && role !== 'freelancer') {
    const staffLezing = await lees<{ active?: boolean; permissions?: string[] }>(
      db.from('staff_members').select('active, permissions').eq('auth_user_id', user.id).maybeSingle(),
    )
    if (!staffLezing.ok) return databankOnbereikbaar(path)
    staff = staffLezing.data
    if (staff && staff.active !== false) role = 'employee'
  }

  // Interne accounts (admin + werknemer): tweestapsverificatie verplicht.
  // Klanten en partners loggen gewoon met wachtwoord in.
  if ((role === 'admin' || role === 'employee') && path.startsWith('/admin')) {
    const twoFaOk = await verifyToken(request.cookies.get(TWO_FA_COOKIE)?.value, user.id)
    // Vrijgesteld? Dan volstaat e-mail + wachtwoord. Staat er niets ingesteld,
    // dan blijft de code verplicht — zie twoFactorRequired().
    if (!twoFaOk && await metTijdslimiet(twoFactorRequired(db, user.id), DB_TIJDSLIMIET_MS, true)) {
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

  // Rol en modules meegeven aan de layout, zodat die ze niet opnieuw hoeft op
  // te zoeken. Enkel voor interne accounts: alleen de adminshell leest ze.
  if (role === 'admin' || role === 'employee') {
    return doorgeven({
      userId: user.id,
      role,
      modules: role === 'employee' && Array.isArray(staff?.permissions)
        ? (staff!.permissions as string[])
        : undefined,
    })
  }

  return doorgeven()
}
