-- pgTAP: rejestr darowizn - zakres najemcy i nieujawnianie danych darczyńcy.
--
-- PO CO. Darowizny nie miały ANI JEDNEGO dedykowanego pliku pgTAP, mimo że
-- `public.donations` jest jedyną tabelą w repozytorium, która trzyma
-- `donor_email` osoby, która NIE MUSI mieć konta (darczyńca może być anonimowy -
-- to jest wprost zapisane w migracji 20260714111000). Tabela jest przy tym
-- księgą pieniędzy: publiczny licznik „zebrano X zł" liczy się z jej wierszy.
--
-- Dwie rzeczy są tu warte dowodu i obie są nieoczywiste:
--
--   1. ZAPIS JEST WYŁĄCZNIE SERWEROWY. Nie ma grantu INSERT ani UPDATE dla
--      `authenticated`, a RLS nie ma polityki zapisu w ogóle. Darowizna
--      powstaje tylko z webhooka operatora płatności albo z finalizacji trybu
--      mock - obie ścieżki idą service role. Gdyby grant się pojawił, dowolny
--      zalogowany dopisałby sobie wpłatę i podniósł publiczny licznik zbiórki.
--
--   2. ODCZYT MA DWIE POLITYKI, OBIE Z KLAUZULĄ NAJEMCY.
--        * `donations admin read` - tenant + rola `admin` (NIE editor),
--        * `donations own read`   - tenant + `user_id = auth.uid()`.
--      Suma tych dwóch znaczy: redaktor nie widzi wpłat, a darczyńca widzi
--      WYŁĄCZNIE swoje. Wersja z `has_role(...,'editor')` albo bez klauzuli
--      najemcy oddawałaby adresy e-mail darczyńców cudzej redakcji.
--
-- UWAGA O PUBLICZNYCH STATYSTYKACH. `getDonationsPublicStats` nie jest ani
-- widokiem, ani RPC - agreguje wiersze w TypeScripcie przez klient service role
-- (`src/lib/billing/donations.functions.ts`). Do klienta jadą więc wyłącznie
-- sumy i liczniki; `donor_email` nie ma jak wyjść tą drogą. Dlatego dowód
-- „statystyki nie ujawniają darczyńcy" jest tu postawiony na warstwie, która
-- naprawdę o tym decyduje: na BRAKU dostępu do tabeli dla anon i dla
-- zalogowanego bez roli.
--
-- Uruchamianie: `supabase test db` (albo `bun run test:pgtap-local`).

BEGIN;
SELECT plan(22);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwaj najemcy, w każdym po jednej wpłacie ─────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('d1111111-1111-1111-1111-1111111111d1', 'don-a', 'Donations Tenant A', 'don-a.example'),
  ('d2222222-2222-2222-2222-2222222222d2', 'don-b', 'Donations Tenant B', 'don-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'admin-a@example.com'),
  ('d0000000-0000-0000-0000-0000000000a2', 'editor-a@example.com'),
  ('d0000000-0000-0000-0000-0000000000a3', 'darczynca-a@example.com'),
  ('d0000000-0000-0000-0000-0000000000a4', 'obcy-a@example.com'),
  ('d0000000-0000-0000-0000-0000000000b1', 'admin-b@example.com');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'admin-a@example.com', 'Admin A',
   'd1111111-1111-1111-1111-1111111111d1'),
  ('d0000000-0000-0000-0000-0000000000a2', 'editor-a@example.com', 'Editor A',
   'd1111111-1111-1111-1111-1111111111d1'),
  ('d0000000-0000-0000-0000-0000000000a3', 'darczynca-a@example.com', 'Darczynca A',
   'd1111111-1111-1111-1111-1111111111d1'),
  ('d0000000-0000-0000-0000-0000000000a4', 'obcy-a@example.com', 'Obcy A',
   'd1111111-1111-1111-1111-1111111111d1'),
  ('d0000000-0000-0000-0000-0000000000b1', 'admin-b@example.com', 'Admin B',
   'd2222222-2222-2222-2222-2222222222d2');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'admin',  'd1111111-1111-1111-1111-1111111111d1'),
  ('d0000000-0000-0000-0000-0000000000a2', 'editor', 'd1111111-1111-1111-1111-1111111111d1'),
  ('d0000000-0000-0000-0000-0000000000b1', 'admin',  'd2222222-2222-2222-2222-2222222222d2');

-- Trzy wpłaty: powiązana z kontem w A, ANONIMOWA w A, powiązana z kontem w B.
INSERT INTO public.donations
  (id, tenant_id, user_id, provider_session_id, amount_cents, currency, donor_email, status)
VALUES
  ('dd000000-0000-0000-0000-0000000000a1', 'd1111111-1111-1111-1111-1111111111d1',
   'd0000000-0000-0000-0000-0000000000a3', 'sess_a_konto', 5000, 'PLN',
   'darczynca-a@example.com', 'paid'),
  ('dd000000-0000-0000-0000-0000000000a2', 'd1111111-1111-1111-1111-1111111111d1',
   NULL, 'sess_a_anonim', 12000, 'PLN', 'anonim-a@example.org', 'paid'),
  ('dd000000-0000-0000-0000-0000000000b1', 'd2222222-2222-2222-2222-2222222222d2',
   NULL, 'sess_b_anonim', 7500, 'EUR', 'anonim-b@example.org', 'paid');

-- ═══════════════════════════════════════════════════════════════════════════
-- (1) KANARKI STRUKTURALNE: obie polityki odczytu wiążą się z najemcą
-- ═══════════════════════════════════════════════════════════════════════════

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'donations'
      AND policyname = 'donations admin read') ~ 'current_tenant_id',
  'donations admin read: WIĄŻE się z aktywnym najemcą'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'donations'
      AND policyname = 'donations own read') ~ 'current_tenant_id',
  'donations own read: WIĄŻE się z aktywnym najemcą (nie tylko z user_id)'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'donations'
      AND policyname = 'donations admin read') ~ 'admin',
  'donations admin read: wymaga roli `admin`, a nie samego zalogowania'
);

-- Kanarek NIEOBECNOŚCI: gdyby ktoś rozluźnił politykę do `editor`, redaktor
-- zaczął by widzieć e-maile darczyńców. Ten test celowo pilnuje, że tego NIE MA.
SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'donations'
      AND policyname = 'donations admin read') !~ 'editor',
  'donations admin read: NIE dopuszcza roli `editor` - rejestr wpłat jest węższy niż reszta panelu'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'donations' AND cmd <> 'SELECT'),
  0,
  'donations: ZERO polityk zapisu - wpłatę tworzy wyłącznie service role'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (2) UPRAWNIENIA TABELOWE
-- ═══════════════════════════════════════════════════════════════════════════

SELECT ok(
  NOT has_table_privilege('anon', 'public.donations', 'SELECT'),
  'donations: anon NIE MA prawa odczytu - rejestr wpłat nie jest publiczny'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.donations', 'INSERT'),
  'donations: authenticated NIE MA prawa zapisu - nikt nie dopisze sobie wpłaty'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.donations', 'UPDATE'),
  'donations: authenticated NIE MA prawa modyfikacji (nie zmieni kwoty ani statusu)'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.donations', 'DELETE'),
  'donations: authenticated NIE MA prawa usuwania - księga jest nieusuwalna'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (3) ODCZYT: admin swojego najemcy, i tylko swojego
-- ═══════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.donations
    WHERE tenant_id = 'd1111111-1111-1111-1111-1111111111d1'),
  2,
  'admin A: widzi OBIE wpłaty własnego najemcy (także anonimową)'
);

SELECT is(
  (SELECT count(*)::int FROM public.donations
    WHERE id = 'dd000000-0000-0000-0000-0000000000b1'),
  0,
  'admin A: NIE widzi wpłaty najemcy B - księga nie przecieka między redakcjami'
);

SELECT is(
  (SELECT donor_email FROM public.donations
    WHERE id = 'dd000000-0000-0000-0000-0000000000a2'),
  'anonim-a@example.org',
  'admin A: widzi e-mail darczyńcy WŁASNEGO najemcy (to jego uprawniony dostęp)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (4) REDAKTOR NIE WIDZI WPŁAT
-- ═══════════════════════════════════════════════════════════════════════════

SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.donations),
  0,
  'editor A: NIE widzi ŻADNEJ wpłaty - w tym żadnego adresu e-mail darczyńcy'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (5) DARCZYŃCA WIDZI WYŁĄCZNIE SWOJE
-- ═══════════════════════════════════════════════════════════════════════════

SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.donations
    WHERE id = 'dd000000-0000-0000-0000-0000000000a1'),
  1,
  'darczyńca: widzi WŁASNĄ wpłatę (potwierdzenie w historii konta)'
);

SELECT is(
  (SELECT count(*)::int FROM public.donations
    WHERE id = 'dd000000-0000-0000-0000-0000000000a2'),
  0,
  'darczyńca: NIE widzi cudzej wpłaty w tym samym najemcy'
);

SELECT is(
  (SELECT count(*)::int FROM public.donations),
  1,
  'darczyńca: widzi DOKŁADNIE jeden wiersz - swój'
);

-- Zalogowany bez roli i bez wpłaty: zero. To stan zwykłego czytelnika z kontem.
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.donations),
  0,
  'zalogowany bez roli i bez wpłaty: nie widzi nic'
);

-- Symetria: admin B widzi tylko swoje.
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.donations),
  1,
  'admin B: widzi WYŁĄCZNIE wpłatę własnego najemcy (symetria - polityka nie jest głucha)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (6) OGRANICZENIA KSIĘGI
-- ═══════════════════════════════════════════════════════════════════════════

RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO public.donations
      (tenant_id, provider_session_id, amount_cents, currency)
    VALUES ('d1111111-1111-1111-1111-1111111111d1', 'sess_zero', 0, 'PLN')$$,
  '23514',
  NULL,
  'amount_cents = 0 ODRZUCONE - wpłata zerowa zawyżałaby licznik darczyńców'
);

-- UWAGA NA STAN FAKTYCZNY. Migracja zakładająca tabelę (20260714111000) miała
-- `CHECK (status IN ('paid','refunded'))`, ale późniejsza migracja darowizn
-- cyklicznych rozszerzyła zbiór do pięciu wartości:
--   pending / paid / refunded / failed / canceled.
-- Asercja czyta więc DZISIEJSZY constraint, a nie pierwotny - `pending` jest
-- dziś wartością POPRAWNĄ (wpłata zainicjowana, jeszcze nieopłacona).
SELECT lives_ok(
  $$INSERT INTO public.donations
      (tenant_id, provider_session_id, amount_cents, currency, status)
    VALUES ('d1111111-1111-1111-1111-1111111111d1', 'sess_pending', 1000, 'PLN', 'pending')$$,
  '`pending` PRZYJĘTE - zbiór statusów rozszerzono przy darowiznach cyklicznych'
);

SELECT throws_ok(
  $$INSERT INTO public.donations
      (tenant_id, provider_session_id, amount_cents, currency, status)
    VALUES ('d1111111-1111-1111-1111-1111111111d1', 'sess_bad_status', 1000, 'PLN', 'zwrocone')$$,
  '23514',
  NULL,
  'status spoza pięciu znanych wartości ODRZUCONY - raport nie umie policzyć obcego stanu'
);

-- Idempotencja webhooka: ponowna dostawa tej samej sesji NIE MOŻE zdublować
-- wpłaty. Bez tego jedna retransmisja podnosiłaby zebraną kwotę dwukrotnie.
SELECT throws_ok(
  $$INSERT INTO public.donations
      (tenant_id, provider_session_id, amount_cents, currency)
    VALUES ('d1111111-1111-1111-1111-1111111111d1', 'sess_a_konto', 5000, 'PLN')$$,
  '23505',
  NULL,
  'ten sam `provider_session_id` ODRZUCONY - ponowna dostawa webhooka nie dubluje wpłaty'
);

SELECT * FROM finish();
ROLLBACK;
