import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisFinancieel, laadTarieven, herboekMaand } from '@/lib/personeel/server'
import { magIk } from '@/lib/instellingen/laden'
import { periodeKost, tariefOp, type Werkstuk } from '@/lib/personeel/kost'
import { boekdatum } from '@/lib/personeel/kostenposten'
import { dagBrussel, gewerkteMinuten, maandenIn, plusDagen, type Pauze } from '@/lib/personeel/tijd'
import { blokMinuten } from '@/lib/personeel/planning'
import { dagOf, isUuid } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET ?van&tot — per medewerker en maand de drie soorten kost naast elkaar:
 * verwacht (planning), voorlopig (ingediend) en definitief (goedgekeurd), plus
 * wat er werkelijk in Financiën geboekt staat en alle eerdere versies.
 * Enkel met rechten op Financiën.
 */
export async function GET(req: NextRequest) {
  try {
    const g = await eisFinancieel(); if (!g.ok) return g.response
    const sp = req.nextUrl.searchParams
    const vandaag = dagBrussel(new Date())
    const van = dagOf(sp.get('van')) ?? `${vandaag.slice(0, 4)}-01-01`
    const tot = dagOf(sp.get('tot')) ?? boekdatum(vandaag.slice(0, 7))
    const maanden = maandenIn(van, tot)
    const [{ data: mensen }, { data: sessies }, { data: planning }, { data: posten }] = await Promise.all([
      g.admin.from('personeel').select('id, voornaam, achternaam, type').order('voornaam'),
      g.admin.from('personeel_sessies').select('id, personeel_id, start_at, eind_at, pauzes, status, kost_bedrag').in('status', ['goedgekeurd', 'ingediend', 'correctie_gevraagd']).gte('start_at', `${plusDagen(`${maanden[0]}-01`, -1)}T00:00:00Z`).lte('start_at', `${plusDagen(tot, 1)}T23:59:59Z`).limit(20000),
      g.admin.from('personeel_planning').select('personeel_id, datum, start_tijd, eind_tijd, status').neq('status', 'geannuleerd').gte('datum', `${maanden[0]}-01`).lte('datum', tot).limit(20000),
      g.admin.from('personeel_kostenposten').select('*').in('periode', maanden).order('versie', { ascending: false }),
    ])
    type S = { id: string; personeel_id: string; start_at: string; eind_at: string | null; pauzes: Pauze[] | null; status: string; kost_bedrag: number | null }
    const rijen: Record<string, unknown>[] = []
    for (const m of (mensen ?? []) as { id: string; voornaam: string; achternaam: string | null; type: string }[]) {
      const tarieven = await laadTarieven(g.admin, m.id)
      for (const ym of maanden) {
        const periode = { van: `${ym}-01`, tot: boekdatum(ym) }
        const def: Werkstuk[] = [], inc: Werkstuk[] = [], ver: Werkstuk[] = []
        const ids: string[] = []
        for (const s of ((sessies ?? []) as S[]).filter((x) => x.personeel_id === m.id)) {
          const dag = dagBrussel(s.start_at)
          if (dag.slice(0, 7) !== ym) continue
          const w: Werkstuk = { dag, minuten: gewerkteMinuten(s), vasteKost: s.status === 'goedgekeurd' && s.kost_bedrag !== null ? Number(s.kost_bedrag) : null, ref: s.id }
          if (s.status === 'goedgekeurd') { def.push(w); ids.push(s.id) }
          inc.push(w)
        }
        for (const p of ((planning ?? []) as { personeel_id: string; datum: string; start_tijd: string; eind_tijd: string }[]).filter((x) => x.personeel_id === m.id && x.datum.slice(0, 7) === ym)) {
          ver.push({ dag: p.datum, minuten: blokMinuten(p) })
        }
        const d = periodeKost(tarieven, def, periode), i = periodeKost(tarieven, inc, periode), v = periodeKost(tarieven, ver, periode)
        const versies = ((posten ?? []) as Record<string, unknown>[]).filter((p) => p.personeel_id === m.id && p.periode === ym)
        const actueel = versies.find((p) => p.actueel) ?? null
        if (!d.uren && !i.uren && !v.uren && !versies.length) continue
        rijen.push({
          personeel_id: m.id, naam: [m.voornaam, m.achternaam].filter(Boolean).join(' '), type: m.type, periode: ym,
          verwacht: v, voorlopig: { ...i, totaal: Math.max(0, Math.round((i.totaal - d.totaal) * 100) / 100) }, definitief: d,
          geboekt: actueel, versies, sessie_ids: ids,
          synchroon: actueel ? Math.abs(Number(actueel.bedrag) - d.totaal) < 0.005 : d.totaal === 0,
          tariefOntbreekt: !tariefOp(tarieven, periode.tot) && (d.urenZonderTarief > 0 || i.urenZonderTarief > 0 || v.urenZonderTarief > 0),
        })
      }
    }
    return NextResponse.json({ van, tot, rijen })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** POST { personeel_id, periode } — de definitieve kost van een maand opnieuw boeken (idempotent). */
export async function POST(req: NextRequest) {
  try {
    const g = await eisFinancieel(); if (!g.ok) return g.response
    if (!(await magIk('personeel', 'goedkeuren'))) return NextResponse.json({ error: 'Je mag geen kosten boeken.' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as { personeel_id?: string; periode?: string }
    if (!isUuid(b.personeel_id) || !/^\d{4}-\d{2}$/.test(b.periode ?? '')) return NextResponse.json({ error: 'Ongeldige medewerker of periode.' }, { status: 400 })
    const r = await herboekMaand(g.admin, b.personeel_id!, b.periode!, g.persoon.email, 'Handmatig opnieuw geboekt vanuit Personeel → Kosten')
    return NextResponse.json({ ok: true, ...r })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
