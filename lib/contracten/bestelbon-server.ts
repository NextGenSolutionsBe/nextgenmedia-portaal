import 'server-only'
import { revalidatePath } from 'next/cache'
import { logContractEvent } from '@/lib/contract-audit'
import { logAudit } from '@/lib/audit'
import { normaliseerBestelbon } from '@/lib/contracten/manueel-getekend'
import { bruikbaarNummer, kanBestelbonLezen, leesBestelbonnummer } from '@/lib/contracten/bestelbon-ai'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: any }

/**
 * Een bijlage bij een contract zonder bestelbonnummer: is het een bestelbon,
 * dan lezen we het nummer eruit en zetten het op het contract en op elke factuur
 * van dat contract die nog niet verstuurd is (zonder nummer). Een nummer dat het
 * team al invulde, raken we nooit aan. Voor waitUntil: gooit nooit.
 */
export async function bestelbonUitBijlage(admin: Admin, contractId: string, bijlage: { id: string; pad: string; naam: string; mime: string | null }): Promise<string | null> {
  try {
    if (!kanBestelbonLezen(bijlage.mime) || !process.env.ANTHROPIC_API_KEY) return null
    const { data: c } = await admin.from('contracts').select('id, title, bestelbon_nummer').eq('id', contractId).maybeSingle()
    if (!c || (c as { bestelbon_nummer?: string | null }).bestelbon_nummer) return null
    const { data: blob, error } = await admin.storage.from('contracts').download(bijlage.pad)
    if (error || !blob) throw new Error(error?.message ?? 'Bijlage niet gevonden')
    const lezing = await leesBestelbonnummer(Buffer.from(await blob.arrayBuffer()).toString('base64'), String(bijlage.mime))
    const nummer = normaliseerBestelbon(bruikbaarNummer(lezing))
    if (!nummer) return null
    // Enkel als er intussen nog altijd geen nummer staat.
    const { data: gezet, error: e2 } = await admin.from('contracts').update({ bestelbon_nummer: nummer }).eq('id', contractId).is('bestelbon_nummer', null).select('id')
    if (e2 || !(gezet ?? []).length) return null
    const { data: open } = await admin.from('invoices').select('id').eq('contract_id', contractId).eq('status', 'te_versturen').is('klant_referentie', null)
    const ids = ((open ?? []) as { id: string }[]).map((f) => f.id)
    if (ids.length) await admin.from('invoices').update({ klant_referentie: nummer }).in('id', ids)
    await logContractEvent(admin, contractId, 'bestelbon_gelezen', { actor: 'systeem', meta: { nummer, bijlage: bijlage.naam, facturen: ids.length } })
    await logAudit({
      action: 'contract.bestelbon', entityType: 'contract', entityId: contractId,
      summary: `Bestelbonnummer ${nummer} gelezen uit "${bijlage.naam}"${ids.length ? ` en op ${ids.length} factuur${ids.length === 1 ? '' : 'en'} gezet` : ''}`,
      actorUserId: null, actorEmail: null, actorRole: 'system', metadata: { nummer, bijlage: bijlage.id, facturen: ids },
    }).catch(() => {})
    try { revalidatePath(`/admin/contracts/${contractId}`); revalidatePath('/admin/invoices') } catch { /* buiten een request */ }
    return nummer
  } catch (e) {
    console.warn('[bestelbon lezen]', contractId, e instanceof Error ? e.message : e)
    return null
  }
}
