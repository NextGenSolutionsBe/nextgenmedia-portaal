import 'server-only'
import { raadDiensten, bedrijfVan, kolomVan, statusUitContract, projectVerantwoordelijke } from '@/lib/opdrachten-kanban'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { vandaagISO, type OpdrachtStatus } from '@/lib/opdrachten'
import { sluitContractTaak } from '@/lib/opdrachten-offertes'

/**
 * Projecten: elk contract heeft een kaart. Zodra een contract opgemaakt wordt,
 * komt er een kaart in "Contract verstuurd" (of de bestaande kaart van die
 * klant in Opvolging of Offerte gestuurd krijgt het contract). Getekend,
 * volledig gefactureerd en verloren volgen daarna vanzelf (zie de opdrachten-API).
 *
 * Bewust zonder kaart: contracten van de testklant ("test"). Veilig om
 * herhaald te draaien: een contract met een kaart wordt overgeslagen, en een
 * unieke index op opdrachten.contract_id vangt twee gelijktijdige pogingen af.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
type Contract = { id: string; title: string | null; status: string | null; client_id: string | null; created_at: string | null; expires_at?: string | null; contract_type?: string | null }

const TESTKLANT = /^test$/i

export async function kaartVoorContract(admin: Admin, contractId: string, opties: { opdrachtId?: string | null } = {}): Promise<'bestaat' | 'gekoppeld' | 'aangemaakt' | 'overgeslagen'> {
  const { data: al } = await admin.from('opdrachten').select('id').eq('contract_id', contractId).limit(1)
  if ((al ?? []).length) return 'bestaat'
  const { data: c } = await admin.from('contracts').select('id, title, status, client_id, created_at, expires_at, contract_type').eq('id', contractId).maybeSingle()
  const contract = c as Contract | null
  if (!contract || String(contract.status ?? '').toLowerCase() === 'template') return 'overgeslagen'

  type Klant = { company_name?: string | null; sales_verantwoordelijke?: string | null }
  let klant: Klant | null = null
  if (contract.client_id) {
    const { data: k } = await admin.from('clients').select('company_name, sales_verantwoordelijke').eq('id', contract.client_id).maybeSingle()
    klant = (k ?? null) as Klant | null
    if (TESTKLANT.test(String(klant?.company_name ?? '').trim())) return 'overgeslagen'
  }

  const status: OpdrachtStatus = statusUitContract(contract, vandaagISO())
  const titel = String(contract.title ?? '').trim() || 'Contract'
  const nu = new Date().toISOString()

  // Een lopende kaart van dezelfde klant (Opvolging, Offerte gestuurd of
  // Offerte geaccepteerd, nog zonder contract) krijgt dit contract: dat is hetzelfde project.
  // Aangemaakt vanaf een kaart ("Contract aanmaken" na een bevestigde offerte): precies die kaart.
  let kandidaat: { id: string; zonderKlant?: boolean } | undefined
  if (opties.opdrachtId) {
    const { data: gekozen } = await admin.from('opdrachten').select('id, status, contract_id, client_id').eq('id', opties.opdrachtId).maybeSingle()
    const g = gekozen as { id: string; status: OpdrachtStatus; contract_id: string | null; client_id: string | null } | null
    if (g && !g.contract_id && kolomVan(g.status) !== 'stopgezet') kandidaat = { id: g.id, zonderKlant: !g.client_id }
  }
  if (!kandidaat && contract.client_id) {
    const { data: open } = await admin.from('opdrachten').select('id, status, titel')
      .eq('client_id', contract.client_id).is('contract_id', null).order('created_at', { ascending: false }).limit(20)
    const lopend = ((open ?? []) as { id: string; status: OpdrachtStatus; titel: string }[])
      .filter((o) => kolomVan(o.status) === 'potentieel' || kolomVan(o.status) === 'offerte' || kolomVan(o.status) === 'geaccepteerd')
    // Een kaart in Offerte geaccepteerd (of met een bevestigde offerte) gaat voor.
    const geaccepteerd = lopend.find((o) => kolomVan(o.status) === 'geaccepteerd')
    if (geaccepteerd) kandidaat = geaccepteerd
    else if (lopend.length > 1) {
      const { data: akkoord } = await admin.from('offertes').select('opdracht_id').in('opdracht_id', lopend.map((o) => o.id)).eq('status', 'geaccepteerd').limit(1)
      const metAkkoord = ((akkoord ?? []) as { opdracht_id: string }[])[0]?.opdracht_id
      kandidaat = lopend.find((o) => o.id === metAkkoord) ?? lopend[0]
    } else kandidaat = lopend[0]
  }
  {
    if (kandidaat) {
      const { error } = await admin.from('opdrachten').update({
        contract_id: contract.id, status, status_bron: 'automatisch', auto_status: status, status_gewijzigd_op: nu, updated_at: nu,
        ...(status === 'geen_interesse' ? { stop_reden: 'Contract verlopen of niet doorgegaan' } : {}),
        // Een prospect-kaart krijgt de klant van het contract.
        ...(kandidaat.zonderKlant && contract.client_id ? { client_id: contract.client_id, klant_vrij: null } : {}),
      }).eq('id', kandidaat.id).is('contract_id', null)
      if (!error) {
        await voegNotitieToe(admin, kandidaat.id, `Contract "${titel}" opgemaakt: de kaart staat nu in ${status === 'getekend' ? 'Contract getekend' : status === 'geen_interesse' ? 'Verloren' : 'Contract verstuurd'}.`, 'systeem', null)
        // De taak "contract opmaken of in gang zetten" is daarmee gedaan.
        await sluitContractTaak(admin, kandidaat.id).catch(() => {})
        return 'gekoppeld'
      }
    }
  }

  const diensten = raadDiensten(`${titel} ${contract.contract_type ?? ''}`)
  const rij: Record<string, unknown> = {
    client_id: contract.client_id, klant_vrij: null, titel: titel.slice(0, 200), status, contract_id: contract.id,
    status_bron: 'automatisch', auto_status: status, status_gewijzigd_op: nu,
    diensten, merk: bedrijfVan(null, diensten), datum: String(contract.created_at ?? nu).slice(0, 10),
    verantwoordelijke: projectVerantwoordelijke(klant?.sales_verantwoordelijke),
    stop_reden: status === 'geen_interesse' ? 'Contract verlopen of niet doorgegaan' : null,
  }
  let { data: nieuw, error } = await admin.from('opdrachten').insert(rij).select('id').single()
  // Vóór de migratie (merk, datum): zonder die kolommen.
  if (error && /merk|datum|schema cache|column/i.test(error.message) && !/duplicate|unique|23505/i.test(error.message)) {
    delete rij.merk; delete rij.datum
    ;({ data: nieuw, error } = await admin.from('opdrachten').insert(rij).select('id').single())
  }
  if (error) {
    if (/duplicate|unique|23505/i.test(error.message)) return 'bestaat'
    throw new Error(error.message)
  }
  await voegNotitieToe(admin, String((nieuw as { id: string }).id), `Kaart aangemaakt bij het contract "${titel}".`, 'systeem', null)
  return 'aangemaakt'
}

/** Elk contract zonder kaart krijgt er een (bij het openen van het bord en na het aanmaken van een contract). */
export async function zorgVoorContractKaarten(admin: Admin): Promise<number> {
  const [{ data: cs }, { data: os }] = await Promise.all([
    admin.from('contracts').select('id, status').order('created_at', { ascending: false }).limit(1000),
    admin.from('opdrachten').select('contract_id').not('contract_id', 'is', null).limit(5000),
  ])
  const metKaart = new Set(((os ?? []) as { contract_id: string }[]).map((o) => o.contract_id))
  const zonder = ((cs ?? []) as { id: string; status: string | null }[])
    .filter((c) => !metKaart.has(c.id) && String(c.status ?? '').toLowerCase() !== 'template')
  let n = 0
  for (const c of zonder.slice(0, 25)) {
    try { if ((await kaartVoorContract(admin, c.id)) !== 'overgeslagen') n++ } catch (e) { console.warn('[opdrachten] kaart voor contract mislukt:', e instanceof Error ? e.message : e) }
  }
  return n
}
