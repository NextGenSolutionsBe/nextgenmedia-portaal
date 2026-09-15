// Klanten per maand: per maand duidt de admin aan voor welke klanten we die
// maand de volledige contentcyclus draaien. Twee types. Puur (client-safe).

export type MonthClientType = 'new' | 'existing'

export const MONTH_CLIENT_TYPES: { key: MonthClientType; label: string }[] = [
  { key: 'new',      label: 'Nieuwe klant' },
  { key: 'existing', label: 'Bestaande klant / Strategie Intake' },
]

export const MONTH_CLIENT_TYPE_LABEL: Record<string, string> = Object.fromEntries(MONTH_CLIENT_TYPES.map((t) => [t.key, t.label]))
export const MONTH_CLIENT_TYPE_KEYS = MONTH_CLIENT_TYPES.map((t) => t.key)

// De volledige maandflow die geldt zodra een klant in een maand staat.
export const MONTH_FLOW_STEPS = [
  'Contentkalender maken',
  'Scripts schrijven',
  'Intake / strategie bespreken',
  'Shoot plannen',
  'Content shooten',
  'Editen',
  'Inplannen',
  'Feedback verwerken',
  'Statistieken bespreken',
]
