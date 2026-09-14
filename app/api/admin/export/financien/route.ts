import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { loadCore, readPeriodParams } from '@/lib/finance-data'
import { financienWerkmap } from '@/lib/excel/rapporten/financien'
import { schrijfWerkmap } from '@/lib/excel/xlsx-schrijf'
import { xlsxAntwoord } from '@/lib/excel/antwoord'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Excel-export van Financiën. Zelfde parameters als de pagina's (fy, period,
 * q, mo), zelfde loadCore — dus dezelfde cijfers als op het scherm.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
    const { year, period, quarter, month } = readPeriodParams(sp)
    const core = await loadCore(year)
    const uit = schrijfWerkmap(financienWerkmap({ core, year, period, quarter, month }))

    const meta = requestMeta(req)
    await logAudit({
      action: 'export.xlsx', entityType: 'export', entityId: null,
      summary: `Excel-export: ${uit.bestandsnaam} (Financiën ${year})`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return xlsxAntwoord(uit.buffer, uit.bestandsnaam, uit.mime)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
