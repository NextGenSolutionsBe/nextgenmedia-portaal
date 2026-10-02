import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { formulierGuard } from '@/lib/formulieren/server'
import { genereerFormulier } from '@/lib/formulieren/ai'
import { geldigeDienst } from '@/lib/formulieren/model'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * AI-voorstel voor de velden van een formulier. Geeft enkel een VOORSTEL terug;
 * er wordt niets opgeslagen — de builder toont het en de gebruiker beslist
 * (vervangen of toevoegen) en slaat daarna zelf op.
 */
export async function POST(req: NextRequest) {
  const g = await formulierGuard('toevoegen')
  if (!g.ok) return g.response

  const rl = await rateLimit(`formulier-ai:${g.actor.userId}`, { limit: 20, windowSec: 3600 })
  if (!rl.allowed) return NextResponse.json({ error: 'Je hebt het AI-limiet bereikt (20 voorstellen per uur). Probeer het straks opnieuw.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const prompt = String(b.prompt ?? '').trim().slice(0, 4000)
  if (prompt.length < 10) return NextResponse.json({ error: 'Beschrijf in minstens één zin wat het formulier moet vragen.' }, { status: 400 })

  try {
    const voorstel = await genereerFormulier({ prompt, dienst: geldigeDienst(b.dienst), doel: String(b.doel ?? '').trim().slice(0, 120) })
    return NextResponse.json({ voorstel })
  } catch (err) {
    // Onze eigen meldingen (key ontbreekt, AI-fout, onleesbaar antwoord) zijn bedoeld voor de gebruiker.
    const msg = err instanceof Error ? err.message : 'AI-voorstel mislukt.'
    console.error('[formulieren-ai]', msg)
    const status = /ANTHROPIC_API_KEY/.test(msg) ? 503 : 502
    return NextResponse.json({ error: msg.slice(0, 300) }, { status })
  }
}
