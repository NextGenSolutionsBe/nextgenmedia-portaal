// Merkkleuren voor de verkoopmodule. GEEN 'server-only': dit wordt ook in
// client-componenten gebruikt (badges in pipeline, agenda en Focus Mode).
//
// Waarom dit bestaat: met twee merken in één scherm moet je in een oogopslag
// zien waarvoor je aan het bellen of boeken bent. Geel = NextGenMedia (de
// huisstijlkleur van het platform), blauw = NextGenSolutions. De kleuren
// hangen aan de pipeline-KEY, niet aan de naam — namen kunnen wijzigen.

export type MerkStijl = {
  /** Tailwind-klassen voor een badge: achtergrond, rand en tekst. */
  badge: string
  /** Een klein bolletje/accent, bv. in een keuzelijst. */
  stip: string
  /** Volle balk (bv. bovenrand van Focus Mode). */
  balk: string
}

const NEUTRAAL: MerkStijl = {
  badge: 'bg-gray-100 border-gray-300 text-gray-700',
  stip: 'bg-gray-400',
  balk: 'bg-gray-300',
}

const STIJLEN: Record<string, MerkStijl> = {
  nextgenmedia: {
    badge: 'bg-[#fff848] border-yellow-400 text-gray-900',
    stip: 'bg-[#fff848] border border-yellow-500',
    balk: 'bg-[#fff848]',
  },
  nextgensolutions: {
    badge: 'bg-blue-500 border-blue-600 text-white',
    stip: 'bg-blue-500',
    balk: 'bg-blue-500',
  },
}

/** Stijl voor een merk. Onbekende/lege key → neutraal grijs. */
export function merkStijl(pipelineKey: string | null | undefined): MerkStijl {
  return STIJLEN[pipelineKey ?? ''] ?? NEUTRAAL
}
