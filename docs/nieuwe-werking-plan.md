# Plan: de app afstemmen op de nieuwe werking

28 nov 2026. Status: **akkoord gekregen op 28 nov 2026** (alle voorstellen gevolgd: Media = Chiara, voorstel = contract van NextGenSolutions, stil akkoord per klant en standaard uit, rechten getest op de server, volgorde 1 tot 9).

## Voortgang

- **Fase 5: af en live (28 nov 2026).** Geen facturen gemaakt voor bestaande deals (er zat nog geen deal in Audit). Solutions kreeg betaaltermijn 30 dagen; Media en Algemeen staan leeg, dus daar blijft het zoals het was (offertes 14, facturen 30: zie Nog te beslissen 2). Onderweg gevonden: een opgemaakte offerte van Solutions toonde "handelsnaam NextGenMedia"; dat komt nu uit de bedrijven-tabel.
- **Fase 4: af en live (28 nov 2026).** Geen data omgezet: er waren nog geen leveringsprojecten. Het oude "Plan met vaste prijs" verdwijnt zodra een project workflows heeft; zonder workflows blijft het staan, zodat niets stil verdwijnt. De definitie van klaar wordt afgeleid (geen aparte kolom `dod`). Workflows hangen aan hun processen via `ngs_audit_processen.workflow_id` (geen `proces_ids`).
- **Fase 3: af en live (28 nov 2026).** Geen data omgezet: er waren nog geen rapporten.
- **Fase 2: af en live (28 nov 2026).** Geen data omgezet; de 16 deals bleven in hun fase. De 12 Solutions-kaarten staan op de lijst bovenaan Projecten om te beslissen.
- **Fase 1: af en live (28 nov 2026).** Yasmine en Jonathan hebben nog geen account; hun profiel en rechten komen vanzelf mee als jullie het account maken met hun sjabloon.

## Wat ik vond

Dit bepaalt een deel van het plan:

- **Yasmine en Jonathan** staan nog niet in Personeel en hebben geen account.
- **Sjabloon Uitvoerder Solutions** geeft nu Projecten (het bord toont "gefactureerd €X van €Y") en de volledige module NextGenSolutions (dealwaarden, Cijfers met omzet). Uitvoerder Media geeft Klanten.
- **Pipeline**: 16 deals (5 Afspraak, 2 Voorstel maken, 7 Opvolgen, 2 Closed Won). Geen enkel leveringsproject, geen user stories, geen Care. De tijdscan zit nu ná Closed Won, in het leveringsproject.
- **Projecten**: 12 kaarten met bedrijf NextGenSolutions (7 Opvolging, 2 Offerte gestuurd, 2 In uitvoering, 1 Verloren).
- **Contentgoedkeuring**: de voorbije 120 dagen staan 421 posts "bij klant", 52 goedgekeurd, 3 met feedback. Goedkeuringsdeadlines zijn nooit gebruikt. Geen enkele klant heeft een Metricool-feedbacklink. De code zegt nu uitdrukkelijk: nooit automatisch goedkeuren.
- **Betaaltermijn**: offertes 14 dagen, facturen 30 dagen (Instellingen). Facturen die uit een contract komen hebben 30 dagen vast in de code.
- **Handelsnaam**: op offertes staat "NextGenMedia" vast in de code (`lib/offerte-afzender.ts`). De kolom `bedrijven.handelsnaam` bestaat al.
- **Opleveringen**: 3 dagen vast in de code (`BEWAARTERMIJN_DAGEN`).

## Voor alle fases

- **Instellingen**: elke waarde uit de opdracht krijgt een beginwaarde en een veld in Instellingen, enkel aan te passen door zaakvoerders. Opslag in `app_settings` (één sleutel per onderwerp) of in `bedrijven` / `diensten_catalogus` als het daar hoort. Elke instelling wordt nagekeken door één `lees…`-functie, zoals `leesScorecard`. Ongeldig = de beginwaarde.
- **Migraties**: additief en idempotent in `supabase/migrations/99999999_SYNC_ALL.sql`, een terugdraaiscript per fase in `supabase/terugdraaien/`, rijen en checksum vóór en na. Nooit een kolom of rij weg.
- **Na elke fase**: typecheck, lint, tests, build, gsm-screenshots, rechtentest per rol, document en CLAUDE.md bijwerken, live, korte lijst voor jou.
- **Volgorde**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Fase 7 (Media) hangt niet af van 2 tot 6 en kan vroeger als je dat liever hebt.

---

## Fase 1. Rollen en structuur

**Databank**
- `ritme_beslissingen`: `domein` (solutions, media, financien_legal, interne_werking, meerdere) en `eigenaar`.
- `personeel`: niets nieuw. Het functieprofiel (`functieprofiel` jsonb) bestaat al.

**Instellingen**
- `rollen_domeinen`: eigenaar per domein. Voorstel: Solutions = Marco, Interne werking = Marco, Financiën & legal = Bram, Media = **nog te kiezen** (Bram of Chiara).
- `planning_media`: standaardeigenaar per soort werk: management = Chiara, uitvoering = Yasmine, shoots = Bram.
- Weekoverleg: dag, uur en duur (vrijdag 16:00, 30 min).

**Code en schermen**
- Personeel: de vijf rollen in het functieprofiel (enkel tekst, via het bestaande formulier).
- Rolsjablonen (`lib/team/rollen.ts`): Uitvoerder Solutions verliest Projecten en de verkoop van NextGenSolutions. Jonathan krijgt enkel Levering (zie rechten). Uitvoerder Media houdt Klanten, maar zonder bedragen.
- **Rechten splitsen** binnen NextGenSolutions: `/admin/nextgensolutions/levering` krijgt een eigen recht `ngs_levering`. De pipeline en Cijfers blijven `nextgensolutions`. Dat is geen nieuwe module, enkel een apart slot op een bestaande pagina.
- **Rechtencontrole voor uitvoerders**, op de server: klantfiche (contractwaarden, facturen), Projecten (gefactureerd), Shoot planner (uren × tarief), Command Center-blokken (facturen plannen, werkvoorraad met bedragen), zoekresultaten. Wat een bedrag of kost is, verdwijnt zonder `finance` of `invoices`. Lonen staan enkel in Personeel (enkel zaakvoerders), Vesting en Uitgaven vennoten blijven enkel voor admins.
- Ritme → Beslissingen: veld Domein. Eén domein = de eigenaar beslist met één klik ("Beslist"), zonder stemming. Meerdere domeinen = de stemming twee op drie zoals nu.
- Ritme → Weekoverleg: knop **Vast moment instellen**. Die maakt pas na de klik een vast blok "Overleg" (`ag_reeksen`, blok_type overleg) voor de drie vennoten. Tijdens dat blok staat bovenaan het Command Center "Weekoverleg loopt nu", met de knop die het Weekoverleg van deze week opent.
- Planning: zijbalk en titel heten **Planning Media**. Elke vaste taak, extra taak en vervolgstap krijgt een `soort` (management, uitvoering, shoot), met de eigenaar uit de instelling. Per taak aan te passen (`VasteTaak.rol` bestaat al). "Taak Bram: shootbriefing opstellen & doorsturen" wordt "Shootbriefing opstellen & doorsturen", met als eigenaar wie de shoots doet. De sleutel `shootbriefing` blijft, dus wat al afgevinkt is blijft afgevinkt.

**Bestaande data**: niets omgezet. Bestaande beslissingen krijgen domein leeg = "meerdere" (stemming zoals nu).

**Nodig van jou**: de e-mailadressen van Yasmine en Jonathan (dan maak ik hen aan via Nieuw account, of jullie doen het zelf). Jonathan als student in Personeel, beschikbaar op donderdag en vrijdag.

**Klaar wanneer**: elke rol staat in Personeel, Yasmine en Jonathan zien enkel hun modules (getest op de server), een beslissing binnen één domein wordt bewaard zonder stemming, en Planning Media toont per taak wie ze doet.

---

## Fase 2. Verkoop bij Solutions

**Databank**
- `ngs_deals`: `vervolg_op` (timestamptz), `vervolg_meeting_id`, `processen` (1–5), `audit_prijs`, `audit_contract_id`, `audit_buiten_app` (bool + notitie), `auditdag_op`, `presentatie_op`, `audit_checklist` (jsonb).
- `klant_meetings`: `ngs_deal_id`, zodat een meeting uit de Meeting Inplanner bij de deal hoort.
- `ngs_deal_notities`: `uitkomst` (zoals bij ABM: niet opgenomen, voicemail, gesproken …) voor belpogingen.
- Nieuwe tabel `ngs_deal_fases` (deal, van, naar, op, door): de geschiedenis van elke verplaatsing. Nodig voor de trechter en de scorecard in fase 8.
- `contracts`: `ngs_deal_id`.
- De controle op `ngs_deals.fase` krijgt er `audit` en `opvolgen_rapport` bij.

**Instellingen** (`ngs_verkoop`): auditprijs basis € 450 en per proces € 295, opvolgen om de 7 dagen, presentatie uiterlijk 7 dagen na de auditdag, ongeveer 10 minuten presentatie per proces.

**Code en schermen**
- Fases: Afspraak → **Voorstel** → **Opvolgen voorstel** → **Audit** → **Opvolgen rapport** → Closed Won / Closed Lost.
- **Naar Voorstel**: het venster vraagt de vervolgafspraak. **Inplannen** opent de Meeting Inplanner met de deal ingevuld. Wie de datum al elders vastlegde, vult ze zelf in. De kaart toont "Vervolgafspraak do 4 dec 14:00". Zonder vervolgafspraak een gele waarschuwing op de kaart.
- **Voorstel versturen**: zie vraag 2 hieronder. De knop werkt pas als de vervolgafspraak er staat.
- **Opvolgen**: in het dealvenster "Belpoging" met een uitkomst en een notitie. Daarna stelt de app de volgende opvolgtaak voor op 7 dagen (de bestaande ClickUp-opvolgtaak, datum aan te passen). Te laat = rood. Geldt in Opvolgen voorstel en Opvolgen rapport.
- **Naar Audit**: verplicht het aantal processen, de auditprijs (berekend, `auditPrijs(n)`), het getekende voorstel (contract uit de app of "getekend buiten de app"), de auditdag en de datum van de presentatie. Ligt de presentatie meer dan 7 dagen na de auditdag, dan een waarschuwing. In de fase Audit een checklist: auditdag (Marco), briefing van 30 minuten aan Jonathan (maakt een taak), rapport (Jonathan), presentatie (≈ 10 min × processen).
- **Tijdscan heet overal Audit** (admin, klantapp, document). Het notitiesjabloon `TIJDSCAN_SJABLOON` wordt het sjabloon voor de auditnotities.
- **Closed Won**: de klant zegt ja op het rapport en tekent. Het leveringsproject start met de workflows uit het rapport (fase 3 en 4).
- **Projecten zonder Solutions**: bij een nieuwe kaart is NextGenSolutions niet te kiezen als bedrijf, en AI-automatisatie niet als dienst. Ook de automatische wegen houden Solutions buiten Projecten:
  - een contract of offerte van NextGenSolutions maakt geen kaart meer (`zorgVoorContractKaarten`, `zorgVoorOfferteKaarten`, het vangnet) maar hangt aan de deal;
  - "Nieuw project?" uit de mailbox van NextGenSolutions maakt bij Ja een deal in Afspraak in plaats van een kaart;
  - Doorgeven naar Solutions maakt al een deal.
- **De 12 Solutions-kaarten op Projecten**: een lijst bovenaan Projecten (enkel zaakvoerders) met per kaart **Verhuizen naar de Pipeline** (maakt een deal in de juiste fase, met notities en de klant; de kaart blijft bestaan met de regel "Verhuisd naar de Pipeline") of **Laten staan**.

**Bestaande data**: geen omzetting nodig. De sleutels `voorstel` en `opvolgen` blijven, enkel de namen veranderen (Voorstel, Opvolgen voorstel). De 16 deals blijven waar ze staan.

**Klaar wanneer**: er geen Solutions-kaart meer op Projecten kan komen (ook niet vanzelf), voorstel versturen niet gaat zonder zichtbare vervolgafspraak, elke belpoging een voorstel geeft voor 7 dagen later, en `auditPrijs(1..5)` = € 745, 1.040, 1.335, 1.630, 1.925 (test).

---

## Fase 3. Auditrapport en prijs per workflow

**Databank**
- Nieuwe tabel `ngs_audit_processen`: deal, volgorde, naam, `betrokkenen` (jsonb: naam + uren per week), `uren_per_week` (opgeteld, door de server), oplossing, `interface_of_logboek` (bool), `soort` (tijd of andere_waarde), `geschatte_uren` en `marktcheck` (andere waarde), `maat`, `prijs`, `prijs_reden`, `workflow_groep` (om te bundelen), `verwijderd_op`.
- `ngs_deals`: `rapport_afgerond_op`, `rapport_pdf_pad`, `audit_notities`, `briefing_notities`.
- RLS aan, enkel service-role, zoals de andere `ngs_`-tabellen.

**Instellingen** (`ngs_prijzen`): 24 weken, € 35 per uur, minimum 3 uur per week per workflow, maten met vork (Klein 3–5 u, € 2.500–4.200; Middel 5–10 u, € 4.200–8.400; Groot > 10 u, vanaf € 8.400), andere waarde € 125 per uur, afronding op € 50 (voorstel).

**Regels** (`lib/ngs/audit.ts`, met tests)
- `prijsUitFormule(uren)` = uren × weken × € 35, afgerond.
- `maatVan(uren)`, `binnenVork(maat, prijs)`. Buiten de vork bewaren kan enkel met een reden van minstens tien tekens (zelfde patroon als de minimumprijs in 10.4).
- Onder 3 uur: "Bundel met een ander proces". Processen aanvinken en **Samenvoegen** tot één workflow (uren en betrokkenen opgeteld). Apart bewaren kan niet.
- Andere waarde: geschatte uren × € 125, met het veld Marktcheck.
- Terugverdientijd in maanden = prijs ÷ (uren per week × € 35 × 52 ÷ 12).
- Rapport afronden kan pas als elke workflow het vinkje "interface of logboek" heeft.

**Schermen**
- In de deal (fase Audit en Opvolgen rapport): tab **Rapport** met de processen, bundelen, maat en prijs per workflow, en het totaal.
- **Voorstel van de AI**: uit de auditnotities en de briefing een eerste versie van de processen (naam, betrokkenen, uren, oplossing). Enkel een voorstel. Een mens neemt over en bewaart.
- **Rapport-pdf** in de huisstijl van NextGenSolutions (`ngsFonts`, `NGS_PDF`): per workflow de naam, de oplossing, de maat, de vaste prijs, de bespaarde uren per week en de terugverdientijd. Nooit de formule, € 35 of € 125.
- User stories blijven voor de planning van de bouw. "Plan met vaste prijs" (uren × uurtarief) verdwijnt uit het scherm. De kolommen `plan_uurtarief` en `plan_prijs` blijven in de databank staan.
- Cijfers: blok "Gemiddeld bespaard per workflow" uit onze afgeronde rapporten.

**Klant ziet nooit interne getallen**: de klantapp en `/api/portal/solutions` lezen enkel een vaste lijst velden (maat, prijs, uren per week, terugverdientijd). Een test leest het antwoord van de API en zoekt naar de formule, € 35 en € 125.

**Bestaande data**: geen. Er bestaan nog geen projecten of stories.

---

## Fase 4. Levering per workflow

**Databank**
- Nieuwe tabel `ngs_workflows`: project, `proces_ids` (uit het rapport), naam, maat, prijs, fase (gepland, bouw, oplevering, nazorg, klaar), `bouw_start`, `wacht_op_klant` (bool, reden, sinds, en de opgetelde dagen dat ze wachtte), `opname_link`, `video_link`, `video_gestuurd_op`, `nazorg_calls` (jsonb: twee data + meeting-id), `verantwoordelijke`, `dod` (jsonb), `verwijderd_op`.
- `ngs_user_stories`: `workflow_id`.

**Instellingen** (`ngs_levering`): bouw 14 dagen, nazorg 2 weken met een call van 30 minuten per week, standaard verantwoordelijke Jonathan.

**Code en schermen**
- Het leveringsproject krijgt de workflows uit het rapport bij Closed Won (één klik, enkel een voorstel om over te nemen).
- Per workflow: Gepland → In bouw → Oplevering → Nazorg → Klaar, met de regels:
  - "Wacht op klant" met reden: de 14 dagen tellen niet, en er komt geen kost bij;
  - langer dan 14 dagen in bouw zonder "Wacht op klant" = Op te volgen;
  - Oplevering vraagt de link naar de opname en naar de video. De video naar de klant gaat via het mailvenster (`MailComposer`, soort `ngs_workflow`), nooit vanzelf;
  - Nazorg: twee calls van 30 minuten, inplannen via de Meeting Inplanner. Een week zonder call = Op te volgen;
  - Klaar pas als de definitie van klaar af is: interface of logboek, opname gedeeld, video bij de klant, alle stories afgevinkt.
- De volgende workflow mag in bouw terwijl de vorige in nazorg zit. Een eenvoudige tijdlijn per project (balk per workflow) toont de overlap.
- De fases van het project zelf worden afgeleid uit de workflows (de vroegste die nog loopt). De kolom `fase` blijft bestaan.
- De wekelijkse review blijft optioneel.
- Klantapp (Software en automatisatie): per workflow de fase met een korte uitleg.

**Bestaande data**: geen.

---

## Fase 5. Facturatie van Solutions

**Databank**
- `bedrijven`: `betaaltermijn_dagen` (Solutions 30, Media de huidige waarde).
- `ngs_workflows`: `factuur_id`. `ngs_deals`: `audit_factuur_id`.

**Code**
- **Audit**: zodra een deal naar Audit gaat, komt de factuur bij Te factureren (bedrijf NextGenSolutions, vooraf). Dat gaat via dezelfde weg als de facturen uit een contract (`bewaarFacturen`, sleutel `ngs-audit:<deal>`), dus nooit dubbel. Daarvoor moet de deal aan een klant hangen: de stap naar Audit vraagt de klant.
- **Workflow**: zodra een workflow naar Oplevering gaat, komt haar factuur klaar (sleutel `ngs-workflow:<id>`).
- **Verrekening**: op de eerste workflow een regel "Verrekening audit −€ X", hoogstens het bedrag van die workflow. Nooit een negatieve factuur, nooit iets terug (`verrekening()` met tests: € 1.040 + € 4.200 = € 1.040 en € 3.160).
- **Betaaltermijn per bedrijf** voor offertes, facturen uit contracten en nieuwe facturen. Het vaste getal 30 in `lib/facturatie/contract-plan-server.ts` verdwijnt.
- **Handelsnaam**: offerte, contract, rapport en certificaten van Solutions tonen "NextGen Agency BV, handelsnaam NextGenSolutions" uit `bedrijven.handelsnaam`.
- **Handtekeningen**: bij tegentekenen en op de certificaten "namens NextGen Agency BV", voor alle contracten. Dat geldt enkel voor nieuwe handtekeningen; wat al getekend is, blijft ongewijzigd.
- Rapportage: Omzetrapportage per bedrijf en "Gefactureerd" in Cijfers van Solutions bestaan al. Ik controleer dat audits en workflows erin zitten.

**Bestaande data**: geen nieuwe facturen voor bestaande deals.

---

## Fase 6. Care en overdracht

**Databank**
- `ngs_care`: `pakket`, `vercel_url`, `supabase_ref`, `github_url`, `monitor_url`, `db_gb`, `bestanden_gb`, `gemeten_op`, `meetbron` (api of hand), `overdracht` (jsonb checklist), `reeks_id` (de Care-factuur).
- Nieuwe tabel `ngs_care_uren`: care, datum, uren, omschrijving. "Deze maand" = de som van de lopende maand, dus elke eerste van de maand opnieuw, zonder doorschuiven en zonder cron.
- Nieuwe tabel `ngs_care_support`: care, binnen_op, kanaal (telefoon, mail, klantapp), vraag, `deadline` (uit de reactietijd, in werkuren), opgelost_op, door.
- Nieuwe tabel `ngs_care_checks`: care, op, ok, status, fout (monitoring).

**Instellingen** (`care_pakketten`): Basis, Plus en Pro met het voorstel uit de opdracht, gemarkeerd **nog te bevestigen**. Werkuren voor de reactietijd: ma–vr 9:00–17:00 (voorstel). Migratie naar een ander platform: offerte-item "vanaf € 250".

**Code**
- Opslaggebruik: met een Supabase-toegangstoken op de server (de query-endpoint van de Management API: grootte van de databank en van `storage.objects`). Zonder token of zonder toegang tot het project: met de hand invullen, met datum.
- 80% van een limiet: melding in het belletje met het voorstel om naar het volgende pakket te gaan (`opslagMelding`, test met 85%).
- Supportvragen: teller volgens de reactietijd, melding als de deadline nadert of voorbij is.
- Monitoring (Pro): pg_cron elke 10 minuten → de app vraagt de `monitor_url` op. Twee mislukte checks na elkaar = alarm in het belletje. Fouten uit Vercel enkel als het project in ons team staat en er een token is. Nooit een mail naar de klant.
- Care-factuur: **Care-factuur instellen** maakt de maandreeks in Te factureren (op klik).
- Overdracht zonder Care: checklist Vercel, Supabase en GitHub naar accounts van de klant.
- Klantapp: pakket, limieten, gebruik en de resterende uren van deze maand.

**Nodig van jou**: een Supabase-toegangstoken in Vercel (`SUPABASE_MANAGEMENT_TOKEN`) als je het opslaggebruik vanzelf wil. Anders vul je het met de hand in.

---

## Fase 7. Media: pakketten en kwartaalcyclus

**Databank**
- `diensten_catalogus`: `pakketten` (jsonb: naam, prijs, posts, reels, stories, inbegrepen), `opties` (jsonb: Community management € 195) en `prijs_items` (jsonb: video € 300/u, foto € 195/u, halve dag € 1.200 en € 780, migratie vanaf € 250).
- `clients`: `media_pakket`, `media_opties`, `media_start` (start van het contract, voor de kwartaalcyclus).
- `social_content_items`: `ter_goedkeuring_op`, `goedkeuring_deadline`, `stil_goedgekeurd_op`, `rondes`.
- `clients`: `stil_akkoord` (bool, standaard **uit**).

**Instellingen**: goedkeuringstermijn 7 dagen, 2 aanpassingsrondes per post, looptijd eerste contract 6 maanden en verlenging 12 maanden, template voor de verlenging.

**Code en schermen**
- Instellingen → Diensten → Social media: pakketten en opties.
- Offerte-editor: bij de fiche social media een keuze **Pakket** en **Community management**. Die vullen het prijsblok en de fiche meteen in. De diensten van de klant, het pakket en de deliverables komen pas op de klant als de offerte aanvaard wordt (of het contract getekend), niet bij een concept.
- Deliverables (`DeliverablesStand`): wat afgesproken is komt uit het pakket van de klant, en anders uit de dienst zoals nu.
- Verlengingsgesprek: de knop opent Contract uit template met de verlengingstemplate en de klant ingevuld, voor 12 maanden.
- **Kwartaalcyclus** (`lib/contentplanning/kwartaal.ts`, met tests): vanaf `media_start`. Per kwartaal: de maand ervoor strategie, scripts en kalender (Chiara) en de shoot; montage en visuals (Yasmine); de laatste week voor elke maand alles ter goedkeuring; in de laatste maand van het kwartaal de shoot van het volgende kwartaal vastleggen. Op de eerste dag van die maand niet vastgelegd = Op te volgen. Test: start 1 juni geeft een shoot in mei en een in augustus.
- In Planning Media vervangt dit enkel het blok "Contentshoots vastleggen" van reeks 3. De reeksen, vaste taken en meetings blijven zoals ze zijn.
- **Goedkeuring**: zodra een post naar de klant gaat, krijgt hij een deadline (vandaag + 7 dagen). De klantapp toont "Keur goed voor do 26 nov. Daarna plannen we in zoals voorgesteld." Na de deadline, **enkel bij een klant met stil akkoord aan**: status Goedgekeurd met de vermelding "(geen reactie)", een regel in de tijdlijn, en de post gaat in de planning (pg_cron één keer per dag). Dat vervangt de regel "nooit automatisch goedkeuren".
- Per post twee aanpassingsrondes. Een derde ronde vraagt een bevestiging van het team.
- Losse foto en video als offerte-items. De tijd uit de Shoot planner telt al mee in Klantwaarde en marge.

**Bestaande data**
- De 421 posts die nu bij de klant staan, krijgen nooit vanzelf een deadline uit het verleden. De termijn start pas als stil akkoord voor die klant aangezet wordt.
- `media_start`: ingevuld uit het lopende getekende Media-contract waar dat zeker is. Klanten waar het niet zeker is, komen op een lijst om na te kijken.

---

## Fase 8. Scorecard, doelen en capaciteit

**Databank**
- `personeel`: `max_workflows` (aantal workflows tegelijk). De werkdagen komen uit de bestaande Beschikbaarheid in de agenda.

**Instellingen**: eigenaar en doel per cijfer (bestaat al, `app_settings.scorecard`), startweek voor de belletjes (7 dec 2026), jaardoelen (2027 € 1 miljoen, 2028 € 5 miljoen), doelpercentages van de trechter (7% en 100%).

**Code**
- Nieuwe cijfers in `CIJFERS`: belletjes Solutions (ABM-notities met een uitkomst bij een bedrijf "Voor: NextGenSolutions"), afspraken Solutions, voorstellen, audits verkocht, workflows opgeleverd, Care per maand, nieuwe Media-klanten, terugkerende omzet Media, content op schema (uit de deliverables), gemiddelde tijd tot goedkeuring. Gefactureerd en getekende contracten bestaan al.
- Trechter Solutions uit `ngs_deal_fases` en de belnotities, met het doel ernaast, plus het gemiddelde aantal workflows per klant en de gemiddelde prijs per workflow.
- **Doelcalculator** in Cijfers van Solutions: jaardoel min de terugkerende omzet (Media en Care), gedeeld door de gemiddelde prijs per klant, en via de conversies van de laatste 13 weken terug naar belletjes, afspraken en voorstellen per week, en workflows per week. Zegt of 150 belletjes per week volstaan. Zijn er te weinig gegevens, dan zegt het scherm dat.
- **Bouwcapaciteit**: per uitvoerder werkdagen × workflows tegelijk. Meer workflows in bouw of gepland dan dat = Werkvoorraad van Solutions in het rood en een melding.

**Bestaande data**: de fasegeschiedenis begint bij fase 2. Wat ervoor gebeurde, haal ik uit de tijdlijn van de deals waar dat lukt. Oude ABM-notities zonder bedrijf tellen niet mee.

---

## Fase 9. Opkuis

- Opleveringen: de bewaartermijn wordt een instelling (beginwaarde 3 dagen).
- Document: woordenlijst (Audit, Workflow, Maat, Care-pakket, Kwartaalcyclus, Domein), "Waar vind je wat" en de hoofdstukken 2, 4, 8, 10, 13, 14, 15, 16 en 17.
- Resend voor nextgensolutions.be: zie de stappen in het antwoord in de chat. De exacte DKIM-waarde geeft Resend zelf.

---

## Nog te beslissen

1. **Waar keurt de klant Media-content goed?** Nu: in de contentkalender van de klantapp (status "bij klant" → goedgekeurd of feedback). Metricool wordt enkel gelezen (Planning in de klantapp), de app schrijft er niets naartoe, en geen enkele klant heeft een feedbacklink naar Metricool. **Voorstel**: enkel de contentkalender in de klantapp. Metricool is de plek waar wij publiceren, niet waar de klant goedkeurt.
2. De betaaltermijn van Media: offertes zeggen nu 14 dagen, facturen 30.
3. De Care-pakketten en prijzen (staan als voorstel).
4. De uurprijs voor foto en de prijzen per halve dag (staan als voorstel).
5. De prijzen voor grafisch ontwerp en branding, webdesign, ads en marketingconsultancy (lege velden in Diensten).
6. De juridische teksten: voorwaarden Solutions, de clausule "zonder reactie binnen 7 dagen", verwijlintrest en de voorwaarden van Care. Ik bouw per bedrijf een plek in Instellingen (tekst met versie), die op offerte, contract en tekenpagina komt zodra ze ingevuld is.
