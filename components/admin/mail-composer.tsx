'use client'

import { useEffect, useState } from 'react'
import { Mail, X, Loader2, Send, CheckCircle2 } from 'lucide-react'
import { renderTemplate, type MailVars } from '@/lib/email-render'
import { DEFAULT_TEMPLATES } from '@/lib/email-templates-defaults'
import { MERK_STIJL, MAIL_MERKEN, type MailMerk } from '@/lib/merk-mail'
import { offerteMail } from '@/lib/offertes'
import { welkomstMail } from '@/lib/klant-account'
import { mailVoorstel } from '@/lib/algemene-contracten/model'
import { aanhefVoor, adresSleutel, alleGebruikers, extraAdressen, metAanhef, standaardKeuze, type Ontvanger } from '@/lib/opleveringen-ontvangers'
import { standaardShootKeuze } from '@/lib/shoots/model'

// Eén gedeelde mailcomponent voor ALLE handmatige mails (klant/contract/taak/
// toegang/algemeen). Altijd preview + handmatige bevestiging; nooit automatisch.
// Server-side logging blijft via de bestaande E-mail Center-routes.

type Template = { id: string; name: string; subject: string; body: string; kind: string | null; cta_text: string | null; cta_link: string | null }

export type MailContext =
  | { type: 'client'; clientId: string; kind?: string; contractId?: string; shootId?: string; taskId?: string; deadlineId?: string }
  // herinnering: opent met de herinneringsmail i.p.v. de eerste contractmail.
  | { type: 'contract'; contractId: string; contractTitle: string; signLink: string; defaultEmail?: string | null; signerName?: string | null; clientName?: string | null; expiresAt?: string | null; herinnering?: boolean }
  | { type: 'access'; clientId: string; clientName: string; toEmail: string; tempPassword?: string }
  | { type: 'klantaccount'; clientId: string; clientName: string }
  | { type: 'generic'; toEmail?: string }
  // Formulierlink (Formulieren → Delen): onderwerp/tekst/knop voorgevuld, ontvanger aanpasbaar.
  | { type: 'formulier'; link: string; formulierTitel: string; clientId?: string | null; clientName?: string | null; verlooptOp?: string | null }
  // Meeting Inplanner: mail aan de deelnemers, altijd vanuit info@nextgenmedia.be.
  | { type: 'meeting'; meetingId: string }
  // Oplevering (video, ontwerp, foto's, documenten): de klant laten weten dat er een versie klaarstaat (link naar de klantapp).
  | { type: 'oplevering'; titel: string; versieLabel: string; link: string; clientId: string; clientName?: string | null; verlooptOp?: string | null; soort?: string | null }
  // Offerte: de knop in de mail opent altijd de publieke offertepagina (accepteren met één knop).
  | { type: 'offerte'; offerteId: string; titel: string; link: string; klant?: string | null; contact?: string | null; email?: string | null; geldigTot?: string | null; merk?: MailMerk | null }
  // Algemeen contract (huur, verzekering, NDA …): de knop opent een persoonlijke link (bekijken, downloaden, eventueel tekenen); de PDF als bijlage.
  | { type: 'algemeen_contract'; contractId: string; titel: string; email?: string | null; tegenpartij?: string | null; partijNodig: boolean; partijGetekend: boolean; onsGetekend: boolean }
  // Shoot planner: het shootplan naar iedereen die erbij is. Eén mail per persoon, elk met een eigen link; de pdf als bijlage.
  | { type: 'shoot'; shootId: string }

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
  // Meeting: van welk adres de mail vertrekt, of waarom dat nu niet kan. Kopie in de info@-mailbox.
  const [afzender, setAfzender] = useState<{ ok: boolean; van: string; fout?: string } | null>(null)
  const [kopieInfo, setKopieInfo] = useState(true)
  // Algemeen contract: de huidige PDF (met de handtekeningen) als bijlage meesturen.
  const [bijlage, setBijlage] = useState(true)
  // Huisstijl van de mail: NextGenMedia (geel) of NextGenSolutions (blauw). Meetingmails vertrekken altijd van NextGenMedia.
  const [merk, setMerk] = useState<MailMerk>('nextgenmedia')
  const stijl = MERK_STIJL[context.type === 'meeting' ? 'nextgenmedia' : merk]
  // Wisselen van merk past ook de merknaam in onderwerp en tekst aan ("Met vriendelijke groet, NextGenMedia").
  const kiesMerk = (m: MailMerk) => {
    if (m === merk) return
    const oud = new RegExp(MERK_STIJL[merk].naam, 'g'), nieuw = MERK_STIJL[m].naam
    setSubject((x) => x.replace(oud, nieuw)); setBody((x) => x.replace(oud, nieuw)); setMerk(m)
  }
  // Oplevering: alle accounts van de klant om uit te kiezen ("Alle gebruikers"), plus vrije adressen. Eén mail per persoon.
  const [ontvangers, setOntvangers] = useState<Ontvanger[] | null>(null)
  const [gekozen, setGekozen] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const [verstuurdAan, setVerstuurdAan] = useState<string[]>([])
  const opl = context.type === 'oplevering'
  // Shoot: dezelfde keuze van ontvangers als bij een oplevering (iedereen bij "Wie is erbij").
  const isShoot = context.type === 'shoot'
  const meer = opl || isShoot
  const [shootKlant, setShootKlant] = useState<string | null>(null)
  const [shootNog, setShootNog] = useState<string[]>([])
  const extraLijst = extraAdressen(extra)
  const aanLijst: { email: string; naam: string | null; soort: Ontvanger['soort'] | 'extra' }[] = meer
    ? [
        ...(ontvangers ?? []).filter((o) => gekozen.includes(o.email)),
        ...extraLijst.geldig.filter((e) => !gekozen.some((g) => g.toLowerCase() === e.toLowerCase())).map((email) => ({ email, naam: null, soort: 'extra' as const })),
      ]
    : []
  const wissel = (email: string) => setGekozen((l) => (l.includes(email) ? l.filter((x) => x !== email) : [...l, email]))
  // Eén sleutel per verzendpoging: een dubbelklik of herhaald verzoek verstuurt nooit twee keer.
  const [sleutel] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`))

  // Ontvanger kan voor contract/access/generic vrij ingevuld worden; voor 'client'
  // komt die uit de context-API.
  const recipientEditable = context.type !== 'client'

  useEffect(() => {
    (async () => {
      try {
        // Een meetingmail vertrekt uit de meeting zelf, niet uit een template.
        const tpl = context.type === 'meeting' || context.type === 'offerte' || context.type === 'algemeen_contract' || context.type === 'shoot' ? { templates: [] } : await (await fetch('/api/admin/email/templates')).json()
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
        } else if (context.type === 'klantaccount') {
          // Welkomstmail: de knop wordt bij het versturen een persoonlijke link (7 dagen) om zelf een wachtwoord te kiezen.
          const r = await fetch(`/api/admin/clients/${context.clientId}/account`, { cache: 'no-store' })
          const j = await r.json()
          if (!r.ok) throw new Error(j.error || 'Laden mislukt')
          const m = welkomstMail({ klant: j.klant ?? context.clientName, contact: j.contact ?? null, email: j.email ?? '' })
          setToEmail(j.email ?? '')
          setSubject(m.onderwerp); setBody(m.tekst); setCtaText(m.knop); setCtaLink(`${window.location.origin}/welkom/(persoonlijke link, aangemaakt bij het versturen)`)
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
        } else if (context.type === 'oplevering') {
          // Alle accounts van de klant; lukt dat niet, dan het algemene adres van de klant als vrij adres (zoals vroeger).
          try {
            const r = await fetch(`/api/admin/opleveringen/ontvangers?${new URLSearchParams({ client_id: context.clientId }).toString()}`, { cache: 'no-store' })
            const j = await r.json()
            if (!r.ok) throw new Error(j.error)
            const lijst = (j.ontvangers ?? []) as Ontvanger[]
            setOntvangers(lijst); setGekozen(standaardKeuze(lijst))
          } catch {
            setOntvangers([])
            try {
              const ctxRes = await fetch(`/api/admin/email/context?${new URLSearchParams({ client_id: context.clientId }).toString()}`)
              const ctx = await ctxRes.json()
              if (ctxRes.ok) setExtra(ctx.toEmail ?? '')
            } catch { /* ontvanger dan zelf invullen */ }
          }
          const tot = context.verlooptOp ? new Date(context.verlooptOp).toLocaleString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : ''
          setSubject(`${context.versieLabel}: ${context.titel}`)
          setBody(`Beste [voornaam],\n\n${context.versieLabel === 'Finale versie' ? 'De finale versie' : `De ${context.versieLabel.toLowerCase()}`} van "${context.titel}" staat klaar in de klantapp. Je kan ${context.soort && context.soort !== 'video' ? 'de bestanden' : 'de video'} daar bekijken, in volle kwaliteit downloaden${context.versieLabel === 'Finale versie' ? '' : ' en je feedback geven'}.${tot ? `\n\nDe bestanden blijven beschikbaar tot ${tot}. Download ze dus tijdig.` : ''}\n\nMet vriendelijke groet,\nNextGenMedia`)
          setCtaText(context.soort && context.soort !== 'video' ? 'Bekijk de oplevering' : 'Bekijk de video'); setCtaLink(context.link)
        } else if (context.type === 'shoot') {
          const r = await fetch(`/api/admin/shoots/${context.shootId}/mail`, { cache: 'no-store' })
          const j = await r.json()
          if (!r.ok) throw new Error(j.error || 'Laden mislukt')
          const lijst = (j.ontvangers ?? []) as Ontvanger[]
          setOntvangers(lijst); setGekozen(standaardShootKeuze(lijst))
          setShootKlant(j.klant ?? null); setShootNog(j.nog ?? [])
          setSubject(j.voorstel.onderwerp); setBody(j.voorstel.tekst); setCtaText(j.voorstel.knop)
          setCtaLink(`${window.location.origin}/shoot/(persoonlijke link per ontvanger)`)
        } else if (context.type === 'algemeen_contract') {
          const m = mailVoorstel({ titel: context.titel, tegenpartij: context.tegenpartij ?? null, partij_nodig: context.partijNodig, partij_getekend_op: context.partijGetekend ? 'ja' : null, ons_getekend_op: context.onsGetekend ? 'ja' : null })
          setToEmail(context.email ?? '')
          setSubject(m.onderwerp); setBody(m.tekst); setCtaText(m.knop); setCtaLink(`${window.location.origin}/document/(persoonlijke link, aangemaakt bij het versturen)`)
        } else if (context.type === 'offerte') {
          const m = offerteMail({ contact: context.contact ?? null, klant: context.klant ?? null, titel: context.titel, geldigTot: context.geldigTot ?? null, merk: context.merk ?? 'nextgenmedia' })
          setToEmail(context.email ?? '')
          setSubject(m.onderwerp); setBody(m.tekst); setCtaText(m.knop); setCtaLink(context.link)
          if (context.merk) setMerk(context.merk)
        } else if (context.type === 'meeting') {
          const r = await fetch(`/api/admin/meetings/${context.meetingId}/mail`)
          const j = await r.json()
          if (!r.ok) throw new Error(j.error || 'Laden mislukt')
          setToEmail((j.voorstel.aan as string[]).join(', '))
          setSubject(j.voorstel.onderwerp); setBody(j.voorstel.tekst)
          setCtaText(j.voorstel.ctaTekst ?? ''); setCtaLink(j.voorstel.ctaLink ?? '')
          setAfzender(j.afzender)
        } else {
          setToEmail(context.toEmail ?? '')
        }
      } catch (e) { setError(e instanceof Error && (context.type === 'meeting' || context.type === 'klantaccount' || context.type === 'shoot') ? e.message : 'Laden mislukt') } finally { setLoadingCtx(false) }
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

  /** Oplevering: één mail per ontvanger, elk met de eigen aanhef en een eigen verzendsleutel (nooit dubbel). */
  const sendOplevering = async () => {
    if (context.type !== 'oplevering' && context.type !== 'shoot') return
    if (extraLijst.ongeldig.length) { setError(`Geen geldig e-mailadres: ${extraLijst.ongeldig.join(', ')}`); return }
    if (!aanLijst.length) { setError('Kies minstens één ontvanger.'); return }
    if (!subject.trim()) { setError('Onderwerp is verplicht'); return }
    setSending(true); setError(null)
    const tpl = templates.find((t) => t.id === templateId)
    const gelukt: string[] = [], mislukt: string[] = []
    let laatste: MailVerstuurd | null = null
    for (const o of aanLijst) {
      try {
        const res = context.type === 'shoot' ? await fetch(`/api/admin/shoots/${context.shootId}/mail`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to_email: o.email, naam: o.naam, subject, body: metAanhef(body, aanhefVoor(o, shootKlant)), cta_text: ctaText || null,
            verzend_sleutel: adresSleutel(sleutel, o.email), merk, bijlage,
          }),
        }) : await fetch('/api/admin/email/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to_email: o.email, to_client_id: context.clientId,
            subject, body: metAanhef(body, aanhefVoor(o, context.clientName)), cta_text: ctaText || null, cta_link: ctaLink || null,
            template_id: templateId && !templateId.startsWith('standaard:') ? templateId : null, template_name: tpl?.name ?? null,
            kind: 'generic', verzend_sleutel: adresSleutel(sleutel, o.email), merk,
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error || 'Verzenden mislukt')
        gelukt.push(o.email)
        laatste = { id: j.id ?? null, verstuurd_op: j.verstuurd_op ?? null, al_verstuurd: j.al_verstuurd === true }
      } catch (e) { mislukt.push(`${o.email} (${e instanceof Error ? e.message : 'fout'})`) }
    }
    setVerstuurdAan(gelukt)
    setSending(false)
    if (mislukt.length) {
      setError(`${gelukt.length ? `Verstuurd naar ${gelukt.length}. ` : ''}Niet gelukt voor ${mislukt.join(', ')}. Opnieuw versturen stuurt enkel naar wie nog niets kreeg.`)
      return
    }
    setToEmail(gelukt.join(', '))
    setDone(true)
    if (laatste) onSent?.(laatste)
  }

  const send = async () => {
    if (meer) return sendOplevering()
    if (!toEmail.trim()) { setError('Geen e-mailadres'); return }
    if (!subject.trim()) { setError('Onderwerp is verplicht'); return }
    setSending(true); setError(null)
    try {
      const tpl = templates.find((t) => t.id === templateId)
      let res: Response
      if (context.type === 'meeting') {
        res = await fetch(`/api/admin/meetings/${context.meetingId}/mail`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aan: toEmail, onderwerp: subject, tekst: body, cta_tekst: ctaText || null, cta_link: ctaLink || null, verzend_sleutel: sleutel, kopie_info: kopieInfo }),
        })
      } else if (context.type === 'algemeen_contract') {
        res = await fetch(`/api/admin/algemene-contracten/${context.contractId}/mail`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_email: toEmail, subject, body, cta_text: ctaText || null, verzend_sleutel: sleutel, merk, bijlage }),
        })
      } else if (context.type === 'offerte') {
        res = await fetch(`/api/admin/offertes/${context.offerteId}/send-mail`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_email: toEmail, subject, body, cta_text: ctaText || null, verzend_sleutel: sleutel, merk }),
        })
      } else if (context.type === 'klantaccount') {
        res = await fetch(`/api/admin/clients/${context.clientId}/welkomstmail`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_email: toEmail, subject, body, cta_text: ctaText || null, verzend_sleutel: sleutel, merk }),
        })
      } else if (context.type === 'contract') {
        res = await fetch(`/api/admin/contracts/${context.contractId}/send-mail`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to_email: toEmail, cc: cc.trim() || null, kopie_naar_mij: kopieNaarMij, subject, body, cta_text: ctaText || null, cta_link: ctaLink || null,
            template_id: templateId && !templateId.startsWith('standaard:') ? templateId : null, template_name: tpl?.name ?? null,
            herinnering: tpl?.kind === 'contract_herinnering', merk,
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
            verzend_sleutel: sleutel, merk,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold flex items-center gap-2"><Mail className="h-4 w-4" />Mail versturen</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        {done ? (
          <div className="p-8 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
            <p className="text-sm font-medium">{meer && verstuurdAan.length > 1 ? `Mail verstuurd naar ${verstuurdAan.length} personen` : `Mail verstuurd naar ${toEmail}`}</p>
            {meer && verstuurdAan.length > 1 && <p className="text-xs text-gray-600">{verstuurdAan.join(', ')}. Elk kreeg een eigen mail; ze staan in het E-mail Center.</p>}
            {context.type === 'meeting' && afzender && <p className="text-xs text-gray-600">Vanaf {afzender.van}{kopieInfo ? ', met een kopie in de mailbox van info@nextgenmedia.be' : ''}. Staat in het E-mail Center.</p>}
            <button onClick={onClose} className="btn-primary">Sluiten</button>
          </div>
        ) : loadingCtx ? (
          <div className="p-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : (
          <div className="p-5 space-y-3">
            {context.type === 'meeting' && afzender && (
              afzender.ok
                ? <div className="text-xs text-gray-600"><span className="font-medium text-gray-700">Van:</span> {afzender.van}</div>
                : <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">Versturen kan nu niet: {afzender.fout}</div>
            )}
            {isShoot && shootNog.length > 0 && (
              <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Nog aan te vullen in het plan: {shootNog.join(' · ')}. Versturen mag; wie de link heeft, ziet later altijd de laatste versie.</div>
            )}
            {meer ? (
              <OntvangersKiezer ontvangers={ontvangers ?? []} gekozen={gekozen} onWissel={wissel} onKies={setGekozen}
                extra={extra} onExtra={setExtra} ongeldig={extraLijst.ongeldig} aantal={aanLijst.length} verstuurdAan={verstuurdAan}
                alleLabel={isShoot ? 'Iedereen bij de shoot' : undefined}
                leeg={isShoot ? 'Nog niemand met een e-mailadres bij "Wie is erbij". Vul hieronder een adres in.' : undefined} />
            ) : (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Aan{context.type === 'meeting' && <span className="text-gray-400"> — meerdere adressen met een komma</span>}</label>
              {recipientEditable
                ? <input className={inp} value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="ontvanger@bedrijf.be" />
                : <div className="text-sm text-gray-800">{toEmail || '— geen e-mailadres —'}</div>}
            </div>
            )}
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
            {isShoot && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"><input type="checkbox" checked={bijlage} onChange={(e) => setBijlage(e.target.checked)} />Het shootplan als pdf meesturen</label>
            )}
            {context.type === 'algemeen_contract' && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"><input type="checkbox" checked={bijlage} onChange={(e) => setBijlage(e.target.checked)} />{context.onsGetekend || context.partijGetekend ? 'De getekende PDF' : 'De PDF'} als bijlage meesturen (tot 10 MB)</label>
            )}
            {context.type === 'algemeen_contract' || isShoot ? null : context.type === 'meeting' ? (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer"><input type="checkbox" checked={kopieInfo} onChange={(e) => setKopieInfo(e.target.checked)} />Kopie in de mailbox van info@nextgenmedia.be (bcc)</label>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Template</label>
                <select className={inp} value={templateId} onChange={(e) => onPick(e.target.value)}>
                  <option value="">— Eigen mail —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            {context.type !== 'meeting' && (
              <div>
                <span className="block text-xs font-medium text-gray-600 mb-1">Huisstijl</span>
                <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
                  {MAIL_MERKEN.map((m) => (
                    <button key={m} type="button" onClick={() => kiesMerk(m)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${merk === m ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
                      <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: MERK_STIJL[m].accent }} />{MERK_STIJL[m].naam}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Knop-link</label><input className={`${inp} ${context.type === 'offerte' || context.type === 'algemeen_contract' || isShoot ? 'bg-gray-50 text-gray-500' : ''}`} value={ctaLink} onChange={(e) => setCtaLink(e.target.value)} readOnly={context.type === 'offerte' || context.type === 'algemeen_contract' || isShoot} title={context.type === 'offerte' ? 'De knop opent altijd de offerte' : context.type === 'algemeen_contract' ? 'Elke ontvanger krijgt een eigen link (30 dagen geldig)' : isShoot ? 'Elke ontvanger krijgt een eigen link naar het shootplan (geldig tot twee weken na de shoot)' : undefined} placeholder="https://…" /></div>
            </div>
            {/* Preview */}
            <div className="rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
              <div className="px-3 py-2 bg-white text-sm font-extrabold tracking-tight text-gray-900" style={{ borderBottom: `3px solid ${stijl.accent}` }}>
                {stijl.deel1}<span style={{ borderBottom: `3px solid ${stijl.accent}` }}>{stijl.deel2}</span>
                <span className="float-right text-[11px] font-normal text-gray-400 pt-0.5">Voorbeeld</span>
              </div>
              <div className="p-3">
                <div className="text-xs text-gray-700 whitespace-pre-wrap">{body || '—'}</div>
                {ctaText && ctaLink && (
                  <span className="inline-block mt-2 rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-semibold text-white" style={{ borderBottom: `3px solid ${stijl.accent}` }}>{ctaText}</span>
                )}
                <div className="mt-3 text-[10px] text-gray-400">{stijl.naam} · {stijl.adres}</div>
              </div>
            </div>
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
            <div className="flex gap-2 pt-1">
              <button onClick={send} disabled={sending || (meer ? !aanLijst.length : !toEmail) || (context.type === 'meeting' && !afzender?.ok)} className="btn-primary flex-1 justify-center">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{context.type === 'meeting' ? 'Versturen' : meer && aanLijst.length > 1 ? `Verstuur naar ${aanLijst.length} personen` : 'Verstuur'}</button>
              <button onClick={onClose} className="btn-secondary">Annuleer</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const CONTRACT_KNOP = 'Bekijken'

const SOORT_LABEL: Record<Ontvanger['soort'], string> = { eigenaar: 'Hoofdaccount', gebruiker: 'Gebruiker', klantadres: 'Algemeen adres van de klant' }

/** Oplevering: kies wie de mail krijgt. "Alle gebruikers" = iedereen met een account die de oplevering kan bekijken. */
function OntvangersKiezer({ ontvangers, gekozen, onWissel, onKies, extra, onExtra, ongeldig, aantal, verstuurdAan, alleLabel = 'Alle gebruikers', leeg }: {
  ontvangers: Ontvanger[]; gekozen: string[]; onWissel: (email: string) => void; onKies: (l: string[]) => void
  extra: string; onExtra: (v: string) => void; ongeldig: string[]; aantal: number; verstuurdAan: string[]
  alleLabel?: string; leeg?: string
}) {
  const alle = alleGebruikers(ontvangers)
  const allesAan = alle.length > 0 && alle.every((e) => gekozen.includes(e))
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-gray-600 flex-1">Aan</span>
        {alle.length > 0 && (
          <button type="button" onClick={() => onKies(allesAan ? gekozen.filter((e) => !alle.includes(e)) : Array.from(new Set([...gekozen, ...alle])))}
            className={`text-xs px-3 py-1 rounded-full border ${allesAan ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 hover:bg-gray-50'}`}>
            {alleLabel} ({alle.length})
          </button>
        )}
      </div>
      {ontvangers.length > 0 ? (
        <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {ontvangers.map((o) => (
            <li key={o.email}>
              <label className={`flex items-center gap-2.5 px-3 py-2 text-sm ${o.kan ? 'cursor-pointer hover:bg-gray-50' : 'opacity-60 cursor-not-allowed'}`} title={o.reden ?? undefined}>
                <input type="checkbox" disabled={!o.kan} checked={o.kan && gekozen.includes(o.email)} onChange={() => onWissel(o.email)} className="h-4 w-4 accent-gray-900 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.naam ? <><span className="font-medium">{o.naam}</span> <span className="text-gray-500">· {o.email}</span></> : o.email}</span>
                  <span className="block text-[11px] text-gray-500">{o.reden ?? o.label ?? SOORT_LABEL[o.soort]}{verstuurdAan.includes(o.email) ? ' · verstuurd' : ''}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-500">{leeg ?? 'Deze klant heeft nog geen accounts in de klantapp. Vul hieronder een adres in.'}</p>
      )}
      <div>
        <label className="block text-[11px] text-gray-500 mb-1">Andere adressen <span className="text-gray-400">(optioneel, met een komma)</span></label>
        <input className={`w-full px-3 py-2 text-sm border rounded-lg ${ongeldig.length ? 'border-red-300' : 'border-gray-200'}`} value={extra} onChange={(e) => onExtra(e.target.value)} placeholder="collega@bedrijf.be" />
        {ongeldig.length > 0 && <p className="text-[11px] text-red-600 mt-0.5">Geen geldig adres: {ongeldig.join(', ')}</p>}
      </div>
      <p className="text-[11px] text-gray-500">{aantal > 1 ? `${aantal} personen krijgen elk een eigen mail` : aantal === 1 ? 'Eén persoon krijgt de mail' : 'Nog niemand gekozen'}; [voornaam] in de tekst wordt hun voornaam.</p>
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
