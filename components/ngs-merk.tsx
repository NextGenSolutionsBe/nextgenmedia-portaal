import { Inter, Jersey_15, Montserrat } from 'next/font/google'
import { cn } from '@/lib/utils'
import { NGS, NGS_LOGO } from '@/lib/ngs-merk'

// Huisstijl NextGenSolutions (brandkit 2026) op de publieke pagina's die in naam van
// NextGenSolutions werken (tekenen, ontvangstbewijs en offertes van NextGenSolutions).
// De app zelf blijft in de huisstijl van NextGen Agency. Lettertypes via next/font:
// enkel geladen op de pagina's die deze schil gebruiken.
const titel = Montserrat({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-ngs-titel', display: 'swap' })
const tekst = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-ngs-tekst', display: 'swap' })
const label = Jersey_15({ subsets: ['latin'], weight: ['400'], variable: '--font-ngs-label', display: 'swap' })

const BREEDTE = { '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl' } as const
type Breedte = keyof typeof BREEDTE

/** De schil: lettertypes en kleuren van NextGenSolutions (.ngs in globals.css zet knoppen, kaarten en grijzen om). */
export function NgsSchil({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(titel.variable, tekst.variable, label.variable, 'ngs min-h-screen flex flex-col', className)}>{children}</div>
}

/** Het logo: in kleur op licht, wit op inkt. */
export function NgsLogo({ kleur = 'kleur', className }: { kleur?: 'kleur' | 'wit'; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={NGS_LOGO[kleur]} alt="NextGenSolutions" className={cn('h-8 w-auto', className)} />
}

/** De kop: wit met het logo in kleur, rechts een label in Jersey 15 en een dunne lijn. */
export function NgsKop({ label: tekstLabel, breedte = '3xl', sticky = false }: { label?: string; breedte?: Breedte; sticky?: boolean }) {
  return (
    <header className={cn('px-4 py-3.5 bg-white border-b', sticky && 'sticky top-0 z-10')} style={{ borderColor: NGS.lijn }}>
      <div className={cn(BREEDTE[breedte], 'mx-auto flex items-center justify-between gap-3')}>
        <NgsLogo className="h-7 sm:h-8" />
        {tekstLabel && <span className="ngs-label" style={{ color: NGS.tekst }}>{tekstLabel}</span>}
      </div>
    </header>
  )
}

/** De voet: naam, website en de belofte. */
export function NgsVoet() {
  return (
    <footer className="px-4 py-6 text-center text-xs border-t" style={{ background: NGS.kalk, color: NGS.tekst, borderColor: NGS.lijn }}>
      NextGenSolutions · <a href={`https://${NGS.website}`} className="hover:underline" style={{ color: NGS.blauw }}>{NGS.website}</a>
      <div className="ngs-label mt-1.5" style={{ color: NGS.tekstSterk }}>{NGS.tagline}</div>
    </footer>
  )
}
