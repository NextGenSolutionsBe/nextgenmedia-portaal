import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { akkoordVan, laadVestingData } from '@/lib/vesting-data-server'
import { beschrijfAkkoord, isOnderwerp, type Onderwerp } from '@/lib/vesting-akkoord'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TABEL: Record<Onderwerp, string> = { contract: 'vesting_contracten', wam: 'vesting_wam', inkomst: 'vesting_registraties', kost: 'vesting_registraties' }

/**
 * Een kaart uit de vesting halen (contract, WAM-contract, inkomst of kost).
 *
 * De regel: nog nooit door alle drie getekend = gewoon verwijderen, ze
 * verdwijnt helemaal. Tekenden Marco, Bram en Chiara ze al eens alle drie,
 * dan verdwijnt ze niet maar wordt ze geschrapt: ze telt niet meer mee, blijft
 * zichtbaar en iedereen tekent opnieuw (voor het schrappen). Terugzetten kan.
 *
 * POST { onderwerp, id, actie: 'verwijderen' | 'terugzetten' }
 *   → { uitkomst: 'verwijderd' | 'geschrapt' | 'teruggezet' }
 * Enkel admins. Handtekeningen blijven altijd bewaard (het register).
 */
export async function POST(req: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { onderwerp?: unknown; id?: unknown; actie?: unknown }
    const onderwerp = isOnderwerp(b.onderwerp) ? b.onderwerp : null
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
    const actie = b.actie === 'verwijderen' || b.actie === 'terugzetten' ? b.actie : null
    if (!onderwerp || !id || !actie) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const data = await laadVestingData(admin)
    const info = akkoordVan(data, onderwerp, id)
    if (!info) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
    const tabel = TABEL[onderwerp]
    const nu = new Date().toISOString()
    let uitkomst: 'verwijderd' | 'geschrapt' | 'teruggezet'

    if (actie === 'terugzetten') {
      const { error } = await admin.from(tabel).update({ geschrapt_op: null, geschrapt_door: null }).eq('id', id)
      if (error) throw new Error(error.message)
      uitkomst = 'teruggezet'
    } else if (info.stand.laatsteVolledig) {
      // Alle drie tekenden ooit: schrappen, en dat tekent iedereen opnieuw.
      const { error } = await admin.from(tabel).update({ geschrapt_op: nu, geschrapt_door: actor.email ?? null }).eq('id', id)
      if (error) throw new Error(error.message)
      uitkomst = 'geschrapt'
    } else {
      // Nog nooit door alle drie getekend: helemaal weg. Bestanden best-effort mee uit de opslag.
      const bestanden: string[] = []
      if (onderwerp === 'contract') {
        const { data: kosten } = await admin.from('vesting_kosten').select('bewijs_pad').eq('vesting_contract_id', id)
        for (const k of (kosten ?? []) as { bewijs_pad: string | null }[]) if (k.bewijs_pad) bestanden.push(k.bewijs_pad)
        const { error: e1 } = await admin.from('vesting_kosten').delete().eq('vesting_contract_id', id)
        if (e1) throw new Error(e1.message)
        const { error: e2 } = await admin.from('vesting_contract_termijnen').delete().eq('contract_id', id)
        if (e2) throw new Error(e2.message)
      }
      if (onderwerp === 'inkomst' || onderwerp === 'kost') {
        const { data: r } = await admin.from('vesting_registraties').select('bewijs_pad').eq('id', id).maybeSingle()
        const pad = (r as { bewijs_pad?: string | null } | null)?.bewijs_pad
        if (pad) bestanden.push(pad)
      }
      // WAM: de termijnen gaan mee (cascade). Een termijn met een factuur houdt het tegen.
      if (onderwerp === 'wam') {
        const { count } = await admin.from('vesting_wam_termijnen').select('id', { count: 'exact', head: true }).eq('wam_id', id).not('invoice_id', 'is', null)
        if ((count ?? 0) > 0) return NextResponse.json({ error: 'Aan dit WAM-contract hangen facturen. Zet het op stopgezet in plaats van het te verwijderen.' }, { status: 409 })
      }
      const { error } = await admin.from(tabel).delete().eq('id', id)
      if (error) throw new Error(error.message)
      if (bestanden.length) await admin.storage.from('vesting').remove(bestanden).catch(() => null)
      uitkomst = 'verwijderd'
    }

    const meta = requestMeta(req)
    await logAudit({
      action: `vesting.${onderwerp}.${uitkomst}`, entityType: tabel, entityId: id,
      summary: `Vesting: ${uitkomst} · ${beschrijfAkkoord(info.inhoud)}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
      metadata: { onderwerp, inhoud: info.inhoud },
    })
    revalidatePath('/admin/vesting')
    return NextResponse.json({ ok: true, uitkomst })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Verwijderen mislukt') }, { status: 500 })
  }
}
