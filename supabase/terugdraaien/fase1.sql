-- Terugdraaien van verbeterplan fase 1 (26 nov 2026). Enkel uitvoeren als fase 1
-- echt weg moet: dit haalt de nieuwe kolommen en tabellen weg. Bestaande kolommen
-- (merk, diensten, service_slug ...) werden nooit aangeraakt en blijven zoals ze waren.
begin;
-- Triggers en functies van fase 1b eerst weg.
do $$ declare t text; begin
  foreach t in array array['opdrachten','contracts','invoices','recurring_invoices','klant_meetings','purchases','cost_entries','klant_aanvragen','opleveringen'] loop
    execute format('drop trigger if exists trg_sync_te_classificeren on public.%I', t);
  end loop;
end $$;
drop trigger if exists trg_vul_bedrijf_contract on public.contracts;
drop trigger if exists trg_vul_bedrijf_factuur on public.invoices;
drop trigger if exists trg_vul_bedrijf_reeks on public.recurring_invoices;
drop trigger if exists trg_vul_bedrijf_factuurregel on public.invoice_lines;
drop trigger if exists trg_vul_bedrijf_factuurkost on public.invoice_costs;
drop trigger if exists trg_vul_bedrijf_opdracht on public.opdrachten;
drop trigger if exists trg_vul_bedrijf_aanvraag on public.klant_aanvragen;
drop trigger if exists trg_vul_bedrijf_shoot on public.shoot_briefings;
drop trigger if exists trg_vul_bedrijf_oplevering on public.opleveringen;
drop trigger if exists trg_vul_bedrijf_teamtaak on public.team_taken;
drop function if exists public.sync_te_classificeren(), public.vul_bedrijf_contract(), public.vul_bedrijf_factuur(),
  public.vul_bedrijf_factuurregel(), public.vul_bedrijf_factuurkost(), public.vul_bedrijf_opdracht(), public.vul_bedrijf_aanvraag(),
  public.vul_bedrijf_shoot(), public.vul_bedrijf_oplevering(), public.vul_bedrijf_teamtaak(),
  public.dienst_uit_mapping(text, text), public.bedrijf_van_dienst(text);
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
