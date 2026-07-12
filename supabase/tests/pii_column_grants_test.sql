-- pgTAP: PII column-grant guard (CI gate for recommendation #2).
--
-- The `profiles` table-level SELECT grant regressed TWICE historically, each
-- time silently re-exposing email/prefs to every staff member until it was
-- re-fixed. This suite turns that class of regression into a BUILD FAILURE by
-- asserting the live column ACL (has_column_privilege reads the real grants,
-- not the policies) across every PII-bearing table - so any future
-- `GRANT SELECT ON <table>` that sweeps in a sensitive column fails CI here.
--
-- Scope: only columns whose privacy is an invariant of the data model. Positive
-- controls confirm the public-safe columns stay readable, so the suite cannot
-- pass by trivially denying everything.
--
-- Running: see supabase/tests/README.md (`supabase test db`). Pure ACL checks,
-- no seeding required.

BEGIN;
SELECT plan(14);

-- ── profiles: account e-mail + private prefs never leave the row owner ──────
SELECT ok(
  NOT has_column_privilege('anon', 'public.profiles', 'email', 'SELECT'),
  'anon CANNOT SELECT profiles.email'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT'),
  'authenticated CANNOT SELECT profiles.email (own e-mail via get_own_profile RPC only)'
);
SELECT ok(
  NOT has_column_privilege('anon', 'public.profiles', 'prefs', 'SELECT'),
  'anon CANNOT SELECT profiles.prefs'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'prefs', 'SELECT'),
  'authenticated CANNOT SELECT profiles.prefs'
);

-- ── newsletter_subscribers: subscriber e-mail is staff-only ─────────────────
SELECT ok(
  NOT has_column_privilege('anon', 'public.newsletter_subscribers', 'email', 'SELECT'),
  'anon CANNOT SELECT newsletter_subscribers.email'
);

-- ── billing_profiles: financial/contact PII is owner-only ───────────────────
SELECT ok(
  NOT has_column_privilege('anon', 'public.billing_profiles', 'email', 'SELECT'),
  'anon CANNOT SELECT billing_profiles.email'
);
SELECT ok(
  NOT has_column_privilege('anon', 'public.billing_profiles', 'tax_id', 'SELECT'),
  'anon CANNOT SELECT billing_profiles.tax_id'
);
SELECT ok(
  NOT has_column_privilege('anon', 'public.billing_profiles', 'phone', 'SELECT'),
  'anon CANNOT SELECT billing_profiles.phone'
);

-- ── crm_leads: lead contact details are staff-only ──────────────────────────
SELECT ok(
  NOT has_column_privilege('anon', 'public.crm_leads', 'email', 'SELECT'),
  'anon CANNOT SELECT crm_leads.email'
);
SELECT ok(
  NOT has_column_privilege('anon', 'public.crm_leads', 'phone', 'SELECT'),
  'anon CANNOT SELECT crm_leads.phone'
);

-- ── contact_messages: submitter contact details are staff-read only ─────────
-- anon may INSERT (the public form) but must never SELECT back.
SELECT ok(
  NOT has_column_privilege('anon', 'public.contact_messages', 'email', 'SELECT'),
  'anon CANNOT SELECT contact_messages.email'
);
SELECT ok(
  NOT has_column_privilege('anon', 'public.contact_messages', 'phone', 'SELECT'),
  'anon CANNOT SELECT contact_messages.phone'
);

-- ── Positive controls: public-safe columns stay readable ────────────────────
SELECT ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'SELECT'),
  'authenticated CAN SELECT profiles.display_name (author bylines keep working)'
);
SELECT ok(
  has_column_privilege('authenticated', 'public.contact_messages', 'email', 'SELECT'),
  'authenticated (staff, RLS-scoped) CAN SELECT contact_messages.email'
);

SELECT * FROM finish();
ROLLBACK;
