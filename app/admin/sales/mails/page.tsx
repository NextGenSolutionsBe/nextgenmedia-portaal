export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { MailOverview } from './mail-overview'

/**
 * Opruimscherm — herinneringsmails bestaan niet meer.
 *
 * We sturen niets meer automatisch naar een prospect; dat is nu een belletje
 * (Verkoop → Bevestigingen). Deze pagina staat bewust niet meer in het menu,
 * maar blijft bereikbaar om één reden: mails die eerder ingepland zijn liggen
 * bij Resend en gaan gewoon uit, ook al staat er hier geen code meer voor. Die
 * moet je kunnen intrekken.
 *
 * Is de lijst leeg, dan is deze pagina overbodig en mag ze weg.
 */
export default function SalesMailsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Oude herinneringsmails opruimen</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Er worden geen nieuwe meer ingepland. Dit scherm bestaat alleen nog om wat al klaarstond in te trekken.
        </p>
      </div>

      <div className="card-base bg-amber-50 border-amber-200 text-sm text-amber-800 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <p>
            Mails die eerder ingepland zijn staan bij Resend klaar en vertrekken alsnog — het weghalen van de
            functie stopt die niet. Staat er hieronder nog iets op <b>ingepland</b>, trek het dan hier in.
          </p>
          <p className="mt-1">
            Bevestigen doen we voortaan telefonisch:{' '}
            <Link href="/admin/sales/herinneringen" className="underline font-medium">Verkoop → Bevestigingen</Link>.
          </p>
        </div>
      </div>

      <MailOverview />
    </div>
  )
}
