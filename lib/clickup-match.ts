import 'server-only'
import type { ClickupMember } from '@/lib/clickup'
import { fetchMetLimiet } from '@/lib/fetch-met-limiet'

// Matcht een partnernaam op een ClickUp-lid. Namen komen vaak niet exact overeen,
// dus: eerst exact, dan fuzzy, dan AI (Claude) als laatste redmiddel.

export type MemberMatch = { id: number; name: string; method: 'exact' | 'fuzzy' | 'ai'; confidence: number } | null

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim()

function fuzzy(partner: string, members: ClickupMember[]): MemberMatch {
  const want = norm(partner)
  if (!want) return null
  const wantTokens = new Set(want.split(/\s+/).filter(Boolean))
  let best: { m: ClickupMember; score: number } | null = null
  for (const m of members) {
    const uname = norm(m.username)
    const emailLocal = norm((m.email.split('@')[0] ?? '').replace(/[._]/g, ' '))
    let score = 0
    if (uname === want) score = 1
    else if (uname && (uname.includes(want) || want.includes(uname))) score = 0.85
    else {
      const tokens = new Set([...uname.split(/\s+/), ...emailLocal.split(/\s+/)].filter(Boolean))
      const overlap = [...wantTokens].filter((t) => tokens.has(t)).length
      if (overlap > 0) score = 0.5 + 0.2 * overlap
    }
    if (score > 0 && (!best || score > best.score)) best = { m, score }
  }
  if (best && best.score >= 0.85) return { id: best.m.id, name: best.m.username || best.m.email, method: 'fuzzy', confidence: Math.min(0.99, best.score) }
  return null
}

async function aiMatch(partner: string, members: ClickupMember[]): Promise<MemberMatch> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || members.length === 0) return null
  const model = process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'
  const list = members.map((m) => `${m.id}: ${m.username}${m.email ? ` <${m.email}>` : ''}`).join('\n')
  const prompt = `Match de partnernaam aan het juiste ClickUp-lid. Namen kunnen afwijken (voornaam/achternaam, bijnaam, e-mail).
Partner: "${partner}"
Leden:
${list}

Geef UITSLUITEND JSON: {"id": <lid-id of null>, "confidence": <0-1>}. null als er geen redelijke match is.`
  try {
    const res = await fetchMetLimiet('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 100, messages: [{ role: 'user', content: prompt }] }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return null
    const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0]) as { id: number | null; confidence?: number }
    if (parsed.id == null) return null
    const member = members.find((x) => x.id === Number(parsed.id))
    if (!member) return null
    return { id: member.id, name: member.username || member.email, method: 'ai', confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7)) }
  } catch { return null }
}

export async function matchPartnerToMember(partnerName: string | null | undefined, members: ClickupMember[]): Promise<MemberMatch> {
  const name = (partnerName ?? '').trim()
  if (!name || members.length === 0) return null
  // 1) exact username/e-mail
  const want = norm(name)
  const exact = members.find((m) => norm(m.username) === want || norm((m.email.split('@')[0] ?? '')) === want)
  if (exact) return { id: exact.id, name: exact.username || exact.email, method: 'exact', confidence: 1 }
  // 2) fuzzy, 3) AI
  return fuzzy(name, members) ?? (await aiMatch(name, members))
}
