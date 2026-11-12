import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { eisBeheer } from '@/lib/instellingen/api'
import { listClickupMembers } from '@/lib/clickup'
import { EXPERTISES } from '@/lib/aanvragen/model'
import { TEAM_KLANTAPP_SLEUTEL, teamKlantappUit } from '@/lib/aanvragen/model'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FOTOS = 'personeel'

/**
 * Instellingen — Team in de klantapp. Wie staat bij "Kies jouw expert"
 * (aanvragen) en bij "Met wie?" (meeting boeken), met welke agenda en welke
 * ClickUp-gebruiker. Alles staat in Personeel; dit scherm zet het per plek op orde.
 *   GET   → teamleden met foto, agenda's, ClickUp-leden en de instelling voor diensten
 *   PATCH → { lid, veld: waarde } of { instelling: { diensten_iedereen } }
 */
export async function GET() {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const admin = createAdminSupabaseClient()
    const [{ data: leden }, { data: agendas }, { data: inst }, clickup] = await Promise.all([
      admin.from('personeel').select('id, voornaam, achternaam, functie, expert_rollen, expertises, profielfoto_pad, actief, expert_zichtbaar, meeting_zichtbaar, meeting_agenda_id, clickup_user_id, klantapp_volgorde').eq('actief', true),
      admin.from('sales_calendar_connections').select('id, name, status, active, provider').eq('active', true).order('name'),
      admin.from('app_settings').select('value').eq('key', TEAM_KLANTAPP_SLEUTEL).maybeSingle(),
      listClickupMembers().catch(() => []),
    ])
    const rijen = (leden ?? []) as { id: string; voornaam: string; achternaam: string | null; functie: string | null; expert_rollen: string[] | null; expertises: string[] | null; profielfoto_pad: string | null; actief: boolean; expert_zichtbaar: boolean | null; meeting_zichtbaar: boolean | null; meeting_agenda_id: string | null; clickup_user_id: number | null; klantapp_volgorde: number | null }[]
    const paden = rijen.map((r) => r.profielfoto_pad).filter((x): x is string => !!x)
    const urls = new Map<string, string>()
    if (paden.length) {
      const { data: s } = await admin.storage.from(FOTOS).createSignedUrls(paden, 3600)
      for (const r of (s ?? []) as { path: string | null; signedUrl: string | null }[]) if (r.path && r.signedUrl) urls.set(r.path, r.signedUrl)
    }
    const label = new Map(EXPERTISES.map((e) => [e.key, e.label]))
    return NextResponse.json({
      leden: rijen
        .sort((a, b) => (a.klantapp_volgorde ?? 99) - (b.klantapp_volgorde ?? 99) || a.voornaam.localeCompare(b.voornaam, 'nl'))
        .map((r) => ({
          id: r.id, naam: [r.voornaam, r.achternaam].filter(Boolean).join(' '), rol: (r.expert_rollen ?? [])[0] ?? r.functie ?? null,
          expertises: (r.expertises ?? []).map((e) => label.get(e as never) ?? e), foto_url: r.profielfoto_pad ? urls.get(r.profielfoto_pad) ?? null : null,
          expert_zichtbaar: r.expert_zichtbaar === true, meeting_zichtbaar: r.meeting_zichtbaar === true, meeting_agenda_id: r.meeting_agenda_id,
          clickup_user_id: r.clickup_user_id ? Number(r.clickup_user_id) : null, klantapp_volgorde: r.klantapp_volgorde,
        })),
      agendas: ((agendas ?? []) as { id: string; name: string; status: string; provider: string }[]).filter((a) => a.provider === 'google').map((a) => ({ id: a.id, naam: a.name, gekoppeld: a.status === 'connected' })),
      clickupLeden: (clickup as { id: number; username?: string | null; email?: string | null }[]).map((m) => ({ id: Number(m.id), naam: m.username || m.email || String(m.id) })).sort((a, b) => a.naam.localeCompare(b.naam)),
      instelling: teamKlantappUit(inst?.value ?? null),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) { return NextResponse.json({ error: safeMessage(err) }, { status: 400 }) }
}

export async function PATCH(req: NextRequest) {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const admin = createAdminSupabaseClient()
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    if (b.instelling && typeof b.instelling === 'object') {
      const waarde = { diensten_iedereen: (b.instelling as { diensten_iedereen?: unknown }).diensten_iedereen !== false }
      const { error } = await admin.from('app_settings').upsert({ key: TEAM_KLANTAPP_SLEUTEL, value: waarde, updated_at: new Date().toISOString(), updated_by_email: g.persoon.email }, { onConflict: 'key' })
      if (error) throw new Error(error.message)
      await logAudit({ action: 'instellingen.team_klantapp', entityType: 'app_settings', entityId: TEAM_KLANTAPP_SLEUTEL, actorUserId: g.persoon.userId, actorEmail: g.persoon.email, summary: waarde.diensten_iedereen ? 'Diensten: iedereen' : 'Diensten: enkel specialisten', ...requestMeta(req) }).catch(() => null)
      return NextResponse.json({ instelling: waarde })
    }
    const lid = String(b.lid ?? '')
    if (!UUID.test(lid)) return NextResponse.json({ error: 'Onbekend teamlid' }, { status: 400 })
    const patch: Record<string, unknown> = {}
    if (typeof b.expert_zichtbaar === 'boolean') patch.expert_zichtbaar = b.expert_zichtbaar
    if (typeof b.meeting_zichtbaar === 'boolean') patch.meeting_zichtbaar = b.meeting_zichtbaar
    if ('meeting_agenda_id' in b) {
      const a = b.meeting_agenda_id ? String(b.meeting_agenda_id) : null
      if (a) {
        if (!UUID.test(a)) return NextResponse.json({ error: 'Onbekende agenda' }, { status: 400 })
        const { data: k } = await admin.from('sales_calendar_connections').select('id, active, status').eq('id', a).maybeSingle()
        if (!k || k.active === false) return NextResponse.json({ error: 'Deze agenda bestaat niet (meer).' }, { status: 400 })
        if (k.status !== 'connected') return NextResponse.json({ error: 'De Google-koppeling van deze agenda is verlopen. Koppel ze eerst opnieuw.' }, { status: 400 })
      }
      patch.meeting_agenda_id = a
    }
    if ('clickup_user_id' in b) {
      const c = b.clickup_user_id === null || b.clickup_user_id === '' ? null : Number(b.clickup_user_id)
      if (c !== null && (!Number.isInteger(c) || c <= 0)) return NextResponse.json({ error: 'Onbekende ClickUp-gebruiker' }, { status: 400 })
      patch.clickup_user_id = c
    }
    if ('klantapp_volgorde' in b) {
      const v = b.klantapp_volgorde === null ? null : Number(b.klantapp_volgorde)
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > 999)) return NextResponse.json({ error: 'Ongeldige volgorde' }, { status: 400 })
      patch.klantapp_volgorde = v
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'Niets om te bewaren' }, { status: 400 })
    const { data, error } = await admin.from('personeel').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', lid).select('id, voornaam').maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Teamlid niet gevonden' }, { status: 404 })
    await logAudit({ action: 'instellingen.team_lid', entityType: 'personeel', entityId: lid, actorUserId: g.persoon.userId, actorEmail: g.persoon.email, summary: `${data.voornaam}: ${Object.keys(patch).join(', ')}`, ...requestMeta(req) }).catch(() => null)
    return NextResponse.json({ ok: true })
  } catch (err) { return NextResponse.json({ error: safeMessage(err) }, { status: 400 }) }
}
