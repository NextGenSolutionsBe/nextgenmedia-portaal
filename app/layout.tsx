import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

// Inter, zoals de app hem altijd had. Via next/font wordt het lettertype
// zelf-gehost: geen render-blokkerende Google-request en geen font-flikkering.
//
// `adjustFontFallback` laat Next een fallback met dezelfde metrics genereren,
// zodat de tekst niet verspringt terwijl het lettertype laadt. Zie ook de
// font-stack in tailwind.config.ts: die is bewust zo geschreven dat er NOOIT
// een serif kan verschijnen als deze variabele om wat voor reden ook wegvalt.
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'NextGenMedia Portal',
  description: 'Operations platform voor NextGenMedia',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
