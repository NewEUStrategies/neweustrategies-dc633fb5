-- ============================================================================
-- pgTAP: Discussion Club, etap A4 - interakcja.
--
-- Dwie rzeczy pilnowane tu najmocniej:
--   1. ROZLACZNOSC agree/disagree. UNIQUE (target, user, kind) sam z siebie
--      pozwala tej samej osobie postawic oba naraz - blokuje to trigger,
--      i to przez PODMIANE, nie przez blad.
--   2. KONTRAKT POWIADOMIEN. enqueue_notification cicho zwraca NULL, gdy
--      brakuje ktorejkolwiek z trzech zmian (CHECK, kolumna preferencji,
--      galaz CASE). Cichy producent wyglada na dzialajacy - stad te asercje.
--
-- ROLA BAZY W FIKSTURACH (2026-08-12). Adminowe RPC (`admin_club_*`) wolamy
-- rola WLASCICIELA, nie `authenticated`. Sa SECURITY DEFINER i rozstrzygaja
-- tenanta oraz tozsamosc z JWT (`request.jwt.claims`), nie z roli bazy -
-- przedmiotem tych wywolan jest zachowanie FUNKCJI, a przelaczanie roli bylo
-- w nich infrastruktura fikstury, ktora w CI przewracala plik na pierwszym
-- wywolaniu RPC po `SET LOCAL ROLE authenticated`. Kontrakt grantu EXECUTE,
-- dotad sprawdzany NIEJAWNIE przez samo wywolanie w roli klienta, jest teraz
-- przybity osobna asercja `has_function_privilege`.
-- Pod rola klienta zostaja wszystkie sciezki uzytkownika - `club_create_thread`,
-- `club_react`, `club_set_stance` - bo tam pytamy, co wolno wolajacemu.
-- ============================================================================
BEGIN;
SELECT plan(18);

-- `handle_new_user` zalozylby profil w tenancie DOMYSLNYM, a
-- `profiles_pin_tenant_id` nie pozwala go potem przeniesc (tenant konta jest
-- niezmienny poza sciezka service_role). Profil musi wiec powstac od razu
-- w docelowym tenancie - z wylaczonym triggerem signupu i wprost.
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a-int-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@int.local'),
       ('aaaaaaaa-0000-0000-0000-000000000003', 'member@int.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Admin', true),
       ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Czlonek', true);

-- Rola jest wazna W TENANCIE (has_role porownuje tenant_id z tenantem
-- wolajacego), wiec fixture musi podac tenanta wprost.
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin', '11111111-1111-1111-1111-111111111111');

-- ----------------------------------------------------------------------------
-- Kontrakt powiadomien: WSZYSTKIE TRZY zmiany, inaczej producent jest cichy
-- ----------------------------------------------------------------------------
SELECT has_column('public', 'notification_preferences', 'enabled_club',
  'notification_preferences ma kolumne enabled_club');

SELECT ok(
  (SELECT pg_get_constraintdef(oid) LIKE '%''club''%'
     FROM pg_constraint WHERE conname = 'notifications_kind_check'),
  'notifications_kind_check dopuszcza rodzaj club'
);

SELECT ok(
  (SELECT position('enabled_club' IN pg_get_functiondef(p.oid)) > 0
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='enqueue_notification' LIMIT 1),
  'enqueue_notification zna galaz preferencji dla rodzaju club'
);

-- ----------------------------------------------------------------------------
-- Struktura
-- ----------------------------------------------------------------------------
SELECT has_table('public','club_reactions','tabela club_reactions istnieje');
SELECT has_table('public','club_stances','tabela club_stances istnieje');
SELECT has_table('public','club_thread_subscriptions','tabela subskrypcji istnieje');

SELECT is_empty(
  $$ SELECT table_name FROM information_schema.role_table_grants
      WHERE table_schema='public'
        AND table_name IN ('club_reactions','club_stances','club_thread_subscriptions')
        AND grantee IN ('anon','authenticated') $$,
  'tabele interakcji nie maja grantow dla klienta'
);

-- ----------------------------------------------------------------------------
-- Grant EXECUTE dla klienta na adminowym RPC - asercja WPROST
--
-- Dotad ten kontrakt wychodzil ubocznie z tego, ze fikstura wolala te funkcje
-- pod rola `authenticated`. Pokrycie bylo przypadkowe i bezimienne; teraz ma
-- wlasna asercje.
-- ----------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_club_upsert(jsonb)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_upsert(jsonb)'
);

-- ----------------------------------------------------------------------------
-- Fixture tresci
-- ----------------------------------------------------------------------------
-- Podzial rol: adminowe RPC i odczyty tabel modulu ida rola WLASCICIELA (grant
-- dla klienta ma wlasna asercje wyzej, a do tabel klient nie ma zadnego
-- grantu); sciezki uzytkownika ida rola klienta. Baza po migracjach nie jest
-- pusta - 20260808220000 seeduje klub referencyjny z watkami - wiec kazde
-- pytanie o "watek" wskazuje watek TEGO testu przez GUC, nie pierwszy wiersz
-- tabeli.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

SELECT public.admin_club_upsert(
  '{"slug":"klub-reakcje","name_pl":"Klub reakcji","name_en":"Reactions club",
    "visibility":"members","who_can_post":"members","moderation_mode":"post",
    "status":"active"}'::jsonb);

SELECT set_config('test.group',
  (SELECT g.id::text FROM public.club_groups g JOIN public.clubs c ON c.id=g.club_id
    WHERE c.slug='klub-reakcje' LIMIT 1), true);

SET LOCAL ROLE authenticated;

SELECT public.club_create_thread(
  current_setting('test.group')::uuid,
  'Temat do reagowania', 'Tresc tematu, dluzsza niz dziesiec znakow.',
  'discussion', false, NULL, NULL);

RESET ROLE;
SELECT set_config('test.thread',
  (SELECT t.id::text FROM public.club_threads t JOIN public.clubs c ON c.id=t.club_id
    WHERE c.slug='klub-reakcje'), true);
SET LOCAL ROLE authenticated;

-- ----------------------------------------------------------------------------
-- ROZLACZNOSC STANOWISKA - najwazniejsza asercja tego pliku
-- ----------------------------------------------------------------------------
SELECT ok(
  public.club_react('thread', current_setting('test.thread')::uuid, 'agree'),
  'mozna postawic agree'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.club_reactions
    WHERE kind='agree' AND target_id = current_setting('test.thread')::uuid),
  1, 'agree zapisane'
);
SET LOCAL ROLE authenticated;

SELECT ok(
  public.club_react('thread', current_setting('test.thread')::uuid, 'disagree'),
  'mozna zmienic zdanie na disagree'
);

-- Trigger PODMIENIA, nie dodaje: po zmianie zdania zostaje jedno stanowisko.
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.club_reactions
    WHERE kind IN ('agree','disagree')
      AND user_id='aaaaaaaa-0000-0000-0000-000000000001'),
  1, 'ta sama osoba NIGDY nie ma agree i disagree naraz'
);

SELECT is(
  (SELECT kind FROM public.club_reactions
    WHERE kind IN ('agree','disagree')
      AND user_id='aaaaaaaa-0000-0000-0000-000000000001'),
  'disagree', 'po zmianie zdania zostaje nowe stanowisko'
);
SET LOCAL ROLE authenticated;

-- Reakcje JAKOSCIOWE sa niezalezne - mozna postawic kilka naraz.
SELECT public.club_react('thread', current_setting('test.thread')::uuid, 'insightful');
SELECT public.club_react('thread', current_setting('test.thread')::uuid, 'evidence');
SELECT public.club_react('thread', current_setting('test.thread')::uuid, 'thanks');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.club_reactions
    WHERE kind IN ('insightful','evidence','thanks')
      AND user_id='aaaaaaaa-0000-0000-0000-000000000001'),
  3, 'reakcje jakosciowe nie wykluczaja sie wzajemnie'
);
SET LOCAL ROLE authenticated;

-- Rodzaj spoza slownika jest odrzucany w BAZIE, nie tylko w kliencie.
SELECT throws_ok(
  format($$ SELECT public.club_react('thread','%s','fire') $$,
    current_setting('test.thread')),
  '22023', NULL, 'reakcja spoza slownika jest odrzucana w bazie'
);

-- Ranking liczy WYLACZNIE reakcje jakosciowe - agree/disagree go nie podbijaja.
RESET ROLE;
SELECT ok(
  (SELECT hotness FROM public.club_threads
    WHERE id = current_setting('test.thread')::uuid) > 0,
  'reakcje jakosciowe podbily ranking watku'
);
SET LOCAL ROLE authenticated;

-- ----------------------------------------------------------------------------
-- Stanowiska tylko w temacie kind=position
-- ----------------------------------------------------------------------------
SELECT throws_ok(
  format($$ SELECT public.club_set_stance('%s','support',NULL) $$,
    current_setting('test.thread')),
  '22023', NULL, 'stanowisko wolno zajac wylacznie w temacie kind=position'
);

-- ----------------------------------------------------------------------------
-- Autosubskrypcja: autor watku sledzi go z automatu
-- ----------------------------------------------------------------------------
RESET ROLE;
SELECT is(
  (SELECT state FROM public.club_thread_subscriptions
    WHERE thread_id = current_setting('test.thread')::uuid
      AND user_id='aaaaaaaa-0000-0000-0000-000000000001'),
  'subscribed', 'autor watku jest subskrybowany z automatu'
);

SELECT * FROM finish();
ROLLBACK;
