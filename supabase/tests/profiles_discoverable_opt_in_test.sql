-- pgTAP: profiles.discoverable jest zgodą wyrażoną WPROST - konto, które nigdy
-- nie zdecydowało, zostaje niewidoczne.
--
-- Weryfikuje migrację 20260913090000_profiles_discoverable_opt_in_restore.sql.
--
-- PO CO TO STOI. Regresja, którą ten test zamyka, przeszła DRUGIM pasem migracji:
-- drizzle/migrations/0001_profiles_discoverable_default_true.sql przestawiło
-- DEFAULT na true i przepisało wszystkie wiersze, a baza pgTAP powstaje wyłącznie
-- z supabase/migrations, więc żaden test tego nie widział. Bramka
-- src/lib/ci/__tests__/migrationLaneParity.test.ts pilnuje teraz samych pasów;
-- ten test pilnuje SKUTKU w zbudowanej bazie, niezależnie od tego, którym pasem
-- ktoś spróbuje go zmienić.
--
-- Na tym DEFAULT stoi argument prawny listy uczestników (20260826182500:19),
-- bo handle_new_user() nie wymienia tej kolumny - każda rejestracja bierze DEFAULT.

BEGIN;
SELECT plan(3);

SELECT col_default_is(
  'public', 'profiles', 'discoverable', 'false',
  'profiles.discoverable ma DEFAULT false - kto nie zdecydował, jest niewidoczny'
);

SELECT col_not_null(
  'public', 'profiles', 'discoverable',
  'profiles.discoverable jest NOT NULL - nie ma stanu "nie wiadomo"'
);

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d4444444-4444-4444-4444-4444444444dd', 'opt-in-tenant', 'Opt-in Tenant');

INSERT INTO auth.users (id, email) VALUES
  ('d4444444-0000-4444-0000-4444444444dd', 'nowy@x.test');

-- Wiersz zakładany BEZ wymienienia kolumny - dokładnie tak, jak robi to
-- handle_new_user() przy każdej rejestracji.
INSERT INTO public.profiles (id, tenant_id, email) VALUES
  ('d4444444-0000-4444-0000-4444444444dd', 'd4444444-4444-4444-4444-4444444444dd', 'nowy@x.test');

SELECT is(
  (SELECT discoverable FROM public.profiles
    WHERE id = 'd4444444-0000-4444-0000-4444444444dd'),
  false,
  'świeża rejestracja NIE trafia do katalogu osób, dopóki sama się nie zgłosi'
);

SELECT * FROM finish();
ROLLBACK;
