import { buildOpvolging } from '@/lib/notifications'
import { leesBedrijfFilter } from '@/lib/bedrijven/weergave'
import { OpvolgingKaarten } from './opvolging-kaarten'

// "Op te volgen" — bovenaan het Command Center. De gegevens komen uit
// buildOpvolging (lib/notifications.ts); elke kaart hangt aan een module en
// wie die niet heeft, ziet de kaart niet. Het scherm staat in opvolging-kaarten.tsx.
// De weergave Alles / Media / Solutions (zijbalk) geldt ook hier.
export async function OpvolgingPanel({ modules = null, userId = null }: { modules?: string[] | null; userId?: string | null }) {
  const groepen = await buildOpvolging(modules, await leesBedrijfFilter(userId))
  if (!groepen.length) return null
  return <OpvolgingKaarten groepen={groepen} />
}
