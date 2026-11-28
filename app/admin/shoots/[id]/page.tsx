import { redirect } from 'next/navigation'
import { magIk } from '@/lib/instellingen/laden'
import { isDatum } from '@/lib/shoots/model'
import { ShootEditor } from './shoot-editor'

export const dynamic = 'force-dynamic'
const uur = (v: string | undefined) => (v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null)

/** Eén shoot in de shoot planner (id = "nieuw" voor een nieuwe, met ?datum=, ?klant=, ?van= en ?tot=; ?terug=agenda vanuit de agenda). */
export default async function ShootPagina({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ datum?: string; klant?: string; van?: string; tot?: string; terug?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const nieuw = id === 'nieuw'
  if (!nieuw && !/^[0-9a-f-]{36}$/i.test(id)) redirect('/admin/shoots')
  if (!(await magIk('shoots', nieuw ? 'toevoegen' : 'bekijken'))) redirect('/admin/shoots')
  const [aanpassen, verwijderen] = await Promise.all([magIk('shoots', nieuw ? 'toevoegen' : 'aanpassen'), magIk('shoots', 'verwijderen')])
  return (
    <div className="animate-fade-in">
      <ShootEditor id={id} startDatum={isDatum(sp.datum) ? sp.datum : null} startKlant={sp.klant && /^[0-9a-f-]{36}$/i.test(sp.klant) ? sp.klant : null}
        startVan={uur(sp.van)} startTot={uur(sp.tot)} terug={sp.terug === 'agenda' ? 'agenda' : null}
        magAanpassen={!!aanpassen} magVerwijderen={!!verwijderen && !nieuw} />
    </div>
  )
}
