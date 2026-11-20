-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: track where an assignment came from
--   'admin'   = NextGenMedia created it and (optionally) assigned it to a partner
--   'partner' = a partner proposed the work TO NextGenMedia (inbound)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.freelancer_assignments
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'admin';

-- Backfill: existing rows with an empty roles array + a freelancer + no client
-- were most likely partner proposals; everything else stays 'admin'.
-- (Safe no-op if the columns differ; wrapped so it never aborts the migration.)
DO $$
BEGIN
  UPDATE public.freelancer_assignments
     SET origin = 'partner'
   WHERE origin = 'admin'
     AND freelancer_id IS NOT NULL
     AND client_id IS NULL
     AND (roles IS NULL OR array_length(roles, 1) IS NULL);
EXCEPTION WHEN others THEN
  -- ignore (e.g. roles column shape differs on legacy schema)
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_assignments_origin
  ON public.freelancer_assignments (origin);

-- deal_type distinguishes a partner's commission lead from a fixed subcontract
--   'fixed'      = work for a fixed payout (default)
--   'commission' = referred client/job; commission handled via commission deals
ALTER TABLE public.freelancer_assignments
  ADD COLUMN IF NOT EXISTS deal_type text NOT NULL DEFAULT 'fixed';
