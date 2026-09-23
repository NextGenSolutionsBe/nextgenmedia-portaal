// Personeel — het managementdashboard, puur berekend uit sessies, planning en
// tarieven. Eén functie voor de kaarten, de tabellen én de export, zodat alles
// altijd dezelfde cijfers toont.
//
// Definities (altijd excl. btw):
//  · werkelijk gewerkt  = sessies die niet afgekeurd zijn (actief telt mee tot nu)
//  · goedgekeurd        = sessies met status goedgekeurd
//  · gepland            = niet-geannuleerde werkblokken
//  · werkelijke kost    = goedgekeurde uren (vastgelegde kostprijs) + dag/maand/eenmalig
//  · voorlopige kost    = wat ingediende uren er bovenop zouden brengen
//  · verwachte kost     = ingeplande uren tegen het tarief van die dag

import { dagBrussel, gewerkteMinuten, maandenIn, type Pauze } from './tijd'
import { periodeKost, rond2, tariefOp, variabelPerUur, type Tarief, type Werkstuk } from './kost'
import { blokMinuten } from './planning'
import { verschil } from './kostenposten'

export type DMedewerker = { id: string; naam: string; type: string; actief: boolean; functie?: string | null }
export type DSessie = { id: string; personeel_id: string; start_at: string; eind_at: string | null; pauzes: Pauze[] | null; status: string; client_id: string | null; project: string | null; kost_bedrag: number | null }
export type DPlanning = { id: string; personeel_id: string; datum: string; start_tijd: string; eind_tijd: string; status: string; client_id: string | null; project: string | null }

export type DashboardFilters = { personeel_id?: string; type?: string; client_id?: string; project?: string; status?: string }

export type Rij = { sleutel: string; label: string; uren: number; goedgekeurd: number; gepland: number; kostWerkelijk: number; kostVerwacht: number; kostVoorlopig: number }
export type Dashboard = {
  kaarten: {
    gewerktUren: number; goedgekeurdUren: number; geplandUren: number
    kostWerkelijk: number; kostVerwacht: number; kostVoorlopig: number
    teControlerenAantal: number; teControlerenUren: number
    verschilUren: number; verschilKost: number; verschilPct: number | null
    urenZonderTarief: number
  }
  perMedewerker: Rij[]
  perProject: Rij[]
  perKlant: Rij[]
  perMaand: Rij[]
  perType: Rij[]
}

const uur = (m: number) => rond2(m / 60)
const TE_CONTROLEREN = ['ingediend', 'correctie_gevraagd']

export function bouwDashboard(input: {
  medewerkers: DMedewerker[]
  tarieven: Map<string, Tarief[]>
  sessies: DSessie[]
  planning: DPlanning[]
  periode: { van: string; tot: string }
  filters?: DashboardFilters
  klantNaam?: (id: string | null) => string
  nu?: Date
}): Dashboard {
  const { periode, filters = {}, nu = new Date() } = input
  const klantNaam = input.klantNaam ?? ((id) => (id ? id : 'Geen klant'))
  const mw = new Map(input.medewerkers.map((m) => [m.id, m]))
  const pastMedewerker = (pid: string) => {
    const m = mw.get(pid)
    if (!m) return false
    if (filters.personeel_id && filters.personeel_id !== pid) return false
    if (filters.type && filters.type !== m.type) return false
    return true
  }
  const pastProject = (x: { client_id: string | null; project: string | null }) =>
    (!filters.client_id || x.client_id === filters.client_id) && (!filters.project || (x.project ?? '').toLowerCase().includes(filters.project.toLowerCase()))

  const sessies = input.sessies.filter((s) => {
    const dag = dagBrussel(s.start_at)
    return dag >= periode.van && dag <= periode.tot && pastMedewerker(s.personeel_id) && pastProject(s) && (!filters.status || s.status === filters.status)
  })
  const planning = input.planning.filter((p) => p.datum >= periode.van && p.datum <= periode.tot && p.status !== 'geannuleerd' && pastMedewerker(p.personeel_id) && pastProject(p))

  // Groepen om te vullen
  const groepen = { medewerker: new Map<string, Rij>(), project: new Map<string, Rij>(), klant: new Map<string, Rij>(), maand: new Map<string, Rij>(), type: new Map<string, Rij>() }
  const rij = (g: Map<string, Rij>, sleutel: string, label: string) => {
    let r = g.get(sleutel)
    if (!r) { r = { sleutel, label, uren: 0, goedgekeurd: 0, gepland: 0, kostWerkelijk: 0, kostVerwacht: 0, kostVoorlopig: 0 }; g.set(sleutel, r) }
    return r
  }
  const overal = (pid: string, x: { client_id: string | null; project: string | null }, maand: string, fn: (r: Rij) => void) => {
    const m = mw.get(pid)!
    fn(rij(groepen.medewerker, pid, m.naam))
    fn(rij(groepen.project, x.project?.trim() || '—', x.project?.trim() || 'Geen project'))
    fn(rij(groepen.klant, x.client_id ?? '—', klantNaam(x.client_id)))
    fn(rij(groepen.maand, maand, maand))
    fn(rij(groepen.type, m.type, m.type))
  }

  let gewerkt = 0, goedgekeurd = 0, gepland = 0, teControlerenAantal = 0, teControlerenMin = 0

  // Werkstukken per medewerker voor de kostberekening
  const definitief = new Map<string, Werkstuk[]>()
  const metIngediend = new Map<string, Werkstuk[]>()
  const verwachtWerk = new Map<string, Werkstuk[]>()
  const push = (m: Map<string, Werkstuk[]>, pid: string, w: Werkstuk) => { const l = m.get(pid) ?? []; l.push(w); m.set(pid, l) }

  for (const s of sessies) {
    if (s.status === 'afgekeurd') continue
    const min = gewerkteMinuten(s, nu)
    const dag = dagBrussel(s.start_at)
    gewerkt += min
    overal(s.personeel_id, s, dag.slice(0, 7), (r) => { r.uren += min })
    if (s.status === 'goedgekeurd') {
      goedgekeurd += min
      const w: Werkstuk = { dag, minuten: min, vasteKost: s.kost_bedrag === null ? null : Number(s.kost_bedrag), client_id: s.client_id, project: s.project }
      push(definitief, s.personeel_id, w); push(metIngediend, s.personeel_id, w)
      overal(s.personeel_id, s, dag.slice(0, 7), (r) => { r.goedgekeurd += min; r.kostWerkelijk += w.vasteKost ?? 0 })
    }
    if (TE_CONTROLEREN.includes(s.status)) {
      teControlerenAantal++; teControlerenMin += min
      const t = tariefOp(input.tarieven.get(s.personeel_id) ?? [], dag)
      const w: Werkstuk = { dag, minuten: min, client_id: s.client_id, project: s.project }
      push(metIngediend, s.personeel_id, w)
      const deel = t ? variabelPerUur(t) * (min / 60) : 0
      overal(s.personeel_id, s, dag.slice(0, 7), (r) => { r.kostVoorlopig += deel })
    }
  }

  for (const p of planning) {
    const min = blokMinuten(p)
    gepland += min
    const t = tariefOp(input.tarieven.get(p.personeel_id) ?? [], p.datum)
    const deel = t ? variabelPerUur(t) * (min / 60) : 0
    push(verwachtWerk, p.personeel_id, { dag: p.datum, minuten: min, client_id: p.client_id, project: p.project })
    overal(p.personeel_id, p, p.datum.slice(0, 7), (r) => { r.gepland += min; r.kostVerwacht += deel })
  }

  // Totale kosten per medewerker via de volledige berekening (dag/maand/eenmalig inbegrepen).
  // Type- en maandrijen krijgen dezelfde volledige kost (niet enkel het uurdeel),
  // zodat elke tabel optelt tot de kaarten bovenaan.
  let kostWerkelijk = 0, kostVerwacht = 0, kostVoorlopig = 0, urenZonderTarief = 0
  for (const g of [groepen.type, groepen.maand]) for (const r of g.values()) { r.kostWerkelijk = 0; r.kostVerwacht = 0; r.kostVoorlopig = 0 }
  const maanden = maandenIn(periode.van, periode.tot)
  const alleIds = new Set([...definitief.keys(), ...metIngediend.keys(), ...verwachtWerk.keys()])
  for (const pid of alleIds) {
    const tt = input.tarieven.get(pid) ?? []
    for (const ym of maanden) {
      const deel = { van: `${ym}-01` < periode.van ? periode.van : `${ym}-01`, tot: `${ym}-31` > periode.tot ? periode.tot : `${ym}-31` }
      const d = periodeKost(tt, definitief.get(pid) ?? [], deel).totaal
      const i = periodeKost(tt, metIngediend.get(pid) ?? [], deel).totaal
      const vw = periodeKost(tt, verwachtWerk.get(pid) ?? [], deel).totaal
      if (d || i || vw) { const r = rij(groepen.maand, ym, ym); r.kostWerkelijk += d; r.kostVerwacht += vw; r.kostVoorlopig += Math.max(0, i - d) }
    }
    const t = input.tarieven.get(pid) ?? []
    const def = periodeKost(t, definitief.get(pid) ?? [], periode)
    const inc = periodeKost(t, metIngediend.get(pid) ?? [], periode)
    const ver = periodeKost(t, verwachtWerk.get(pid) ?? [], periode)
    kostWerkelijk += def.totaal; kostVerwacht += ver.totaal; kostVoorlopig += Math.max(0, inc.totaal - def.totaal)
    urenZonderTarief += inc.urenZonderTarief + ver.urenZonderTarief
    // Vaste kosten (dag/maand/eenmalig) horen bij de medewerker, niet bij een project.
    const r = groepen.medewerker.get(pid)
    if (r) { r.kostWerkelijk = def.totaal; r.kostVerwacht = ver.totaal; r.kostVoorlopig = Math.max(0, inc.totaal - def.totaal) }
    const m = mw.get(pid)
    if (m) { const tr = rij(groepen.type, m.type, m.type); tr.kostWerkelijk += def.totaal; tr.kostVerwacht += ver.totaal; tr.kostVoorlopig += Math.max(0, inc.totaal - def.totaal) }
  }
  // Wat niet aan een project toe te wijzen is, apart tonen zodat de som klopt.
  const projectSom = [...groepen.project.values()].reduce((s, r) => s + r.kostWerkelijk, 0)
  const vast = kostWerkelijk - projectSom
  if (vast > 0.005) {
    rij(groepen.project, '__vast__', 'Vaste kosten (niet per project)').kostWerkelijk += vast
    rij(groepen.klant, '__vast__', 'Vaste kosten (niet per klant)').kostWerkelijk += vast
  }

  const af = (g: Map<string, Rij>, sorteer: (a: Rij, b: Rij) => number) => [...g.values()].map((r) => ({
    ...r, uren: uur(r.uren), goedgekeurd: uur(r.goedgekeurd), gepland: uur(r.gepland),
    kostWerkelijk: rond2(r.kostWerkelijk), kostVerwacht: rond2(r.kostVerwacht), kostVoorlopig: rond2(r.kostVoorlopig),
  })).sort(sorteer)
  const opKost = (a: Rij, b: Rij) => b.kostWerkelijk - a.kostWerkelijk || b.uren - a.uren || a.label.localeCompare(b.label, 'nl')
  const v = verschil(kostVerwacht, kostWerkelijk)

  // Elke maand van de periode tonen, ook zonder activiteit.
  for (const m of maandenIn(periode.van, periode.tot)) rij(groepen.maand, m, m)

  return {
    kaarten: {
      gewerktUren: uur(gewerkt), goedgekeurdUren: uur(goedgekeurd), geplandUren: uur(gepland),
      kostWerkelijk: rond2(kostWerkelijk), kostVerwacht: rond2(kostVerwacht), kostVoorlopig: rond2(kostVoorlopig),
      teControlerenAantal, teControlerenUren: uur(teControlerenMin),
      verschilUren: rond2(uur(goedgekeurd) - uur(gepland)), verschilKost: v.bedrag, verschilPct: v.pct,
      urenZonderTarief: rond2(urenZonderTarief),
    },
    perMedewerker: af(groepen.medewerker, opKost),
    perProject: af(groepen.project, opKost),
    perKlant: af(groepen.klant, opKost),
    perMaand: af(groepen.maand, (a, b) => a.sleutel.localeCompare(b.sleutel)),
    perType: af(groepen.type, opKost),
  }
}

/** Financiële velden weghalen voor wie geen rechten op Financiën heeft. */
export function zonderKosten(d: Dashboard): Dashboard {
  const leeg = (r: Rij): Rij => ({ ...r, kostWerkelijk: 0, kostVerwacht: 0, kostVoorlopig: 0 })
  return {
    kaarten: { ...d.kaarten, kostWerkelijk: 0, kostVerwacht: 0, kostVoorlopig: 0, verschilKost: 0, verschilPct: null },
    perMedewerker: d.perMedewerker.map(leeg), perProject: d.perProject.filter((r) => r.sleutel !== '__vast__').map(leeg),
    perKlant: d.perKlant.filter((r) => r.sleutel !== '__vast__').map(leeg), perMaand: d.perMaand.map(leeg), perType: d.perType.map(leeg),
  }
}
