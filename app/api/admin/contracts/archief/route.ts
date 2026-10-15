import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { archiveerContract, ARCHIEF_BUCKET } from '@/lib/contract-archief'
import { veiligeNaam, referentie } from '@/lib/contract-archief-model'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET — het contractarchief: per getekend contract de laatste archiefversie,
 * met tijdelijke downloadlinks (2 uur) zodat de browser alles als één ZIP kan
 * bundelen. Ook een lijst van getekende contracten die nog niet gearchiveerd
 * zijn (oudere contracten van vóór het archief).
 */
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const [{ data: rijen, error }, { data: getekend }] = await Promise.all([
      admin.from('contract_archief').select('contract_id, versie, titel, klant_naam, signer_name, signed_at, sha256_contract, pad_contract, pad_certificaat, pad_dossier, gearchiveerd_op').order('gearchiveerd_op', { ascending: false }).limit(2000),
      admin.from('contracts').select('id, title, signed_at').eq('status', 'signed'),
    ])
    if (error) throw new Error(error.message)
    type R = { contract_id: string; versie: number; titel: string | null; klant_naam: string | null; signer_name: string | null; signed_at: string | null; sha256_contract: string; pad_contract: string; pad_certificaat: string; pad_dossier: string; gearchiveerd_op: string }
    // Enkel de hoogste versie per contract.
    const laatste = new Map<string, R>()
    for (const r of (rijen ?? []) as R[]) if (!laatste.has(r.contract_id) || laatste.get(r.contract_id)!.versie < r.versie) laatste.set(r.contract_id, r)

    const paden = [...laatste.values()].flatMap((r) => [r.pad_contract, r.pad_certificaat, r.pad_dossier])
    const { data: urls } = paden.length ? await admin.storage.from(ARCHIEF_BUCKET).createSignedUrls(paden, 2 * 3600) : { data: [] }
    const urlVan = new Map(((urls ?? []) as { path: string | null; signedUrl: string }[]).map((u) => [u.path ?? '', u.signedUrl]))

    const items = [...laatste.values()].map((r) => {
      const map = `${veiligeNaam(r.klant_naam, 'zonder-klant')}/${veiligeNaam(r.titel)}-${referentie(r.contract_id).toLowerCase()}`
      return {
        contract_id: r.contract_id, versie: r.versie, titel: r.titel, klant_naam: r.klant_naam, signer_name: r.signer_name, signed_at: r.signed_at,
        sha256: r.sha256_contract, gearchiveerd_op: r.gearchiveerd_op,
        bestanden: [
          { pad: `${map}/contract-getekend.pdf`, url: urlVan.get(r.pad_contract) ?? null },
          { pad: `${map}/certificaat.pdf`, url: urlVan.get(r.pad_certificaat) ?? null },
          { pad: `${map}/dossier.json`, url: urlVan.get(r.pad_dossier) ?? null },
        ],
      }
    })
    const nogNiet = ((getekend ?? []) as { id: string; title: string | null; signed_at: string | null }[]).filter((c) => !laatste.has(c.id))
    return NextResponse.json({ items, nogNietGearchiveerd: nogNiet.map((c) => ({ id: c.id, titel: c.title, signed_at: c.signed_at })) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST { action: 'inhalen' } — alle getekende contracten die nog niet in het
 * archief staan, alsnog archiveren (zonder melding: dat zijn oude handtekeningen).
 * POST { action: 'archiveer', id } — één contract (opnieuw) archiveren.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { action?: string; id?: string }
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)

    if (b.action === 'archiveer' && b.id) {
      const r = await archiveerContract(admin, String(b.id), 'handmatig', actor.email ?? null)
      return NextResponse.json({ ok: true, versie: r.versie, bestaandAl: r.bestaandAl })
    }

    if (b.action === 'inhalen') {
      const [{ data: getekend }, { data: rijen }] = await Promise.all([
        admin.from('contracts').select('id, title').eq('status', 'signed').order('signed_at', { ascending: true }),
        admin.from('contract_archief').select('contract_id'),
      ])
      const al = new Set(((rijen ?? []) as { contract_id: string }[]).map((r) => r.contract_id))
      const todo = ((getekend ?? []) as { id: string; title: string | null }[]).filter((c) => !al.has(c.id))
      const gestart = Date.now()
      const uit: { id: string; titel: string | null; ok: boolean; fout?: string }[] = []
      for (const c of todo) {
        if (Date.now() - gestart > 45_000) break   // onder de 60 s van Vercel blijven; de rest bij een volgende klik
        try { await archiveerContract(admin, c.id, 'backfill', actor.email ?? null); uit.push({ id: c.id, titel: c.title, ok: true }) }
        catch (e) { uit.push({ id: c.id, titel: c.title, ok: false, fout: e instanceof Error ? e.message : String(e) }) }
      }
      await logAudit({
        action: 'contract.archief.inhalen', entityType: 'contract_archief', entityId: null,
        summary: `Contractarchief ingehaald: ${uit.filter((x) => x.ok).length} gearchiveerd, ${uit.filter((x) => !x.ok).length} mislukt, ${todo.length - uit.length} nog te doen`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
      })
      return NextResponse.json({ ok: true, verwerkt: uit, resterend: todo.length - uit.length })
    }
    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
