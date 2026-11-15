import 'server-only'
import { maakOpdrachtTaak, maakTeamTaak, LeadTaakFout } from '@/lib/sales/lead-taken-server'
import { taakIsAf } from '@/lib/sales/lead-taken'
import { filterVan, standaardDeadline, type MailTaakFilter, type MailTaakStatus } from './taken'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type MailTaak = {
  id: string; wat: string; deadline: string | null; citaat: string | null; wie: 'wij' | 'klant'; status: MailTaakStatus; filter: MailTaakFilter
  client_id: string | null; opdracht_id: string | null; klant: string | null; project: string | null
  mail: { richting: 'in' | 'uit'; onderwerp: string | null; op: string; tegenpartij: string | null; mailbox: string } | null
  clickup_url: string | null; clickup_naam: string | null; toegewezen: string | null; reden: string | null; beslist_door: string | null
}

const vandaagBrussel = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

/** De taken uit de mail met alles wat het scherm nodig heeft (laatste 120 dagen). */
export async function mailTakenLijst(admin: Admin): Promise<MailTaak[]> {
  const sinds = new Date(Date.now() - 120 * 86_400_000).toISOString()
  const { data, error } = await admin.from('mail_taken').select('*').gte('created_at', sinds).order('created_at', { ascending: false }).limit(400)
  if (error) return []
  const rijen = (data ?? []) as Record<string, unknown>[]
  const ids = (k: string) => [...new Set(rijen.map((r) => r[k]).filter(Boolean))] as string[]
  const [mails, klanten, projecten, team, opdr] = await Promise.all([
    ids('mail_id').length ? admin.from('mail_berichten').select('id, richting, onderwerp, verzonden_op, tegenpartij, mailbox').in('id', ids('mail_id')) : { data: [] },
    ids('client_id').length ? admin.from('clients').select('id, company_name').in('id', ids('client_id')) : { data: [] },
    ids('opdracht_id').length ? admin.from('opdrachten').select('id, titel, klant_vrij').in('id', ids('opdracht_id')) : { data: [] },
    admin.from('team_taken').select('id, afgerond_op, clickup_status_type, clickup_url, clickup_assignee_naam').in('id', rijen.filter((r) => r.taak_soort === 'team' && r.taak_id).map((r) => r.taak_id as string).concat(['00000000-0000-0000-0000-000000000000'])),
    admin.from('opdracht_taken').select('id, afgerond_op, clickup_status_type, clickup_url, clickup_assignee_naam').in('id', rijen.filter((r) => r.taak_soort === 'opdracht' && r.taak_id).map((r) => r.taak_id as string).concat(['00000000-0000-0000-0000-000000000000'])),
  ])
  const mailVan = new Map(((mails.data ?? []) as { id: string; richting: 'in' | 'uit'; onderwerp: string | null; verzonden_op: string; tegenpartij: string | null; mailbox: string }[]).map((m) => [m.id, m]))
  const klant = new Map(((klanten.data ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
  const project = new Map(((projecten.data ?? []) as { id: string; titel: string; klant_vrij: string | null }[]).map((p) => [p.id, p]))
  type T = { id: string; afgerond_op: string | null; clickup_status_type: string | null; clickup_url: string | null; clickup_assignee_naam: string | null }
  const taken = new Map<string, T>([...((team.data ?? []) as T[]), ...((opdr.data ?? []) as T[])].map((t) => [t.id, t]))
  return rijen.map((r) => {
    const m = r.mail_id ? mailVan.get(r.mail_id as string) ?? null : null
    const p = r.opdracht_id ? project.get(r.opdracht_id as string) ?? null : null
    const t = r.taak_id ? taken.get(r.taak_id as string) ?? null : null
    const status = r.status as MailTaakStatus
    return {
      id: r.id as string, wat: r.wat as string, deadline: (r.deadline as string | null) ?? null, citaat: (r.citaat as string | null) ?? null, wie: (r.wie as 'wij' | 'klant') ?? 'wij',
      status, filter: filterVan({ status, clickup_status_type: (t?.clickup_status_type ?? r.clickup_status_type) as string | null, taak_af: t ? taakIsAf(t) : null }),
      client_id: (r.client_id as string | null) ?? null, opdracht_id: (r.opdracht_id as string | null) ?? null,
      klant: (r.client_id ? klant.get(r.client_id as string) : null) ?? p?.klant_vrij ?? null, project: p?.titel ?? null,
      mail: m ? { richting: m.richting, onderwerp: m.onderwerp, op: m.verzonden_op, tegenpartij: m.tegenpartij, mailbox: m.mailbox } : null,
      clickup_url: t?.clickup_url ?? (r.clickup_url as string | null) ?? null, clickup_naam: (r.clickup_naam as string | null) ?? null,
      toegewezen: t?.clickup_assignee_naam ?? null, reden: (r.reden as string | null) ?? null, beslist_door: (r.beslist_door as string | null) ?? null,
    }
  })
}

/**
 * Zet taak: een gewone ClickUp-taak via dezelfde flow als Taken toewijzen
 * (bij het project als we het kennen, anders als teamtaak bij de klant). De id
 * van de taak uit de mail is de sleutel: twee keer klikken maakt één taak.
 */
export async function planMailTaak(admin: Admin, id: string, b: { omschrijving?: unknown; deadline?: unknown; assignee_id?: unknown; merk?: unknown }, door: { userId: string | null; email: string | null; naam: string | null }): Promise<void> {
  const { data } = await admin.from('mail_taken').select('*').eq('id', id).maybeSingle()
  const t = data as { id: string; wat: string; deadline: string | null; citaat: string | null; status: string; client_id: string | null; opdracht_id: string | null; mail_id: string | null } | null
  if (!t) throw new LeadTaakFout('Taak niet gevonden.', 404)
  if (t.status === 'ingepland') return
  const { data: m } = t.mail_id ? await admin.from('mail_berichten').select('richting, onderwerp, verzonden_op, tegenpartij').eq('id', t.mail_id).maybeSingle() : { data: null }
  const mail = m as { richting: string; onderwerp: string | null; verzonden_op: string; tegenpartij: string | null } | null
  const dag = mail ? new Date(mail.verzonden_op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' }) : null
  const notitie = [mail ? `Uit de mail ${mail.richting === 'uit' ? 'van ons' : `van ${mail.tegenpartij ?? 'de klant'}`} van ${dag}${mail.onderwerp ? ` ("${mail.onderwerp}")` : ''}.` : null, t.citaat ? `"${t.citaat}"` : null].filter(Boolean).join('\n')
  const invoer = {
    omschrijving: String(b.omschrijving ?? t.wat).trim() || t.wat,
    deadline: typeof b.deadline === 'string' && b.deadline ? b.deadline : t.deadline && t.deadline >= vandaagBrussel() ? t.deadline : standaardDeadline(vandaagBrussel()),
    assignee_id: b.assignee_id, merk: b.merk, notitie, aanvraag_sleutel: t.id,
  }
  let soort: 'team' | 'opdracht', taakId: string
  if (t.opdracht_id) {
    const r = await maakOpdrachtTaak(admin, t.opdracht_id, invoer, door)
    soort = 'opdracht'; taakId = r.taak.id
  } else {
    const r = await maakTeamTaak(admin, { ...invoer, client_id: t.client_id }, door)
    soort = 'team'; taakId = r.taak.id
  }
  await admin.from('mail_taken').update({ status: 'ingepland', taak_soort: soort, taak_id: taakId, wat: invoer.omschrijving.slice(0, 200), beslist_door: door.naam ?? door.email, beslist_op: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
}

/** Verwijder (niets te doen) of terugzetten naar Te beslissen. */
export async function zetMailTaak(admin: Admin, id: string, status: 'verwijderd' | 'voorstel', door: string | null): Promise<void> {
  const { data } = await admin.from('mail_taken').select('status').eq('id', id).maybeSingle()
  if (!data) throw new LeadTaakFout('Taak niet gevonden.', 404)
  if ((data as { status: string }).status === 'ingepland') throw new LeadTaakFout('Deze taak staat al in ClickUp. Vink ze daar of in Taken af.', 409)
  await admin.from('mail_taken').update({ status, beslist_door: door, beslist_op: new Date().toISOString(), updated_at: new Date().toISOString(), ...(status === 'voorstel' ? { clickup_task_id: null, clickup_url: null, clickup_naam: null, clickup_status_type: null, reden: null } : {}) }).eq('id', id)
}
