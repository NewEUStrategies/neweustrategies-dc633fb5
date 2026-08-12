-- pgTAP: izolacja tenanta w predykatach „ekspert"/„VIP" + doręczenia modułu
-- „Zapytanie do eksperta" (migracje 20260806160000 i 20260806161000).
--
-- FINDING 1 (izolacja). `is_expert_user(uuid)` i `is_vip_user(uuid)` liczyły
-- status GLOBALNIE - bez predykatu na `tenant_id`. Obie funkcje są w KAŻDEJ
-- bramce tiera czatu jako obejście (`chat: tier disabled`,
-- `chat: expert requires inmail`, `direct` w puli zapytań), więc jedno
-- autorstwo albo jeden grant VIP w obszarze roboczym CUDZEJ firmy otwierało
-- w naszym obszarze pełny czat i nielimitowane zapytania bez wykupionego
-- progu. Ten plik przybija, że status NIE przenosi się między tenantami -
-- dla wszystkich czterech źródeł (author_profiles, event_speakers przez
-- events, podcast_episode_people, role redakcyjne) i dla obu wariantów
-- (2-arg jawny, 1-arg rozstrzygający kontekst).
--
-- FINDING 2 (doręczenia). Moduł nie miał ANI JEDNEGO producenta powiadomień:
-- ekspert nie wiedział o nowym zapytaniu, a nadawca (płacący z policzalnej
-- puli) o decyzji. Tu weryfikujemy pełny cykl: nowe zapytanie -> odbiorca,
-- przyjęcie/odrzucenie -> nadawca, wycofanie -> odbiorca, plus dwujęzyczność,
-- `href` z identyfikatorem zapytania (bez niego dedup 5-minutowy po
-- (user, kind, href) zjadałby drugie zapytanie), stempel tenanta odbiorcy oraz
-- honorowanie przełącznika `enabled_expert_request`.
--
-- NAZWA RELACJI. Fizyczna relacja nazywa się `public.expert_inmails` - to nazwa
-- zastana w produkcji i w zrzucie typów (src/integrations/supabase/types.ts),
-- do której 20260806160001 świadomie ZBIEGŁA oba światy po rozjeździe
-- `expert_inmails` <-> `expert_requests` (20260723180000 robiło rename tylko na
-- świeżej bazie). Nazwa domenowa („expert request") żyje w API i UI:
-- send_expert_request / my_expert_request_quota / resolve_expert_request. Test
-- przybija JEDNĄ relację pod tą nazwą i BRAK drugiej - żeby rozjazd nie wrócił.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(35);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa obszary robocze, komplet źródeł statusu ───────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('7a000000-0000-0000-0000-0000000000a0', 'ets-a', 'ETS Tenant A', 'a.ets.example'),
  ('7b000000-0000-0000-0000-0000000000b0', 'ets-b', 'ETS Tenant B', 'b.ets.example');

INSERT INTO auth.users (id, email) VALUES
  ('7c000000-0000-0000-0000-000000000001', 'autor-a@ets.test'),
  ('7c000000-0000-0000-0000-000000000002', 'vip-a@ets.test'),
  ('7c000000-0000-0000-0000-000000000003', 'prelegent-a@ets.test'),
  ('7c000000-0000-0000-0000-000000000004', 'redaktor-a@ets.test'),
  ('7c000000-0000-0000-0000-000000000005', 'nadawca-a@ets.test'),
  ('7c000000-0000-0000-0000-000000000006', 'ktos-b@ets.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('7c000000-0000-0000-0000-000000000001', 'autor-a@ets.test', 'Autor A',
   '7a000000-0000-0000-0000-0000000000a0'),
  ('7c000000-0000-0000-0000-000000000002', 'vip-a@ets.test', 'VIP A',
   '7a000000-0000-0000-0000-0000000000a0'),
  ('7c000000-0000-0000-0000-000000000003', 'prelegent-a@ets.test', 'Prelegent A',
   '7a000000-0000-0000-0000-0000000000a0'),
  ('7c000000-0000-0000-0000-000000000004', 'redaktor-a@ets.test', 'Redaktor A',
   '7a000000-0000-0000-0000-0000000000a0'),
  ('7c000000-0000-0000-0000-000000000005', 'nadawca-a@ets.test', 'Nadawca A',
   '7a000000-0000-0000-0000-0000000000a0'),
  ('7c000000-0000-0000-0000-000000000006', 'ktos-b@ets.test', 'Ktos B',
   '7b000000-0000-0000-0000-0000000000b0');

-- Autor WYŁĄCZNIE w obszarze A.
INSERT INTO public.author_profiles (user_id, tenant_id, is_public)
VALUES ('7c000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-0000000000a0', false);

-- Grant VIP WYŁĄCZNIE w obszarze A.
INSERT INTO public.membership_grants (tenant_id, user_id, tier_key, source)
VALUES ('7a000000-0000-0000-0000-0000000000a0', '7c000000-0000-0000-0000-000000000002',
        'vip', 'manual');

-- Prelegent wydarzenia obszaru A (event_speakers nie ma własnej kolumny
-- tenanta - predykat idzie przez events.tenant_id).
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at)
VALUES ('7e000000-0000-0000-0000-0000000000e1', '7a000000-0000-0000-0000-0000000000a0',
        'ets-event', 'Wydarzenie ETS', 'ETS Event', now() + interval '7 days');
INSERT INTO public.event_speakers (event_id, user_id)
VALUES ('7e000000-0000-0000-0000-0000000000e1', '7c000000-0000-0000-0000-000000000003');

-- Rola redakcyjna WYŁĄCZNIE w obszarze A.
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('7c000000-0000-0000-0000-000000000004', 'editor', '7a000000-0000-0000-0000-0000000000a0');

-- ── 1) Autor: ekspert w swoim obszarze, NIE w cudzym ────────────────────────
SELECT is(
  public.is_expert_user('7c000000-0000-0000-0000-000000000001',
                        '7a000000-0000-0000-0000-0000000000a0'),
  true, 'author_profiles: autor jest ekspertem w SWOIM obszarze roboczym');

SELECT is(
  public.is_expert_user('7c000000-0000-0000-0000-000000000001',
                        '7b000000-0000-0000-0000-0000000000b0'),
  false, 'author_profiles: autor obszaru A NIE jest ekspertem w obszarze B');

-- ── 2) Prelegent wydarzenia (przez events.tenant_id) ────────────────────────
SELECT is(
  public.is_expert_user('7c000000-0000-0000-0000-000000000003',
                        '7a000000-0000-0000-0000-0000000000a0'),
  true, 'event_speakers: prelegent wydarzenia A jest ekspertem w A');

SELECT is(
  public.is_expert_user('7c000000-0000-0000-0000-000000000003',
                        '7b000000-0000-0000-0000-0000000000b0'),
  false, 'event_speakers: prelegent wydarzenia A NIE jest ekspertem w B');

-- ── 3) Rola redakcyjna ──────────────────────────────────────────────────────
SELECT is(
  public.is_expert_user('7c000000-0000-0000-0000-000000000004',
                        '7a000000-0000-0000-0000-0000000000a0'),
  true, 'user_roles: redaktor obszaru A jest ekspertem w A');

SELECT is(
  public.is_expert_user('7c000000-0000-0000-0000-000000000004',
                        '7b000000-0000-0000-0000-0000000000b0'),
  false, 'user_roles: redaktor obszaru A NIE jest ekspertem w B');

-- ── 4) VIP z grantu członkowskiego ──────────────────────────────────────────
SELECT is(
  public.is_vip_user('7c000000-0000-0000-0000-000000000002',
                     '7a000000-0000-0000-0000-0000000000a0'),
  true, 'membership_grants: grant VIP działa w obszarze, w którym go nadano');

SELECT is(
  public.is_vip_user('7c000000-0000-0000-0000-000000000002',
                     '7b000000-0000-0000-0000-0000000000b0'),
  false, 'membership_grants: grant VIP z obszaru A NIE działa w obszarze B');

-- ── 5) is_gated_recipient dziedziczy skalowanie ─────────────────────────────
SELECT is(
  public.is_gated_recipient('7c000000-0000-0000-0000-000000000001',
                            '7a000000-0000-0000-0000-0000000000a0'),
  true, 'is_gated_recipient: prawda w obszarze statusu');

SELECT is(
  public.is_gated_recipient('7c000000-0000-0000-0000-000000000002',
                            '7b000000-0000-0000-0000-0000000000b0'),
  false, 'is_gated_recipient: fałsz poza obszarem statusu');

SELECT is(
  public.is_expert_user('7c000000-0000-0000-0000-000000000001', NULL),
  false, 'brak tenanta = brak statusu (nigdy „gdziekolwiek")');

-- ── 6) Wariant 1-arg rozstrzyga OBSZAR WYWOŁANIA ────────────────────────────
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  '{"sub":"7c000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT is(
  public.is_expert_user('7c000000-0000-0000-0000-000000000001'),
  true, '1-arg: autor pytany z kontekstu swojego obszaru = ekspert');

-- Ten sam podmiot, ale pyta konto z obszaru B: status NIE może się przenieść.
SELECT set_config('request.jwt.claims',
  '{"sub":"7c000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
SELECT is(
  public.is_expert_user('7c000000-0000-0000-0000-000000000001'),
  false, '1-arg: z kontekstu obszaru B autor obszaru A nie jest ekspertem');
SELECT is(
  public.is_gated_recipient('7c000000-0000-0000-0000-000000000002'),
  false, '1-arg: bramka DM nie widzi VIP-a z cudzego obszaru roboczego');

RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);

-- ── 7) ACL predykatów ───────────────────────────────────────────────────────
SELECT is(
  has_function_privilege('anon', 'public.is_expert_user(uuid, uuid)', 'EXECUTE'),
  false, 'ACL: anon bez EXECUTE na tenant-scoped is_expert_user');
SELECT is(
  has_function_privilege('authenticated', 'public.is_vip_user(uuid, uuid)', 'EXECUTE'),
  true, 'ACL: authenticated z EXECUTE na tenant-scoped is_vip_user');

-- ── 8) Konsumenci przekazują tenanta JAWNIE (bramka strukturalna) ───────────
SELECT ok(
  pg_get_functiondef('public.get_or_create_direct_conversation(uuid)'::regprocedure)
    LIKE '%is_expert_user(v_uid, v_tenant)%',
  'bramka DM rozstrzyga status eksperta w obszarze rozmowy');
SELECT ok(
  pg_get_functiondef('public.get_or_create_direct_conversation(uuid)'::regprocedure)
    LIKE '%is_gated_recipient(p_peer_id, v_tenant)%',
  'bramka DM rozstrzyga status ODBIORCY w obszarze rozmowy');
SELECT ok(
  pg_get_functiondef('public.create_group_conversation(text, uuid[])'::regprocedure)
    LIKE '%is_vip_user(v_user, v_tenant)%',
  'bramka kręgu rozstrzyga status VIP w obszarze zakładającego');
SELECT ok(
  pg_get_functiondef('public.my_expert_request_quota()'::regprocedure)
    LIKE '%is_expert_user(v_uid, v_tenant)%',
  'pula zapytań przyznaje „direct" tylko ekspertowi TEGO obszaru');
SELECT ok(
  pg_get_functiondef(
    'public.send_expert_request(uuid, text, text, text[], text, text[])'::regprocedure)
    LIKE '%is_gated_recipient(p_recipient_id, v_tenant)%',
  'wysyłka zapytania sprawdza status odbiorcy w obszarze nadawcy');

-- ── 9) Katalog rodzajów powiadomień ─────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.notifications'::regclass
       AND conname = 'notifications_kind_check'
       AND pg_get_constraintdef(oid) LIKE '%expert_request%'),
  'katalog: rodzaj expert_request dopuszczony przez notifications_kind_check');

SELECT has_column('public', 'notification_preferences', 'enabled_expert_request',
  'katalog: rodzaj ma własny przełącznik w preferencjach');

SELECT ok(
  pg_get_functiondef('public.enqueue_notification(uuid, text, text, text, text, text, text, text)'::regprocedure)
    LIKE '%enabled_expert_request%',
  'katalog: producent ma gałąź CASE (bez niej ELSE true = przeciek)');

-- ── 10) Doręczenia: pełny cykl życia zapytania ──────────────────────────────
SELECT ok(to_regclass('public.expert_inmails') IS NOT NULL,
  'relacja zapytań istnieje pod kanoniczną nazwą (expert_inmails)');

SELECT ok(to_regclass('public.expert_requests') IS NULL,
  'druga generacja nazwy nie istnieje - rozjazd expert_requests/expert_inmails zamknięty');

INSERT INTO public.expert_inmails
  (id, tenant_id, sender_id, recipient_id, subject, reason)
VALUES
  ('7f000000-0000-0000-0000-0000000000f1',
   '7a000000-0000-0000-0000-0000000000a0',
   '7c000000-0000-0000-0000-000000000005',
   '7c000000-0000-0000-0000-000000000001',
   'Konsultacja w sprawie AI Act',
   'Potrzebuję opinii o obowiązkach dostawcy modeli ogolnego przeznaczenia.');

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = '7c000000-0000-0000-0000-000000000001'
      AND n.kind = 'expert_request'),
  1, 'nowe zapytanie: ekspert dostaje powiadomienie');

SELECT ok(
  (SELECT n.href LIKE '%7f000000-0000-0000-0000-0000000000f1%'
     FROM public.notifications n
    WHERE n.user_id = '7c000000-0000-0000-0000-000000000001'
      AND n.kind = 'expert_request'),
  'href niesie identyfikator zapytania (inaczej dedup zjadałby kolejne)');

SELECT ok(
  (SELECT n.title_en IS NOT NULL AND n.title_pl IS NOT NULL
     FROM public.notifications n
    WHERE n.user_id = '7c000000-0000-0000-0000-000000000001'
      AND n.kind = 'expert_request'),
  'powiadomienie jest dwujęzyczne (skrzynka renderuje język czytelnika)');

SELECT is(
  (SELECT n.tenant_id FROM public.notifications n
    WHERE n.user_id = '7c000000-0000-0000-0000-000000000001'
      AND n.kind = 'expert_request'),
  '7a000000-0000-0000-0000-0000000000a0'::uuid,
  'powiadomienie stemplowane tenantem ODBIORCY');

-- Przyjęcie: nadawca dostaje sygnał, a link prowadzi do powstałej rozmowy.
INSERT INTO public.conversations (id, tenant_id, kind, direct_key, created_by)
VALUES ('7f000000-0000-0000-0000-0000000000c1', '7a000000-0000-0000-0000-0000000000a0',
        'direct', 'ets-direct-key', '7c000000-0000-0000-0000-000000000001');

UPDATE public.expert_inmails
   SET status = 'approved',
       converted_conversation_id = '7f000000-0000-0000-0000-0000000000c1'
 WHERE id = '7f000000-0000-0000-0000-0000000000f1';

SELECT ok(
  EXISTS (SELECT 1 FROM public.notifications n
           WHERE n.user_id = '7c000000-0000-0000-0000-000000000005'
             AND n.kind = 'expert_request'
             AND n.href = '/messages?c=7f000000-0000-0000-0000-0000000000c1#approved'),
  'przyjęcie: nadawca dostaje link wprost do powstałej rozmowy');

-- UPDATE bez zmiany statusu nie jest zdarzeniem dla użytkownika.
UPDATE public.expert_inmails
   SET status = 'approved', admin_note = 'notatka'
 WHERE id = '7f000000-0000-0000-0000-0000000000f1';

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = '7c000000-0000-0000-0000-000000000005'
      AND n.kind = 'expert_request'),
  1, 'zapis bez zmiany statusu nie produkuje drugiego powiadomienia');

-- Odrzucenie z powodem trafia do treści.
UPDATE public.expert_inmails
   SET status = 'declined', decline_reason = 'Brak czasu w tym kwartale'
 WHERE id = '7f000000-0000-0000-0000-0000000000f1';

SELECT ok(
  EXISTS (SELECT 1 FROM public.notifications n
           WHERE n.user_id = '7c000000-0000-0000-0000-000000000005'
             AND n.kind = 'expert_request'
             AND n.body_pl = 'Brak czasu w tym kwartale'),
  'odrzucenie: powód eksperta dociera do nadawcy');

-- Wycofanie przez nadawcę: sygnał należy się ODBIORCY.
UPDATE public.expert_inmails SET status = 'cancelled'
 WHERE id = '7f000000-0000-0000-0000-0000000000f1';

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = '7c000000-0000-0000-0000-000000000001'
      AND n.kind = 'expert_request'),
  2, 'wycofanie: ekspert dowiaduje się, że zapytania już nie ma');

-- ── 11) Przełącznik odbiorcy realnie tłumi rodzaj ───────────────────────────
INSERT INTO public.notification_preferences (user_id, tenant_id, enabled_expert_request)
VALUES ('7c000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-0000000000a0', false)
ON CONFLICT (user_id) DO UPDATE SET enabled_expert_request = false;

INSERT INTO public.expert_inmails
  (id, tenant_id, sender_id, recipient_id, subject, reason)
VALUES
  ('7f000000-0000-0000-0000-0000000000f2',
   '7a000000-0000-0000-0000-0000000000a0',
   '7c000000-0000-0000-0000-000000000005',
   '7c000000-0000-0000-0000-000000000001',
   'Drugie zapytanie',
   'Druga sprawa, rowniez wymagajaca opinii eksperta w tej dziedzinie.');

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = '7c000000-0000-0000-0000-000000000001'
      AND n.kind = 'expert_request'),
  2, 'wyłączony przełącznik expert_request tłumi doręczenie');

SELECT * FROM finish();
ROLLBACK;
