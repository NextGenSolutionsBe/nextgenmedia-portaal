import 'server-only'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { leesFactuurnummer, volgendFactuurnummer, zelfdeFactuurnummer } from './factuurnummer'

/**
 * Externe factuurnummers: het volgende voorstellen en dubbels tegenhouden.
 * Bron = alle nummers op facturen én op maanden van terugkerende facturatie.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export const jaarBrussel = (): number => Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }).slice(0, 4))

type Gebruik = { nummer: string; waar: string; invoice_id?: string; recurring_id?: string; maand?: string }

/** Alle nummers van dit jaar (en waar ze staan). */
async function nummersVan(admin: Admin, jaar: number): Promise<Gebruik[]> {
  const patroon = `${jaar}-%`
  const [{ data: fact }, { data: maanden }] = await Promise.all([
    admin.from('invoices').select('id, extern_factuurnummer, description, invoice_date, client_id, status').like('extern_factuurnummer', patroon).limit(5000),
    admin.from('recurring_invoice_months').select('recurring_id, month, extern_factuurnummer').like('extern_factuurnummer', patroon).limit(5000),
  ])
  const uit: Gebruik[] = []
  for (const f of (fact ?? []) as { id: string; extern_factuurnummer: string; description: string | null; invoice_date: string | null; status: string | null }[]) {
    if (f.status === 'geannuleerd') continue
    uit.push({ nummer: f.extern_factuurnummer, waar: `${f.description ?? 'factuur'}${f.invoice_date ? ` (${String(f.invoice_date).slice(0, 10).split('-').reverse().join('/')})` : ''}`, invoice_id: f.id })
  }
  for (const m of (maanden ?? []) as { recurring_id: string; month: string; extern_factuurnummer: string }[]) {
    uit.push({ nummer: m.extern_factuurnummer, waar: `maandfactuur ${m.month}`, recurring_id: m.recurring_id, maand: m.month })
  }
  return uit
}

/** Het volgende externe factuurnummer (dit jaar, Brusselse tijd). */
export async function volgendNummer(admin: Admin): Promise<{ nummer: string; laatste: string | null }> {
  const jaar = jaarBrussel()
  const [gebruikt, inst] = await Promise.all([nummersVan(admin, jaar), leesInstellingen()])
  const nummer = volgendFactuurnummer(gebruikt.map((g) => g.nummer), jaar, inst.facturatie.factuurnummer_vanaf || null)
  const hoogste = gebruikt.map((g) => leesFactuurnummer(g.nummer)).filter((x): x is { jaar: number; volgnr: number } => !!x && x.jaar === jaar).sort((a, b) => b.volgnr - a.volgnr)[0]
  return { nummer, laatste: hoogste ? `${hoogste.jaar}-${String(hoogste.volgnr).padStart(3, '0')}` : null }
}

/**
 * Staat dit nummer al op een ander item? Geeft een korte omschrijving terug
 * (voor de foutmelding), of null. Het item zelf telt niet.
 */
export async function nummerAlGebruikt(admin: Admin, nummer: string | null | undefined, zelf: { invoice_id?: string; recurring_id?: string; maand?: string }): Promise<string | null> {
  if (!nummer) return null
  const n = leesFactuurnummer(nummer)
  if (!n) return null
  const gebruikt = await nummersVan(admin, n.jaar)
  const ander = gebruikt.find((g) => zelfdeFactuurnummer(g.nummer, nummer)
    && !(zelf.invoice_id && g.invoice_id === zelf.invoice_id)
    && !(zelf.recurring_id && g.recurring_id === zelf.recurring_id && g.maand === zelf.maand))
  return ander ? ander.waar : null
}
