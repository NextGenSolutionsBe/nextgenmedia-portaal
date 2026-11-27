import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { projectVerantwoordelijke } from '@/lib/opdrachten-kanban'

/**
 * Doorgeven aan het andere bedrijf (verbeterplan fase 6, punt 75): een klant van
 * NextGenMedia die iets voor NextGenSolutions nodig heeft (of omgekeerd) komt
 * met één klik in de juiste pipeline. Naar Solutions = een deal in Afspraak,
 * gekoppeld aan de klant. Naar Media = een kaart in Opvolging op Projecten.
 * Niets wordt verplaatst of verwijderd; er komt een notitie bij beide kanten.
 */
type Admin = ReturnType<typeof createAdminSupabaseClient>
const UUID = /^[0-9a-f-]{36}$/i

export class DoorgevenFout extends Error {}

export async function doorgeven(admin: Admin, b: Record<string, unknown>, door: { naam: string | null; email: string | null }): Promise<{ naar: 'nextgenmedia' | 'nextgensolutions'; id: string }> {
  const naar = b.naar === 'nextgensolutions' || b.naar === 'nextgenmedia' ? b.naar : null
  if (!naar) throw new DoorgevenFout('Naar welk bedrijf?')
  const clientId = typeof b.client_id === 'string' && UUID.test(b.client_id) ? b.client_id : null
  const opdrachtId = typeof b.opdracht_id === 'string' && UUID.test(b.opdracht_id) ? b.opdracht_id : null
  const wat = String(b.wat ?? '').trim().slice(0, 1000)
  if (wat.length < 3) throw new DoorgevenFout('Schrijf kort wat de klant nodig heeft.')
  type KlantRij = { id: string; company_name: string; contact_name: string | null; email: string | null; telefoon: string | null }
  let klant: KlantRij | null = null
  if (clientId) {
    const { data } = await admin.from('clients').select('id, company_name, contact_name, email, telefoon').eq('id', clientId).maybeSingle()
    klant = data as KlantRij | null
  }
  let kaartNaam: string | null = null
  if (opdrachtId) {
    const { data } = await admin.from('opdrachten').select('id, klant_vrij, client_id').eq('id', opdrachtId).maybeSingle()
    if (!data) throw new DoorgevenFout('Deze kaart bestaat niet meer.')
    kaartNaam = (data as { klant_vrij: string | null }).klant_vrij
    if (!klant && (data as { client_id: string | null }).client_id) {
      const { data: k } = await admin.from('clients').select('id, company_name, contact_name, email, telefoon').eq('id', (data as { client_id: string }).client_id).maybeSingle()
      klant = k as KlantRij | null
    }
  }
  const naam = klant?.company_name ?? kaartNaam
  if (!naam) throw new DoorgevenFout('Welke klant?')
  const wie = door.naam ?? door.email ?? 'iemand'
  const verantwoordelijke = projectVerantwoordelijke(typeof b.verantwoordelijke === 'string' ? b.verantwoordelijke : null)

  if (naar === 'nextgensolutions') {
    const { data, error } = await admin.from('ngs_deals').insert({
      bedrijf: naam.slice(0, 160), contactpersoon: klant?.contact_name ?? null, email: klant?.email ?? null, telefoon: klant?.telefoon ?? null,
      titel: wat, fase: 'afspraak', bron: 'bestaande_klant', verantwoordelijke, client_id: klant?.id ?? null, created_by: wie,
    }).select('id').single()
    if (error || !data) throw new Error(error?.message ?? 'Doorgeven mislukt')
    const id = (data as { id: string }).id
    await admin.from('ngs_deal_notities').insert({ deal_id: id, tekst: `Doorgegeven door ${wie} vanuit NextGenMedia`, soort: 'systeem', door: wie })
    if (opdrachtId) await voegNotitieToe(admin, opdrachtId, `Doorgegeven aan NextGenSolutions: ${wat}`, 'systeem', { id: null, naam: wie, email: door.email })
    return { naar, id }
  }
  if (!verantwoordelijke) throw new DoorgevenFout('Kies wie het opvolgt.')
  const { data, error } = await admin.from('opdrachten').insert({
    client_id: klant?.id ?? null, klant_vrij: klant ? null : naam, titel: wat.split('\n')[0].slice(0, 160), omschrijving: wat, status: 'open',
    merk: 'nextgenmedia', bron: 'bestaande_klant', verantwoordelijke, aangemaakt_door_email: door.email,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Doorgeven mislukt')
  const id = (data as { id: string }).id
  await voegNotitieToe(admin, id, `Doorgegeven door ${wie} vanuit NextGenSolutions: ${wat}`, 'systeem', { id: null, naam: wie, email: door.email })
  return { naar, id }
}
