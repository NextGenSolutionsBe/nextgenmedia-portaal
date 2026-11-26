'use client'

// Dunne wrapper rond MailComposer (contract-context). Behouden voor backwards
// compatibility; alle maillogica leeft nu in MailComposer.
import { MailComposer } from './mail-composer'

export function ContractMailButton({
  contractId, contractTitle, signLink, defaultEmail, signerName, clientName, expiresAt, herinnering, bedrijf,
  label = 'Verstuur contractmail', className = 'btn-secondary text-sm',
}: {
  contractId: string
  contractTitle: string
  signLink: string
  defaultEmail?: string | null
  signerName?: string | null
  clientName?: string | null
  expiresAt?: string | null
  /** Opent met de herinneringsmail om te ondertekenen. */
  herinnering?: boolean
  /** Bedrijf van het contract: bepaalt de huisstijl van de mail (Solutions = blauw). */
  bedrijf?: string | null
  label?: string
  className?: string
}) {
  return (
    <MailComposer
      context={{ type: 'contract', contractId, contractTitle, signLink, defaultEmail, signerName, clientName, expiresAt, herinnering, merk: bedrijf === 'nextgensolutions' ? 'nextgensolutions' : bedrijf === 'nextgenmedia' ? 'nextgenmedia' : null }}
      label={label}
      className={className}
    />
  )
}
