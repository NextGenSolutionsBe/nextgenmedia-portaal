import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { ARCHIEF_BUCKET, ARCHIEF_SLEUTEL } from '@/lib/sales/pipeline-archief'

export const dynamic = 'force-dynamic'

/**
 * GET — het Excel-archief van de oude verkooppipeline downloaden (enkel admin).
 * Stuurt door naar een ondertekende link van 2 minuten; het bestand zelf staat
 * in de privébucket `archief`.
 *  ?info=1 → enkel of er een archief is (datum en aantallen), zonder link.
 */
export async function GET(req: Request) {
  try {
    const ik = await requireAdmin()
    if (!ik) return NextResponse.json({ error: 'Enkel voor admins' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('app_settings').select('value').eq('key', ARCHIEF_SLEUTEL).maybeSingle()
    const info = (data?.value ?? null) as { pad?: string; op?: string; leads?: number } | null
    if (new URL(req.url).searchParams.get('info') === '1') return NextResponse.json({ archief: info ? { op: info.op ?? null, leads: info.leads ?? null } : null })
    if (!info?.pad) return NextResponse.json({ error: 'Er is nog geen archief van de pipeline.' }, { status: 404 })
    const { data: url, error } = await admin.storage.from(ARCHIEF_BUCKET).createSignedUrl(info.pad, 120, { download: 'oude-pipeline-archief.xlsx' })
    if (error || !url?.signedUrl) throw new Error(error?.message ?? 'Link maken mislukt')
    await logAudit({ action: 'pipeline_archief.download', entityType: 'app_settings', entityId: ARCHIEF_SLEUTEL, actorUserId: ik.id, actorEmail: ik.email ?? null, summary: 'Archief oude pipeline gedownload' })
    return NextResponse.redirect(url.signedUrl)
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'pipeline-archief') }, { status: 500 })
  }
}
