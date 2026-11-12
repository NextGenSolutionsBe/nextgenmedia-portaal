import { cn } from '@/lib/utils'

// Logo source. A temporary SVG placeholder lives at /public/logo.svg.
// To use the real logo: drop your PNG at /public/logo.png and change this to
// '/logo.png' (or just overwrite logo.svg with your own SVG).
const LOGO_SRC = '/logo.png'

/**
 * NextGenMedia logo mark.
 *
 * Renders the brand logo. Drop the lightning-bolt PNG (transparent background
 * recommended) in the project's `public/` folder as `logo.png` and it appears
 * everywhere this component is used.
 *
 * `variant`:
 *   - 'tile'  → rounded square with the dark brand background (sidebars, headers)
 *   - 'plain' → just the mark, no background (use on already-dark surfaces)
 */
export function Logo({
  className,
  variant = 'tile',
  alt = 'NextGenMedia',
}: {
  className?: string
  variant?: 'tile' | 'plain'
  alt?: string
}) {
  if (variant === 'plain') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={LOGO_SRC} alt={alt} className={cn('object-contain', className)} />
    )
  }

  return (
    <div className={cn('rounded-lg bg-[#0b0f1a] flex items-center justify-center overflow-hidden', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_SRC} alt={alt} className="h-[78%] w-[78%] object-contain" />
    </div>
  )
}
