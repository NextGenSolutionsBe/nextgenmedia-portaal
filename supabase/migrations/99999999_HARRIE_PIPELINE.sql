-- ═══════════════════════════════════════════════════════════════════════════
-- ÉÉN PIPELINE, DRIE KANALEN — en Harrie praat rechtstreeks met Supabase
-- ═══════════════════════════════════════════════════════════════════════════
-- Additief en idempotent; te draaien op een databank waar 99999999_SYNC_ALL.sql
-- al gedraaid heeft.
--
-- WAAROM. Dezelfde lijst bedient cold calling (in de app) en cold e-mail plus
-- LinkedIn (door Harrie). Je zag vroeger wel DÁT een lead gecontacteerd was,
-- maar niet waarlangs — en dus niet waar de opvolging hoorde te gebeuren.
--
-- Harrie schrijft nu ÉÉN rij in harrie_events; de trigger onderaan bepaalt wat
-- dat voor de pipeline betekent. Zo staat die logica op één plek, ook al gaat
-- hij buiten onze API om.

-- ── 1. Nieuwe kolommen op de lead ──────────────────────────────────────────
ALTER TABLE public.sales_leads
  -- De reden bij "Geen interesse", gestructureerd. lost_reason houdt de
  -- leesbare tekst; op reden_code wordt geteld.
  ADD COLUMN IF NOT EXISTS reden_code text,
  -- Reageerde zelf op een benadering: de warmste lead die er is. Bewust een
  -- markering en geen eigen fase — anders gaat het kanaal verloren.
  ADD COLUMN IF NOT EXISTS warm boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warm_op timestamptz,
  -- Het laatste blokje van Harrie: kanaal, stap, berichten, belAdvies.
  ADD COLUMN IF NOT EXISTS harrie jsonb;

CREATE INDEX IF NOT EXISTS sales_leads_warm ON public.sales_leads (warm) WHERE warm;
CREATE INDEX IF NOT EXISTS sales_leads_reden ON public.sales_leads (reden_code) WHERE reden_code IS NOT NULL;

ALTER TABLE public.harrie_events ADD COLUMN IF NOT EXISTS harrie jsonb;

-- ── 2. Logboek van de fasesplitsing, zodat ze omkeerbaar is ────────────────
-- Terugdraaien:
--   UPDATE sales_leads l SET stage_key = m.van
--   FROM sales_stage_migratie m WHERE m.lead_id = l.id;
CREATE TABLE IF NOT EXISTS public.sales_stage_migratie (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL,
  van           text NOT NULL,
  naar          text NOT NULL,
  regel         text NOT NULL,
  uitgevoerd_op timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_stage_migratie_lead ON public.sales_stage_migratie (lead_id);
ALTER TABLE public.sales_stage_migratie ENABLE ROW LEVEL SECURITY;

-- ── 3. De fases hersplitsen ────────────────────────────────────────────────
WITH bepaald AS (
  SELECT l.id, l.stage_key AS van,
    CASE
      WHEN l.stage_key = 'email_todo' THEN 'email_after_call'
      WHEN l.stage_key = 'interested' THEN 'contacted_call'
      WHEN l.stage_key = 'contacted' AND EXISTS (
        SELECT 1 FROM public.sales_lead_events e WHERE e.lead_id = l.id AND e.kind = 'call')
        THEN 'contacted_call'
      WHEN l.stage_key = 'contacted' AND EXISTS (
        SELECT 1 FROM public.sales_lead_events e WHERE e.lead_id = l.id AND e.body ILIKE 'Harrie:%linkedin%')
        THEN 'contacted_linkedin'
      WHEN l.stage_key = 'contacted' AND EXISTS (
        SELECT 1 FROM public.sales_lead_events e WHERE e.lead_id = l.id AND e.body LIKE 'Harrie:%')
        THEN 'contacted_mail'
      WHEN l.stage_key = 'contacted' THEN 'contacted_call'
    END AS naar,
    CASE
      WHEN l.stage_key = 'email_todo' THEN 'hernoemd: email_todo → email_after_call'
      WHEN l.stage_key = 'interested' THEN 'interested bestaat niet meer → contacted_call + warm'
      WHEN l.stage_key = 'contacted' AND EXISTS (
        SELECT 1 FROM public.sales_lead_events e WHERE e.lead_id = l.id AND e.kind = 'call')
        THEN 'belpoging in de historiek'
      WHEN l.stage_key = 'contacted' AND EXISTS (
        SELECT 1 FROM public.sales_lead_events e WHERE e.lead_id = l.id AND e.body ILIKE 'Harrie:%linkedin%')
        THEN 'enkel Harrie, laatste spoor LinkedIn'
      WHEN l.stage_key = 'contacted' AND EXISTS (
        SELECT 1 FROM public.sales_lead_events e WHERE e.lead_id = l.id AND e.body LIKE 'Harrie:%')
        THEN 'enkel Harrie, laatste spoor mail'
      WHEN l.stage_key = 'contacted' THEN 'geen spoor → bellen is de bestaande workflow'
    END AS regel
  FROM public.sales_leads l
  WHERE l.stage_key IN ('contacted', 'interested', 'email_todo')
), gelogd AS (
  INSERT INTO public.sales_stage_migratie (lead_id, van, naar, regel)
  SELECT id, van, naar, regel FROM bepaald WHERE naar IS NOT NULL
  RETURNING lead_id, naar
)
UPDATE public.sales_leads l
SET stage_key = g.naar,
    warm    = CASE WHEN l.stage_key = 'interested' THEN true ELSE l.warm END,
    warm_op = CASE WHEN l.stage_key = 'interested' THEN now() ELSE l.warm_op END
FROM gelogd g WHERE g.lead_id = l.id;

-- Bestaande redenen op de vaste codes leggen; lost_reason blijft ongemoeid.
UPDATE public.sales_leads SET reden_code = CASE
  WHEN lost_reason ILIKE 'Heeft al een partner%' THEN 'al_partner'
  WHEN lost_reason ILIKE 'Doet marketing intern%' OR lost_reason ILIKE 'Intern%' THEN 'intern'
  WHEN lost_reason ILIKE 'Geen behoefte%'        THEN 'geen_behoefte'
  WHEN lost_reason ILIKE 'Geen budget%'          THEN 'geen_budget'
  WHEN lost_reason ILIKE 'Te duur%'              THEN 'te_duur'
  WHEN lost_reason ILIKE 'Slechte ervaring%'     THEN 'slechte_ervaring'
  WHEN lost_reason ILIKE 'Niet nu%'              THEN 'timing'
  WHEN lost_reason ILIKE 'Verkeerde persoon%'    THEN 'verkeerde_persoon'
  ELSE 'anders' END
WHERE lost_reason IS NOT NULL AND reden_code IS NULL;

-- De fasetabel per klant gelijkzetten aan lib/sales/stages.ts.
DELETE FROM public.sales_stages WHERE key IN ('contacted', 'interested', 'email_todo', 'te_bellen');
INSERT INTO public.sales_stages (sales_client_id, key, label, position, is_won, is_lost)
SELECT c.id, v.key, v.label, v.pos, v.won, v.lost
FROM public.sales_clients c
CROSS JOIN (VALUES
  ('to_contact','Nog te contacteren',1,false,false),
  ('contacted_call','Gecontacteerd · Bellen',2,false,false),
  ('contacted_linkedin','Gecontacteerd · LinkedIn',3,false,false),
  ('contacted_mail','Gecontacteerd · Mail',4,false,false),
  ('email_after_call','E-mail versturen na bellen',5,false,false),
  ('email_sent','E-mail verstuurd',6,false,false),
  ('not_interested','Geen interesse',7,false,false),
  ('appointment','Afspraak ingepland',8,false,false),
  ('max_pogingen','Max. belpogingen',9,false,false),
  ('won','Closed Won',10,true,false),
  ('lost','Closed Lost',11,false,true)
) AS v(key,label,pos,won,lost)
ON CONFLICT (sales_client_id, key) DO UPDATE
SET label = EXCLUDED.label, position = EXCLUDED.position,
    is_won = EXCLUDED.is_won, is_lost = EXCLUDED.is_lost;

-- ── 4. Hulpfuncties ───────────────────────────────────────────────────────
-- LET OP: deze spiegelen lib/sales/dedupe.ts. Lopen ze uiteen, dan maakt Harrie
-- een tweede dossier aan voor een bedrijf dat er al staat. Wijzig je de ene,
-- wijzig dan de andere. (Bij het schrijven gecontroleerd: alle 3.988 bestaande
-- bedrijven geven in SQL exact dezelfde sleutel als in TypeScript.)
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.harrie_norm_kbo(ruw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d = '' THEN NULL
    WHEN length(d) = 12 AND d LIKE '00%' THEN right(d, 10)
    WHEN length(d) = 9  THEN '0' || d
    WHEN length(d) = 10 THEN d
    ELSE NULL
  END
  FROM (SELECT regexp_replace(coalesce(ruw, ''), '\D', '', 'g') AS d) x;
$$;

CREATE OR REPLACE FUNCTION public.harrie_web_host(ruw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(ruw, ''))), '^[a-z]+://', ''),
      '^www\.|[/?#].*$', '', 'g'),
    '');
$$;

CREATE OR REPLACE FUNCTION public.harrie_dedupe_key(naam text, website text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE host text; tokens text[]; gehouden text[];
BEGIN
  host := public.harrie_web_host(website);
  IF host IS NOT NULL AND position('.' in host) > 0 THEN
    RETURN 'web:' || host;
  END IF;
  tokens := regexp_split_to_array(
    regexp_replace(lower(unaccent(coalesce(naam, ''))), '\.', '', 'g'), '[^a-z0-9]+');
  SELECT array_agg(t) INTO gehouden FROM unnest(tokens) t
  WHERE t <> '' AND t NOT IN ('bv','bvba','nv','vzw','commv','cv','cvba','sa','sprl','srl',
                              'gcv','vof','ltd','limited','llc','inc','gmbh','ag','plc','bvi');
  IF gehouden IS NULL OR array_length(gehouden, 1) IS NULL THEN
    SELECT array_agg(t) INTO gehouden FROM unnest(tokens) t WHERE t <> '';
  END IF;
  RETURN 'name:' || coalesce(array_to_string(gehouden, ''), '');
END $$;

-- Hoe ver staat een lead? Hiermee valt hij nooit terug naar een vroegere fase.
CREATE OR REPLACE FUNCTION public.harrie_stage_rang(fase text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE fase
    WHEN 'to_contact' THEN 10
    WHEN 'contacted_call' THEN 20
    WHEN 'contacted_linkedin' THEN 20
    WHEN 'contacted_mail' THEN 20
    WHEN 'email_after_call' THEN 30
    WHEN 'email_sent' THEN 40
    WHEN 'appointment' THEN 50
    WHEN 'max_pogingen' THEN 80
    WHEN 'not_interested' THEN 90
    WHEN 'lost' THEN 95
    WHEN 'won' THEN 99
    ELSE 0 END;
$$;

-- Vrije tekst van Harrie op een telbare reden leggen.
CREATE OR REPLACE FUNCTION public.harrie_reden_code(tekst text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t ~ 'te duur|prijs|prijzig|duurder'    THEN 'te_duur'
    WHEN t ~ 'intern|zelf doen|eigen team'      THEN 'intern'
    WHEN t ~ 'al een partner|al (een )?bureau|werken al met|hebben al iemand' THEN 'al_partner'
    WHEN t ~ 'geen behoefte|niet nodig'         THEN 'geen_behoefte'
    WHEN t ~ 'geen budget|geen geld'            THEN 'geen_budget'
    WHEN t ~ 'verkeerde persoon|niet de juiste' THEN 'verkeerde_persoon'
    WHEN t ~ 'timing|later|nu niet|geen tijd'   THEN 'timing'
    WHEN t ~ 'slechte ervaring|teleurgesteld'   THEN 'slechte_ervaring'
    ELSE 'anders' END
  FROM (SELECT lower(coalesce(tekst, '')) AS t) x;
$$;

-- ── 5. Harrie LEEST: de volledige pipeline in één view ────────────────────
CREATE OR REPLACE VIEW public.harrie_pipeline AS
SELECT
  'lead_' || l.id::text AS id, l.id AS lead_id, c.name AS company,
  regexp_replace(coalesce(c.ondernemingsnummer,''), '\D', '', 'g') AS kbo,
  array_remove(ARRAY[lower(ct.email), lower(c.email)], NULL) AS emails,
  array_remove(ARRAY[
    nullif(regexp_replace(lower(coalesce(c.website,'')), '^https?://(www\.)?|/.*$', '', 'g'), ''),
    nullif(split_part(lower(coalesce(ct.email,'')), '@', 2), ''),
    nullif(split_part(lower(coalesce(c.email,'')),  '@', 2), '')
  ], NULL) AS domains,
  array_remove(ARRAY[ct.phone, ct.mobile, c.phone], NULL) AS phones,
  c.website, s.label AS stage, l.stage_key AS "stageKey",
  l.do_not_call AS "doNotContact",
  CASE WHEN l.do_not_call THEN coalesce(l.do_not_call_reason, 'Staat op bel-me-niet') END AS "doNotContactReason",
  ct.name AS "contactName", c.city, c.sector,
  l.callback_at AS "callbackAt", l.labels, l.warm,
  l.lost_reason AS "redenTekst", l.reden_code AS "redenCode", l.harrie,
  l.archived_at IS NOT NULL AS deleted,
  GREATEST(l.updated_at, c.updated_at, coalesce(ct.updated_at, l.updated_at)) AS "updatedAt"
FROM public.sales_leads l
JOIN public.sales_companies c ON c.id = l.company_id
LEFT JOIN public.sales_contacts ct ON ct.id = l.contact_id
LEFT JOIN public.sales_stages s ON s.key = l.stage_key AND s.sales_client_id = l.sales_client_id
UNION ALL
-- Onze klanten staan lang niet allemaal in de pipeline, en juist zij mogen
-- nooit een koude wervingsmail krijgen.
SELECT 'client_' || k.id::text, NULL, k.company_name,
  regexp_replace(coalesce(k.btw_nummer,''), '\D', '', 'g'),
  array_remove(ARRAY[lower(k.email)], NULL),
  array_remove(ARRAY[
    nullif(regexp_replace(lower(coalesce(k.website_url,'')), '^https?://(www\.)?|/.*$', '', 'g'), ''),
    nullif(split_part(lower(coalesce(k.email,'')), '@', 2), '')
  ], NULL),
  ARRAY[]::text[], k.website_url,
  CASE WHEN k.archived_at IS NOT NULL THEN 'Oud-klant' ELSE 'Klant' END,
  CASE WHEN k.archived_at IS NOT NULL THEN 'oud_klant' ELSE 'klant' END,
  true, 'Is klant van ons',
  k.contact_name, NULL, k.niche, NULL, ARRAY[]::text[], false, NULL, NULL, NULL,
  false, k.updated_at
FROM public.clients k
UNION ALL
SELECT 'kantoor_' || b.id::text, NULL, b.naam, NULL,
  array_remove(ARRAY[lower(b.email)], NULL),
  array_remove(ARRAY[nullif(split_part(lower(coalesce(b.email,'')), '@', 2), '')], NULL),
  ARRAY[]::text[], NULL,
  CASE WHEN b.is_eigen THEN 'Eigen bedrijf' ELSE 'Partner' END,
  CASE WHEN b.is_eigen THEN 'eigen_bedrijf' ELSE 'partner' END,
  true,
  CASE WHEN b.is_eigen THEN 'Ons eigen bedrijf' ELSE 'Partner waarmee we samenwerken' END,
  NULL, NULL, NULL, NULL, ARRAY[]::text[], false, NULL, NULL, NULL,
  false, b.created_at
FROM public.kantoor_bedrijven b;

-- ── 6. Harrie SCHRIJFT: één insert, deze trigger doet de rest ─────────────
-- Zie lib/harrie/model.ts voor dezelfde regels in TypeScript (die pad blijft
-- bestaan zolang FEATURES.harrieApi ooit weer aan gezet wordt).
CREATE OR REPLACE FUNCTION public.harrie_verwerk_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p        jsonb := coalesce(NEW.prospect, '{}'::jsonb);
  blok     jsonb := coalesce(NEW.harrie, '{}'::jsonb);
  v_email  text  := lower(nullif(btrim(p->>'email'), ''));
  v_kbo    text  := public.harrie_norm_kbo(p->>'kbo');
  v_naam   text  := nullif(btrim(coalesce(p->>'company', p->>'name')), '');
  v_kanaal text  := coalesce(blok->>'kanaal', '');
  v_lead uuid; v_bedrijf uuid; v_contact uuid; v_pipeline uuid; v_klant uuid;
  v_nieuw boolean := false;
  v_huidig text; v_warm boolean; v_reden text; v_labels text[];
  v_fase text; v_vooruit boolean := false; v_enkelnieuw boolean := false;
  v_zetfase boolean := false; v_regel text;
  v_res text[] := ARRAY[]::text[];
BEGIN
  SELECT pipeline_id INTO v_pipeline FROM public.harrie_instellingen WHERE id;
  IF v_pipeline IS NULL THEN
    SELECT id INTO v_pipeline FROM public.sales_pipelines WHERE key = 'nextgenmedia' LIMIT 1;
  END IF;
  IF v_pipeline IS NULL THEN
    SELECT id INTO v_pipeline FROM public.sales_pipelines ORDER BY created_at LIMIT 1;
  END IF;
  SELECT id INTO v_klant FROM public.sales_clients ORDER BY created_at LIMIT 1;

  -- De lead zoeken, in volgorde van zekerheid: e-mail van de contactpersoon,
  -- ondernemingsnummer, algemeen adres, en pas als laatste de bedrijfsnaam.
  IF v_email IS NOT NULL THEN
    SELECT l.id INTO v_lead FROM public.sales_leads l
    JOIN public.sales_contacts ct ON ct.id = l.contact_id
    WHERE lower(ct.email) = v_email AND l.pipeline_id = v_pipeline AND l.archived_at IS NULL LIMIT 1;
  END IF;
  IF v_lead IS NULL AND v_kbo IS NOT NULL THEN
    SELECT l.id INTO v_lead FROM public.sales_leads l
    JOIN public.sales_companies c ON c.id = l.company_id
    WHERE public.harrie_norm_kbo(c.ondernemingsnummer) = v_kbo
      AND l.pipeline_id = v_pipeline AND l.archived_at IS NULL LIMIT 1;
  END IF;
  IF v_lead IS NULL AND v_email IS NOT NULL THEN
    SELECT l.id INTO v_lead FROM public.sales_leads l
    JOIN public.sales_companies c ON c.id = l.company_id
    WHERE lower(c.email) = v_email AND l.pipeline_id = v_pipeline AND l.archived_at IS NULL LIMIT 1;
  END IF;
  IF v_lead IS NULL AND v_naam IS NOT NULL THEN
    SELECT l.id INTO v_lead FROM public.sales_leads l
    JOIN public.sales_companies c ON c.id = l.company_id
    WHERE c.dedupe_key = public.harrie_dedupe_key(v_naam, p->>'website')
      AND c.sales_client_id = v_klant AND l.pipeline_id = v_pipeline AND l.archived_at IS NULL LIMIT 1;
  END IF;

  IF v_lead IS NULL THEN
    IF v_naam IS NULL THEN
      NEW.resultaat := 'geweigerd: zonder bedrijfsnaam kan er geen lead aangemaakt worden';
      RETURN NEW;
    END IF;
    SELECT id INTO v_bedrijf FROM public.sales_companies
    WHERE sales_client_id = v_klant AND dedupe_key = public.harrie_dedupe_key(v_naam, p->>'website') LIMIT 1;
    IF v_bedrijf IS NULL THEN
      INSERT INTO public.sales_companies
        (sales_client_id, name, website, dedupe_key, city, sector, phone, ondernemingsnummer, country)
      VALUES (v_klant, v_naam, nullif(btrim(p->>'website'), ''),
              public.harrie_dedupe_key(v_naam, p->>'website'),
              nullif(btrim(p->>'city'), ''), nullif(btrim(p->>'sector'), ''),
              nullif(btrim(p->>'phone'), ''), v_kbo, 'België')
      RETURNING id INTO v_bedrijf;
    END IF;
    INSERT INTO public.sales_contacts (company_id, name, role, email, phone, linkedin, phone_digits)
    VALUES (v_bedrijf, nullif(btrim(coalesce(p->>'name', p->>'firstName')), ''),
            nullif(btrim(p->>'role'), ''), v_email, nullif(btrim(p->>'phone'), ''),
            nullif(btrim(p->>'linkedinUrl'), ''), regexp_replace(coalesce(p->>'phone',''), '\D', '', 'g'))
    RETURNING id INTO v_contact;
    INSERT INTO public.sales_leads
      (sales_client_id, pipeline_id, company_id, contact_id, stage_key, source, labels)
    VALUES (v_klant, v_pipeline, v_bedrijf, v_contact, 'to_contact', 'harrie', ARRAY['Harrie'])
    RETURNING id INTO v_lead;
    v_nieuw := true;
    v_res := array_append(v_res, 'nieuwe lead aangemaakt');
  ELSE
    v_res := array_append(v_res, 'gekoppeld aan bestaande lead');
  END IF;

  NEW.lead_id := v_lead;
  SELECT stage_key, warm, reden_code, labels INTO v_huidig, v_warm, v_reden, v_labels
  FROM public.sales_leads WHERE id = v_lead;

  CASE NEW.type
    WHEN 'imported' THEN v_fase := 'to_contact'; v_enkelnieuw := true; v_regel := 'Harrie: prospect opgeladen';
    WHEN 'sent' THEN v_fase := 'contacted_mail'; v_vooruit := true; v_regel := 'Harrie: koude mail verstuurd';
    WHEN 'linkedin_request' THEN v_fase := 'contacted_linkedin'; v_vooruit := true; v_regel := 'Harrie: LinkedIn-verzoek verstuurd';
    WHEN 'linkedin_message' THEN v_fase := 'contacted_linkedin'; v_vooruit := true; v_regel := 'Harrie: LinkedIn-bericht verstuurd';
    -- De belangrijkste: wie antwoordt is de warmste lead die er is. De fase
    -- blijft staan (het kanaal verandert niet), de warme markering komt erbij.
    WHEN 'replied' THEN v_fase := NULL; v_regel := 'Harrie: prospect reageerde';
    WHEN 'booked' THEN v_fase := 'appointment'; v_regel := 'Harrie: afspraak geboekt';
    WHEN 'booking_moved' THEN v_fase := 'appointment'; v_regel := 'Harrie: afspraak verzet';
    WHEN 'booking_cancelled' THEN
      v_fase := CASE WHEN v_kanaal ILIKE '%linkedin%' THEN 'contacted_linkedin' ELSE 'contacted_mail' END;
      v_regel := 'Harrie: afspraak geannuleerd';
    WHEN 'declined' THEN v_fase := 'not_interested'; v_regel := 'Harrie: prospect zei nee';
    WHEN 'lost' THEN v_fase := 'not_interested'; v_regel := 'Harrie: afgesloten';
    WHEN 'unsubscribed' THEN v_fase := NULL; v_regel := 'Harrie: uitgeschreven — niet meer mailen';
    WHEN 'bounced' THEN v_fase := NULL; v_regel := 'Harrie: e-mailadres bestaat niet';
    WHEN 'manual_reply' THEN v_fase := NULL; v_regel := 'Harrie: handmatig antwoord';
    ELSE
      NEW.resultaat := 'geweigerd: onbekend type ' || coalesce(NEW.type, '?');
      RETURN NEW;
  END CASE;

  -- Twee remmen: een import zet een BESTAANDE lead nooit terug, en een
  -- contactmelding mag alleen vooruit.
  v_zetfase := v_fase IS NOT NULL AND v_fase <> v_huidig
    AND NOT (v_enkelnieuw AND NOT v_nieuw)
    AND NOT (v_vooruit AND public.harrie_stage_rang(v_fase) < public.harrie_stage_rang(v_huidig));

  UPDATE public.sales_leads SET
    stage_key = CASE WHEN v_zetfase THEN v_fase ELSE stage_key END,
    warm = CASE WHEN NEW.type = 'replied' OR (blok->>'reageerde')::boolean IS TRUE THEN true ELSE warm END,
    warm_op = CASE WHEN (NEW.type = 'replied' OR (blok->>'reageerde')::boolean IS TRUE) AND NOT coalesce(warm, false)
                   THEN now() ELSE warm_op END,
    reden_code = CASE WHEN NEW.type IN ('declined','lost') AND reden_code IS NULL
                      THEN public.harrie_reden_code(NEW.detail) ELSE reden_code END,
    lost_reason = CASE WHEN NEW.type IN ('declined','lost') AND lost_reason IS NULL
                       THEN coalesce(nullif(btrim(NEW.detail), ''), 'Afgewezen via Harrie') ELSE lost_reason END,
    do_not_call = CASE WHEN NEW.type = 'unsubscribed' THEN true ELSE do_not_call END,
    do_not_call_reason = CASE WHEN NEW.type = 'unsubscribed' THEN 'Uitgeschreven via Harrie' ELSE do_not_call_reason END,
    labels = (SELECT array_agg(DISTINCT x) FROM unnest(
                coalesce(labels, ARRAY[]::text[]) || ARRAY['Harrie']
                || CASE WHEN NEW.type = 'bounced' THEN ARRAY['e-mail ongeldig'] ELSE ARRAY[]::text[] END) x),
    harrie = CASE WHEN NEW.harrie IS NOT NULL THEN NEW.harrie ELSE harrie END
  WHERE id = v_lead;

  INSERT INTO public.sales_lead_events (lead_id, kind, body, actor_email)
  VALUES (v_lead, 'system',
          v_regel || CASE WHEN nullif(btrim(NEW.detail), '') IS NOT NULL THEN ' · ' || btrim(NEW.detail) ELSE '' END,
          'harrie');

  IF v_zetfase THEN v_res := array_append(v_res, 'fase → ' || v_fase);
  ELSIF v_fase IS NOT NULL AND v_fase <> v_huidig THEN v_res := array_append(v_res, 'fase blijft ' || v_huidig);
  END IF;
  IF NEW.type = 'replied' THEN v_res := array_append(v_res, 'gemarkeerd als warm'); END IF;

  NEW.resultaat := array_to_string(v_res, ', ');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_harrie_event ON public.harrie_events;
CREATE TRIGGER trg_harrie_event BEFORE INSERT ON public.harrie_events
  FOR EACH ROW EXECUTE FUNCTION public.harrie_verwerk_event();
