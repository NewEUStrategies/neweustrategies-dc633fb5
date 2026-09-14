-- pgTAP: granica najemcy w dziennikach poczty.
--
-- Klasa błędu: `email_send_log` i `auth_email_events` nie miały kolumny najemcy
-- w ogóle, a RLS mówiła na nich wyłącznie „service_role może wszystko". Panele
-- admina czytają oba dzienniki kluczem serwisowym PO bramce roli - a bramka roli
-- liczy rolę w najemcy WOŁAJĄCEGO i nie mówi nic o tym, czyje są wiersze. Admin
-- jednej organizacji widział więc adresy odbiorców, szablony i błędy dostawcy
-- wszystkich organizacji.
--
-- Ten plik pilnuje trzech rzeczy po stronie bazy (migracja 20260913101000):
--   1. KSZTAŁTU: kolumna `tenant_id` istnieje, jest `uuid`, i ma indeks pod nowy
--      predykat panelu - bez niego filtr degraduje zapytanie do skanu po samym
--      `created_at`, czyli po ruchu całej platformy (asercje 1-6);
--   2. NIETYKALNOŚCI globalnego indeksu unikalności `message_id` - to on, a nie
--      kod aplikacji, chroni przed podwójną wysyłką po wygaśnięciu VT, więc
--      najemcy w nim być NIE MOŻE (asercja 7);
--   3. ZAWĘŻENIA ODCZYTU: anon nadal bez SELECT, admin najemcy A nie czyta
--      wierszy najemcy B ani wierszy bez najemcy, a autor nie czyta nic - bo
--      panele dziennika stoją pod `requireAdmin`, nie pod `requireStaff`
--      (asercje 8-15).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(15);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwaj najemcy, w każdym admin, w najemcy A dodatkowo autor ─────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('3a111111-1111-4111-8111-111111111111', 'mail-a', 'Mail Tenant A', 'a.mail.example'),
  ('3b222222-2222-4222-8222-222222222222', 'mail-b', 'Mail Tenant B', 'b.mail.example');

INSERT INTO auth.users (id, email) VALUES
  ('4a111111-1111-4111-8111-111111111111', 'admin-a@mail.test'),
  ('4b222222-2222-4222-8222-222222222222', 'admin-b@mail.test'),
  ('4c333333-3333-4333-8333-333333333333', 'author-a@mail.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('4a111111-1111-4111-8111-111111111111', 'admin-a@mail.test', 'Admin A',
   '3a111111-1111-4111-8111-111111111111'),
  ('4b222222-2222-4222-8222-222222222222', 'admin-b@mail.test', 'Admin B',
   '3b222222-2222-4222-8222-222222222222'),
  ('4c333333-3333-4333-8333-333333333333', 'author-a@mail.test', 'Author A',
   '3a111111-1111-4111-8111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('4a111111-1111-4111-8111-111111111111', 'admin'::public.app_role,
   '3a111111-1111-4111-8111-111111111111'),
  ('4b222222-2222-4222-8222-222222222222', 'admin'::public.app_role,
   '3b222222-2222-4222-8222-222222222222'),
  ('4c333333-3333-4333-8333-333333333333', 'author'::public.app_role,
   '3a111111-1111-4111-8111-111111111111');

-- Trzy wiersze dziennika wysyłek: własny najemcy A, cudzy najemcy B oraz
-- historyczny bez najemcy - taki, którego kaskada backfillu nie umiała
-- rozstrzygnąć, bo adresu nie ma ani w subskrybentach, ani w profilach.
INSERT INTO public.email_send_log
  (message_id, template_name, recipient_email, status, tenant_id) VALUES
  ('mail-a-1', 'password_reset', 'odbiorca-a@mail.test', 'sent',
   '3a111111-1111-4111-8111-111111111111'),
  ('mail-b-1', 'password_reset', 'odbiorca-b@mail.test', 'sent',
   '3b222222-2222-4222-8222-222222222222'),
  ('mail-stary-1', 'welcome', 'nieznany@mail.test', 'sent', NULL);

INSERT INTO public.auth_email_events
  (message_id, email_type, recipient_domain, subject, tenant_id) VALUES
  ('mail-a-1', 'recovery', 'a.mail.example', 'Reset hasla A',
   '3a111111-1111-4111-8111-111111111111'),
  ('mail-b-1', 'recovery', 'b.mail.example', 'Reset hasla B',
   '3b222222-2222-4222-8222-222222222222');

-- ── 1-2) KSZTAŁT: kolumna najemcy istnieje w obu dziennikach ────────────────
SELECT has_column('public', 'email_send_log', 'tenant_id',
  'email_send_log ma kolumne tenant_id - bez niej panel nie ma po czym filtrowac');

SELECT has_column('public', 'auth_email_events', 'tenant_id',
  'auth_email_events ma kolumne tenant_id - ta sama klasa bledu, ten sam fix');

-- ── 3-4) KSZTAŁT: typ zgodny z public.tenants.id ────────────────────────────
SELECT is(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'email_send_log'
      AND column_name = 'tenant_id'),
  'uuid',
  'email_send_log.tenant_id jest uuid, czyli porownuje sie wprost z current_tenant_id'
);

SELECT is(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'auth_email_events'
      AND column_name = 'tenant_id'),
  'uuid',
  'auth_email_events.tenant_id jest uuid'
);

-- ── 5-6) WYDAJNOŚĆ: indeks pod nowy predykat panelu ─────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'email_send_log'
       AND indexname = 'email_send_log_tenant_created_idx'
  ),
  'indeks tenant_id, created_at DESC na email_send_log istnieje - filtr bez niego skanuje ruch calej platformy'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'auth_email_events'
       AND indexname = 'auth_email_events_tenant_created_idx'
  ),
  'indeks tenant_id, created_at DESC na auth_email_events istnieje'
);

-- ── 7) OCHRONA PRZED PODWÓJNĄ WYSYŁKĄ ZOSTAJE GLOBALNA ──────────────────────
-- Dren kolejki pracuje bez kontekstu użytkownika, a unikalność `message_id`
-- jest jedynym zabezpieczeniem, gdy wygaśnie VT. Wciągnięcie najemcy do tego
-- indeksu pozwoliłoby wysłać tę samą wiadomość dwa razy.
SELECT ok(
  (SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_email_send_log_message_sent_unique')
  NOT LIKE '%tenant_id%',
  'globalny indeks unikalnosci message_id NIE zna najemcy - inaczej ta sama wiadomosc wyszlaby dwa razy'
);

-- ── 8-9) ANON NADAL BEZ DOSTĘPU ────────────────────────────────────────────
SELECT is(
  has_table_privilege('anon', 'public.email_send_log', 'SELECT'),
  false,
  'anon nie czyta dziennika wysylek - dziennik niesie surowe adresy odbiorcow'
);

SELECT is(
  has_table_privilege('anon', 'public.auth_email_events', 'SELECT'),
  false,
  'anon nie czyta dziennika webhooka auth'
);

SET LOCAL ROLE authenticated;

-- ── 10-12) DZIENNIK WYSYŁEK W OCZACH ADMINA NAJEMCY A ──────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"4a111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.email_send_log WHERE message_id = 'mail-a-1'),
  1,
  'legit: admin A czyta wiersz WLASNEGO najemcy - zawezenie nie psuje wlasnej sciezki'
);

SELECT is(
  (SELECT count(*)::int FROM public.email_send_log WHERE message_id = 'mail-b-1'),
  0,
  'regresja: admin A NIE czyta wysylek najemcy B - przed migracja widzial adres odbiorcy'
);

SELECT is(
  (SELECT count(*)::int FROM public.email_send_log WHERE message_id = 'mail-stary-1'),
  0,
  'fail closed: wiersza bez najemcy nie widzi zaden admin - czyta go tylko service_role'
);

-- ── 13-14) DZIENNIK WEBHOOKA AUTH: ta sama granica ─────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.auth_email_events WHERE message_id = 'mail-a-1'),
  1,
  'legit: admin A czyta zdarzenie auth WLASNEGO najemcy'
);

SELECT is(
  (SELECT count(*)::int FROM public.auth_email_events WHERE message_id = 'mail-b-1'),
  0,
  'regresja: admin A NIE czyta zdarzen auth najemcy B - przed migracja widzial domene i temat'
);

-- ── 15) AUTOR NIE JEST ADMINEM ─────────────────────────────────────────────
-- Polityka odwzorowuje bramkę APLIKACJI (`requireAdmin` = admin/super_admin),
-- a nie szerszy wzorzec `is_staff()` z `email_suppressions`: autor treści nie ma
-- wstępu do tych paneli, więc baza nie ma powodu dawać mu wiecej niz aplikacja.
SELECT set_config('request.jwt.claims',
  '{"sub":"4c333333-3333-4333-8333-333333333333","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.email_send_log),
  0,
  'autor najemcy A nie czyta dziennika wysylek - polityka odwzorowuje requireAdmin, nie requireStaff'
);

SELECT * FROM finish();
ROLLBACK;
