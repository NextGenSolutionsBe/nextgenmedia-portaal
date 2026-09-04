import 'server-only'
import { headers } from 'next/headers'
import { getSessionUser, getUserRole, getStaffRow } from '@/lib/supabase/server'

/**
 * Rol en modulerechten van de ingelogde interne gebruiker, voor de adminshell.
 *
 * De middleware heeft dit vlak hiervoor al opgezocht en geeft het door in
 * headers (zie lib/supabase/middleware.ts). Zonder die doorgifte deed de layout
 * exact hetzelfde werk over: twee extra netwerkoproepen naar Supabase, achter
 * elkaar, vóór er ook maar iets van de pagina werd opgehaald.
 *
 * BEVEILIGING — headers zijn op zichzelf niet te vertrouwen; een bezoeker kan
 * ze meesturen. Twee sloten:
 *  1. De middleware gooit elke binnengekomen variant weg en zet enkel zijn
 *     eigen waarde. Iedere doorloop loopt daar langs (`doorgeven`).
 *  2. Hier controleren we of het meegegeven gebruikers-id overeenkomt met de
 *     ECHTE sessie. Klopt dat niet, dan negeren we de header volledig en
 *     lezen we gewoon de database — trager, maar nooit fout.
 *
 * De rol die hieruit komt bepaalt enkel wat de shell TOONT. De echte
 * afscherming zit in de middleware (routering) en in de guards van elke API.
 */

const HDR_USER = 'x-ngm-user'
const HDR_ROLE = 'x-ngm-role'
const HDR_MODULES = 'x-ngm-modules'
const HDR_NAAM = 'x-ngm-naam'

export type AdminIdentiteit = {
  userId: string
  /** Voornaam zoals die in de shell getoond wordt ("Welkom, Fabio"). */
  naam: string
  /** Het e-mailadres van de sessie — het harde antwoord op "welk account is dit?". */
  email: string
  /** 'admin' | 'employee', of undefined als de gebruiker geen van beide is. */
  role: string | undefined
  /** undefined = admin (alles); anders de toegestane module-keys. */
  modules: string[] | undefined
  /** Kwam dit uit de header (snel) of uit de database (terugval)? */
  bron: 'header' | 'database'
}

export async function leesAdminIdentiteit(): Promise<AdminIdentiteit | null> {
  const user = await getSessionUser()
  if (!user) return null

  const h = await headers()
  const headerUser = h.get(HDR_USER)
  const headerRole = h.get(HDR_ROLE)

  // Slot 2: enkel vertrouwen als de header over DEZE sessie gaat.
  if (headerUser && headerUser === user.id && (headerRole === 'admin' || headerRole === 'employee')) {
    let modules: string[] | undefined
    if (headerRole === 'employee') {
      // Ontbrekende of stukke JSON → géén rechten, niet "alle rechten".
      modules = []
      const ruw = h.get(HDR_MODULES)
      if (ruw) {
        try {
          const ontleed: unknown = JSON.parse(ruw)
          if (Array.isArray(ontleed)) modules = ontleed.filter((m): m is string => typeof m === 'string')
        } catch { /* modules blijft leeg */ }
      }
    }
    // De middleware codeert de naam (headers dragen geen accenten); stukke
    // codering mag nooit de hele shell laten klappen voor een begroeting.
    let headerNaam: string | null = null
    const ruweNaam = h.get(HDR_NAAM)
    if (ruweNaam) { try { headerNaam = decodeURIComponent(ruweNaam) } catch { headerNaam = null } }

    return { userId: user.id, ...naamVan(user, headerNaam), role: headerRole, modules, bron: 'header' }
  }

  // Terugval: gewoon opvragen. Gebeurt als de middleware niet liep, of als de
  // header niet bij deze sessie hoort.
  let role = await getUserRole(user.id)
  let modules: string[] | undefined
  let staffNaam: string | null = null
  if (role !== 'admin') {
    const staff = await getStaffRow(user.id)
    staffNaam = staff?.name ?? null
    if (staff && staff.active !== false) {
      role = 'employee'
      modules = Array.isArray(staff.permissions) ? (staff.permissions as string[]) : []
    } else if (staff && staff.active === false) {
      // Uitgeschakelde werknemer — geen rol, de layout stuurt door naar /login.
      return { userId: user.id, ...naamVan(user, staff?.name ?? null), role: undefined, modules: undefined, bron: 'database' }
    }
  }
  return { userId: user.id, ...naamVan(user, staffNaam), role, modules, bron: 'database' }
}

/**
 * Hoe heet de ingelogde persoon?
 *
 * Drie bronnen, in deze volgorde: de naam op het account, de naam bij de
 * werknemer (die de middleware al ophaalde voor de rechten — dus gratis), en
 * anders het stuk vóór de @ van het e-mailadres.
 *
 * GEEN extra databankoproep. Dit draait op élke adminpagina; de authketen was
 * eerder al de traagste schakel van de app en daar zetten we geen query bij
 * voor een begroeting.
 *
 * Bij een gedeelde postbus (info@, admin@, sales@) geven we GEEN naam terug:
 * "Welkom, Info" slaat nergens op. Dan toont de shell enkel "Welkom" met het
 * adres eronder — dat adres is toch het echte antwoord op "welk account is dit?".
 */
const GEDEELD = new Set(['info', 'admin', 'contact', 'hallo', 'hello', 'team', 'sales', 'noreply'])

function naamVan(
  user: { email?: string | null; user_metadata?: Record<string, unknown> },
  staffNaam: string | null,
): { naam: string; email: string } {
  const email = user.email ?? ''
  const uitMeta = (k: string) => {
    const v = user.user_metadata?.[k]
    return typeof v === 'string' && v.trim() ? v.trim() : ''
  }
  const lokaal = email.split('@')[0] ?? ''
  const ruw = uitMeta('name') || uitMeta('full_name') || (staffNaam ?? '').trim()
    || (GEDEELD.has(lokaal.toLowerCase()) ? '' : lokaal)
  if (!ruw) return { naam: '', email }

  // Alleen de voornaam, met een hoofdletter: "Welkom, Fabio" leest beter dan
  // "Welkom, fabio.vandenberghe".
  const eerste = ruw.split(/[\s._-]+/)[0]
  return { naam: eerste.charAt(0).toUpperCase() + eerste.slice(1), email }
}
