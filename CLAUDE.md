# NextGenMedia Content Portal — projectgids

Next.js 14 (App Router) + Supabase. Drie portalen: Admin, Client (portaal), Partner. Geel accent (`#fff848`).

## Portaal-security architectuur (lees dit vóór je portaal-features bouwt)

Het klantportaal gebruikt een **resolver + service-role** model, niet RLS, als primaire beveiliging:

- **`lib/portal-auth.ts` is de enige toegangspoort.** `resolvePortalSession()` bepaalt of de ingelogde gebruiker een **owner** (`clients.owner_user_id`, krijgt automatisch volledige rechten) of een **subaccount** (`client_users`, eigen `permissions` jsonb) is, plus `active`, `email`, `name`, `clientId`.
- **Rechten worden server-side afgedwongen.** RLS is een tweede laag, niet de portaalbeveiliging — portaalpaginas/-routes lezen data via de service-role client, gekeyd op de **geresolveerde** `clientId` (ownership is dan al geverifieerd).
- **Nieuwe portaalfeatures MOETEN de guards gebruiken:**
  - Servercomponent-pagina: `const session = await requirePortalView('<module>')` → redirect bij geen recht.
  - API-route: `const g = await requirePortalPermission('<module>', '<actie>'); if (!g.ok) return g.response` → gebruik `g.session.clientId`.
  - Nooit losse `clients.owner_user_id === user.id`-checks meer toevoegen.
- **Contracttoegang loopt via `canAccessContract(session, contract, 'view'|'sign'|'download')`** (admin valt hier buiten).
- **Audit via `logPortalAction(session, action, entity, { req, meta })`** — consistente actor-identiteit (naam/e-mail/auth_user_id/client_id). Niet handmatig `logAudit` aanroepen in portaal-routes.
- **Modules**: `lib/portal-permissions.ts` is single source — modules, acties, presets, en `MODULE_IMPLEMENTED` (een module die `false` staat wordt nergens getoond en geeft 404 in de guard). Zet een module pas op `true` als pagina + route bestaan.
- **Publieke tekenlinks (`/sign/[token]`) blijven token-based** voor externe ontvangers. Enkel wanneer een ingelogde subaccount van dezelfde klant tekent, geldt `contracts.sign`.

## Platformregels (Platform 1.0 — lees vóór je iets toevoegt)
- **Geen nieuwe modules zonder expliciete reden.** Het platform is functioneel af; werk bestaande modules uit i.p.v. nieuwe te bouwen.
- **Klanten zijn de centrale hub.** Beheer klant-gerelateerde info vanaf de klantdetail (`ClientHub`), niet in losse schermen. Nooit dezelfde info op twee plaatsen beheren.
- **Globale zoek (`Cmd/Ctrl+K`) is de manier om te navigeren** — voeg nieuwe entiteiten toe in `/api/admin/search`, niet in aparte zoekschermen.
- **Notificaties zijn de centrale signalenlaag** — nieuwe signalen toevoegen in `lib/notifications.ts`, niet als losse widgets verspreid.
- **AI voert niets uit zonder bevestiging.** NextGen AI is read-only: het stelt voor met deep-links ("Voorstel — bevestiging vereist"); de mens bevestigt. Nooit auto-schrijfacties.
- **Mails naar klanten zijn nooit automatisch.** Alle handmatige mail loopt via één component: `components/admin/mail-composer.tsx` (`<MailComposer context=...>`), altijd met preview + handmatige bevestiging; logging via E-mail Center.
  - Uitzonderingen, allemaal in de Meeting Inplanner (`lib/meetings/`) en gelogd in het E-mail Center:
    - de **herinneringsmail** van een meeting (24 uur vooraf): bevestigd in het planvenster of bij het boeken, verstuurd door de scheduler (pg_cron → `/api/cron/klantmeetings`);
    - de **bevestigingsmail van een klantboeking** (`/boeken` met de persoonlijke beheerlink, of de klantapp-module **Meeting boeken** met een link naar `/portal/meetings`): de klant vraagt er zelf om door te boeken of te verplaatsen.
    Geen andere automatische klantmails toevoegen.
- **One source of truth:** afgeleide dashboarddata via `lib/notifications.ts` / `lib/ai-context.ts` / `/api/admin/search`; rechten via `lib/portal-auth.ts` + `lib/portal-permissions.ts`.

## Conventies
- Migraties: additief + idempotent in `supabase/migrations/99999999_SYNC_ALL.sql` (`ADD COLUMN IF NOT EXISTS`, `DO $$ ... $$` guards). Geen bestaande data wijzigen.
- DB-writes die nieuwe kolommen raken: veerkrachtig maken (drop ontbrekende kolom + retry) zodat de app ook vóór migratie werkt.
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `CLICKUP_API_KEY`, `PEXELS_API_KEY`) enkel via env, nooit committen of in clientcode.
- Klantmails zijn altijd handmatig (E-mail Center), nooit automatisch. Uitzonderingen: meetingherinnering en bevestiging van een klantboeking (zie hierboven).
- **Taken bij een lead** (leadfiche, `lib/sales/lead-taken*.ts`, tabel `sales_lead_taken`): "Taak toevoegen" maakt een **gewone ClickUp-taak** (deadline zonder uur, geen starttijd, dus nooit een meeting of agenda-item) in de lijst van NextGen Media of NextGen Solutions (`sales_pipelines.clickup_list_id`), toegewezen aan het gekozen ClickUp-lid, met een klikbare link naar `/admin/sales/pipeline?lead=<id>`. De leadfiche toont de status live uit ClickUp. Dezelfde `aanvraag_sleutel` maakt nooit een tweede taak; "Opnieuw" zoekt eerst terug aan de referentie `ngm-leadtaak:<id>`.
- **Meeting Inplanner** (`/admin/meetings`) is de centrale meetingmodule: interne meetings (`klant_meetings`), klantboekingen (`bron = 'klantboeking'`, publieke pagina `/boeken`) en **Calendar** (tab `?tab=agenda`; vervangt de Verkoopagenda en het vroegere Appointment setting, `/admin/sales/appointments` stuurt door). Leadboekingen blijven via `/api/admin/sales/appointments` lopen (setter, merk, uitbetaling, pipeline).
  - Calendar-data komt uit één plek: `lib/meetings/kalender-server.ts` (`kalenderData`, `controleerVrij`), regels in `lib/meetings/kalender.ts`. Geen tweede ClickUp- of Google-koppeling bouwen.
  - **Een ClickUp-item is enkel een meeting met start- én einddatum, allebei met een uur** (`isClickupMeeting`). Alleen die blokkeren tijd (Calendar, klantboeking, agendasync); losse taken niet.
  - Vrije momenten zijn **strikt**: lukt Google of ClickUp niet, dan geen tijdstippen maar een fout. Agenda's van dezelfde persoon blokkeren elkaar (`zelfdePersoon`), niet die van een collega op hetzelfde Google-account.
  - ClickUp's `last_page` is niet betrouwbaar: altijd doorlezen tot een lege pagina.
  - **Klantregels (11:00–17:00, minstens 72 uur vooraf, 30 min) gelden enkel voor klantboekingen** (`/boeken` en klantapp). Intern (Calendar, Meeting Inplanner) mag elk tijdstip: een overlap geeft een waarschuwing (`controleerConflicten`, bevestigen met `toch_conflict`), geen verbod. Leadafspraken vragen wel een vrij moment binnen de werkuren.
  - **Klantapp — Meeting boeken** (`/portal/meetings`, module `meetings`, staat standaard aan via `STANDAARD_AAN`/`metStandaard`): zelfde motor als `/boeken` (`boekKlantmeeting` met `klantapp`-optie). De meeting hangt aan `client_id`, heeft geen beheertoken; beheren gebeurt in de klantapp, altijd gescoped op de geresolveerde `clientId`.
  - **Online of op locatie** (`klant_meetings.vorm`, `locatie`, `met_meet`): online = altijd een Meet-link; op locatie = adres verplicht (in het Google-locatieveld, de herinnering en ClickUp), Meet enkel als `met_meet`. Klantboekingen blijven online.
  - **Mail aan deelnemers**: enkel via `<MailComposer context={{ type: 'meeting', meetingId }}>` (voorbeeld + knop Versturen), server in `lib/meetings/meeting-mail-server.ts`. Vertrekt altijd vanuit info@nextgenmedia.be via Resend met het geverifieerde domein; klopt `EMAIL_FROM` of het domein niet (`lib/meetings/afzender.ts`), dan vertrekt er niets. Nooit via een Gmail-koppeling.
  - Google-uitnodigingen komen van het Google-account achter de gekozen agenda (nu castermansmarco2504@gmail.com, agenda "Bram — ClickUp"). Organisator info@nextgenmedia.be kan enkel met een Google-agenda van dat adres, gekoppeld via "Agenda toevoegen". Het planvenster toont wie organisator wordt.
  - Gsm-melding: Google-popup 15 minuten vooraf op elk event van de app en op ClickUp-meetings via de sync (`GSM_MELDING_MIN`). Geen app-pushkanaal; geen dubbele meldingen.
