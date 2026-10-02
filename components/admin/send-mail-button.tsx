'use client'

// Dunne wrapper rond MailComposer (client-context). Behouden voor backwards
// compatibility; alle maillogica leeft nu in MailComposer.
import { MailComposer } from './mail-composer'

export function SendMailButton({
  clientId, kind, contractId, shootId, taskId, label = 'Verstuur mail', className = 'btn-secondary text-sm',
}: {
  clientId: string
  kind?: string
  contractId?: string
  shootId?: string
  taskId?: string
  label?: string
  className?: string
}) {
  return (
    <MailComposer
      context={{ type: 'client', clientId, kind, contractId, shootId, taskId }}
      label={label}
      className={className}
    />
  )
}
