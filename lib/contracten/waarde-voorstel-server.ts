import 'server-only'
import { leesContractwaarde } from './waarde-ai'
import { euroKort, waardeUitGegevens, waardeUitOnderdelen, type WaardeVoorstel } from './waarde-voorstel'

/**
 * Voorstel voor de contractwaarde, bewaard op het contract
 * (contract_waarde_voorstel*). NOOIT in contract_waarde_excl: dat gebeurt
 * enkel als iemand het voorstel bevestigt in het Financieel overzicht.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: { from: (b: string) => any } }

export type BewaardVoorstel = { waarde: number; uitleg: string; bron: string; op: string }

export function voorstelVan(c: Record<string, unknown>): BewaardVoorstel | null {
  const w = c.contract_waarde_voorstel
  if (w === null || w === undefined || !(Number(w) > 0)) return null
  return { waarde: Number(w), uitleg: String(c.contract_waarde_voorstel_uitleg ?? ''), bron: String(c.contract_waarde_voorstel_bron ?? ''), op: String(c.contract_waarde_voorstel_op ?? '') }
}

const uitlegVan = (v: WaardeVoorstel): string => {
  const waar = v.bron === 'ai' ? 'gelezen in het contract' : v.bron === 'gegevens' ? 'volgens de contractgegevens in de app' : 'uit de ingevulde velden'
  return [`${v.berekening} = ${euroKort(v.waarde)} (${waar}).`, v.opmerking].filter(Boolean).join(' ')
}

/**
 * Maakt (of hergebruikt) het voorstel. Eerst de pdf via AI (de som rekenen we
 * zelf na), anders de gegevens in de app. Geen voorstel = { voorstel: null, reden }.
 */
export async function maakWaardeVoorstel(admin: Admin, contractId: string, opnieuw = false): Promise<{ voorstel: BewaardVoorstel | null; reden: string | null }> {
  const { data: c } = await admin.from('contracts').select('*').eq('id', contractId).maybeSingle()
  if (!c) throw new Error('Contract niet gevonden')
  const bestaand = voorstelVan(c)
  if (bestaand && !opnieuw) return { voorstel: bestaand, reden: null }

  let v: WaardeVoorstel | null = null
  let reden: string | null = null
  const pdf = (c.signed_pdf_path as string | null) || (c.pdf_path as string | null)
  if (pdf && process.env.ANTHROPIC_API_KEY) {
    try {
      const { data: file } = await admin.storage.from('contracts').download(pdf)
      if (file) {
        const ai = await leesContractwaarde(Buffer.from(await file.arrayBuffer()).toString('base64'))
        const som = waardeUitOnderdelen(ai.onderdelen)
        if (som) {
          const verschil = ai.totaal !== null && Math.abs(ai.totaal - som.waarde) > 0.01 ? `De AI kwam op ${euroKort(ai.totaal)}; nagerekend is het ${euroKort(som.waarde)}.` : null
          v = { waarde: som.waarde, berekening: som.berekening, bron: 'ai', citaat: ai.onderdelen[0]?.citaat ?? null, opmerking: [ai.opmerking, verschil].filter(Boolean).join(' ') || null }
        } else reden = ai.opmerking ?? 'In het contract staat geen duidelijk bedrag.'
      }
    } catch (e) { reden = e instanceof Error ? e.message : 'Het contract kon niet gelezen worden.' }
  }
  if (!v) v = waardeUitGegevens(c)
  if (!v) return { voorstel: null, reden: reden ?? 'Geen bedrag gevonden in het contract of de contractgegevens.' }

  const rij = { contract_waarde_voorstel: v.waarde, contract_waarde_voorstel_uitleg: uitlegVan(v).slice(0, 600), contract_waarde_voorstel_bron: v.bron, contract_waarde_voorstel_op: new Date().toISOString() }
  await admin.from('contracts').update(rij).eq('id', contractId)
  return { voorstel: { waarde: v.waarde, uitleg: rij.contract_waarde_voorstel_uitleg, bron: v.bron, op: rij.contract_waarde_voorstel_op }, reden: null }
}
