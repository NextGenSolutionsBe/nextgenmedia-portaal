-- Terugdraaien verbeterplan fase 7 (financieel, scorecard en ritme, 27 nov 2026).
-- Haalt enkel weg wat fase 7 toevoegde. Let op: notities van het weekoverleg,
-- doelen, beslissingen en 1-op-1's gaan dan mee weg; exporteer ze eerst.
DROP TABLE IF EXISTS public.ritme_stemmen;
DROP TABLE IF EXISTS public.ritme_beslissingen;
DROP TABLE IF EXISTS public.ritme_kwartaaldoelen;
DROP TABLE IF EXISTS public.ritme_weekoverleg;
DROP TABLE IF EXISTS public.een_op_een;
DROP INDEX IF EXISTS public.purchases_client;
DROP INDEX IF EXISTS public.cost_entries_client;
ALTER TABLE public.purchases DROP COLUMN IF EXISTS client_id;
ALTER TABLE public.purchases DROP COLUMN IF EXISTS opdracht_id;
ALTER TABLE public.cost_entries DROP COLUMN IF EXISTS opdracht_id;
ALTER TABLE public.team_taken DROP COLUMN IF EXISTS beloofd_aan;
ALTER TABLE public.werkinstructies DROP CONSTRAINT IF EXISTS werkinstructies_soort_check;
ALTER TABLE public.werkinstructies DROP COLUMN IF EXISTS soort;
-- Instellingen in app_settings (blijven staan, onschadelijk): maanddoelen, intern_uurtarief, scorecard.
