import type { PortalModule } from '@/lib/portal-permissions'
import type { AanvraagSoort } from '@/lib/aanvragen/model'

/** Elke soort aanvraag is een eigen portaalmodule met eigen rechten. */
export const moduleVoor = (soort: AanvraagSoort): PortalModule => (soort === 'dienst' ? 'diensten' : 'consultancy')
export const soortUit = (v: unknown): AanvraagSoort | null => (v === 'dienst' || v === 'consultancy' ? v : null)
