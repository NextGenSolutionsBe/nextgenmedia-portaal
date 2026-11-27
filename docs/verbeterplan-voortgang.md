# Verbeterplan: voortgang

Werkt `docs/verbeterplan.md` af. Elke fase: wat er veranderde, rijen en checksums voor en na, wat in "Te classificeren" staat, wat nog open is.

## Fase 0: inventaris (26 nov 2026)

### Backup

- Supabase-project `NextGenApps` (eu-west-1, Postgres 17), organisatie op het **Pro**-plan: dagelijkse backups (7 dagen) staan aan in Supabase. Point-in-time recovery is een betalende extra en staat niet aan.
- Een eigen `pg_dump` kon niet vanuit deze omgeving: er staat geen databankwachtwoord in de omgeving (en dat hoort er ook niet). Wil je een eigen dump, dan: Supabase → Database → Backups → Download, of lokaal `supabase db dump`.
- Daarom: elke migratie is enkel toevoegend (nieuwe tabellen en nullable kolommen), backfills schrijven enkel in nieuwe kolommen, en voor en na elke migratie tellen we de rijen en vergelijken we een checksum van de bestaande kolommen.
- **Eigen backup (26 nov 2026, 21:28 UTC)**: schema `backup_voor_verbeterplan` met een volledige kopie van 236 tabellen van de app (73.518 rijen), niet bereikbaar via de app of de API. Nagekeken: alle aantallen gelijk, klanten, contracten, facturen en agenda identiek. Niet gekopieerd: andere apps, geheimen en logins, het draailogboek `clickup_agenda_runs`. Herstellen: `supabase/terugdraaien/herstel-uit-backup.sql`. Code van voor het plan: commit `733308a` op main.
- De databank is **gedeeld** met andere apps: `aanbesteding_*`, `community_*` (+ schema `community_inbox`), `harrie_*`, `mcp_oauth_*`. Die tabellen raken we nooit aan.

### Opslag (buckets)

| Bucket | Bestanden | MB |
| --- | --- | --- |
| fof-instagram | 166 | 2152 |
| client-uploads | 276 | 1978 |
| opleveringen | 24 | 727 |
| fof-media | 54 | 207 |
| contracts | 146 | 104 |
| contract-archief | 198 | 54 |
| founders-media | 6 | 12 |
| vesting | 25 | 8,5 |
| aanvragen | 3 | 8,2 |
| algemene-contracten | 3 | 7,7 |
| vennoot-uitgaven | 6 | 6,1 |
| personeel | 5 | 5,3 |
| archief | 1 | 1,9 |
| offertes | 1 | 1,1 |
| marketing | 4 | 0,3 |

### Belangrijkste tabellen (rijen op 26 nov 2026)

clients 67 · contracts 55 · contract_signatures 18 · offertes 0 · invoices 164 · invoice_lines 164 · recurring_invoices 6 · opdrachten 138 · opdracht_notities 230 · ngs_deals 14 · abm_bedrijven 313 · ag_items 5752 · klant_meetings 28 · shoot_briefings 3 · opleveringen 5 · klant_aanvragen 4 · purchases 2 · cost_entries 4 · invoice_costs 13 · team_taken 6 · vesting_contracten 23 · vesting_handtekeningen 75 · vennoot_uitgaven 7 · social_content_items 919 · metricool_statistieken 22050 · mail_berichten 581 · audit_log 2923 · personeel 8 · user_roles 55.

### Waar bedrijf en dienst vandaag al bestaan

- **Bedrijf**: `opdrachten.merk` (nextgenmedia 59, nextgensolutions 6, leeg 73; afgeleid via `bedrijfVan` in `lib/opdrachten-kanban.ts`, standaard NextGenMedia), `team_taken.merk`, `opdracht_taken.merk`, `sales_lead_taken.merk`, `ngs_deal_taken.merk`, `nieuwsbrieven.merk`, `offertes.merk`, `offerte_sjablonen.merk`, `contracts.tegengetekend_bedrijf` (wordt bij het tegentekenen afgeleid uit de kaart, standaard NextGenMedia: dus geen bewijs). De Solutions-pipeline (`ngs_deals`) is per definitie Solutions. Vesting: `vesting_contracten.lead_soort`.
- **Dienst**, drie woordenlijsten naast elkaar:
  - `service_slug` (clients/contracts/invoices/invoice_lines/revenue_entries): social-media, webdesign, foto-video, grafisch-ontwerp, marketing-consultancy, ads (`SERVICE_SLUGS` in `lib/utils.ts`).
  - `opdrachten.diensten`: social_media 42, webdesign 22, foto_video 19, grafisch 16, ngs 9, consultancy 5, advertising 5, "E-mailmarketing" 1, "Performance marketing" 1 (`DIENSTEN` in `lib/opdrachten-kanban.ts`).
  - Aanvragen (`lib/aanvragen/model.ts`): 11 dienstsoorten, 14 consultancysoorten, founder video.
  - Verder vrije tekst: `vesting_contracten.dienst`, `sales_leads.dienst`, `contracts.contract_type`.

### Records zonder bedrijf (voorspelling van de backfill)

| Tabel | Zeker uit een regel | Te classificeren |
| --- | --- | --- |
| opdrachten (138) | 65 via merk, 57 enkel Media-diensten, 5 enkel NGS | 11 (2 gemengd, 3 met consultancy, 6 zonder dienst) |
| contracts (55) | 49 via dienst, 2 via projectkaart | 4 (enkel "tegengetekend namens NextGenMedia") |
| invoices (164) | 88 via dienst, 49 via contract | 27 (17 contract zonder dienst, 10 zonder contract) |
| klant_meetings (28), purchases (2), cost_entries (4) | geen bron | allemaal, met voorstel |
| shoot_briefings (3), opleveringen (5) | Foto & video = Media | 0 |

### Wat vanzelf draait (en kan versturen)

- pg_cron: `klantmeetings-herinneringen` (5 min: herinneringsmails, events, opruimen), `clickup-agenda-sync` (elke minuut: ClickUp → Google), `agenda-clickup` (5 min: import), `agenda-mail` (elk uur), `metricool-statistieken` (10 min), `community-inbox-purge-expired-texts` (andere app).
- Vercel: metricool-daily, maintenance-reminder, personeel, mail-opvolging, blog-generate (uit).
- Databanktriggers: enkel `updated_at` bijwerken, `contract_archief_onveranderlijk`, `materiaal_activiteiten_alleen_toevoegen`, de leadtriggers van de oude pipeline en `harrie_verwerk_event` (andere app). Geen trigger verstuurt iets.
- Backfills gebeuren in SQL op nieuwe kolommen: geen enkele route of cron wordt aangeroepen, dus geen mail, ClickUp, Google of melding. Waar een `updated_at`-trigger staat, wordt die tijdens de backfill uitgezet zodat bestaande tijdstempels niet veranderen.

### Checksums voor Fase 1 (bestaande kolommen)

| Tabel | Rijen | Checksum |
| --- | --- | --- |
| clients | 67 | 3907bb1544e443cccfe25f7f79a7a821 |
| contracts | 55 | da4007fe7a53a5ec73c68133dcb9b7e8 |
| offertes | 0 | d41d8cd98f00b204e9800998ecf8427e |
| invoices | 164 | e59437d212e7b6bf5e86cb4e6058cccd |
| invoice_lines | 164 | 251db9bbd8ea5763e72b58807a062532 |
| opdrachten | 138 | d95c36be3b0f6e3380dc18e26e2b8b34 |
| ag_items | 5752 | 00523b43518e5d583a2c9d7c7b242597 |
| klant_meetings | 28 | f3dc893f8ee7a9d710e838acd6d54b46 |
| shoot_briefings | 3 | 53e104ab9af3467020602ec1444dcbbf |
| vesting_contracten | 23 | e323a32b0825b7dfc656bc7adf0a41e1 |
| vennoot_uitgaven | 7 | 9f203d8ca597411dba52276162fd2d4d |
| purchases | 2 | e9ad22edd08d22b984ed96227b36d821 |
| cost_entries | 4 | 2d84231b02d24940407899dbcf44de4d |
| invoice_costs | 13 | 15efaba5bdbfec0f0fb89acd9cbd2dd3 |
| recurring_invoices | 6 | 9f10ed6681695242ffca22b5eb28b013 |
| team_taken | 6 | 111bd8bdcedea7e7a839c26cf9db5f1a |
| opleveringen | 5 | 2367097de8e9e2c4faa0bba3be699753 |
| klant_aanvragen | 4 | 3b3bb8cfce0b66a2f1745b58efb67cdb |
| ngs_deals | 14 | fe43cf0103d068daf1dfd89302f9e71a |
| contract_signatures | 18 | 22341505903b20c1bfe102fd05ab6fbd |
| vesting_handtekeningen | 75 | 71b92121aac7eaeeb6627e9d9a102967 |

Checksum = md5 van alle rijen als json, zonder de nieuwe kolommen (`bedrijf`, `dienst`, `dienst_slugs`).

### Mapping oude diensten → catalogus

| Oude waarde | Nieuwe dienst | Bedrijf | Zeker? |
| --- | --- | --- | --- |
| social-media, social_media, Social media | Social media | Media | ja |
| webdesign, website | Websites | Media | ja |
| foto-video, foto_video, content_shoot | Foto & video | Media | ja |
| grafisch-ontwerp, grafisch, branding | Grafisch ontwerp (onder Branding) | Media | ja |
| ads, advertising, sea, meta_ads, google_ads | Google & Meta Ads | Media | ja |
| marketing-consultancy, strategie | Marketingstrategie & consultancy | Media | ja |
| seo, seo_scan | SEO (onder Websites) | Media | ja |
| email, E-mailmarketing | E-mailmarketing (onder Marketingstrategie) | Media | ja |
| ai (aanvraag) | AI-automatisatie | Solutions | ja |
| consultancy (projectkaart) | voorstel: Marketingstrategie | Media | nee |
| ngs (projectkaart) | voorstel: AI-automatisatie | Solutions | bedrijf ja, dienst nee |
| Performance marketing | voorstel: Google & Meta Ads | Media | nee |
| ai_scan, workflow_scan, ai_workshop, crm_advies, sales_ops_scan | voorstel: AI-automatisatie | Solutions | nee |
| founder_video, founders | voorstel: Foto & video | Media | nee (Founders of Flanders blijft een open vraag) |

### Open vragen en de standaardkeuze die we nu nemen

Zie hoofdstuk 6 van het plan. Er werd gevraagd niets te vragen, dus de standaardkeuzes daar gelden tot iemand ze aanpast.

## Fase 1: bedrijf en dienstencatalogus (26 nov 2026)

### Wat er veranderde

- **Databank** (enkel toevoegend): tabellen `bedrijven` (NextGen Media, NextGen Solutions, Algemeen), `diensten_catalogus` (13 diensten, met subdiensten), `dienst_mapping` (oude waarde → catalogus, met wat zeker is), `te_classificeren` (de wachtrij). Kolommen `bedrijf` en waar zinvol `dienst` op projectkaarten (`dienst_slugs`), offertes, contracten, facturen, factuurregels, maandreeksen, aankopen, kosten, factuurkosten, teamtaken, meetings, shoots, opleveringen en aanvragen; `dienst` op Solutions-deals; `gebruikers_voorkeuren.bedrijf_filter`.
- **Backfill** volgens vaste regels (merk op de kaart, dienst van het contract of de factuur, contract van de factuur, soort oplevering, type aanvraag, shoots = Foto & video). Nooit uit de verantwoordelijke.
- **Nieuwe records** krijgen hun bedrijf en dienst vanzelf via databanktriggers met dezelfde regels (vullen enkel lege velden, versturen niets). Een nieuwe projectkaart, contract of factuur zonder bedrijf komt in de wachtrij; wie het bedrijf kiest, lost de vraag vanzelf op.
- **Schermen**: Instellingen → **Diensten** (catalogus beheren), blok **Te classificeren** op het Command Center (zaakvoerders; voorstel bevestigen of iets anders kiezen, per soort alles in één keer), **schakelaar Alles / Media / Solutions** in de zijbalk (per gebruiker onthouden; filtert Klantcontracten, Klanten en Projecten; Algemeen en nog niet geclassificeerd blijven altijd zichtbaar), **bedrijf verplicht** bij Nieuw contract en Contract uit template (voorstel uit de dienst of de projectkaart), **bedrijf groot bovenaan het contract** (aan te passen, gelogd, geeft het door aan facturen zonder bedrijf), label in de contractenlijst, **Klant bij** (Media, Solutions, beide) als kolom en filter op Klanten.
- **Logboek**: elke keuze van bedrijf of dienst en elke wijziging in de catalogus in het activiteitenlogboek (`bedrijf.zet`, `dienst.zet`, `dienst.nieuw`, `dienst.wijzig`).

### Rijen en checksums na de migratie

Alle 21 tabellen: zelfde aantal rijen en **identieke checksum** van de bestaande kolommen als voor de migratie (zie tabel bij Fase 0). Geen bestaande waarde veranderde. Terugdraaien getest in een transactie (`supabase/terugdraaien/fase1.sql`).

### Bedrijf na de backfill

| Tabel | Media | Solutions | Leeg (in de wachtrij) |
| --- | --- | --- | --- |
| opdrachten (138) | 116 | 11 | 11 |
| contracts (55) | 54 | 1 | 0 |
| invoices (164) | 153 | 1 | 10 |
| invoice_lines (164) | 153 | 2 | 9 (volgen hun factuur) |
| recurring_invoices (6) | 5 | 0 | 1 |
| klant_aanvragen (4) | 2 | 1 | 1 |
| opleveringen (5) | 5 | 0 | 0 |

### Te classificeren (77 open vragen)

opdrachten: bedrijf 11, dienst 14 · contracts: dienst 6 · invoices: bedrijf 10 · recurring_invoices: bedrijf 1 · klant_meetings: bedrijf 28 · purchases: bedrijf 2 · cost_entries: bedrijf 4 · klant_aanvragen: bedrijf 1. Elke vraag heeft een voorstel (behalve 2 contracten zonder dienst).

### Nog open uit fase 1

- B15: de bestaande keuzelijsten (projectkaart, offerte-fiches, klantdiensten, aanvragen) gebruiken nog hun eigen lijst; de catalogus legt er een vertaling over (`dienst_mapping`). Volledig omschakelen gebeurt per scherm in de volgende fasen.
- A7/A8: de schakelaar filtert Klanten, Klantcontracten en Projecten; Facturen en het Command Center volgen in fase 7 (financieel) en bij de scorecard.

## Fase 2: merk, documenten, mails en klantapp (26 nov 2026)

### Wat er veranderde

- **Merkgegevens per bedrijf** (C18): `bedrijven` kreeg `website`, `email`, `antwoord_email`, `voettekst`. Aan te passen in Instellingen → Diensten → **Bedrijven** (gelogd als `bedrijf.merk`).
- **Offerte-pdf** (C19): de dienstverlener toonde al de handelsnaam van het merk van de offerte (NextGenSolutions bij een Solutions-offerte). Ongewijzigd gelaten.
- **Tegentekenen** (C20): "namens …" volgt nu eerst het bedrijf van het contract, daarna het merk van de projectkaart. **Algemene contracten** worden ondertekend "namens NextGen Agency BV". Enkel voor nieuwe handtekeningen; bestaande pdf's blijven exact zoals ze zijn.
- **Afzender Solutions** (C21): de code stuurt Solutions-mails al vanaf info@nextgensolutions.be zodra dat domein bij Resend geverifieerd is (tot dan vanaf info@nextgenmedia.be met de naam NextGenSolutions en antwoordadres info@nextgensolutions.be). **Nog te doen door jullie**: in Resend het domein nextgensolutions.be toevoegen en de DNS-records die Resend toont (SPF/TXT, DKIM, eventueel MX voor bounces) bij de domeinbeheerder zetten. Resend geeft de exacte waarden per account; die staan niet vast en kan ik niet van hieruit ophalen.
- **Huisstijl van de mail** (C22): een contractmail opent nu in de huisstijl van het bedrijf van het contract (Solutions = blauw). Offertes en projecten deden dat al. Wisselen blijft kunnen.
- **Templates per bedrijf** (C23, C24): `email_templates.bedrijf`, `contract_templates.bedrijf`, `offerte_sjablonen.bedrijf` (offertesjablonen overgenomen van hun merk). In het E-mailcenter en bij contracttemplates kies je het bedrijf (leeg = beide); het label staat bij de template. "Contract uit template" neemt het bedrijf van de template als voorstel.
- **Klantapp** (K86, K87): Diensten aanvragen en Consultancy aanvragen tonen de keuzes per bedrijf ("Marketing en content · NextGen Media", "Automatisatie en software · NextGen Solutions", "Iets anders"). Een contract van Solutions toont "NextGen Solutions" in de contractenlijst van de klant.

### Nog open uit fase 2

- K86 volledig (eigen blok en huisstijl per bedrijf in de hele klantapp), K88 (projectstatus en user stories voor Solutions-klanten, hangt af van fase 5) en K89 (Meeting boeken per bedrijf en vaste blokken, hangt af van fase 3).
- C18: de merkgegevens staan in de databank en zijn aan te passen; de mailopmaak (`lib/merk-mail.ts`) gebruikt nog de vaste waarden. Omschakelen naar de databank is een volgende stap.

## Fase 3: teamagenda (27 nov 2026)

Hervat op vraag ("ga verder met de punten die nog openstaan").

### Wat er veranderde

- **E32 teamweergave**: knop Team in de agenda; dag = kolom per persoon, week = rij per persoon met capaciteit. De agenda opent nog altijd op je eigen agenda (uitdrukkelijke vraag van 25 nov 2026), dus niet standaard Team voor zaakvoerders.
- **E33**: meetings uit de Meeting Inplanner staan al in dezelfde kalender (sinds 25 nov); Calendar blijft voor het plannen met Google.
- **E34 Bezet**: privé-items en items uit lijsten die je niet ziet, als "Bezet" zonder titel in de teamweergave.
- **E35/E37 reeksen**: vaste blokken (Sales, Focuswerk, Overleg, Opleiding), herhalende afspraken en taken, met uitzondering per keer. Niets vooraf ingevuld.
- **E36**: klantboekingen (`/boeken`, klantapp) en de vrije momenten van Calendar nooit in een vast blok; intern een waarschuwing met de reden.
- **E38/E40 beschikbaarheid en capaciteit**: per persoon per weekdag; gepland tegenover beschikbaar per dag en per week, rood bij overboeking.
- **E41**: geen master-omschakeling (open vraag: eerst een conflictenlijst). Lijst "Verschillen met ClickUp" met App-versie houden of ClickUp-versie overnemen; niets automatisch verwijderd.
- **E42 Week plannen** naast Dag afsluiten.
- **E43 agenda-abonnement** (iCal) per persoon en per team, in te trekken.
- **E39 kleur en filter op bedrijf**: nog niet. Agenda-items hebben (nog) geen bedrijf; komt samen met fase 7 (bedrijf op taken en lijsten).

### Databank

Nieuwe tabellen `ag_reeksen`, `ag_beschikbaarheid`, `ag_ical_links` (RLS aan, enkel de service-role) en nieuwe kolommen op `ag_items` (`reeks_id`, `reeks_datum`, `clickup_verschil_op`, `clickup_verschil`). Geen backfill. `ag_items`: 5763 rijen voor en na de migratie, identieke checksum van de bestaande kolommen (0c64a21512310c51a8afe3a57b3e43b5). Terugdraaien: `supabase/terugdraaien/fase3.sql`.

## Fase 4: rollen, rechten en plug-and-play (27 nov 2026)

### Wat er veranderde

- **F44 rolsjablonen**: zeven startsjablonen (Zaakvoerder, Operations, Uitvoerder Solutions, Uitvoerder Media, Appointment setter, Lead-onderzoeker, Stagiair) met rol, modules, bedrijf, startpagina en onboarding. Aan te passen of uit te zetten in Instellingen → Medewerkers. De bestaande snelle sets blijven.
- **F45 toegang per bedrijf**: een werknemer kan beperkt worden tot NextGenMedia of NextGenSolutions. Dan staat zijn weergave vast op dat bedrijf (Klanten, Klantcontracten, Projecten), op de server afgedwongen. RLS speelt hier geen rol: de admin leest via de service-role, de modules blijven het slot.
- **F46 nieuw account in vier stappen**: gegevens, rol, start en einde, uitnodigen (enkel met vinkje). Dossier, plaats in de teamagenda en onboarding komen vanzelf.
- **F47 onboarding-checklist** met voortgang, af te vinken door de beheerder en door de persoon zelf (Mijn account).
- **F48 functieprofiel** in het personeelsdossier.
- **F49 werkinstructies** in Informatief, per bedrijf, dienst of rol, met versies en "Gelezen".
- **F51 offboarding** in één venster: wat openstaat, laatste werkdag, login blokkeren, agenda-abonnementen intrekken. Niets verwijderd.
- **F52**: "Dagelijkse planning Chiara" haalt de naam uit de instellingen (standaard Chiara, dus niets verandert op het scherm).
- **F54 startpagina per rol** na het inloggen (enkel als de persoon die module heeft). "Mijn werk" (inklokken, planning) bestond al.
- **F55 studenten**: 650 uur per kalenderjaar, kaart in het dossier, melding vanaf 80%.
- **M98**: rolsjablonen, toegang, onboarding, vertrek en werkinstructies komen in het activiteitenlogboek.

### Niet gebouwd en waarom

- **F50 klantlogins per medewerker**: de app bewaart geen leesbare wachtwoorden van klanten (bewust, Supabase bewaart ze gehasht). Er is dus niets om per medewerker te delen of in te zien. Komt er ooit een kluis, dan hoort dit erbij.
- **F53 verantwoordelijken uit Personeel**: de experts komen al uit Personeel. De keuze Marco, Bram, Chiara of Gezamenlijke lead staat nog vast in de code; omschakelen raakt contracten, vesting en tegentekenen en is een aparte stap.

### Databank

Nieuwe tabellen `rol_sjablonen`, `onboarding_stappen`, `werkinstructies`, `werkinstructie_versies`, `werkinstructie_gelezen` (RLS aan, enkel de service-role) en nieuwe kolommen op `staff_members` (`rol_sjabloon`, `bedrijven`, `start_datum`, `eind_datum`, `offboarding_op`, `offboarding_door`, `offboarding_notitie`) en `personeel` (`functieprofiel`). Geen backfill. `staff_members`: 4 rijen voor en na, checksum 0d21aa114ab97bbaf5593113adddfda4 ongewijzigd. `personeel`: 8 rijen voor en na, checksum fba9c44397fef336df46fb59b7d0a865 ongewijzigd. Terugdraaien: `supabase/terugdraaien/fase4.sql`.

## Fase 5: NextGenSolutions als volwaardige omgeving en levering (27 nov 2026)

### Wat er veranderde

- **D25 deal aan een klant**: optioneel, met de gewone klantkiezer (bestaand of nieuw, VIES). De pipeline-schermen blijven.
- **D27 Closed Won**: in het dealvenster de volgende stappen op een klik: leveringsproject starten, contract opmaken (facturen volgen zoals bij elk getekend contract), tijdscan inplannen. Er wordt niets vanzelf aangemaakt.
- **D29 prognose en omzet**: Cijfers toont naast de omzet uit de pipeline ook wat gefactureerd is (facturen met bedrijf NextGenSolutions).
- **D30 Solutions-blok op de klantfiche**: deals, leveringsprojecten en Care.
- **D31 vesting**: voorstel voor inbound of outbound uit het bedrijf en de bron; aanduiden en tekenen blijft bij de drie, rekenregels ongewijzigd.
- **G56 projectfases** Briefing, User stories, Wacht op akkoord, In bouw, Review klant, Klaar, Care, met de regels die de volgorde bewaken.
- **G57 briefing** als vast formulier, verplicht voor user stories; AI-voorstel uit de tijdscan-notities, een mens bevestigt.
- **G58 tijdscan**: datum, notitiesjabloon en een knop om ze in te plannen in de Meeting Inplanner; gekoppeld aan de deal via het project. (Geen apart meetingtype in de Meeting Inplanner: dat zou de bestaande meetingflow raken.)
- **G59/G60 user stories** met acceptatiecriteria, schatting, status, bestede uren en een definitie van klaar per story.
- **G61 plan met vaste prijs** uit de goedgekeurde stories; melding als er 5 dagen na de tijdscan geen plan is.
- **G62 wekelijkse review** van 30 minuten als herhalende afspraak in de agenda (enkel op een klik); notities worden actiepunten.
- **G63 Care-register** per klant.
- **G64**: acceptatie per user story, schatting tegenover bestede uren, en een link naar Opleveringen voor de demo-video en handleiding (die module deed al alle bestandstypes per klant).

### Niet gebouwd en waarom

- **D26** (de Solutions-pipeline als weergave van Projecten, deals migreren): op 22 nov 2026 werd uitdrukkelijk gekozen voor een eigen omgeving los van Projecten. Migreren zou dat terugdraaien en is niet zonder risico op dubbels; de koppeling loopt nu via de klant.
- **D28** (dienstkeuze AI-automatisatie, Software op maat, Care): op 22 nov 2026 vervangen door vrije info. Care staat nu als register, niet als dienstkeuze op de deal.
- **K88** (projectstatus en user stories in de klantapp): de klant keurt stories nu goed via ons (vinkje "klant akkoord"). Een eigen scherm in de klantapp is een nieuwe portaalmodule en volgt als jullie dat willen.

### Databank

Nieuwe kolom `ngs_deals.client_id` (leeg, FK naar klanten met ON DELETE SET NULL) en nieuwe tabellen `ngs_projecten`, `ngs_user_stories`, `ngs_care` (RLS aan, enkel de service-role). Geen backfill. `ngs_deals`: 16 rijen voor en na, checksum 37e438a38f460f7822c2c2a2ea7b314a ongewijzigd. Terugdraaien: `supabase/terugdraaien/fase5.sql`.

## Fase 6: levering Media en sales (27 nov 2026)

### Wat er veranderde

- **H65 standaard-deliverables per dienst**: in Instellingen → Diensten per dienst een lijstje zoals "12 posts per maand". De contentkalender (admin, Social media) toont per klant voor deze en volgende maand hoeveel er gepland staat tegenover wat standaard afgesproken is. Enkel een richtlijn: er wordt niets aangemaakt.
- **H66/H67 tijd per shoot en soort afspraak**: in de editor van de Shoot planner rijden, shoot en nabewerking (typen zoals 1u30 of 90) en binnen retainer, brandingtraject of eenmalig. Onder de kalender een rapport per maand per klant (aantal shoots, tijd per onderdeel, per soort afspraak; geannuleerd telt niet).
- **H68 rol op de planning**: elke vaste taak en elke reeks van de dagelijkse planning kan een rol of naam krijgen (Instellingen van de planning). Die staat als label bij de taak en de reeks. Leeg = de planningspersoon zoals vroeger.
- **H69 revisierondes per klant**: in Opleveringen een uitklapblok met per klant het aantal opleveringen, rondes, gemiddelde en hoe vaak alle rondes opgebruikt waren.
- **H70 wacht op de klant**: op Klanten een uitklapblok met per klant wat er op hen wacht (contract tekenen, offerte beantwoorden, content goedkeuren, oplevering bekijken, offerte op een aanvraag) en hoe lang al. Enkel een overzicht, nooit een herinnering vanzelf.
- **I71–I73 verkoopcijfers** (`/admin/opdrachten/verkoop`, linkje onderaan Projecten): trechter per bedrijf met conversie per stap (Media op het bord Projecten, Solutions uit de pipeline), resultaat per bron, redenen van verlies, salesactiviteit per persoon uit de ABM-belnotities, en geplande salesuren (vaste blokken Sales in de teamagenda) tegenover gehouden verkoopafspraken. Per maand, kwartaal of jaar.
- **I74 Lead-onderzoeker**: zat al in fase 4 als rolsjabloon (Projecten en ABM, geen financiën of contracten).
- **I75 doorgeven aan het andere bedrijf**: knop op de klantfiche en het projectvenster. Naar Solutions = een deal in Afspraak gekoppeld aan de klant; naar Media = een kaart in Opvolging (verantwoordelijke verplicht). Bron "Bestaande klant", met een notitie; er vertrekt geen mail.
- **I76 één bronnenlijst**: Outbound, Inbound website, Doorverwezen, Netwerk, Lezing, Event, Bestaande klant, voor Projecten en NextGenSolutions. Oude waarden (inbound, doorverwijzing, andere) blijven geldig en leesbaar; er werd niets omgezet. De vesting-suggestie leest beide.
- **I77 redenen van verlies ook voor Media**: bij Verloren op Projecten dezelfde snelle keuzes als bij Solutions (Te duur, Geen budget of timing, Koos een andere partij, Geen reactie meer, Niet de juiste fit) of vrije tekst.

### Niet gebouwd en waarom

- **H65, factuurplanning**: de facturen uit het contract komen uit het contract zelf (AI leest prijzen en posten). De standaard-deliverables daar ook in steken kan botsen met wat in het contract staat; wat in het contract staat gaat voor. De deliverables voeden dus enkel de contentkalender.
- **I71 per bedrijf**: de ABM-lijst kent geen bedrijf (NextGenMedia of NextGenSolutions) per prospect, dus de activiteit staat per persoon. De trechters staan wel per bedrijf.

### Databank

`shoot_briefings`: nieuwe kolommen `tijd_rijden_min`, `tijd_shoot_min`, `tijd_nabewerking_min`, `afspraak_soort` (leeg). `diensten_catalogus.deliverables` (jsonb, standaard leeg). `opdrachten_bron_check` verruimd met de nieuwe bronnen (de oude blijven toegelaten). Geen backfill. Checksums voor en na gelijk: `shoot_briefings` 4 rijen 41f91ee70b2fa5a3918a60cfd5bf4caf, `diensten_catalogus` 13 rijen f22935d1d3afa7ff09b955bac0f0d958, `opdrachten` 140 rijen (id + bron) fdd4671c3188a40dcea08af1d0260838. Terugdraaien: `supabase/terugdraaien/fase6.sql`.

## Waar we stoppen

Op vraag van de zaakvoerders (26 nov 2026) gestopt na fase 2; op 27 nov 2026 hervat. Fasen 3 (teamagenda), 4 (rollen en plug-and-play), 5 (Solutions-levering) en 6 (Media-levering en sales) zijn af. Fasen 7 (financieel en ritme) en 8 (documentatie) volgen.
