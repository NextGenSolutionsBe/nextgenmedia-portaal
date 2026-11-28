/**
 * Teamagenda (verbeterplan fase 3, 27 nov 2026): beschikbaarheid, capaciteit en "Bezet".
 * Pure regels, getest in tests/agenda-team.test.ts.
 */
import { plaatsVan, type Item } from './model'
import { weekdagVan } from './reeksen'

/** Wanneer iemand normaal werkt op een weekdag (1 = ma … 7 = zo), in Brusselse tijd. */
export type Beschikbaarheid = { persoon_id: string; weekdag: number; van: string; tot: string }
/** Een tijdstip dat iemand bezet is, zonder wat het is (privé of een lijst die je niet ziet). */
export type Bezet = { start_op: string; eind_op: string; personen: string[] }

const minVan = (u: string) => { const [h, m] = u.split(':').map(Number); return h * 60 + m }
const UUR = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/

/** Beschikbare minuten van een persoon over een reeks dagen. */
export function beschikbaarMinuten(lijst: Beschikbaarheid[], persoon: string, dagen: string[]): number {
  const per = new Map(lijst.filter((b) => b.persoon_id === persoon).map((b) => [b.weekdag, Math.max(0, minVan(b.tot) - minVan(b.van))]))
  return dagen.reduce((t, d) => t + (per.get(weekdagVan(d)) ?? 0), 0)
}

/** Geplande minuten: alles met een uur waar de persoon op staat (taken, meetings, vaste blokken, bezet). */
export function geplandMinuten(items: Pick<Item, 'start_op' | 'eind_op' | 'heel_dag' | 'deadline_op' | 'toegewezen'>[], persoon: string, dagen: string[], bezet: Bezet[] = []): number {
  const op = new Set(dagen)
  let t = 0
  for (const i of items) {
    if (!i.toegewezen.includes(persoon)) continue
    const p = plaatsVan(i)
    if (p?.soort === 'rooster' && op.has(p.dag)) t += p.totMin - p.vanMin
  }
  for (const b of bezet) {
    if (!b.personen.includes(persoon)) continue
    const p = plaatsVan({ start_op: b.start_op, eind_op: b.eind_op, heel_dag: false })
    if (p?.soort === 'rooster' && op.has(p.dag)) t += p.totMin - p.vanMin
  }
  return t
}

export type Capaciteit = { gepland: number; beschikbaar: number; vol: number | null; over: boolean }
/** Gepland tegenover beschikbaar. Zonder ingestelde beschikbaarheid: geen oordeel (`vol` null). */
export function capaciteit(gepland: number, beschikbaar: number): Capaciteit {
  if (beschikbaar <= 0) return { gepland, beschikbaar, vol: null, over: false }
  const vol = Math.round((gepland / beschikbaar) * 100)
  return { gepland, beschikbaar, vol, over: gepland > beschikbaar }
}

export const urenTekst = (min: number) => {
  const u = Math.floor(min / 60), m = min % 60
  return m ? `${u}u${String(m).padStart(2, '0')}` : `${u}u`
}

/** Invoer van de beschikbaarheid nakijken: per weekdag van–tot, of leeg (die dag niet). */
export function controleerBeschikbaarheid(b: unknown): { ok: true; dagen: { weekdag: number; van: string; tot: string }[] } | { ok: false; fout: string } {
  const lijst = Array.isArray(b) ? b : []
  const uit: { weekdag: number; van: string; tot: string }[] = []
  for (const r of lijst as Record<string, unknown>[]) {
    const weekdag = Number(r?.weekdag)
    if (!Number.isInteger(weekdag) || weekdag < 1 || weekdag > 7) continue
    const van = String(r.van ?? ''), tot = String(r.tot ?? '')
    if (!van && !tot) continue
    if (!UUR.test(van) || !UUR.test(tot)) return { ok: false, fout: 'Uren als 09:00.' }
    if (minVan(tot) <= minVan(van)) return { ok: false, fout: 'Het einde ligt na het begin.' }
    if (!uit.some((x) => x.weekdag === weekdag)) uit.push({ weekdag, van, tot })
  }
  return { ok: true, dagen: uit.sort((a, b) => a.weekdag - b.weekdag) }
}
