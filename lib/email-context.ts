import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { baseUrl } from '@/lib/email'
import { SERVICE_LABELS } from '@/lib/utils'
import type { MailVars } from '@/lib/email-render'
import { dagenTot, maandBereik, maandenTekst, vandaagBrussel } from '@/lib/content/deadline-model'

export type MailContext = { toEmail: string; clientName: string; vars: MailVars }

/** Bouwt de placeholder-waarden + ontvanger voor een klantmail. */
export async function buildClientMailContext(opts: {
  clientId: string
  kind?: string
  contractId?: string | null
  shootId?: string | null
  taskId?: string | null
  deadlineId?: string | null
}): Promise<MailContext | null> {
  const admin = createAdminSupabaseClient()
  const { data: client } = await admin.from('clients').select('*').eq('id', opts.clientId).maybeSingle()
  if (!client) return null

  const base = baseUrl()
  const now = new Date()

  // Dienst: uit contract (indien meegegeven) of de eerste actieve dienst.
  let dienst = ''
  let contractnaam = ''
  let contractLink = ''
  if (opts.contractId) {
    const { data: c } = await admin.from('contracts').select('title, service_slug, access_token').eq('id', opts.contractId).maybeSingle()
    if (c) {
      contractnaam = c.title ?? ''
      contractLink = c.access_token ? `${base}/sign/${c.access_token}` : ''
      if (c.service_slug) dienst = SERVICE_LABELS[c.service_slug] ?? c.service_slug
    }
  }
  if (!dienst) {
    const { data: svc } = await admin.from('client_services').select('service_slug').eq('client_id', opts.clientId).eq('active', true).limit(1)
    const slug = (svc ?? [])[0]?.service_slug
    if (slug) dienst = SERVICE_LABELS[slug] ?? slug
  }

  let datum = now.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })
  let uur = now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
  if (opts.shootId) {
    const { data: shoot } = await admin.from('shoot_briefings').select('shoot_date, start_time').eq('id', opts.shootId).maybeSingle()
    if (shoot?.shoot_date) datum = new Date(shoot.shoot_date + 'T00:00:00').toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })
    if (shoot?.start_time) uur = shoot.start_time
  }

  // Taakvelden (optioneel)
  let taakTitel = ''
  let taakBeschrijving = ''
  let taakDeadline = ''
  if (opts.taskId) {
    const { data: task } = await admin.from('client_tasks').select('title, description, deadline').eq('id', opts.taskId).maybeSingle()
    if (task) {
      taakTitel = task.title ?? ''
      taakBeschrijving = task.description ?? ''
      taakDeadline = task.deadline ? new Date(task.deadline + 'T00:00:00').toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
    }
  }

  // Goedkeuringsdeadline van de contentkalender (optioneel).
  let gDeadline = '', gMaanden = '', gDagen = '', gOpen = ''
  if (opts.deadlineId) {
    const { data: d } = await admin.from('content_goedkeuring_deadlines').select('client_id, maanden, deadline').eq('id', opts.deadlineId).maybeSingle()
    if (d && d.client_id === opts.clientId) {
      gDeadline = new Date(`${d.deadline}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
      gMaanden = maandenTekst(d.maanden as string[])
      const n = dagenTot(d.deadline as string, vandaagBrussel())
      gDagen = n > 1 ? `nog ${n} dagen` : n === 1 ? 'nog 1 dag' : n === 0 ? 'enkel nog vandaag' : 'geen dagen meer'
      let open = 0
      for (const m of d.maanden as string[]) {
        const b = maandBereik(m)
        const { count } = await admin.from('social_content_items').select('id', { count: 'exact', head: true })
          .eq('client_id', opts.clientId).eq('status', 'ready_for_review').gte('planned_date', b.van).lt('planned_date', b.tot)
        open += count ?? 0
      }
      gOpen = String(open)
    }
  }

  const vars: MailVars = {
    klantnaam: client.contact_name || client.company_name || 'klant',
    bedrijfsnaam: client.company_name || '',
    email: client.email || '',
    dienst,
    datum,
    uur,
    contractnaam,
    dashboard_link: `${base}/portal`,
    contract_link: contractLink,
    scripts_link: `${base}/portal/social-media`,
    website_link: `${base}/portal/website`,
    contentshoot_link: `${base}/portal/social-media`,
    taak_titel: taakTitel,
    taak_beschrijving: taakBeschrijving,
    deadline: taakDeadline || gDeadline,
    taak_deadline: taakDeadline,
    taak_link: opts.taskId ? `${base}/portal/tasks#taak-${opts.taskId}` : `${base}/portal/tasks`,
    goedkeuring_deadline: gDeadline,
    goedkeuring_maanden: gMaanden,
    dagen_resterend: gDagen,
    open_items: gOpen,
  }

  return { toEmail: client.email || '', clientName: client.company_name || '', vars }
}
