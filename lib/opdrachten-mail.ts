// Opvolgmail vanuit de projectkaart — pure regels (client-safe, getest in tests/opdrachten-mail.test.ts).
//
// Voorstellen voor een mail aan de klant, passend bij waar het project staat:
// een herinnering voor het contract, opvolging van de offerte, na de meeting,
// even polsen, voorstel om samen te zitten of een eigen mail. Het blijft een
// voorstel: in het mailvenster pas je alles aan, zie je een voorbeeld en
// verstuur je zelf. Nooit automatisch.

export type ProjectMailSoort = 'contract' | 'offerte' | 'meeting' | 'opvolging' | 'samenzitten' | 'eigen'
export type ProjectMailVoorstel = { id: ProjectMailSoort; naam: string; onderwerp: string; tekst: string; knop: string | null; link: string | null }

export type ProjectMailInfo = {
  /** Voornaam of naam van wie we aanspreken (contactpersoon, ondertekenaar). */
  contact: string | null
  klant: string | null
  /** Waarover het project gaat, bv. "sociale media" of de projecttitel. */
  onderwerp: string
  /** Wie de mail stuurt (voornaam). */
  afzender: string | null
  merkNaam: string
  contract: { titel: string; link: string; verstuurdOp: string | null; verlooptOp: string | null } | null
  offerte: { titel: string; link: string; verstuurdOp: string | null; geldigTot: string | null } | null
  meeting: { titel: string; op: string } | null
  /** Status uit de mail-opvolging (na_meeting, geen_reactie …), om het beste voorstel te kiezen. */
  status: string | null
}

const datumLang = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' })

/** "Vincent Peters" → "Vincent"; geen naam → null. */
export function voornaamVan(naam: string | null | undefined): string | null {
  const v = String(naam ?? '').trim().split(/\s+/)[0]
  if (!v || v.includes('@')) return null
  return v.charAt(0).toUpperCase() + v.slice(1)
}

function aanhef(i: ProjectMailInfo): string {
  const v = voornaamVan(i.contact)
  return v ? `Dag ${v},` : 'Hallo,'
}
function groet(i: ProjectMailInfo): string {
  return ['Groeten,', i.afzender, i.merkNaam].filter(Boolean).join('\n')
}
const mail = (i: ProjectMailInfo, ...delen: (string | null | false)[]) => [aanhef(i), ...delen.filter((d): d is string => !!d), groet(i)].join('\n\n')

export function projectMailVoorstellen(i: ProjectMailInfo): ProjectMailVoorstel[] {
  const over = i.onderwerp.trim() || 'het project'
  const uit: ProjectMailVoorstel[] = []
  if (i.contract) {
    const c = i.contract
    uit.push({
      id: 'contract', naam: 'Herinnering contract', onderwerp: `Herinnering: ${c.titel}`,
      tekst: mail(i,
        `${c.verstuurdOp ? `Op ${datumLang(c.verstuurdOp)} stuurde ik je` : 'Een tijdje geleden stuurde ik je'} het contract voor ${over}. Het staat nog open, dus ik stuur je de link nog even mee.`,
        'Tekenen gaat online en duurt maar een paar minuten. Wil je eerst nog iets bespreken of aanpassen? Laat het gerust weten, dan regelen we dat.',
        c.verlooptOp ? `De link blijft geldig tot ${datumLang(c.verlooptOp)}.` : null),
      knop: 'Contract bekijken en tekenen', link: c.link,
    })
  }
  if (i.offerte) {
    const o = i.offerte
    uit.push({
      id: 'offerte', naam: 'Opvolging offerte', onderwerp: `Onze offerte: ${o.titel}`,
      tekst: mail(i,
        `${o.verstuurdOp ? `Op ${datumLang(o.verstuurdOp)} stuurde ik je` : 'Ik stuurde je'} onze offerte voor ${over}. Heb je ze al kunnen bekijken?`,
        'Ik hoor graag wat je ervan vindt. Past er iets niet, of wil je het anders zien? Dan passen we het aan. Zit het goed, dan kan je de offerte meteen online aanvaarden via de knop hieronder.',
        o.geldigTot ? `De offerte is geldig tot ${datumLang(o.geldigTot)}.` : null),
      knop: 'Offerte bekijken', link: o.link,
    })
  }
  if (i.meeting) {
    uit.push({
      id: 'meeting', naam: 'Na de meeting', onderwerp: `Ons gesprek over ${over}`,
      tekst: mail(i,
        `Bedankt voor het gesprek${i.meeting.op ? ` van ${datumLang(i.meeting.op)}` : ''}. Fijn om alles eens samen te overlopen.`,
        'Zijn er na ons gesprek nog vragen of dingen die je kwijt wil? Laat het me weten, dan nemen we ze mee in de volgende stap.'),
      knop: null, link: null,
    })
  }
  uit.push({
    id: 'opvolging', naam: 'Even polsen hoe het staat', onderwerp: `Even polsen: ${over}`,
    tekst: mail(i,
      `Ik wilde even horen hoe het staat met ${over}.`,
      'Hoe ver staan jullie ermee? Is er nog iets dat jullie van ons nodig hebben, of iets dat nog moet gebeuren voor we verder kunnen? Als het makkelijker is, zitten we ook graag nog eens samen.'),
    knop: null, link: null,
  })
  uit.push({
    id: 'samenzitten', naam: 'Voorstel om samen te zitten', onderwerp: `Samenzitten over ${over}?`,
    tekst: mail(i,
      `Het lijkt me een goed moment om nog eens samen te zitten over ${over}. Dan overlopen we waar we staan en wat de volgende stappen zijn.`,
      'Past er volgende week een moment voor jou? Stel gerust een dag en uur voor, of laat weten of je liever langskomt of online afspreekt.'),
    knop: null, link: null,
  })
  uit.push({ id: 'eigen', naam: 'Eigen mail', onderwerp: over.charAt(0).toUpperCase() + over.slice(1), tekst: mail(i, ''), knop: null, link: null })
  return uit
}

/** Het voorstel dat het best past: open contract, dan offerte, dan na de meeting, anders even polsen. */
export function standaardVoorstel(i: ProjectMailInfo): ProjectMailSoort {
  if (i.contract) return 'contract'
  if (i.offerte) return 'offerte'
  if (i.meeting && (i.status === 'na_meeting' || !i.status)) return 'meeting'
  return 'opvolging'
}

export const isProjectMailSoort = (v: unknown): v is ProjectMailSoort =>
  v === 'contract' || v === 'offerte' || v === 'meeting' || v === 'opvolging' || v === 'samenzitten' || v === 'eigen'
