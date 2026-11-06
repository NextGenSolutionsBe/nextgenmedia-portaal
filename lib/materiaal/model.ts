// Materiaalbeheer — puur model (client-safe, getest in tests/materiaal.test.ts).
//
// Eenvoudig: materiaal → uitlenen → terugnemen. Eén uitleentransactie = één
// fysiek item. Status volgt uit de actieve uitlening (geen aparte statuskolom
// die uit de pas kan lopen). Tijden in de Belgische tijdzone.

export type OntlenerType = 'werknemer' | 'stagiair' | 'freelancer' | 'jobstudent' | 'bestuurder' | 'extern'
export const ONTLENER_TYPES: { key: OntlenerType; label: string }[] = [
  { key: 'werknemer', label: 'Werknemer' }, { key: 'stagiair', label: 'Stagiair' }, { key: 'freelancer', label: 'Freelancer' },
  { key: 'jobstudent', label: 'Jobstudent' }, { key: 'bestuurder', label: 'Bestuurder' }, { key: 'extern', label: 'Extern' },
]
export const typeLabel = (t: string | null | undefined) => ONTLENER_TYPES.find((x) => x.key === t)?.label ?? null
/** Personeelstype → type in Materiaalbeheer (personeel blijft de centrale bron). */
export function typeUitPersoneel(t: string | null | undefined): OntlenerType | null {
  switch (t) {
    case 'werknemer': return 'werknemer'
    case 'student': return 'jobstudent'
    case 'freelancer': return 'freelancer'
    case 'onderaannemer': return 'extern'
    default: return null
  }
}

export type Uitlening = {
  id: string; item_id: string; ontlener_id: string; uitgeleend_op: string; verwacht_terug: string | null; opmerking: string | null
  uitgeleend_door: string | null; teruggebracht_op: string | null; terug_opmerking: string | null; teruggenomen_door: string | null
  geannuleerd_op: string | null; geannuleerd_door?: string | null; annuleer_reden?: string | null
  mail_uit_status: string | null; mail_uit_fout: string | null; mail_terug_status: string | null; mail_terug_fout: string | null
}
export const isActief = (u: Pick<Uitlening, 'teruggebracht_op' | 'geannuleerd_op'>) => !u.teruggebracht_op && !u.geannuleerd_op

export type ItemStatus = 'beschikbaar' | 'uitgeleend' | 'te_laat' | 'gearchiveerd'
export const STATUS: Record<ItemStatus, { label: string; cls: string; stip: string }> = {
  beschikbaar: { label: 'Beschikbaar', cls: 'bg-green-50 text-green-800 border-green-300', stip: 'bg-green-500' },
  uitgeleend: { label: 'Uitgeleend', cls: 'bg-orange-50 text-orange-800 border-orange-300', stip: 'bg-orange-500' },
  te_laat: { label: 'Te laat', cls: 'bg-red-50 text-red-800 border-red-300', stip: 'bg-red-500' },
  gearchiveerd: { label: 'Gearchiveerd', cls: 'bg-gray-100 text-gray-600 border-gray-300', stip: 'bg-gray-400' },
}

/** Vandaag in België, 'YYYY-MM-DD'. */
export const vandaagBE = (nu = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nu)

export function itemStatus(item: { gearchiveerd_op: string | null }, actief: Pick<Uitlening, 'verwacht_terug'> | null | undefined, vandaag: string): ItemStatus {
  if (actief) return actief.verwacht_terug && actief.verwacht_terug < vandaag ? 'te_laat' : 'uitgeleend'
  return item.gearchiveerd_op ? 'gearchiveerd' : 'beschikbaar'
}

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
/** "9 oktober 2026" (Belgische tijdzone). */
export function datumLang(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? iso : vandaagBE(new Date(iso))
  return `${Number(d.slice(8, 10))} ${MAANDEN[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
}
/** "09/10/2026 10:30" (Belgische tijdzone). */
export function datumTijd(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
/** "09/10/2026" */
export const datumKort = (iso: string | null | undefined) => (!iso ? '—' : (iso.length === 10 ? iso : vandaagBE(new Date(iso))).split('-').reverse().join('/'))

export const naamVan = (o: { voornaam: string; achternaam?: string | null } | null | undefined) => (o ? [o.voornaam, o.achternaam].filter(Boolean).join(' ') : '—')

// ── E-mails (registratiebevestiging, geen handtekening of overdrachtsbewijs) ──
export type MailItem = { naam: string; uitgeleend_op: string; verwacht_terug?: string | null; teruggebracht_op?: string | null }

export function mailUitgeleend(voornaam: string, items: MailItem[]): { onderwerp: string; tekst: string } {
  const lijst = items.map((i) => `Materiaal: ${i.naam}\nUitleendatum: ${datumLang(i.uitgeleend_op)}${i.verwacht_terug ? `\nVerwachte retourdatum: ${datumLang(i.verwacht_terug)}` : ''}`).join('\n\n')
  return {
    onderwerp: 'Bevestiging uitlening materiaal — NextGenMedia',
    tekst: `Dag ${voornaam},\n\nHierbij bevestigen we dat je ${items.length > 1 ? 'onderstaande materialen' : 'onderstaand materiaal'} van NextGenMedia in gebruik hebt genomen.\n\n${lijst}\n\nWe vragen je om zorgvuldig met het materiaal om te gaan en het na gebruik in goede staat terug te bezorgen.\n\nAlvast bedankt!\n\nGroetjes,\nTeam NextGenMedia`,
  }
}

export function mailTeruggebracht(voornaam: string, item: MailItem): { onderwerp: string; tekst: string } {
  return {
    onderwerp: 'Bevestiging teruggave materiaal — NextGenMedia',
    tekst: `Dag ${voornaam},\n\nWe bevestigen dat je onderstaand materiaal opnieuw hebt terugbezorgd aan NextGenMedia.\n\nMateriaal: ${item.naam}\nUitgeleend op: ${datumLang(item.uitgeleend_op)}\nTeruggebracht op: ${datumLang(item.teruggebracht_op ?? null)}\n\nDe teruggave werd correct geregistreerd in ons systeem.\n\nBedankt!\n\nGroetjes,\nTeam NextGenMedia`,
  }
}

export const MAIL_LABEL: Record<string, { label: string; cls: string }> = {
  verzonden: { label: 'Mail verzonden', cls: 'text-green-700' },
  bezig: { label: 'Mail in behandeling', cls: 'text-blue-700' },
  mislukt: { label: 'Mail mislukt', cls: 'text-red-700' },
  geen_email: { label: 'Geen e-mailadres', cls: 'text-amber-700' },
}

export const ACTIVITEIT_LABEL: Record<string, string> = {
  uitgeleend: 'Uitgeleend', teruggebracht: 'Teruggebracht', correctie: 'Correctie', geannuleerd: 'Registratie geannuleerd',
  item_toegevoegd: 'Materiaal toegevoegd', item_gewijzigd: 'Materiaal gewijzigd', item_gearchiveerd: 'Materiaal gearchiveerd', item_hersteld: 'Materiaal hersteld',
  mail_opnieuw: 'Mail opnieuw verzonden', ontlener_toegevoegd: 'Medewerker toegevoegd', ontlener_gewijzigd: 'Medewerker gewijzigd', ontlener_gearchiveerd: 'Medewerker gearchiveerd',
}
