import type { Metadata } from 'next'
import { Welkom } from './welkom-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Welkom bij NextGenMedia', robots: { index: false, follow: false } }

/** Publiek: de activatielink uit de welkomstmail (token in de link, eigen controle in de API). */
export default function WelkomPagina({ params }: { params: { token: string } }) {
  return <Welkom token={params.token} />
}
