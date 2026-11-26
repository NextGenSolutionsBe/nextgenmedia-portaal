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
