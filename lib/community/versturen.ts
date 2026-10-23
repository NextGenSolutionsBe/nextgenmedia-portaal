import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { beantwoordComment, beantwoordGesprek } from '@/lib/metricool-inbox'
import { logAudit } from '@/lib/audit'
import { verstuurBlokkade } from './model'

/**
 * Eén antwoord versturen via Metricool — gedeeld door de inbox in het beheer
 * en de MCP-tool community_versturen (die krijgt deze functie geïnjecteerd
 * vanuit /api/mcp; .mjs kan geen TS importeren).
 *
 * Altijd na bevestiging door een mens: `bevestigdDoor` is verplicht en komt in
 * verstuurd_door en het auditlog. Dubbel versturen kan niet: het bericht wordt
 * eerst voorwaardelijk op "verstuurd" gezet (enkel vanuit te_beantwoorden of
 * klant_gekozen); wie die update niet krijgt, verstuurt niets. Mislukt
 * Metricool, dan wordt het "fout" met de foutmelding.
 */

export type Actor = { userId: string | null; email: string | null; naam: string | null; rol?: string | null }
export type VerstuurInvoer = { berichtId: string; tekst: string; bevestigdDoor: string; actor: Actor; via: 'beheer' | 'mcp' }
export type VerstuurUitkomst = { ok: true; verstuurdOp: string } | { ok: false; fout: string; status: number }

export async function verstuurBericht(inv: VerstuurInvoer): Promise<VerstuurUitkomst> {
  const admin = createAdminSupabaseClient()
  const tekst = inv.tekst.trim()
  const { data: b } = await admin.from('community_berichten')
    .select('id, client_id, kanaal_id, bron, netwerk, extern_id, parent_extern_id, status, antwoord_mogelijk_tot, raw')
    .eq('id', inv.berichtId).maybeSingle()
  if (!b) return { ok: false, fout: 'Bericht niet gevonden.', status: 404 }

  const [{ data: inst }, { data: kanaal }] = await Promise.all([
    admin.from('community_instellingen').select('actief').eq('client_id', b.client_id).maybeSingle(),
    admin.from('community_kanalen').select('metricool_blog_id, actief').eq('id', b.kanaal_id).maybeSingle(),
  ])
  if (!inst?.actief) return { ok: false, fout: 'Community management staat uit voor deze klant.', status: 409 }
  if (!kanaal?.actief) return { ok: false, fout: 'Dit kanaal staat uit.', status: 409 }
  const blokkade = verstuurBlokkade(b, tekst, inv.bevestigdDoor)
  if (blokkade) return { ok: false, fout: blokkade, status: 409 }

  // Doel in Metricool. Comment: de bovenste comment van de thread (zie lib/metricool-inbox.ts).
  const raw = (b.raw ?? {}) as { from?: unknown }
  const recipient = b.bron === 'dm' ? (raw.from != null ? String(raw.from) : '') : ''
  if (b.bron === 'dm' && (!b.parent_extern_id || !recipient)) return { ok: false, fout: 'Gesprek of ontvanger onbekend; antwoord in Metricool zelf.', status: 409 }

  const nu = new Date().toISOString()
  const verstuurdDoor = inv.bevestigdDoor.trim().slice(0, 200)
  const { data: geclaimd } = await admin.from('community_berichten')
    .update({ status: 'verstuurd', gekozen_tekst: tekst, verstuurd_op: nu, verstuurd_door: verstuurdDoor, verstuur_fout: null, bijgewerkt_op: nu })
    .eq('id', b.id).in('status', ['te_beantwoorden', 'klant_gekozen']).select('id')
  if (!geclaimd?.length) return { ok: false, fout: 'Dit bericht werd intussen al verstuurd of gewijzigd.', status: 409 }

  try {
    if (b.bron === 'comment') {
      await beantwoordComment({ blogId: kanaal.metricool_blog_id, netwerk: b.netwerk ?? '', objectId: b.parent_extern_id ?? b.extern_id, tekst })
    } else {
      await beantwoordGesprek({ blogId: kanaal.metricool_blog_id, netwerk: b.netwerk ?? '', conversationId: b.parent_extern_id!, recipient, tekst })
    }
  } catch (e) {
    const fout = (e instanceof Error ? e.message : 'Versturen mislukt').slice(0, 1000)
    await admin.from('community_berichten').update({ status: 'fout', verstuur_fout: fout, verstuurd_op: null, verstuurd_door: null, bijgewerkt_op: new Date().toISOString() }).eq('id', b.id)
    await logAudit({ action: 'community.versturen.fout', entityType: 'community_bericht', entityId: b.id, summary: fout.slice(0, 200), actorUserId: inv.actor.userId, actorEmail: inv.actor.email, actorRole: inv.actor.rol ?? null, metadata: { via: inv.via, bevestigd_door: verstuurdDoor, client_id: b.client_id, actor_naam: inv.actor.naam } })
    return { ok: false, fout, status: 502 }
  }

  await logAudit({
    action: 'community.versturen', entityType: 'community_bericht', entityId: b.id,
    summary: `Antwoord verstuurd (${b.netwerk} ${b.bron}), bevestigd door ${verstuurdDoor}`,
    actorUserId: inv.actor.userId, actorEmail: inv.actor.email, actorRole: inv.actor.rol ?? null,
    metadata: { via: inv.via, bevestigd_door: verstuurdDoor, client_id: b.client_id, tekst, actor_naam: inv.actor.naam },
  })
  return { ok: true, verstuurdOp: nu }
}
