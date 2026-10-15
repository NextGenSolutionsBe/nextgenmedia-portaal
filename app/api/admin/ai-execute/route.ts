import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findTool } from '@/lib/ai-tools'
import { logAudit, requestMeta } from '@/lib/audit'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export const maxDuration = 60

// Voert een door de admin BEVESTIGDE reeks AI-tool-calls uit. Elke tool roept de
// bestaande admin-API aan (cookie wordt doorgegeven → admin-check + validatie +
// permissies blijven gelden). Destructieve tools vereisen confirmation === 'VERWIJDEREN'.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin') return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { steps, confirmation } = await req.json() as { steps: { tool: string; params: Record<string, unknown> }[]; confirmation?: string }
    if (!Array.isArray(steps) || steps.length === 0) return NextResponse.json({ error: 'Geen stappen' }, { status: 400 })

    const origin = req.nextUrl.origin
    const cookie = req.headers.get('cookie') ?? ''
    const meta = requestMeta(req)
    const results: { tool: string; ok: boolean; label: string; detail?: string }[] = []

    for (const step of steps) {
      const tool = findTool(step.tool)
      if (!tool) { results.push({ tool: step.tool, ok: false, label: step.tool, detail: 'Onbekende tool' }); continue }

      // Destructieve tool → expliciete typebevestiging vereist.
      if (tool.destructive && confirmation !== 'VERWIJDEREN') {
        results.push({ tool: tool.name, ok: false, label: tool.label, detail: 'Bevestiging vereist (typ VERWIJDEREN)' })
        continue
      }

      // Verplichte params controleren.
      const missing = Object.entries(tool.params).filter(([k, v]) => v.required && (step.params[k] == null || step.params[k] === '')).map(([k]) => k)
      if (missing.length) { results.push({ tool: tool.name, ok: false, label: tool.label, detail: `Ontbrekend: ${missing.join(', ')}` }); continue }

      try {
        const path = tool.path(step.params)
        const headers: Record<string, string> = { cookie }
        let bodyInit: BodyInit
        if (tool.encoding === 'form') {
          const fd = new FormData()
          for (const [k, v] of Object.entries(tool.body(step.params))) fd.append(k, v == null ? '' : String(v))
          bodyInit = fd
        } else {
          headers['content-type'] = 'application/json'
          bodyInit = JSON.stringify(tool.body(step.params))
        }
        const res = await fetch(`${origin}${path}`, { method: tool.method, headers, body: bodyInit })
        const json = await res.json().catch(() => ({}))
        const ok = res.ok
        results.push({ tool: tool.name, ok, label: tool.label, detail: ok ? undefined : (json?.error || `HTTP ${res.status}`) })
        await logAudit({
          action: `ai.${tool.name}`, entityType: 'ai_action', entityId: (json?.id ?? null) as string | null,
          summary: `NextGen AI: ${tool.summary(step.params)}${ok ? '' : ' — MISLUKT'}`,
          actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin',
          metadata: { tool: tool.name, ok, by: 'nextgen-ai' }, ip: meta.ip, userAgent: meta.userAgent,
        })
      } catch (e) {
        results.push({ tool: tool.name, ok: false, label: tool.label, detail: e instanceof Error ? e.message : 'Fout' })
      }
    }

    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
