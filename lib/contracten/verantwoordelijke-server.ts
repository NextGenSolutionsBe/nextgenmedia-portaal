import 'server-only'
import { kaartVoorContract } from '@/lib/opdrachten-contracten'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { taakVoorWie } from '@/lib/opdrachten-offerte-model'
import { leadTaakOpties, opdrachtTaakVerantwoordelijke } from '@/lib/sales/lead-taken-server'
import { tegentekenSleutel } from '@/lib/contracten/tegenhandtekening-server'
import { contractVerantwoordelijke, type ContractVerantwoordelijke } from './verantwoordelijke'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export class VerantwoordelijkeFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

/** De kaart van een contract met haar verantwoordelijke (of null: testklant, sjabloon). */
export async function kaartVanContract(admin: Admin, contractId: string): Promise<{ id: string; verantwoordelijke: ContractVerantwoordelijke | null } | null> {
  const { data } = await admin.from('opdrachten').select('id, verantwoordelijke').eq('contract_id', contractId).maybeSingle()
  const k = data as { id: string; verantwoordelijke: string | null } | null
  return k ? { id: k.id, verantwoordelijke: contractVerantwoordelijke(k.verantwoordelijke) } : null
}

/**
 * De verantwoordelijke van een contract zetten = die van zijn projectkaart (de
 * kaart komt er als ze nog ontbreekt). Een open taak "contract tegentekenen" in
 * ClickUp gaat mee naar de nieuwe verantwoordelijke.
 */
export async function zetContractVerantwoordelijke(admin: Admin, contractId: string, waarde: unknown, door: string | null): Promise<{ verantwoordelijke: ContractVerantwoordelijke; kaartId: string }> {
  const v = contractVerantwoordelijke(waarde)
  if (!v) throw new VerantwoordelijkeFout('Kies Marco, Bram of Gezamenlijke lead.')
  let kaart = await kaartVanContract(admin, contractId)
  if (!kaart) {
    await kaartVoorContract(admin, contractId)
    kaart = await kaartVanContract(admin, contractId)
  }
  if (!kaart) throw new VerantwoordelijkeFout('Dit contract hangt niet aan een project (bv. de testklant), dus er is geen verantwoordelijke.', 409)
  if (kaart.verantwoordelijke !== v) {
    const { error } = await admin.from('opdrachten').update({ verantwoordelijke: v, updated_at: new Date().toISOString() }).eq('id', kaart.id)
    if (error) throw new Error(error.message)
    await voegNotitieToe(admin, kaart.id, `Verantwoordelijke van het contract: ${v}${door ? ` (gezet door ${door})` : ''}.`, 'systeem', null).catch(() => null)
    await verzetTegentekenTaak(admin, contractId, kaart.id, v).catch((e) => console.warn('[contract] tegenteken-taak verzetten:', e instanceof Error ? e.message : e))
  }
  return { verantwoordelijke: v, kaartId: kaart.id }
}

/** Een open tegenteken-taak in ClickUp naar de (nieuwe) verantwoordelijke. */
async function verzetTegentekenTaak(admin: Admin, contractId: string, kaartId: string, v: ContractVerantwoordelijke): Promise<void> {
  const { data } = await admin.from('opdracht_taken').select('id, clickup_assignee_id').eq('aanvraag_sleutel', tegentekenSleutel(contractId)).is('afgerond_op', null)
  const taken = (data ?? []) as { id: string; clickup_assignee_id: number | null }[]
  if (!taken.length) return
  const opties = await leadTaakOpties(admin, null, taakVoorWie(v, null))
  if (!opties.ingesteld || !opties.standaard) return
  for (const t of taken) {
    if (t.clickup_assignee_id === opties.standaard) continue
    await opdrachtTaakVerantwoordelijke(admin, kaartId, t.id, opties.standaard)
  }
}

/** Voorstel bij een nieuw contract: de verantwoordelijke van de kaart, anders "klant van" bij de klant. */
export async function voorstelVerantwoordelijke(admin: Admin, o: { opdrachtId?: string | null; clientId?: string | null }): Promise<ContractVerantwoordelijke | null> {
  if (o.opdrachtId) {
    const { data } = await admin.from('opdrachten').select('verantwoordelijke').eq('id', o.opdrachtId).maybeSingle()
    const v = contractVerantwoordelijke((data as { verantwoordelijke?: string | null } | null)?.verantwoordelijke)
    if (v) return v
  }
  if (o.clientId) {
    const { data } = await admin.from('clients').select('sales_verantwoordelijke').eq('id', o.clientId).maybeSingle()
    const v = contractVerantwoordelijke((data as { sales_verantwoordelijke?: string | null } | null)?.sales_verantwoordelijke)
    if (v) return v
  }
  return null
}
