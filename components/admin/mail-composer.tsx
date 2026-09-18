'use client'

import { useEffect, useState } from 'react'
import { Mail, X, Loader2, Send, CheckCircle2 } from 'lucide-react'
import { renderTemplate, type MailVars } from '@/lib/email-render'

// Eén gedeelde mailcomponent voor ALLE handmatige mails (klant/contract/taak/
// toegang/algemeen). Altijd preview + handmatige bevestiging; nooit automatisch.
// Server-side logging blijft via de bestaande E-mail Center-routes.

type Template = { id: string; name: string; subject: string; body: string; kind: string | null; cta_text: string | null; cta_link: string | null }

export type MailContext =
  | { type: 'client'; clientId: string; kind?: string; contractId?: string; shootId?: string; taskId?: string }
  | { type: 'contract'; contractId: string; contractTitle: string; signLink: string; defaultEmail?: string | null; signerName?: string | null; clientName?: string | null; expiresAt?: string | null }
  | { type: 'access'; clientId: string; clientName: string; toEmail: string; tempPassword?: string }
  | { type: 'generic'; toEmail?: string }

export function MailComposer({ context, label = 'Verstuur mail', className = 'btn-secondary text-sm' }: { context: MailContext; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}><Mail className="h-4 w-4" />{label}</button>
      {open && <Dialog context={context} onClose={() => setOpen(false)} />}
    </>
  )
}

function Dialog({ context, onClose }: { context: MailContext; onClose: () => void }) {
  const [loadingCtx, setLoadingCtx] = useState(true)
  const [toEmail, setToEmail] = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [ctaText, setCtaText] = useState('')
  const [ctaLink, setCtaLink] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Ontvanger kan voor contract/access/generic vrij ingevuld worden; voor 'client'
  // komt die uit de context-API.
  const recipientEditable = context.type !== 'client'

  useEffect(() => {
    (async () => {
      try {
        const tplRes = await fetch('/api/admin/email/templates')
        const tpl = await tplRes.json()
        const list = (tpl.templates ?? []) as Template[]
        setTemplates(list)

        if (context.type === 'client') {
          const qs = new URLSearchParams({ client_id: context.clientId })
          if (context.kind) qs.set('kind', context.kind)
          if (context.contractId) qs.set('contract_id', context.contractId)
          if (context.shootId) qs.set('shoot_id', context.shootId)
          if (context.taskId) qs.set('task_id', context.taskId)
          const ctxRes = await fetch(`/api/admin/email/context?${qs.toString()}`)
          const ctx = await ctxRes.json()
          const vars: MailVars = ctx.vars ?? {}
          if (ctxRes.ok) setToEmail(ctx.toEmail ?? '')
          const suggested = list.find((t) => t.kind === context.kind) ?? list[0]
          if (suggested) applyTemplate(suggested, vars)
        } else if (context.type === 'contract') {
          setToEmail(context.defaultEmail ?? '')
          const vervaldatum = context.expiresAt ? new Date(context.expiresAt + 'T00:00:00').toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
          const vars: MailVars = { klantnaam: context.signerName || context.clientName || 'klant', bedrijfsnaam: context.clientName || '', contractnaam: context.contractTitle, contract_link: context.signLink, datum: vervaldatum }
          const suggested = list.find((t) => t.kind === 'contract')
          if (suggested) applyTemplate(suggested, vars)
          else {
            setSubject(`Contract ter ondertekening — ${context.contractTitle}`)
            setBody(defaultContractBody(context, vervaldatum)); setCtaText('Contract ondertekenen'); setCtaLink(context.signLink)
          }
        } else if (context.type === 'access') {
          setToEmail(context.toEmail)
          setSubject('Toegang tot NextGenMedia portaal')
          setBody(`Beste,\n\nJe hebt toegang gekregen tot het NextGenMedia klantenportaal van ${context.clientName}.\n\nLogin: ${context.toEmail}${context.tempPassword ? `\nTijdelijk wachtwoord: ${context.tempPassword}` : ''}\n\nLog in via de knop hieronder en wijzig daarna je wachtwoord.\n\nMet vriendelijke groet,\nNextGenMedia`)
          setCtaText('Inloggen'); setCtaLink(`${window.location.origin}/login`)
        } else {
          setToEmail(context.toEmail ?? '')
        }
      } catch { setError('Laden mislukt') } finally { setLoadingCtx(false) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyTemplate = (t: Template, vars: MailVars) => {
    setTemplateId(t.id)
    setSubject(renderTemplate(t.subject, vars))
    setBody(renderTemplate(t.body, vars))
    setCtaText(renderTemplate(t.cta_text ?? '', vars))
    setCtaLink(renderTemplate(t.cta_link ?? '', vars))
  }
  const onPick = (id: string) => {
    const t = templates.find((x) => x.id === id)
    if (t) applyTemplate(t, {})
    else { setTemplateId(''); }
  }

  const send = async () => {
    if (!toEmail.trim()) { setError('Geen e-mailadres'); return }
    if (!subject.trim()) { setError('Onderwerp is verplicht'); return }
    setSending(true); setError(null)
    try {
      const tpl = templates.find((t) => t.id === templateId)
      let res: Response
      if (context.type === 'contract') {
        res = await fetch(`/api/admin/contracts/${context.contractId}/send-mail`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_email: toEmail, subject, body, cta_text: ctaText || null, cta_link: ctaLink || null, template_id: templateId || null, template_name: tpl?.name ?? null }),
        })
      } else {
        res = await fetch('/api/admin/email/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to_email: toEmail,
            to_client_id: (context.type === 'client' || context.type === 'access') ? context.clientId : null,
            subject, body, cta_text: ctaText || null, cta_link: ctaLink || null,
            template_id: templateId || null, template_name: tpl?.name ?? null,
            kind: context.type === 'client' ? (context.kind ?? 'generic') : 'generic',
          }),
        })
      }
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setDone(true)
      if (context.type === 'contract') setTimeout(() => window.location.reload(), 1000)
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setSending(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold flex items-center gap-2"><Mail className="h-4 w-4" />Mail versturen</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        {done ? (
          <div className="p-8 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
            <p className="text-sm font-medium">Mail verstuurd naar {toEmail}</p>
            <button onClick={onClose} className="btn-primary">Sluiten</button>
          </div>
        ) : loadingCtx ? (
          <div className="p-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : (
          <div className="p-5 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Aan</label>
              {recipientEditable
                ? <input className={inp} value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="ontvanger@bedrijf.be" />
                : <div className="text-sm text-gray-800">{toEmail || '— geen e-mailadres —'}</div>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Template</label>
              <select className={inp} value={templateId} onChange={(e) => onPick(e.target.value)}>
                <option value="">— Eigen mail —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Onderwerp</label>
              <input className={inp} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Inhoud</label>
              <textarea rows={8} className={inp} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Knop-tekst</label><input className={inp} value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="Bv. Bekijken" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Knop-link</label><input className={inp} value={ctaLink} onChange={(e) => setCtaLink(e.target.value)} placeholder="https://…" /></div>
            </div>
            {/* Preview */}
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <span className="text-[11px] text-gray-400 block mb-1">Voorbeeld</span>
              <div className="text-xs text-gray-700 whitespace-pre-wrap">{body || '—'}</div>
              {ctaText && ctaLink && (
                <span className="inline-block mt-2 rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-semibold text-white" style={{ borderBottom: '3px solid #fff848' }}>{ctaText}</span>
              )}
            </div>
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex gap-2 pt-1">
              <button onClick={send} disabled={sending || !toEmail} className="btn-primary flex-1 justify-center">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Verstuur</button>
              <button onClick={onClose} className="btn-secondary">Annuleer</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function defaultContractBody(c: { contractTitle: string; signerName?: string | null; clientName?: string | null }, vervaldatum: string): string {
  return `Beste ${c.signerName || c.clientName || 'klant'},\n\n` +
    `Hierbij ontvang je het contract "${c.contractTitle}" ter ondertekening.\n\n` +
    `Klik op de knop hieronder om het contract te bekijken en digitaal te ondertekenen.` +
    (vervaldatum ? `\n\nLet op: deze tekenlink is geldig tot ${vervaldatum}.` : '') +
    `\n\nMet vriendelijke groet,\nNextGenMedia`
}
