import 'server-only'

// Centrale tool-engine voor NextGen AI. Elke tool roept een BESTAANDE admin-API
// aan (geen eigen businesslogica, geen duplicatie). De AI stelt tool-calls voor;
// uitvoeren gebeurt pas na bevestiging via /api/admin/ai-execute.

export type ToolParam = { type: 'string' | 'number' | 'array'; required?: boolean; desc: string }

export type ToolDef = {
  name: string
  label: string
  description: string
  destructive?: boolean
  encoding?: 'json' | 'form'
  method: 'POST' | 'PATCH'
  params: Record<string, ToolParam>
  path: (p: Record<string, unknown>) => string
  body: (p: Record<string, unknown>) => Record<string, unknown>
  summary: (p: Record<string, unknown>) => string
}

const s = (v: unknown) => (v == null ? '' : String(v))
function randomPassword(): string {
  return 'Ngm' + Math.random().toString(36).slice(2, 10) + Math.floor(Math.random() * 90 + 10)
}

export const AI_TOOLS: ToolDef[] = [
  {
    name: 'create_client', label: 'Klant aanmaken', method: 'POST', encoding: 'json',
    description: 'Maak een nieuwe klant (bedrijf + login). Vereist minstens één dienst.',
    params: {
      company_name: { type: 'string', required: true, desc: 'Bedrijfsnaam' },
      email: { type: 'string', required: true, desc: 'Login e-mail' },
      contact_name: { type: 'string', desc: 'Contactpersoon' },
      btw_nummer: { type: 'string', desc: 'BTW-nummer (BE…)' },
      services: { type: 'array', required: true, desc: 'Diensten, bv. ["social-media"]' },
      password: { type: 'string', desc: 'Wachtwoord (wordt gegenereerd indien leeg)' },
    },
    path: () => '/api/admin/clients',
    body: (p) => ({
      company_name: s(p.company_name), email: s(p.email), contact_name: s(p.contact_name) || '',
      btw_nummer: s(p.btw_nummer) || '', password: s(p.password) || randomPassword(),
      services: Array.isArray(p.services) && p.services.length ? p.services : ['social-media'],
      platforms: [], service_configs: {},
    }),
    summary: (p) => `Klant "${s(p.company_name)}" aanmaken (${s(p.email)})`,
  },
  {
    name: 'update_client', label: 'Klant wijzigen', method: 'PATCH', encoding: 'json',
    description: 'Wijzig velden van een bestaande klant (naam, contact, niche, website, BTW).',
    params: {
      id: { type: 'string', required: true, desc: 'Klant-id' },
      company_name: { type: 'string', desc: 'Bedrijfsnaam' },
      contact_name: { type: 'string', desc: 'Contactpersoon' },
      niche: { type: 'string', desc: 'Niche' },
      website_url: { type: 'string', desc: 'Website' },
      btw_nummer: { type: 'string', desc: 'BTW-nummer' },
    },
    path: (p) => `/api/admin/clients/${s(p.id)}`,
    body: (p) => {
      const out: Record<string, unknown> = {}
      for (const k of ['company_name', 'contact_name', 'niche', 'website_url', 'btw_nummer']) if (p[k] !== undefined) out[k] = s(p[k])
      return out
    },
    summary: (p) => `Klant wijzigen (${s(p.id).slice(0, 8)}…)`,
  },
  {
    name: 'create_invoice', label: 'Factuur aanmaken', method: 'POST', encoding: 'json',
    description: 'Maak een eenmalige factuur. Prognose wordt automatisch gematcht/aangemaakt.',
    params: {
      client_id: { type: 'string', required: true, desc: 'Klant-id' },
      amount_excl: { type: 'number', required: true, desc: 'Bedrag excl. btw' },
      invoice_month: { type: 'string', required: true, desc: 'Maand YYYY-MM' },
      description: { type: 'string', desc: 'Omschrijving' },
      service_slug: { type: 'string', desc: 'Dienst-slug' },
      contract_id: { type: 'string', desc: 'Gekoppeld contract-id' },
    },
    path: () => '/api/admin/invoices',
    body: (p) => ({ action: 'one_time', client_id: s(p.client_id), amount_excl: Number(p.amount_excl) || 0, invoice_month: s(p.invoice_month), description: s(p.description) || null, service_slug: s(p.service_slug) || null, contract_id: s(p.contract_id) || null }),
    summary: (p) => `Factuur €${s(p.amount_excl)} excl. voor maand ${s(p.invoice_month)}`,
  },
  {
    name: 'create_prognose', label: 'Prognose aanmaken', method: 'POST', encoding: 'json',
    description: 'Maak een prognose (verwachte omzet). type "one_time" of "recurring".',
    params: {
      client_id: { type: 'string', required: true, desc: 'Klant-id' },
      type: { type: 'string', required: true, desc: 'one_time of recurring' },
      title: { type: 'string', desc: 'Titel' },
      service_slug: { type: 'string', desc: 'Dienst-slug' },
      amount: { type: 'number', desc: 'Bedrag (one_time)' },
      transaction_month: { type: 'string', desc: 'Maand YYYY-MM (one_time)' },
      amount_per_month: { type: 'number', desc: 'Bedrag/maand (recurring)' },
      start_month: { type: 'string', desc: 'Startmaand YYYY-MM (recurring)' },
    },
    path: () => '/api/admin/revenue',
    body: (p) => ({
      type: s(p.type) === 'recurring' ? 'recurring' : 'one_time', client_id: s(p.client_id),
      title: s(p.title) || null, service_slug: s(p.service_slug) || null,
      amount: p.amount != null ? Number(p.amount) : undefined, transaction_month: p.transaction_month ? `${s(p.transaction_month)}-01` : undefined,
      amount_per_month: p.amount_per_month != null ? Number(p.amount_per_month) : undefined, start_month: p.start_month ? `${s(p.start_month)}-01` : undefined,
    }),
    summary: (p) => `Prognose (${s(p.type)}) voor klant ${s(p.client_id).slice(0, 8)}…`,
  },
  {
    name: 'create_task', label: 'Taak aanmaken', method: 'POST', encoding: 'form',
    description: 'Maak een klanttaak.',
    params: {
      client_id: { type: 'string', required: true, desc: 'Klant-id' },
      title: { type: 'string', required: true, desc: 'Titel' },
      description: { type: 'string', desc: 'Omschrijving' },
      deadline: { type: 'string', desc: 'Deadline YYYY-MM-DD' },
      priority: { type: 'string', desc: 'laag/normaal/hoog' },
    },
    path: () => '/api/admin/tasks',
    body: (p) => ({ client_id: s(p.client_id), title: s(p.title), description: s(p.description) || '', deadline: s(p.deadline) || '', priority: s(p.priority) || 'normaal' }),
    summary: (p) => `Taak "${s(p.title)}" voor klant ${s(p.client_id).slice(0, 8)}…`,
  },
  {
    name: 'create_contract_from_template', label: 'Contract uit template', method: 'POST', encoding: 'json',
    description: 'Maak een contract op basis van een bestaande template.',
    params: {
      template_id: { type: 'string', required: true, desc: 'Template-id' },
      client_id: { type: 'string', desc: 'Klant-id (optioneel)' },
      title: { type: 'string', desc: 'Contracttitel' },
      signer_name: { type: 'string', desc: 'Ontvangernaam' },
      signer_email: { type: 'string', desc: 'Ontvanger e-mail' },
    },
    path: () => '/api/admin/contracts/from-template',
    body: (p) => ({ template_id: s(p.template_id), client_id: s(p.client_id) || null, title: s(p.title) || null, signer_name: s(p.signer_name) || null, signer_email: s(p.signer_email) || null }),
    summary: (p) => `Contract uit template (${s(p.template_id).slice(0, 8)}…)`,
  },
  {
    name: 'link_invoice_contract', label: 'Factuur ↔ contract koppelen', method: 'POST', encoding: 'json',
    description: 'Koppel een bestaande factuur aan een contract.',
    params: {
      contract_id: { type: 'string', required: true, desc: 'Contract-id' },
      invoice_id: { type: 'string', required: true, desc: 'Factuur-id' },
    },
    path: (p) => `/api/admin/contracts/${s(p.contract_id)}/invoices`,
    body: (p) => ({ invoice_id: s(p.invoice_id) }),
    summary: () => 'Factuur aan contract koppelen',
  },
  {
    name: 'generate_blog', label: 'Blog genereren', method: 'POST', encoding: 'json',
    description: 'Genereer een nieuwe blog voor een blogaccount (komt als concept "klaar voor review").',
    params: { account_id: { type: 'string', required: true, desc: 'Blogaccount-id' } },
    path: () => '/api/admin/blogs',
    body: (p) => ({ action: 'generate', account_id: s(p.account_id) }),
    summary: (p) => `Blog genereren voor account ${s(p.account_id).slice(0, 8)}…`,
  },
  {
    name: 'cancel_contract', label: 'Contract annuleren', method: 'PATCH', encoding: 'json', destructive: true,
    description: 'Annuleer een contract (DESTRUCTIEF — vereist bevestiging).',
    params: { id: { type: 'string', required: true, desc: 'Contract-id' } },
    path: (p) => `/api/admin/contracts/${s(p.id)}`,
    body: () => ({ action: 'cancel' }),
    summary: (p) => `Contract annuleren (${s(p.id).slice(0, 8)}…)`,
  },
]

export function findTool(name: string): ToolDef | undefined {
  return AI_TOOLS.find((t) => t.name === name)
}

/** Compacte tool-beschrijving voor de systeemprompt. */
export function toolsForPrompt(): string {
  return AI_TOOLS.map((t) => {
    const ps = Object.entries(t.params).map(([k, v]) => `${k}${v.required ? '*' : ''}:${v.type}`).join(', ')
    return `- ${t.name}${t.destructive ? ' [DESTRUCTIEF]' : ''}: ${t.description} | params: ${ps}`
  }).join('\n')
}
