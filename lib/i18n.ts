// Lichte i18n voor het klantportaal (NL/EN). Pure module — géén server-only
// imports — zodat zowel server- als clientcomponenten dit kunnen gebruiken.
// De taalkeuze zit in de cookie `ngm_lang` (zie lib/i18n-server.ts + LangToggle).

export type Lang = 'nl' | 'en'
export const LANGS: Lang[] = ['nl', 'en']
export const DEFAULT_LANG: Lang = 'nl'
export const LANG_LABEL: Record<Lang, string> = { nl: 'Nederlands', en: 'English' }

type Dict = Record<string, string>

const nl: Dict = {
  // Shell
  'portal.subtitle': 'Klantenportaal',
  'common.logout': 'Uitloggen',
  'common.refresh': 'Pagina vernieuwen',
  'common.language': 'Taal',
  // Navigatie
  'nav.dashboard': 'Dashboard',
  'nav.contracts': 'Contracten',
  'nav.tasks': 'Taken',
  'nav.social': 'Social Media',
  'nav.metricool': 'Metricool',
  'nav.cms': 'Website-CMS',
  'nav.website': 'Website',
  'nav.blogs': 'Blogs',
  'nav.files': 'Bestanden',
  // Dashboard
  'dash.noProfile': 'Geen klantprofiel gevonden. Contacteer NextGenMedia.',
  'dash.welcome': 'Welkom, {name}',
  'dash.subtitle': 'Uw klantenportaal bij NextGenMedia',
  'dash.contractPending': 'Contract wacht op uw handtekening',
  'dash.sign': 'Ondertekenen',
  'dash.scriptsOne': '{n} script wacht op goedkeuring',
  'dash.scriptsOther': '{n} scripts wachten op goedkeuring',
  'dash.scriptsReview': 'Bekijk en keur goed in de contentkalender',
  'deadline.titel': 'Keur de content van {maanden} goed vóór {datum}',
  'deadline.resterend': 'Nog {tijd}',
  'deadline.laatsteUren': 'Nog maar {tijd}',
  'deadline.open': '{n} item(s) wachten op je goedkeuring.',
  'deadline.uitleg': 'Wat dan nog niet is goedgekeurd of van feedback voorzien, wordt daarna goedgekeurd.',
  'deadline.dagen': '{d} d {u} u',
  'deadline.uren': '{u} u {m} min',
  'deadline.bekijk': 'Bekijk en keur goed',
  'card.social.title': 'Social Media',
  'card.social.desc': 'Contentkalender bekijken, scripts goedkeuren',
  'card.social.perMonth': '{posts} posts · {reels} reels · {stories} stories / maand',
  'card.contracts.title': 'Contracten',
  'card.contracts.desc': 'Bekijk en onderteken uw contracten',
  'card.contracts.pending': '{n} wacht op handtekening',
  'card.website.title': 'Website',
  'card.website.desc': 'Kleine aanpassingen aanvragen',
  'contract.info': 'Contractinformatie',
  'contract.start': 'Contractstart',
  'contract.end': 'Contracteinde',
  'contract.remaining': 'Resterende dagen',
  'contract.days': '{n} dagen',
  'contract.expired': '{n} dagen verlopen',
  'dash.activeServices': 'Uw actieve diensten',
}

const en: Dict = {
  'portal.subtitle': 'Client portal',
  'common.logout': 'Log out',
  'common.refresh': 'Refresh page',
  'common.language': 'Language',
  'nav.dashboard': 'Dashboard',
  'nav.contracts': 'Contracts',
  'nav.tasks': 'Tasks',
  'nav.social': 'Social Media',
  'nav.metricool': 'Metricool',
  'nav.cms': 'Website CMS',
  'nav.website': 'Website',
  'nav.blogs': 'Blogs',
  'nav.files': 'Files',
  'dash.noProfile': 'No client profile found. Please contact NextGenMedia.',
  'dash.welcome': 'Welcome, {name}',
  'dash.subtitle': 'Your client portal at NextGenMedia',
  'dash.contractPending': 'Contract awaiting your signature',
  'dash.sign': 'Sign',
  'dash.scriptsOne': '{n} script awaiting approval',
  'deadline.titel': 'Approve the content for {maanden} before {datum}',
  'deadline.resterend': '{tijd} left',
  'deadline.laatsteUren': 'Only {tijd} left',
  'deadline.open': '{n} item(s) awaiting your approval.',
  'deadline.uitleg': 'Anything not approved or commented on by then will be approved afterwards.',
  'deadline.dagen': '{d} d {u} h',
  'deadline.uren': '{u} h {m} min',
  'deadline.bekijk': 'Review and approve',
  'dash.scriptsOther': '{n} scripts awaiting approval',
  'dash.scriptsReview': 'Review and approve in the content calendar',
  'card.social.title': 'Social Media',
  'card.social.desc': 'View the content calendar, approve scripts',
  'card.social.perMonth': '{posts} posts · {reels} reels · {stories} stories / month',
  'card.contracts.title': 'Contracts',
  'card.contracts.desc': 'View and sign your contracts',
  'card.contracts.pending': '{n} awaiting signature',
  'card.website.title': 'Website',
  'card.website.desc': 'Request small changes',
  'contract.info': 'Contract information',
  'contract.start': 'Contract start',
  'contract.end': 'Contract end',
  'contract.remaining': 'Days remaining',
  'contract.days': '{n} days',
  'contract.expired': '{n} days overdue',
  'dash.activeServices': 'Your active services',
}

const DICT: Record<Lang, Dict> = { nl, en }

export function normalizeLang(v: string | null | undefined): Lang {
  return v === 'en' ? 'en' : 'nl'
}

/** Vertaal een key voor een taal, met {var}-interpolatie. Valt terug op NL, dan de key. */
export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = DICT[lang]?.[key] ?? DICT.nl[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  return s
}
