import { EmailTabs } from './email-tabs'
import { Mail } from 'lucide-react'

export default function EmailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Mail className="h-6 w-6" />E-mail Center</h1>
        <p className="text-sm text-gray-500 mt-0.5">Mails vertrekken vanuit info@nextgenmedia.be. Klanten krijgen nooit automatisch mail — enkel wanneer een admin op "Verstuur mail" klikt.</p>
      </div>
      <EmailTabs />
      {children}
    </div>
  )
}
