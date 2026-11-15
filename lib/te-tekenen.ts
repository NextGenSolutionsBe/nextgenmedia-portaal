// Nog te tekenen — pure regels (client-safe, getest in tests/te-tekenen.test.ts).
//
// Alles waar iemand van ons nog moet tekenen staat als taak in het Command
// Center (blok Taken), bij wie het moet doen: de regels (vesting, uitgaven
// vennoten), de vestingkaarten, het akkoord per uitgave, en contracten die de
// klant tekende en wij nog niet. Een contract tegentekenen staat bij de
// verantwoordelijke van dat contract (gezamenlijk of nog niemand: bij Marco én Bram).
// Afgeleid uit de gegevens zelf: wie tekent, ziet de taak vanzelf verdwijnen.

import { wieTekentTegen, contractVerantwoordelijke, type Tegentekenaar } from './contracten/verantwoordelijke'

export type TeTekenenSoort = 'regels_vesting' | 'regels_vennoten' | 'vesting' | 'uitgaven' | 'tegentekenen'
export type TeTekenenItem = {
  id: string
  soort: TeTekenenSoort
  wat: string
  sub: string | null
  href: string
  /** Voornamen van wie dit nog moet doen (Marco, Bram, Chiara). */
  voor: string[]
  dringend: boolean
  /** Bij tegentekenen: de contracten zelf. */
  lijst?: { id: string; titel: string; sub: string | null; href: string }[]
}

export const voornaam = (naam: string | null | undefined) => String(naam ?? '').trim().split(/\s+/)[0] ?? ''

const meervoud = (n: number, een: string, meer: string) => `${n} ${n === 1 ? een : meer}`
const dag = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })
const DRIE_DAGEN = 3 * 86_400_000

export type TegentekenContract = { id: string; titel: string; klant: string | null; signed_at: string | null; verantwoordelijke: string | null }

/**
 * Contracten tegentekenen, per persoon één taak met de lijst eronder. Volgorde
 * zoals het Command Center: recentste eerst. De link opent het eerste contract
 * en "Ondertekenen en volgende" blijft bij de contracten van die persoon (?van=).
 */
export function tegentekenTaken(contracten: TegentekenContract[], nu = new Date()): TeTekenenItem[] {
  const per = new Map<Tegentekenaar, TegentekenContract[]>()
  const gesorteerd = [...contracten].sort((a, b) => String(b.signed_at ?? '').localeCompare(String(a.signed_at ?? '')) || a.id.localeCompare(b.id))
  for (const c of gesorteerd) for (const p of wieTekentTegen(c.verantwoordelijke)) per.set(p, [...(per.get(p) ?? []), c])
  const uit: TeTekenenItem[] = []
  for (const p of ['Marco', 'Bram'] as const) {
    const lijst = per.get(p) ?? []
    if (!lijst.length) continue
    const zonder = lijst.filter((c) => !contractVerantwoordelijke(c.verantwoordelijke)).length
    const oud = lijst.filter((c) => c.signed_at && nu.getTime() - new Date(c.signed_at).getTime() > DRIE_DAGEN).length
    uit.push({
      id: `tegentekenen:${p}`, soort: 'tegentekenen', voor: [p],
      wat: `${meervoud(lijst.length, 'contract', 'contracten')} tegentekenen`,
      sub: [oud ? `${oud} al langer dan 3 dagen getekend door de klant` : null, zonder ? `${zonder} nog zonder verantwoordelijke` : null].filter(Boolean).join(' · ') || null,
      href: `/admin/contracts/${lijst[0].id}/tegentekenen?van=${p}`,
      dringend: oud > 0,
      lijst: lijst.map((c) => {
        const v = contractVerantwoordelijke(c.verantwoordelijke)
        return {
          id: c.id, titel: [c.klant, c.titel].filter(Boolean).join(' – '),
          sub: [c.signed_at ? `klant tekende ${dag(c.signed_at)}` : null, !v ? 'nog geen verantwoordelijke' : v === 'Gezamenlijke lead' ? 'gezamenlijke lead' : null].filter(Boolean).join(' · ') || null,
          href: `/admin/contracts/${c.id}/tegentekenen?van=${p}`,
        }
      }),
    })
  }
  return uit
}

/** Welke contracten horen bij "?van=Bram" in de tegentekenronde? Die van Bram, plus gezamenlijk en zonder verantwoordelijke. */
export function hoortBij(van: string | null | undefined, verantwoordelijke: string | null | undefined): boolean {
  const p = van === 'Marco' || van === 'Bram' ? van : null
  if (!p) return true
  return wieTekentTegen(verantwoordelijke).includes(p)
}

/** Filter van het Taken-blok: staat deze taak bij die persoon (voornaam)? */
export function isVoor(item: Pick<TeTekenenItem, 'voor'>, persoon: string | null | undefined): boolean {
  const v = voornaam(persoon).toLowerCase()
  return !!v && item.voor.some((x) => x.toLowerCase() === v)
}
