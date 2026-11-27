-- Terugdraaien verbeterplan fase 6 (levering Media en sales, 27 nov 2026).
-- Haalt enkel weg wat fase 6 toevoegde. Let op: de oude bronnencontrole
-- (enkel inbound/outbound) kan pas terug als geen kaart een nieuwe bron heeft.
ALTER TABLE public.shoot_briefings DROP CONSTRAINT IF EXISTS shoot_briefings_afspraak_soort_check;
ALTER TABLE public.shoot_briefings DROP COLUMN IF EXISTS tijd_rijden_min;
ALTER TABLE public.shoot_briefings DROP COLUMN IF EXISTS tijd_shoot_min;
ALTER TABLE public.shoot_briefings DROP COLUMN IF EXISTS tijd_nabewerking_min;
ALTER TABLE public.shoot_briefings DROP COLUMN IF EXISTS afspraak_soort;
ALTER TABLE public.diensten_catalogus DROP COLUMN IF EXISTS deliverables;
-- Enkel als er geen nieuwe bronnen in gebruik zijn:
-- ALTER TABLE public.opdrachten DROP CONSTRAINT IF EXISTS opdrachten_bron_check;
-- ALTER TABLE public.opdrachten ADD CONSTRAINT opdrachten_bron_check CHECK (bron IS NULL OR bron IN ('inbound','outbound'));
