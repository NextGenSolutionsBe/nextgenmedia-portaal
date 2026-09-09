import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * UITGESCHAKELD — er gaan geen herinneringsmails meer naar prospects.
 *
 * In plaats daarvan bellen we twee dagen vooraf zelf; zie Verkoop →
 * Bevestigingen. Het schema is uit vercel.json gehaald, maar deze route blijft
 * bestaan en doet bewust niets: een cron die ergens nog geregistreerd staat mag
 * niet alsnog mails de deur uit sturen.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    uitgeschakeld: true,
    reden: 'Herinneringsmails zijn vervangen door de bellijst onder Verkoop → Bevestigingen.',
  })
}
