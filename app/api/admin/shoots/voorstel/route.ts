import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { vandaagBrussel } from '@/lib/content/deadline-model'
import { datumLang, normaliseerPlan } from '@/lib/shoots/model'
import { isUuid, leesBriefing, ShootFout, teamLijst } from '@/lib/shoots/server'
import { planUitBriefing } from '@/lib/shoots/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

/**
 * POST { tekst, briefing_pad?, client_id?, plan? } — een voorstel van shootplan
 * uit de briefing. Er wordt niets bewaard: het scherm vult de velden in en
 * een mens kijkt na en bewaart.
 */
export async function POST(req: NextRequest) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const tekst = String(b.tekst ?? '').slice(0, 30000)
    const bestand = typeof b.briefing_pad === 'string' && b.briefing_pad ? await leesBriefing(admin, b.briefing_pad) : null
    let klant: string | null = null
    if (isUuid(b.client_id)) {
      const { data } = await admin.from('clients').select('company_name').eq('id', b.client_id).maybeSingle()
      klant = data?.company_name ?? null
    }
    const team = (await teamLijst(admin).catch(() => [])).map((t) => `${t.naam}${t.rol ? ` (${t.rol})` : ''}`)
    const v = await planUitBriefing({ tekst, bestand, klant, basis: normaliseerPlan(b.plan ?? {}), vandaag: datumLang(vandaagBrussel()), team })
    return NextResponse.json({ ok: true, ...v })
  } catch (e) {
    return e instanceof ShootFout ? NextResponse.json({ error: e.message }, { status: e.status })
      : NextResponse.json({ error: e instanceof Error && /AI|briefing|document/i.test(e.message) ? e.message : safeMessage(e, 'shoots.voorstel') }, { status: 400 })
  }
}
