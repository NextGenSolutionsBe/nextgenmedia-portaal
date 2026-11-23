import { cn } from '@/lib/utils'

// Huisstijl NextGen Agency (brand guideline, 23 nov 2026): de ster als icoon,
// het woordmerk NEXTGEN AGENCY met de vervaagde X. Beide uit de aangeleverde
// logobestanden (public/merk/); de blur van de X nooit zelf opnieuw maken.
const STER_WIT = '/merk/ster-wit.png'
const STER_ZWART = '/merk/ster-zwart.png'

/**
 * Het icoon van NextGen Agency: de ster.
 *
 * `variant`:
 *   - 'tile'  → witte ster op een zwart vlak (zijbalken, kopjes, publieke pagina's)
 *   - 'plain' → enkel de zwarte ster, zonder vlak
 */
export function Logo({
  className,
  variant = 'tile',
  alt = 'NextGen Agency',
}: {
  className?: string
  variant?: 'tile' | 'plain'
  alt?: string
}) {
  if (variant === 'plain') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={STER_ZWART} alt={alt} className={cn('object-contain', className)} />
    )
  }

  return (
    <div className={cn('rounded-lg bg-[#0f0f0f] flex items-center justify-center overflow-hidden', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={STER_WIT} alt={alt} className="h-[56%] w-[56%] object-contain" />
    </div>
  )
}

/** Het woordmerk NEXTGEN AGENCY (zwart op licht, of wit op donker). Hoogte via className. */
export function Woordmerk({ className, wit = false }: { className?: string; wit?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={wit ? '/merk/logo-wit.png' : '/merk/logo-zwart.png'} alt="NextGen Agency" className={cn('w-auto object-contain', className)} />
  )
}
