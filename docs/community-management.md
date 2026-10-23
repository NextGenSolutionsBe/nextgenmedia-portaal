# Community management

We beantwoorden comments en DM's voor klanten. Per klant staat het aan of uit
(klantdetail → kaart **Community management**).

## Werking

1. **Sync (geen AI).** Elke 10 minuten roept pg_cron (job `community-sync`)
   `https://app.nextgenmedia.be/api/cron/community-sync` aan met de header
   `x-sync-secret` uit `cron_geheimen` (sleutel `community_sync`). De route haalt
   per actieve klant, per actief kanaal (Metricool-merk) en per netwerk de
   comments en gesprekken op en bewaart ze in `community_berichten`.
   - Eén run tegelijk; een run stopt na ±40 s en de volgende gaat verder met het
     kanaal dat het langst niet gesynchroniseerd werd (`laatst_gesynct`).
   - Bestaande berichten: categorie, status, voorstellen en gekozen tekst worden
     nooit overschreven; enkel de tekst (en `raw`) als die veranderde.
   - Antwoorden van het merk zelf worden niet bewaard. Antwoordde het merk al
     (bv. manueel in Metricool), dan wordt het bericht `verstuurd` met
     `verstuurd_door = 'extern (Metricool)'`.
   - Open berichten waarvan de termijn voorbij is → `verlopen`.
   - Een fout per kanaal komt in `community_kanalen.laatste_fout` (zichtbaar op
     de klantkaart en in de inbox) en houdt de andere kanalen niet tegen.
2. **Indelen en voorstellen (Claude, via de MCP-connector).** Een scheduled task
   in Claude (ons abonnement, niet de API) deelt nieuwe berichten in en schrijft
   voorstellen met `community_verwerken`. Er wordt niets verstuurd.
3. **Beantwoorden (een mens).** In `/admin/community` kies je een voorstel of pas
   je de tekst aan en verstuur je na een bevestiging met preview. Wie op
   "Ja, versturen" klikt, staat als `verstuurd_door` in het bericht en in `audit_log`.
4. **Fase 2:** de klant keurt gevoelige berichten zelf goed in het portaal.

Staat de schakelaar uit, dan synct de klant niet, toont de MCP zijn berichten
niet en verdwijnt hij uit de inbox. Er wordt niets gewist.

De standaardregels (`lib/community/standaardregels.ts`) zijn een voorstel zolang
de regels van een klant leeg zijn. Ze worden nooit automatisch bewaard.

## Statussen

| Status | Betekenis |
|---|---|
| `nieuw` | Net binnengekomen, nog niet ingedeeld |
| `te_beantwoorden` | Ingedeeld; wij antwoorden |
| `bij_klant` | Vraag of kritiek; de klant beslist (als "klant keurt goed" aan staat) |
| `klant_gekozen` | De klant koos een antwoord (fase 2); wij of de klant versturen |
| `verstuurd` | Online gezet (via de app, of extern via Metricool) |
| `genegeerd` | Niet op reageren (bv. negatief zonder inhoud) |
| `verlopen` | De termijn om via Metricool te antwoorden is voorbij |
| `fout` | Versturen mislukte; de fout staat in `verstuur_fout` |

Indelen → status: `luchtig`, `trefwoord`, `toxisch`, `overig` → `te_beantwoorden`;
`vraag`, `kritiek` → `bij_klant` als de klant goedkeurt, anders `te_beantwoorden`;
`negatief_zonder_inhoud` → `genegeerd` (zonder voorstellen).

## Grenzen van Metricool

- Facebook en Instagram: een comment kan je tot 24 uur na ontvangst beantwoorden,
  een DM tot 7 dagen. Andere netwerken: geen gekende grens.
- Comments op ads komen niet binnen en kan je niet beantwoorden.
- Verwijderen kan niet via Metricool (en de app wist nooit iets). Toxische
  comments verwijdert een mens in de app van het netwerk zelf.
- LinkedIn-comments enkel voor bedrijfspagina's. LinkedIn heeft geen DM's in de
  inbox-API (live: `provider invalid`).
- Comments: Instagram, Facebook, TikTok (business), LinkedIn, YouTube.
  DM's: Instagram, Facebook, X.
- De lijst geeft tot 50 comment-threads en 25 gesprekken per netwerk, zonder
  paginering (live vastgesteld). De sync om de 10 minuten houdt dat bij.

## Eerste antwoord: controleren

De veldnamen van het antwoord komen uit de OpenAPI-spec van Metricool, maar de
spec zegt niet of `objectId` de post of de comment is. De app stuurt de bovenste
comment van de draad (zo antwoordt het merk ook in de live data). Controleer bij
het eerste echte antwoord in de app of de reactie onder de juiste comment staat.
Details: commentaar bovenaan `lib/metricool-inbox.ts`.

## Na de merge

De pg_cron-job staat in `supabase/migrations/99999999_SYNC_ALL.sql` maar is nog
niet geactiveerd (de route moest eerst live staan). Draai dat blok
(`community-sync`, `*/10 * * * *`) zodra de route in productie staat.

## Scheduled task in Claude

Elk uur van 8 tot 20u (Brusselse tijd), met de NextGenMedia-connector (OAuth,
`https://app.nextgenmedia.be/api/mcp`). De community-tools bestaan enkel via die
route, niet via de oude sleutelroute en niet via het lokale programma.

```
Je doet community management voor NextGenMedia via de NextGenMedia-connector.

1. Roep community_overzicht aan. Zijn er geen berichten met status "nieuw", stop dan.
2. Lees voor elke klant met nieuwe berichten eerst community_regels.
3. Haal per klant de berichten met status "nieuw" op met community_berichten.
4. Bepaal per bericht de categorie volgens de regels van die klant. Twijfel je tussen luchtig en kritiek, kies dan kritiek.
5. Schrijf twee of drie antwoordvoorstellen in de tone of voice van de klant en in de taal van de comment. Kort en menselijk, geen marketingtaal. Gebruik bij een trefwoord de link uit de cheat sheet. Bij "negatief_zonder_inhoud" schrijf je geen voorstellen.
6. Sla elk bericht op met community_verwerken.
7. Verstuur nooit iets. Gebruik community_versturen niet.
8. Sluit af met per klant: hoeveel berichten je hebt ingedeeld, hoeveel naar de klant gaan en hoeveel binnen 4 uur verlopen.
```

## MCP-tools

`community_overzicht`, `community_regels`, `community_berichten`,
`community_bericht`, `community_verwerken`, `community_status`,
`community_versturen`. Indelen en versturen komen op naam van wie de connector
koppelde in `audit_log`. `community_versturen` weigert bij een verkeerde status,
een verlopen termijn of een lege `bevestigd_door`, en is nooit bedoeld voor een
scheduled task.
