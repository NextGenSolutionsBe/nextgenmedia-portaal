import 'server-only'
import { valideerFacturatie } from '@/lib/instellingen/valideer'
import { STANDAARD_FACTURATIE } from '@/lib/instellingen/model'
import { betaaltermijn } from '@/lib/ngs/facturatie'

// Elke databankclient met .from() (sommige routes gebruiken een eigen, smaller type).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (tabel: string) => any }

/**
 * De betaaltermijn van een bedrijf (Instellingen → Diensten → Bedrijven), anders
 * de algemene (Instellingen → Facturatie). Nieuwe werking fase 5: nooit meer een
 * vast getal in de code. Leest rechtstreeks via de meegegeven client, zodat het
 * ook werkt waar de instellingenlader niet beschikbaar is.
 */
export async function betaaltermijnVan(admin: Admin, bedrijf: string | null | undefined, standaard?: number): Promise<number> {
  let algemeen = standaard
  if (algemeen === undefined) {
    const { data } = await admin.from('app_settings').select('value').eq('key', 'facturatie').maybeSingle()
    const v = (data as { value?: unknown } | null)?.value
    const f = v ? valideerFacturatie(v) : null
    algemeen = f && f.ok ? f.waarde.betalingstermijn_dagen : STANDAARD_FACTURATIE.betalingstermijn_dagen
  }
  if (!bedrijf) return algemeen
  const { data } = await admin.from('bedrijven').select('betaaltermijn_dagen').eq('slug', bedrijf).maybeSingle()
  return betaaltermijn((data as { betaaltermijn_dagen?: number | null } | null)?.betaaltermijn_dagen ?? null, algemeen)
}
