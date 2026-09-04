import 'server-only'

// Audit-log voor contracten (best-effort; breekt nooit de hoofdflow).
// Schrijft naar contract_events (bestaande tabel, uitgebreid met actor/ip/ua/meta).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type ContractEvent =
  | 'uploaded' | 'ai_analyzed' | 'fields_edited' | 'sent' | 'opened'
  | 'filled' | 'signed' | 'pdf_generated' | 'downloaded'
  | 'downloaded_original' | 'downloaded_signed'
  | 'template_created' | 'created_from_template' | 'token_regenerated' | 'expired'

export async function logContractEvent(
  admin: Admin,
  contractId: string | null,
  eventType: ContractEvent,
  opts?: { actor?: string | null; ip?: string | null; ua?: string | null; meta?: Record<string, unknown> | null },
): Promise<void> {
  const row: Record<string, unknown> = {
    contract_id: contractId,
    event_type: eventType,
    actor: opts?.actor ?? null,
    ip_address: opts?.ip ?? null,
    user_agent: opts?.ua ?? null,
    meta: opts?.meta ?? null,
  }
  // Veerkrachtig: laat ontbrekende (niet-gemigreerde) kolommen vallen en probeer opnieuw.
  for (let i = 0; i < 6; i++) {
    const { error } = await admin.from('contract_events').insert(row)
    if (!error) return
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in row) { delete row[col]; continue }
    return // andere fout → stil negeren (audit mag nooit breken)
  }
}
