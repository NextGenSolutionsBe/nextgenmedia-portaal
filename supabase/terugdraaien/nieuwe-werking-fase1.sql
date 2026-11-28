-- Terugdraaien nieuwe werking fase 1 (28 nov 2026). Enkel uitvoeren als het echt moet.
-- 1. Sjabloon Uitvoerder Solutions en Planning Media terug naar de back-up:
UPDATE rol_sjablonen r SET modules = ARRAY(SELECT jsonb_array_elements_text(b->'modules')), startpagina = b->>'startpagina', onboarding = b->'onboarding'
FROM (SELECT jsonb_array_elements(value) b FROM app_settings WHERE key = 'rol_sjablonen_backup_20261128') x
WHERE r.key = x.b->>'key' AND r.key = 'uitvoerder_solutions';
UPDATE app_settings SET value = (SELECT value FROM app_settings WHERE key = 'contentplanning_backup_20261128'), updated_at = now()
WHERE key = 'contentplanning' AND EXISTS (SELECT 1 FROM app_settings WHERE key = 'contentplanning_backup_20261128');
-- 2. Functieprofielen van de vennoten leegmaken (stonden leeg vóór 28 nov 2026):
-- UPDATE personeel SET functieprofiel = NULL WHERE functie = 'Zaakvoerder';
-- 3. De kolommen domein en eigenaar mogen blijven staan (additief); weghalen kan met:
-- ALTER TABLE ritme_beslissingen DROP CONSTRAINT IF EXISTS ritme_beslissingen_domein_check;
-- ALTER TABLE ritme_beslissingen DROP COLUMN IF EXISTS domein, DROP COLUMN IF EXISTS eigenaar;
-- 4. De instelling 'werking' weghalen = alles op de beginwaarden:
-- DELETE FROM app_settings WHERE key = 'werking';
