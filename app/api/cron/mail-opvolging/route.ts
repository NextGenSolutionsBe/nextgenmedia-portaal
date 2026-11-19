import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesMailEnAgenda } from '@/lib/mail-opvolging/sync-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Mail-opvolging: de mailboxen en agenda's lezen (enkel lezen, nooit iets
// versturen of verplaatsen). Beveiligd met CRON_SECRET: Vercel Cron stuurt
// Authorization: Bearer <secret>. Geen ?key= in de url (die komt in logs).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const r = await leesMailEnAgenda(createAdminSupabaseClient())
  return NextResponse.json({ ok: true, gekoppeld: r.gekoppeld, mappen: r.mappen.map((m) => ({ mailbox: m.mailbox, map: m.map, gelezen: m.gelezen, bewaard: m.bewaard, fout: m.fout })), meetings: r.meetings, agendaFout: r.agendaFout, projecten: r.projecten })
}
