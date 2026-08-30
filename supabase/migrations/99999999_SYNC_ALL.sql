-- ═════════════════════════════════════════════════════════════════════════════
--  NEXTGENMEDIA — VOLLEDIG SYNC-SCRIPT
--
--  Eén script dat ALLE kolommen, tabellen en buckets toevoegt die de huidige
--  applicatiecode verwacht. Volledig idempotent: veilig om meerdere keren te
--  runnen. Voegt alleen toe wat ontbreekt, verwijdert of overschrijft niets.
--
--  GEBRUIK: plak dit volledig in de Supabase SQL Editor en klik Run.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── clients ──────────────────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
  ADD COLUMN IF NOT EXISTS revenue_value  numeric,
  ADD COLUMN IF NOT EXISTS revenue_type   text,
  -- Sinds wanneer is dit een klant bij ons (kan vroeger zijn dan created_at).
  -- Bepaalt het commissiejaar (10/8/5%) voor aangeleverde commissiedeals.
  ADD COLUMN IF NOT EXISTS customer_since date,
  -- Laatst door admin ingestelde login-wachtwoord (klaartekst, admin-only).
  -- Alleen gevuld als admin het wachtwoord zelf instelt/reset.
  ADD COLUMN IF NOT EXISTS login_password text;

-- Backfill customer_since from created_at where empty
UPDATE public.clients SET customer_since = created_at::date WHERE customer_since IS NULL;

-- ── freelancers: store the admin-set login password (admin-only) ──────────────
ALTER TABLE public.freelancers
  ADD COLUMN IF NOT EXISTS login_password text;

-- ── contracts: looptijd voor reeds-getekende uploads ─────────────────────────
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date   date;

-- ── client_services: portal access defaults to false (admin grants later) ─────
ALTER TABLE public.client_services
  ALTER COLUMN active SET DEFAULT false;

-- ── contracts: signature zone, signed pdf, service tag, AI fields ─────────────
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS service_slug     text,
  ADD COLUMN IF NOT EXISTS signed_pdf_path  text,
  ADD COLUMN IF NOT EXISTS sig_page         integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sig_x_pct        numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS sig_y_pct        numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS sig_width        numeric NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS sig_height       numeric NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS signer_name      text,
  ADD COLUMN IF NOT EXISTS signer_email     text,
  ADD COLUMN IF NOT EXISTS detected_fields  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS field_values     jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── social_content_items: multi-platform ──────────────────────────────────────
ALTER TABLE public.social_content_items
  ADD COLUMN IF NOT EXISTS platforms text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.social_content_items
   SET platforms = ARRAY[platform]
 WHERE platform IS NOT NULL AND platforms = '{}'::text[];

-- ── webdesign_change_requests: image paths + friendly kind buckets ────────────
ALTER TABLE public.webdesign_change_requests
  ADD COLUMN IF NOT EXISTS image_paths text[]  NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS image_urls  jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS categories  text[]  NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- Relax the kind CHECK so portal values (text/color/image/other) are allowed.
DO $$
BEGIN
  ALTER TABLE public.webdesign_change_requests DROP CONSTRAINT IF EXISTS webdesign_change_requests_kind_check;
EXCEPTION WHEN others THEN NULL; END $$;

-- ── revenue_entries: title + billing frequency ────────────────────────────────
ALTER TABLE public.revenue_entries
  ADD COLUMN IF NOT EXISTS title             text,
  ADD COLUMN IF NOT EXISTS billing_frequency text NOT NULL DEFAULT 'monthly';

-- ── freelancers (partners): finance/profile fields (both schema variants) ─────
ALTER TABLE public.freelancers
  ADD COLUMN IF NOT EXISTS name                   text,
  ADD COLUMN IF NOT EXISTS company                text,
  ADD COLUMN IF NOT EXISTS company_name           text,
  ADD COLUMN IF NOT EXISTS vat_number             text,
  ADD COLUMN IF NOT EXISTS iban                   text,
  ADD COLUMN IF NOT EXISTS commission_pct         numeric DEFAULT 10,
  ADD COLUMN IF NOT EXISTS default_commission_pct numeric DEFAULT 10,
  ADD COLUMN IF NOT EXISTS region                 text,
  ADD COLUMN IF NOT EXISTS active                 boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes                  text,
  ADD COLUMN IF NOT EXISTS bio                    text;

-- Backfill name from full_name if the legacy column exists
DO $$
BEGIN
  UPDATE public.freelancers SET name = full_name WHERE name IS NULL AND full_name IS NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- ── freelancer_assignments: modern columns + origin + deal_type ───────────────
ALTER TABLE public.freelancer_assignments
  ADD COLUMN IF NOT EXISTS title        text,
  ADD COLUMN IF NOT EXISTS description  text,
  ADD COLUMN IF NOT EXISTS budget       numeric,
  ADD COLUMN IF NOT EXISTS payout       numeric,
  ADD COLUMN IF NOT EXISTS deadline     date,
  ADD COLUMN IF NOT EXISTS service_slug text,
  ADD COLUMN IF NOT EXISTS roles        text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS status       text   NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS origin       text   NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS deal_type    text   NOT NULL DEFAULT 'fixed';

-- Make the legacy NOT NULL `role` column optional (newer code uses roles[])
DO $$
BEGIN
  ALTER TABLE public.freelancer_assignments ALTER COLUMN role DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_assignments_origin ON public.freelancer_assignments (origin);

-- ── partner_ledger_entries (create if missing) ────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.partner_ledger_kind AS ENUM
    ('payout_owed','commission_owed','service_billed','manual_credit','manual_debit','settlement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.partner_ledger_status AS ENUM ('pending','settled','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.partner_ledger_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id uuid NOT NULL REFERENCES public.freelancers(id) ON DELETE CASCADE,
  kind          public.partner_ledger_kind NOT NULL,
  status        public.partner_ledger_status NOT NULL DEFAULT 'pending',
  amount        numeric NOT NULL,
  description   text,
  client_id     uuid,
  assignment_id uuid,
  occurred_on   date NOT NULL DEFAULT CURRENT_DATE,
  settlement_id uuid,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.partner_ledger_entries
  ADD COLUMN IF NOT EXISTS direction          text,
  ADD COLUMN IF NOT EXISTS commission_deal_id uuid,
  ADD COLUMN IF NOT EXISTS commission_year    integer;

UPDATE public.partner_ledger_entries
   SET direction = CASE WHEN amount >= 0 THEN 'we_pay_partner' ELSE 'partner_pays_us' END
 WHERE direction IS NULL;

ALTER TABLE public.partner_ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger admin all"        ON public.partner_ledger_entries;
DROP POLICY IF EXISTS "ledger partner read own" ON public.partner_ledger_entries;
CREATE POLICY "ledger admin all" ON public.partner_ledger_entries
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "ledger partner read own" ON public.partner_ledger_entries
  FOR SELECT TO authenticated
  USING (freelancer_id IN (SELECT id FROM public.freelancers WHERE user_id = auth.uid()));

-- ── partner_settlements (create if missing) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_settlements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id         uuid NOT NULL REFERENCES public.freelancers(id) ON DELETE CASCADE,
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  total_owed_to_partner numeric NOT NULL DEFAULT 0,
  total_owed_by_partner numeric NOT NULL DEFAULT 0,
  net_amount            numeric NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'draft',
  notes                 text,
  finalized_at          timestamptz,
  paid_at               timestamptz,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.partner_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settlements admin all"        ON public.partner_settlements;
DROP POLICY IF EXISTS "settlements partner read own" ON public.partner_settlements;
CREATE POLICY "settlements admin all" ON public.partner_settlements
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "settlements partner read own" ON public.partner_settlements
  FOR SELECT TO authenticated
  USING (freelancer_id IN (SELECT id FROM public.freelancers WHERE user_id = auth.uid()));

-- ── partner_commission_deals ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_commission_deals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id  uuid NOT NULL REFERENCES public.freelancers(id) ON DELETE CASCADE,
  client_id      uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  label          text,
  service_slug   text,
  contract_value numeric NOT NULL DEFAULT 0,
  start_date     date NOT NULL DEFAULT CURRENT_DATE,
  pct_year_1     numeric NOT NULL DEFAULT 10,
  pct_year_2     numeric NOT NULL DEFAULT 8,
  pct_year_3     numeric NOT NULL DEFAULT 5,
  status         text NOT NULL DEFAULT 'active',
  notes          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_deals_freelancer ON public.partner_commission_deals(freelancer_id);

ALTER TABLE public.partner_commission_deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "commission deals admin all"   ON public.partner_commission_deals;
DROP POLICY IF EXISTS "commission deals partner read" ON public.partner_commission_deals;
CREATE POLICY "commission deals admin all" ON public.partner_commission_deals
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "commission deals partner read" ON public.partner_commission_deals
  FOR SELECT TO authenticated
  USING (freelancer_id IN (SELECT id FROM public.freelancers WHERE user_id = auth.uid()));

-- ── updated_at triggers (best effort; helper may not exist on all projects) ───
DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_partner_ledger_updated      ON public.partner_ledger_entries;
  CREATE TRIGGER trg_partner_ledger_updated      BEFORE UPDATE ON public.partner_ledger_entries     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  DROP TRIGGER IF EXISTS trg_partner_settlements_updated ON public.partner_settlements;
  CREATE TRIGGER trg_partner_settlements_updated BEFORE UPDATE ON public.partner_settlements         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  DROP TRIGGER IF EXISTS trg_commission_deals_updated    ON public.partner_commission_deals;
  CREATE TRIGGER trg_commission_deals_updated    BEFORE UPDATE ON public.partner_commission_deals    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── partner_commission_deals: referral now works without an upfront value ─────
-- A commission deal = a REFERRAL relationship (partner + client + referred_at +
-- the 3 yearly %s). Individual sales live in partner_commission_sales below, so
-- contract_value is no longer required.
DO $$
BEGIN
  ALTER TABLE public.partner_commission_deals ALTER COLUMN contract_value DROP NOT NULL;
  ALTER TABLE public.partner_commission_deals ALTER COLUMN contract_value SET DEFAULT 0;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Commissie-RICHTING van een doorverwijzing:
--   'we_pay_partner'  = partner verwees klant NAAR ons  → WIJ betalen partner   (scenario 1)
--   'partner_pays_us' = WIJ verwezen klant naar partner → PARTNER betaalt ons   (scenario 2)
-- Onderaanneming (vast bedrag) loopt NIET via deze tabel en levert nooit commissie op.
ALTER TABLE public.partner_commission_deals
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'we_pay_partner';

-- ── partner_commission_sales: one row per sale to a referred client ───────────
-- Each sale earns commission at the rate of the referral year it falls in.
CREATE TABLE IF NOT EXISTS public.partner_commission_sales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES public.partner_commission_deals(id) ON DELETE CASCADE,
  freelancer_id uuid NOT NULL REFERENCES public.freelancers(id) ON DELETE CASCADE,
  service_slug  text,
  description   text,
  sale_amount   numeric NOT NULL,
  sale_date     date NOT NULL DEFAULT CURRENT_DATE,
  commission_year integer NOT NULL,
  commission_pct  numeric NOT NULL,
  commission_amount numeric NOT NULL,
  ledger_id     uuid,          -- the generated partner_ledger_entries row
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_sales_deal ON public.partner_commission_sales(deal_id);
CREATE INDEX IF NOT EXISTS idx_commission_sales_freelancer ON public.partner_commission_sales(freelancer_id);

ALTER TABLE public.partner_commission_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "commission sales admin all"    ON public.partner_commission_sales;
DROP POLICY IF EXISTS "commission sales partner read" ON public.partner_commission_sales;
CREATE POLICY "commission sales admin all" ON public.partner_commission_sales
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "commission sales partner read" ON public.partner_commission_sales
  FOR SELECT TO authenticated
  USING (freelancer_id IN (SELECT id FROM public.freelancers WHERE user_id = auth.uid()));

-- ── audit_log: onveranderlijk logboek van gevoelige acties (GDPR/security) ─────
-- Puur additief. Schrijven gebeurt met de service-role (bypasst RLS); admins
-- mogen lezen. Niemand mag via de client wijzigen of verwijderen → append-only.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,                 -- wie voerde de actie uit (auth.users.id)
  actor_email   text,
  actor_role    text,
  action        text NOT NULL,        -- bv. 'client.credentials.update'
  entity_type   text,                 -- bv. 'client', 'partner', 'settlement'
  entity_id     text,
  summary       text,                 -- korte, menselijke omschrijving
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- nooit wachtwoorden/secrets
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created   ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity    ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor     ON public.audit_log (actor_user_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- Admins mogen het logboek lezen. Schrijven loopt uitsluitend via de service-role
-- (die RLS overslaat), dus er is bewust GEEN insert/update/delete policy → het
-- log is niet te manipuleren vanuit een gewone (admin- of klant-)sessie.
DROP POLICY IF EXISTS "audit_log admin read" ON public.audit_log;
CREATE POLICY "audit_log admin read" ON public.audit_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── ClickUp-sync (app → ClickUp, één richting) ────────────────────────────────
-- Puur additief. Per klant aan/uit schakelbaar + opgeslagen folder/list-id zodat
-- we niet telkens opnieuw zoeken. Per contentitem het ClickUp task-id + een hash
-- van de gesyncte velden (om onnodige API-calls over te slaan).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS clickup_sync_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clickup_folder_id    text,
  ADD COLUMN IF NOT EXISTS clickup_list_id      text;

ALTER TABLE public.social_content_items
  ADD COLUMN IF NOT EXISTS clickup_task_id    text,
  ADD COLUMN IF NOT EXISTS clickup_sync_hash  text,
  ADD COLUMN IF NOT EXISTS clickup_synced_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_social_items_clickup_task ON public.social_content_items (clickup_task_id);

-- ── shoot_briefings: contentshoot-info per klant (admin beheert, klant leest) ──
-- Puur additief. Eén of meerdere shoots per klant met datum/uur/locatie + een
-- vrij briefing-tekstveld. Geen workflow/statussen.
CREATE TABLE IF NOT EXISTS public.shoot_briefings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  shoot_date  date,
  start_time  text,
  end_time    text,
  location    text,
  briefing    text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shoot_briefings_client ON public.shoot_briefings(client_id);

ALTER TABLE public.shoot_briefings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shoot admin all"        ON public.shoot_briefings;
DROP POLICY IF EXISTS "shoot client read own"  ON public.shoot_briefings;
CREATE POLICY "shoot admin all" ON public.shoot_briefings
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "shoot client read own" ON public.shoot_briefings
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE owner_user_id = auth.uid()));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_shoot_briefings_updated ON public.shoot_briefings;
  CREATE TRIGGER trg_shoot_briefings_updated BEFORE UPDATE ON public.shoot_briefings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── shoot_briefing_feedback: eenvoudige feedback/comments onder een briefing ──
-- Klant plaatst feedback (via server na eigendomscheck); admin markeert verwerkt.
CREATE TABLE IF NOT EXISTS public.shoot_briefing_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shoot_id    uuid NOT NULL REFERENCES public.shoot_briefings(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  author_role text NOT NULL DEFAULT 'client',  -- 'client' | 'admin'
  message     text NOT NULL,
  resolved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shoot_feedback_shoot ON public.shoot_briefing_feedback(shoot_id);

ALTER TABLE public.shoot_briefing_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shoot fb admin all"       ON public.shoot_briefing_feedback;
DROP POLICY IF EXISTS "shoot fb client read own" ON public.shoot_briefing_feedback;
CREATE POLICY "shoot fb admin all" ON public.shoot_briefing_feedback
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "shoot fb client read own" ON public.shoot_briefing_feedback
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE owner_user_id = auth.uid()));

-- ── month_planning_overrides: handmatige uitzonderingen op de maandplanning ────
-- Interne NextGenMedia-planning. Standaard blijft automatisch (op werkdagen);
-- per datum kan admin de fases overschrijven (verslepen / aanpassen). Een lege
-- array betekent 'deze dag bewust leeg'. Geen rij = standaardberekening.
CREATE TABLE IF NOT EXISTS public.month_planning_overrides (
  plan_date   date PRIMARY KEY,
  categories  text[] NOT NULL DEFAULT '{}'::text[],
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.month_planning_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "month plan admin all" ON public.month_planning_overrides;
CREATE POLICY "month plan admin all" ON public.month_planning_overrides
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── cost_entries: kosten (eenmalig + recurring) voor het financieel dashboard ─
-- Bedragen excl. btw + btw%; incl. wordt berekend. Admin-only.
CREATE TABLE IF NOT EXISTS public.cost_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text,
  category          text,
  type              text NOT NULL DEFAULT 'one_time',   -- 'one_time' | 'recurring'
  cost_date         date,                                -- eenmalig
  start_date        date,                                -- recurring
  end_date          date,                                -- recurring (optioneel)
  billing_frequency text NOT NULL DEFAULT 'monthly',     -- monthly | quarterly | annual
  amount_excl       numeric NOT NULL DEFAULT 0,
  vat_pct           numeric NOT NULL DEFAULT 21,
  notes             text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_entries_type ON public.cost_entries(type);

ALTER TABLE public.cost_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "costs admin all" ON public.cost_entries;
CREATE POLICY "costs admin all" ON public.cost_entries
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_cost_entries_updated ON public.cost_entries;
  CREATE TRIGGER trg_cost_entries_updated BEFORE UPDATE ON public.cost_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── fiscal_settings: instelbare fiscale parameters + loon per boekjaar ────────
-- Geen hardcoded percentages in de code: deze waarden zijn admin-instelbaar en
-- wijzigen jaarlijks. Eén rij per boekjaar.
CREATE TABLE IF NOT EXISTS public.fiscal_settings (
  year                   integer PRIMARY KEY,
  corporate_tax_pct      numeric NOT NULL DEFAULT 25,
  reduced_tax_pct        numeric NOT NULL DEFAULT 20,
  reduced_tax_limit      numeric NOT NULL DEFAULT 100000,
  social_pct_band1       numeric NOT NULL DEFAULT 20.5,
  social_pct_band2       numeric NOT NULL DEFAULT 14.16,
  income_band1_limit     numeric NOT NULL DEFAULT 75000,
  income_band2_limit     numeric NOT NULL DEFAULT 115000,
  mgmt_fee_pct           numeric NOT NULL DEFAULT 3.05,
  min_quarter            numeric NOT NULL DEFAULT 870,
  max_quarter            numeric NOT NULL DEFAULT 5000,
  extra_pct              numeric NOT NULL DEFAULT 0,
  extra_fixed            numeric NOT NULL DEFAULT 0,
  salary_gross_monthly   numeric NOT NULL DEFAULT 0,
  salary_months          integer NOT NULL DEFAULT 12,
  statuut                text NOT NULL DEFAULT 'zaakvoerder',
  include_social_as_cost boolean NOT NULL DEFAULT false,
  updated_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Dashboard 3.0: BTW%, cash-reserve%, cash op rekening, opnames vennoten
ALTER TABLE public.fiscal_settings
  ADD COLUMN IF NOT EXISTS vat_pct          numeric NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS cash_reserve_pct numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS cash_on_account  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_draws    numeric NOT NULL DEFAULT 0;

ALTER TABLE public.fiscal_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fiscal admin all" ON public.fiscal_settings;
CREATE POLICY "fiscal admin all" ON public.fiscal_settings
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── vesting (Vestiging-module): config + omzetregistraties ────────────────────
-- Puur informatief dashboard van het vestigingsprincipe; wijzigt geen echte
-- aandelen. Admin-only. Eén configrij (id=1) met de instelbare schijf-parameters.
CREATE TABLE IF NOT EXISTS public.vesting_config (
  id           integer PRIMARY KEY DEFAULT 1,
  start_date   date,
  schijf2_per  numeric NOT NULL DEFAULT 5000,
  schijf3_y1   numeric NOT NULL DEFAULT 10000,
  schijf3_y2   numeric NOT NULL DEFAULT 12000,
  schijf3_y3   numeric NOT NULL DEFAULT 15000,
  inbound_pct  numeric NOT NULL DEFAULT 30,
  website_pct  numeric NOT NULL DEFAULT 100,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vesting_revenue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name     text,
  service_slug    text,
  entry_date      date NOT NULL DEFAULT CURRENT_DATE,
  net_revenue     numeric NOT NULL DEFAULT 0,
  type            text NOT NULL DEFAULT 'inbound',  -- inbound | outbound | website
  attribution_pct numeric NOT NULL DEFAULT 0,
  vesting_revenue numeric NOT NULL DEFAULT 0,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Outbound = outreach (50%) + closing (50%); Inbound = closing (25%).
ALTER TABLE public.vesting_revenue
  ADD COLUMN IF NOT EXISTS outreach boolean,
  ADD COLUMN IF NOT EXISTS closing  boolean;

CREATE INDEX IF NOT EXISTS idx_vesting_revenue_date ON public.vesting_revenue(entry_date DESC);

ALTER TABLE public.vesting_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vesting_revenue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vesting cfg admin all" ON public.vesting_config;
DROP POLICY IF EXISTS "vesting rev admin all" ON public.vesting_revenue;
CREATE POLICY "vesting cfg admin all" ON public.vesting_config
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "vesting rev admin all" ON public.vesting_revenue
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── purchases: aankoopaanvragen + goedkeuringen (>€1.000) ─────────────────────
CREATE TABLE IF NOT EXISTS public.purchases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text,
  description       text,
  amount_excl       numeric NOT NULL DEFAULT 0,
  vat_pct           numeric NOT NULL DEFAULT 21,
  supplier          text,
  category          text,
  requester_user_id uuid,
  requester_email   text,
  entry_date        date NOT NULL DEFAULT CURRENT_DATE,
  attachment_path   text,
  status            text NOT NULL DEFAULT 'pending',  -- concept|pending|approved|approved_under_threshold|rejected
  needs_approval    boolean NOT NULL DEFAULT true,
  cost_entry_id     uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON public.purchases(status);

CREATE TABLE IF NOT EXISTS public.purchase_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id       uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  approver_user_id  uuid,
  approver_email    text NOT NULL,
  decision          text NOT NULL,        -- approved | rejected
  comment           text,
  decided_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, approver_email)
);
CREATE INDEX IF NOT EXISTS idx_purchase_approvals_purchase ON public.purchase_approvals(purchase_id);

ALTER TABLE public.purchases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "purchases admin all"  ON public.purchases;
DROP POLICY IF EXISTS "purchase appr admin"  ON public.purchase_approvals;
CREATE POLICY "purchases admin all" ON public.purchases
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "purchase appr admin" ON public.purchase_approvals
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_purchases_updated ON public.purchases;
  CREATE TRIGGER trg_purchases_updated BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── shoot_ideas: ideeën/inspiratie van de klant per shoot (geen scriptwijziging) ─
CREATE TABLE IF NOT EXISTS public.shoot_ideas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shoot_id        uuid NOT NULL REFERENCES public.shoot_briefings(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title           text,
  description     text,
  attachment_path text,
  status          text NOT NULL DEFAULT 'new',  -- new | seen | use | discard
  admin_note      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shoot_ideas_shoot ON public.shoot_ideas(shoot_id);

ALTER TABLE public.shoot_ideas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shoot ideas admin all"       ON public.shoot_ideas;
DROP POLICY IF EXISTS "shoot ideas client read own" ON public.shoot_ideas;
CREATE POLICY "shoot ideas admin all" ON public.shoot_ideas
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "shoot ideas client read own" ON public.shoot_ideas
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE owner_user_id = auth.uid()));

-- ── batches: productiebatches (naam/kleur/contentperiode) + klant-koppeling ────
CREATE TABLE IF NOT EXISTS public.batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL DEFAULT 'Batch',
  color        text NOT NULL DEFAULT '#3b82f6',
  start_month  integer NOT NULL DEFAULT 0,   -- ankermaand contentperiode (0-11)
  shoot_offset integer NOT NULL DEFAULT 1,   -- aantal maanden vóór content = shoot
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.batches(id) ON DELETE SET NULL;

ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "batches admin all" ON public.batches;
CREATE POLICY "batches admin all" ON public.batches
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_batches_updated ON public.batches;
  CREATE TRIGGER trg_batches_updated BEFORE UPDATE ON public.batches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── month_planning_clients: klanten handmatig aan een fase/maand koppelen ─────
-- Maandplanning wordt klantgericht: per maand (YYYY-MM) koppelt de admin klanten
-- aan een fase, optioneel met een planning-type (onboarding / strategie) + notitie.
CREATE TABLE IF NOT EXISTS public.month_planning_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_month    text NOT NULL,                 -- 'YYYY-MM'
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phase         text NOT NULL,                 -- fase-slug (zie lib/month-phases)
  planning_type text,                          -- 'onboarding' | 'strategie' | 'standaard'
  note          text,
  sort_order    integer NOT NULL DEFAULT 0,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_month_plan_clients_month ON public.month_planning_clients (plan_month);

ALTER TABLE public.month_planning_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "month plan clients admin all" ON public.month_planning_clients;
CREATE POLICY "month plan clients admin all" ON public.month_planning_clients
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_month_plan_clients_updated ON public.month_planning_clients;
  CREATE TRIGGER trg_month_plan_clients_updated BEFORE UPDATE ON public.month_planning_clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── partner_payments: echte geldstromen (los van de verplichtingen-ledger) ─────
-- Een betaling vereffent (een deel van) het openstaande saldo. Wordt NOOIT
-- verwijderd; enkel status: pending → approved | cancelled. Zowel admin als
-- partner mogen registreren; partner-registraties starten als 'pending'.
CREATE TABLE IF NOT EXISTS public.partner_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id   uuid NOT NULL REFERENCES public.freelancers(id) ON DELETE CASCADE,
  direction       text NOT NULL,               -- 'we_pay_partner' | 'partner_pays_us'
  amount          numeric NOT NULL,
  paid_on         date NOT NULL DEFAULT CURRENT_DATE,
  note            text,
  proof_path      text,
  status          text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'cancelled'
  created_by_role text,                         -- 'admin' | 'partner'
  created_by      uuid,
  approved_by     uuid,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_payments_freelancer ON public.partner_payments (freelancer_id);

ALTER TABLE public.partner_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner payments admin all"     ON public.partner_payments;
DROP POLICY IF EXISTS "partner payments partner read"  ON public.partner_payments;
DROP POLICY IF EXISTS "partner payments partner insert" ON public.partner_payments;
CREATE POLICY "partner payments admin all" ON public.partner_payments
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "partner payments partner read" ON public.partner_payments
  FOR SELECT TO authenticated
  USING (freelancer_id IN (SELECT id FROM public.freelancers WHERE user_id = auth.uid()));
CREATE POLICY "partner payments partner insert" ON public.partner_payments
  FOR INSERT TO authenticated
  WITH CHECK (freelancer_id IN (SELECT id FROM public.freelancers WHERE user_id = auth.uid()) AND status = 'pending');

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_partner_payments_updated ON public.partner_payments;
  CREATE TRIGGER trg_partner_payments_updated BEFORE UPDATE ON public.partner_payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── E-mail Center: templates, verzendlog, meldingsstatus ──────────────────────
-- Mails gaan nooit automatisch naar klanten; enkel admins versturen bewust.
-- Admin-meldingen mogen wel automatisch (per uur, via cron).
CREATE TABLE IF NOT EXISTS public.email_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  subject     text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  kind        text,                         -- optionele categorie: scripts/contract/shoot/generic
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email templates admin all" ON public.email_templates;
CREATE POLICY "email templates admin all" ON public.email_templates
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE TABLE IF NOT EXISTS public.email_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email      text NOT NULL,
  to_client_id  uuid,
  subject       text NOT NULL,
  body          text NOT NULL,
  template_id   uuid,
  template_name text,
  kind          text,                       -- scripts/contract/shoot/admin_notify/generic
  audience      text NOT NULL DEFAULT 'client',  -- 'client' | 'admin'
  status        text NOT NULL DEFAULT 'sent',    -- 'sent' | 'delivered' | 'error'
  error         text,
  provider_id   text,
  sent_by       uuid,
  sent_by_email text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_messages_created ON public.email_messages (created_at DESC);
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email messages admin all" ON public.email_messages;
CREATE POLICY "email messages admin all" ON public.email_messages
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Singleton-rij die bijhoudt tot wanneer admins al gemeld zijn.
CREATE TABLE IF NOT EXISTS public.admin_notify_state (
  id           text PRIMARY KEY DEFAULT 'singleton',
  last_run_at  timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_notify_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin notify state admin all" ON public.admin_notify_state;
CREATE POLICY "admin notify state admin all" ON public.admin_notify_state
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_email_templates_updated ON public.email_templates;
  CREATE TRIGGER trg_email_templates_updated BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── CTA op e-mailtemplates (additief, backward-compatible) ────────────────────
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS cta_text text,
  ADD COLUMN IF NOT EXISTS cta_link text;

-- ── Rapportlog-velden op email_messages (admin-rapportmails) ──────────────────
ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS trigger_type text,      -- 'auto' | 'manual' | 'event'
  ADD COLUMN IF NOT EXISTS item_count   integer,
  ADD COLUMN IF NOT EXISTS related_id   text;       -- gerelateerde aanvraag/klant/script

-- ── Throttle voor event-gedreven adminmails (1 mail per sleutel per uur) ───────
-- Bv. key = 'scripts:<client_id>' → max één scriptmelding per klant per uur.
CREATE TABLE IF NOT EXISTS public.admin_notify_throttle (
  key          text PRIMARY KEY,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_notify_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin throttle admin all" ON public.admin_notify_throttle;
CREATE POLICY "admin throttle admin all" ON public.admin_notify_throttle
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── client_tasks: taken die admin aan een klant geeft (alle diensten) ─────────
CREATE TABLE IF NOT EXISTS public.client_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  deadline      date,
  priority      text NOT NULL DEFAULT 'normaal',  -- laag | normaal | hoog
  status        text NOT NULL DEFAULT 'open',      -- open | in_progress | done | cancelled
  attachment_path text,
  attachment_name text,
  client_note   text,
  completed_at  timestamptz,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.client_tasks ADD COLUMN IF NOT EXISTS attachment_name text;
CREATE INDEX IF NOT EXISTS idx_client_tasks_client ON public.client_tasks (client_id);

ALTER TABLE public.client_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "client tasks admin all"  ON public.client_tasks;
DROP POLICY IF EXISTS "client tasks read own"   ON public.client_tasks;
CREATE POLICY "client tasks admin all" ON public.client_tasks
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "client tasks read own" ON public.client_tasks
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE owner_user_id = auth.uid()));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_client_tasks_updated ON public.client_tasks;
  CREATE TRIGGER trg_client_tasks_updated BEFORE UPDATE ON public.client_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── invoices: interne factuuropvolging, gekoppeld aan revenue_entries ─────────
-- Geen boekhoudpakket: enkel "wat moeten we factureren / gefactureerd / betaald"
-- en de koppeling met de omzetmodule. Bedragen excl. btw als basis.
CREATE TABLE IF NOT EXISTS public.invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  service_slug  text,
  invoice_month text NOT NULL,                  -- 'YYYY-MM'
  invoice_date  date,
  description   text,
  amount_excl   numeric NOT NULL DEFAULT 0,
  vat_pct       numeric NOT NULL DEFAULT 21,
  amount_incl   numeric NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'te_factureren', -- te_factureren | gefactureerd | betaald | geannuleerd
  revenue_id    uuid REFERENCES public.revenue_entries(id) ON DELETE SET NULL,
  note          text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_month ON public.invoices (invoice_month);
CREATE INDEX IF NOT EXISTS idx_invoices_revenue ON public.invoices (revenue_id);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoices admin all" ON public.invoices;
CREATE POLICY "invoices admin all" ON public.invoices
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_invoices_updated ON public.invoices;
  CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── Blogs: per-klant instellingen + gegenereerde blogs + Framer-publicatie ────
-- Additieve kolommen op clients (bloginstellingen + Framer-config). API key wordt
-- versleuteld opgeslagen (AES-GCM, lib/crypto) — nooit als platte tekst exposen.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS blogs_inbegrepen              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blog_startdatum               date,
  ADD COLUMN IF NOT EXISTS blog_frequentie_maanden       integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS blog_aantal_per_cyclus        integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS blog_volgende_generatie_datum date,
  ADD COLUMN IF NOT EXISTS blog_brand_context            text,
  ADD COLUMN IF NOT EXISTS framer_project_url            text,
  ADD COLUMN IF NOT EXISTS framer_api_key                text,   -- AES-GCM encrypted
  ADD COLUMN IF NOT EXISTS framer_blog_collection_id     text,
  ADD COLUMN IF NOT EXISTS framer_field_map              jsonb;

CREATE TABLE IF NOT EXISTS public.blogs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  titel            text NOT NULL DEFAULT '',
  slug             text NOT NULL DEFAULT '',
  content          text,
  meta_title       text,
  meta_description text,
  thumbnail_url    text,
  status           text NOT NULL DEFAULT 'klaar_voor_review', -- klaar_voor_review | goedgekeurd | gepubliceerd | gefaald
  gegenereerd_op   timestamptz NOT NULL DEFAULT now(),
  goedgekeurd_op   timestamptz,
  gepubliceerd_op  timestamptz,
  framer_item_id   text,
  foutmelding      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blogs_client ON public.blogs (client_id);
CREATE INDEX IF NOT EXISTS idx_blogs_status ON public.blogs (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blogs_client_slug ON public.blogs (client_id, slug);

ALTER TABLE public.blogs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blogs admin all" ON public.blogs;
CREATE POLICY "blogs admin all" ON public.blogs
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_blogs_updated ON public.blogs;
  CREATE TRIGGER trg_blogs_updated BEFORE UPDATE ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── Framer Manager: publicatielogs + laatste synchronisatie ───────────────────
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS framer_last_sync timestamptz;

CREATE TABLE IF NOT EXISTS public.framer_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  blog_id     uuid,
  actie       text NOT NULL,             -- connect | publish | deploy | disconnect | test
  status      text NOT NULL,             -- ok | gefaald
  foutmelding text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_framer_logs_client ON public.framer_logs (client_id);
CREATE INDEX IF NOT EXISTS idx_framer_logs_created ON public.framer_logs (created_at DESC);

ALTER TABLE public.framer_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "framer logs admin all" ON public.framer_logs;
CREATE POLICY "framer logs admin all" ON public.framer_logs
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── recurring_invoices: terugkerende facturatie-definities (auto per maand) ───
-- Verschijnen automatisch in elke maand tussen start- en eindmaand. Er worden
-- GEEN per-maand records aangemaakt; enkel de verstuur-status per maand wordt
-- bewaard in recurring_invoice_months.
CREATE TABLE IF NOT EXISTS public.recurring_invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  service_slug  text,
  start_month   text NOT NULL,                 -- 'YYYY-MM'
  end_month     text,                          -- 'YYYY-MM' of NULL (open einde)
  description   text,
  amount_excl   numeric NOT NULL DEFAULT 0,
  vat_pct       numeric NOT NULL DEFAULT 21,
  amount_incl   numeric NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  revenue_id    uuid REFERENCES public.revenue_entries(id) ON DELETE SET NULL,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recurring_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recurring invoices admin all" ON public.recurring_invoices;
CREATE POLICY "recurring invoices admin all" ON public.recurring_invoices
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE TABLE IF NOT EXISTS public.recurring_invoice_months (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_id  uuid NOT NULL REFERENCES public.recurring_invoices(id) ON DELETE CASCADE,
  month         text NOT NULL,                 -- 'YYYY-MM'
  status        text NOT NULL DEFAULT 'verstuurd', -- te_versturen | verstuurd | geannuleerd
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_invoice_months_uniq ON public.recurring_invoice_months (recurring_id, month);
ALTER TABLE public.recurring_invoice_months ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recurring invoice months admin all" ON public.recurring_invoice_months;
CREATE POLICY "recurring invoice months admin all" ON public.recurring_invoice_months
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_recurring_invoices_updated ON public.recurring_invoices;
  CREATE TRIGGER trg_recurring_invoices_updated BEFORE UPDATE ON public.recurring_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  DROP TRIGGER IF EXISTS trg_recurring_invoice_months_updated ON public.recurring_invoice_months;
  CREATE TRIGGER trg_recurring_invoice_months_updated BEFORE UPDATE ON public.recurring_invoice_months FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── blog_accounts: zelfstandige blog/Framer-entiteit (optioneel klant-gekoppeld)
-- Blogs zijn niet langer verplicht aan een klant gekoppeld. Alle blog/Framer-
-- configuratie verhuist naar blog_accounts; client_id is optioneel.
CREATE TABLE IF NOT EXISTS public.blog_accounts (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       text NOT NULL,
  website_url                text,
  framer_project_url         text,
  framer_api_key             text,           -- AES-GCM encrypted
  framer_blog_collection_id  text,
  framer_field_map           jsonb,
  frequentie_maanden         integer NOT NULL DEFAULT 1,
  aantal_per_cyclus          integer NOT NULL DEFAULT 1,
  startdatum                 date,
  volgende_generatie_datum   date,
  max_live_blogs             integer,
  briefing                   text,
  active                     boolean NOT NULL DEFAULT true,
  client_id                  uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  framer_last_sync           timestamptz,
  created_by                 uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blog_accounts_client ON public.blog_accounts (client_id);

ALTER TABLE public.blog_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blog accounts admin all"  ON public.blog_accounts;
DROP POLICY IF EXISTS "blog accounts client read" ON public.blog_accounts;
CREATE POLICY "blog accounts admin all" ON public.blog_accounts
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "blog accounts client read" ON public.blog_accounts
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE owner_user_id = auth.uid()));

-- framer_logs kan ook per blogaccount gelogd worden (zonder klant-FK).
ALTER TABLE public.framer_logs ADD COLUMN IF NOT EXISTS account_id uuid;

-- blogs koppelen aan een blogaccount; client_id wordt optioneel.
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.blog_accounts(id) ON DELETE CASCADE;
DO $$ BEGIN ALTER TABLE public.blogs ALTER COLUMN client_id DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_blogs_account ON public.blogs (account_id);

-- Wie heeft een blog (in het klantenportaal) laatst bewerkt?
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS laatst_bewerkt_door text;
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS laatst_bewerkt_op   timestamptz;

-- Klant mag enkel de blogs van zijn eigen (gekoppelde) blogaccount LEZEN.
-- Bewerken loopt via de server-API (service role) zodat push-naar-Framer + logging
-- centraal en gecontroleerd gebeurt.
DROP POLICY IF EXISTS "blogs client read" ON public.blogs;
CREATE POLICY "blogs client read" ON public.blogs
  FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE owner_user_id = auth.uid()));

DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_blog_accounts_updated ON public.blog_accounts;
  CREATE TRIGGER trg_blog_accounts_updated BEFORE UPDATE ON public.blog_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN others THEN NULL; END $$;

-- ── Datamigratie: bestaande klant-bloginstellingen → blogaccounts ─────────────
-- Idempotent: maakt enkel accounts voor klanten met blogs_inbegrepen die er nog
-- geen hebben, en koppelt bestaande blogs op basis van client_id.
DO $$
BEGIN
  INSERT INTO public.blog_accounts (name, website_url, framer_project_url, framer_api_key, framer_blog_collection_id, framer_field_map, frequentie_maanden, aantal_per_cyclus, startdatum, volgende_generatie_datum, briefing, active, client_id, framer_last_sync)
  SELECT c.company_name, c.website_url, c.framer_project_url, c.framer_api_key, c.framer_blog_collection_id, c.framer_field_map,
         COALESCE(c.blog_frequentie_maanden, 1), COALESCE(c.blog_aantal_per_cyclus, 1), c.blog_startdatum, c.blog_volgende_generatie_datum,
         c.blog_brand_context, true, c.id, c.framer_last_sync
  FROM public.clients c
  WHERE c.blogs_inbegrepen = true
    AND NOT EXISTS (SELECT 1 FROM public.blog_accounts a WHERE a.client_id = c.id);

  UPDATE public.blogs b
     SET account_id = a.id
    FROM public.blog_accounts a
   WHERE b.account_id IS NULL AND b.client_id IS NOT NULL AND a.client_id = b.client_id;
EXCEPTION WHEN others THEN NULL; END $$;

-- ── Blogaccount polish: gecachte website-analyse + blog memory ────────────────
-- website_analysis: gestructureerde analyse (diensten, SEO-woorden, tone, CTA's,
-- FAQ's). Wordt NIET elke generatie opnieuw uitgevoerd — enkel bij "opnieuw
-- analyseren" of wanneer de briefing wijzigt (website_analyzed_at → NULL).
-- blog_memory: { topics:[], keywords:[], angles:[], ctas:[] } om herhaling te vermijden.
ALTER TABLE public.blog_accounts ADD COLUMN IF NOT EXISTS website_analysis    jsonb;
ALTER TABLE public.blog_accounts ADD COLUMN IF NOT EXISTS website_analyzed_at timestamptz;
ALTER TABLE public.blog_accounts ADD COLUMN IF NOT EXISTS blog_memory         jsonb;

-- ── Blogs: synchronisatiestatus + publicatiebeheer ────────────────────────────
-- sync_status: synced | pending | failed (NULL = nog niet gepubliceerd)
-- publish_mode: now | scheduled | auto   publish_at: geplande publicatiedatum
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS sync_status  text;
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS publish_mode text NOT NULL DEFAULT 'now';
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS publish_at   timestamptz;

-- ── blog_versions: volledige versiegeschiedenis per blog ──────────────────────
CREATE TABLE IF NOT EXISTS public.blog_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id          uuid NOT NULL REFERENCES public.blogs(id) ON DELETE CASCADE,
  titel            text,
  slug             text,
  content          text,
  meta_title       text,
  meta_description text,
  thumbnail_url    text,
  edited_by        text,            -- e-mail/identiteit van wie de wijziging deed
  change_summary   text,            -- korte omschrijving van wat gewijzigd werd
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blog_versions_blog ON public.blog_versions (blog_id, created_at DESC);

ALTER TABLE public.blog_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blog versions admin all" ON public.blog_versions;
CREATE POLICY "blog versions admin all" ON public.blog_versions
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── Blog ecosystem automation ─────────────────────────────────────────────────
-- tags: automatische tagging per blog (SEO, Branding, HR, …)
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS tags text[];
-- knowledge: kennisbank per account (bedrijfsinfo, FAQ's, tone, termen, verboden
--   woorden, doelgroep, cases) — door de AI als HOOGSTE prioriteit gebruikt.
ALTER TABLE public.blog_accounts ADD COLUMN IF NOT EXISTS knowledge jsonb;
-- website_monitor: { last_checked, signature, changed, details } voor wekelijkse
--   detectie van websitewijzigingen (heranalyse aanbevolen, niet automatisch).
ALTER TABLE public.blog_accounts ADD COLUMN IF NOT EXISTS website_monitor jsonb;

-- ── app_state: kleine key/value-store voor systeemvlaggen (bv. laatste cron-run)
CREATE TABLE IF NOT EXISTS public.app_state (
  key        text PRIMARY KEY,
  value      jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app state admin all" ON public.app_state;
CREATE POLICY "app state admin all" ON public.app_state
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── Facturatie: factuurdag recurring + ClickUp-koppeling ──────────────────────
-- invoice_day: op welke dag de recurring factuur valt — 'first' (dag 1),
--   'mid' (dag 15) of 'last' (laatste dag van de maand, standaard).
ALTER TABLE public.recurring_invoices ADD COLUMN IF NOT EXISTS invoice_day text NOT NULL DEFAULT 'last';
-- ClickUp-taak-id's zodat we de "Factuur versturen"-taak op Completed kunnen zetten.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS clickup_task_id text;
ALTER TABLE public.recurring_invoice_months ADD COLUMN IF NOT EXISTS clickup_task_id text;

-- ── AI Contractmodule 2.0: optionele klant, templates, audit ──────────────────
-- Contract mag zonder klant bestaan (publieke tekenlink / intern).
DO $$ BEGIN ALTER TABLE public.contracts ALTER COLUMN client_id DROP NOT NULL; EXCEPTION WHEN others THEN NULL; END $$;
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contract_type  text,
  ADD COLUMN IF NOT EXISTS recipient_note text,
  ADD COLUMN IF NOT EXISTS expires_at     date,
  ADD COLUMN IF NOT EXISTS template_id    uuid,
  ADD COLUMN IF NOT EXISTS created_by     uuid;

-- Audit-log uitbreiden (contract_events bestaat al voor 'signed' e.d.).
ALTER TABLE public.contract_events
  ADD COLUMN IF NOT EXISTS actor      text,
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS meta       jsonb;

-- Contracttemplates: herbruikbare basiscontracten met AI-gedetecteerde velden.
CREATE TABLE IF NOT EXISTS public.contract_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  category        text,
  pdf_path        text,
  detected_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  sig_page        integer NOT NULL DEFAULT 1,
  sig_x_pct       numeric NOT NULL DEFAULT 5,
  sig_y_pct       numeric NOT NULL DEFAULT 25,
  sig_width       numeric NOT NULL DEFAULT 200,
  sig_height      numeric NOT NULL DEFAULT 60,
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contract templates admin all" ON public.contract_templates;
CREATE POLICY "contract templates admin all" ON public.contract_templates
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── Subaccounts & rechtenmodel: client_users ─────────────────────────────────
-- Eén klant kan meerdere portaalgebruikers hebben, elk met eigen rechten (jsonb).
-- Bestaande hoofdaccounts (clients.owner_user_id) blijven werken zonder rij hier.
CREATE TABLE IF NOT EXISTS public.client_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  auth_user_id  uuid,                       -- gekoppelde auth.users id (login)
  name          text,
  email         text,
  phone         text,
  role_label    text,                       -- preset/rol-naam (Eigenaar, Marketing, ...)
  active        boolean NOT NULL DEFAULT true,
  permissions   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS client_users_auth_user_id_key ON public.client_users(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_users_client_id_idx ON public.client_users(client_id);

ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;

-- Admin beheert alles.
DROP POLICY IF EXISTS "client users admin all" ON public.client_users;
CREATE POLICY "client users admin all" ON public.client_users
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Een subaccount mag enkel zijn eigen rij lezen (zelfde auth-user).
DROP POLICY IF EXISTS "client users self read" ON public.client_users;
CREATE POLICY "client users self read" ON public.client_users
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- ── Contracten: contractduur-type (naast bestaande contract_type) ─────────────
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS duration_type text;

-- ── Contract ↔ facturen koppeling (additief) ──────────────────────────────────
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS expected_invoice_count       integer,
  ADD COLUMN IF NOT EXISTS invoice_frequency            text,
  ADD COLUMN IF NOT EXISTS expected_invoice_amount_excl numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_contract ON public.invoices (contract_id);

-- ── Opdrachten ↔ ClickUp-sync (additief) ──────────────────────────────────────
ALTER TABLE public.freelancer_assignments
  ADD COLUMN IF NOT EXISTS clickup_task_id   text,
  ADD COLUMN IF NOT EXISTS clickup_assignee  text,
  ADD COLUMN IF NOT EXISTS clickup_synced_at timestamptz;

-- ── Klanten: BTW-nummer ───────────────────────────────────────────────────────
-- Optioneel; bestaande klanten mogen leeg blijven. Hergebruikt als suggestie in
-- contracten/facturen/prognose.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS btw_nummer text;

-- ── Voorwaarden / akkoorden (per-dashboard zichtbaar via rollen) ──────────────
CREATE TABLE IF NOT EXISTS public.terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  content     text,
  audiences   text[] NOT NULL DEFAULT '{}',   -- subset van admin|client|partner
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "terms admin all"   ON public.terms;
DROP POLICY IF EXISTS "terms read active" ON public.terms;
CREATE POLICY "terms admin all" ON public.terms
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
-- Ingelogde gebruikers mogen actieve voorwaarden lezen (audience-filtering gebeurt in code).
CREATE POLICY "terms read active" ON public.terms
  FOR SELECT TO authenticated USING (active = true);

-- ── Interne werknemers (rol 'employee') met per-module zichtbaarheid ──────────
-- 'employee' toevoegen aan het app_role-enum — ENKEL als dat enum bestaat.
-- In deze database is user_roles.role een gewone text-kolom (geen enum); dan is
-- er niets te doen en mag SYNC_ALL niet crashen op een ontbrekend type. De guard
-- op pg_type zorgt dat de ALTER daar nooit uitgevoerd wordt. (Werknemer-zijn
-- wordt sowieso primair uit staff_members afgeleid, niet uit dit enum.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'app_role' AND n.nspname = 'public'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'app_role' AND n.nspname = 'public' AND e.enumlabel = 'employee'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'employee';
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.staff_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid,
  name          text,
  email         text,
  active        boolean NOT NULL DEFAULT true,
  permissions   text[] NOT NULL DEFAULT '{}',   -- toegestane admin-modules
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_members_auth_user_id_key ON public.staff_members(auth_user_id) WHERE auth_user_id IS NOT NULL;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff admin all"  ON public.staff_members;
DROP POLICY IF EXISTS "staff self read"  ON public.staff_members;
CREATE POLICY "staff admin all" ON public.staff_members
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
-- Werknemer mag zijn eigen rij lezen (nodig voor de module-check in de resolver).
CREATE POLICY "staff self read" ON public.staff_members
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

-- ── Metricool-koppeling (read-only overzicht) ────────────────────────────────
-- Elke app-klant kan aan één Metricool-merk (blogId) gekoppeld worden. Enkel
-- gekoppelde klanten verschijnen in het Metricool-overzicht en -klantportaal.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS metricool_blog_id     text,
  ADD COLUMN IF NOT EXISTS metricool_brand_name  text;

-- ── Framer CMS-koppeling (klant beheert website-content via de app) ───────────
-- Per klant: Framer-project + API-key (server-side geheim) + of de klant het CMS
-- in de app mag beheren. De API-key wordt NOOIT naar de client-browser gestuurd.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS framer_project_url text,
  ADD COLUMN IF NOT EXISTS framer_api_key     text,
  ADD COLUMN IF NOT EXISTS cms_enabled        boolean NOT NULL DEFAULT false;

-- Spiegel van de Framer-CMS-collecties (import + publiceren-model).
CREATE TABLE IF NOT EXISTS public.cms_collections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  framer_collection_id  text NOT NULL,
  name                  text,
  slug                  text,
  fields                jsonb NOT NULL DEFAULT '[]',   -- [{id,name,type,userEditable,...}]
  client_editable       boolean NOT NULL DEFAULT true, -- mag de klant deze collectie bewerken?
  item_count            integer NOT NULL DEFAULT 0,
  synced_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cms_collections_client_framer_key
  ON public.cms_collections(client_id, framer_collection_id);

-- Spiegel van de items binnen een collectie. status: synced|dirty|new|deleted.
CREATE TABLE IF NOT EXISTS public.cms_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id   uuid NOT NULL REFERENCES public.cms_collections(id) ON DELETE CASCADE,
  framer_item_id  text,                                  -- null = nog niet naar Framer gepusht
  slug            text,
  draft           boolean NOT NULL DEFAULT false,
  field_data      jsonb NOT NULL DEFAULT '{}',           -- { fieldId: value }
  status          text NOT NULL DEFAULT 'synced',
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cms_items_collection_idx ON public.cms_items(collection_id);
CREATE UNIQUE INDEX IF NOT EXISTS cms_items_framer_key
  ON public.cms_items(collection_id, framer_item_id) WHERE framer_item_id IS NOT NULL;

ALTER TABLE public.cms_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cms_collections admin" ON public.cms_collections;
DROP POLICY IF EXISTS "cms_items admin" ON public.cms_items;
-- Admin beheert alles; klant-toegang loopt via de service-role portaalresolver
-- (gekeyd op de geverifieerde clientId), niet via RLS.
CREATE POLICY "cms_collections admin" ON public.cms_collections
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY "cms_items admin" ON public.cms_items
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- updated_at-trigger-functie idempotent garanderen (bestaat niet in elke DB).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$func$;

DO $$ BEGIN
  CREATE TRIGGER trg_cms_collections_updated BEFORE UPDATE ON public.cms_collections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_cms_items_updated BEFORE UPDATE ON public.cms_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Website-platform + onderhoud ─────────────────────────────────────────────
-- Per klant leggen we intern vast HOE de website gebouwd is (framer | custom) en
-- of er onderhoud loopt. Dit is puur interne administratie: de klant ziet nooit
-- het platform, enkel de functies die eruit volgen (CMS beheren of een knop naar
-- zijn beheerplatform).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS website_platform             text,     -- 'framer' | 'custom'
  ADD COLUMN IF NOT EXISTS website_admin_url            text,     -- beheerplatform (custom code)
  ADD COLUMN IF NOT EXISTS maintenance_included         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_start_date       date,
  ADD COLUMN IF NOT EXISTS maintenance_months           integer NOT NULL DEFAULT 12,
  -- Einddatum waarvoor de herinneringsmail al verstuurd is → nooit dubbel mailen.
  ADD COLUMN IF NOT EXISTS maintenance_reminder_sent_for date;

CREATE INDEX IF NOT EXISTS idx_clients_maintenance
  ON public.clients (maintenance_start_date) WHERE maintenance_included;

-- ── Tweestapsverificatie voor interne accounts ───────────────────────────────
-- Admins en werknemers loggen in met wachtwoord + een code per e-mail.
-- De code wordt NOOIT leesbaar bewaard: enkel een SHA-256-hash.
-- BEWUST GEEN RLS-policies: alleen de service-role (server) mag hierbij.
CREATE TABLE IF NOT EXISTS public.login_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_codes_user ON public.login_codes (user_id, created_at DESC);
ALTER TABLE public.login_codes ENABLE ROW LEVEL SECURITY;

-- ── Security: leesbare wachtwoorden verwijderen ──────────────────────────────
-- clients.login_password / freelancers.login_password bewaarden het door de
-- admin ingestelde wachtwoord in KLARE TEKST, puur om het later te kunnen tonen.
-- Supabase Auth bewaart het echte wachtwoord al gehasht; deze kopie was dus
-- overbodig en zou bij een datalek alle klant- en partnerwachtwoorden prijsgeven
-- (die mensen vaak hergebruiken). Eerst overschrijven, dan de kolom weghalen.
UPDATE public.clients     SET login_password = NULL WHERE login_password IS NOT NULL;
UPDATE public.freelancers SET login_password = NULL WHERE login_password IS NOT NULL;
ALTER TABLE public.clients     DROP COLUMN IF EXISTS login_password;
ALTER TABLE public.freelancers DROP COLUMN IF EXISTS login_password;

-- ── Rate limiting (brute-force-rem op inloggen en codes) ─────────────────────
-- Eén rij per poging; de code telt de rijen binnen een tijdvenster.
-- BEWUST GEEN RLS-policies: alleen de service-role (server) schrijft hierin.
-- Bevat geen persoonsgegevens: de sleutel is 'actie:ip', geen e-mailadres.
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  id         bigserial PRIMARY KEY,
  key        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_key_time ON public.rate_limit_hits (key, created_at DESC);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Alle kolommen, tabellen, policies en triggers staan nu in sync met de code.

-- ═══════════════════════════════════════════════════════════════════════════
--  MODULE VERKOOP — appointment setting + pipeline
-- ═══════════════════════════════════════════════════════════════════════════
-- Wij bellen prospects namens een KLANT en boeken afspraken in diens agenda.
-- Alles is strikt per klant gescheiden. Deze klant staat LOS van public.clients
-- (portaalklanten): een belklant heeft geen login, contracten of diensten.
-- Is het toevallig dezelfde partij, dan koppelt portal_client_id ze.

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- nodig voor de overlap-constraint

-- ── Klant waarvoor wij bellen ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_clients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  contact_name         text,
  contact_email        text,
  phone                text,
  status               text NOT NULL DEFAULT 'active',   -- active | paused | archived
  timezone             text NOT NULL DEFAULT 'Europe/Brussels',
  -- Boekingsregels (§8) — bewust platte kolommen, geen "meeting types".
  buffer_before_min    integer NOT NULL DEFAULT 0,
  buffer_after_min     integer NOT NULL DEFAULT 0,
  min_notice_min       integer NOT NULL DEFAULT 60,   -- min. opzegtermijn
  max_horizon_days     integer NOT NULL DEFAULT 60,   -- max. vooruit boeken
  max_per_day          integer NOT NULL DEFAULT 8,
  slot_interval_min    integer NOT NULL DEFAULT 30,   -- raster voor slepen
  default_duration_min integer NOT NULL DEFAULT 30,
  portal_client_id     uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── Bedrijven en contactpersonen ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_companies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_client_id uuid NOT NULL REFERENCES public.sales_clients(id) ON DELETE CASCADE,
  name            text NOT NULL,
  website         text,
  -- Ontdubbelsleutel: website-host, anders de genormaliseerde naam (§11).
  dedupe_key      text NOT NULL,
  sector          text,
  employees       integer,
  city            text,
  region          text,
  country         text,
  phone           text,
  linkedin        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Nooit twee bedrijven met dezelfde sleutel bij dezelfde klant.
CREATE UNIQUE INDEX IF NOT EXISTS sales_companies_dedupe
  ON public.sales_companies (sales_client_id, dedupe_key);

CREATE TABLE IF NOT EXISTS public.sales_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.sales_companies(id) ON DELETE CASCADE,
  name         text,
  role         text,
  email        text,
  phone        text,
  mobile       text,
  linkedin     text,
  -- Cijfer-genormaliseerd nummer, zodat +32470…, 0470… en 470… allemaal op
  -- hetzelfde zoekresultaat uitkomen (§4).
  phone_digits text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_contacts_phone ON public.sales_contacts (phone_digits);

-- ── Pipeline-fases (per klant dezelfde vaste set, zie §3) ────────────────────
CREATE TABLE IF NOT EXISTS public.sales_stages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_client_id uuid NOT NULL REFERENCES public.sales_clients(id) ON DELETE CASCADE,
  key             text NOT NULL,     -- stabiele sleutel, zie lib/sales/stages.ts
  label           text NOT NULL,
  position        integer NOT NULL,
  is_won          boolean NOT NULL DEFAULT false,
  is_lost         boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_stages_key ON public.sales_stages (sales_client_id, key);

-- ── Leads ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_leads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_client_id    uuid NOT NULL REFERENCES public.sales_clients(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES public.sales_companies(id) ON DELETE CASCADE,
  contact_id         uuid REFERENCES public.sales_contacts(id) ON DELETE SET NULL,
  stage_key          text NOT NULL DEFAULT 'to_contact',
  source             text NOT NULL DEFAULT 'manual',
  assigned_to        uuid,                       -- setter (auth user)
  labels             text[] NOT NULL DEFAULT '{}',
  callback_at        timestamptz,                -- terugbellen op
  archived_at        timestamptz,                -- zacht verwijderen, nooit hard
  lost_reason        text,
  do_not_call        boolean NOT NULL DEFAULT false,
  do_not_call_reason text,
  email_brief        text,                       -- briefing voor de klant (§4)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Eén actieve lead per bedrijf per klant (§11). Gearchiveerde tellen niet mee.
-- (vervallen) sales_leads_one_per_company is verderop VERVANGEN door
-- sales_leads_one_per_company_pipeline (één actieve lead per bedrijf PER
-- MERK). Opnieuw aanmaken zou een rerun laten falen zodra hetzelfde bedrijf
-- in beide pipelines een actieve lead heeft — ondersteund gedrag.
CREATE INDEX IF NOT EXISTS sales_leads_stage    ON public.sales_leads (sales_client_id, stage_key);
CREATE INDEX IF NOT EXISTS sales_leads_callback ON public.sales_leads (callback_at) WHERE callback_at IS NOT NULL;

-- ── Historiek per lead: belpogingen, notities, fasewissels ───────────────────
CREATE TABLE IF NOT EXISTS public.sales_lead_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  kind        text NOT NULL,           -- call | note | stage | system
  body        text,
  from_stage  text,
  to_stage    text,
  actor_id    uuid,
  actor_email text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_lead_events_lead ON public.sales_lead_events (lead_id, created_at DESC);

-- ── Beschikbaarheid ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_availability_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_client_id uuid NOT NULL REFERENCES public.sales_clients(id) ON DELETE CASCADE,
  weekday         smallint NOT NULL,   -- 0 = maandag … 6 = zondag
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  CONSTRAINT sales_avail_range CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS sales_avail_client ON public.sales_availability_rules (sales_client_id, weekday);

CREATE TABLE IF NOT EXISTS public.sales_availability_exceptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_client_id uuid NOT NULL REFERENCES public.sales_clients(id) ON DELETE CASCADE,
  date            date NOT NULL,
  closed          boolean NOT NULL DEFAULT true,   -- true = hele dag dicht
  start_time      time,                            -- anders: afwijkende uren
  end_time        time,
  note            text
);
-- (vervallen) sales_avail_exc_day — één uitzondering per dag per klant — is
-- verderop GEDROPT toen uitzonderingen per agenda gingen gelden. Opnieuw
-- aanmaken zou een rerun laten falen bij bv. een feestdag in beide agenda's.

-- ── Agendakoppeling (provider-agnostisch: google nu, clickup later) ──────────
CREATE TABLE IF NOT EXISTS public.sales_calendar_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_client_id  uuid NOT NULL REFERENCES public.sales_clients(id) ON DELETE CASCADE,
  provider         text NOT NULL DEFAULT 'google',
  account_email    text,
  calendar_id      text,                 -- agenda waarin we schrijven
  access_token     text,                 -- VERSLEUTELD (lib/crypto.ts)
  refresh_token    text,                 -- VERSLEUTELD
  token_expires_at timestamptz,
  status           text NOT NULL DEFAULT 'connected',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- (vervallen) sales_calconn_client — één agenda per provider per klant — is
-- verderop GEDROPT toen meerdere agenda's de kernfeature werden. Hem hier
-- opnieuw aanmaken zou een rerun laten falen zodra Bram én Marco allebei
-- Google gebruiken; daarom staat hier enkel nog deze verwijzing.

-- ── Afspraken ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_appointments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_client_id   uuid NOT NULL REFERENCES public.sales_clients(id) ON DELETE CASCADE,
  lead_id           uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL,
  contact_id        uuid REFERENCES public.sales_contacts(id) ON DELETE SET NULL,
  setter_id         uuid,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'scheduled',  -- scheduled|completed|no_show|cancelled
  notes             text,
  client_note       text,
  attendee_email    text,
  meet_url          text,
  external_event_id text,                -- Google-event
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_appt_range CHECK (ends_at > starts_at)
);
-- Dubbele boeking is ONMOGELIJK: twee niet-geannuleerde afspraken van dezelfde
-- klant mogen elkaar nooit overlappen. Dit is de laatste verdedigingslinie,
-- naast de hervalidatie in de code (§11).
DO $sales$ BEGIN
  ALTER TABLE public.sales_appointments
    ADD CONSTRAINT sales_appt_no_overlap
    EXCLUDE USING gist (
      sales_client_id WITH =,
      tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status <> 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $sales$;
CREATE INDEX IF NOT EXISTS sales_appt_window
  ON public.sales_appointments (sales_client_id, starts_at) WHERE status <> 'cancelled';

-- ── RLS: admin-only; de app werkt server-side via de service-role ────────────
ALTER TABLE public.sales_clients                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_companies               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_contacts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_stages                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_leads                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_lead_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_availability_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_availability_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_calendar_connections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_appointments            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_clients admin all"      ON public.sales_clients;
CREATE POLICY "sales_clients admin all" ON public.sales_clients FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "sales_companies admin all"    ON public.sales_companies;
CREATE POLICY "sales_companies admin all" ON public.sales_companies FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "sales_contacts admin all"     ON public.sales_contacts;
CREATE POLICY "sales_contacts admin all" ON public.sales_contacts FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "sales_stages admin all"       ON public.sales_stages;
CREATE POLICY "sales_stages admin all" ON public.sales_stages FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "sales_leads admin all"        ON public.sales_leads;
CREATE POLICY "sales_leads admin all" ON public.sales_leads FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "sales_lead_events admin all"  ON public.sales_lead_events;
CREATE POLICY "sales_lead_events admin all" ON public.sales_lead_events FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "sales_avail_rules admin all"  ON public.sales_availability_rules;
CREATE POLICY "sales_avail_rules admin all" ON public.sales_availability_rules FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "sales_avail_exc admin all"    ON public.sales_availability_exceptions;
CREATE POLICY "sales_avail_exc admin all" ON public.sales_availability_exceptions FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Tokens: GEEN policy — enkel de service-role (server) mag hierbij.
DROP POLICY IF EXISTS "sales_calconn admin all"      ON public.sales_calendar_connections;

DROP POLICY IF EXISTS "sales_appointments admin all" ON public.sales_appointments;
CREATE POLICY "sales_appointments admin all" ON public.sales_appointments FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- updated_at-triggers
DO $sales$ BEGIN
  CREATE TRIGGER trg_sales_clients_updated BEFORE UPDATE ON public.sales_clients
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $sales$;
DO $sales$ BEGIN
  CREATE TRIGGER trg_sales_companies_updated BEFORE UPDATE ON public.sales_companies
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $sales$;
DO $sales$ BEGIN
  CREATE TRIGGER trg_sales_contacts_updated BEFORE UPDATE ON public.sales_contacts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $sales$;
DO $sales$ BEGIN
  CREATE TRIGGER trg_sales_leads_updated BEFORE UPDATE ON public.sales_leads
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $sales$;
DO $sales$ BEGIN
  CREATE TRIGGER trg_sales_calconn_updated BEFORE UPDATE ON public.sales_calendar_connections
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $sales$;
DO $sales$ BEGIN
  CREATE TRIGGER trg_sales_appointments_updated BEFORE UPDATE ON public.sales_appointments
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $sales$;

-- ── Herinneringsmails naar prospects (§8, optioneel per klant) ───────────────
-- BEWUST OPT-IN: standaard een lege lijst = geen enkele automatische mail.
-- Dat sluit aan bij de platformregel dat er nooit ongevraagd mail uitgaat; de
-- admin zet dit per klant expliciet aan in het beschikbaarheidsscherm.
ALTER TABLE public.sales_clients
  ADD COLUMN IF NOT EXISTS reminder_days_before integer[] NOT NULL DEFAULT '{}',
  -- Ondertekening van de mail: de prospect hoort de KLANT te zien, niet ons.
  ADD COLUMN IF NOT EXISTS reminder_sender_name text;

-- Eén rij per verstuurde herinnering, zodat een dagelijkse cron nooit dubbel mailt.
CREATE TABLE IF NOT EXISTS public.sales_appointment_reminders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.sales_appointments(id) ON DELETE CASCADE,
  days_before    integer NOT NULL,
  sent_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_appt_reminder_once
  ON public.sales_appointment_reminders (appointment_id, days_before);

ALTER TABLE public.sales_appointment_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales_appt_reminders admin all" ON public.sales_appointment_reminders;
CREATE POLICY "sales_appt_reminders admin all" ON public.sales_appointment_reminders FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── Meerdere agenda's per klant (Bram, Marco, …) ────────────────────────────
-- Tot nu had een klant één agenda. Nu kan één klant meerdere agenda's hebben,
-- elk van een persoon, met eigen werkuren. Een setter kiest bij het boeken
-- eerst de persoon en sleept dan in diens agenda.
--
-- Volledig terugwaarts compatibel: bestaande rijen hebben calendar_id NULL en
-- blijven werken als "geldt voor de hele klant".

ALTER TABLE public.sales_calendar_connections
  ADD COLUMN IF NOT EXISTS name   text,               -- 'Bram', 'Marco'
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS color  text;               -- kleur van de blokjes

-- De oude regel liet maar één agenda per klant toe.
DROP INDEX IF EXISTS public.sales_calconn_client;
-- Wel: nooit twee keer dezelfde Google-agenda binnen dezelfde klant.
-- LET OP: deze index is verderop VERVANGEN door sales_calconn_unique_cal_merk
-- (één rij per account PER MERK). Hem hier opnieuw aanmaken zou falen zodra
-- één account voor twee merken gekoppeld is — en dan is dit hele bestand niet
-- meer herdraaibaar. Daarom staat hier enkel nog de verwijzing; de echte index
-- staat bij het blok "Vier agenda's, twee merken".

-- Werkuren en uitzonderingen mogen nu per agenda gelden.
-- NULL = geldt voor de hele klant (en dus voor elke agenda zonder eigen uren).
ALTER TABLE public.sales_availability_rules
  ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES public.sales_calendar_connections(id) ON DELETE CASCADE;
ALTER TABLE public.sales_availability_exceptions
  ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES public.sales_calendar_connections(id) ON DELETE CASCADE;

-- De uitzondering-per-dag was uniek per klant; dat moet nu per agenda kunnen.
DROP INDEX IF EXISTS public.sales_avail_exc_day;
CREATE UNIQUE INDEX IF NOT EXISTS sales_avail_exc_day_cal
  ON public.sales_availability_exceptions (sales_client_id, COALESCE(calendar_id, '00000000-0000-0000-0000-000000000000'::uuid), date);

-- In welke agenda staat de afspraak?
ALTER TABLE public.sales_appointments
  ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES public.sales_calendar_connections(id) ON DELETE SET NULL;

-- Dubbele boeking moet PER AGENDA gelden: Bram en Marco mogen tegelijk een
-- afspraak hebben, dezelfde persoon niet twee keer. COALESCE zorgt dat oude
-- rijen zonder agenda elkaar nog steeds blokkeren (NULL = NULL geldt niet in
-- een exclusion-constraint, een vaste sentinel wél).
ALTER TABLE public.sales_appointments DROP CONSTRAINT IF EXISTS sales_appt_no_overlap;
DO $sales$ BEGIN
  ALTER TABLE public.sales_appointments
    ADD CONSTRAINT sales_appt_no_overlap
    EXCLUDE USING gist (
      sales_client_id WITH =,
      (COALESCE(calendar_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
      tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status <> 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $sales$;

CREATE INDEX IF NOT EXISTS sales_appt_calendar
  ON public.sales_appointments (calendar_id, starts_at) WHERE status <> 'cancelled';

-- Bestaande koppelingen een naam geven zodat ze herkenbaar blijven in de UI.
UPDATE public.sales_calendar_connections
   SET name = COALESCE(name, account_email, 'Agenda')
 WHERE name IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERKOOP — meerdere Google-agenda's per koppeling meetellen als bezet
-- ═══════════════════════════════════════════════════════════════════════════
-- Eén Google-account heeft meestal meerdere agenda's (Marco, Bram, Chiara,
-- NextGenMedia, ...). Tot nu keken we enkel naar de hoofdagenda, waardoor een
-- bezet moment in een andere agenda toch wit (boekbaar) bleek.
--
-- busy_calendar_ids = welke agenda's van dat account als bezet tellen.
-- NULL betekent "nog niet gekozen": de code haalt de lijst dan live bij Google
-- op en gebruikt alle eigen agenda's. Zo werkt het ook vóór deze migratie.
ALTER TABLE public.sales_calendar_connections
  ADD COLUMN IF NOT EXISTS busy_calendar_ids text[];

-- ═══════════════════════════════════════════════════════════════════════════
-- VERKOOP — twee pipelines: NextGenMedia en NextGenSolutions
-- ═══════════════════════════════════════════════════════════════════════════
-- We bellen voor twee eigen bedrijven. Een lead hoort bij één van beide, en de
-- afspraak erft dat merk — daar hangt de juiste brochure en afzender aan vast.
--
-- Belangrijk: het MERK zit hier, niet in sales_clients. Die rij blijft de
-- organisatie (agenda's van Bram en Marco, werkuren, boekingsregels), want die
-- zijn gedeeld. Twee aparte sales_clients zou betekenen dat Bram voor beide
-- merken los geboekt kan worden — en dus dubbel bezet raakt.

CREATE TABLE IF NOT EXISTS public.sales_pipelines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_client_id      uuid NOT NULL REFERENCES public.sales_clients(id) ON DELETE CASCADE,
  key                  text NOT NULL,      -- 'nextgenmedia' | 'nextgensolutions'
  name                 text NOT NULL,
  position             integer NOT NULL DEFAULT 1,
  -- Herinneringsmail (dag vooraf) per merk.
  reminder_enabled     boolean NOT NULL DEFAULT true,
  brochure_url         text,               -- bijlage; publieke URL
  brochure_filename    text,
  reminder_from        text,               -- afzender, bv. 'NextGenSolutions <info@…>'
  reminder_reply_to    text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_pipelines_key
  ON public.sales_pipelines (sales_client_id, key);

-- Waar hoort deze lead / afspraak bij?
ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES public.sales_pipelines(id) ON DELETE SET NULL;
ALTER TABLE public.sales_appointments
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES public.sales_pipelines(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_leads_pipeline ON public.sales_leads (pipeline_id, stage_key);

-- Eén actieve lead per bedrijf PER PIPELINE. Hetzelfde bedrijf mag dus zowel
-- bij NextGenMedia als bij NextGenSolutions in de lijst staan — dat zijn twee
-- verschillende gesprekken. Het bedrijfsdossier zelf blijft gedeeld.
DROP INDEX IF EXISTS public.sales_leads_one_per_company;
CREATE UNIQUE INDEX IF NOT EXISTS sales_leads_one_per_company_pipeline
  ON public.sales_leads (
    sales_client_id,
    COALESCE(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid),
    company_id
  ) WHERE archived_at IS NULL;

ALTER TABLE public.sales_pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales_pipelines admin all" ON public.sales_pipelines;
CREATE POLICY "sales_pipelines admin all" ON public.sales_pipelines FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DO $sales$ BEGIN
  CREATE TRIGGER trg_sales_pipelines_updated BEFORE UPDATE ON public.sales_pipelines
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $sales$;

-- De herinnering kent nu soorten ('day_before'), niet enkel een aantal dagen.
ALTER TABLE public.sales_appointment_reminders
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'day_before';

-- De herinnering wordt bij Resend INGEPLAND op het exacte verzendmoment (tot
-- 72 uur vooruit). We bewaren het mail-id zodat een geannuleerde of verplaatste
-- afspraak zijn herinnering nog kan tegenhouden.
ALTER TABLE public.sales_appointment_reminders
  ADD COLUMN IF NOT EXISTS resend_id     text,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

-- ═══════════════════════════════════════════════════════════════════════════
-- INLOGINSTELLINGEN PER ACCOUNT — tweestapsverificatie aan of uit
-- ═══════════════════════════════════════════════════════════════════════════
-- Tweestapsverificatie staat AAN voor elk intern account. Wie ze niet moet
-- doorlopen, krijgt hier een rij met two_factor_required = false.
--
-- Bewust zo geschreven dat de veilige stand de standaard is: geen rij betekent
-- "code verplicht". Een lege of ontbrekende tabel kan de beveiliging dus nooit
-- per ongeluk uitschakelen.
CREATE TABLE IF NOT EXISTS public.login_settings (
  auth_user_id        uuid PRIMARY KEY,
  two_factor_required boolean NOT NULL DEFAULT true,
  note                text,          -- waarom deze uitzondering
  updated_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.login_settings ENABLE ROW LEVEL SECURITY;
-- Alleen admins; de app leest dit sowieso via de service-role.
DROP POLICY IF EXISTS "login_settings admin all" ON public.login_settings;
CREATE POLICY "login_settings admin all" ON public.login_settings FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- ═══════════════════════════════════════════════════════════════════════════
-- VERKOOP — e-mailhandtekening per agenda + handmatig ingrijpen op mails
-- ═══════════════════════════════════════════════════════════════════════════
-- Onder "Met vriendelijke groeten" hoort de handtekening van de persoon in
-- wiens agenda de afspraak staat. Blijft dit leeg, dan zoekt de code zelf de
-- juiste afbeelding op basis van de naam van de agenda (Bram, Marco, ...).
ALTER TABLE public.sales_calendar_connections
  ADD COLUMN IF NOT EXISTS signature_image_url text,
  ADD COLUMN IF NOT EXISTS signature_phone     text,
  ADD COLUMN IF NOT EXISTS signature_email     text;

-- Een handmatig geannuleerde herinnering. De rij blijft bewust staan: dat is
-- precies wat verhindert dat het dagelijkse vangnet hem opnieuw inplant.
ALTER TABLE public.sales_appointment_reminders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERKOOP — appointment setters: uren, commissie en resultaten
-- ═══════════════════════════════════════════════════════════════════════════
-- Onze setters werken op uurbasis (standaard € 50/u) plus een commissie op de
-- waarde van het eerste contract (standaard 7 %). Beide worden per maand
-- uitbetaald, en dat zijn twee aparte afrekeningen: uren en commissie.
--
-- BEDRAGEN IN CENTEN (integer). Bewust geen float: bij geld leidt afronden in
-- binaire kommagetallen tot bedragen die net niet kloppen, en dit gaat over wat
-- iemand effectief uitbetaald krijgt.

CREATE TABLE IF NOT EXISTS public.sales_setters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_client_id   uuid NOT NULL REFERENCES public.sales_clients(id) ON DELETE CASCADE,
  auth_user_id      uuid,                 -- login van de setter (staff_members)
  name              text NOT NULL,
  email             text,
  hourly_rate_cents integer NOT NULL DEFAULT 5000,     -- € 50,00 per uur
  commission_pct    numeric(5,2) NOT NULL DEFAULT 7.00,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Eén profiel per login; anders zouden uren over twee profielen versnipperen.
CREATE UNIQUE INDEX IF NOT EXISTS sales_setters_user
  ON public.sales_setters (auth_user_id) WHERE auth_user_id IS NOT NULL;

-- ── Gewerkte tijd ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_time_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setter_id   uuid NOT NULL REFERENCES public.sales_setters(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,               -- NULL = de timer loopt nog
  note        text,
  source      text NOT NULL DEFAULT 'timer',   -- timer | manual
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_time_range CHECK (ended_at IS NULL OR ended_at > started_at)
);
-- Nooit twee lopende timers voor dezelfde persoon: anders tikken de uren dubbel.
CREATE UNIQUE INDEX IF NOT EXISTS sales_time_one_running
  ON public.sales_time_entries (setter_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_time_setter_start
  ON public.sales_time_entries (setter_id, started_at DESC);

-- ── Resultaat van een afspraak ───────────────────────────────────────────────
-- De commissie wordt bij het vastleggen BEREKEND EN OPGESLAGEN, niet later
-- opnieuw uitgerekend. Verandert het commissiepercentage volgend jaar, dan mag
-- dat niets veranderen aan wat er vorig jaar afgesproken was.
ALTER TABLE public.sales_appointments
  ADD COLUMN IF NOT EXISTS setter_profile_id uuid REFERENCES public.sales_setters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome           text,        -- won | lost | NULL
  ADD COLUMN IF NOT EXISTS outcome_reason    text,
  ADD COLUMN IF NOT EXISTS deal_value_cents  bigint,
  ADD COLUMN IF NOT EXISTS commission_cents  bigint,
  ADD COLUMN IF NOT EXISTS commission_pct    numeric(5,2),
  ADD COLUMN IF NOT EXISTS outcome_at        timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_by        uuid;
CREATE INDEX IF NOT EXISTS sales_appt_setter
  ON public.sales_appointments (setter_profile_id, starts_at DESC);

-- ── Uitbetalingen: per setter, per maand, per soort ─────────────────────────
-- 'hours' en 'commission' zijn twee losse afrekeningen, zoals afgesproken.
CREATE TABLE IF NOT EXISTS public.sales_payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setter_id    uuid NOT NULL REFERENCES public.sales_setters(id) ON DELETE CASCADE,
  month        date NOT NULL,            -- altijd de 1e van de maand
  kind         text NOT NULL,            -- hours | commission
  amount_cents bigint NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'open',   -- open | paid
  paid_at      timestamptz,
  paid_by      uuid,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_payouts_unique
  ON public.sales_payouts (setter_id, month, kind);

ALTER TABLE public.sales_setters      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_payouts      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_setters admin all" ON public.sales_setters;
CREATE POLICY "sales_setters admin all" ON public.sales_setters FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "sales_time admin all" ON public.sales_time_entries;
CREATE POLICY "sales_time admin all" ON public.sales_time_entries FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
DROP POLICY IF EXISTS "sales_payouts admin all" ON public.sales_payouts;
CREATE POLICY "sales_payouts admin all" ON public.sales_payouts FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

DO $sales$ BEGIN
  CREATE TRIGGER trg_sales_setters_updated BEFORE UPDATE ON public.sales_setters
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $sales$;
DO $sales$ BEGIN
  CREATE TRIGGER trg_sales_payouts_updated BEFORE UPDATE ON public.sales_payouts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $sales$;

-- Opgeschoonde regels in het mailoverzicht. De afspraak zelf blijft ongemoeid;
-- enkel de regel verdwijnt uit de lijst, en is met één klik weer op te halen.
ALTER TABLE public.sales_appointments
  ADD COLUMN IF NOT EXISTS mail_hidden_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════════
-- FACTUREN — inkomende afrekeningen van appointment setters
-- ═══════════════════════════════════════════════════════════════════════════
-- Een setter factureert ONS: gewerkte uren en commissie, twee losse facturen
-- per maand. Ze staan in dezelfde tabel zodat je ze op het facturenscherm ziet,
-- maar met een `kind` erbij.
--
-- KRITISCH: de omzet in Financiën wordt uit deze tabel berekend. Zonder dit
-- onderscheid zou de kost van een setter als ONZE omzet meetellen. Alles wat
-- niet 'client' is, blijft daarom buiten de omzet en telt als kost.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS kind      text NOT NULL DEFAULT 'client',  -- client | setter_hours | setter_commission
  ADD COLUMN IF NOT EXISTS setter_id uuid,
  -- 'auto' = door de app bijgehouden; handmatige wijzigingen blijven staan.
  ADD COLUMN IF NOT EXISTS source    text NOT NULL DEFAULT 'manual';

-- Eén automatische factuur per setter, per maand, per soort.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_setter_month_kind
  ON public.invoices (setter_id, invoice_month, kind)
  WHERE setter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_kind ON public.invoices (kind);

-- ═══════════════════════════════════════════════════════════════════════════
-- AANBESTEDINGEN — datamodel
-- ═══════════════════════════════════════════════════════════════════════════
-- Monitort Belgische overheidsopdrachten (BDA), scoort ze 0–100, leest de
-- bestekken uit en stelt een dossier samen. De app dient NOOIT zelf in.
--
-- "Filter" is wat in de losse voorloper een workspace heette: een bewaarde
-- zoekopdracht van publicprocurement.be, met een eigenaar. Elke medewerker met
-- de rol kan er een eigen hebben (advertising, marketing, software, ...).

CREATE TABLE IF NOT EXISTS public.aanbestedingen_filters (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naam           text NOT NULL,
  short_link     text NOT NULL,                    -- bv. 'v2-abc123'
  include_closed boolean NOT NULL DEFAULT false,   -- ook afgesloten opdrachten?
  eigenaar       uuid NOT NULL,                    -- auth-gebruiker
  ai_top_x       integer NOT NULL DEFAULT 25,      -- max volledige analyses per run
  mail_drempel   integer NOT NULL DEFAULT 70,      -- vanaf welke score "interessant"
  auto_enabled     boolean NOT NULL DEFAULT false,
  auto_dagen       integer[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',  -- 1=ma … 7=zo
  auto_uur         integer NOT NULL DEFAULT 5,     -- Belgische tijd
  auto_laatste_run date,                           -- voorkomt dubbel draaien
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aanbestedingen_filters_eigenaar
  ON public.aanbestedingen_filters (eigenaar);

CREATE TABLE IF NOT EXISTS public.aanbestedingen (
  filter_id                    uuid NOT NULL REFERENCES public.aanbestedingen_filters (id) ON DELETE CASCADE,
  referentienummer             text NOT NULL,
  dossiernummer                text,
  titel                        text,
  beschrijving                 text DEFAULT '',
  organisatie                  text,
  cpv_hoofdcode                text,
  cpv_hoofd_omschrijving       text,
  cpv_bijkomende_codes         text,
  aard                         text,
  procedure                    text,
  publicatiedatum              date,
  publicatiedatum_raw          text,
  uiterste_indieningsdatum     timestamptz,        -- UTC
  uiterste_indieningsdatum_raw text,               -- originele Belgische tijd
  status                       text,
  -- Detailpagina. Het LAATSTE PADSEGMENT is de publicationWorkspaceId die nodig
  -- is om de bestekdocumenten op te halen — altijd volledig bewaren.
  link                         text,
  bron                         text DEFAULT 'BDA',
  ingediend                    boolean NOT NULL DEFAULT false,
  ingediend_at                 timestamptz,
  genegeerd                    boolean NOT NULL DEFAULT false,
  documenten_opgeruimd_at      timestamptz,
  record_status                text NOT NULL DEFAULT 'nieuw'
    CHECK (record_status IN ('nieuw', 'bestaand', 'verdwenen')),
  first_seen_at                timestamptz NOT NULL DEFAULT now(),
  last_seen_at                 timestamptz NOT NULL DEFAULT now(),
  uitkomst       text CHECK (uitkomst IS NULL OR uitkomst IN ('gewonnen','verloren')),
  uitkomst_op    timestamptz,
  omzet_bedrag   numeric,
  verlies_reden  text,
  verbeterpunten text,
  PRIMARY KEY (filter_id, referentienummer)
);
CREATE INDEX IF NOT EXISTS aanbestedingen_filter_idx   ON public.aanbestedingen (filter_id);
CREATE INDEX IF NOT EXISTS aanbestedingen_deadline_idx ON public.aanbestedingen (uiterste_indieningsdatum);

CREATE TABLE IF NOT EXISTS public.aanbesteding_analyse (
  filter_id           uuid NOT NULL,
  referentienummer    text NOT NULL,
  score               integer CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
  volledig            boolean NOT NULL DEFAULT false,   -- enkel gescoord, of uitgewerkt?
  kwalificatie_reden  text,
  uitleg_kort         text,
  samenvatting        text,
  plan_van_aanpak     text,
  gekozen_referenties jsonb,
  prijs_bedrag        numeric,
  prijs_type          text,
  prijs_detail        jsonb,
  prijs_onderbouwing  text,
  prijs_bevestigd     boolean NOT NULL DEFAULT false,
  bestek_status        text,
  bestek_bronnen       jsonb,
  bestek_samenvatting  text,
  selectiecriteria     jsonb,
  gevraagde_documenten jsonb,
  gunningscriteria     jsonb,
  checklist            jsonb,
  model          text,
  input_tokens   integer DEFAULT 0,
  output_tokens  integer DEFAULT 0,
  kost_usd       numeric DEFAULT 0,
  content_hash   text,           -- caching: nooit twee keer hetzelfde analyseren
  gezien_op      timestamptz,    -- NULL = toon de "nieuw"-badge
  gegenereerd_op timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (filter_id, referentienummer),
  FOREIGN KEY (filter_id, referentienummer)
    REFERENCES public.aanbestedingen (filter_id, referentienummer) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS aanbesteding_analyse_score_idx
  ON public.aanbesteding_analyse (filter_id, score DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.aanbesteding_documenten (
  filter_id        uuid NOT NULL,
  referentienummer text NOT NULL,
  version_id       text NOT NULL,
  filename         text,
  file_hash        text,          -- hergebruik over opdrachten heen
  doc_type         text,
  size_bytes       bigint DEFAULT 0,
  page_count       integer DEFAULT 0,
  char_count       integer DEFAULT 0,
  leesbaar         boolean NOT NULL DEFAULT false,
  status           text,
  tekst            text,
  opgehaald_op     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (filter_id, referentienummer, version_id),
  FOREIGN KEY (filter_id, referentienummer)
    REFERENCES public.aanbestedingen (filter_id, referentienummer) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS aanbesteding_documenten_hash_idx
  ON public.aanbesteding_documenten (file_hash);

-- ── Kennisbank per filter ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aanbesteding_kennis (
  filter_id          uuid PRIMARY KEY REFERENCES public.aanbestedingen_filters (id) ON DELETE CASCADE,
  visie              text DEFAULT '',
  ondernemingsnummer text DEFAULT '',
  adres              text DEFAULT '',
  tekenbevoegde      text DEFAULT '',
  contact_naam       text DEFAULT '',
  contact_email      text DEFAULT '',
  contact_telefoon   text DEFAULT '',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.aanbesteding_referenties (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_id    uuid NOT NULL REFERENCES public.aanbestedingen_filters (id) ON DELETE CASCADE,
  klant        text DEFAULT '',
  wat_we_deden text DEFAULT '',
  resultaat    text DEFAULT '',
  sector_type  text DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.aanbesteding_tarieven (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_id  uuid NOT NULL REFERENCES public.aanbestedingen_filters (id) ON DELETE CASCADE,
  dienst     text NOT NULL,
  tarief     numeric(12,2) NOT NULL,
  eenheid    text NOT NULL DEFAULT 'uur',
  opmerking  text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.aanbesteding_kennisdocumenten (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_id    uuid NOT NULL REFERENCES public.aanbestedingen_filters (id) ON DELETE CASCADE,
  name         text NOT NULL,
  storage_path text NOT NULL,
  size_bytes   bigint DEFAULT 0,
  mime         text DEFAULT '',
  kind         text NOT NULL DEFAULT 'portfolio',   -- 'portfolio' | 'prijslijst'
  tekst        text,
  tekst_status text,
  tekst_op     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Runs (voedt de live voortgangsbalk) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aanbesteding_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filter_id        uuid NOT NULL REFERENCES public.aanbestedingen_filters (id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'aangevraagd'
    CHECK (status IN ('aangevraagd','bezig','klaar','mislukt')),
  fase             text DEFAULT '',
  stap_nu          integer NOT NULL DEFAULT 0,
  stap_totaal      integer NOT NULL DEFAULT 0,
  omschrijving     text DEFAULT '',
  resultaat        text DEFAULT '',
  aangevraagd_door text DEFAULT '',
  aangevraagd_op   timestamptz NOT NULL DEFAULT now(),
  gestart_op       timestamptz,
  klaar_op         timestamptz
);
CREATE INDEX IF NOT EXISTS aanbesteding_runs_filter_idx
  ON public.aanbesteding_runs (filter_id, aangevraagd_op DESC);

-- ── RLS: admin-only; de app leest server-side via de service-role ───────────
-- De kennisbank bevat tarieven en verliesredenen, dus commercieel gevoelige
-- informatie. Dat een medewerker zijn EIGEN filter mag zien, regelen de guards
-- in de app — niet een ruimere policy hier.
ALTER TABLE public.aanbestedingen_filters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aanbestedingen                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aanbesteding_analyse          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aanbesteding_documenten       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aanbesteding_kennis           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aanbesteding_referenties      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aanbesteding_tarieven         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aanbesteding_kennisdocumenten ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aanbesteding_runs             ENABLE ROW LEVEL SECURITY;

DO $aanb$
DECLARE
  t text;
  polnaam text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'aanbestedingen_filters','aanbestedingen','aanbesteding_analyse',
    'aanbesteding_documenten','aanbesteding_kennis','aanbesteding_referenties',
    'aanbesteding_tarieven','aanbesteding_kennisdocumenten','aanbesteding_runs'
  ] LOOP
    polnaam := t || ' admin all';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', polnaam, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = ''admin'')) '
      'WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = ''admin''))',
      polnaam, t);
  END LOOP;
END $aanb$;

DO $aanb$ BEGIN
  CREATE TRIGGER trg_aanbestedingen_filters_updated BEFORE UPDATE ON public.aanbestedingen_filters
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $aanb$;

DO $aanb$ BEGIN
  CREATE TRIGGER trg_aanbesteding_kennis_updated BEFORE UPDATE ON public.aanbesteding_kennis
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $aanb$;

-- ── Aanbestedingen: workspaces zonder werknemer ─────────────────────────────
-- Een workspace (bv. "Software & IT", "Marketing") wordt in de module zelf
-- aangemaakt en hoeft niet aan een werknemer te hangen. Hangt er niemand aan,
-- dan zien enkel de beheerders hem en gaan de mails naar info@nextgenmedia.be.
-- Daarom mag `eigenaar` leeg zijn. Bestaande rijen blijven ongemoeid.
DO $aanb$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'aanbestedingen_filters'
      AND column_name = 'eigenaar'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.aanbestedingen_filters ALTER COLUMN eigenaar DROP NOT NULL;
  END IF;
END $aanb$;

-- ── Aanbestedingen: runs kunnen geannuleerd worden ──────────────────────────
-- Ophalen, beoordelen en uitwerken lopen als één lange aanvraag. Het venster
-- sluiten stopt die niet; daarom vragen we het annuleren via een vlag in de
-- database en kijkt de lopende run daar tussen twee stappen naar.
ALTER TABLE public.aanbesteding_runs
  ADD COLUMN IF NOT EXISTS annuleren_gevraagd boolean NOT NULL DEFAULT false;

-- 'geannuleerd' toevoegen aan de toegestane statussen. Eerst weg, dan opnieuw:
-- zo is het herhaalbaar en blijft bestaande data ongemoeid.
ALTER TABLE public.aanbesteding_runs DROP CONSTRAINT IF EXISTS aanbesteding_runs_status_check;
ALTER TABLE public.aanbesteding_runs ADD CONSTRAINT aanbesteding_runs_status_check
  CHECK (status IN ('aangevraagd','bezig','klaar','mislukt','geannuleerd'));

-- Lengte van de uitgelezen tekst apart bewaren. Zonder deze kolom moest het
-- kennisbankscherm de volledige tekst van elk document ophalen om er enkel de
-- lengte van te tellen — tot enkele megabytes per schermlading.
ALTER TABLE public.aanbesteding_kennisdocumenten
  ADD COLUMN IF NOT EXISTS char_count integer NOT NULL DEFAULT 0;

-- Bestaande rijen bijwerken, één keer.
UPDATE public.aanbesteding_kennisdocumenten
   SET char_count = length(tekst)
 WHERE tekst IS NOT NULL AND char_count = 0;

-- Wanneer is er over deze opdracht gemaild? Zonder dit veld zou elke run
-- opnieuw over dezelfde opdrachten mailen.
ALTER TABLE public.aanbesteding_analyse
  ADD COLUMN IF NOT EXISTS gemaild_op timestamptz;

-- ── Verkoop: bevestigingsbelletje in plaats van een herinneringsmail ────────
-- We sturen geen herinneringsmail meer naar een prospect. Twee dagen vóór de
-- afspraak bellen we zelf even: is de uitnodiging aangekomen, staat het nog.
-- Deze kolommen houden bij wie dat gesprek al gehad heeft, zodat een naam van
-- de bellijst verdwijnt zodra hij gebeld is.
ALTER TABLE public.sales_appointments
  ADD COLUMN IF NOT EXISTS bevestigd_op     timestamptz,
  ADD COLUMN IF NOT EXISTS bevestigd_door   uuid,
  ADD COLUMN IF NOT EXISTS bevestig_notitie text;

CREATE INDEX IF NOT EXISTS sales_appointments_bellijst_idx
  ON public.sales_appointments (starts_at)
  WHERE bevestigd_op IS NULL;

-- Adres van de afspraak. De closer rijdt ernaartoe, dus dit hoort in het
-- Google-event als `location` te staan: dan werkt navigeren rechtstreeks vanuit
-- de agenda. Een adres in de omschrijving verstoppen doet dat niet.
ALTER TABLE public.sales_appointments
  ADD COLUMN IF NOT EXISTS adres text;

-- ── Gedeelde database: onze kant dichtzetten ────────────────────────────────
-- Deze database wordt gedeeld met een tweede applicatie (schema `ngs`). Elke
-- gebruiker daarvan heeft een geldig token voor DIT project, en komt dus langs
-- onze RLS. Alles in public is gebonden aan auth.uid() — op één plek na.
--
-- `terms read active` gaf leestoegang op `active = true`, zonder enige controle
-- op wie je bent. Dat was ongevaarlijk toen wij de enige app waren; met een
-- gedeelde auth.users is het de enige deur waar een vreemde gebruiker door kan.
DROP POLICY IF EXISTS "terms read active" ON public.terms;
CREATE POLICY "terms read active" ON public.terms
  FOR SELECT TO authenticated
  USING (
    active = true
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())
  );

-- ── Framer-sites ────────────────────────────────────────────────────────────
-- Welke klantwebsites draaien op Framer, wat kosten ze, en wanneer verlengen ze.
-- `client_id` mag leeg zijn: niet elke site hoort bij een klant die in de app
-- staat. `naam` is daarom leidend en verplicht.
--
-- `renew_op` is een ANKERDATUM, niet "de volgende keer". De eerstvolgende
-- verlenging wordt eruit berekend, zodat er nooit een datum uit het verleden
-- blijft staan omdat niemand hem bijwerkte.
CREATE TABLE IF NOT EXISTS public.framer_sites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  naam         text NOT NULL,
  site_url     text,
  plan         text,                                   -- vrije tekst: Mini, Basic, Pro…
  bedrag_excl  numeric(12,2) NOT NULL DEFAULT 0,
  vat_pct      numeric(5,2)  NOT NULL DEFAULT 21,
  facturatie   text NOT NULL DEFAULT 'annual'
    CHECK (facturatie IN ('monthly','annual')),
  renew_op     date,
  opgezegd_op  date,                                   -- gestopt; blijft staan voor de historiek
  notitie      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS framer_sites_renew_idx ON public.framer_sites (renew_op)
  WHERE opgezegd_op IS NULL;
CREATE INDEX IF NOT EXISTS framer_sites_client_idx ON public.framer_sites (client_id);

ALTER TABLE public.framer_sites ENABLE ROW LEVEL SECURITY;

DO $fr$ BEGIN
  CREATE POLICY "framer_sites admin all" ON public.framer_sites
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $fr$;

DO $fr$ BEGIN
  CREATE TRIGGER trg_framer_sites_updated BEFORE UPDATE ON public.framer_sites
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $fr$;

-- ── MCP-connector: OAuth ────────────────────────────────────────────────────
-- De connector over HTTP was enkel beveiligd met een sleutel in het adres. Dat
-- is een gedeeld geheim: wie de URL heeft, heeft toegang. Met OAuth wordt elke
-- verbinding goedgekeurd door een ingelogde beheerder, en is de URL op zichzelf
-- waardeloos.
--
-- Tokens worden NOOIT als tekst bewaard, alleen als SHA-256. Lekt deze tabel,
-- dan kan er niemand mee inloggen.

-- Clients registreren zichzelf (RFC 7591). Claude doet dat bij elke nieuwe
-- verbinding, dus deze tabel groeit; oude rijen mogen weg.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  client_id     text PRIMARY KEY,
  client_name   text,
  redirect_uris text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Autorisatiecodes: kortlevend en eenmalig.
CREATE TABLE IF NOT EXISTS public.mcp_oauth_codes (
  code_hash      text PRIMARY KEY,
  client_id      text NOT NULL,
  user_id        uuid NOT NULL,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,          -- PKCE, altijd S256
  scope          text NOT NULL DEFAULT 'mcp',
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,            -- hergebruik is een aanval, geen vergissing
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_oauth_tokens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token_hash  text UNIQUE NOT NULL,
  refresh_token_hash text UNIQUE,
  client_id          text NOT NULL,
  user_id            uuid NOT NULL,
  scope              text NOT NULL DEFAULT 'mcp',
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_refresh_idx
  ON public.mcp_oauth_tokens (refresh_token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_user_idx
  ON public.mcp_oauth_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_codes_verval_idx
  ON public.mcp_oauth_codes (expires_at);

-- Alles dicht: deze tabellen worden uitsluitend server-side gelezen en
-- geschreven. Er is geen enkele reden voor een gebruiker om erbij te kunnen.
ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_tokens  ENABLE ROW LEVEL SECURITY;

-- ── Klantuploads ("dropbox") ────────────────────────────────────────────────
-- Klanten leveren zelf beeldmateriaal aan, met een titel en een beschrijving
-- erbij. Bewust een EIGEN tabel en geen kolom bij social content: op het moment
-- van uploaden weet niemand nog bij welke post het hoort. Koppelen kan later.
CREATE TABLE IF NOT EXISTS public.client_uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  titel         text NOT NULL,
  beschrijving  text,
  -- Pad in de bucket. Begint ALTIJD met het client_id, zodat een pad nooit naar
  -- het materiaal van een andere klant kan wijzen.
  bestandspad   text NOT NULL,
  bestandsnaam  text NOT NULL,
  mimetype      text,
  grootte       bigint,
  -- Wie leverde dit aan? Een klant kan meerdere subaccounts hebben.
  door_email    text,
  door_naam     text,
  auth_user_id  uuid,
  -- nieuw → gezien → verwerkt. Zo blijft zichtbaar wat nog aandacht nodig heeft.
  status        text NOT NULL DEFAULT 'nieuw',
  admin_notitie text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_uploads_client_idx
  ON public.client_uploads (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_uploads_status_idx
  ON public.client_uploads (status) WHERE status = 'nieuw';

-- Zoals de rest van het portaal: lezen en schrijven gebeurt server-side met de
-- service-role, ná het oplossen van de sessie. RLS staat aan als tweede laag.
ALTER TABLE public.client_uploads ENABLE ROW LEVEL SECURITY;

-- Privébucket. Nooit publiek: het gaat om materiaal van klanten, dat alleen via
-- een tijdelijke ondertekende link zichtbaar hoort te zijn.
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-uploads', 'client-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- ── Mappen bij klantuploads ─────────────────────────────────────────────────
-- Klanten leveren zelden één foto aan; het is een reeks van een shoot, een
-- pand, een evenement. Zonder mappen wordt dat één lange stroom waarin niemand
-- meer terugvindt wat bij elkaar hoort.
CREATE TABLE IF NOT EXISTS public.client_upload_folders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  naam         text NOT NULL,
  beschrijving text,
  door_naam    text,
  door_email   text,
  auth_user_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Twee mappen met dezelfde naam bij één klant is altijd een vergissing, en je
-- merkt het pas als je in de verkeerde zoekt. Hoofdletterongevoelig, want
-- "Gevel" en "gevel" zijn voor een mens dezelfde map.
CREATE UNIQUE INDEX IF NOT EXISTS client_upload_folders_naam_uniek
  ON public.client_upload_folders (client_id, lower(naam));
CREATE INDEX IF NOT EXISTS client_upload_folders_client_idx
  ON public.client_upload_folders (client_id, created_at DESC);

ALTER TABLE public.client_upload_folders ENABLE ROW LEVEL SECURITY;

-- LET OP: ON DELETE SET NULL, bewust NIET CASCADE. Een map weggooien mag nooit
-- het beeldmateriaal van een klant meenemen; de bestanden komen dan gewoon
-- weer bij de losse bestanden te staan.
ALTER TABLE public.client_uploads
  ADD COLUMN IF NOT EXISTS map_id uuid REFERENCES public.client_upload_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS client_uploads_map_idx
  ON public.client_uploads (map_id) WHERE map_id IS NOT NULL;

-- ── Contractstatus: constraint gelijktrekken met wat de app schrijft ─────────
-- De oude constraint liet enkel draft|sent|signed|cancelled toe, terwijl de
-- code óók 'viewed' (ontvanger opent de tekenlink) en 'expired' (link vervallen)
-- wegschrijft. Die updates stonden in een lege catch en faalden dus STIL: in de
-- praktijk stond er geen enkel contract op 'viewed', ook niet nadat de link
-- geopend was. De statussen "Geopend" en "Verlopen" bestonden wel in het scherm
-- maar werden nooit bereikt.
--
-- De nieuwe lijst is exact de verzameling die lib/contract-status.ts kan lezen
-- (de ALIAS-tabel daar). Regel: wat de app kan tonen, moet de app ook kunnen
-- opslaan. Zowel de Engelse/oude waarden als de Nederlandse canonieke waarden
-- staan erin, zodat er later zonder migratie naar de Nederlandse kan worden
-- overgeschakeld.
--
-- Puur verruimend: de oude vier zitten er nog steeds in, dus geen enkele
-- bestaande rij wordt ongeldig en er wordt geen data gewijzigd.
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE public.contracts ADD CONSTRAINT contracts_status_check CHECK (
  status IN (
    -- oude/Engelse waarden zoals ze vandaag in de database staan
    'draft', 'sent', 'viewed', 'opened', 'filled', 'signed',
    'cancelled', 'canceled', 'expired', 'replaced', 'template',
    -- canonieke Nederlandse waarden (lib/contract-status.ts)
    'klaar_voor_verzenden', 'verzonden', 'geopend', 'ingevuld',
    'getekend', 'geannuleerd', 'verlopen', 'vervangen'
  )
);

-- ── Belmodule: rijkere leaddata, terugbelnotitie en belscripts ──────────────
-- De vaste leadlijsten (FAFO-formaat) dragen meer mee dan het oude
-- bedrijvenmodel kon bewaren. Alles additief.
ALTER TABLE public.sales_companies
  ADD COLUMN IF NOT EXISTS email             text,   -- algemeen adres (info@)
  ADD COLUMN IF NOT EXISTS werkklasse        text,   -- "10–19", "20–49" — het ruwe label
  ADD COLUMN IF NOT EXISTS activiteit        text,   -- omschrijving uit de lijst (NACE-tekst)
  ADD COLUMN IF NOT EXISTS ondernemingsnummer text,  -- KBO, voor de opzoeklink in Focus Mode
  ADD COLUMN IF NOT EXISTS prioriteit        text;   -- A/B/C uit de lijst

-- Terugbelafspraken: "bel over een uur terug" krijgt een notitie erbij, zodat
-- in Focus Mode zichtbaar is WAAROM die lead straks weer bovenaan springt.
ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS callback_note text;

-- De index op callback_at staat al hierboven als `sales_leads_callback`. Deze
-- regel maakte er per ongeluk een tweede, identieke naast — dubbel schrijfwerk
-- bij elke wijziging, zonder dat lezen er iets mee opschiet. Weggehaald, en de
-- dubbel wordt hieronder opgeruimd als hij er al staat.
DROP INDEX IF EXISTS public.sales_leads_callback_idx;

-- Belscripts: het coldcallingscript van een setter, plus de AI-analyse ervan
-- (secties, bezwaren met reacties, weetjes) als jsonb. De ruwe tekst blijft de
-- bron; de analyse is een weergave en kan altijd opnieuw gemaakt worden.
CREATE TABLE IF NOT EXISTS public.sales_scripts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_client_id  uuid NOT NULL REFERENCES public.sales_clients(id) ON DELETE CASCADE,
  naam             text NOT NULL,
  -- NULL = algemeen script voor iedereen; anders het script van één setter.
  eigenaar_auth_id uuid,
  -- NULL = geldt voor alle merken.
  pipeline_id      uuid REFERENCES public.sales_pipelines(id) ON DELETE SET NULL,
  ruwe_tekst       text NOT NULL,
  bron_bestand     text,
  -- Aanhalingstekens verplicht: ANALYSE is in Postgres een gereserveerd woord
  -- (de Britse spelling van ANALYZE). De kolom heet gewoon analyse; alleen
  -- kale SQL moet hem quoten — PostgREST doet dat vanzelf.
  "analyse"        jsonb,
  analyse_model    text,
  geanalyseerd_op  timestamptz,
  actief           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_scripts_client_idx
  ON public.sales_scripts (sales_client_id, actief);

-- Zoals de hele verkoop-module: server-side via service-role; RLS als slot.
ALTER TABLE public.sales_scripts ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Vier agenda's, twee merken: Bram×NGM, Bram×NGS, Marco×NGM, Marco×NGS.
--
-- Een gekoppelde agenda hoort voortaan bij één merk (pipeline). NULL blijft
-- betekenen: zichtbaar voor beide merken — zo verandert er niets aan een
-- bestaande installatie tot iemand het merk expliciet instelt.
ALTER TABLE public.sales_calendar_connections
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES public.sales_pipelines(id) ON DELETE SET NULL;

-- Wie in ClickUp toegewezen wordt op de afspraaktaak (Bram of Marco).
ALTER TABLE public.sales_calendar_connections
  ADD COLUMN IF NOT EXISTS clickup_assignee_id bigint;

-- Per merk: de ClickUp-lijst ("agenda") waar afspraaktaken in komen, en het
-- interne adres dat bij elke nieuwe afspraak een melding krijgt.
ALTER TABLE public.sales_pipelines
  ADD COLUMN IF NOT EXISTS clickup_list_id text;
ALTER TABLE public.sales_pipelines
  ADD COLUMN IF NOT EXISTS notify_email text;

-- De ClickUp-taak die bij een afspraak hoort: nodig om hem bij verzetten mee
-- te verplaatsen en bij annuleren op te ruimen.
ALTER TABLE public.sales_appointments
  ADD COLUMN IF NOT EXISTS clickup_task_id text;

-- Eén Google-account mag voortaan per MERK een koppeling hebben: "Marco ×
-- NextGenMedia" en "Marco × NextGenSolutions" zijn twee agenda's in de app,
-- ook als ze hetzelfde Google-account gebruiken. De oude sleutel (één rij per
-- account) hield dat tegen.
DROP INDEX IF EXISTS public.sales_calconn_unique_cal;
CREATE UNIQUE INDEX IF NOT EXISTS sales_calconn_unique_cal_merk
  ON public.sales_calendar_connections
  (sales_client_id, provider, calendar_id, COALESCE(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Eigen titel voor het agenda-item van een afspraak. De prospect ziet de
-- event-titel in zijn uitnodiging, dus de setter moet hem kunnen bepalen.
ALTER TABLE public.sales_appointments ADD COLUMN IF NOT EXISTS titel text;


-- ─────────────────────────────────────────────────────────────────────────────
-- ClickUp → Google Calendar synchronisatie (eigen bouw: ClickUp's native sync
-- kan niet "assignee → specifieke agenda").

CREATE TABLE IF NOT EXISTS public.clickup_agenda_targets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clickup_assignee_id bigint NOT NULL UNIQUE,
  naam                text NOT NULL,
  google_calendar_id  text,
  bron_connection_id  uuid REFERENCES public.sales_calendar_connections(id) ON DELETE SET NULL,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clickup_agenda_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id        uuid NOT NULL REFERENCES public.clickup_agenda_targets(id) ON DELETE CASCADE,
  clickup_task_id  text NOT NULL,
  google_event_id  text NOT NULL,
  vingerafdruk     text NOT NULL,
  due_ms           bigint,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_id, clickup_task_id)
);
CREATE INDEX IF NOT EXISTS clickup_agenda_items_due ON public.clickup_agenda_items (due_ms);

CREATE TABLE IF NOT EXISTS public.clickup_agenda_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gestart     timestamptz NOT NULL DEFAULT now(),
  klaar       timestamptz,
  ok          boolean,
  fout        text,
  aangemaakt  int NOT NULL DEFAULT 0,
  bijgewerkt  int NOT NULL DEFAULT 0,
  verwijderd  int NOT NULL DEFAULT 0,
  overgeslagen int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS clickup_agenda_runs_gestart ON public.clickup_agenda_runs (gestart DESC);

CREATE TABLE IF NOT EXISTS public.cron_geheimen (
  sleutel text PRIMARY KEY,
  waarde  text NOT NULL
);

ALTER TABLE public.clickup_agenda_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clickup_agenda_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clickup_agenda_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_geheimen          ENABLE ROW LEVEL SECURITY;

INSERT INTO public.cron_geheimen (sleutel, waarde)
VALUES ('clickup_agenda', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (sleutel) DO NOTHING;

-- Er mag maar ÉÉN sync tegelijk lopen: twee overlappende runs maakten
-- dezelfde taken dubbel aan in Google. De databank dwingt dat nu af.
CREATE UNIQUE INDEX IF NOT EXISTS clickup_agenda_runs_een_open
  ON public.clickup_agenda_runs ((true)) WHERE klaar IS NULL;

-- Vaste closer per merk: NextGenMedia → Bram, NextGenSolutions → Marco.
ALTER TABLE public.sales_pipelines
  ADD COLUMN IF NOT EXISTS default_calendar_id uuid
  REFERENCES public.sales_calendar_connections(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Opdrachten: werk dat binnenkomt en opgevolgd moet worden — een contentshoot,
-- een voorstel dat de deur uit is, iets waar we op de klant wachten.
CREATE TABLE IF NOT EXISTS public.opdrachten (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  klant_vrij    text,
  titel         text NOT NULL,
  omschrijving  text,
  status        text NOT NULL DEFAULT 'open',
  deadline      date,
  wie           text,
  afgerond_op   timestamptz,
  aangemaakt_door_email text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opdrachten_status_check
    CHECK (status IN ('open','bezig','wacht','afgerond','geannuleerd'))
);
CREATE INDEX IF NOT EXISTS opdrachten_open_deadline
  ON public.opdrachten (deadline)
  WHERE status NOT IN ('afgerond','geannuleerd');
CREATE INDEX IF NOT EXISTS opdrachten_client ON public.opdrachten (client_id);
ALTER TABLE public.opdrachten ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Kantoor: samenwerking tussen bedrijven (onderaanneming en doorverwijzing).
CREATE TABLE IF NOT EXISTS public.kantoor_bedrijven (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naam        text NOT NULL,
  is_eigen    boolean NOT NULL DEFAULT false,
  email       text,
  actief      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kantoor_bedrijven_naam ON public.kantoor_bedrijven (lower(naam));

CREATE TABLE IF NOT EXISTS public.kantoor_leden (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bedrijf_id    uuid NOT NULL REFERENCES public.kantoor_bedrijven(id) ON DELETE CASCADE,
  auth_user_id  uuid,
  email         text NOT NULL,
  naam          text,
  actief        boolean NOT NULL DEFAULT true,
  uitgenodigd_op timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bedrijf_id, email)
);
CREATE INDEX IF NOT EXISTS kantoor_leden_user ON public.kantoor_leden (auth_user_id) WHERE auth_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.kantoor_opdrachten (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  soort             text NOT NULL,
  factureert_id     uuid NOT NULL REFERENCES public.kantoor_bedrijven(id) ON DELETE RESTRICT,
  ontvangt_id       uuid NOT NULL REFERENCES public.kantoor_bedrijven(id) ON DELETE RESTRICT,
  titel             text NOT NULL,
  omschrijving      text,
  klant_naam        text,
  totaal_cents      bigint NOT NULL DEFAULT 0,
  vergoeding_cents  bigint NOT NULL DEFAULT 0,
  vergoeding_pct    numeric(5,2),
  bedragen_zichtbaar boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'lopend',
  afgerond_op       timestamptz,
  aangemaakt_door   uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kantoor_opdr_soort  CHECK (soort  IN ('onderaanneming','doorverwijzing')),
  CONSTRAINT kantoor_opdr_status CHECK (status IN ('lopend','afgerond','geannuleerd')),
  CONSTRAINT kantoor_opdr_twee_partijen CHECK (factureert_id <> ontvangt_id),
  CONSTRAINT kantoor_opdr_bedragen CHECK (
    totaal_cents >= 0 AND vergoeding_cents >= 0 AND vergoeding_cents <= totaal_cents
  )
);
CREATE INDEX IF NOT EXISTS kantoor_opdr_partijen ON public.kantoor_opdrachten (factureert_id, ontvangt_id);
CREATE INDEX IF NOT EXISTS kantoor_opdr_afgerond ON public.kantoor_opdrachten (afgerond_op) WHERE status = 'afgerond';

ALTER TABLE public.kantoor_bedrijven  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kantoor_leden      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kantoor_opdrachten ENABLE ROW LEVEL SECURITY;

INSERT INTO public.kantoor_bedrijven (naam, is_eigen, email)
SELECT v.naam, v.eigen, v.email FROM (VALUES
  ('NextGenMedia',           true,  'info@nextgenmedia.be'),
  ('NextGenSolutions',       true,  'info@nextgensolutions.be'),
  ('Small Steps Big Impact', false, NULL),
  ('Fully Booked',           false, NULL)
) AS v(naam, eigen, email)
WHERE NOT EXISTS (SELECT 1 FROM public.kantoor_bedrijven b WHERE lower(b.naam) = lower(v.naam));
