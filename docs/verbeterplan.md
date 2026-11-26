# Verbeterplan NextGen Agency-app

Prompt voor Claude Code · 26 november 2026. Opdracht van de zaakvoerders (26 nov 2026): "Werk hier van alles af. Geen vragen of permission stellen, doe gewoon alles." De fasen worden dus na elkaar gebouwd en live gezet zodra tests en build slagen; de veiligheidsregels (hoofdstuk 3) blijven gelden. Voortgang: `docs/verbeterplan-voortgang.md`.

## 1. Context

Interne app van NextGen Agency BV: Next.js op Vercel (Dublin), Supabase eu-west-1, koppelingen met ClickUp, Google Agenda en Meet, Resend, Metricool, IMAP-mailboxen, Anthropic, VIES, OpenStreetMap en Framer. Het document "NextGen Agency: de app van A tot Z" (Claude Doc) beschrijft hoe de app vandaag werkt.

NextGen Agency BV is één vennootschap met twee handelsnamen die als aparte bedrijven werken:

- **NextGen Media**: marketing. Diensten: Branding, Social media, Marketingstrategie & consultancy, Websites, Google & Meta Ads, Foto & video.
- **NextGen Solutions**: interne bedrijfsprocessen automatiseren. Diensten: AI-automatisatie, Software op maat, Care (maandelijks onderhoud).

Zaakvoerders: Marco, Bram en Chiara. Werknemers (Jonathan bij Solutions, Alida bij Media), stagiairs en jobstudenten. Rollen en namen nooit hardcoded: uit Personeel en de instellingen.

## 2. Doel

1. Media en Solutions overal duidelijk gescheiden: bij elke klantrelatie, offerte, contract, factuur, project, taak en cijfer weet je voor welk bedrijf en welke dienst.
2. Omzet en marge zichtbaar per bedrijf en per dienst.
3. Plug-and-play voor een nieuwe medewerker: account, rolsjabloon, enkel zien wat nodig is, onboarding en werkinstructies.
4. De gedeelde teamagenda is het hart van de planning.
5. Ritme van een groeiend bedrijf: scorecard, weekoverleg, kwartaaldoelen, 1-op-1's, afspraken die opgevolgd worden.

## 3. Harde regels: er mag niets verloren gaan

1. Eerst een backup (Supabase Pro: dagelijkse backups; per fase een backuptabel `<tabel>_backup_<datum>` van elke tabel die een backfill krijgt).
2. Enkel toevoegende migraties: geen DROP, TRUNCATE, hernoemen, typewijziging of DELETE op bestaande data. Nieuwe kolommen nullable of met default. Oude kolommen blijven. Elke migratie heeft een terugdraaiscript.
3. Ondertekende en vastgelegde stukken blijven onaangeroerd (pdf's, akkoorden, certificaten, handtekeningen, vesting, uitgaven vennoten). Metadata enkel ernaast, nooit in de ondertekende inhoud of vingerafdruk.
4. Backfill zonder gokken: enkel via duidelijke regels; wat niet zeker is gaat naar "Te classificeren". Nooit afleiden uit wie de verantwoordelijke is.
5. Geen neveneffecten tijdens migratie en backfill: geen mail, ClickUp-taak, Google-event of melding.
6. Koppelingen blijven werken, geen dubbele of verwijderde events/taken.
7. Beveiliging minstens even sterk: RLS op elke nieuwe tabel, rechten op de server, tests.
8. Bewijs dat niets verdween: rijen voor en na per tabel.
9. Plan zelf niets in: enkel de mogelijkheid voor vaste blokken, reeksen, weekoverleg en 1-op-1's bouwen; nooit iets aanmaken in iemands agenda.
10. Vaste platformregels (A-tot-Z 20.4 en CLAUDE.md): geen nieuwe modules zonder reden, klant blijft centraal, klantmails nooit automatisch, AI enkel voorstellen, meldingen uit één plek, één globale zoek, niets verdwijnt stil, hoogstens één korte zin onder een paginatitel.

Nieuwe dingen zoveel mogelijk in bestaande modules: scorecard en weekoverleg als tabbladen bij het Command Center; 1-op-1's, onboarding en functieprofielen in Personeel; werkinstructies en gedragsafspraken in Informatief; dienstencatalogus en merkinstellingen in Instellingen; "Te classificeren" als blok in Op te volgen. Nieuwe schermen achter een feature flag per module.

## 4. Fasen

| Fase | Inhoud | Backlog |
| --- | --- | --- |
| 0 | Inventaris en backup | |
| 1 | Bedrijf en dienstencatalogus als basis | A, B, 98, 99 |
| 2 | Merk, documenten, mails en klantapp | C, K |
| 3 | Teamagenda | E |
| 4 | Rollen, rechten en plug-and-play | F |
| 5 | Solutions als volwaardige omgeving en levering | D, G |
| 6 | Levering Media en sales | H, I |
| 7 | Financieel, scorecard en ritme | J, L |
| 8 | Documentatie bijwerken | 100 |

## 5. Backlog: 100 verbeteringen

### A. Bedrijf als vaste dimensie
1. "Bedrijf" (Media, Solutions, Algemeen) als vaste kolom op projectkaarten, offertes, contracten, factuurregels, aankopen, taken, meetings, shoots, opleveringen en aanvragen; één referentietabel `bedrijven`.
2. Een klant kan bij beide bedrijven klant zijn: bedrijf hoort op wat je met de klant doet; op de klantfiche een blok per bedrijf.
3. Nieuw contract: bedrijf verplicht, groot bovenaan het contract en in de lijst, filter.
4. Offertes en contracten mengen nooit stil twee bedrijven: elke regel heeft bedrijf en dienst (voorstel: per regel labelen of splitsen).
5. Factuurregels krijgen bedrijf en dienst mee uit het contract.
6. Klantenlijst: kolom en filter Bedrijf (Media, Solutions, beide), naast "Klant van".
7. Globale bedrijfsschakelaar (Alles, Media, Solutions) op elke lijst en elk dashboard, per gebruiker onthouden.
8. Command Center: filter per bedrijf.
9. Bedrijf eerste indeling, verantwoordelijke tweede, in lijsten, filters en rapporten.
10. Nieuwe projecten uit de mail: ook bedrijf en dienst voorstellen.

### B. Dienstencatalogus
11. Beheerbare catalogus in Instellingen → Diensten: naam, bedrijf, omschrijving, inbegrepen, niet inbegrepen, eenheid (eenmalig, per maand, per uur), actief, volgorde.
12. Startwaarden Media: Branding, Social media, Marketingstrategie & consultancy, Websites, Google & Meta Ads, Foto & video. Solutions: AI-automatisatie, Software op maat, Care.
13. Subdiensten (SEO en website-onderhoud onder Websites, e-mailmarketing onder Marketingstrategie).
14. Mappingtabel oude dienstwaarden → catalogus; oude waarde blijft; dubbelzinnig (consultancy) → Te classificeren.
15. Dezelfde catalogus voedt alle keuzelijsten (projectkaart, offerte-fiches, contract, factuurregel, klantfiche, aanvragen, expertkeuze).
16. Per dienst een vlag terugkerend/eenmalig; aandeel retainers zichtbaar.
17. Founders of Flanders blijft zoals het is (open vraag).

### C. Merk, documenten en mails
18. Merkinstellingen per bedrijf: handelsnaam, logo, kleuren, afzender, antwoordadres, voettekst, documentstijl.
19. Offerte-pdf toont de juiste handelsnaam.
20. Tegentekenen en algemene contracten: handelsnaam van het contract (of NextGen Agency BV voor algemene contracten); enkel nieuwe handtekeningen.
21. Solutions-mails van info@nextgensolutions.be zodra het domein bij Resend geverifieerd is; DNS-records in het rapport.
22. Huisstijl in het mailvenster volgt vanzelf het bedrijf; wisselen blijft mogelijk.
23. Templates in het E-mailcenter krijgen een bedrijf.
24. Contracttemplates en offertesjablonen per bedrijf, met filter.

### D. Solutions als volwaardige omgeving
25. Elke Solutions-deal gekoppeld aan een klant (bestaand of nieuw, VIES), zonder de pipeline-schermen te verliezen.
26. Eén bron voor leads en deals: Solutions-pipeline als weergave van Projecten met bedrijf Solutions en eigen fases; bestaande deals migreren met notities, waarde, bron, verloren-redenen, opvolgtaken; geen dubbels.
27. Closed Won maakt na bevestiging klant, contract en factuurplanning aan.
28. Dienstkeuze bij Solutions-deals: AI-automatisatie, Software op maat, Care.
29. Pipeline = prognose, gefactureerd = omzet; beide naast elkaar.
30. Solutions-blok op de klantfiche: lopende automatisaties, Care-contract, systemen, laatste controle.
31. Vesting: classificatie per contract als voorstel uit bedrijf en bron; tekenen door alle drie blijft; rekenregels ongewijzigd.

### E. Teamagenda
32. Teamagenda als standaard voor zaakvoerders: kolom per persoon in dag/week, met meetings, shoots, vaste blokken, beschikbaarheid; medewerkers openen op eigen agenda en schakelen met één klik naar Team.
33. Calendar-tab van de Meeting Inplanner samen met de teamagenda.
34. Privé-items van anderen als "Bezet" zonder details.
35. Vaste blokken als eigen type (Sales, Focuswerk, Overleg, Opleiding): herhalend, eigen kleur, slotje. Niets vooraf ingevuld.
36. Meeting Inplanner, /boeken en klantapp plannen nooit in een vast blok; intern: waarschuwing + reden.
37. Herhalende afspraken en taken als reeks, met uitzondering per keer. Enkel de functie.
38. Beschikbaarheid van studenten en werknemers als lichte achtergrond in hun kolom.
39. Kleur op bedrijf en filter op bedrijf.
40. Capaciteit per week: gepland tegenover beschikbaar, waarschuwing bij overboeking.
41. App als bron van waarheid, ClickUp als spiegel; syncstatus per item en conflictenlijst; niets automatisch verwijderd.
42. Knop Week plannen naast Dag afsluiten.
43. Agenda-abonnement (iCal) per persoon en per team.

### F. Rollen, rechten en plug-and-play
44. Rolsjablonen (modules, rechten, bedrijf, agenda-spaces, ClickUp-lijsten, Command Center-blokken, onboarding-checklist). Startsjablonen: Zaakvoerder, Operations, Uitvoerder Solutions, Uitvoerder Media, Appointment setter, Lead-onderzoeker, Stagiair. Bestaande snelle sets blijven.
45. Toegang per bedrijf, afgedwongen op de server en in RLS, met tests.
46. Nieuw account in vier stappen: gegevens, rolsjabloon, start- en einddatum, uitnodigen; dossier, agendakolom en onboarding vanzelf.
47. Onboarding-checklist per persoon met voortgang.
48. Functieprofiel in het personeelsdossier.
49. Werkinstructies in Informatief per bedrijf en dienst, met versies en "Gelezen".
50. Toegang tot klantlogins per medewerker en per klant; inzage gelogd; overzicht.
51. Offboarding in één scherm; niets verwijderd.
52. Namen uit de structuur halen ("Dagelijkse planning Chiara", INN · SLL · K · J aan een rol of instelling); data blijft.
53. Experts en verantwoordelijken uit Personeel en de catalogus.
54. Startpagina "Mijn werk" per rol, nooit lonen of kosten voor uitvoerders.
55. Studenten: 650 uur per kalenderjaar opvolgen, waarschuwing bij 80%.

### G. Levering Solutions
56. Projectfases na Closed Won: Briefing, User stories, Wacht op akkoord, In bouw, Review klant, Klaar, Care.
57. Briefing als vast formulier, verplicht voor User stories; AI-voorstel uit tijdscan-notities, mens bevestigt.
58. Tijdscan als meetingtype met notitiesjabloon, gekoppeld aan de deal.
59. User stories per project met acceptatiecriteria, schatting, status, bestede uren.
60. Definitie van klaar als checklist per user story.
61. Plan met vaste prijs uit goedgekeurde user stories; waarschuwing als er 5 dagen na de tijdscan geen plan is.
62. Wekelijkse review (30 min) als herhalende meeting per project, notities worden taken.
63. Care-register per klant.
64. Opleveringen ook voor Solutions (demo-video, handleiding, acceptatie per user story), schatting tegenover bestede uren.

### H. Levering Media
65. Standaard-deliverables per dienst die contentkalender en factuurplanning voeden.
66. Tijd per shoot (rijden, shoot, nabewerking).
67. Shoot binnen retainer/brandingtraject of eenmalig, met rapport.
68. Reeksen en vaste taken van de contentplanning aan een rol toewijzen.
69. Revisierondes tellen per oplevering en per klant.
70. Overzicht van wat vastzit bij klanten.

### I. Sales
71. Salesactiviteit per persoon en per bedrijf uit ABM-belresultaten.
72. Geplande tegenover gedane salesuren.
73. Trechter per bedrijf met conversie per stap.
74. Rol Lead-onderzoeker (ABM importeren, aanvullen, kwalificeren; geen financiën of contracten).
75. Knop "Doorgeven aan het andere bedrijf" op klantfiche en projectkaart.
76. Overal dezelfde bronnenlijst: outbound, inbound website, doorverwezen, netwerk, lezing, event, bestaande klant.
77. Redenen van verlies ook voor Media.

### J. Financieel
78. Omzet per bedrijf, per dienst en per maand (gefactureerd, gepland, terugkerend, eenmalig).
79. Maanddoel per bedrijf in de facturenplanner, voortgang naar €100.000 per maand.
80. Aankopen en kosten krijgen een bedrijf en optioneel klant of project.
81. Marge per klant en per project.
82. Minimumprijs en minimale marge per dienst; waarschuwing in de offerte-editor; doorgaan met gelogde reden.
83. Contracten die binnen 60 dagen aflopen worden een taak "Verlengingsgesprek".
84. Klantwaarde over de hele relatie, per klant en per bedrijf.
85. Export naar het facturatieprogramma met handelsnaam, bedrijf en dienst per regel.

### K. Klantapp
86. Klant bij beide bedrijven: per bedrijf een eigen blok en huisstijl.
87. Diensten aanvragen toont de catalogus per bedrijf; consultancy: eerst onderwerp (marketing of bedrijfsprocessen).
88. Solutions-klanten zien projectstatus, keuren user stories goed, zien Care-status.
89. Meeting boeken toont per bedrijf de juiste personen en respecteert vaste blokken.

### L. Cultuur en ritme
90. Scorecard met ~10 wekelijkse cijfers (eigenaar, doel, automatisch gevuld, rood/groen, 13 weken historiek).
91. Weekoverleg van de zaakvoerders met vaste agenda; notities worden taken.
92. Kwartaaldoelen per bedrijf en per persoon.
93. Beslissingenlog met stemming (twee van de drie).
94. Taak als belofte (wie, wat, aan wie, tegen wanneer) met overzicht per persoon.
95. 1-op-1's in Personeel, enkel zichtbaar voor die twee en de zaakvoerders.
96. Gedragsafspraken en rolverdeling als vaste pagina in Informatief, met versies en bevestiging.
97. Werkvoorraad per bedrijf op het Command Center (< 2, 2–4, > 4 weken).

### M. Data, veiligheid en onderhoud
98. Activiteitenlogboek registreert ook wijzigingen van bedrijf, dienst, rol en toegang, en inzage van klantlogins.
99. Wachtrij "Te classificeren" voor de zaakvoerders met voorstel en één klik om te bevestigen.
100. Na elke fase "De app van A tot Z" bijwerken.

## 6. Open vragen (beslist met een standaardkeuze, aan te passen)

- Offerte met diensten van beide bedrijven: per regel labelen (geen splitsing), zodat bestaande offertes niet veranderen.
- Bestaande "consultancy"- en twijfelrecords: per record in "Te classificeren", met een voorstel.
- Founders of Flanders: blijft een eigen merk op de projectkaart tot er beslist wordt.
- Agenda: eerst een conflictenlijst, de app wordt nog niet master.
- Intern uurtarief: instelbaar in Instellingen, standaard leeg (marge zonder uren tot het ingevuld is).
- Minimumprijzen per dienst: instelbaar in de catalogus, standaard leeg.
- Extra Solutions-diensten: toe te voegen in de catalogus.

## 7. Wat je niet doet

- Uitgeschakelde modules blijven uit en blijven bestaan.
- Geen chatassistent, geen AI die zelf iets bewaart of verstuurt.
- Geen automatische klantmails buiten de bestaande uitzonderingen.
- Geen wijzigingen aan de rekenregels van vesting of uitgaven vennoten.
- Geen sleutels of tokens in code, logs of op het scherm.
