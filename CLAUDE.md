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
- **One source of truth:** afgeleide dashboarddata via `lib/notifications.ts` / `lib/ai-context.ts` / `/api/admin/search`; rechten via `lib/portal-auth.ts` + `lib/portal-permissions.ts`.

## Conventies
- Migraties: additief + idempotent in `supabase/migrations/99999999_SYNC_ALL.sql` (`ADD COLUMN IF NOT EXISTS`, `DO $$ ... $$` guards). Geen bestaande data wijzigen.
- DB-writes die nieuwe kolommen raken: veerkrachtig maken (drop ontbrekende kolom + retry) zodat de app ook vóór migratie werkt.
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `CLICKUP_API_KEY`, `PEXELS_API_KEY`) enkel via env, nooit committen of in clientcode.
- Klantmails zijn altijd handmatig (E-mail Center), nooit automatisch.
