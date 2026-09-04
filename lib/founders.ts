// De drie zaakvoerders (admins). Gebruikt voor de aankoopgoedkeuringen:
// een aankoop > drempel vereist goedkeuring van de andere zaakvoerders.
export const FOUNDERS: { email: string; name: string }[] = [
  { email: 'bram@nextgenmedia.be', name: 'Bram' },
  { email: 'chiara@nextgenmedia.be', name: 'Chiara' },
  { email: 'marco@nextgenmedia.be', name: 'Marco' },
]

export const FOUNDER_EMAILS = FOUNDERS.map((f) => f.email)

export function founderName(email: string | null | undefined): string {
  if (!email) return '—'
  return FOUNDERS.find((f) => f.email.toLowerCase() === email.toLowerCase())?.name ?? email
}
