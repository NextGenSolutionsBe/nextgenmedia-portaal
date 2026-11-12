'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Send, UserPlus, ShieldCheck } from 'lucide-react'
import { MailDialog } from '@/components/admin/mail-composer'

/**
 * Klantaccount op de klantfiche: aanmaken (als de klant nog geen login heeft)
 * en de login doorsturen. De klant krijgt een persoonlijke link (7 dagen),
 * kiest zelf zijn wachtwoord en kan meteen tweestapsverificatie aanzetten met
 * een QR-code. Nooit een wachtwoord in de mail; versturen gaat via de
 * MailComposer (voorbeeld en bevestiging).
 */
export function KlantAccountKaart({ clientId, clientName, emailVoorstel }: { clientId: string; clientName: string; emailVoorstel: string | null }) {
  const router = useRouter()
  const [stand, setStand] = useState<{ heeftAccount: boolean; email: string | null } | null>(null)
  const [email, setEmail] = useState(emailVoorstel ?? '')
  const [bezig, setBezig] = useState(false)
  const [mail, setMail] = useState(false)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/clients/${clientId}/account`, { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) setStand({ heeftAccount: j.heeftAccount, email: j.email })
    } catch { /* kaart is een extra */ }
  }, [clientId])
  useEffect(() => { laad() }, [laad])

  const maakAan = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/clients/${clientId}/account`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Aanmaken mislukt')
      toast.success('Klantaccount aangemaakt. Stuur nu de login door.')
      await laad(); router.refresh(); setMail(true)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Aanmaken mislukt') } finally { setBezig(false) }
  }

  if (!stand) return null
  return (
    <div id="klantaccount" className="card-base space-y-3 scroll-mt-20">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Klantaccount</h3>
        <p className="text-xs text-gray-500 mt-0.5">De klant kiest zelf een wachtwoord via een persoonlijke link (7 dagen geldig) en kan meteen tweestapsverificatie instellen met een QR-code.</p>
      </div>
      {stand.heeftAccount ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">Login: <b>{stand.email}</b></span>
          <button type="button" onClick={() => setMail(true)} className="btn-primary text-sm"><Send className="h-4 w-4" />Login doorsturen</button>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <input type="email" className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="E-mailadres van de klant" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="button" onClick={maakAan} disabled={bezig || !email.trim()} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}Klantaccount aanmaken</button>
        </div>
      )}
      {mail && (
        <MailDialog
          context={{ type: 'klantaccount', clientId, clientName }}
          onClose={() => setMail(false)}
          onSent={() => { toast.success('Welkomstmail verstuurd.'); setMail(false) }}
        />
      )}
    </div>
  )
}
