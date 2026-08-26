import Link from 'next/link'
import {
  Share2, Palette, LayoutDashboard, Eye, FileText, RefreshCw, Camera, Info,
  History, BarChart3, Megaphone, FolderUp, Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Vaste interne werkwijze voor klantgesprekken. Puur informatief — geen
// checklist, geen statussen, geen automatisering. Bedoeld als geheugensteun
// zodat elk gesprek op dezelfde manier verloopt.
//
// Twee soorten gesprekken, en die verschillen wezenlijk:
//  · INTAKE bij een nieuwe klant. Duurt langer, want daar zit al het
//    opzetwerk in: koppelen in Metricool, portaal uitleggen, verwachtingen
//    afstemmen.
//  · KWARTAAL bij een bestaande klant. Geen opzetwerk meer; dit gaat over
//    terugkijken op wat gewerkt heeft en de volgende drie maanden uitzetten.
//
// Ze staan bewust op één pagina met tabbladen en niet in twee losse schermen:
// het is dezelfde soort informatie, en je wil er tijdens een gesprek snel
// tussen kunnen wisselen.

type Stap = { title: string; icon: React.ElementType; items: string[] }

const INTAKE: Stap[] = [
  {
    title: 'Metricool onboarden',
    icon: Share2,
    items: [
      'Instagram toegang ontvangen',
      'Facebook toegang ontvangen',
      'LinkedIn toegang ontvangen',
      'Andere platformen indien van toepassing',
      'Klant koppelen in Metricool',
    ],
  },
  {
    title: 'Logo & branding',
    icon: Palette,
    items: [
      'Logo ontvangen',
      'Brandbook ontvangen (indien aanwezig)',
      'Huisstijlkleuren ontvangen',
    ],
  },
  {
    title: 'NextGenMedia portal uitleggen',
    icon: LayoutDashboard,
    items: [
      'Dashboard uitleggen',
      'Contentkalender uitleggen',
      'Contracten uitleggen',
      'Feedbackflow uitleggen',
      'Bestanden aanleveren uitleggen — mappen maken en foto’s uploaden',
      'Website-aanpassingen uitleggen (indien van toepassing)',
    ],
  },
  {
    title: 'Metricool uitleggen',
    icon: Eye,
    items: [
      'Hoe content bekeken wordt',
      'Hoe content goedgekeurd wordt',
      'Hoe feedback gegeven wordt',
      'Hoe goedkeuringsmails werken',
    ],
  },
  {
    title: 'Strategie & scripts overlopen',
    icon: FileText,
    items: [
      'Contentstrategie bespreken',
      'Reels bespreken',
      'Posts bespreken',
      'Verwachtingen afstemmen',
    ],
  },
  {
    title: 'Revisieronde uitleggen',
    icon: RefreshCw,
    items: [
      '1 revisieronde per post',
      'Daarna finale goedkeuring',
    ],
  },
  {
    title: 'Contentshoot inplannen',
    icon: Camera,
    items: [
      'Datum vastleggen',
      'Tijdstip vastleggen',
      'Locatie bevestigen',
    ],
  },
]

// Volgorde = gespreksvolgorde. Eerst terugkijken met cijfers erbij, dan pas
// vooruit: zonder die onderbouwing wordt het volgende kwartaal een gevoelskwestie.
const KWARTAAL: Stap[] = [
  {
    title: 'Terugblik op de voorbije drie maanden',
    icon: History,
    items: [
      'Wat hebben we effectief gepubliceerd?',
      'Welke content werkte, en waaraan zag je dat?',
      'Wat viel tegen, en waarom denken we dat?',
      'Wat is er veranderd bij de klant zelf (aanbod, team, seizoen)?',
    ],
  },
  {
    title: 'Cijfers erbij nemen',
    icon: BarChart3,
    items: [
      'Metricool-statistieken openen en samen doornemen',
      'Bereik en interacties per platform vergelijken met vorig kwartaal',
      'Best presterende posts en reels aanduiden',
      'Volgersgroei bekijken — richting, niet de losse getallen',
      'Beste posttijden opnieuw nakijken',
    ],
  },
  {
    title: 'Strategie & scripts voor het volgende kwartaal',
    icon: Target,
    items: [
      'Waar zetten we meer op in, op basis van wat werkte?',
      'Wat laten we vallen?',
      'Contentpijlers voor de komende drie maanden vastleggen',
      'Scripts en formats overlopen',
      'Verhouding reels / posts / stories afspreken',
      'Nieuwe formats voorstellen en aftoetsen',
    ],
  },
  {
    title: 'Adverteren bespreken',
    icon: Megaphone,
    items: [
      'Wordt er al geadverteerd? Zo ja: wat leverde het op?',
      'Zo niet: is dit het moment om te starten?',
      'Welk doel — naamsbekendheid, leads of verkoop?',
      'Welk budget is haalbaar?',
      'Welke bestaande content leent zich om te adverteren?',
    ],
  },
  {
    title: 'Content opvragen',
    icon: FolderUp,
    items: [
      'Zijn er de voorbije drie maanden projecten of realisaties geweest?',
      'Is daar beeldmateriaal van — foto’s, video’s, voor-en-na?',
      'Klant laten uploaden in zijn eigen NextGenMedia-account, bij Bestanden',
      'Laat hem per project een map maken en er alles in slepen',
      'Vraag om een korte toelichting per map: wat zien we, wat mag gebruikt worden?',
      'Volgende contentshoot inplannen als er te weinig materiaal is',
    ],
  },
]

const TABBLADEN = [
  {
    key: 'intake',
    label: 'Intake meeting',
    titel: 'Intake meeting',
    onder: 'Nieuwe klant — opzetten en uitleggen',
    uitleg:
      'Vaste geheugensteun zodat elke onboarding volgens dezelfde stappen verloopt. ' +
      'Dit gesprek duurt langer dan een kwartaalmeeting: hier zit al het opzetwerk in — ' +
      'koppelen in Metricool, het portaal uitleggen en verwachtingen afstemmen.',
    stappen: INTAKE,
  },
  {
    key: 'kwartaal',
    label: 'Kwartaalmeeting',
    titel: 'Kwartaalmeeting',
    onder: 'Bestaande klant — terugkijken en het volgende kwartaal uitzetten',
    uitleg:
      'Geen opzetwerk meer. De kern is strategie en scripts overlopen, onderbouwd met ' +
      'de cijfers van de voorbije drie maanden. Begin altijd met terugkijken — zonder die ' +
      'onderbouwing wordt het volgende kwartaal een gevoelskwestie.',
    stappen: KWARTAAL,
  },
] as const

export default async function OnboardingInfoPage({
  searchParams,
}: { searchParams: Promise<{ meeting?: string }> }) {
  const { meeting } = await searchParams
  // Onbekende waarde valt terug op de intake; dat is het gesprek dat het vaakst
  // opgezocht wordt.
  const actief = TABBLADEN.find((t) => t.key === meeting) ?? TABBLADEN[0]

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Onboarding Info</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Interne werkwijze voor klantgesprekken
        </p>
      </div>

      {/* Tabbladen als links: zo kan je een gesprek rechtstreeks openen en
          werkt de terugknop zoals verwacht. */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABBLADEN.map((t) => (
          <Link
            key={t.key}
            href={`/admin/onboarding?meeting=${t.key}`}
            className={cn(
              'px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors',
              t.key === actief.key
                ? 'border-black text-black'
                : 'border-transparent text-gray-400 hover:text-gray-700',
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div>
        <h2 className="font-bold text-lg">{actief.titel}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{actief.onder}</p>
      </div>

      {/* Toelichting */}
      <div className="card-base flex items-start gap-3 bg-[#fff848]/10 border-[#fff848]/40">
        <Info className="h-5 w-5 text-[#c5b800] shrink-0 mt-0.5" />
        <p className="text-sm text-gray-600">
          {actief.uitleg} Dit is enkel ter informatie — er wordt niets bijgehouden of afgevinkt.
        </p>
      </div>

      {/* Stappen */}
      <div className="grid gap-4 sm:grid-cols-2">
        {actief.stappen.map((step, i) => {
          const Icon = step.icon
          return (
            <div key={step.title} className="card-base">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-9 w-9 shrink-0 rounded-xl bg-[#fff848]/20 flex items-center justify-center font-bold text-sm text-black">
                  {i + 1}
                </div>
                <h2 className="font-semibold text-gray-900 flex items-center gap-2 min-w-0">
                  <Icon className="h-4 w-4 text-gray-400 shrink-0" />
                  <span className="truncate">{step.title}</span>
                </h2>
              </div>
              <ul className="space-y-1.5">
                {step.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {/* Snelkoppelingen: tijdens een kwartaalmeeting wil je niet zoeken. */}
      {actief.key === 'kwartaal' && (
        <div className="card-base">
          <h2 className="font-semibold mb-1">Rechtstreeks naartoe</h2>
          <div className="text-xs text-gray-400 mb-3">Wat je tijdens dit gesprek nodig hebt</div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/metricool/stats" className="text-sm font-semibold px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-gray-400" />Metricool-statistieken
            </Link>
            <Link href="/admin/uploads" className="text-sm font-semibold px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-2">
              <FolderUp className="h-4 w-4 text-gray-400" />Klantuploads
            </Link>
            <Link href="/admin/services/social-media" className="text-sm font-semibold px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-400" />Contentkalender
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
