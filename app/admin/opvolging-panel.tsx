import { buildOpvolging } from '@/lib/notifications'
import { OpvolgingKaarten } from './opvolging-kaarten'

// "Op te volgen" — bovenaan het Command Center. De gegevens komen uit
// buildOpvolging (lib/notifications.ts); elke kaart hangt aan een module en
// wie die niet heeft, ziet de kaart niet. Het scherm staat in opvolging-kaarten.tsx.
export async function OpvolgingPanel({ modules = null }: { modules?: string[] | null }) {
  const groepen = await buildOpvolging(modules)
  if (!groepen.length) return null
  return <OpvolgingKaarten groepen={groepen} />
}
