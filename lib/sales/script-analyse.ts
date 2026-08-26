// Analyse van een coldcallingscript: van platte tekst naar een belschermen-
// indeling — secties in het midden, bezwaren met reacties ernaast.
//
// De RUWE TEKST blijft altijd de bron. De analyse is een weergave die op elk
// moment opnieuw gemaakt kan worden; er gaat nooit inhoud verloren doordat de
// AI iets wegliet — het origineel staat er nog.
//
// De sanering (saneerAnalyse) staat bewust los van de AI-aanroep en is puur:
// wat een model teruggeeft is een bewering, geen feit. Limieten en types worden
// hier afgedwongen vóór er iets de database in gaat.

export type ScriptSectie = { kop: string; tekst: string }
export type ScriptBezwaar = { bezwaar: string; reactie: string }

export type ScriptAnalyse = {
  titel: string | null
  secties: ScriptSectie[]
  bezwaren: ScriptBezwaar[]
  /** Losse feiten die je snel wil kunnen opzoeken (prijzen, klantnamen, USP's). */
  weetjes: string[]
}

const MAX_SECTIES = 14
const MAX_BEZWAREN = 30
const MAX_WEETJES = 20
const MAX_SECTIE_TEKST = 6000
const MAX_BEZWAAR_TEKST = 2500

const tekst = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max)

/** Ruwe AI-uitvoer → gegarandeerd veilige structuur. Rommel wordt weggelaten,
 *  nooit doorgelaten. */
export function saneerAnalyse(raw: unknown): ScriptAnalyse {
  const src = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}

  const secties: ScriptSectie[] = []
  if (Array.isArray(src.secties)) {
    for (const s of src.secties.slice(0, MAX_SECTIES)) {
      if (!s || typeof s !== 'object') continue
      const o = s as Record<string, unknown>
      const kop = tekst(o.kop, 80)
      const inhoud = tekst(o.tekst, MAX_SECTIE_TEKST)
      if (kop && inhoud) secties.push({ kop, tekst: inhoud })
    }
  }

  const bezwaren: ScriptBezwaar[] = []
  if (Array.isArray(src.bezwaren)) {
    for (const b of src.bezwaren.slice(0, MAX_BEZWAREN)) {
      if (!b || typeof b !== 'object') continue
      const o = b as Record<string, unknown>
      const bezwaar = tekst(o.bezwaar, 200)
      const reactie = tekst(o.reactie, MAX_BEZWAAR_TEKST)
      if (bezwaar && reactie) bezwaren.push({ bezwaar, reactie })
    }
  }

  const weetjes = Array.isArray(src.weetjes)
    ? src.weetjes.map((w) => tekst(w, 300)).filter(Boolean).slice(0, MAX_WEETJES)
    : []

  return { titel: tekst(src.titel, 120) || null, secties, bezwaren, weetjes }
}

/** Is er inhoud om te tonen? Een lege analyse hoort niet opgeslagen te worden. */
export const analyseHeeftInhoud = (a: ScriptAnalyse): boolean =>
  a.secties.length > 0 || a.bezwaren.length > 0

/**
 * Kleur van een sectiekop in het belscherm, afgeleid van wat erin staat —
 * dezelfde signaalkleuren als het Steam-scherm waar de setters aan gewend zijn.
 */
export function sectieKleur(kop: string): string {
  const k = kop.toLowerCase()
  if (/intro|opening|begroeting/.test(k)) return 'text-blue-600'
  if (/gatekeeper|receptie|doorverbind/.test(k)) return 'text-orange-600'
  if (/pitch|aanbod|waarde/.test(k)) return 'text-emerald-700'
  if (/afspraak|afsluit|closing|agenda/.test(k)) return 'text-[#a89f00]'
  if (/bezwa|tegenwerping/.test(k)) return 'text-red-600'
  return 'text-gray-900'
}

/**
 * Het script voor dit belmoment kiezen. Meest specifiek wint:
 *   eigen script voor dit merk → eigen script (alle merken) →
 *   algemeen script voor dit merk → algemeen script (alle merken).
 * Alleen actieve scripts tellen mee. Geeft de INDEX in de lijst, of -1.
 *
 * Pure functie: dezelfde keuze draait op de server én in Focus Mode in de
 * browser, en is los testbaar.
 */
export function kiesScript(
  scripts: { eigenaar_auth_id: string | null; pipeline_id: string | null; actief: boolean }[],
  authUserId: string,
  pipelineId: string | null,
): number {
  let beste = -1, besteScore = -1
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i]
    if (!s.actief) continue
    const vanMij = s.eigenaar_auth_id === authUserId
    const vanIedereen = s.eigenaar_auth_id === null
    if (!vanMij && !vanIedereen) continue
    const ditMerk = pipelineId !== null && s.pipeline_id === pipelineId
    const alleMerken = s.pipeline_id === null
    if (!ditMerk && !alleMerken) continue
    const score = (vanMij ? 2 : 0) + (ditMerk ? 1 : 0)
    if (score > besteScore) { besteScore = score; beste = i }
  }
  return beste
}

/** De opdracht aan het model. Kernregel: LETTERLIJK overnemen, niet herschrijven
 *  — de setter kent zijn eigen formuleringen en moet ze woordelijk terugzien. */
export const ANALYSE_PROMPT = `Je krijgt een coldcallingscript. Zet het om naar een belscherm-indeling.

Geef UITSLUITEND geldige JSON met deze structuur:
{
  "titel": "korte naam van het script",
  "secties": [ { "kop": "INTRO", "tekst": "..." } ],
  "bezwaren": [ { "bezwaar": "We hebben al een partner", "reactie": "..." } ],
  "weetjes": [ "kort feit dat de beller snel wil opzoeken" ]
}

REGELS — de belangrijkste eerst:
- NEEM DE TEKST LETTERLIJK OVER. Niet herschrijven, niet samenvatten, niet
  verbeteren. De beller kent zijn eigen formuleringen en moet ze woordelijk
  terugzien. Je mag alleen HERINDELEN.
- "secties" = de gespreksdelen in gespreksvolgorde (bv. INTRO, GATEKEEPER,
  PITCH, AFSPRAAK). Gebruik de kopjes die het script zelf aandraagt; verzin
  alleen een kop als er echt geen staat.
- "bezwaren" = elk bezwaar/tegenwerping mét de reactie erop, uit het script
  gelicht zodat de beller ze naast het gesprek kan opzoeken. Staat een bezwaar
  midden in een sectie, haal het eruit en zet het hier.
- "weetjes" = losse feiten uit het script die je tijdens een gesprek snel nodig
  hebt: prijzen, klantnamen, cijfers, de kern van het aanbod. Kort houden.
- Staat er iets in het script dat nergens in past, maak er dan een sectie
  "EXTRA" van — er mag NIETS wegvallen.`
