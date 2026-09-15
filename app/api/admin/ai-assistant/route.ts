import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildAiSnapshot } from '@/lib/ai-context'
import { toolsForPrompt, AI_TOOLS } from '@/lib/ai-tools'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export const maxDuration = 60

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'

// NextGen AI — read-only assistent. Beantwoordt vragen over het platform en
// STELT acties VOOR met deep-links, maar voert NOOIT zelf iets uit.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin') return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'AI niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt).' }, { status: 400 })

    const { messages } = await req.json() as { messages: { role: 'user' | 'assistant'; content: string }[] }
    if (!Array.isArray(messages) || messages.length === 0) return NextResponse.json({ error: 'Geen vraag' }, { status: 400 })

    const snapshot = await buildAiSnapshot()
    // Compacte clientregels incl. id zodat de AID de juiste client_id kan invullen.
    const clientLines = snapshot.clients.map((c) =>
      `[${c.id}] ${c.name} | contracten:${c.contracts} getekend:${c.signed} | prognose:${c.forecast ? 'ja' : 'nee'} | framer:${c.framer ? 'ja' : 'nee'} | diensten:${c.services.join(',') || '-'}`
    ).join('\n')

    const system = `Je bent "NextGen AI", de assistent in het interne agency-platform van NextGenMedia (admin).
Je kan vragen beantwoorden, samenvatten, EN acties voorbereiden die de admin daarna bevestigt en jij uitvoert via tools.

WERKWIJZE:
- Eenvoudige vraag/samenvatting → vul "answer".
- Ontbreekt info om een tool correct te vullen (bv. welke klant) → vul "needs_input" met je vraag; geef GEEN plan.
- Wil de gebruiker iets aanmaken/wijzigen/koppelen → maak een "plan": een lijst tool-stappen met exacte params. Toon ze; de admin bevestigt en pas dan voer je uit. Gok nooit een client_id — kies enkel ids uit de momentopname hieronder.
- Meerdere acties = meerdere stappen in volgorde.
- Destructieve tools ([DESTRUCTIEF]) plan je enkel als de gebruiker dat expliciet vraagt; de admin moet extra typen "VERWIJDEREN".

Beschikbare tools (params met * zijn verplicht):
${toolsForPrompt()}

Geef UITSLUITEND geldige JSON terug:
{"answer": "<tekst of leeg>", "needs_input": "<vraag of leeg>", "plan": [{"tool": "<naam>", "params": { ... }, "summary": "<korte NL-omschrijving>"}]}
Laat velden leeg/weg die niet van toepassing zijn. Antwoord in het Nederlands, kort.

Momentopname (${snapshot.generatedAt}):
Totaal klanten: ${snapshot.totals.clients} | facturen te versturen: ${snapshot.totals.invoicesToSend} | contracten op te volgen: ${snapshot.totals.contractsToFollowUp}
Klanten ([id] naam | …):
${clientLines}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(), max_tokens: 2000, system,
        messages: messages.slice(-10).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
      }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return NextResponse.json({ error: `AI-fout: ${json?.error?.message || res.status}` }, { status: 400 })

    const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
    const start = text.indexOf('{'), end = text.lastIndexOf('}')
    let parsed: { answer?: string; needs_input?: string; plan?: { tool: string; params: Record<string, unknown>; summary?: string }[] } = {}
    try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { parsed = { answer: text } }

    // Saneer plan: enkel bestaande tools; markeer destructief.
    const validNames = new Set(AI_TOOLS.map((t) => t.name))
    const plan = (parsed.plan ?? [])
      .filter((step) => step && validNames.has(step.tool))
      .slice(0, 8)
      .map((step) => {
        const tool = AI_TOOLS.find((t) => t.name === step.tool)!
        return { tool: step.tool, params: step.params ?? {}, summary: String(step.summary || tool.summary(step.params ?? {})).slice(0, 160), label: tool.label, destructive: !!tool.destructive }
      })
    const hasDestructive = plan.some((p) => p.destructive)

    return NextResponse.json({
      answer: parsed.answer || (plan.length ? '' : 'Geen antwoord.'),
      needs_input: parsed.needs_input || null,
      plan, hasDestructive,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
