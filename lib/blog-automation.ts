import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { buildSiteSignature, diffSignatures, type SiteSignature } from '@/lib/website-analyze'

// Systeemautomatisering rond de blogmodule: cron-state + wekelijkse website-monitor.

const CRON_KEY = 'blog_cron_last_run'

/** Markeert dat de blog-cron net gelopen heeft. */
export async function markCronRun(): Promise<void> {
  try { await createAdminSupabaseClient().from('app_state').upsert({ key: CRON_KEY, value: { at: new Date().toISOString() }, updated_at: new Date().toISOString() }) } catch { }
}

/** Laatste cron-run + of die "recent" was (binnen 2 dagen). */
export async function getCronState(): Promise<{ lastRun: string | null; ok: boolean }> {
  try {
    const { data } = await createAdminSupabaseClient().from('app_state').select('value, updated_at').eq('key', CRON_KEY).maybeSingle()
    const at = (data?.value as { at?: string } | null)?.at ?? data?.updated_at ?? null
    if (!at) return { lastRun: null, ok: false }
    const ok = Date.now() - new Date(at).getTime() < 2 * 86400000
    return { lastRun: at, ok }
  } catch {
    return { lastRun: null, ok: true } // bij twijfel geen vals alarm
  }
}

type MonitorState = { last_checked: string; signature: SiteSignature; changed: boolean; details: string[] }

/**
 * Controleert websites op wijzigingen (max. 1×/week per account). Heranalyseert
 * NIET automatisch — zet enkel een vlag zodat de admin "heranalyse aanbevolen" ziet.
 */
export async function runWebsiteMonitor(opts?: { force?: boolean }): Promise<{ checked: number; changed: number }> {
  const admin = createAdminSupabaseClient()
  const { data: accounts } = await admin.from('blog_accounts').select('id, website_url, website_monitor').eq('active', true).not('website_url', 'is', null)
  let checked = 0, changed = 0
  for (const a of (accounts ?? []) as { id: string; website_url: string | null; website_monitor: MonitorState | null }[]) {
    const prev = a.website_monitor
    if (!opts?.force && prev?.last_checked && Date.now() - new Date(prev.last_checked).getTime() < 7 * 86400000) continue
    const sig = await buildSiteSignature(a.website_url)
    if (!sig) continue
    checked++
    const details = diffSignatures(prev?.signature, sig)
    // "changed" blijft true tot de admin opnieuw analyseert (dan wordt monitor gereset).
    const isChanged = details.length > 0 || (prev?.changed ?? false)
    if (details.length > 0) changed++
    const state: MonitorState = { last_checked: new Date().toISOString(), signature: sig, changed: isChanged, details: details.length ? details : (prev?.details ?? []) }
    await admin.from('blog_accounts').update({ website_monitor: state }).eq('id', a.id)
  }
  return { checked, changed }
}
