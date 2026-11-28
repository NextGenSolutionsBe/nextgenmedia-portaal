-- Terugdraaien verbeterplan fase 5 (NextGenSolutions-levering, 27 nov 2026).
-- Haalt enkel weg wat fase 5 toevoegde; de deals zelf blijven ongewijzigd.
DROP TABLE IF EXISTS public.ngs_care;
DROP TABLE IF EXISTS public.ngs_user_stories;
DROP TABLE IF EXISTS public.ngs_projecten;
DROP INDEX IF EXISTS public.ngs_deals_client;
ALTER TABLE public.ngs_deals DROP COLUMN IF EXISTS client_id;
