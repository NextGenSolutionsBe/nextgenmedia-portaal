import { Logo } from '@/components/logo'

/** Publieke boekingspagina's: eigen, rustige schil zonder login. */
export default function BoekenLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Logo className="h-8 w-8" />
          <span className="font-bold text-sm">NextGenMedia</span>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:py-10">{children}</main>
      <footer className="px-4 py-6 text-center text-xs text-gray-400">
        NextGenMedia · <a href="https://nextgenmedia.be" className="hover:text-gray-600">nextgenmedia.be</a>
      </footer>
    </div>
  )
}
