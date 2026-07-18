-- pgTAP: CRM lead scoring (20260718130000).
--
--   1. compute_crm_lead_score liczy sygnaly fit (bez decay) + behawioralne.
--   2. Triggery sygnalowe przeliczaja wynik (contact_form, email open/click).
--   3. Pasma (band) wg progow.
--   4. RLS crm_scoring_settings: izolacja tenantow + admin-write.
--   5. Guard RPC recompute_crm_lead_score: nie-staff dostaje odmowe.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(9);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Dane bazowe: dwa tenanty, admini, lead ──────────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('cc111111-1111-1111-1111-111111111111', 'tenant-sc-a', 'Tenant SC A'),
  ('cc222222-2222-2222-2222-222222222222', 'tenant-sc-b', 'Tenant SC B');

INSERT INTO auth.users (id, email) VALUES
  ('cc000000-0000-0000-0000-0000000000aa', 'admin-a@sc.test'),
  ('cc000000-0000-0000-0000-0000000000bb', 'admin-b@sc.test'),
  ('cc000000-0000-0000-0000-0000000000cc', 'lead-user@sc.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('cc000000-0000-0000-0000-0000000000aa', 'admin-a@sc.test', 'Admin A',
   'cc111111-1111-1111-1111-111111111111'),
  ('cc000000-0000-0000-0000-0000000000bb', 'admin-b@sc.test', 'Admin B',
   'cc222222-2222-2222-2222-222222222222'),
  ('cc000000-0000-0000-0000-0000000000cc', 'lead-user@sc.test', 'Lead User',
   'cc111111-1111-1111-1111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('cc000000-0000-0000-0000-0000000000aa', 'admin', 'cc111111-1111-1111-1111-111111111111'),
  ('cc000000-0000-0000-0000-0000000000bb', 'admin', 'cc222222-2222-2222-2222-222222222222');

-- Lead z pelnym profilem fit: company + position + phone + linkedin + marketing.
-- Trigger tg_score_on_lead_change przeliczy wynik od razu po INSERT.
INSERT INTO public.crm_leads
  (id, tenant_id, email_norm, email, first_name, company, position, phone, linkedin_url, marketing_consent)
VALUES
  ('cc333333-3333-3333-3333-333333333333', 'cc111111-1111-1111-1111-111111111111',
   'lead-user@sc.test', 'lead-user@sc.test', 'Lead',
   'NES', 'Analyst', '+48111222333', 'https://linkedin.com/in/x', true);

-- ── 1. Sygnaly fit: 5 + 4 + 4 + 3 + 3 = 19 ──────────────────────────────────
SELECT is(
  (SELECT score FROM public.crm_leads WHERE id = 'cc333333-3333-3333-3333-333333333333'),
  19,
  'fit signals sum to 19 (marketing 5 + company 4 + position 4 + phone 3 + linkedin 3)'
);

SELECT is(
  (SELECT score_band FROM public.crm_leads WHERE id = 'cc333333-3333-3333-3333-333333333333'),
  'cold',
  '19 < cool_threshold(20) => cold'
);

-- Breakdown zawiera wpis marketing_consent.
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.crm_leads,
      jsonb_array_elements(score_breakdown) e
    WHERE id = 'cc333333-3333-3333-3333-333333333333'
      AND e->>'key' = 'marketing_consent'
  ),
  'breakdown records the marketing_consent signal'
);

-- ── 2. Trigger contact_form: +25 (=> 44, warm od 45? nie, cool od 20) ────────
INSERT INTO public.contact_messages (tenant_id, name, email, message, form_type)
VALUES ('cc111111-1111-1111-1111-111111111111', 'Lead', 'lead-user@sc.test',
        'Zapytanie', 'contact_form');

SELECT cmp_ok(
  (SELECT score FROM public.crm_leads WHERE id = 'cc333333-3333-3333-3333-333333333333'),
  '>=', 44,
  'contact-form submission recomputes score upward (fit 19 + contact_form ~25)'
);

SELECT is(
  (SELECT score_band FROM public.crm_leads WHERE id = 'cc333333-3333-3333-3333-333333333333'),
  'cool',
  'score in [20,45) => cool band'
);

-- ── 3. Email signals via subscriber + campaign event ─────────────────────────
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status, confirmed_at)
VALUES ('cc444444-4444-4444-4444-444444444444', 'cc111111-1111-1111-1111-111111111111',
        'lead-user@sc.test', 'subscribed', now());

-- Potwierdzony subskrybent dodaje newsletter_confirmed (+10) do wyniku leada.
SELECT public.compute_crm_lead_score('cc333333-3333-3333-3333-333333333333');
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.crm_leads,
      jsonb_array_elements(score_breakdown) e
    WHERE id = 'cc333333-3333-3333-3333-333333333333'
      AND e->>'key' = 'newsletter_confirmed'
  ),
  'confirmed subscriber contributes the newsletter_confirmed signal'
);

INSERT INTO public.newsletter_campaigns (id, tenant_id, name, subject_pl, subject_en)
VALUES ('cc555555-5555-5555-5555-555555555555', 'cc111111-1111-1111-1111-111111111111',
        'Kampania SC', 'Temat', 'Subject');

-- Klik w e-mailu -> trigger tg_score_on_campaign_event przelicza lead.
INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind)
VALUES ('cc111111-1111-1111-1111-111111111111', 'cc555555-5555-5555-5555-555555555555',
        'cc444444-4444-4444-4444-444444444444', 'click');

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.crm_leads,
      jsonb_array_elements(score_breakdown) e
    WHERE id = 'cc333333-3333-3333-3333-333333333333'
      AND e->>'key' = 'email_click'
  ),
  'email click recomputes lead and records the email_click signal'
);

-- ── 4. RLS crm_scoring_settings: tenant isolation ────────────────────────────
INSERT INTO public.crm_scoring_settings (tenant_id, hot_threshold, warm_threshold, cool_threshold)
VALUES ('cc111111-1111-1111-1111-111111111111', 90, 50, 25);

SET LOCAL ROLE authenticated;

-- Admin tenanta B nie widzi ustawien tenanta A.
SELECT set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.crm_scoring_settings
    WHERE tenant_id = 'cc111111-1111-1111-1111-111111111111'),
  0,
  'RLS: tenant B admin cannot read tenant A scoring settings'
);

-- ── 5. Guard RPC: nie-staff dostaje odmowe ───────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.recompute_crm_lead_score('cc333333-3333-3333-3333-333333333333') $$,
  '42501',
  NULL,
  'recompute_crm_lead_score denies a non-staff caller'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
