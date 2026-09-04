import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Read-only statuscheck: is de AI (Anthropic) geconfigureerd in deze omgeving?
// Geeft NOOIT de sleutel terug — enkel of die aanwezig is + welk model.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const key = process.env.ANTHROPIC_API_KEY ?? ''
  return NextResponse.json({
    hasKey: key.trim().length > 0,
    keyHint: key ? `${key.slice(0, 7)}…${key.slice(-2)}` : null, // bv. "sk-ant-…az" — genoeg om te herkennen, niet bruikbaar
    model: process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6',
    framerEnabled: process.env.FRAMER_ENABLED === 'true',
  })
}
