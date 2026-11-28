import type { Metadata } from 'next'
import { BeheerClient } from './beheer-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Je meeting — NextGenMedia',
  robots: { index: false, follow: false },
  // De persoonlijke link staat achter # en gaat nooit mee naar andere sites.
  referrer: 'no-referrer',
}

export default function BeheerPagina() {
  return <BeheerClient />
}
