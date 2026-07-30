-- ============================================================================
-- Security: close direct anon/authenticated INSERTs on builder A/B events.
--
-- F4 of the anonymous-INSERT scan (2026-07-30) - follow-up to 20260730130000,
-- same vulnerability class, found while closing F1-F3:
--
--   builder_experiment_events - "experiment events public insert" checked only
--   that the referenced experiment belongs to the host's public tenant. No
--   rate limit, no tie to a real page view, and the running-status guard of
--   the ORIGINAL policy (bxe_insert_public + is_experiment_running(), see
--   20260702085900) was lost in the 20260702114108 -> 20260703052115 policy
--   churn. variant/event/visitor_id are fully attacker-controlled and the
--   admin results page COUNT(*)s this table into a two-proportion z-score, so
--   a flood of fabricated exposures/conversions steers which variant "wins".
--
--   Reality check on who could actually write here: the 20260703052115 policy
--   reads builder_experiments in a plain subquery, and anon holds NO grant on
--   that table - so ANONYMOUS inserts have been failing with 42501 ever since
--   (accidentally fail-closed for abuse, and silently dropping every
--   anonymous visitor from A/B stats; the client only logs the error in DEV).
--   The live abuse channel was any AUTHENTICATED session: SELECT on
--   builder_experiments + INSERT grant + a policy that never checks running
--   status meant any logged-in member could fabricate events for any of the
--   public tenant's experiments, running or completed.
--
-- The only writer is now the /api/public/experiment-event beacon route: zod
-- validation, 60 events / 5 min per viewer hash (rate_limit_hit), experiment
-- must exist AND be running (guard restored), and must belong to the tenant
-- of the browsed host (the beacon-side equivalent of public_tenant_id() from
-- the dropped policy). Insert runs as service_role - which also RESTORES
-- event tracking for anonymous visitors. Staff SELECT/DELETE stays untouched
-- (admin results + stats reset).
-- ============================================================================

DROP POLICY IF EXISTS "experiment events public insert" ON public.builder_experiment_events;
-- Legacy name of the same policy (already dropped in 20260708120000; replayed
-- here so a partially-migrated environment cannot keep the hole open).
DROP POLICY IF EXISTS "bxe_insert_public" ON public.builder_experiment_events;
REVOKE INSERT ON public.builder_experiment_events FROM anon, authenticated;
