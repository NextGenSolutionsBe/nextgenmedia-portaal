import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { directeKostenVoorContracten } from '@/lib/facturen/kosten-data'
import { berekenVesting, factuurUitRij, leesInstellingen, leadSoortVan, type Contract, type ContractTermijn, type GekoppeldeFactuur, type VestingOverzicht } from '@/lib/vesting'
import { naarContract, naarKost, naarWam } from '@/lib/vesting-rijen'
import { NIET_MEETELLEN_SLEUTEL, teBeoordelen, type KandidaatContract } from '@/lib/vesting-snel'
import {
  VENNOTEN_SLEUTEL, akkoordStand, contractAkkoord, inhoudTekst, leesVennoten, naarKostLijn, naarRegistratie, registratieAkkoord,
  registratiesVoorBerekening, vennootVan, wijzigingen,
  type Akkoord, type AkkoordStand, type ContractAkkoord, type Handtekening, type KostLijn, type Onderwerp, type Registratie,
  type RegistratieAkkoord, type Vennoot, type VennotenInstelling,
} from '@/lib/vesting-akkoord'
import type { CertificaatKort, ContractWeergave, RegistratieWeergave, VestingWeergave } from '@/lib/vesting-weergave'

type Admin = ReturnType<typeof createAdminSupabaseClient>

/**
 * Alle Vesting-data in één keer: de rijen, de berekening (lib/vesting.ts) en
 * per contract en registratie (inkomst of kost) de cijfers waarvoor getekend
 * wordt en wie al tekende. Eén bron voor het scherm, het tekenen (controle dat
 * iemand tekent voor wat er nu staat) en de melding "wacht op jouw handtekening".
 *
 * WAM loopt sinds 4 nov 2026 via registraties (inkomsten met verantwoording);
 * de oude WAM-tabellen worden niet meer gelezen.
 */

export type AkkoordInfo = { inhoud: Akkoord; tekst: string; stand: AkkoordStand; wijzigingen: string[] }

export type VestingData = {
  ruw: {
    instellingen: Record<string, unknown> | null
    contracten: Record<string, unknown>[]
    /** Inkomsten in de vorm van WAM-rijen (voor de uitgebreide weergave en de export). */
    wam: Record<string, unknown>[]
    /** Algemene kosten in de vorm van WAM-kosten. */
    kosten: Record<string, unknown>[]
    oud: Record<string, unknown>[]
    wamTermijnen: Record<string, unknown>[]
    contractTermijnen: Record<string, unknown>[]
    moduleContracten: Record<string, unknown>[]
    klanten: { id: string; naam: string; closer: string | null; setter: string | null }[]
    facturen: GekoppeldeFactuur[]
    nietMeetellen: string[]
    wamGekoppeld: string[]
  }
  v: VestingOverzicht
  ctermijnen: ContractTermijn[]
  kostLijnen: KostLijn[]
  registraties: Registratie[]
  vennoten: VennotenInstelling
  akkoordContract: Map<string, AkkoordInfo>
  akkoordRegistratie: Map<string, AkkoordInfo>
  /** Per kaart het laatste certificaat (met de getekende tekst, om te weten of het over de huidige cijfers gaat). */
  certificaten: Map<string, Omit<CertificaatKort, 'huidig'> & { inhoud_tekst: string }>
  /** Contracten uit Contracten/Projecten die nog niet beoordeeld zijn (ook nog niet getekend). */
  kandidaten: KandidaatContract[]
  /** Bewust "telt niet mee". */
  nietMee: KandidaatContract[]
  moduleTitel: Map<string, { titel: string; status: string; signed_at: string | null }>
}

const d = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null)
const n = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null }

function naarKandidaat(r: Record<string, unknown>): KandidaatContract {
  const c = r.clients as { company_name?: string | null } | { company_name?: string | null }[] | null | undefined
  const klant = Array.isArray(c) ? (c[0]?.company_name ?? null) : (c?.company_name ?? null)
  return {
    id: String(r.id), titel: String(r.title ?? 'Contract'), status: String(r.status ?? 'draft'),
    client_id: (r.client_id as string | null) ?? null, klant,
    signed_at: d(r.signed_at), start_date: d(r.start_date),
    waarde: n(r.contract_waarde_excl) ?? n(r.contract_waarde_voorstel),
  }
}

export async function laadVestingData(admin: Admin = createAdminSupabaseClient()): Promise<VestingData> {
  const [inst, contracten, registratieRijen, oud, moduleContracten, klanten, contractTermijnen, kostLijnen, handtekeningen, instellingen, certificaatRijen] = await Promise.all([
    admin.from('vesting_instellingen').select('*').eq('id', 1).maybeSingle(),
    admin.from('vesting_contracten').select('*').order('ondertekend_op').order('nr'),
    admin.from('vesting_registraties').select('*').order('datum').order('created_at'),
    admin.from('vesting_revenue').select('*').order('entry_date'),
    admin.from('contracts').select('id, title, status, client_id, start_date, end_date, signed_at, service_slug, contract_waarde_excl, contract_waarde_voorstel, created_at, clients ( company_name )').order('created_at', { ascending: false }).limit(500),
    admin.from('clients').select('id, company_name, sales_verantwoordelijke, appointment_setter').order('company_name'),
    admin.from('vesting_contract_termijnen').select('*').order('factuurdatum').order('volgnr'),
    admin.from('vesting_kosten').select('*').order('created_at'),
    admin.from('vesting_handtekeningen').select('id, onderwerp, onderwerp_id, vennoot, naam, getekend_op, inhoud_tekst').order('getekend_op'),
    admin.from('app_settings').select('key, value').in('key', [NIET_MEETELLEN_SLEUTEL, VENNOTEN_SLEUTEL]),
    admin.from('vesting_certificaten').select('id, nummer, onderwerp_id, inhoud_tekst, volledig_op, mail_status, mail_op, mail_fout').order('volledig_op', { ascending: false }),
  ])
  const setting = (k: string) => ((instellingen.data ?? []) as { key: string; value: unknown }[]).find((r) => r.key === k)?.value
  const ids = (setting(NIET_MEETELLEN_SLEUTEL) as { ids?: unknown } | undefined)?.ids
  const nietMeetellen = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
  const vennoten = leesVennoten(setting(VENNOTEN_SLEUTEL))
  const module = ((moduleContracten.data ?? []) as Record<string, unknown>[])
  const moduleTitel = new Map(module.map((m) => [String(m.id), { titel: String(m.title ?? 'Contract'), status: String(m.status ?? ''), signed_at: d(m.signed_at) }]))

  let contractRijen = (contracten.data ?? []) as Record<string, unknown>[]

  // Een contract dat de klant nog moest tekenen, krijgt de datum zodra het getekend is.
  const teDateren = contractRijen.filter((r) => !r.ondertekend_op && r.contract_id && moduleTitel.get(String(r.contract_id))?.signed_at)
  for (const r of teDateren) {
    const op = moduleTitel.get(String(r.contract_id))!.signed_at!
    const { error } = await admin.from('vesting_contracten').update({ ondertekend_op: op, updated_at: new Date().toISOString() }).eq('id', String(r.id)).is('ondertekend_op', null)
    if (!error) r.ondertekend_op = op
  }

  // Directe kosten op de facturen van gekoppelde contracten (het hoogste van lijnen en facturen telt).
  const gekoppeld = Array.from(new Set(contractRijen.map((r) => r.contract_id).filter(Boolean))) as string[]
  try {
    const k = await directeKostenVoorContracten(admin, gekoppeld)
    contractRijen = contractRijen.map((r) => {
      const x = r.contract_id ? k.get(String(r.contract_id)) : undefined
      return x ? { ...r, directe_kosten_facturen: x.directeKosten, kostenstatus_facturen: x.status, facturen_gekoppeld: x.aantalFacturen } : r
    })
  } catch { /* kostenlaag nog niet beschikbaar */ }

  let facturen: GekoppeldeFactuur[] = []
  try {
    if (gekoppeld.length) {
      const { data } = await admin.from('invoices')
        .select('id, reference, invoice_date, invoice_month, amount_excl, amount_incl, status, betaalstatus, betaald_bedrag, betaald_op, cancelled_at, credited_at, contract_id')
        .in('contract_id', gekoppeld)
      facturen = ((data ?? []) as Record<string, unknown>[]).map(factuurUitRij)
    }
  } catch { /* enkel handmatige status */ }

  const registraties = ((registratieRijen.data ?? []) as Record<string, unknown>[]).map(naarRegistratie)
  const { inkomsten, kosten } = registratiesVoorBerekening(registraties)
  const contractTermijnRijen = (contractTermijnen.data ?? []) as Record<string, unknown>[]
  const ctermijnen: ContractTermijn[] = contractTermijnRijen.map((r) => ({
    id: String(r.id), contract_id: String(r.contract_id), volgnr: Number(r.volgnr) || 0, periode: String(r.periode ?? '').slice(0, 7),
    factuurdatum: d(r.factuurdatum) ?? '', bedrag_excl: Number(r.bedrag_excl) || 0, btw_pct: Number(r.btw_pct) || 21,
    status: (['gepland', 'gefactureerd', 'betaald', 'geannuleerd'].includes(String(r.status)) ? r.status : 'gepland') as ContractTermijn['status'],
    betaald_op: d(r.betaald_op), invoice_id: (r.invoice_id as string | null) ?? null, in_contract: r.in_contract !== false, notitie: (r.notitie as string | null) ?? null,
  }))

  const instellingenWaarden = leesInstellingen((inst.data ?? null) as Record<string, unknown> | null)
  const v = berekenVesting(contractRijen.map(naarContract), inkomsten, kosten, instellingenWaarden, [], ctermijnen, facturen)

  const lijnen = ((kostLijnen.data ?? []) as Record<string, unknown>[]).map(naarKostLijn)
  const tekeningen = ((handtekeningen.data ?? []) as Record<string, unknown>[]).map((h) => ({
    id: String(h.id), onderwerp: h.onderwerp as Onderwerp, onderwerp_id: String(h.onderwerp_id), vennoot: h.vennoot as Vennoot,
    naam: (h.naam as string | null) ?? null, getekend_op: String(h.getekend_op), inhoud_tekst: String(h.inhoud_tekst),
  })) as Handtekening[]
  const info = (inhoud: Akkoord, onderwerp: Onderwerp, id: string): AkkoordInfo => {
    const tekst = inhoudTekst(inhoud)
    const stand = akkoordStand(tekst, tekeningen.filter((h) => h.onderwerp === onderwerp && h.onderwerp_id === id))
    return { inhoud, tekst, stand, wijzigingen: stand.vorige ? wijzigingen(stand.vorige, inhoud) : [] }
  }
  const akkoordContract = new Map(v.contracten.map((c) => [c.id, info(
    contractAkkoord(c, lijnen.filter((l) => l.vesting_contract_id === c.id), c.contract_id ? moduleTitel.get(c.contract_id)?.titel ?? null : null),
    'contract', c.id,
  )]))
  const akkoordRegistratie = new Map(registraties.map((r) => [r.id, info(registratieAkkoord(r), r.soort, r.id)]))

  const alle = module.map(naarKandidaat)
  const inVesting = new Set(contractRijen.map((r) => r.contract_id).filter((x): x is string => typeof x === 'string' && !!x))
  // Enkel getekende contracten komen als keuze "telt mee / telt niet mee" (12 nov 2026).
  const kandidaten = teBeoordelen(alle, inVesting, new Set(nietMeetellen))
  const nietSet = new Set(nietMeetellen)
  const nietMee = alle.filter((m) => nietSet.has(m.id))

  return {
    ruw: {
      instellingen: (inst.data ?? null) as Record<string, unknown> | null,
      contracten: contractRijen,
      wam: inkomsten as unknown as Record<string, unknown>[],
      kosten: kosten as unknown as Record<string, unknown>[],
      oud: (oud.data ?? []) as Record<string, unknown>[],
      wamTermijnen: [], contractTermijnen: contractTermijnRijen, moduleContracten: module,
      klanten: ((klanten.data ?? []) as { id: string; company_name: string | null; sales_verantwoordelijke?: string | null; appointment_setter?: string | null }[])
        .map((k) => ({ id: k.id, naam: k.company_name ?? '—', closer: k.sales_verantwoordelijke ?? null, setter: k.appointment_setter ?? null })),
      facturen, nietMeetellen, wamGekoppeld: [],
    },
    v, ctermijnen, kostLijnen: lijnen, registraties, vennoten, akkoordContract, akkoordRegistratie, kandidaten, nietMee, moduleTitel,
    certificaten: laatsteCertificaten((certificaatRijen.data ?? []) as Record<string, unknown>[]),
  }
}

function laatsteCertificaten(rijen: Record<string, unknown>[]): VestingData['certificaten'] {
  const uit: VestingData['certificaten'] = new Map()
  for (const r of rijen) {
    const id = String(r.onderwerp_id)
    if (uit.has(id)) continue   // nieuwste eerst
    uit.set(id, {
      id: String(r.id), nummer: String(r.nummer), volledig_op: String(r.volledig_op), inhoud_tekst: String(r.inhoud_tekst),
      mail_status: (r.mail_status === 'verstuurd' || r.mail_status === 'mislukt' ? r.mail_status : 'wacht') as CertificaatKort['mail_status'],
      mail_op: (r.mail_op as string | null) ?? null, mail_fout: (r.mail_fout as string | null) ?? null,
    })
  }
  return uit
}

const certificaatVoor = (data: VestingData, id: string, tekst: string): CertificaatKort | null => {
  const c = data.certificaten.get(id)
  if (!c) return null
  const { inhoud_tekst, ...rest } = c
  return { ...rest, huidig: inhoud_tekst === tekst }
}

/** Hoeveel contracten en registraties wachten op de handtekening van deze vennoot? */
export function openVoor(data: Pick<VestingData, 'akkoordContract' | 'akkoordRegistratie'>, vennoot: Vennoot): { contracten: number; registraties: number } {
  const open = (m: Map<string, AkkoordInfo>) => Array.from(m.values()).filter((a) => a.stand.per[vennoot].stand !== 'getekend').length
  return { contracten: open(data.akkoordContract), registraties: open(data.akkoordRegistratie) }
}

/**
 * De melding "wacht op jouw handtekening" voor één gebruiker. Leeg voor wie
 * geen vennoot is. De id verandert als er iets nieuws te tekenen valt, zodat
 * de melding dan opnieuw ongelezen staat.
 */
export async function vestingMeldingVoor(userId: string): Promise<{ id: string; kind: string; priority: 'high' | 'med'; title: string; date: string | null; href: string }[]> {
  const admin = createAdminSupabaseClient()
  const { data: rij } = await admin.from('app_settings').select('value').eq('key', VENNOTEN_SLEUTEL).maybeSingle()
  const vennoot = vennootVan(userId, leesVennoten((rij as { value?: unknown } | null)?.value))
  if (!vennoot) return []
  const data = await laadVestingData(admin)
  const open = [...Array.from(data.akkoordContract.entries()), ...Array.from(data.akkoordRegistratie.entries())]
    .filter(([, a]) => a.stand.per[vennoot].stand !== 'getekend')
    .map(([id, a]) => `${id}:${a.tekst}`)
  if (!open.length) return []
  let h = 0
  for (const ch of open.sort().join('|')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const { contracten, registraties } = openVoor(data, vennoot)
  const delen = [contracten ? `${contracten} ${contracten === 1 ? 'contract' : 'contracten'}` : '', registraties ? `${registraties} ${registraties === 1 ? 'inkomst of kost' : 'inkomsten en kosten'}` : ''].filter(Boolean).join(' en ')
  return [{
    id: `vesting:${vennoot}:${h.toString(36)}`, kind: 'vesting', priority: 'high',
    title: `Vesting: ${delen} ${open.length === 1 ? 'wacht' : 'wachten'} op jouw handtekening`,
    date: null, href: '/admin/vesting?tekenen=1',
  }]
}

/**
 * Wat er getekend is, telt: per kaart de laatste versie die alle drie tekenden.
 * Een contract telt met het bedrag uit die versie (aan het tarief van zijn
 * ondertekeningsjaar), een registratie met haar bedrag (of niet, als ze toen
 * geschrapt was). Kaarten die nog nooit door alle drie getekend werden, tellen niet.
 */
function getekendeStand(data: VestingData): VestingOverzicht {
  const contracten: Contract[] = []
  for (const rij of data.ruw.contracten) {
    const c = naarContract(rij)
    const laatste = data.akkoordContract.get(c.id)?.stand.laatsteVolledig
    if (!laatste) continue
    let a: ContractAkkoord
    try { a = JSON.parse(laatste.tekst) as ContractAkkoord } catch { continue }
    contracten.push({
      ...c, facturatiemodel: 'eenmalig', handmatige_totaalwaarde: a.telt_mee, maandbedrag: null, duur_maanden: null,
      uitgesloten_kosten: 0, directe_kosten_facturen: null, kostenstatus_facturen: null, toerekening_pct: 100,
      status: 'actief', betaald_bij_stop: null,
    })
  }
  const registraties: Registratie[] = []
  for (const r of data.registraties) {
    const laatste = data.akkoordRegistratie.get(r.id)?.stand.laatsteVolledig
    if (!laatste) continue
    let a: RegistratieAkkoord
    try { a = JSON.parse(laatste.tekst) as RegistratieAkkoord } catch { continue }
    registraties.push({ ...r, bedrag: a.bedrag, geschrapt: !!a.geschrapt, soort: a.soort })
  }
  const { inkomsten, kosten } = registratiesVoorBerekening(registraties)
  return berekenVesting(contracten, inkomsten, kosten, data.v.instellingen, [], [], [])
}

/** Alles voor het nieuwe scherm, voor deze gebruiker. */
export function naarWeergave(data: VestingData, userId: string | null): VestingWeergave {
  const { v } = data
  const i = v.instellingen
  const contracten: ContractWeergave[] = v.contracten.map((c) => {
    const akkoord = data.akkoordContract.get(c.id)!
    return {
      id: c.id, nr: c.nr, klant: c.klant, client_id: c.client_id ?? null,
      titel: c.contract_id ? data.moduleTitel.get(c.contract_id)?.titel ?? null : null,
      contract_id: c.contract_id, ondertekend_op: c.ondertekend_op || null, wachtOpKlant: c.wachtOpKlant,
      facturatiemodel: c.facturatiemodel, maandbedrag: c.maandbedrag, duur: c.duur, totaal: c.totaal,
      kostLijnen: data.kostLijnen.filter((l) => l.vesting_contract_id === c.id).map(({ id, soort, omschrijving, bedrag, verantwoording, bewijs }) => ({ id, soort, omschrijving, bedrag, verantwoording: verantwoording ?? null, bewijs: bewijs ? { pad: bewijs.pad, naam: bewijs.naam } : null })),
      kostenFacturen: c.directe_kosten_facturen ?? null, kostenAftrek: c.kostenAftrek, netto: c.netto,
      afspraak: c.appointment_door_marco, closing: c.closed_door_marco, toerekening_pct: c.toerekening_pct ?? null, lead_soort: leadSoortVan(c.lead_soort), factor: c.factor,
      teltMee: akkoord.inhoud.soort === 'contract' ? akkoord.inhoud.telt_mee : 0,
      algemeneKostenAftrek: c.algemeneKostenAftrek, teltVoorAandeel: c.teltVoorAandeel, status: c.status,
      telt: c.erkenning !== 'uitgesloten', definitief: c.erkenning === 'definitief', ruweVesting: c.ruweVesting,
      schijven: { goedkoop: c.goedkopeSchijf, jaar: c.jaarschijf, regulierTarief: i.regulier_tarief, jaarTarief: c.tarief, jaar_label: c.jaar },
      akkoord, certificaat: certificaatVoor(data, c.id, akkoord.tekst),
    }
  })
  // Nieuwste bovenaan; wat de klant nog moet tekenen eerst.
  contracten.sort((a, b) => (b.ondertekend_op ?? '9999').localeCompare(a.ondertekend_op ?? '9999') || b.nr.localeCompare(a.nr, 'nl', { numeric: true }))

  const registraties: RegistratieWeergave[] = data.registraties
    .map((r) => { const akkoord = data.akkoordRegistratie.get(r.id)!; return { ...r, akkoord, certificaat: certificaatVoor(data, r.id, akkoord.tekst) } })
    .sort((a, b) => Number(a.geschrapt) - Number(b.geschrapt) || b.datum.localeCompare(a.datum))

  const g = getekendeStand(data)
  const vennoot = vennootVan(userId, data.vennoten)
  const alleKaarten = [...contracten.map((c) => c.akkoord), ...registraties.map((r) => r.akkoord)]
  const inkomstenActief = registraties.filter((r) => r.soort === 'inkomst' && !r.geschrapt)
  return {
    aandelen: {
      marco: v.marcoVoorlopig, marcoDefinitief: v.marcoDefinitief, marcoGetekend: g.marcoVoorlopig, bramGetekend: g.bram,
      bram: v.bram, chiara: v.chiara, maxMarco: i.max_aandeel_marco,
      meetellend: v.meetellendeWaarde,
      wam: { ontvangen: v.wam.nettoOntvangen, aantal: inkomstenActief.length, aandeel: v.wam.voorlopig, bedragPerPct: i.wam_bedrag_per_pct, max: i.wam_max_aandeel },
      contracten: { teltMee: contracten.filter((c) => c.telt).reduce((s, c) => s + c.teltMee, 0), aantal: contracten.filter((c) => c.telt).length, aandeel: Math.max(0, v.marcoVoorlopig - v.wam.voorlopig) },
      algemeneKosten: v.algemeneKosten,
      volgendeProcent: v.volgendeProcent,
      getekend: { volledig: alleKaarten.filter((a) => a.stand.volledig).length, totaal: alleKaarten.length },
    },
    contracten, registraties,
    teBeoordelen: data.kandidaten, nietMee: data.nietMee, klanten: data.ruw.klanten,
    ik: { vennoot, naam: vennoot ? data.vennoten[vennoot].naam : null },
    vennoten: { marco: data.vennoten.marco.naam, bram: data.vennoten.bram.naam, chiara: data.vennoten.chiara.naam },
  }
}

/** De weergave voor de uitgebreide (oude) weergave en de export: dezelfde rijen. */
export const naarWamRijen = (data: VestingData) => data.ruw.wam.map((r) => naarWam(r))
export const naarAlgemeneKosten = (data: VestingData) => data.ruw.kosten.map((r) => naarKost(r))
