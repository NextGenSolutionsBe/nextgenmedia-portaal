import type { Metadata } from 'next'
import { Poppins, JetBrains_Mono } from 'next/font/google'
import './globals.css'

// Design 16 nov 2026: Poppins (licht en rond) voor alle tekst (titels, labels, knoppen, inhoud),
// JetBrains Mono spaarzaam voor codes en compacte technische info (font-mono).
// Via next/font zelf-gehost: geen render-blokkerende Google-request en geen
// font-flikkering. `adjustFontFallback` (standaard aan) maakt een fallback met
// dezelfde metrics. Zie ook de font-stack in tailwind.config.ts: die is bewust
// zo geschreven dat er NOOIT een serif kan verschijnen als een variabele wegvalt.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'NextGenMedia Portal',
  description: 'Operations platform voor NextGenMedia',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${poppins.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
