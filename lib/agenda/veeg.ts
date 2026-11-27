/**
 * Vegen door de agenda (27 nov 2026): met twee vingers op de touchpad van een laptop
 * en met de vinger op de gsm. Pure regels, getest in tests/agenda-veeg.test.ts.
 *
 * Touchpad: de browser geeft een reeks wheel-events met deltaX. We tellen ze op; vanaf
 * WIEL_DREMPEL px gaat de agenda één periode verder en ligt de beweging vast tot de
 * vingers loslaten (de naloop van de touchpad telt niet als tweede veeg). Een nieuwe
 * veeg = even stil (WIEL_STIL ms) of een duidelijke nieuwe ruk na de naloop.
 */

export type WielStand = { som: number; vast: boolean; laatste: number; vorigAbs: number }

export const WIEL_DREMPEL = 80
export const WIEL_STIL = 220
/** Hoe ver de kalender meeschuift tijdens het vegen (in px), voor het verspringt. */
export const MEE_MAX = 70

export type WielUit = {
  s: WielStand | null
  /** 1 = volgende periode, -1 = vorige, 0 = niets. */
  stap: 0 | 1 | -1
  /** Het event is van ons: geen gewoon scrollen en geen "vorige pagina" van de browser. */
  vang: boolean
  /** Hoeveel de kalender nu meeschuift (px; negatief = naar links). */
  mee: number
}

export function wiel(s: WielStand | null, dx: number, dy: number, nu: number): WielUit {
  const abs = Math.abs(dx)
  const bezig = !!s && nu - s.laatste <= WIEL_STIL
  // Vooral verticaal: gewoon scrollen. Ook tijdens een veeg laten we verticale naloop door.
  if (abs <= Math.abs(dy) || abs < 0.5) {
    if (!bezig) return { s: null, stap: 0, vang: false, mee: 0 }
    return { s, stap: 0, vang: false, mee: s!.vast ? 0 : meeVan(s!.som) }
  }
  // Nieuwe veeg: na een stilte, of een nieuwe ruk terwijl de naloop van de vorige uitsterft.
  const nieuw = !bezig || (s!.vast && s!.vorigAbs < 12 && abs > s!.vorigAbs * 1.6 + 3)
  let st: WielStand = nieuw ? { som: 0, vast: false, laatste: nu, vorigAbs: abs } : { ...s!, laatste: nu, vorigAbs: abs }
  if (st.vast) return { s: st, stap: 0, vang: true, mee: 0 }
  const som = st.som + dx
  if (Math.abs(som) >= WIEL_DREMPEL) {
    st = { ...st, som: 0, vast: true }
    return { s: st, stap: som > 0 ? 1 : -1, vang: true, mee: 0 }
  }
  st = { ...st, som }
  return { s: st, stap: 0, vang: true, mee: meeVan(som) }
}

/** Met weerstand meeschuiven: de kalender volgt, maar minder ver dan de vingers. */
export function meeVan(som: number): number {
  const v = -som * 0.6
  return Math.max(-MEE_MAX, Math.min(MEE_MAX, v))
}

/** De vingers terug los zonder genoeg te vegen: hoe ver het nog meeschuift (om terug te veren). */
export const VINGER_RICHTING = 10

/**
 * Gsm: wat de vinger tot nu toe deed. Pas na VINGER_RICHTING px weten we of het opzij
 * (wij) of op en neer (gewoon scrollen) is.
 */
export function vingerRichting(dx: number, dy: number): 'opzij' | 'scroll' | null {
  if (Math.abs(dx) < VINGER_RICHTING && Math.abs(dy) < VINGER_RICHTING) return null
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? 'opzij' : 'scroll'
}

/** Gsm: na het loslaten een stap (ver genoeg of snel genoeg) of terugveren. */
export function vingerStap(dx: number, ms: number): 0 | 1 | -1 {
  const snel = Math.abs(dx) / Math.max(1, ms)
  if (Math.abs(dx) >= 70 || (Math.abs(dx) >= 30 && snel >= 0.35)) return dx < 0 ? 1 : -1
  return 0
}

/** Gsm: de kalender volgt de vinger, met wat weerstand. */
export const vingerMee = (dx: number) => Math.max(-140, Math.min(140, dx * 0.7))
