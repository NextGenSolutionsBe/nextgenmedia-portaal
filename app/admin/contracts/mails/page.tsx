import { ContractTabs } from '../contract-tabs'
import { VerzondenMails } from '@/components/contracten/verzonden-mails'

export const dynamic = 'force-dynamic'

export default function ContractMailsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Verzonden contractmails</h1>
        <p className="text-sm text-gray-500">Elke verzendpoging vanuit de app, met de werkelijk verstuurde inhoud. Gemaild is niet hetzelfde als getekend.</p>
      </div>
      <ContractTabs />
      <VerzondenMails />
    </div>
  )
}
