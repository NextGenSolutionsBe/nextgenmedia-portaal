import 'server-only'
import { verwijderPlan, VERWIJZINGEN, type KaartKort, type OfferteKort } from './opdrachten-verwijderen'
import { voegNotitieToe, type Auteur } from './opdrachten-notities'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export type VerwijderUit = { ok: true; naar: { id: string; titel: string } | null } | { ok: false; reden: string; status: number }

/**
 * Een projectkaart verwijderen zonder dat iets anders verloren gaat (zie opdrachten-verwijderen.ts).
 * De notities van de kaart gaan mee weg (dat staat in de bevestiging); al de rest blijft.
 */
export async function verwijderKaart(admin: Admin, id: string, auteur: Auteur | null): Promise<VerwijderUit> {
  const { data: k } = await admin.from('opdrachten').select('id, titel, client_id, contract_id, created_at').eq('id', id).maybeSingle()
  const kaart = k as KaartKort | null
  if (!kaart) return { ok: false, reden: 'Deze kaart bestaat niet meer.', status: 404 }

  const [{ data: andere }, { data: offs }] = await Promise.all([
    kaart.client_id
      ? admin.from('opdrachten').select('id, titel, client_id, contract_id, created_at').eq('client_id', kaart.client_id).neq('id', id).order('created_at', { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
    admin.from('offertes').select('id, titel, status').eq('opdracht_id', id),
  ])
  const lijst = (andere ?? []) as KaartKort[]
  const plan = verwijderPlan(kaart, lijst, (offs ?? []) as OfferteKort[])
  if (!plan.ok) return { ok: false, reden: plan.reden, status: 409 }

  const nu = new Date().toISOString()
  // Het contract eerst naar de andere kaart (een contract hangt aan hoogstens één kaart).
  if (plan.contractNaar && kaart.contract_id) {
    await admin.from('opdrachten').update({ contract_id: null, updated_at: nu }).eq('id', id)
    const { error } = await admin.from('opdrachten').update({ contract_id: kaart.contract_id, updated_at: nu }).eq('id', plan.contractNaar).is('contract_id', null)
    if (error) {
      await admin.from('opdrachten').update({ contract_id: kaart.contract_id }).eq('id', id)
      throw new Error(error.message)
    }
  }
  // Offertes en mail-opvolging verhuizen mee of worden losgekoppeld, de rest losgekoppeld; niets wordt verwijderd.
  for (const v of VERWIJZINGEN) {
    const { error } = await admin.from(v.tabel).update({ [v.kolom]: v.volgt ? plan.restNaar : null }).eq(v.kolom, id)
    if (error && !/does not exist|Could not find/i.test(String(error.message))) throw new Error(`${v.tabel}: ${error.message}`)
  }

  const { error } = await admin.from('opdrachten').delete().eq('id', id)
  if (error) throw new Error(error.message)

  const naar = plan.restNaar ? lijst.find((a) => a.id === plan.restNaar) ?? null : null
  if (naar) {
    await voegNotitieToe(admin, naar.id, `De kaart "${kaart.titel}" werd verwijderd${plan.contractNaar ? '; het contract en wat eraan hing staan nu op deze kaart' : '; de offerte en de mails ervan staan nu op deze kaart'}.`, 'systeem', auteur).catch(() => null)
  }
  return { ok: true, naar: naar ? { id: naar.id, titel: naar.titel } : null }
}
