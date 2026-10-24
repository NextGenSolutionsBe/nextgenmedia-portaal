export const dynamic = 'force-dynamic'

import { FormulierenLijst } from './formulieren-lijst'

/**
 * Formulieren — intake- en algemene formulieren die klanten via een link
 * invullen. Toegang (module 'formulieren') regelt de middleware centraal.
 * `?klant=<id>` komt uit de klant-hub ("Formulier versturen").
 */
export default function FormulierenPagina({ searchParams }: { searchParams: { klant?: string } }) {
  const klant = typeof searchParams?.klant === 'string' && /^[0-9a-f-]{36}$/i.test(searchParams.klant) ? searchParams.klant : null
  return <FormulierenLijst klantId={klant} />
}
