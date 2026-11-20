import type { Metadata } from 'next'
import { BoekClient } from './boek-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Gratis kennismaking — NextGenMedia',
  description: 'Plan een gratis meeting van 30 minuten met NextGenMedia via Google Meet.',
}

export default function BoekenPagina() {
  return <BoekClient />
}
