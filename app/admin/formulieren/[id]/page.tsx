export const dynamic = 'force-dynamic'

import { FormulierEditor, type Tab } from './formulier-editor'

const TABS: Tab[] = ['velden', 'delen', 'inzendingen', 'instellingen']

/** Eén formulier: velden bouwen, delen, inzendingen en instellingen. */
export default function FormulierPagina({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string; klant?: string } }) {
  const tab = TABS.includes(searchParams?.tab as Tab) ? (searchParams.tab as Tab) : 'velden'
  const klant = typeof searchParams?.klant === 'string' && /^[0-9a-f-]{36}$/i.test(searchParams.klant) ? searchParams.klant : null
  return <FormulierEditor id={params.id} startTab={tab} klantId={klant} />
}
