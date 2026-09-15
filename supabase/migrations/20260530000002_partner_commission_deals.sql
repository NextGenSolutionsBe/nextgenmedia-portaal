-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: partner commission deals + explicit payment direction
--
-- Two kinds of partner finance:
--   A. COMMISSION   — partner refers a client/job; we run it; we pay the partner
--                     a % of the contract value, decreasing per active year of
--                     THAT client/job (default 10% / 8% / 5%).
--   B. SUBCONTRACT  — handled via fixed-payout ledger entries (already exist).
--
-- `direction` makes every ledger entry's payment direction explicit:
--   'we_pay_partner'  → positive amount, we owe the partner
--   'partner_pays_us' → partner owes us
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Explicit direction on ledger entries (derived from amount sign for old rows)
ALTER TABLE public.partner_ledger_entries
  ADD COLUMN IF NOT EXISTS direction text;

UPDATE public.partner_ledger_entries
   SET direction = CASE WHEN amount >= 0 THEN 'we_pay_partner' ELSE 'partner_pays_us' END
 WHERE direction IS NULL;

-- 2) Commission deals — one row per referred client/job
CREATE TABLE IF NOT EXISTS public.partner_commission_deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id   uuid NOT NULL REFERENCES public.freelancers(id) ON DELETE CASCADE,
  client_id       uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  -- Free-text label when no client record exists yet (just a lead/name)
  label           text,
  service_slug    text,
  -- Yearly contract value the commission is calculated on
  contract_value  numeric NOT NULL DEFAULT 0,
  start_date      date NOT NULL DEFAULT CURRENT_DATE,
  -- Editable per deal; sensible defaults
  pct_year_1      numeric NOT NULL DEFAULT 10,
  pct_year_2      numeric NOT NULL DEFAULT 8,
  pct_year_3      numeric NOT NULL DEFAULT 5,
  status          text NOT NULL DEFAULT 'active',  -- active | ended
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_deals_freelancer
  ON public.partner_commission_deals(freelancer_id);

ALTER TABLE public.partner_commission_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commission deals admin all"  ON public.partner_commission_deals;
DROP POLICY IF EXISTS "commission deals partner read" ON public.partner_commission_deals;

CREATE POLICY "commission deals admin all" ON public.partner_commission_deals
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "commission deals partner read" ON public.partner_commission_deals
  FOR SELECT TO authenticated
  USING (freelancer_id IN (SELECT id FROM public.freelancers WHERE user_id = auth.uid()));

DROP TRIGGER IF EXISTS trg_commission_deals_updated ON public.partner_commission_deals;
CREATE TRIGGER trg_commission_deals_updated
  BEFORE UPDATE ON public.partner_commission_deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Link a ledger entry back to the commission deal + which year it paid out
ALTER TABLE public.partner_ledger_entries
  ADD COLUMN IF NOT EXISTS commission_deal_id uuid,
  ADD COLUMN IF NOT EXISTS commission_year integer;
