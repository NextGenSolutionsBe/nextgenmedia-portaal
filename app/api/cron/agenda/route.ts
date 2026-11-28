import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { cronToegang } from '@/lib/meetings/cron-toegang'
import { importeerClickup } from '@/lib/agenda/clickup-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Agenda bijhouden (lib/agenda/clickup-import.ts): ClickUp overnemen per bron,
 * eerst alles, daarna enkel wat veranderde. Aangeroepen door pg_cron (job
 * 'agenda-clickup', elke 5 minuten) met het geheim van de scheduler; zonder
 * geldig geheim gebeurt er niets. Body { mail: true } leest ook de mailboxen
 * na op uitnodigingen (job 'agenda-mail', elk uur).
 */
export async function POST(req: NextRequest) {
  const toegang = await cronToegang(req)
  if (toegang === 'onbereikbaar') return NextResponse.json({ error: 'Databank even niet bereikbaar' }, { status: 503 })
  if (toegang !== 'ja') return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const b = (await req.json().catch(() => ({}))) as { mail?: unknown; controle?: unknown; labels?: unknown }
  const admin = createAdminSupabaseClient()
  if (b.labels === 'proef' || b.labels === 'toepassen') {
    // Een categorielabel op elke taak die er nog geen heeft (enkel bijzetten, nooit iets weghalen).
    const { labelAlleTaken } = await import('@/lib/agenda/labels-server')
    return NextResponse.json({ ok: true, labels: await labelAlleTaken(admin, { proef: b.labels === 'proef' }) })
  }
  if (b.controle === true) {
    // Enkel aantallen, geen inhoud: werkt de vraag per periode (deze week)?
    const { bereikVan, vandaag } = await import('@/lib/agenda/model')
    const { itemsInBereik } = await import('@/lib/agenda/server')
    const r = bereikVan('week', vandaag())
    const items = await itemsInBereik(admin, r.van, r.tot)
    return NextResponse.json({ ok: true, week: r, items: items.length, meetings: items.filter((i) => i.soort === 'meeting').length, open: items.filter((i) => i.status === 'open').length })
  }
  if (b.mail === true) {
    const { leesUitnodigingen } = await import('@/lib/agenda/mail-uitnodigingen')
    const r = await leesUitnodigingen(admin, { budgetMs: 200_000 })
    return NextResponse.json({ ok: true, mail: r })
  }
  const r = await importeerClickup(admin, { budgetMs: 240_000 })
  return NextResponse.json({ ok: true, bronnen: r.map((x) => ({ bron: x.bron, fase: x.fase, klaar: x.klaar, tellers: x.tellers, fout: x.fout })) })
}
