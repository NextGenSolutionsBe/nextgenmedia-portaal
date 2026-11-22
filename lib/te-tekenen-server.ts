import 'server-only'
import { VENNOTEN, VENNOTEN_SLEUTEL, leesVennoten, type Vennoot } from '@/lib/vesting-akkoord'
import { tekenStandVoor } from '@/lib/regels-akkoord'
import { laadVestingRegels } from '@/lib/vesting-regels-server'
import { laadVestingData } from '@/lib/vesting-data-server'
import { laadVennotenData } from '@/lib/vennoot-uitgaven-server'
import { openAkkoorden, openAkkoordenTekst, tekenStand } from '@/lib/vennoot-uitgaven'
import { algemeneTaken, tegentekenTaken, voornaam, type AlgemeenTeTekenen, type TeTekenenItem, type TegentekenContract } from '@/lib/te-tekenen'

import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { KLANT_TEKENDE_IN_APP } from '@/lib/contracten/tegenhandtekening'

type Admin = ReturnType<typeof createAdminSupabaseClient>

const meervoud = (n: number, een: string, meer: string) => `${n} ${n === 1 ? een : meer}`

async function veilig<T>(naam: string, f: () => Promise<T>, leeg: T): Promise<T> {
  try { return await f() } catch (e) { console.warn(`[te-tekenen] ${naam}:`, e instanceof Error ? e.message : e); return leeg }
}

/**
 * Alles wat nog op een handtekening (of akkoord) van iemand van ons wacht, als
 * taken voor het Command Center. Elk deel apart: lukt er één niet, dan tonen we de rest.
 */
export async function teTekenenOverzicht(admin: Admin): Promise<TeTekenenItem[]> {
  const { data: rij } = await admin.from('app_settings').select('value').eq('key', VENNOTEN_SLEUTEL).maybeSingle()
  const inst = leesVennoten((rij as { value?: unknown } | null)?.value)
  const wie = (k: Vennoot) => voornaam(inst[k].naam) || k.charAt(0).toUpperCase() + k.slice(1)

  const [regelsVesting, vennoten, vesting, tegen, algemeen] = await Promise.all([
    veilig('regels vesting', async (): Promise<TeTekenenItem[]> => {
      const d = await laadVestingRegels(admin, null)
      if (!d.versie) return []
      const stand = tekenStandVoor('vesting', d.versie, d.handtekeningen)
      const nog = VENNOTEN.filter((k) => !stand[k]).map(wie)
      if (!nog.length) return []
      return [{ id: `regels_vesting:${d.versie.versie}`, soort: 'regels_vesting', wat: `Regels vesting tekenen (versie ${d.versie.versie})`, sub: `nog te tekenen door ${nog.join(', ')}`, href: '/admin/vesting?regels=1', voor: nog, dringend: false }]
    }, []),
    veilig('uitgaven vennoten', async (): Promise<TeTekenenItem[]> => {
      const d = await laadVennotenData(admin, null)
      const uit: TeTekenenItem[] = []
      if (d.regels) {
        const stand = tekenStand(d.regels, d.handtekeningen)
        const nog = VENNOTEN.filter((k) => !stand[k]).map(wie)
        if (nog.length) uit.push({ id: `regels_vennoten:${d.regels.versie}`, soort: 'regels_vennoten', wat: `Regels uitgaven vennoten tekenen (versie ${d.regels.versie})`, sub: `nog te tekenen door ${nog.join(', ')}`, href: '/admin/vennoten?regels=1', voor: nog, dringend: false })
      }
      for (const k of VENNOTEN) {
        const open = openAkkoorden(d, k)
        if (open.totaal) uit.push({ id: `uitgaven:${k}`, soort: 'uitgaven', wat: `Uitgaven vennoten: akkoord op ${openAkkoordenTekst(open)}`, sub: null, href: '/admin/vennoten?akkoord=1', voor: [wie(k)], dringend: false })
      }
      return uit
    }, []),
    veilig('vesting', async (): Promise<TeTekenenItem[]> => {
      const data = await laadVestingData(admin)
      const uit: TeTekenenItem[] = []
      for (const k of VENNOTEN) {
        const contracten = Array.from(data.akkoordContract.values()).filter((a) => a.stand.per[k].stand !== 'getekend').length
        const overige = Array.from(data.akkoordRegistratie.values()).filter((a) => a.stand.per[k].stand !== 'getekend').length
        if (!contracten && !overige) continue
        const delen = [contracten ? meervoud(contracten, 'contract', 'contracten') : null, overige ? meervoud(overige, 'inkomst of kost', 'inkomsten en kosten') : null].filter(Boolean).join(' en ')
        uit.push({ id: `vesting:${k}`, soort: 'vesting', wat: `Vesting tekenen: ${delen}`, sub: null, href: '/admin/vesting?tekenen=1', voor: [wie(k)], dringend: false })
      }
      return uit
    }, []),
    veilig('tegentekenen', async (): Promise<TeTekenenItem[]> => {
      // Enkel wat de klant in de app tekende (KLANT_TEKENDE_IN_APP), niet wat handmatig op getekend kwam.
      const { data, error } = await admin.from('contracts').select(`id, title, client_id, signed_at, ${KLANT_TEKENDE_IN_APP}`)
        .in('status', ['signed', 'getekend']).is('tegengetekend_op', null).order('signed_at', { ascending: false, nullsFirst: false }).limit(500)
      if (error) throw new Error(error.message)
      const rijen = (data ?? []) as { id: string; title: string | null; client_id: string | null; signed_at: string | null }[]
      if (!rijen.length) return []
      const klantIds = Array.from(new Set(rijen.map((r) => r.client_id).filter(Boolean))) as string[]
      const [{ data: klanten }, { data: kaarten }] = await Promise.all([
        klantIds.length ? admin.from('clients').select('id, company_name').in('id', klantIds) : Promise.resolve({ data: [] }),
        admin.from('opdrachten').select('contract_id, verantwoordelijke').in('contract_id', rijen.map((r) => r.id)),
      ])
      const klant = new Map(((klanten ?? []) as { id: string; company_name: string | null }[]).map((k) => [k.id, k.company_name]))
      const verantw = new Map(((kaarten ?? []) as { contract_id: string; verantwoordelijke: string | null }[]).map((k) => [k.contract_id, k.verantwoordelijke]))
      const lijst: TegentekenContract[] = rijen
        .map((r) => ({ id: r.id, titel: String(r.title ?? 'Contract'), klant: r.client_id ? klant.get(r.client_id) ?? null : null, signed_at: r.signed_at, verantwoordelijke: verantw.get(r.id) ?? null }))
        .filter((c) => !/^test$/i.test(String(c.klant ?? '').trim()))
      return tegentekenTaken(lijst)
    }, []),
    // Algemene contracten (huur, verzekering, NDA …) die op onze handtekening wachten.
    veilig('algemeen', async (): Promise<TeTekenenItem[]> => {
      const { data, error } = await admin.from('algemene_contracten').select('id, titel, tegenpartij, created_at, ondertekenaar')
        .eq('ons_nodig', true).is('ons_getekend_op', null).is('gearchiveerd_op', null).limit(500)
      if (error) throw new Error(error.message)
      return algemeneTaken((data ?? []) as AlgemeenTeTekenen[])
    }, []),
  ])
  return [...tegen, ...algemeen, ...regelsVesting, ...vesting, ...vennoten]
}
