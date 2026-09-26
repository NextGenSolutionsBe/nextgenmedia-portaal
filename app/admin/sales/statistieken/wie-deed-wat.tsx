import { Users } from 'lucide-react'
import { createAdminSupabaseClient, getSessionUser, getUserRole } from '@/lib/supabase/server'
import { leesActorNamen, leesActorNamenOpEmail } from '@/lib/actor-namen'
import { formatEuro } from '@/lib/utils'
import { KaartTabel } from '@/components/ui/kaart-tabel'

type Teller = { contracten: number; getekend: number; facturen: number; gefactureerd: number; klanten: number; opdrachten: number; kosten: number }
const LEEG = (): Teller => ({ contracten: 0, getekend: 0, facturen: 0, gefactureerd: 0, klanten: 0, opdrachten: 0, kosten: 0 })

/**
 * Wie deed wat — per admin-account (Bram, Chiara, Marco): aangemaakte contracten,
 * getekende contracten, facturen (aantal en bedrag excl. btw), klanten,
 * opdrachten en gelogde kosten. Enkel zichtbaar voor admins: bevat bedragen.
 * Alles wat vroeger via het gedeelde info@-account gebeurde, staat apart.
 */
export async function WieDeedWat({ jaar }: { jaar?: number }) {
  const user = await getSessionUser()
  if (!user || (await getUserRole(user.id)) !== 'admin') return null
  const admin = createAdminSupabaseClient()
  const nu = new Date()
  const j = jaar ?? nu.getFullYear()
  const maand = `${j}-${String(nu.getMonth() + 1).padStart(2, '0')}`
  const vanJaar = `${j}-01-01`, totJaar = `${j + 1}-01-01`

  const [contracten, facturen, reeksen, klanten, opdrachten, kosten] = await Promise.all([
    admin.from('contracts').select('created_by, created_at, signed_at').gte('created_at', vanJaar).lt('created_at', totJaar),
    admin.from('invoices').select('created_by, created_at, amount_excl, status').gte('created_at', vanJaar).lt('created_at', totJaar),
    admin.from('recurring_invoices').select('created_by, created_at').gte('created_at', vanJaar).lt('created_at', totJaar),
    admin.from('clients').select('created_by, created_at').gte('created_at', vanJaar).lt('created_at', totJaar),
    admin.from('opdrachten').select('aangemaakt_door_email, created_at').gte('created_at', vanJaar).lt('created_at', totJaar),
    admin.from('cost_entries').select('created_by, created_at').gte('created_at', vanJaar).lt('created_at', totJaar),
  ])
  const ids = [
    ...(contracten.data ?? []), ...(facturen.data ?? []), ...(reeksen.data ?? []), ...(klanten.data ?? []), ...(kosten.data ?? []),
  ].map((r) => (r as { created_by: string | null }).created_by)
  const [namen, perMail] = await Promise.all([
    leesActorNamen(admin, ids),
    leesActorNamenOpEmail(admin, (opdrachten.data ?? []).map((r) => r.aangemaakt_door_email as string | null)),
  ])

  // Twee tellers per persoon: deze maand en dit jaar.
  const tel = new Map<string, { naam: string; gedeeld: boolean; maand: Teller; jaar: Teller }>()
  const voor = (sleutel: string | null | undefined, naam: string | undefined, gedeeld = false) => {
    const k = sleutel ?? 'onbekend'
    if (!tel.has(k)) tel.set(k, { naam: naam ?? 'Onbekend (vóór registratie)', gedeeld, maand: LEEG(), jaar: LEEG() })
    return tel.get(k)!
  }
  const opteller = (rij: { naam: string; gedeeld: boolean; maand: Teller; jaar: Teller }, datum: string | null | undefined, f: (t: Teller) => void) => {
    f(rij.jaar)
    if (datum && datum.slice(0, 7) === maand) f(rij.maand)
  }
  for (const c of contracten.data ?? []) {
    const n = c.created_by ? namen[c.created_by] : undefined
    const r = voor(c.created_by, n?.naam, n?.gedeeld)
    opteller(r, c.created_at, (t) => { t.contracten++ })
    if (c.signed_at) opteller(r, c.signed_at, (t) => { t.getekend++ })
  }
  for (const i of facturen.data ?? []) {
    const n = i.created_by ? namen[i.created_by] : undefined
    const r = voor(i.created_by, n?.naam, n?.gedeeld)
    if (i.status === 'geannuleerd') continue
    opteller(r, i.created_at, (t) => { t.facturen++; t.gefactureerd += Number(i.amount_excl) || 0 })
  }
  for (const i of reeksen.data ?? []) {
    const n = i.created_by ? namen[i.created_by] : undefined
    opteller(voor(i.created_by, n?.naam, n?.gedeeld), i.created_at, (t) => { t.facturen++ })
  }
  for (const k of klanten.data ?? []) {
    const u = (k as { created_by: string | null }).created_by
    const n = u ? namen[u] : undefined
    opteller(voor(u, n?.naam, n?.gedeeld), k.created_at, (t) => { t.klanten++ })
  }
  for (const k of kosten.data ?? []) {
    const n = k.created_by ? namen[k.created_by] : undefined
    opteller(voor(k.created_by, n?.naam, n?.gedeeld), k.created_at, (t) => { t.kosten++ })
  }
  for (const o of opdrachten.data ?? []) {
    const e = (o.aangemaakt_door_email as string | null)?.toLowerCase() ?? null
    const n = e ? perMail[e] : undefined
    opteller(voor(n?.id ?? e, n?.naam, n?.gedeeld), o.created_at, (t) => { t.opdrachten++ })
  }

  const rijen = [...tel.entries()]
    .filter(([, r]) => Object.values(r.jaar).some((v) => v > 0))
    .sort((a, b) => Number(a[1].gedeeld) - Number(b[1].gedeeld) || (a[0] === 'onbekend' ? 1 : 0) - (b[0] === 'onbekend' ? 1 : 0) || b[1].jaar.gefactureerd - a[1].jaar.gefactureerd)
  if (!rijen.length) return null
  const cel = (m: number, jr: number) => <span className="tabular-nums">{m}<span className="text-gray-400"> / {jr}</span></span>

  return (
    <div className="card-base">
      <h2 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4 text-gray-400" />Wie deed wat</h2>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">Per account: deze maand / heel {j}. Alleen voor admins zichtbaar.</p>
      <KaartTabel>
        <div className="table-wrap">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100">
              <th className="table-th">Account</th><th className="table-th text-right">Contracten</th><th className="table-th text-right">Getekend</th>
              <th className="table-th text-right">Facturen</th><th className="table-th text-right">Gefactureerd (excl.)</th>
              <th className="table-th text-right">Klanten</th><th className="table-th text-right">Opdrachten</th><th className="table-th text-right">Kosten gelogd</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rijen.map(([k, r]) => (
                <tr key={k} className={r.gedeeld ? 'text-gray-500' : ''}>
                  <td className="table-td font-medium">{r.naam}</td>
                  <td className="table-td text-right">{cel(r.maand.contracten, r.jaar.contracten)}</td>
                  <td className="table-td text-right">{cel(r.maand.getekend, r.jaar.getekend)}</td>
                  <td className="table-td text-right">{cel(r.maand.facturen, r.jaar.facturen)}</td>
                  <td className="table-td text-right tabular-nums">{formatEuro(r.maand.gefactureerd)}<span className="text-gray-400"> / {formatEuro(r.jaar.gefactureerd)}</span></td>
                  <td className="table-td text-right">{cel(r.maand.klanten, r.jaar.klanten)}</td>
                  <td className="table-td text-right">{cel(r.maand.opdrachten, r.jaar.opdrachten)}</td>
                  <td className="table-td text-right">{cel(r.maand.kosten, r.jaar.kosten)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </KaartTabel>
    </div>
  )
}
