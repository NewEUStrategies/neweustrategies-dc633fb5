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
-- ============================================================================
BEGIN;
SELECT plan(16);

INSERT INTO public.tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a-int-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@int.local'),
       ('aaaaaaaa-0000-0000-0000-000000000003', 'member@int.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Admin', true),
       ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Czlonek', true)
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

INSERT INTO public.user_roles (user_id, role)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin')
ON CONFLICT DO NOTHING;

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
-- Fixture tresci
-- ----------------------------------------------------------------------------
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

SELECT public.admin_club_upsert(
  '{"slug":"klub-reakcje","name_pl":"Klub reakcji","name_en":"Reactions club",
    "visibility":"members","who_can_post":"members","moderation_mode":"post",
    "status":"active"}'::jsonb);

SELECT public.club_create_thread(
  (SELECT g.id FROM public.club_groups g JOIN public.clubs c ON c.id=g.club_id
    WHERE c.slug='klub-reakcje' LIMIT 1),
  'Temat do reagowania', 'Tresc tematu, dluzsza niz dziesiec znakow.',
  'discussion', false, NULL, NULL);

-- ----------------------------------------------------------------------------
-- ROZLACZNOSC STANOWISKA - najwazniejsza asercja tego pliku
-- ----------------------------------------------------------------------------
SELECT ok(
  public.club_react('thread', (SELECT id FROM public.club_threads LIMIT 1), 'agree'),
  'mozna postawic agree'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_reactions WHERE kind='agree'),
  1, 'agree zapisane'
);

SELECT ok(
  public.club_react('thread', (SELECT id FROM public.club_threads LIMIT 1), 'disagree'),
  'mozna zmienic zdanie na disagree'
);

-- Trigger PODMIENIA, nie dodaje: po zmianie zdania zostaje jedno stanowisko.
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

-- Reakcje JAKOSCIOWE sa niezalezne - mozna postawic kilka naraz.
SELECT public.club_react('thread', (SELECT id FROM public.club_threads LIMIT 1), 'insightful');
SELECT public.club_react('thread', (SELECT id FROM public.club_threads LIMIT 1), 'evidence');
SELECT public.club_react('thread', (SELECT id FROM public.club_threads LIMIT 1), 'thanks');

SELECT is(
  (SELECT count(*)::int FROM public.club_reactions
    WHERE kind IN ('insightful','evidence','thanks')
      AND user_id='aaaaaaaa-0000-0000-0000-000000000001'),
  3, 'reakcje jakosciowe nie wykluczaja sie wzajemnie'
);

-- Rodzaj spoza slownika jest odrzucany w BAZIE, nie tylko w kliencie.
SELECT throws_ok(
  format($$ SELECT public.club_react('thread','%s','fire') $$,
    (SELECT id FROM public.club_threads LIMIT 1)),
  '22023', NULL, 'reakcja spoza slownika jest odrzucana w bazie'
);

-- Ranking liczy WYLACZNIE reakcje jakosciowe - agree/disagree go nie podbijaja.
SELECT ok(
  (SELECT hotness FROM public.club_threads LIMIT 1) > 0,
  'reakcje jakosciowe podbily ranking watku'
);

-- ----------------------------------------------------------------------------
-- Stanowiska tylko w temacie kind=position
-- ----------------------------------------------------------------------------
SELECT throws_ok(
  format($$ SELECT public.club_set_stance('%s','support',NULL) $$,
    (SELECT id FROM public.club_threads WHERE kind='discussion' LIMIT 1)),
  '22023', NULL, 'stanowisko wolno zajac wylacznie w temacie kind=position'
);

-- ----------------------------------------------------------------------------
-- Autosubskrypcja: autor watku sledzi go z automatu
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT state FROM public.club_thread_subscriptions
    WHERE thread_id=(SELECT id FROM public.club_threads LIMIT 1)
      AND user_id='aaaaaaaa-0000-0000-0000-000000000001'),
  'subscribed', 'autor watku jest subskrybowany z automatu'
);

SELECT * FROM finish();
ROLLBACK;
