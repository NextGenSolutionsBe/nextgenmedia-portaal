import { NextRequest, NextResponse } from 'next/server'
import { requireStaff } from '@/lib/supabase/server'
import { MAX_DICTEERTEKST, naarOpgekuist, opkuisPrompt, ruwNetjes } from '@/lib/dicteren'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST { tekst, context? } → { tekst, opgekuist }
 * Een ingesproken notitie opkuisen (leestekens, cijfers, namen, zonder "euh").
 * Enkel tekst gaat naar de AI, geen audio; er wordt niets bewaard. Lukt de AI
 * niet, dan komt de ruwe tekst terug: dicteren mag nooit tekst verliezen.
 * Elke interne gebruiker (staff), zoals de notities zelf.
 */
export async function POST(req: NextRequest) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const b = (await req.json().catch(() => ({}))) as { tekst?: unknown; context?: unknown }
  const ruw = typeof b.tekst === 'string' ? b.tekst.slice(0, MAX_DICTEERTEKST) : ''
  if (!ruw.trim()) return NextResponse.json({ error: 'Er werd niets herkend.' }, { status: 400 })
  const context = typeof b.context === 'string' && b.context.trim() ? b.context.trim().slice(0, 300) : null
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || ruw.trim().split(/\s+/).length < 3) return NextResponse.json({ tekst: ruwNetjes(ruw), opgekuist: false })
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.BLOG_AI_MODEL || 'claude-opus-5-5', max_tokens: 4000, messages: [{ role: 'user', content: opkuisPrompt(ruw, context) }] }),
      signal: AbortSignal.timeout(45_000),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || json?.stop_reason === 'refusal') return NextResponse.json({ tekst: ruwNetjes(ruw), opgekuist: false })
    const tekst: string = (json?.content ?? []).map((x: { type?: string; text?: string }) => (x.type === 'text' ? x.text ?? '' : '')).join('')
    return NextResponse.json(naarOpgekuist(tekst, ruw))
  } catch {
    return NextResponse.json({ tekst: ruwNetjes(ruw), opgekuist: false })
  }
}
