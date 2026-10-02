export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { Clock, Link2Off, Lock, CheckCircle2 } from 'lucide-react'
import { Logo } from '@/components/logo'
import { laadPubliekeLink } from '@/lib/formulieren/server'
import { PubliekFormulier } from './publiek-formulier'

export const metadata: Metadata = {
  title: 'Formulier — NextGenMedia',
  robots: { index: false, follow: false },
}

/**
 * Publiek formulier via een deellink (/f/<token>) — geen login nodig.
 * De link wordt server-side opgelost met de service-role; de klant ziet enkel
 * de titel, de uitleg en de velden. Nooit andere inzendingen of interne ids
 * buiten wat nodig is.
 */
export default async function PubliekFormulierPagina({ params }: { params: { token: string } }) {
  let pub: Awaited<ReturnType<typeof laadPubliekeLink>>
  try { pub = await laadPubliekeLink(params.token) } catch { pub = { status: 'onbekend' } }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Logo className="h-8 w-8" />
          <span className="font-bold text-sm">NextGenMedia</span>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:py-10">
        {pub.status === 'ok' && pub.formulier
          ? (
            <PubliekFormulier
              token={params.token}
              titel={pub.formulier.titel}
              beschrijving={pub.formulier.beschrijving}
              velden={pub.formulier.velden}
              instellingen={pub.formulier.instellingen}
              klantNaam={pub.klantNaam ?? null}
            />
          )
          : <Melding status={pub.status} />}
      </main>
      <footer className="px-4 py-6 text-center text-xs text-gray-400">
        NextGenMedia · <a href="https://nextgenmedia.be" className="hover:text-gray-600">nextgenmedia.be</a>
      </footer>
    </div>
  )
}

function Melding({ status }: { status: string }) {
  const inhoud: Record<string, { icoon: React.ElementType; kleur: string; titel: string; tekst: string }> = {
    verlopen: { icoon: Clock, kleur: 'bg-amber-100 text-amber-700', titel: 'Deze link is verlopen', tekst: 'Neem contact op met NextGenMedia als je het formulier toch nog wil invullen — we sturen je graag een nieuwe link.' },
    gesloten: { icoon: Lock, kleur: 'bg-gray-100 text-gray-600', titel: 'Dit formulier is momenteel niet beschikbaar', tekst: 'Het formulier is (nog) niet geopend of werd afgesloten. Neem gerust contact met ons op.' },
    gebruikt: { icoon: CheckCircle2, kleur: 'bg-green-100 text-green-700', titel: 'Dit formulier werd al ingevuld', tekst: 'Via deze link werden je antwoorden al verstuurd. Wil je nog iets aanvullen? Neem contact met ons op.' },
  }
  const m = inhoud[status] ?? { icoon: Link2Off, kleur: 'bg-red-100 text-red-600', titel: 'Deze link werkt niet (meer)', tekst: 'Controleer of je de volledige link gebruikt, of vraag NextGenMedia om een nieuwe link.' }
  const Icoon = m.icoon
  return (
    <div className="max-w-md mx-auto bg-white border border-gray-200 rounded-2xl p-8 text-center">
      <div className={`h-12 w-12 rounded-full flex items-center justify-center mx-auto mb-3 ${m.kleur}`}><Icoon className="h-6 w-6" /></div>
      <h1 className="font-semibold text-lg mb-1">{m.titel}</h1>
      <p className="text-sm text-gray-500">{m.tekst}</p>
      <a href="mailto:info@nextgenmedia.be" className="btn-primary mt-5">Contact opnemen</a>
    </div>
  )
}
