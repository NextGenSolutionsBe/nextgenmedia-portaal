import { publicatieKanalen } from '@/lib/social-platforms'

/**
 * Kleine labels met de platformen waarop een contentitem verschijnt. Wit met
 * een gekleurde rand en tekst per platform: leesbaar op elke statuskleur van
 * het item, zonder de status te overstemmen.
 */
/** Op een gsm is een dagvakje te smal voor volledige namen: dan korte codes (de naam staat in de tooltip). */
const KORT: Record<string, string> = { instagram: 'IG', facebook: 'FB', linkedin: 'LI', tiktok: 'TT', youtube: 'YT', pinterest: 'PI', twitter: 'X' }

const KLEUR: Record<string, string> = {
  instagram: 'text-pink-700 border-pink-200',
  facebook: 'text-blue-700 border-blue-200',
  linkedin: 'text-sky-800 border-sky-200',
  tiktok: 'text-gray-900 border-gray-300',
  youtube: 'text-red-700 border-red-200',
  pinterest: 'text-rose-700 border-rose-200',
  twitter: 'text-gray-900 border-gray-300',
}

export function KanaalLabels({ platforms, className = '', compact = false }: {
  platforms: unknown; className?: string
  /** In de kalendervakjes: korte codes op smalle schermen, volledige namen vanaf sm. */
  compact?: boolean
}) {
  const kanalen = publicatieKanalen(platforms)
  if (!kanalen.length) return null
  return (
    <span className={`flex flex-wrap gap-0.5 ${className}`} aria-label={`Platformen: ${kanalen.map((k) => k.label).join(', ')}`}>
      {kanalen.map((k) => (
        <span key={k.slug} title={k.label} className={`inline-flex items-center rounded border bg-white/90 px-1 text-[9px] leading-[14px] font-medium ${KLEUR[k.slug] ?? 'text-gray-700 border-gray-200'}`}>
          {compact
            ? <><span className="sm:hidden">{KORT[k.slug] ?? k.label.slice(0, 2).toUpperCase()}</span><span className="hidden sm:inline">{k.label}</span></>
            : k.label}
        </span>
      ))}
    </span>
  )
}
