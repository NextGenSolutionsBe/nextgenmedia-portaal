// Eenmalig: de "Vragenlijst huisstijl — Garage Vantilt" (PDF) als formulier.
// Genereert de SQL-insert; de velden gaan eerst door normaliseerVelden zodat ze
// exact het formaat van de module volgen. Uitvoeren: npx tsx scripts/vantilt-vragenlijst.ts
import { normaliseerVelden, type Veld } from '../lib/formulieren/model'

const kleuren = ['Rood', 'Oranje', 'Geel', 'Groen', 'Wit', 'Blauw', 'Donkerblauw', 'Zwart', 'Grijs', 'Metaal']
const k = (id: string, label: string, extra: Partial<Veld> = {}): Veld => ({ id, type: 'kort', label, verplicht: false, ...extra })
const l = (id: string, label: string, hulptekst?: string, extra: Partial<Veld> = {}): Veld => ({ id, type: 'lang', label, verplicht: false, ...(hulptekst ? { hulptekst } : {}), ...extra })
const s = (id: string, label: string, hulptekst?: string): Veld => ({ id, type: 'sectie', label, verplicht: false, ...(hulptekst ? { hulptekst } : {}) })
const keuze = (id: string, label: string, opties: string[], type: 'keuze' | 'meerkeuze' = 'keuze'): Veld => ({ id, type, label, verplicht: false, opties })
const schaal = (id: string, links: string, rechts: string): Veld => ({ id, type: 'schaal', label: `${links} ↔ ${rechts}`, verplicht: false, min: 1, max: 5, minLabel: links, maxLabel: rechts })

const velden: Veld[] = [
  { id: 'intro', type: 'uitleg', label: 'Eerst het verhaal, dan het logo.', verplicht: false, hulptekst: 'We willen graag weten wie Garage Vantilt is. Hoe jullie werken, voor wie, en waarom klanten bij jullie terugkomen. Daar bouwen we het logo, de kleuren en de brand guide op. Er zijn geen foute antwoorden. Schrijf zoals je het aan een klant aan de toonbank zou uitleggen. Kort mag, maar hoe concreter, hoe beter.' },

  s('deel1', 'Deel 1 van 6 — Over Garage Vantilt'),
  k('invuller', 'Wie vult deze vragenlijst in?', { verplicht: true }),
  { id: 'email', type: 'email', label: 'Op welk e-mailadres mogen we jullie bereiken?', verplicht: true },
  l('in_een_zin', 'Wat doet Garage Vantilt, in één zin?', 'Moeilijk, maar het belangrijkste antwoord van de hele lijst. Stel je voor dat iemand het vraagt aan de keuring.'),
  keuze('diensten', 'Welke diensten bieden jullie aan?', ['Onderhoud en herstellingen', 'Verkoop van wagens', 'Verhuur'], 'meerkeuze'),
  k('andere_diensten', 'Andere diensten, welke?'),
  keuze('onthouden', 'Wat moeten mensen vooral van jullie onthouden?', ['Onderhoud', 'Verkoop', 'Verhuur', 'Alles evenveel: één adres voor je auto']),
  l('ontstaan', 'Hoe is Garage Vantilt ontstaan?', 'Sinds wanneer bestaat de garage, wie zit erachter, waarom zijn jullie begonnen?'),
  l('doelen', 'Wat willen jullie het komende jaar bereiken?', 'Bijvoorbeeld meer onderhoudsklanten, meer verkoop, een nieuwe dienst.'),

  s('deel2', 'Deel 2 van 6 — Jullie klanten'),
  l('typische_klant', 'Wie is jullie typische klant?', 'Leeftijd, gezin of zaak, van waar ze komen, wat voor auto ze rijden. Zijn er verschillende soorten klanten, beschrijf ze dan allemaal.'),
  l('waarom_kiezen', 'Waarom kiezen klanten nu voor jullie?', 'Wat zeggen ze letterlijk als ze tevreden zijn?'),
  l('twijfels', 'Waarover twijfelen mensen voor ze bij jullie langskomen?', 'Prijs, vertrouwen, niet weten dat jullie bestaan, de ingang niet vinden, …'),
  l('gevoel', 'Hoe moet een klant zich voelen als hij buitenrijdt?'),

  s('deel3', 'Deel 3 van 6 — Persoonlijkheid'),
  k('drie_woorden', 'Omschrijf Garage Vantilt in drie tot vijf woorden.'),
  s('uitersten', 'Waar staan jullie tussen deze twee uitersten?', 'Kies per lijn één cijfer van 1 tot 5.'),
  schaal('schaal_modern', 'Traditioneel', 'Modern'),
  schaal('schaal_familiaal', 'Zakelijk', 'Familiaal'),
  schaal('schaal_premium', 'Betaalbaar', 'Premium'),
  schaal('schaal_opvallend', 'Ingetogen', 'Opvallend'),
  schaal('schaal_eenvoudig', 'Technisch', 'Eenvoudig uitgelegd'),
  schaal('schaal_knipoog', 'Serieus', 'Met een knipoog'),
  l('waarden', 'Welke waarden zijn voor jullie niet onderhandelbaar?', 'Dingen die jullie altijd doen, ook als het meer werk is.'),
  l('als_persoon', 'Als Garage Vantilt een persoon was, hoe zou die zijn?'),
  keuze('aanspreking', 'Hoe spreken jullie klanten aan?', ['Met je en jij', 'Met u', 'Hangt van de klant af']),

  s('deel4', 'Deel 4 van 6 — Jullie plek in de markt'),
  l('concurrenten', 'Welke garages zien jullie als concurrent?'),
  l('concurrenten_sterk_zwak', 'Wat doen die goed, en wat doen ze minder goed?'),
  l('anders', 'Waarin zijn jullie anders?'),
  keuze('vanweerts', "Jullie zitten in hetzelfde gebouw als Auto's Vanweerts. Hoe moet de nieuwe huisstijl zich daartoe verhouden?", ['Volledig los, een eigen merk', 'Eigen merk, maar een link mag zichtbaar zijn', 'Weten we nog niet, graag jullie advies']),
  l('vanweerts_uitleg', 'Uitleg, als je die wil meegeven'),

  s('deel5', 'Deel 5 van 6 — Visuele richting'),
  l('behouden', 'Is er iets van het huidige logo of de huidige kleuren dat moet blijven?'),
  keuze('logo_type', 'Wat voor logo spreekt jullie aan?', ['Alleen de naam in een sterk lettertype', 'Naam met een symbool erbij', 'Een symbool dat ook alleen kan staan', 'Geen voorkeur, verras ons']),
  keuze('kleuren_wel', 'Welke kleuren zien jullie graag terug?', kleuren, 'meerkeuze'),
  { id: 'kleur_tint', type: 'kleur', label: 'Een specifieke tint in gedachten? Kies of noteer ze hier', verplicht: false, max: 3 },
  keuze('kleuren_niet', 'En welke kleuren liever niet?', kleuren, 'meerkeuze'),
  l('merken_mooi', 'Welke merken vinden jullie mooi, en waarom?', 'Mag in de autowereld zijn, maar ook daarbuiten. Plak gerust links.'),
  l('absoluut_niet', 'Wat willen jullie absoluut niet?'),
  keuze('slogan', 'Hebben jullie een slogan?', ['Ja, en die blijft', 'Ja, maar die mag veranderen', 'Nee, maar we willen er een', 'Nee, niet nodig']),
  k('slogan_tekst', 'De slogan', { voorwaarde: { veld: 'slogan', waarde: 'Ja, en die blijft' } }),
  k('slogan_tekst_wijzigbaar', 'De huidige slogan', { voorwaarde: { veld: 'slogan', waarde: 'Ja, maar die mag veranderen' } }),

  s('deel6', 'Deel 6 van 6 — Praktisch'),
  keuze('toepassingen', 'Waar moet het logo allemaal op komen?', ['Gevel en signalisatie', 'Social media', 'AutoScout24 en Carprof', 'Werkkleding', 'Bedrijfs- en vervangwagens', 'Visitekaartjes', 'Facturen en offertes', 'Nummerplaathouders'], 'meerkeuze'),
  k('toepassingen_anders', 'Nog ergens anders?'),
  k('deadline', 'Is er een moment waarop de huisstijl klaar moet zijn?'),
  k('beslissers', 'Wie beslist mee over de huisstijl?'),
  l('nog_iets', 'Nog iets dat we moeten weten?'),
  { id: 'bestanden', type: 'bestand', label: "Foto's, een oud logo of voorbeelden", verplicht: false, hulptekst: 'Optioneel: sleep hier bestanden in (beeld, pdf, ai, eps, svg of zip).', max: 5 },
]

const genormaliseerd = normaliseerVelden(velden)
if (genormaliseerd.length !== velden.length) throw new Error(`normalisatie liet ${velden.length - genormaliseerd.length} velden vallen`)
for (let i = 0; i < velden.length; i++) if (genormaliseerd[i].id !== velden[i].id) throw new Error(`id gewijzigd: ${velden[i].id} → ${genormaliseerd[i].id}`)
const lost = genormaliseerd.filter((v) => (velden.find((x) => x.id === v.id)?.voorwaarde ? !v.voorwaarde : false))
if (lost.length) throw new Error('voorwaarde verloren: ' + lost.map((v) => v.id).join(','))

const instellingen = {
  bedankt_tekst: 'Bedankt, dat is alles. We lezen alles grondig door. Als iets niet helemaal duidelijk is, bellen we even. Daarna gaan we aan de slag met de eerste richting voor de huisstijl.',
  knop_tekst: 'Vragenlijst versturen',
  meerdere_inzendingen: false,
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`
console.log(`-- ${genormaliseerd.length} velden`)
console.log(JSON.stringify({ velden: genormaliseerd, instellingen }))
