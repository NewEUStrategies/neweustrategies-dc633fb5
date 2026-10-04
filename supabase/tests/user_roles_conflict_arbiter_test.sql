-- pgTAP: arbiter `ON CONFLICT` zapisu roli w `public.user_roles` - cel konfliktu,
-- na którym stoi wysyłka zaproszeń i provisioning zespołu.
--
-- Weryfikuje stan po migracji 20260531181120 (linie 49-50): pierwotne
-- `UNIQUE (user_id, role)` z 20260531180217 (linia 29) zostało tam zdjęte
-- (`DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key`), a jego miejsce zajął
-- indeks `user_roles_unique_per_tenant` na `(tenant_id, user_id, role)`.
--
-- PRZYCZYNA. `performSend` i `provisionTeamMembers`
-- (src/lib/admin/invitations.functions.ts) zapisywały rolę przez
-- `upsert(..., { onConflict: "user_id,role", ignoreDuplicates: true })`, czyli
-- PostgREST wysyłał `INSERT ... ON CONFLICT (user_id, role) DO NOTHING`. Takiemu
-- celowi nie odpowiada od 20260531181120 ŻADEN indeks unikalny, więc Postgres
-- odrzuca instrukcję już przy planowaniu, błędem 42P10 („there is no unique or
-- exclusion constraint matching the ON CONFLICT specification") - niezależnie od
-- danych, także dla zupełnie nowego konta. Od kiedy `performSend` przerywa
-- wysyłkę przy błędzie zapisu roli (`role_write_failed`), wywracała się więc
-- KAŻDA wysyłka zaproszenia - cała funkcja była martwa. W provisioningu wyniku
-- nikt nie czytał, więc konta powstawały bez roli po cichu. Test jednostkowy
-- tego nie widział: baza jest tam atrapą, a jego asercja przez długi czas
-- UTRWALAŁA zły cel. Dopiero prawdziwy Postgres z migracji rozstrzyga, czy cel
-- konfliktu ma arbitra - i to przybija ten plik.
--
-- Weryfikowane własności (zapisy jako `service_role`, tak jak `supabaseAdmin`):
--   1. ARBITER ISTNIEJE. `user_roles` ma ważny, unikalny, nieczęściowy
--      (bez `WHERE`), bezwyrażeniowy i niedeferowalny indeks, którego zbiór
--      kolumn kluczowych to DOKŁADNIE {tenant_id, user_id, role}. Sprawdzamy
--      ZBIÓR, nie nazwę ani kolejność: wnioskowanie arbitra w Postgresie patrzy
--      na zbiór kolumn, więc `"tenant_id,user_id,role"` w aplikacji trafia
--      w indeks `(tenant_id, user_id, role)` w każdej kolejności, a zmiana nazwy
--      indeksu nie psuje aplikacji. Indeks częściowy albo wyrażeniowy NIE byłby
--      arbitrem dla gołej listy kolumn, a deferowalny - błędem przy wnioskowaniu.
--   2. PONOWNA WYSYŁKA JEST IDEMPOTENTNA. Ten sam zapis dwa razy zostawia
--      dokładnie jeden wiersz, a drugi nie rusza pierwszego (ten sam `id`
--      i `created_at` - `DO NOTHING`, nie usunięcie i ponowny wstaw).
--   3. UNIKALNOŚĆ JEST PER NAJEMCA. Ta sama osoba z tą samą rolą w drugim
--      najemcy to osobny wiersz - dokładnie model z 20260531181120.
--   4. STARY CEL NIE MA ARBITRA. `ON CONFLICT (user_id, role)` kończy się 42P10
--      - to jest dosłownie produkcyjna awaria. Jeżeli ta asercja zacznie
--      PRZECHODZIĆ (instrukcja przestanie rzucać), ktoś przywrócił
--      międzynajemcowe `UNIQUE (user_id, role)` - wbrew 20260531181120: wtedy ta
--      sama rola w drugim najemcy łamie unikalność (23505) i pada też punkt 3.
--      Napraw schemat, nie tę asercję.
--
-- Fixture: własne dwa tenanty i jedno konto; triggery `auth.users` wyłączone
-- (jak w pozostałych plikach), więc `handle_new_user` nie dokłada domyślnej
-- roli. Liczności i tak filtrujemy po (tenant, user, rola). Rola `author`
-- odpala `trg_on_expert_role_added` (AFTER INSERT) - celowo, bo to ta sama
-- ścieżka, którą przechodzi zaproszenie autora; w świeżym tenancie trigger
-- nie ma z kim łączyć konta.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(8);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed (jako właściciel; RLS pomijane) ────────────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('c0f1a000-0000-4000-8000-0000000000a1', 'ur-arbiter-a', 'UR Arbiter A'),
  ('c0f1b000-0000-4000-8000-0000000000b1', 'ur-arbiter-b', 'UR Arbiter B');

INSERT INTO auth.users (id, email) VALUES
  ('c0f10000-0000-4000-8000-000000000001', 'invitee@ur-arbiter.test');

-- performSend pisze profil PRZED rolą (triggery profiles/author_profiles/
-- user_roles zależą od kolejności), więc fixture odtwarza ten stan.
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c0f10000-0000-4000-8000-000000000001', 'invitee@ur-arbiter.test', 'Invitee',
   'c0f1a000-0000-4000-8000-0000000000a1');

-- ── (1) Kształt: arbiter (tenant_id, user_id, role) istnieje ────────────────
SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_index i
     WHERE i.indrelid = 'public.user_roles'::regclass
       AND i.indisunique
       AND i.indisvalid
       AND i.indimmediate
       AND i.indpred IS NULL
       AND i.indexprs IS NULL
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
              FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
             WHERE k.ord <= i.indnkeyatts)
           = ARRAY['role', 'tenant_id', 'user_id']
  ),
  'user_roles ma ważny, unikalny, pełny i bezwyrażeniowy indeks na zbiorze {tenant_id, user_id, role} - arbiter celu aplikacji'
);

-- ── (2) Idempotentna ponowna wysyłka (kształt zapisu z PostgREST) ───────────
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES ('c0f10000-0000-4000-8000-000000000001', 'author', 'c0f1a000-0000-4000-8000-0000000000a1')
    ON CONFLICT (tenant_id, user_id, role) DO NOTHING$$,
  'pierwsza wysyłka: zapis roli z celem (tenant_id, user_id, role) przechodzi'
);

RESET ROLE;
CREATE TEMP TABLE ur_first_send ON COMMIT DROP AS
  SELECT id, created_at FROM public.user_roles
   WHERE tenant_id = 'c0f1a000-0000-4000-8000-0000000000a1'
     AND user_id = 'c0f10000-0000-4000-8000-000000000001'
     AND role = 'author';
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES ('c0f10000-0000-4000-8000-000000000001', 'author', 'c0f1a000-0000-4000-8000-0000000000a1')
    ON CONFLICT (tenant_id, user_id, role) DO NOTHING$$,
  'ponowna wysyłka tego samego zaproszenia nie wywraca się na istniejącej roli'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.user_roles
    WHERE tenant_id = 'c0f1a000-0000-4000-8000-0000000000a1'
      AND user_id = 'c0f10000-0000-4000-8000-000000000001'
      AND role = 'author'),
  1,
  'dwa zapisy tej samej trójki zostawiają dokładnie jeden wiersz'
);

-- Złączenie, nie porównanie zbiorów: dwa PUSTE zbiory są sobie równe, więc
-- `results_eq` przechodziłby także wtedy, gdy pierwsza wysyłka nic nie zapisała.
SELECT is(
  (SELECT count(*)::int
     FROM public.user_roles r
     JOIN ur_first_send s USING (id, created_at)
    WHERE r.tenant_id = 'c0f1a000-0000-4000-8000-0000000000a1'
      AND r.user_id = 'c0f10000-0000-4000-8000-000000000001'
      AND r.role = 'author'),
  1,
  'ponowna wysyłka nie rusza istniejącego wiersza - ten sam id i created_at co po pierwszej'
);

-- ── (3) Unikalność per najemca ──────────────────────────────────────────────
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES ('c0f10000-0000-4000-8000-000000000001', 'author', 'c0f1b000-0000-4000-8000-0000000000b1')
    ON CONFLICT (tenant_id, user_id, role) DO NOTHING$$,
  'ta sama osoba i rola w drugim najemcy: zapis przechodzi'
);

RESET ROLE;

SELECT is(
  (SELECT array_agg(tenant_id ORDER BY tenant_id) FROM public.user_roles
    WHERE user_id = 'c0f10000-0000-4000-8000-000000000001'
      AND role = 'author'),
  ARRAY['c0f1a000-0000-4000-8000-0000000000a1',
        'c0f1b000-0000-4000-8000-0000000000b1']::uuid[],
  'para (user_id, role) ma osobny wiersz w każdym najemcy - unikalność jest per najemca'
);

-- ── (4) Stary cel (user_id, role) nie ma arbitra: 42P10 ─────────────────────
-- Gdy to zacznie przechodzić, wróciło międzynajemcowe UNIQUE (user_id, role)
-- wbrew 20260531181120 - patrz nagłówek, punkt 4.
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES ('c0f10000-0000-4000-8000-000000000001', 'author', 'c0f1a000-0000-4000-8000-0000000000a1')
    ON CONFLICT (user_id, role) DO NOTHING$$,
  '42P10',
  'there is no unique or exclusion constraint matching the ON CONFLICT specification',
  'stary cel (user_id, role) nie ma indeksu unikalnego - dokładnie produkcyjna awaria każdej wysyłki'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
