-- Terugdraaien van de open punten (27 nov 2026). Enkel uitvoeren als het echt moet:
-- dit haalt de kolommen weg die de open punten toevoegden (en wat erin gekozen werd).
-- Daarvoor bestond niets in die kolommen; andere gegevens worden niet aangeraakt.
alter table public.ag_mappen drop constraint if exists ag_mappen_bedrijf_check;
alter table public.abm_bedrijven drop constraint if exists abm_bedrijven_bedrijf_check;
alter table public.ag_mappen drop column if exists bedrijf;
alter table public.abm_bedrijven drop column if exists bedrijf;
alter table public.personeel drop column if exists klantapp_bedrijven;
