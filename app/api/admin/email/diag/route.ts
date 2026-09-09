import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabase/server'
import { sleutelRechten, RESTRICTED_KEY_HINT } from '@/lib/email'

export const dynamic = 'force-dynamic'

/**
 * Veilige diagnose van de mailinstellingen. Toont nooit een sleutelwaarde.
 *
 * Het belangrijkste hier is `rechten`: een beperkte Resend-sleutel verstuurt
 * gewoon, dus op het eerste gezicht werkt alles — tot je een ingeplande mail wil
 * intrekken of verzetten. Dan pas komt de melding, en dat is te laat. Daarom
 * wordt dat hier vooraf nagegaan, zonder een mail te sturen.
 */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

  const key = process.env.RESEND_API_KEY
  const keySolutions = process.env.RESEND_API_KEY_SOLUTIONS

  const [rechten, rechtenSolutions] = await Promise.all([
    sleutelRechten(key),
    keySolutions ? sleutelRechten(keySolutions) : Promise.resolve('ontbreekt' as const),
  ])

  const uitleg: Record<string, string> = {
    volledig: 'Deze sleutel kan versturen, intrekken en de bezorgstatus opvragen.',
    beperkt: RESTRICTED_KEY_HINT,
    ontbreekt: 'Er is geen sleutel ingesteld.',
    onbekend: 'Kon niet vastgesteld worden — Resend was niet bereikbaar of gaf een onverwacht antwoord.',
  }

  return NextResponse.json({
    resend: {
      aanwezig: !!key,
      lengte: key ? key.length : 0,            // alleen de lengte, nooit de sleutel
      beginMetRe: key ? key.startsWith('re_') : false,
      rechten,
      uitleg: uitleg[rechten],
    },
    resendSolutions: {
      aanwezig: !!keySolutions,
      rechten: rechtenSolutions,
      uitleg: uitleg[rechtenSolutions],
      opmerking: keySolutions
        ? null
        : 'Niet ingesteld: mails van NextGenSolutions vertrekken dan met de gewone sleutel, en dus vanaf het andere domein.',
    },
    emailFrom: process.env.EMAIL_FROM || '(standaard) NextGenMedia <info@nextgenmedia.be>',
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || '(niet gezet)',
    // Zonder deze URL haalt Resend de one-pager op bij de deployment-URL van
    // Vercel, en die zit achter authenticatie — dan mislukt de bijlage.
    bijlageWaarschuwing: process.env.NEXT_PUBLIC_SITE_URL
      ? null
      : 'NEXT_PUBLIC_SITE_URL is niet gezet. De one-pager wordt dan opgehaald bij de deployment-URL van Vercel, die achter authenticatie zit; de bijlage mislukt dan.',
    hasCronSecret: !!process.env.CRON_SECRET,
  })
}
