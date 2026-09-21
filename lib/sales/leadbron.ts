// Leadbron en dienst — pure module, bruikbaar in client- én servercode.
//
// De leadbron zegt HOE een lead binnenkwam en verandert daarna niet meer;
// de fase (lib/sales/stages.ts) zegt waar hij nu staat. Twee aparte dingen:
// een websiteaanvraag die je vervolgens belt, blijft een websitelead.

export const LEADBRONNEN = [
  { key: 'outbound', label: 'Outbound' },
  { key: 'website',  label: 'Website' },
  { key: 'import',   label: 'Import' },
  { key: 'harrie',   label: 'Harrie' },
  { key: 'manueel',  label: 'Manueel' },
] as const

export type Leadbron = (typeof LEADBRONNEN)[number]['key']

export const LEADBRON_KEYS = LEADBRONNEN.map((b) => b.key) as Leadbron[]

export const isLeadbron = (v: unknown): v is Leadbron =>
  typeof v === 'string' && (LEADBRON_KEYS as string[]).includes(v)

export const leadbronLabel = (key: string | null | undefined): string =>
  LEADBRONNEN.find((b) => b.key === key)?.label ?? (key || 'Outbound')

/** Onbekend of leeg → outbound: dat is waar het gros vandaan komt. */
export const normaliseerLeadbron = (v: unknown): Leadbron => (isLeadbron(v) ? v : 'outbound')

/** Inbound = de prospect kwam zelf naar ons. Al de rest is outbound. */
export const isInboundBron = (key: string | null | undefined): boolean => key === 'website'

export const LEADBRON_STYLE: Record<Leadbron, string> = {
  outbound: 'bg-gray-100 text-gray-700 border-gray-200',
  website:  'bg-sky-100 text-sky-800 border-sky-200',
  import:   'bg-gray-100 text-gray-600 border-gray-200',
  harrie:   'bg-violet-100 text-violet-800 border-violet-200',
  manueel:  'bg-gray-100 text-gray-700 border-gray-200',
}

/**
 * Diensten waar een prospect interesse in kan tonen. Vrije tekst blijft
 * mogelijk (het veld is een tekstveld met suggesties); dit is de lijst die de
 * keuzelijst en de filters vullen.
 */
export const DIENSTEN = [
  'Social media',
  'Website',
  'Branding',
  'Video',
  'Advertenties',
  'SEO',
  'Automatisering',
  'Anders',
] as const
