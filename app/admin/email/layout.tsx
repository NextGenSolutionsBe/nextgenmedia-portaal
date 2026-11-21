import { EmailTabs } from './email-tabs'
import { Mail } from 'lucide-react'

export default function EmailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Mail className="h-6 w-6" />E-mail Center</h1>
        <p className="text-sm text-gray-500 mt-0.5">Klanten krijgen nooit vanzelf mail, enkel als jij op Verstuur klikt.</p>
      </div>
      <EmailTabs />
      {children}
    </div>
  )
}
