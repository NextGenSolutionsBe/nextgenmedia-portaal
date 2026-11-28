-- Terugdraaien verbeterplan fase 4 (rollen, rechten en plug-and-play, 27 nov 2026).
-- Haalt enkel weg wat fase 4 toevoegde. Bestaande gegevens van staff_members en
-- personeel blijven; alleen de nieuwe kolommen verdwijnen (en wat erin stond).
DROP TABLE IF EXISTS public.werkinstructie_gelezen;
DROP TABLE IF EXISTS public.werkinstructie_versies;
DROP TABLE IF EXISTS public.werkinstructies;
DROP TABLE IF EXISTS public.onboarding_stappen;
DROP TABLE IF EXISTS public.rol_sjablonen;
ALTER TABLE public.staff_members DROP COLUMN IF EXISTS rol_sjabloon;
ALTER TABLE public.staff_members DROP COLUMN IF EXISTS bedrijven;
ALTER TABLE public.staff_members DROP COLUMN IF EXISTS start_datum;
ALTER TABLE public.staff_members DROP COLUMN IF EXISTS eind_datum;
ALTER TABLE public.staff_members DROP COLUMN IF EXISTS offboarding_op;
ALTER TABLE public.staff_members DROP COLUMN IF EXISTS offboarding_door;
ALTER TABLE public.staff_members DROP COLUMN IF EXISTS offboarding_notitie;
ALTER TABLE public.personeel DROP COLUMN IF EXISTS functieprofiel;
