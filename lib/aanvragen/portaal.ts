import type { PortalModule } from '@/lib/portal-permissions'
import { isSoort, type AanvraagSoort } from '@/lib/aanvragen/model'

/** Elke soort aanvraag is een eigen portaalmodule met eigen rechten. */
export const moduleVoor = (soort: AanvraagSoort): PortalModule => (soort === 'dienst' ? 'diensten' : soort === 'consultancy' ? 'consultancy' : 'founders')
export const soortUit = (v: unknown): AanvraagSoort | null => (isSoort(v) ? v : null)
