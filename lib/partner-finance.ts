// Centrale partner-boekhouding. Pure functies (client-safe) zodat de admin-
// detailpagina, het settlements-overzicht en het partnerportaal exact dezelfde
// cijfers tonen.
//
// Model:
//  • Verplichtingen ontstaan uit commissie (per verkoop) en onderaanneming
//    (vast bedrag) en leven in `partner_ledger_entries`.
//  • Echte betalingen leven in `partner_payments` en vereffenen het saldo.
//  • Open saldo = verplichtingen (niet-geannuleerd) − goedgekeurde betalingen.
//
// Richting (vanuit NextGenMedia):
//   we_pay_partner  = wij moeten de partner betalen
//   partner_pays_us = de partner moet ons betalen

import { normalizeDirection } from '@/lib/utils'

export type LedgerRow = { direction?: string | null; amount: number; status: string; kind?: string | null }
export type PaymentRow = { direction: string; amount: number; status: string }
export type DealRow = { id: string; direction?: string | null; client_id?: string | null }
export type SaleRow = { deal_id: string; sale_amount: number; commission_amount: number }

export type PartnerFinance = {
  // Verplichtingen (bruto, niet-geannuleerd)
  grossToPartner: number
  grossByPartner: number
  // Goedgekeurde betalingen
  paidToPartner: number
  paidByPartner: number
  // Openstaand
  openToPartner: number   // wij betalen partner (open)
  openByPartner: number   // partner betaalt ons (open)
  net: number             // openByPartner − openToPartner  (positief → partner betaalt ons)
  // KPI's — doorverwijzingen
  clientsWeReferred: number      // wij → partner (partner_pays_us deals)
  clientsPartnerReferred: number // partner → ons (we_pay_partner deals)
  revenueWeReferred: number      // omzet uit klanten die wij doorstuurden
  revenuePartnerReferred: number // omzet uit klanten die partner doorstuurde
  commissionWeEarned: number     // commissie die WIJ verdienden (partner betaalt ons)
  commissionPartnerEarned: number// commissie die de PARTNER verdiende (wij betalen)
  // KPI's — onderaanneming (vast bedrag, geen commissie)
  subToPartnerCount: number
  subToPartnerTotal: number      // onderaanneming die wij aan partner geven
  subByPartnerCount: number
  subByPartnerTotal: number      // onderaanneming die partner aan ons geeft
}

const sum = (arr: number[]) => arr.reduce((s, x) => s + x, 0)

export function computePartnerFinance(input: {
  ledger: LedgerRow[]
  payments: PaymentRow[]
  deals: DealRow[]
  sales: SaleRow[]
}): PartnerFinance {
  const { ledger, payments, deals, sales } = input

  const liveLedger = ledger.filter((l) => l.status !== 'cancelled')
  const grossToPartner = sum(liveLedger.filter((l) => normalizeDirection(l.direction, l.amount) === 'we_pay_partner').map((l) => Math.abs(Number(l.amount))))
  const grossByPartner = sum(liveLedger.filter((l) => normalizeDirection(l.direction, l.amount) === 'partner_pays_us').map((l) => Math.abs(Number(l.amount))))

  const approved = payments.filter((p) => p.status === 'approved')
  const paidToPartner = sum(approved.filter((p) => p.direction === 'we_pay_partner').map((p) => Math.abs(Number(p.amount))))
  const paidByPartner = sum(approved.filter((p) => p.direction === 'partner_pays_us').map((p) => Math.abs(Number(p.amount))))

  const openToPartner = grossToPartner - paidToPartner
  const openByPartner = grossByPartner - paidByPartner
  const net = openByPartner - openToPartner

  // Doorverwijzingen — richting bepaalt wie betaalt.
  //   partner_pays_us = WIJ verwezen klant naar partner → wij verdienen commissie
  //   we_pay_partner  = partner verwees klant naar ons   → partner verdient commissie
  const weReferredDeals = deals.filter((d) => d.direction === 'partner_pays_us')
  const partnerReferredDeals = deals.filter((d) => d.direction !== 'partner_pays_us')
  const weReferredIds = new Set(weReferredDeals.map((d) => d.id))
  const partnerReferredIds = new Set(partnerReferredDeals.map((d) => d.id))

  const revenueWeReferred = sum(sales.filter((s) => weReferredIds.has(s.deal_id)).map((s) => Number(s.sale_amount)))
  const revenuePartnerReferred = sum(sales.filter((s) => partnerReferredIds.has(s.deal_id)).map((s) => Number(s.sale_amount)))
  const commissionWeEarned = sum(sales.filter((s) => weReferredIds.has(s.deal_id)).map((s) => Number(s.commission_amount)))
  const commissionPartnerEarned = sum(sales.filter((s) => partnerReferredIds.has(s.deal_id)).map((s) => Number(s.commission_amount)))

  // Onderaanneming = ledgerposten met kind payout_owed (wij → partner) of
  // service_billed (partner → ons). Vast bedrag, nooit commissie.
  const subToPartner = liveLedger.filter((l) => l.kind === 'payout_owed')
  const subByPartner = liveLedger.filter((l) => l.kind === 'service_billed')

  return {
    grossToPartner, grossByPartner, paidToPartner, paidByPartner,
    openToPartner, openByPartner, net,
    clientsWeReferred: weReferredDeals.length,
    clientsPartnerReferred: partnerReferredDeals.length,
    revenueWeReferred, revenuePartnerReferred,
    commissionWeEarned, commissionPartnerEarned,
    subToPartnerCount: subToPartner.length,
    subToPartnerTotal: sum(subToPartner.map((l) => Math.abs(Number(l.amount)))),
    subByPartnerCount: subByPartner.length,
    subByPartnerTotal: sum(subByPartner.map((l) => Math.abs(Number(l.amount)))),
  }
}
