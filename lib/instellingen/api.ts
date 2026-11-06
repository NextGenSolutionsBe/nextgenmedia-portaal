import 'server-only'
import { NextResponse } from 'next/server'
import { magInstellingenBeheren, leesPersoon, type IngelogdePersoon } from './laden'

/** Toegangscontrole voor de instellingen-API: hoofdbeheerder, of beheerder met het recht 'instellingen'. */
export async function eisBeheer(): Promise<{ ok: true; persoon: IngelogdePersoon } | { ok: false; response: NextResponse }> {
  const persoon = await magInstellingenBeheren()
  if (!persoon) return { ok: false, response: NextResponse.json({ error: 'Geen toegang tot de instellingen' }, { status: 403 }) }
  return { ok: true, persoon }
}

/** Enkel hoofdbeheerders (admin-accounts): medewerkers beheren, logo, integratietests. */
export async function eisHoofdbeheerder(): Promise<{ ok: true; persoon: IngelogdePersoon } | { ok: false; response: NextResponse }> {
  const persoon = await leesPersoon()
  if (!persoon?.isAdmin) return { ok: false, response: NextResponse.json({ error: 'Enkel een hoofdbeheerder mag dit.' }, { status: 403 }) }
  return { ok: true, persoon }
}

/** Een sleutel of token tonen zonder hem prijs te geven: enkel de laatste vier tekens. */
export function maskeer(geheim: string | null | undefined): string | null {
  const s = (geheim ?? '').trim()
  if (!s) return null
  return s.length <= 4 ? '••••' : `••••••••${s.slice(-4)}`
}

const GEVOELIG = /(token|secret|password|wachtwoord|api[_-]?key|sleutel|authorization|cookie|bearer|service_role)/i

/** Gevoelige velden uit logboekgegevens halen vóór ze naar de browser gaan. */
export function schoonMetadata(v: unknown, diepte = 0): unknown {
  if (diepte > 6) return '…'
  if (Array.isArray(v)) return v.map((x) => schoonMetadata(x, diepte + 1))
  if (v && typeof v === 'object') {
    const uit: Record<string, unknown> = {}
    for (const [k, w] of Object.entries(v as Record<string, unknown>)) uit[k] = GEVOELIG.test(k) ? '[verborgen]' : schoonMetadata(w, diepte + 1)
    return uit
  }
  if (typeof v === 'string' && /^(sk-ant-|re_|pk_|eyJ)[A-Za-z0-9._-]{12,}/.test(v)) return '[verborgen]'
  return v
}
