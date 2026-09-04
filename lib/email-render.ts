// Placeholder-rendering voor e-mailtemplates. Puur (client-safe).

export const PLACEHOLDERS = [
  '{{klantnaam}}', '{{bedrijfsnaam}}', '{{email}}', '{{dienst}}', '{{datum}}', '{{uur}}',
  '{{contractnaam}}', '{{dashboard_link}}', '{{contract_link}}', '{{scripts_link}}', '{{website_link}}', '{{contentshoot_link}}',
  '{{taak_titel}}', '{{taak_beschrijving}}', '{{deadline}}', '{{taak_deadline}}', '{{taak_link}}',
]

export type MailVars = Record<string, string>

/** Vervangt {{key}} door de waarde uit `vars`. Onbekende placeholders blijven leeg. */
export function renderTemplate(text: string, vars: MailVars): string {
  return (text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => vars[key] ?? '')
}
