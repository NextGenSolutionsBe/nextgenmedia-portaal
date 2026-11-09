/**
 * Algemene voorwaarden die achteraan elke opgemaakte offerte staan (klein en
 * grijs). Puur, zodat de pdf en de tests dezelfde tekst gebruiken.
 * De placeholders vullen we met de bedrijfsgegevens uit de instellingen.
 */

export type VoorwaardenBedrijf = { vennootschap: string; adres: string; ondernemingsnummer: string; betalingstermijn: number }

const ARTIKELS: [string, string[]][] = [
  ['Identiteit en toepassing', [
    'Deze offerte en de bijbehorende algemene voorwaarden worden opgesteld door {vennootschap}, met maatschappelijke zetel te {adres}, ingeschreven in de Kruispuntbank van Ondernemingen onder nummer {ondernemingsnummer}, hierna “NextGen”.',
    'Deze voorwaarden zijn van toepassing op alle offertes en opdrachten van NextGen voor professionele klanten, tenzij partijen schriftelijk anders overeenkomen. De voorwaarden van de klant zijn niet van toepassing, tenzij NextGen deze uitdrukkelijk schriftelijk aanvaardt.',
  ]],
  ['Offerte en aanvaarding', [
    'De offerte is geldig tot de vermelde vervaldatum. De overeenkomst komt tot stand zodra de klant de offerte schriftelijk aanvaardt, bijvoorbeeld door ondertekening of bevestiging per e-mail.',
    'Door de offerte te aanvaarden, bevestigt de klant dat hij vóór de aanvaarding kennis heeft kunnen nemen van deze algemene voorwaarden en ermee akkoord gaat.',
    'Bij tegenstrijdigheid tussen de offerte en deze algemene voorwaarden geldt de offerte voor de concrete opdracht. Wijzigingen of aanvullingen zijn alleen geldig wanneer beide partijen ze schriftelijk bevestigen.',
  ]],
  ['Omschrijving en omvang van de opdracht', [
    'NextGen voert de opdracht uit zoals omschreven in de offerte. De vermelde aantallen, formaten, kanalen, looptijd, planning en inbegrepen prestaties bepalen de omvang van de opdracht.',
    'Prestaties die niet uitdrukkelijk in de offerte zijn opgenomen, zijn niet inbegrepen. Voor bijkomende prestaties of wijzigingen kan NextGen een meerprijs aanrekenen na voorafgaand akkoord van de klant.',
  ]],
  ['Medewerking van de klant', [
    'De klant bezorgt tijdig alle informatie, teksten, beelden, bestanden, toegangen, goedkeuringen en andere input die nodig is voor de uitvoering van de opdracht.',
    'De klant staat in voor de juistheid, volledigheid en wettelijkheid van de informatie en materialen die hij aanlevert. De klant bevestigt dat hij over de nodige rechten, licenties en toestemmingen beschikt om die materialen door NextGen te laten gebruiken.',
    'Vertraging of bijkomend werk door laattijdige, onvolledige of foutieve input van de klant kan leiden tot een aangepaste planning en, na voorafgaand akkoord, bijkomende kosten.',
  ]],
  ['Planning en oplevering', [
    'De planning en oplevertermijnen staan vermeld in de offerte of worden nadien schriftelijk afgesproken. Als de uitvoering afhankelijk is van input, toegang, feedback of goedkeuring van de klant, wordt de planning daaraan aangepast wanneer die input of goedkeuring vertraging oploopt.',
    'Een opgegeven planning is geen resultaatsgarantie, tenzij partijen dit uitdrukkelijk schriftelijk als bindend zijn overeengekomen.',
  ]],
  ['Feedback, goedkeuring en wijzigingen', [
    'Het aantal inbegrepen feedback- of revisierondes staat vermeld in de offerte. De klant bezorgt feedback gebundeld en binnen de afgesproken termijn.',
    'Wijzigingen die buiten de afgesproken opdracht vallen, bijkomende revisierondes en aanpassingen na finale goedkeuring kunnen als meerwerk worden aangerekend. NextGen meldt de mogelijke meerprijs en impact op de planning vooraf aan de klant.',
    'De klant controleert de finale teksten, beelden, video’s, advertenties, webpagina’s en andere materialen vóór publicatie of gebruik. De klant blijft verantwoordelijk voor de inhoudelijke juistheid van informatie, prijzen, productclaims, promoties en andere gegevens die hij goedkeurt.',
  ]],
  ['Prijs en bijkomende kosten', [
    'De prijs, betalingswijze en eventuele betaling in schijven staan vermeld in de offerte. Alle prijzen zijn exclusief btw, tenzij uitdrukkelijk anders vermeld.',
    'Kosten voor onder meer advertentiebudgetten, verplaatsingen, kilometervergoeding, parking, huur van materiaal of locaties, acteurs, modellen, licenties, stockbeelden, muziek, externe leveranciers, hosting, domeinnamen, software, AI-tools en AI-credits zijn alleen inbegrepen wanneer dit uitdrukkelijk in de offerte staat.',
    'Bijkomende kosten worden vooraf aan de klant meegedeeld en alleen na akkoord aangerekend. Kosten die de klant rechtstreeks aan een derde betaalt, vallen buiten de facturatie door NextGen.',
  ]],
  ['Facturatie en betaling', [
    'Facturen zijn betaalbaar binnen {betalingstermijn} kalenderdagen na factuurdatum, tenzij de offerte een andere termijn vermeldt. De klant betaalt op het rekeningnummer dat op de factuur staat.',
    'Bij laattijdige betaling kunnen de wettelijke interesten en invorderingsvergoedingen voor betalingsachterstand bij handelstransacties worden aangerekend, binnen de toepasselijke wettelijke grenzen.',
    'Als een factuur onbetaald blijft, kan NextGen de klant schriftelijk aanmanen en de uitvoering van de opdracht opschorten zolang de betalingsachterstand voortduurt. De planning wordt in dat geval aangepast aan de duur van de opschorting.',
  ]],
  ['Intellectuele eigendom en gebruiksrechten', [
    'De intellectuele eigendomsrechten op de door NextGen gemaakte werken blijven bij NextGen, tenzij de offerte uitdrukkelijk een overdracht of andere regeling vermeldt.',
    'Na volledige betaling krijgt de klant een niet-exclusief gebruiksrecht op de finale werken die uitdrukkelijk in de offerte zijn opgenomen. Dit gebruiksrecht geldt voor de eigen bedrijfscommunicatie van de klant via de kanalen en voor de doeleinden waarvoor de werken werden gemaakt.',
    'Het gebruiksrecht geldt vanaf volledige betaling. Het omvat geen overdracht van bronbestanden, ruwe beelden, projectbestanden, werkbestanden, ongebruikte concepten, interne methodes, templates of onderdelen die niet als finale oplevering in de offerte staan, tenzij dit uitdrukkelijk is afgesproken.',
    'Materialen van derden, zoals muziek, stockbeelden, fonts, software, plugins en templates, blijven onderworpen aan de licentievoorwaarden van de betrokken rechthebbenden. De klant is verantwoordelijk voor bijkomend gebruik waarvoor een aparte licentie nodig is.',
    'De wettelijke morele rechten van de makers blijven behouden.',
  ]],
  ['AI-tools en automatisaties', [
    'NextGen kan AI-tools gebruiken bij de uitvoering van de opdracht. De inzet van AI verandert niets aan de afgesproken omvang of prijs, tenzij bijkomende AI-kosten of extra generaties vooraf met de klant zijn overeengekomen.',
    'AI-gegenereerde resultaten kunnen overeenkomsten vertonen met materiaal van derden en zijn niet noodzakelijk uniek of exclusief. NextGen controleert de resultaten zorgvuldig binnen de afgesproken opdracht; de klant beoordeelt de finale inhoud vóór gebruik of publicatie.',
    'Abonnementen, credits, gebruikskosten en externe AI-diensten zijn alleen inbegrepen wanneer dit uitdrukkelijk in de offerte staat.',
  ]],
  ['Advertenties en externe platforms', [
    'Advertentiebudgetten zijn niet inbegrepen in de beheervergoeding, tenzij de offerte uitdrukkelijk anders vermeldt. Het advertentiebudget wordt betaald via het advertentieaccount of de betaalmethode die in de offerte of schriftelijke afspraken is vastgelegd.',
    'NextGen kan geen specifiek bereik, aantal leads, verkopen, omzet, positie in zoekresultaten of ander commercieel resultaat garanderen. Resultaten zijn mede afhankelijk van factoren buiten de controle van NextGen, waaronder budget, aanbod, markt, website, doelgroep en beslissingen of wijzigingen van externe platforms.',
    'De klant blijft eigenaar en beheerder van zijn eigen accounts en bezorgt NextGen alleen de toegangsrechten die nodig zijn voor de opdracht. De klant blijft verantwoordelijk voor het naleven van toepasselijke wetgeving en platformvoorwaarden met betrekking tot zijn aanbod en bedrijfsactiviteiten.',
  ]],
  ['Annulering, verplaatsing en stopzetting', [
    'De klant kan een opdracht of ingepland werk schriftelijk annuleren of verplaatsen. De klant vergoedt in dat geval de prestaties die al zijn uitgevoerd en de externe kosten die NextGen al heeft gemaakt of niet meer kosteloos kan annuleren.',
    'Voor een verplaatste shoot, afspraak of oplevering maken partijen een nieuwe planning. Eventuele bijkomende kosten of gevolgen voor de planning worden vooraf besproken.',
    'Voor opdrachten met een vaste looptijd of minimale contractduur geldt de looptijd die in de offerte staat. Vroegtijdige beëindiging of wijziging van die looptijd gebeurt in onderling schriftelijk overleg, behoudens wettelijke rechten van partijen.',
  ]],
  ['Aansprakelijkheid', [
    'NextGen voert de opdracht zorgvuldig en professioneel uit. Wanneer de klant meent dat een prestatie niet overeenstemt met de offerte, meldt hij dit schriftelijk en zo spoedig mogelijk, met een duidelijke omschrijving van het probleem. NextGen krijgt een redelijke mogelijkheid om een aantoonbare tekortkoming te onderzoeken en, waar passend, te herstellen.',
    'Voor zover wettelijk toegestaan, is NextGen niet aansprakelijk voor indirecte schade, gevolgschade, winstderving, gemiste besparingen of verlies van gegevens. De aansprakelijkheid van NextGen is, voor zover wettelijk toegestaan, beperkt tot de vergoeding die de klant voor het deel van de opdracht waarop de schade betrekking heeft, heeft betaald.',
    'Deze beperkingen gelden niet waar aansprakelijkheid wettelijk niet kan worden uitgesloten of beperkt.',
  ]],
  ['Vertrouwelijkheid en persoonsgegevens', [
    'Partijen behandelen vertrouwelijke informatie die zij in het kader van de opdracht ontvangen zorgvuldig en gebruiken die alleen voor de uitvoering van de overeenkomst.',
    'Wanneer NextGen in opdracht van de klant persoonsgegevens verwerkt, maken partijen waar nodig aanvullende afspraken over die verwerking, bijvoorbeeld in een verwerkersovereenkomst. Partijen leven de toepasselijke privacywetgeving na.',
  ]],
  ['Portfolio en referenties', [
    'NextGen mag afgewerkte werken als referentie tonen in haar portfolio, op haar website en in eigen communicatie, nadat de klant het werk zelf openbaar heeft gemaakt.',
    'Als de klant dit niet wenst, meldt hij dat schriftelijk vóór de publicatie van het werk door NextGen. Vertrouwelijke informatie en niet-gepubliceerde campagnematerialen worden niet als referentie getoond zonder voorafgaand akkoord van de klant.',
  ]],
  ['Overmacht', [
    'Geen van beide partijen is aansprakelijk voor vertraging of niet-uitvoering die rechtstreeks wordt veroorzaakt door omstandigheden buiten haar redelijke controle, zoals ernstige storingen, brand, overheidsmaatregelen, ziekte of uitval van essentiële externe diensten.',
    'De getroffen partij brengt de andere partij zo spoedig mogelijk op de hoogte. Partijen overleggen over een aangepaste planning of een andere redelijke oplossing.',
  ]],
  ['Klachten en geschillen', [
    'Klachten over een factuur of uitvoering meldt de klant schriftelijk aan NextGen, met vermelding van de betrokken offerte of factuur en een duidelijke omschrijving van de klacht.',
    'Partijen proberen een geschil eerst in onderling overleg op te lossen. Het indienen van een klacht schort de betalingsverplichting voor niet-betwiste bedragen niet op.',
  ]],
  ['Toepasselijk recht en bevoegde rechtbank', [
    'Op de offerte, de overeenkomst en deze algemene voorwaarden is Belgisch recht van toepassing.',
    'Geschillen behoren tot de bevoegdheid van de rechtbanken die volgens de toepasselijke wetgeving bevoegd zijn voor de maatschappelijke zetel van NextGen, behoudens dwingende wettelijke bepalingen.',
  ]],
]

/** De voorwaarden als artikels (titel in hoofdletters zoals het origineel) met ingevulde gegevens. */
export function offerteVoorwaarden(b: VoorwaardenBedrijf): { titel: string; alineas: string[] }[] {
  const vul = (s: string) => s
    .replace('{vennootschap}', b.vennootschap)
    .replace('{adres}', b.adres)
    .replace('{ondernemingsnummer}', b.ondernemingsnummer)
    .replace('{betalingstermijn}', String(b.betalingstermijn))
  return ARTIKELS.map(([t, a], i) => ({ titel: `${i + 1}. ${t.toUpperCase()}`, alineas: a.map(vul) }))
}
