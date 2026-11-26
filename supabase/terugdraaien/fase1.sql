-- Terugdraaien van verbeterplan fase 1 (26 nov 2026). Enkel uitvoeren als fase 1
-- echt weg moet: dit haalt de nieuwe kolommen en tabellen weg. Bestaande kolommen
-- (merk, diensten, service_slug ...) werden nooit aangeraakt en blijven zoals ze waren.
begin;
alter table public.opdrachten drop column if exists bedrijf, drop column if exists dienst_slugs;
alter table public.offertes drop column if exists bedrijf, drop column if exists dienst;
alter table public.contracts drop column if exists bedrijf, drop column if exists dienst;
alter table public.invoices drop column if exists bedrijf, drop column if exists dienst;
alter table public.invoice_lines drop column if exists bedrijf, drop column if exists dienst;
alter table public.recurring_invoices drop column if exists bedrijf, drop column if exists dienst;
alter table public.purchases drop column if exists bedrijf;
alter table public.cost_entries drop column if exists bedrijf;
alter table public.invoice_costs drop column if exists bedrijf;
alter table public.team_taken drop column if exists bedrijf;
alter table public.klant_meetings drop column if exists bedrijf;
alter table public.shoot_briefings drop column if exists bedrijf, drop column if exists dienst;
alter table public.opleveringen drop column if exists bedrijf, drop column if exists dienst;
alter table public.klant_aanvragen drop column if exists bedrijf, drop column if exists dienst;
alter table public.ngs_deals drop column if exists dienst;
drop table if exists public.te_classificeren;
drop table if exists public.dienst_mapping;
drop table if exists public.diensten_catalogus;
drop table if exists public.bedrijven;
commit;
