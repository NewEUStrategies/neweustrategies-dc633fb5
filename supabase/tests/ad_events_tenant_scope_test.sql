-- pgTAP: zakres najemcy dla warstwy reklamowej (ad_slots / ad_placements / ad_events).
--
-- PO CO TEN PLIK. Do dziś te trzy tabele miały dowód zakresu najemcy WYŁĄCZNIE
-- jako element ogólnych testów izolacji (`tenant_isolation_three_tenants_test`,
-- `security_definer_tenant_scope_test`) - żaden plik nie pilnował ich wprost.
-- A historia tych polityk mówi, że pilnować trzeba: migracja zakładająca tabele
-- (20260624165807) dała publiczny odczyt BEZ KLAUZULI NAJEMCY -
-- `USING (status = 'active')` dla slotów i `USING (active = true AND okno)` dla
-- placementów. Klauzulę `tenant_id = public_tenant_id()` dopisała dopiero
-- migracja 20260703052115. Nic nie chroni tej poprawki przed cofnięciem, a jej
-- utrata znaczy: czytelnik jednej redakcji dostaje kreacje drugiej, wraz
-- z zawartością kolumny `script` obcego najemcy.
--
-- Dlatego plik łączy DWA rodzaje dowodu:
--   1. KANARKI STRUKTURALNE na `pg_policies.qual` - klauzula najemcy MUSI być
--      w treści polityki. Sam test behawioralny by nie wystarczył: przy jednym
--      najemcy w bazie testowej „nie widzę cudzego" jest prawdą także wtedy,
--      gdy filtra nie ma.
--   2. DOWODY BEHAWIORALNE na dwóch najemcach z osobnymi domenami.
--
-- Dodatkowo pilnuje, że `ad_events` jest tabelą TYLKO-DO-ODCZYTU dla klienta:
-- zapis idzie wyłącznie przez service role (beacon /api/public/ad-event), więc
-- brak grantu INSERT dla `authenticated` jest tu warunkiem wiarygodności
-- raportu przychodu - inaczej dowolny zalogowany dopisywałby impresje.
--
-- Uruchamianie: `supabase test db` (albo `bun run test:pgtap-local`).

BEGIN;
SELECT plan(25);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwaj najemcy z własnymi domenami ─────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('a1111111-1111-1111-1111-1111111111a1', 'ads-a', 'Ads Tenant A', 'ads-a.example'),
  ('a2222222-2222-2222-2222-2222222222a2', 'ads-b', 'Ads Tenant B', 'ads-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'admin-a@example.com'),
  ('a0000000-0000-0000-0000-0000000000a2', 'editor-a@example.com'),
  ('a0000000-0000-0000-0000-0000000000a3', 'reader-a@example.com'),
  ('a0000000-0000-0000-0000-0000000000b1', 'admin-b@example.com');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'admin-a@example.com', 'Admin A',
   'a1111111-1111-1111-1111-1111111111a1'),
  ('a0000000-0000-0000-0000-0000000000a2', 'editor-a@example.com', 'Editor A',
   'a1111111-1111-1111-1111-1111111111a1'),
  ('a0000000-0000-0000-0000-0000000000a3', 'reader-a@example.com', 'Reader A',
   'a1111111-1111-1111-1111-1111111111a1'),
  ('a0000000-0000-0000-0000-0000000000b1', 'admin-b@example.com', 'Admin B',
   'a2222222-2222-2222-2222-2222222222a2');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'admin',  'a1111111-1111-1111-1111-1111111111a1'),
  ('a0000000-0000-0000-0000-0000000000a2', 'editor', 'a1111111-1111-1111-1111-1111111111a1'),
  ('a0000000-0000-0000-0000-0000000000b1', 'admin',  'a2222222-2222-2222-2222-2222222222a2');

-- Slot aktywny w A, slot WSTRZYMANY w A, slot aktywny w B.
-- `script` jest tu nie bez powodu: to on jest realną stawką wycieku.
INSERT INTO public.ad_slots (id, tenant_id, name, kind, status, script, requires_consent) VALUES
  ('a5100000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-1111111111a1',
   'Baner A', 'script', 'active', '<script>sekret_a()</script>', true),
  ('a5100000-0000-0000-0000-0000000000a2', 'a1111111-1111-1111-1111-1111111111a1',
   'Baner A wstrzymany', 'script', 'paused', '<script>pauza_a()</script>', true),
  ('a5100000-0000-0000-0000-0000000000b1', 'a2222222-2222-2222-2222-2222222222a2',
   'Baner B', 'script', 'active', '<script>sekret_b()</script>', true);

-- Placement aktywny w A, placement WYGASŁY w A, placement aktywny w B.
INSERT INTO public.ad_placements
  (id, tenant_id, slot_id, position, page_type, active, starts_at, ends_at)
VALUES
  ('a9100000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-1111111111a1',
   'a5100000-0000-0000-0000-0000000000a1', 'sidebar', 'all', true, NULL, NULL),
  ('a9100000-0000-0000-0000-0000000000a9', 'a1111111-1111-1111-1111-1111111111a1',
   'a5100000-0000-0000-0000-0000000000a1', 'mid_post', 'all', true,
   now() - interval '30 days', now() - interval '1 day'),
  ('a9100000-0000-0000-0000-0000000000b1', 'a2222222-2222-2222-2222-2222222222a2',
   'a5100000-0000-0000-0000-0000000000b1', 'sidebar', 'all', true, NULL, NULL);

-- Zdarzenia: po jednym w każdym najemcy (zapis jak z beaconu - service role).
INSERT INTO public.ad_events (id, tenant_id, slot_id, placement_id, kind, path) VALUES
  ('ae100000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-1111111111a1',
   'a5100000-0000-0000-0000-0000000000a1', 'a9100000-0000-0000-0000-0000000000a1',
   'impression', '/artykul/a'),
  ('ae100000-0000-0000-0000-0000000000b1', 'a2222222-2222-2222-2222-2222222222a2',
   'a5100000-0000-0000-0000-0000000000b1', 'a9100000-0000-0000-0000-0000000000b1',
   'click', '/artykul/b');

-- ═══════════════════════════════════════════════════════════════════════════
-- (1) KANARKI STRUKTURALNE: klauzula najemcy musi BYĆ w treści polityki
-- ═══════════════════════════════════════════════════════════════════════════

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_slots'
      AND policyname = 'Public can read active ad_slots') ~ 'public_tenant_id',
  'ad_slots: publiczny odczyt WIĄŻE się z najemcą (klauzula dopisana w 20260703052115)'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_placements'
      AND policyname = 'Public can read active ad_placements') ~ 'public_tenant_id',
  'ad_placements: publiczny odczyt WIĄŻE się z najemcą'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_events'
      AND policyname = 'ad_events_staff_select') ~ 'current_tenant_id',
  'ad_events: odczyt raportowy WIĄŻE się z aktywnym najemcą czytającego'
);

-- Kanarek w drugą stronę: publiczny odczyt slotów nadal filtruje po statusie.
-- Bez tego wstrzymana kreacja wracałaby na stronę.
SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ad_slots'
      AND policyname = 'Public can read active ad_slots') ~ 'status',
  'ad_slots: publiczny odczyt nadal filtruje po statusie kreacji'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (2) UPRAWNIENIA TABELOWE: ad_events jest tylko-do-odczytu dla klienta
-- ═══════════════════════════════════════════════════════════════════════════

SELECT ok(
  NOT has_table_privilege('anon', 'public.ad_events', 'SELECT'),
  'ad_events: anon NIE MA prawa odczytu - raport przychodu nie jest publiczny'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.ad_events', 'INSERT'),
  'ad_events: authenticated NIE MA prawa zapisu - impresje wpisuje tylko service role'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.ad_events', 'UPDATE'),
  'ad_events: authenticated NIE MA prawa modyfikacji zdarzeń'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.ad_events', 'DELETE'),
  'ad_events: authenticated NIE MA prawa usuwania zdarzeń (raport jest nieusuwalny)'
);

SELECT ok(
  has_table_privilege('anon', 'public.ad_slots', 'SELECT'),
  'ad_slots: anon MA prawo odczytu - kreacje muszą dojść do niezalogowanego czytelnika'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (3) ANON NA DOMENIE A: widzi swoje kreacje, nie widzi cudzych ani wstrzymanych
-- ═══════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"ads-a.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.ad_slots
    WHERE id = 'a5100000-0000-0000-0000-0000000000a1'),
  1,
  'anon na domenie A: widzi AKTYWNY slot najemcy A'
);

SELECT is(
  (SELECT count(*)::int FROM public.ad_slots
    WHERE id = 'a5100000-0000-0000-0000-0000000000b1'),
  0,
  'anon na domenie A: NIE widzi slotu najemcy B (razem z jego kolumną script)'
);

SELECT is(
  (SELECT count(*)::int FROM public.ad_slots
    WHERE id = 'a5100000-0000-0000-0000-0000000000a2'),
  0,
  'anon na domenie A: NIE widzi WSTRZYMANEGO slotu własnego najemcy'
);

SELECT is(
  (SELECT count(*)::int FROM public.ad_placements
    WHERE id = 'a9100000-0000-0000-0000-0000000000a1'),
  1,
  'anon na domenie A: widzi aktywny placement najemcy A'
);

SELECT is(
  (SELECT count(*)::int FROM public.ad_placements
    WHERE id = 'a9100000-0000-0000-0000-0000000000b1'),
  0,
  'anon na domenie A: NIE widzi placementu najemcy B'
);

SELECT is(
  (SELECT count(*)::int FROM public.ad_placements
    WHERE id = 'a9100000-0000-0000-0000-0000000000a9'),
  0,
  'anon na domenie A: NIE widzi WYGASŁEGO placementu (okno emisji egzekwowane w RLS)'
);

-- Symetria domen: to samo z drugiej strony. Bez tego testu „nie widzę cudzego"
-- mogłoby wynikać z tego, że polityka nie oddaje NICZEGO.
SELECT set_config('request.headers', '{"x-tenant-host":"ads-b.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.ad_slots
    WHERE id = 'a5100000-0000-0000-0000-0000000000b1'),
  1,
  'anon na domenie B: widzi slot najemcy B (symetria - polityka nie jest głucha)'
);

SELECT is(
  (SELECT count(*)::int FROM public.ad_slots
    WHERE id = 'a5100000-0000-0000-0000-0000000000a1'),
  0,
  'anon na domenie B: NIE widzi slotu najemcy A'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (4) ODCZYT RAPORTOWY ad_events: rola I najemca
-- ═══════════════════════════════════════════════════════════════════════════

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.ad_events
    WHERE id = 'ae100000-0000-0000-0000-0000000000a1'),
  1,
  'admin najemcy A: widzi zdarzenie własnego najemcy'
);

SELECT is(
  (SELECT count(*)::int FROM public.ad_events
    WHERE id = 'ae100000-0000-0000-0000-0000000000b1'),
  0,
  'admin najemcy A: NIE widzi zdarzenia najemcy B - raport przychodu nie przecieka'
);

-- Redaktor: polityka dopuszcza `admin OR editor`, bo raport reklamowy jest
-- narzędziem redakcyjnym, nie tylko właścicielskim.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.ad_events
    WHERE id = 'ae100000-0000-0000-0000-0000000000a1'),
  1,
  'editor najemcy A: widzi zdarzenia własnego najemcy (polityka dopuszcza editor)'
);

-- Zalogowany BEZ roli sztabowej: zero. To najważniejsza z tych czterech
-- asercji - zwykły czytelnik z kontem nie ma wglądu w metryki reklamowe.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.ad_events),
  0,
  'zalogowany BEZ roli sztabowej: nie widzi ŻADNEGO zdarzenia reklamowego'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.ad_events
    WHERE id = 'ae100000-0000-0000-0000-0000000000b1'),
  1,
  'admin najemcy B: widzi WYŁĄCZNIE swoje zdarzenie (symetria)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (5) OGRANICZENIA KOLUMNOWE ad_events
-- ═══════════════════════════════════════════════════════════════════════════

RESET ROLE;

-- `kind` poza dwoma wartościami rozsypałby raport na zawsze: wiersz, którego
-- panel nie umie policzyć, zostaje w tabeli.
SELECT throws_ok(
  $$INSERT INTO public.ad_events (tenant_id, slot_id, kind)
    VALUES ('a1111111-1111-1111-1111-1111111111a1',
            'a5100000-0000-0000-0000-0000000000a1', 'hover')$$,
  '23514',
  NULL,
  'ad_events: CHECK na `kind` odrzuca rodzaj spoza impression/click'
);

SELECT lives_ok(
  $$INSERT INTO public.ad_events (tenant_id, slot_id, kind)
    VALUES ('a1111111-1111-1111-1111-1111111111a1',
            'a5100000-0000-0000-0000-0000000000a1', 'click')$$,
  'ad_events: `click` jest przyjmowany (kanarek - CHECK nie jest zbyt ciasny)'
);

-- Zdarzenie dla nieistniejącego slotu nie może osiąść w tabeli: raport
-- liczyłby impresje kreacji, której nigdy nie było.
SELECT throws_ok(
  $$INSERT INTO public.ad_events (tenant_id, slot_id, kind)
    VALUES ('a1111111-1111-1111-1111-1111111111a1',
            'a5100000-0000-0000-0000-000000000999', 'impression')$$,
  '23503',
  NULL,
  'ad_events: klucz obcy odrzuca zdarzenie dla nieistniejącego slotu'
);

SELECT * FROM finish();
ROLLBACK;
