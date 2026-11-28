import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { isStageKey } from '@/lib/sales/stages'

export const dynamic = 'force-dynamic'

/**
 * POST { stage, ids[] } — de volgorde binnen één kolom vastleggen.
 *
 * Het bord stuurt na een sleep de VOLLEDIGE volgorde van de doelkolom (en van
 * de bronkolom als die verschilt). `positie` wordt dan 0, 1, 2, … in die
 * volgorde; de fase wordt meegezet zodat een kaart nooit in een andere kolom
 * staat dan zijn positie zegt.
 *
 * Bewust GEEN activiteit of tijdlijnregel: herordenen is geen gebeurtenis op
 * de lead. De fasewissel zelf logt de PATCH-route.
 */
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const stage = String(b.stage ?? '')
    if (!isStageKey(stage)) return NextResponse.json({ error: 'Onbekende fase' }, { status: 400 })
    const ids = Array.isArray(b.ids) ? [...new Set((b.ids as unknown[]).map(String).filter(Boolean))] : []
    if (ids.length === 0) return NextResponse.json({ ok: true })
    if (ids.length > 20000) return NextResponse.json({ error: 'Te veel kaarten in één keer' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    // Snelle weg: één statement in de databank (functie uit de migratie).
    // Bestaat die nog niet, dan per rij hieronder.
    {
      const { error } = await admin.rpc('sales_herorden', { p_stage: stage, p_ids: ids })
      if (!error) return NextResponse.json({ ok: true, zonderPositie: false })
      if (!/sales_herorden|function|schema cache|PGRST202|positie/i.test(error.message)) throw new Error(error.message)
    }
    let zonderPositie = false
    const zet = async (id: string, i: number) => {
      if (zonderPositie) {
        await admin.from('sales_leads').update({ stage_key: stage }).eq('id', id)
        return
      }
      const { error } = await admin.from('sales_leads')
        .update({ positie: i, stage_key: stage }).eq('id', id)
      if (error) {
        // Vóór de migratie bestaat `positie` nog niet: dan enkel de fase
        // rechtzetten en het bord laten weten dat de volgorde niet bewaard is.
        if (/positie|schema cache|PGRST204/i.test(error.message)) {
          zonderPositie = true
          await admin.from('sales_leads').update({ stage_key: stage }).eq('id', id)
          return
        }
        throw new Error(error.message)
      }
    }
    // In kleine groepen parallel: een kolom van honderden kaarten mag niet
    // honderden opeenvolgende rondreizen kosten.
    const GROEP = 25
    for (let s = 0; s < ids.length; s += GROEP) {
      await Promise.all(ids.slice(s, s + GROEP).map((id, j) => zet(id, s + j)))
    }
    return NextResponse.json({ ok: true, zonderPositie })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
