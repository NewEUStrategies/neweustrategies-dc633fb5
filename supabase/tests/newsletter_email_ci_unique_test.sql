-- pgTAP: newsletter subscriber emails are unique per tenant case-insensitively,
-- so "Foo@x" and "foo@x" can't both subscribe (and get double-sent).
--
-- Verifies migration 20260708160000_newsletter_email_ci_unique.sql. The
-- newsletter_to_lead trigger is disabled for the transaction so the test
-- exercises only the unique index, not CRM side-effects.

BEGIN;
SELECT plan(2);

ALTER TABLE public.newsletter_subscribers DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c3333333-3333-3333-3333-3333333333cc', 'nl-tenant', 'NL Tenant');

INSERT INTO public.newsletter_subscribers (tenant_id, email, status) VALUES
  ('c3333333-3333-3333-3333-3333333333cc', 'reader@x.test', 'subscribed');

SELECT throws_ok(
  $$ INSERT INTO public.newsletter_subscribers (tenant_id, email, status)
     VALUES ('c3333333-3333-3333-3333-3333333333cc', 'READER@x.test', 'pending') $$,
  '23505',
  NULL,
  'a case-variant of an existing email is rejected by the CI unique index'
);

SELECT lives_ok(
  $$ INSERT INTO public.newsletter_subscribers (tenant_id, email, status)
     VALUES ('c3333333-3333-3333-3333-3333333333cc', 'other@x.test', 'subscribed') $$,
  'a genuinely different email is still allowed'
);

SELECT * FROM finish();
ROLLBACK;
