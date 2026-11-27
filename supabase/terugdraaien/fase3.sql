-- Terugdraaien verbeterplan fase 3 (teamagenda). Enkel wat fase 3 toevoegde; bestaande data blijft.
drop index if exists public.ag_items_reeks_keer;
alter table public.ag_items drop column if exists reeks_id;
alter table public.ag_items drop column if exists reeks_datum;
alter table public.ag_items drop column if exists clickup_verschil_op;
alter table public.ag_items drop column if exists clickup_verschil;
drop table if exists public.ag_ical_links;
drop table if exists public.ag_beschikbaarheid;
drop table if exists public.ag_reeksen;
