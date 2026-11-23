import type { Metadata } from 'next'
import { Archivo, JetBrains_Mono } from 'next/font/google'
import './globals.css'

// Huisstijl NextGen Agency (23 nov 2026): Archivo voor alle tekst (titels in
// Archivo Bold, zoals het logo), JetBrains Mono voor labels en ondertitels
// (font-mono, .label-mono). Via next/font zelf-gehost: geen render-blokkerende
// Google-request en geen font-flikkering. Zie ook de font-stack in
// tailwind.config.ts: die is bewust zo geschreven dat er NOOIT een serif kan
// verschijnen als een variabele wegvalt.
const archivo = Archivo({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'NextGen Agency',
  description: 'Werkomgeving van NextGen Agency, met NextGenMedia en NextGenSolutions',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${archivo.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
