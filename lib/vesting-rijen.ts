import {
  FREQUENTIES, type Contract, type WamRij, type WamKost, type WamTermijn, type ContractStatus, type TermijnStatus,
} from '@/lib/vesting'

/**
 * Databankrijen (tekstgetallen, nulls) → de types van de rekenkern.
 * Gedeeld door het Vesting-scherm en de algemene Excel-export, zodat beide
 * exact dezelfde normalisatie gebruiken.
 */

const n = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null }
const d = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null)
const STATUSSEN = ['actief', 'voltooid', 'stopgezet', 'niet_betaler']

export function naarContract(r: Record<string, unknown>): Contract {
  return {
    id: String(r.id), nr: String(r.nr ?? ''), klant: String(r.klant ?? ''),
    ondertekend_op: d(r.ondertekend_op) ?? '', start_dienst: d(r.start_dienst), einde_dienst: d(r.einde_dienst),
    dienst: (r.dienst as string | null) ?? null,
    facturatiemodel: r.facturatiemodel === 'eenmalig' ? 'eenmalig' : 'maandcontract',
    maandbedrag: n(r.maandbedrag), duur_maanden: n(r.duur_maanden), handmatige_totaalwaarde: n(r.handmatige_totaalwaarde),
    uitgesloten_kosten: n(r.uitgesloten_kosten) ?? 0,
    status: (STATUSSEN.includes(String(r.status)) ? r.status : 'actief') as ContractStatus,
    betalingen_op_schema: r.betalingen_op_schema !== false,
    appointment_door_marco: r.appointment_door_marco === true,
    closed_door_marco: r.closed_door_marco === true,
    laatste_betaalde_maand: d(r.laatste_betaalde_maand), reden_stop: (r.reden_stop as string | null) ?? null,
    notitie: (r.notitie as string | null) ?? null,
    contract_id: (r.contract_id as string | null) ?? null,
    directe_kosten_facturen: n(r.directe_kosten_facturen),
    kostenstatus_facturen: (r.kostenstatus_facturen as Contract['kostenstatus_facturen']) ?? null,
    facturen_gekoppeld: n(r.facturen_gekoppeld),
  }
}

export function naarWam(r: Record<string, unknown>): WamRij {
  const freq = FREQUENTIES.find((f) => f.key === r.frequentie)?.key ?? null
  return {
    id: String(r.id), nr: String(r.nr ?? ''), klant: String(r.klant ?? ''),
    client_id: (r.client_id as string | null) ?? null,
    contractwaarde: n(r.contractwaarde) ?? 0, netto_ontvangen: n(r.netto_ontvangen) ?? 0,
    status: (STATUSSEN.includes(String(r.status)) ? r.status : 'actief') as ContractStatus,
    betalingen_op_schema: r.betalingen_op_schema !== false, notitie: (r.notitie as string | null) ?? null,
    start_datum: d(r.start_datum), contract_maanden: n(r.contract_maanden), bedrag_per_factuur: n(r.bedrag_per_factuur),
    frequentie: freq, btw_pct: n(r.btw_pct) ?? 21, omschrijving: (r.omschrijving as string | null) ?? null,
  }
}

export function naarTermijn(r: Record<string, unknown>): WamTermijn {
  return {
    id: String(r.id), wam_id: String(r.wam_id), volgnr: n(r.volgnr) ?? 0, periode: String(r.periode ?? '').slice(0, 7),
    factuurdatum: d(r.factuurdatum) ?? '', bedrag_excl: n(r.bedrag_excl) ?? 0, btw_pct: n(r.btw_pct) ?? 21,
    status: (['gepland', 'gefactureerd', 'betaald', 'geannuleerd'].includes(String(r.status)) ? r.status : 'gepland') as TermijnStatus,
    betaald_op: d(r.betaald_op), invoice_id: (r.invoice_id as string | null) ?? null,
    clickup_task_id: (r.clickup_task_id as string | null) ?? null, notitie: (r.notitie as string | null) ?? null,
  }
}

export function naarKost(r: Record<string, unknown>): WamKost {
  return { id: String(r.id), datum: d(r.datum), omschrijving: String(r.omschrijving ?? ''), bedrag: n(r.bedrag) ?? 0 }
}
