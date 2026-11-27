import { Bricolage_Grotesque, DM_Mono, DM_Sans } from 'next/font/google'
import { cn } from '@/lib/utils'
import { NGM, NGM_LOGO } from '@/lib/ngm-merk'

// Huisstijl NextGenMedia op de publieke pagina's die in naam van NextGenMedia
// werken (shootplan, meeting boeken, tekenen en offertes van NextGenMedia).
// De app zelf blijft in de huisstijl van NextGen Agency. Lettertypes via
// next/font: enkel geladen op de pagina's die deze schil gebruiken.
const titel = Bricolage_Grotesque({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-ngm-titel', display: 'swap' })
const tekst = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-ngm-tekst', display: 'swap' })
const mono = DM_Mono({ subsets: ['latin'], weight: ['400'], variable: '--font-ngm-mono', display: 'swap' })

const BREEDTE = { '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl' } as const
type Breedte = keyof typeof BREEDTE

/** De schil: lettertypes en kleuren van NextGenMedia (.ngm in globals.css zet knoppen, kaarten en grijzen om). */
export function NgmSchil({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(titel.variable, tekst.variable, mono.variable, 'ngm min-h-screen flex flex-col', className)}>{children}</div>
}

/** Het logo: zonnegeel op woud, woud op kalk of wit. */
export function NgmLogo({ kleur = 'woud', className }: { kleur?: 'woud' | 'zonnegeel' | 'kalk'; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={NGM_LOGO[kleur]} alt="NextGenMedia" className={cn('h-6 w-auto', className)} />
}

/** De kop: een balk in woud met het logo in zonnegeel en rechts een label in DM Mono. */
export function NgmKop({ label, breedte = '3xl', sticky = false }: { label?: string; breedte?: Breedte; sticky?: boolean }) {
  return (
    <header className={cn('px-4 py-4', sticky && 'sticky top-0 z-10')} style={{ background: NGM.woud }}>
      <div className={cn(BREEDTE[breedte], 'mx-auto flex items-center justify-between gap-3')}>
        <NgmLogo kleur="zonnegeel" className="h-6 sm:h-7" />
        {label && <span className="ngm-label" style={{ color: NGM.mos }}>{label}</span>}
      </div>
    </header>
  )
}

/** De voet: naam, website en de baseline. */
export function NgmVoet() {
  return (
    <footer className="px-4 py-6 text-center text-xs" style={{ background: NGM.woud, color: NGM.mos }}>
      NextGenMedia · <a href={`https://${NGM.website}`} className="hover:underline" style={{ color: NGM.mos }}>{NGM.website}</a>
      <div className="ngm-label mt-1.5" style={{ color: NGM.zonnegeel }}>{NGM.baseline}</div>
    </footer>
  )
}
