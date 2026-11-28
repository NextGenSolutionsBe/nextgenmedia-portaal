/**
 * Instellingen van de nieuwe werking (28 nov 2026, docs/nieuwe-werking-plan.md).
 * Eén sleutel in app_settings: `werking`. Elke waarde heeft een beginwaarde en
 * wordt hier nagekeken; ongeldig of leeg = de beginwaarde. Nooit een bedrag,
 * termijn of drempel vast in de code: altijd via `leesWerking`.
 * Pure regels (client-safe), getest in tests/werking-instellingen.test.ts.
 */

// ── Domeinen (fase 1) ───────────────────────────────────────────────────────

export const DOMEINEN = [
  { key: 'solutions', label: 'Solutions' },
  { key: 'media', label: 'Media' },
  { key: 'financien_legal', label: 'Financiën & legal' },
  { key: 'interne_werking', label: 'Interne werking' },
] as const
export type Domein = (typeof DOMEINEN)[number]['key']
export const isDomein = (v: unknown): v is Domein => DOMEINEN.some((d) => d.key === v)
export const domeinLabel = (k: string | null | undefined) => DOMEINEN.find((d) => d.key === k)?.label ?? 'Meerdere domeinen'

// ── Planning Media (fase 1) ─────────────────────────────────────────────────

export const WERK_SOORTEN = [
  { key: 'management', label: 'Management', uitleg: 'planning, strategie, kalender, ad-hoc, meetings' },
  { key: 'uitvoering', label: 'Uitvoering', uitleg: 'posts, montage, visuals, folders, branding' },
  { key: 'shoot', label: 'Shoots', uitleg: 'de shoot en de shootbriefing' },
] as const
export type WerkSoort = (typeof WERK_SOORTEN)[number]['key']
export const isWerkSoort = (v: unknown): v is WerkSoort => WERK_SOORTEN.some((s) => s.key === v)

// ── Alle groepen ────────────────────────────────────────────────────────────

export type WerkingInstellingen = {
  /** Eigenaar per domein (voornaam). Een beslissing binnen één domein neemt die persoon. */
  domeinen: Record<Domein, string>
  /** Het vaste moment van het weekoverleg (1 = maandag … 5 = vrijdag). `reeks_id` = het vaste blok in de agenda, als het er staat. */
  weekoverleg: { dag: number; van: string; duur_min: number; reeks_id: string | null }
  /** Wie standaard welk soort werk doet in Planning Media (voornaam). */
  planning: Record<WerkSoort, string>
  /** Verkoop bij Solutions (fase 2): auditprijs, opvolgritme, presentatie. */
  verkoop: {
    audit_basis: number; audit_per_proces: number; max_processen: number
    opvolg_dagen: number; presentatie_max_dagen: number; presentatie_min_per_proces: number
    /** Wie de auditdag doet en wie het rapport schrijft (voornaam). */
    auditdag_door: string; rapport_door: string
  }
  /** Prijs per workflow (fase 3): waarde voor de klant, nooit uren × tarief. De klant ziet nooit deze getallen. */
  prijzen: {
    weken: number; uurwaarde: number; min_uren: number; andere_uurprijs: number; afronding: number
    maten: Record<Maat, { van: number; tot: number | null; min: number; max: number | null }>
  }
  /** Levering per workflow (fase 4): bouwtermijn, nazorg en wie standaard bouwt (voornaam). */
  levering: { bouw_dagen: number; nazorg_weken: number; nazorg_call_min: number; verantwoordelijke: string }
  /** Care (fase 6): pakketten, werkuren voor de reactietijd en de prijs van een migratie. `bevestigd` = de zaakvoerders keurden de pakketten goed. */
  care: { pakketten: CarePakket[]; werkdag_van: string; werkdag_tot: string; migratie_vanaf: number; bevestigd: boolean }
  /** Media (fase 7): pakketten social media, Community management, losse foto en video, goedkeuring en looptijd. */
  media: MediaInstellingen
}

export const MEDIA_PAKKET_KEYS = ['klein', 'middel', 'groot'] as const
export type MediaPakketKey = (typeof MEDIA_PAKKET_KEYS)[number]
export type MediaPakket = { key: MediaPakketKey; naam: string; prijs: number; posts: number; reels: number; stories: number }
export type LosItem = { key: string; naam: string; prijs: number; eenheid: string; bevestigd: boolean }
export type MediaInstellingen = {
  pakketten: MediaPakket[]
  /** Bij elk pakket inbegrepen (één per regel op de offerte). */
  inbegrepen: string[]
  community_management: { naam: string; prijs: number; uitleg: string }
  losse_items: LosItem[]
  /** Dagen die de klant heeft om goed te keuren. */
  goedkeuring_dagen: number
  /** Aanpassingsrondes per post; daarna vraagt een ronde een bevestiging van het team. */
  rondes: number
  looptijd_eerste_maanden: number
  verlenging_maanden: number
  /** De contracttemplate voor het verlengingsgesprek (Contract uit template). */
  verlenging_template_id: string | null
}

export const CARE_PAKKET_KEYS = ['basis', 'plus', 'pro'] as const
export type CarePakketKey = (typeof CARE_PAKKET_KEYS)[number]
/** Eén Care-pakket. De reactietijd staat in werkuren (een werkdag = de werkuren van één dag). */
export type CarePakket = {
  key: CarePakketKey; naam: string; prijs: number; db_gb: number; bestanden_gb: number
  reactie_werkuren: number; uren_per_maand: number; monitoring: boolean; maandrapport: boolean
}

export const MATEN = [
  { key: 'klein', label: 'Klein' },
  { key: 'middel', label: 'Middel' },
  { key: 'groot', label: 'Groot' },
] as const
export type Maat = (typeof MATEN)[number]['key']
export const maatLabel = (m: string | null | undefined) => MATEN.find((x) => x.key === m)?.label ?? null

export const STANDAARD_WERKING: WerkingInstellingen = {
  domeinen: { solutions: 'Marco', media: 'Chiara', financien_legal: 'Bram', interne_werking: 'Marco' },
  weekoverleg: { dag: 5, van: '16:00', duur_min: 30, reeks_id: null },
  planning: { management: 'Chiara', uitvoering: 'Yasmine', shoot: 'Bram' },
  verkoop: { audit_basis: 450, audit_per_proces: 295, max_processen: 5, opvolg_dagen: 7, presentatie_max_dagen: 7, presentatie_min_per_proces: 10, auditdag_door: 'Marco', rapport_door: 'Jonathan' },
  prijzen: {
    weken: 24, uurwaarde: 35, min_uren: 3, andere_uurprijs: 125, afronding: 50,
    maten: {
      klein: { van: 3, tot: 5, min: 2500, max: 4200 },
      middel: { van: 5, tot: 10, min: 4200, max: 8400 },
      groot: { van: 10, tot: null, min: 8400, max: null },
    },
  },
  levering: { bouw_dagen: 14, nazorg_weken: 2, nazorg_call_min: 30, verantwoordelijke: 'Jonathan' },
  // Voorstel uit de opdracht van 28 nov 2026, nog te bevestigen (Nog te beslissen 3).
  care: {
    pakketten: [
      { key: 'basis', naam: 'Basis', prijs: 59, db_gb: 2, bestanden_gb: 10, reactie_werkuren: 16, uren_per_maand: 0, monitoring: false, maandrapport: false },
      { key: 'plus', naam: 'Plus', prijs: 149, db_gb: 5, bestanden_gb: 50, reactie_werkuren: 8, uren_per_maand: 1, monitoring: false, maandrapport: false },
      { key: 'pro', naam: 'Pro', prijs: 349, db_gb: 8, bestanden_gb: 100, reactie_werkuren: 4, uren_per_maand: 3, monitoring: true, maandrapport: true },
    ],
    werkdag_van: '09:00', werkdag_tot: '17:00', migratie_vanaf: 250, bevestigd: false,
  },
  // Uit de opdracht van 28 nov 2026. Video per uur is bevestigd; foto per uur en de halve dagen zijn een voorstel (Nog te beslissen 4).
  media: {
    pakketten: [
      { key: 'klein', naam: 'Klein', prijs: 595, posts: 4, reels: 0, stories: 0 },
      { key: 'middel', naam: 'Middel', prijs: 1195, posts: 6, reels: 2, stories: 2 },
      { key: 'groot', naam: 'Groot', prijs: 1495, posts: 10, reels: 4, stories: 4 },
    ],
    inbegrepen: ['Strategie', 'Scripts', 'Contentkalender', 'Eén shoot per kwartaal'],
    community_management: { naam: 'Community management', prijs: 195, uitleg: 'Reacties en berichten worden op werkdagen binnen 24 uur beantwoord.' },
    losse_items: [
      { key: 'video_uur', naam: 'Video: per uur shooten, montage inbegrepen', prijs: 300, eenheid: 'uur', bevestigd: true },
      { key: 'foto_uur', naam: 'Foto: per uur, nabewerking inbegrepen', prijs: 195, eenheid: 'uur', bevestigd: false },
      { key: 'video_halve_dag', naam: 'Video: halve dag', prijs: 1200, eenheid: 'halve dag', bevestigd: false },
      { key: 'foto_halve_dag', naam: 'Foto: halve dag', prijs: 780, eenheid: 'halve dag', bevestigd: false },
    ],
    goedkeuring_dagen: 7, rondes: 2, looptijd_eerste_maanden: 6, verlenging_maanden: 12, verlenging_template_id: null,
  },
}

// ── Nakijken ────────────────────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
/** Een voornaam of korte naam: hoogstens 40 tekens, enkel letters, spaties, streepjes. */
export function naamOf(v: unknown, std: string): string {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
  return t && /^[\p{L}][\p{L} .'-]*$/u.test(t) ? t : std
}
/** Een geheel getal binnen grenzen, anders de beginwaarde. */
export function getalOf(v: unknown, std: number, min: number, max: number): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : std
}
export function uurOf(v: unknown, std: string): string {
  const t = typeof v === 'string' ? v.trim() : ''
  const m = /^(\d{1,2})[:.u](\d{2})$/.exec(t)
  if (!m) return std
  const u = Number(m[1]), mi = Number(m[2])
  return u <= 23 && mi <= 59 ? `${String(u).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : std
}
const UUID = /^[0-9a-f-]{36}$/i

export function leesWerking(ruw: unknown): WerkingInstellingen {
  const r = obj(ruw)
  const S = STANDAARD_WERKING
  const dom = obj(r.domeinen), ov = obj(r.weekoverleg), pl = obj(r.planning), vk = obj(r.verkoop), pr = obj(r.prijzen), mt = obj(pr.maten)
  const V = S.verkoop, P = S.prijzen, L = S.levering, lv = obj(r.levering), C = S.care, cr = obj(r.care)
  const ruwePakketten = Array.isArray(cr.pakketten) ? (cr.pakketten as unknown[]) : []
  const pakket = (std: CarePakket): CarePakket => {
    const x = obj(ruwePakketten.find((p) => obj(p).key === std.key))
    const naam = typeof x.naam === 'string' && x.naam.trim() ? x.naam.replace(/\s+/g, ' ').trim().slice(0, 30) : std.naam
    return {
      key: std.key, naam,
      prijs: getalOf(x.prijs, std.prijs, 0, 100_000),
      db_gb: getalOf(x.db_gb, std.db_gb, 0, 10_000),
      bestanden_gb: getalOf(x.bestanden_gb, std.bestanden_gb, 0, 100_000),
      reactie_werkuren: getalOf(x.reactie_werkuren, std.reactie_werkuren, 1, 400),
      uren_per_maand: getalOf(x.uren_per_maand, std.uren_per_maand, 0, 200),
      monitoring: typeof x.monitoring === 'boolean' ? x.monitoring : std.monitoring,
      maandrapport: typeof x.maandrapport === 'boolean' ? x.maandrapport : std.maandrapport,
    }
  }
  const maat = (k: Maat) => {
    const x = obj(mt[k]), d = P.maten[k]
    const leegOf = (v: unknown, std: number | null) => (v === null || v === '' ? null : v === undefined ? std : getalOf(v, std ?? 0, 0, 10_000_000))
    return { van: getalOf(x.van, d.van, 0, 200), tot: leegOf(x.tot, d.tot), min: getalOf(x.min, d.min, 0, 10_000_000), max: leegOf(x.max, d.max) }
  }
  return {
    domeinen: Object.fromEntries(DOMEINEN.map((d) => [d.key, naamOf(dom[d.key], S.domeinen[d.key])])) as Record<Domein, string>,
    weekoverleg: {
      dag: getalOf(ov.dag, S.weekoverleg.dag, 1, 5),
      van: uurOf(ov.van, S.weekoverleg.van),
      duur_min: getalOf(ov.duur_min, S.weekoverleg.duur_min, 15, 180),
      reeks_id: typeof ov.reeks_id === 'string' && UUID.test(ov.reeks_id) ? ov.reeks_id : null,
    },
    planning: Object.fromEntries(WERK_SOORTEN.map((s) => [s.key, naamOf(pl[s.key], S.planning[s.key])])) as Record<WerkSoort, string>,
    verkoop: {
      audit_basis: getalOf(vk.audit_basis, V.audit_basis, 0, 100_000),
      audit_per_proces: getalOf(vk.audit_per_proces, V.audit_per_proces, 0, 100_000),
      max_processen: Math.round(getalOf(vk.max_processen, V.max_processen, 1, 20)),
      opvolg_dagen: Math.round(getalOf(vk.opvolg_dagen, V.opvolg_dagen, 1, 60)),
      presentatie_max_dagen: Math.round(getalOf(vk.presentatie_max_dagen, V.presentatie_max_dagen, 1, 60)),
      presentatie_min_per_proces: Math.round(getalOf(vk.presentatie_min_per_proces, V.presentatie_min_per_proces, 1, 120)),
      auditdag_door: naamOf(vk.auditdag_door, V.auditdag_door),
      rapport_door: naamOf(vk.rapport_door, V.rapport_door),
    },
    prijzen: {
      weken: getalOf(pr.weken, P.weken, 1, 104),
      uurwaarde: getalOf(pr.uurwaarde, P.uurwaarde, 1, 1000),
      min_uren: getalOf(pr.min_uren, P.min_uren, 0, 100),
      andere_uurprijs: getalOf(pr.andere_uurprijs, P.andere_uurprijs, 1, 10_000),
      afronding: getalOf(pr.afronding, P.afronding, 1, 10_000),
      maten: { klein: maat('klein'), middel: maat('middel'), groot: maat('groot') },
    },
    levering: {
      bouw_dagen: Math.round(getalOf(lv.bouw_dagen, L.bouw_dagen, 1, 120)),
      nazorg_weken: Math.round(getalOf(lv.nazorg_weken, L.nazorg_weken, 0, 26)),
      nazorg_call_min: Math.round(getalOf(lv.nazorg_call_min, L.nazorg_call_min, 5, 240)),
      verantwoordelijke: naamOf(lv.verantwoordelijke, L.verantwoordelijke),
    },
    media: (() => {
      const M = S.media, md = obj(r.media)
      const rp = Array.isArray(md.pakketten) ? (md.pakketten as unknown[]) : []
      const ri = Array.isArray(md.losse_items) ? (md.losse_items as unknown[]) : []
      const cm = obj(md.community_management)
      const tekst = (v: unknown, std: string, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : std)
      const inbegrepen = Array.isArray(md.inbegrepen) ? (md.inbegrepen as unknown[]).map((x) => String(x ?? '').trim().slice(0, 120)).filter(Boolean).slice(0, 12) : M.inbegrepen
      return {
        pakketten: M.pakketten.map((std) => {
          const x = obj(rp.find((p) => obj(p).key === std.key))
          return { key: std.key, naam: tekst(x.naam, std.naam, 30), prijs: getalOf(x.prijs, std.prijs, 0, 100_000), posts: Math.round(getalOf(x.posts, std.posts, 0, 200)), reels: Math.round(getalOf(x.reels, std.reels, 0, 200)), stories: Math.round(getalOf(x.stories, std.stories, 0, 200)) }
        }),
        inbegrepen: inbegrepen.length ? inbegrepen : M.inbegrepen,
        community_management: { naam: tekst(cm.naam, M.community_management.naam, 60), prijs: getalOf(cm.prijs, M.community_management.prijs, 0, 100_000), uitleg: tekst(cm.uitleg, M.community_management.uitleg, 300) },
        losse_items: M.losse_items.map((std) => {
          const x = obj(ri.find((p) => obj(p).key === std.key))
          return { key: std.key, naam: tekst(x.naam, std.naam, 80), prijs: getalOf(x.prijs, std.prijs, 0, 100_000), eenheid: tekst(x.eenheid, std.eenheid, 20), bevestigd: typeof x.bevestigd === 'boolean' ? x.bevestigd : std.bevestigd }
        }),
        goedkeuring_dagen: Math.round(getalOf(md.goedkeuring_dagen, M.goedkeuring_dagen, 1, 60)),
        rondes: Math.round(getalOf(md.rondes, M.rondes, 0, 10)),
        looptijd_eerste_maanden: Math.round(getalOf(md.looptijd_eerste_maanden, M.looptijd_eerste_maanden, 1, 60)),
        verlenging_maanden: Math.round(getalOf(md.verlenging_maanden, M.verlenging_maanden, 1, 60)),
        verlenging_template_id: typeof md.verlenging_template_id === 'string' && UUID.test(md.verlenging_template_id) ? md.verlenging_template_id : null,
      }
    })(),
    care: (() => {
      const van = uurOf(cr.werkdag_van, C.werkdag_van), tot = uurOf(cr.werkdag_tot, C.werkdag_tot)
      const goed = tot > van
      return {
        pakketten: C.pakketten.map(pakket),
        werkdag_van: goed ? van : C.werkdag_van, werkdag_tot: goed ? tot : C.werkdag_tot,
        migratie_vanaf: getalOf(cr.migratie_vanaf, C.migratie_vanaf, 0, 100_000),
        bevestigd: cr.bevestigd === true,
      }
    })(),
  }
}

/** Auditprijs bij Solutions: basis + prijs per proces (instellingen, nooit vast in de code). */
export function auditPrijs(processen: number, v: Pick<WerkingInstellingen['verkoop'], 'audit_basis' | 'audit_per_proces'>): number {
  return Math.round((v.audit_basis + v.audit_per_proces * processen) * 100) / 100
}

/** Wie is eigenaar van dit domein? Leeg of "meerdere" = niemand (stemming). */
export function eigenaarVanDomein(w: Pick<WerkingInstellingen, 'domeinen'>, domein: string | null | undefined): string | null {
  return isDomein(domein) ? w.domeinen[domein] : null
}

/** Is deze persoon (voornaam of volledige naam) de eigenaar? Hoofdletters en achternaam tellen niet. */
export function isEigenaar(eigenaar: string | null, naam: string | null | undefined): boolean {
  if (!eigenaar || !naam) return false
  const v = (s: string) => s.trim().split(/\s+/)[0].toLowerCase()
  return v(eigenaar) === v(naam)
}

/** Einde van het weekoverleg ("16:00" + 30 = "16:30"). */
export function eindUur(van: string, duur: number): string {
  const [u, m] = van.split(':').map(Number)
  const t = Math.min(23 * 60 + 59, u * 60 + m + duur)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** Loopt het weekoverleg nu? `dag` 1–7 (maandag = 1), `uur` "HH:MM", beide in Brussel. */
export function overlegLoopt(w: Pick<WerkingInstellingen, 'weekoverleg'>, dag: number, uur: string): boolean {
  if (!w.weekoverleg.reeks_id || dag !== w.weekoverleg.dag) return false
  return uur >= w.weekoverleg.van && uur < eindUur(w.weekoverleg.van, w.weekoverleg.duur_min)
}
