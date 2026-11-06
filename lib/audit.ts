import { createAdminSupabaseClient } from '@/lib/supabase/server'

/**
 * Append-only audit logging for sensitive actions (GDPR / security).
 *
 * Design rules:
 *  - This must NEVER throw and NEVER block the real operation. Every failure is
 *    swallowed, so a missing table (pre-migration) or transient DB error can't
 *    break customer/contract/settlement flows.
 *  - Writes go through the service-role client, which bypasses RLS. The audit_log
 *    table has no insert policy, so it can't be tampered with from a normal
 *    session — only this server-side helper can append.
 *  - NEVER put passwords, tokens or other secrets in `metadata`.
 */

export type AuditInput = {
  action: string                       // e.g. 'client.credentials.update'
  entityType?: string | null           // e.g. 'client' | 'partner' | 'settlement'
  entityId?: string | null
  summary?: string | null              // short human-readable description
  actorUserId?: string | null
  actorEmail?: string | null
  actorRole?: string | null
  metadata?: Record<string, unknown>
  ip?: string | null
  userAgent?: string | null
}

/** Extract caller IP + user-agent from a Request/NextRequest (best effort). */
export function requestMeta(req: { headers: Headers }): { ip: string | null; userAgent: string | null } {
  const h = req.headers
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null
  const userAgent = h.get('user-agent') || null
  return { ip, userAgent }
}

export async function logAudit(input: AuditInput): Promise<void> {
  try {
    const admin = createAdminSupabaseClient()
    await admin.from('audit_log').insert({
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      summary: input.summary ?? null,
      actor_user_id: input.actorUserId ?? null,
      actor_email: input.actorEmail ?? null,
      actor_role: input.actorRole ?? null,
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
    })
  } catch {
    // Intentionally swallow — auditing must never break the actual operation.
  }
}
