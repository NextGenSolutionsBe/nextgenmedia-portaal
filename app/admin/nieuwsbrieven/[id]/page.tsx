import { redirect } from 'next/navigation'
import { magIk } from '@/lib/instellingen/laden'
import { NieuwsbriefEditor } from './editor'

export const dynamic = 'force-dynamic'

export default async function NieuwsbriefPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await magIk('nieuwsbrieven', 'bekijken'))) redirect('/admin')
  const { id } = await params
  const magAanpassen = !!(await magIk('nieuwsbrieven', 'aanpassen'))
  const magVerwijderen = !!(await magIk('nieuwsbrieven', 'verwijderen'))
  return <NieuwsbriefEditor id={id} magAanpassen={magAanpassen} magVerwijderen={magVerwijderen} />
}
