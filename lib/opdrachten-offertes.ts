import 'server-only'
import { bedrijfVan, kolomVan, projectVerantwoordelijke, raadDiensten, statusVoorKolom, ontbreektVoorFase } from '@/lib/opdrachten-kanban'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { magAutomatischNaar, vandaagISO, type OpdrachtStatus } from '@/lib/opdrachten'
import { contractTaak, kiesKaartVoorOfferte, moetNaarOfferte, taakVoorWie, werkdagenLater, type KaartKandidaat } from '@/lib/opdrachten-offerte-model'
import { leadTaakOpties, maakOpdrachtTaak, taakAfvinken } from '@/lib/sales/lead-taken-server'

/**
 * Projecten ↔ offertes, de serverkant. Regels in lib/opdrachten-offerte-model.ts.
 *
 * Elke offerte hangt aan een kaart in Projecten: bij het aanmaken (en bij het
 * openen van het bord voor wat ervoor bestond) koppelt de app de offerte aan
 * de kaart van het project of van de klant, of maakt ze een kaart. Die kaart
 * staat dan in "Offerte gestuurd". Bevestigt de klant, dan schuift ze naar
 * "Offerte geaccepteerd" en komt er een taak in ClickUp (contract opmaken of in gang zetten). De testklant krijgt nooit een kaart.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
type Auteur = { id: string | null; email: string | null; naam: string | null } | null
type OfferteRij = {
  id: string; client_id: string | null; klant_naam: string | null; opdracht_id: string | null; titel: string
  bedrag_excl: number | null; merk: string | null; status: string; created_by_email: string | null
  geaccepteerd_op?: string | null; geaccepteerd_door?: string | null
}

const TESTKLANT = /^test$/i
const nu = () => new Date().toISOString()

async function leesOfferte(admin: Admin, id: string): Promise<OfferteRij | null> {
  const { data } = await admin.from('offertes')
    .select('id, client_id, klant_naam, opdracht_id, titel, bedrag_excl, merk, status, created_by_email, geaccepteerd_op, geaccepteerd_door')
    .eq('id', id).maybeSingle()
  return (data ?? null) as OfferteRij | null
}

/** De kaart naar Offerte gestuurd zetten (enkel vanuit Opvolging). Ontbreekt er iets, dan zegt een notitie wat. */
async function naarOfferte(admin: Admin, kaartId: string, o: OfferteRij, auteur: Auteur): Promise<boolean> {
  const { data } = await admin.from('opdrachten').select('id, status, client_id, klant_vrij, diensten, btw_nummer').eq('id', kaartId).maybeSingle()
  const k = data as { id: string; status: OpdrachtStatus; client_id: string | null; klant_vrij: string | null; diensten: string[] | null; btw_nummer: string | null } | null
  if (!k || !moetNaarOfferte(k.status)) return false
  const doel = statusVoorKolom(k.status, 'offerte')
  const { data: gelukt } = await admin.from('opdrachten').update({
    status: doel, offerte_via: 'mail', offerte_op: vandaagISO(), status_bron: 'automatisch', status_gewijzigd_op: nu(), updated_at: nu(),
  }).eq('id', k.id).eq('status', k.status).select('id')
  if (!(gelukt ?? []).length) return false
  let naam = k.klant_vrij, btw = k.btw_nummer
  if (k.client_id) {
    const { data: c } = await admin.from('clients').select('company_name, btw_nummer').eq('id', k.client_id).maybeSingle()
    naam = (c as { company_name?: string | null } | null)?.company_name ?? naam
    btw = (c as { btw_nummer?: string | null } | null)?.btw_nummer ?? btw
  }
  const mist = ontbreektVoorFase('offerte', { naam, btw, diensten: k.diensten ?? [] })
  await voegNotitieToe(admin, k.id, `Offerte "${o.titel}": de kaart staat nu in Offerte gestuurd.${mist.length ? ` Vul nog aan: ${mist.join(', ')}.` : ''}`, 'systeem', auteur).catch(() => null)
  return true
}

/**
 * Zorg dat de offerte aan een kaart in Offerte gestuurd hangt. Veilig om
 * herhaald te draaien: een gekoppelde offerte wordt enkel nog vooruit gezet.
 */
export async function kaartVoorOfferte(admin: Admin, offerteId: string, auteur: Auteur = null): Promise<{ opdrachtId: string | null; actie: 'bestaat' | 'verplaatst' | 'gekoppeld' | 'aangemaakt' | 'overgeslagen' }> {
  const o = await leesOfferte(admin, offerteId)
  if (!o || o.status === 'ingetrokken') return { opdrachtId: o?.opdracht_id ?? null, actie: 'overgeslagen' }

  let klantNaam = o.klant_naam
  let verantwoordelijke: string | null = null
  if (o.client_id) {
    const { data: c } = await admin.from('clients').select('company_name, sales_verantwoordelijke').eq('id', o.client_id).maybeSingle()
    const kl = c as { company_name?: string | null; sales_verantwoordelijke?: string | null } | null
    klantNaam = kl?.company_name ?? klantNaam
    verantwoordelijke = kl?.sales_verantwoordelijke ?? null
  }
  if (TESTKLANT.test(String(klantNaam ?? '').trim())) return { opdrachtId: o.opdracht_id, actie: 'overgeslagen' }

  // 1. Al aan een (bestaande) kaart gekoppeld.
  if (o.opdracht_id) {
    const { data: k } = await admin.from('opdrachten').select('id').eq('id', o.opdracht_id).maybeSingle()
    if (k) return { opdrachtId: o.opdracht_id, actie: (await naarOfferte(admin, o.opdracht_id, o, auteur)) ? 'verplaatst' : 'bestaat' }
  }

  // 2. De lopende kaart van deze klant.
  if (o.client_id) {
    const { data: kaarten } = await admin.from('opdrachten').select('id, status, contract_id, created_at').eq('client_id', o.client_id).limit(50)
    const id = kiesKaartVoorOfferte((kaarten ?? []) as KaartKandidaat[])
    if (id) {
      const { data: gekoppeld } = await admin.from('offertes').update({ opdracht_id: id, updated_at: nu() }).eq('id', o.id).is('opdracht_id', null).select('id')
      if ((gekoppeld ?? []).length) {
        const verplaatst = await naarOfferte(admin, id, o, auteur)
        if (!verplaatst) await voegNotitieToe(admin, id, `Offerte "${o.titel}" hangt aan deze kaart.`, 'systeem', auteur).catch(() => null)
        return { opdrachtId: id, actie: 'gekoppeld' }
      }
    }
  }

  // 3. Een nieuwe kaart in Offerte gestuurd.
  const diensten = raadDiensten(o.titel)
  const rij: Record<string, unknown> = {
    client_id: o.client_id, klant_vrij: o.client_id ? null : (klantNaam ?? null), titel: o.titel.slice(0, 200),
    status: 'voorstel_voorgelegd' as OpdrachtStatus, status_bron: 'automatisch', status_gewijzigd_op: nu(),
    offerte_via: 'mail', offerte_op: vandaagISO(), diensten,
    merk: o.merk === 'nextgensolutions' ? 'nextgensolutions' : bedrijfVan(null, diensten),
    datum: vandaagISO(), verantwoordelijke: projectVerantwoordelijke(verantwoordelijke),
    bedrag_excl: o.bedrag_excl === null || o.bedrag_excl === undefined ? null : Number(o.bedrag_excl),
    aangemaakt_door_offerte: o.id,
  }
  let { data: nieuw, error } = await admin.from('opdrachten').insert(rij).select('id').single()
  // Vóór een migratie: zonder de nieuwere kolommen.
  if (error && /aangemaakt_door_offerte|merk|datum|schema cache|column/i.test(error.message)) {
    delete rij.aangemaakt_door_offerte; delete rij.merk; delete rij.datum
    ;({ data: nieuw, error } = await admin.from('opdrachten').insert(rij).select('id').single())
  }
  if (error) throw new Error(error.message)
  const kaartId = String((nieuw as { id: string }).id)
  const { data: gekoppeld } = await admin.from('offertes').update({ opdracht_id: kaartId, updated_at: nu() }).eq('id', o.id).is('opdracht_id', null).select('id')
  if (!(gekoppeld ?? []).length) {
    // Intussen door iemand anders gekoppeld: de lege kaart weer weg.
    await admin.from('opdrachten').delete().eq('id', kaartId)
    const opnieuw = await leesOfferte(admin, o.id)
    return { opdrachtId: opnieuw?.opdracht_id ?? null, actie: 'bestaat' }
  }
  await voegNotitieToe(admin, kaartId, `Kaart aangemaakt bij de offerte "${o.titel}".`, 'systeem', auteur).catch(() => null)
  return { opdrachtId: kaartId, actie: 'aangemaakt' }
}

/** Offertes zonder kaart (of met een kaart die nog in Opvolging staat): bij het openen van het bord rechtzetten. */
export async function zorgVoorOfferteKaarten(admin: Admin): Promise<number> {
  const { data, error } = await admin.from('offertes').select('id, opdracht_id, status').in('status', ['concept', 'verstuurd', 'geaccepteerd']).order('created_at', { ascending: false }).limit(300)
  if (error) return 0
  const rijen = (data ?? []) as { id: string; opdracht_id: string | null; status: string }[]
  const gekoppeld = rijen.filter((r) => r.opdracht_id).map((r) => r.opdracht_id as string)
  const inOpvolging = new Set<string>()
  if (gekoppeld.length) {
    const { data: kaarten } = await admin.from('opdrachten').select('id, status').in('id', gekoppeld)
    for (const k of (kaarten ?? []) as { id: string; status: string }[]) if (kolomVan(k.status) === 'potentieel') inOpvolging.add(k.id)
  }
  let n = 0
  for (const r of rijen.filter((x) => !x.opdracht_id || inOpvolging.has(x.opdracht_id)).slice(0, 25)) {
    try { const a = await kaartVoorOfferte(admin, r.id); if (a.actie !== 'bestaat' && a.actie !== 'overgeslagen') n++ }
    catch (e) { console.warn('[opdrachten] kaart voor offerte mislukt:', e instanceof Error ? e.message : e) }
  }
  return n
}

/**
 * Bevestigde offerte: de kaart vanzelf naar Offerte geaccepteerd. Enkel vooruit
 * (vanuit Opvolging of Offerte gestuurd) en niet als iemand ze daarna bewust
 * terugzette (auto_status). Het bord doet hetzelfde bij het openen.
 */
async function naarGeaccepteerd(admin: Admin, kaartId: string, o: OfferteRij): Promise<boolean> {
  const { data } = await admin.from('opdrachten').select('id, status, auto_status').eq('id', kaartId).maybeSingle()
  const k = data as { id: string; status: OpdrachtStatus; auto_status: string | null } | null
  if (!k || !magAutomatischNaar(k.status, 'interesse', k.auto_status)) return false
  const { data: gelukt } = await admin.from('opdrachten').update({
    status: 'interesse', status_bron: 'automatisch', auto_status: 'interesse', status_gewijzigd_op: nu(), updated_at: nu(),
  }).eq('id', k.id).eq('status', k.status).select('id')
  if (!(gelukt ?? []).length) return false
  await voegNotitieToe(admin, k.id, `Offerte "${o.titel}" bevestigd${o.geaccepteerd_door ? ` door ${o.geaccepteerd_door}` : ''}: de kaart staat nu in Offerte geaccepteerd.`, 'systeem', null).catch(() => null)
  return true
}

/**
 * De klant bevestigde de offerte: kaart naar Offerte geaccepteerd en één taak
 * in ClickUp om het contract op te maken of het project in gang te zetten.
 * Dezelfde offerte maakt nooit twee taken.
 */
export async function naOfferteAkkoord(admin: Admin, offerteId: string): Promise<void> {
  const { opdrachtId } = await kaartVoorOfferte(admin, offerteId)
  if (!opdrachtId) return
  const o = await leesOfferte(admin, offerteId)
  if (!o || o.status !== 'geaccepteerd') return
  await naarGeaccepteerd(admin, opdrachtId, o).catch((e) => console.warn('[opdrachten] naar Offerte geaccepteerd mislukt:', e instanceof Error ? e.message : e))
  const { data: k } = await admin.from('opdrachten').select('verantwoordelijke, merk').eq('id', opdrachtId).maybeSingle()
  const kaart = k as { verantwoordelijke: string | null; merk: string | null } | null
  let klant = o.klant_naam
  if (o.client_id) {
    const { data: c } = await admin.from('clients').select('company_name').eq('id', o.client_id).maybeSingle()
    klant = (c as { company_name?: string | null } | null)?.company_name ?? klant
  }
  const taak = contractTaak({ klant, titel: o.titel, bedrag: o.bedrag_excl === null ? null : Number(o.bedrag_excl), door: o.geaccepteerd_door ?? null, op: o.geaccepteerd_op ?? null })
  try {
    const opties = await leadTaakOpties(admin, null, taakVoorWie(kaart?.verantwoordelijke, o.created_by_email))
    if (!opties.ingesteld) throw new Error('ClickUp is niet gekoppeld')
    const assignee = opties.standaard ?? opties.leden.find((l) => /^bram\b/i.test(l.naam))?.id ?? null
    if (!assignee) throw new Error('geen ClickUp-lid gevonden om de taak aan toe te wijzen')
    const merk = o.merk === 'nextgensolutions' || kaart?.merk === 'nextgensolutions' ? 'nextgensolutions' : 'nextgenmedia'
    await maakOpdrachtTaak(admin, opdrachtId, {
      omschrijving: taak.omschrijving, notitie: taak.notitie, deadline: werkdagenLater(vandaagISO(), 2),
      assignee_id: assignee, merk, aanvraag_sleutel: o.id,
    }, { userId: null, email: null })
  } catch (e) {
    await voegNotitieToe(admin, opdrachtId, `De taak "${taak.omschrijving}" kon niet in ClickUp (${e instanceof Error ? e.message : 'onbekende fout'}). Maak ze zelf aan via Taak toevoegen.`, 'systeem', null).catch(() => null)
  }
}

/** De taak "contract opmaken of in gang zetten" van deze kaart afvinken (ook in ClickUp), als ze nog open staat. */
export async function sluitContractTaak(admin: Admin, opdrachtId: string): Promise<void> {
  const { data: offertes } = await admin.from('offertes').select('id').eq('opdracht_id', opdrachtId).eq('status', 'geaccepteerd')
  const sleutels = ((offertes ?? []) as { id: string }[]).map((x) => x.id)
  if (!sleutels.length) return
  const { data: taken } = await admin.from('opdracht_taken').select('id').eq('opdracht_id', opdrachtId).in('aanvraag_sleutel', sleutels).is('afgerond_op', null)
  for (const t of (taken ?? []) as { id: string }[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await taakAfvinken(admin as any, 'opdracht', t.id) } catch (e) { console.warn('[opdrachten] taak afvinken mislukt:', e instanceof Error ? e.message : e) }
  }
}

/** Een weggegooid concept: de kaart die de app er speciaal voor maakte, mag mee weg als er niets anders aan hangt. */
export async function ruimKaartVanConceptOp(admin: Admin, offerteId: string, opdrachtId: string | null): Promise<void> {
  if (!opdrachtId) return
  const { data: k } = await admin.from('opdrachten').select('id, aangemaakt_door_offerte, contract_id, invoice_id').eq('id', opdrachtId).maybeSingle()
  const kaart = k as { aangemaakt_door_offerte?: string | null; contract_id: string | null; invoice_id: string | null } | null
  if (!kaart || kaart.aangemaakt_door_offerte !== offerteId || kaart.contract_id || kaart.invoice_id) return
  const [{ data: andere }, { data: taken }] = await Promise.all([
    admin.from('offertes').select('id').eq('opdracht_id', opdrachtId).neq('id', offerteId).limit(1),
    admin.from('opdracht_taken').select('id').eq('opdracht_id', opdrachtId).limit(1),
  ])
  if ((andere ?? []).length || (taken ?? []).length) return
  await admin.from('opdracht_notities').delete().eq('opdracht_id', opdrachtId)
  await admin.from('opdrachten').delete().eq('id', opdrachtId).eq('aangemaakt_door_offerte', offerteId)
}
