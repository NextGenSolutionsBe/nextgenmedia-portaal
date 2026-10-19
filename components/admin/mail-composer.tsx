'use client'

import { useEffect, useState } from 'react'
import { Mail, X, Loader2, Send, CheckCircle2 } from 'lucide-react'
import { renderTemplate, type MailVars } from '@/lib/email-render'
import { DEFAULT_TEMPLATES } from '@/lib/email-templates-defaults'

// Eén gedeelde mailcomponent voor ALLE handmatige mails (klant/contract/taak/
// toegang/algemeen). Altijd preview + handmatige bevestiging; nooit automatisch.
// Server-side logging blijft via de bestaande E-mail Center-routes.

type Template = { id: string; name: string; subject: string; body: string; kind: string | null; cta_text: string | null; cta_link: string | null }

export type MailContext =
  | { type: 'client'; clientId: string; kind?: string; contractId?: string; shootId?: string; taskId?: string; deadlineId?: string }
  // herinnering: opent met de herinneringsmail i.p.v. de eerste contractmail.
  | { type: 'contract'; contractId: string; contractTitle: string; signLink: string; defaultEmail?: string | null; signerName?: string | null; clientName?: string | null; expiresAt?: string | null; herinnering?: boolean }
  | { type: 'access'; clientId: string; clientName: string; toEmail: string; tempPassword?: string }
  | { type: 'generic'; toEmail?: string }
  // Formulierlink (Formulieren → Delen): onderwerp/tekst/knop voorgevuld, ontvanger aanpasbaar.
  | { type: 'formulier'; link: string; formulierTitel: string; clientId?: string | null; clientName?: string | null; verlooptOp?: string | null }

/** Resultaat van een gelukte verzending (of van een eerder gelukte, bij dezelfde verzendpoging). */
export type MailVerstuurd = { id: string | null; verstuurd_op: string | null; al_verstuurd?: boolean }

export function MailComposer({ context, label = 'Verstuur mail', className = 'btn-secondary text-sm', onSent }: { context: MailContext; label?: string; className?: string; onSent?: (r: MailVerstuurd) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}><Mail className="h-4 w-4" />{label}</button>
      {open && <MailDialog context={context} onClose={() => setOpen(false)} onSent={onSent} />}
    </>
  )
}

/** Ingebouwde template van een soort, als er (nog) geen eigen versie in E-mail Center staat. */
const ingebouwd = (kind?: string): Template | null => {
  const d = kind ? DEFAULT_TEMPLATES.find((t) => t.kind === kind) : undefined
  return d ? { id: `standaard:${d.kind}`, name: `${d.name} (standaard)`, subject: d.subject, body: d.body, kind: d.kind, cta_text: d.cta_text, cta_link: d.cta_link } : null
}

/** Dezelfde dialoog, rechtstreeks te openen vanuit een andere flow (bv. "Goedkeuring aanvragen"). */
export function MailDialog({ context, onClose, onSent }: { context: MailContext; onClose: () => void; onSent?: (r: MailVerstuurd) => void }) {
  const [loadingCtx, setLoadingCtx] = useState(true)
  const [toEmail, setToEmail] = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [ctaText, setCtaText] = useState('')
  const [ctaLink, setCtaLink] = useState('')
  const [cc, setCc] = useState('')
  const [kopieNaarMij, setKopieNaarMij] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [vars, setVars] = useState<MailVars>({})
  const [eerder, setEerder] = useState<{ verstuurd_op: string; deadline: string | null } | null>(null)
  // Eén sleutel per verzendpoging: een dubbelklik of herhaald verzoek verstuurt nooit twee keer.
  const [sleutel] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`))

  // Ontvanger kan voor contract/access/generic vrij ingevuld worden; voor 'client'
  // komt die uit de context-API.
  const recipientEditable = context.type !== 'client'

  useEffect(() => {
    (async () => {
      try {
        const tplRes = await fetch('/api/admin/email/templates')
        const tpl = await tplRes.json()
        const eigen = (tpl.templates ?? []) as Template[]
        // De ingebouwde template van deze soort tonen zolang er geen eigen versie van bestaat.
        const extra = context.type === 'client' && !eigen.some((t) => t.kind === context.kind) ? ingebouwd(context.kind) : null
        // Bij een contract staat de herinneringsmail altijd in de lijst.
        const herinnering = context.type === 'contract' && !eigen.some((t) => t.kind === 'contract_herinnering') ? ingebouwd('contract_herinnering') : null
        const list = [extra, ...eigen, herinnering].filter((t): t is Template => !!t)
        setTemplates(list)

        if (context.type === 'client') {
          const qs = new URLSearchParams({ client_id: context.clientId })
          if (context.kind) qs.set('kind', context.kind)
          if (context.contractId) qs.set('contract_id', context.contractId)
          if (context.shootId) qs.set('shoot_id', context.shootId)
          if (context.taskId) qs.set('task_id', context.taskId)
          if (context.deadlineId) qs.set('deadline_id', context.deadlineId)
          const ctxRes = await fetch(`/api/admin/email/context?${qs.toString()}`)
          const ctx = await ctxRes.json()
          const vars: MailVars = ctx.vars ?? {}
          setVars(vars)
          if (ctxRes.ok) setToEmail(ctx.toEmail ?? '')
          if (ctx.deadline?.mail_verstuurd_op) setEerder({ verstuurd_op: ctx.deadline.mail_verstuurd_op, deadline: ctx.deadline.mail_deadline ?? null })
          // Een soort zonder template kiest niet langer zomaar de eerste template uit de lijst.
          const suggested = list.find((t) => t.kind === context.kind) ?? (context.kind ? null : list[0])
          if (suggested) applyTemplate(suggested, vars)
        } else if (context.type === 'contract') {
          setToEmail(context.defaultEmail ?? '')
          const vervaldatum = context.expiresAt ? new Date(context.expiresAt + 'T00:00:00').toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
          const vars: MailVars = { klantnaam: context.signerName || context.clientName || 'klant', bedrijfsnaam: context.clientName || '', contractnaam: context.contractTitle, contract_link: context.signLink, datum: vervaldatum }
          setVars(vars)
          const suggested = list.find((t) => t.kind === (context.herinnering ? 'contract_herinnering' : 'contract'))
          if (suggested) applyTemplate(suggested, vars)
          else {
            setSubject(`Contract ter ondertekening — ${context.contractTitle}`)
            setBody(defaultContractBody(context, vervaldatum)); setCtaText(CONTRACT_KNOP); setCtaLink(context.signLink)
          }
        } else if (context.type === 'access') {
          setToEmail(context.toEmail)
          setSubject('Toegang tot NextGenMedia portaal')
          setBody(`Beste,\n\nJe hebt toegang gekregen tot het NextGenMedia klantenportaal van ${context.clientName}.\n\nLogin: ${context.toEmail}${context.tempPassword ? `\nTijdelijk wachtwoord: ${context.tempPassword}` : ''}\n\nLog in via de knop hieronder en wijzig daarna je wachtwoord.\n\nMet vriendelijke groet,\nNextGenMedia`)
          setCtaText('Inloggen'); setCtaLink(`${window.location.origin}/login`)
        } else if (context.type === 'formulier') {
          // E-mailadres van de klant voorstellen (best effort); blijft aanpasbaar.
          if (context.clientId) {
            try {
              const ctxRes = await fetch(`/api/admin/email/context?${new URLSearchParams({ client_id: context.clientId }).toString()}`)
              const ctx = await ctxRes.json()
              if (ctxRes.ok) setToEmail(ctx.toEmail ?? '')
            } catch { /* ontvanger dan zelf invullen */ }
          }
          const tot = context.verlooptOp ? new Date(context.verlooptOp).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
          setSubject(context.formulierTitel)
          setBody(`Beste${context.clientName ? ` ${context.clientName}` : ''},\n\nMag ik je vragen om het formulier "${context.formulierTitel}" in te vullen? Zo hebben we alle informatie om voor jou aan de slag te gaan.\n\nKlik op de knop hieronder om het formulier te openen.${tot ? `\n\nDe link is geldig tot ${tot}.` : ''}\n\nMet vriendelijke groet,\nNextGenMedia`)
          setCtaText('Formulier invullen'); setCtaLink(context.link)
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
    // Bij contracten is de knop altijd "Bekijken" met de tekenlink, wat de template ook zegt.
    setCtaText(context.type === 'contract' ? CONTRACT_KNOP : renderTemplate(t.cta_text ?? '', vars))
    setCtaLink(context.type === 'contract' ? context.signLink : renderTemplate(t.cta_link ?? '', vars))
  }
  const onPick = (id: string) => {
    const t = templates.find((x) => x.id === id)
    // De gegevens van de klant blijven gelden bij het wisselen van template.
    if (t) applyTemplate(t, vars)
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
          body: JSON.stringify({
            to_email: toEmail, cc: cc.trim() || null, kopie_naar_mij: kopieNaarMij, subject, body, cta_text: ctaText || null, cta_link: ctaLink || null,
            template_id: templateId && !templateId.startsWith('standaard:') ? templateId : null, template_name: tpl?.name ?? null,
            herinnering: tpl?.kind === 'contract_herinnering',
          }),
        })
      } else {
        res = await fetch('/api/admin/email/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to_email: toEmail,
            to_client_id: (context.type === 'client' || context.type === 'access') ? context.clientId : context.type === 'formulier' ? (context.clientId ?? null) : null,
            subject, body, cta_text: ctaText || null, cta_link: ctaLink || null,
            template_id: templateId && !templateId.startsWith('standaard:') ? templateId : null, template_name: tpl?.name ?? null,
            kind: context.type === 'client' ? (context.kind ?? 'generic') : 'generic',
            deadline_id: context.type === 'client' ? (context.deadlineId ?? null) : null,
            verzend_sleutel: sleutel,
          }),
        })
      }
      const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Verzenden mislukt')
      setDone(true)
      onSent?.({ id: j.id ?? null, verstuurd_op: j.verstuurd_op ?? null, al_verstuurd: j.al_verstuurd === true })
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
            {eerder && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Voor deze goedkeuringstermijn ging al een mail op {new Date(eerder.verstuurd_op).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{eerder.deadline ? ` (met deadline ${eerder.deadline.split('-').reverse().join('/')})` : ''}. Verstuur enkel opnieuw als dat de bedoeling is.
              </div>
            )}
            {context.type === 'contract' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cc <span className="text-gray-400">— optioneel, meerdere adressen met een komma</span></label>
                <input className={inp} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="collega@bedrijf.be" />
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"><input type="checkbox" checked={kopieNaarMij} onChange={(e) => setKopieNaarMij(e.target.checked)} />Stuur mij een verborgen kopie (bcc)</label>
                <p className="text-[11px] text-gray-400 mt-0.5">De volledige mail wordt bij het contract bewaard onder “Verzonden mails”.</p>
              </div>
            )}
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

const CONTRACT_KNOP = 'Bekijken'

function defaultContractBody(c: { contractTitle: string; signerName?: string | null; clientName?: string | null }, vervaldatum: string): string {
  return `Beste ${c.signerName || c.clientName || 'klant'},\n\n` +
    `Hierbij ontvang je het contract "${c.contractTitle}" ter ondertekening.\n\n` +
    `Klik op de knop hieronder om het contract te bekijken en digitaal te ondertekenen.` +
    (vervaldatum ? `\n\nLet op: deze tekenlink is geldig tot ${vervaldatum}.` : '') +
    `\n\nMet vriendelijke groet,\nNextGenMedia`
}
