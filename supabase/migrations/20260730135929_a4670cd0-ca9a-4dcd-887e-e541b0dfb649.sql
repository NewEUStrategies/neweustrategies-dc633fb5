-- Replay of 20260730130000 + 20260730140000 (PR #108) - merged in code but
-- never applied to this database. All statements are idempotent.

-- F1: contact_messages
DROP POLICY IF EXISTS "Anyone can submit a contact message" ON public.contact_messages;
REVOKE INSERT ON public.contact_messages FROM anon, authenticated;
REVOKE SELECT, UPDATE, DELETE ON public.contact_messages FROM anon;

-- F2: crm_consent_log
DROP POLICY IF EXISTS "Anyone can insert consent log" ON public.crm_consent_log;
REVOKE INSERT ON public.crm_consent_log FROM anon, authenticated;
REVOKE SELECT, UPDATE, DELETE ON public.crm_consent_log FROM anon;

-- F3: related_post_clicks
DROP POLICY IF EXISTS "related_post_clicks public insert" ON public.related_post_clicks;
REVOKE INSERT ON public.related_post_clicks FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.related_post_clicks FROM anon, authenticated;

-- F4: builder_experiment_events
DROP POLICY IF EXISTS "experiment events public insert" ON public.builder_experiment_events;
DROP POLICY IF EXISTS "bxe_insert_public" ON public.builder_experiment_events;
REVOKE INSERT ON public.builder_experiment_events FROM anon, authenticated;
REVOKE UPDATE ON public.builder_experiment_events FROM anon, authenticated;
REVOKE SELECT, DELETE ON public.builder_experiment_events FROM anon;

-- service_role (server routes / triggers) keeps full access on all four.
GRANT ALL ON public.contact_messages TO service_role;
GRANT ALL ON public.crm_consent_log TO service_role;
GRANT ALL ON public.related_post_clicks TO service_role;
GRANT ALL ON public.builder_experiment_events TO service_role;