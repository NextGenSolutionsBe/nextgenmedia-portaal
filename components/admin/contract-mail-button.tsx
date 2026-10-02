'use client'

// Dunne wrapper rond MailComposer (contract-context). Behouden voor backwards
// compatibility; alle maillogica leeft nu in MailComposer.
import { MailComposer } from './mail-composer'

export function ContractMailButton({
  contractId, contractTitle, signLink, defaultEmail, signerName, clientName, expiresAt,
  label = 'Verstuur contractmail', className = 'btn-secondary text-sm',
}: {
  contractId: string
  contractTitle: string
  signLink: string
  defaultEmail?: string | null
  signerName?: string | null
  clientName?: string | null
  expiresAt?: string | null
  label?: string
  className?: string
}) {
  return (
    <MailComposer
      context={{ type: 'contract', contractId, contractTitle, signLink, defaultEmail, signerName, clientName, expiresAt }}
      label={label}
      className={className}
    />
  )
}
