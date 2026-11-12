import { afmeldTokenKlopt } from '@/lib/nieuwsbrieven-server'
import { Afmelden } from './afmelden'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Afmelden voor de nieuwsbrief · NextGenMedia', robots: { index: false } }

/** Publiek: afmelden voor de nieuwsbrief vanuit de mail (ondertekende link). */
export default function AfmeldPagina({ searchParams }: { searchParams: { e?: string; t?: string } }) {
  const email = String(searchParams.e ?? '').trim().toLowerCase()
  const t = String(searchParams.t ?? '')
  const geldig = afmeldTokenKlopt(email, t)
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-3xl border border-gray-200 shadow-sm p-6 sm:p-8 space-y-4">
        <p className="text-sm font-bold">NextGenMedia</p>
        {geldig ? <Afmelden email={email} token={t} /> : (
          <>
            <h1 className="text-xl font-semibold">Deze link werkt niet</h1>
            <p className="text-sm text-gray-600">De afmeldlink is onvolledig of niet meer geldig. Gebruik de link onderaan de laatste nieuwsbrief, of mail ons op info@nextgenmedia.be.</p>
          </>
        )}
      </div>
    </main>
  )
}
