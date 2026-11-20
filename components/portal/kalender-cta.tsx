import Link from 'next/link'
import { ArrowRight, CalendarDays, Lightbulb, Sparkles } from 'lucide-react'

/**
 * Opvallende doorverwijzing onder de contentkalender van de klant: een dienst
 * aanvragen, consultancy aanvragen of een meeting inplannen. Enkel de modules
 * waarvoor de sessie `view` heeft (de oproeper beslist, zelfde regel als het dashboard).
 */
export function KalenderCta({ mag }: { mag: { diensten: boolean; consultancy: boolean; meetings: boolean } }) {
  if (!mag.diensten && !mag.consultancy && !mag.meetings) return null
  return (
    <section aria-label="Meer nodig?" className="relative overflow-hidden rounded-2xl bg-gray-950 text-white p-5 sm:p-6">
      <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-[#fff848]/20 blur-3xl" aria-hidden />
      <div className="relative flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-8">
        <div className="flex-1 space-y-1.5">
          <h2 className="text-lg sm:text-xl font-semibold text-white leading-snug">Iets extra nodig naast je kalender?</h2>
          <p className="text-sm text-white/75 max-w-xl">Een extra shoot, advertenties of een nieuwe campagne. Vraag het aan of plan meteen een meeting met ons team.</p>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 shrink-0">
          {mag.diensten && (
            <Link href="/portal/diensten" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#fff848] text-gray-950 font-semibold px-4 py-2.5 text-sm hover:brightness-95 transition">
              <Sparkles className="h-4 w-4" />Dienst aanvragen<ArrowRight className="h-4 w-4" />
            </Link>
          )}
          {mag.consultancy && (
            <Link href="/portal/consultancy" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white text-gray-950 font-semibold px-4 py-2.5 text-sm hover:bg-gray-100 transition">
              <Lightbulb className="h-4 w-4" />Consultancy aanvragen
            </Link>
          )}
          {mag.meetings && (
            <Link href="/portal/meetings" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 text-white font-semibold px-4 py-2.5 text-sm hover:bg-white/10 transition">
              <CalendarDays className="h-4 w-4" />Meeting inplannen
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}
