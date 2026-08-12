-- pgTAP: doręczenia PIĘCIU zdarzeń sieciowych, które do 08.2026 nie miały ANI
-- JEDNEGO producenta powiadomień (migracja 20260807073000).
--
-- Plik pilnuje trzech rzeczy, z których każda psuje się inaczej:
--
--   1. KATALOG. Rodzaj musi być pełnoprawnym obywatelem: wpis w
--      `notifications_kind_check` ORAZ kolumna `enabled_<rodzaj>`. Parytet w obie
--      strony i sweep behawioralny mieszkają w
--      notification_preferences_gating_test.sql (są sterowane katalogiem, więc
--      objęły nowe rodzaje bez dopisywania asercji) - tutaj przybijamy tylko, że
--      pięć nowych rodzajów NAPRAWDĘ tam jest, bo to warunek wstępny wszystkiego
--      poniżej.
--
--   2. ADRESAT. Producent doręcza dokładnie tej stronie, która może z sygnałem
--      COŚ ZROBIĆ - i nikomu więcej. Trzy ścieżki są CELOWO CICHE i to one są
--      najcenniejszą częścią tego pliku, bo „brak powiadomienia" wygląda
--      identycznie jak defekt:
--        * odmowa mostu ('declined') nie wraca do proszącego (gwarancja
--          `network.introductions.bridgeHint` z 20260717123000),
--        * odrzucenie/ukrycie rekomendacji nie wraca do autora (parytet z
--          `list_recommendations`, która pokazuje mu je jako „oczekujące"),
--        * tożsamość widza w trybie anonimowym/prywatnym nie trafia ANI do
--          treści, ANI do href-a (UUID w atrybucie linku byłby obejściem trybu
--          anonimowego przez skrzynkę odbiorcy).
--
--   3. BRAK PODWÓJNEGO DORĘCZENIA. `book_meeting_slot` kolejkowało rezerwację
--      samo, pod rodzajem 'content' (20260728090000:297). Po przeniesieniu
--      doręczenia do triggera stara ścieżka MUSI zniknąć z ciała funkcji -
--      inaczej host dostaje dwa powiadomienia o jednym zdarzeniu, na dwóch
--      różnych przełącznikach.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(28);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ────────────────────────────────────────────────────────────────────
-- u1 - „środek" sieci: most wprowadzeń, odbiorca rekomendacji i poparć,
--      właściciel oglądanego profilu, host slotu 1-1.
-- u2 - aktor publiczny: proszący, autor rekomendacji, popierający, widz
--      w trybie 'public', rezerwujący spotkanie.
-- u3 - osoba docelowa wprowadzenia oraz widz w trybie 'anonymous'.
-- u4 - aktor ścieżek CICHYCH (odmowa mostu, odrzucona rekomendacja): dzięki
--      osobnej tożsamości „zero powiadomień" jest dowodem, a nie zbiegiem
--      okoliczności z innym scenariuszem.

INSERT INTO public.tenants (id, slug, name) VALUES
  ('e1111111-1111-1111-1111-1111111100aa', 'events-notify', 'Events Notify Tenant');

INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'hub@notify.test'),
  ('e0000000-0000-0000-0000-0000000000a2', 'actor@notify.test'),
  ('e0000000-0000-0000-0000-0000000000a3', 'target@notify.test'),
  ('e0000000-0000-0000-0000-0000000000a4', 'silent@notify.test');

INSERT INTO public.profiles (id, email, display_name, slug, tenant_id) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'hub@notify.test', 'Anna Hub', 'anna-hub',
   'e1111111-1111-1111-1111-1111111100aa'),
  ('e0000000-0000-0000-0000-0000000000a2', 'actor@notify.test', 'Piotr Aktor', 'piotr-aktor',
   'e1111111-1111-1111-1111-1111111100aa'),
  ('e0000000-0000-0000-0000-0000000000a3', 'target@notify.test', 'Maria Cel', 'maria-cel',
   'e1111111-1111-1111-1111-1111111100aa'),
  ('e0000000-0000-0000-0000-0000000000a4', 'silent@notify.test', 'Jan Cichy', 'jan-cichy',
   'e1111111-1111-1111-1111-1111111100aa');

-- Komplet flag na true (kolumny mają DEFAULT true).
INSERT INTO public.notification_preferences (user_id, tenant_id) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'e1111111-1111-1111-1111-1111111100aa'),
  ('e0000000-0000-0000-0000-0000000000a2', 'e1111111-1111-1111-1111-1111111100aa'),
  ('e0000000-0000-0000-0000-0000000000a3', 'e1111111-1111-1111-1111-1111111100aa'),
  ('e0000000-0000-0000-0000-0000000000a4', 'e1111111-1111-1111-1111-1111111100aa');

-- `notify_profile_welcome` (20260711212733) wita KAŻDY nowy profil wpisem
-- rodzaju 'system'. Asercje ciszy poniżej są celowo bez filtra po rodzaju -
-- „u4 nie ma ANI JEDNEGO powiadomienia" wyłapuje wyciek doręczony pod
-- dowolnym rodzajem, także nowym. Żeby ta forma mierzyła producentów z tego
-- pliku, a nie onboardingu, sygnał powitalny znika z seeda.
DELETE FROM public.notifications WHERE kind = 'system';

-- ── 1. Katalog rodzajów ─────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.new_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ARRAY['introduction','recommendation','endorsement','profile_view',
               'meeting_booking']::text[];
$fn$;

SELECT is(
  ARRAY(
    SELECT k FROM unnest(pg_temp.new_kinds()) AS k
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.notifications'::regclass
          AND c.conname = 'notifications_kind_check'
          AND pg_get_constraintdef(c.oid) LIKE '%''' || k || '''%')
     ORDER BY k),
  ARRAY[]::text[],
  'wszystkie pięć nowych rodzajów jest w notifications_kind_check');

SELECT is(
  ARRAY(
    SELECT k FROM unnest(pg_temp.new_kinds()) AS k
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = 'notification_preferences'
          AND col.column_name = 'enabled_' || k
          AND col.data_type = 'boolean')
     ORDER BY k),
  ARRAY[]::text[],
  'każdy nowy rodzaj ma własny przełącznik enabled_<rodzaj>');

-- ── 2. WPROWADZENIA ─────────────────────────────────────────────────────────
-- i1: u2 prosi u1 o wprowadzenie do u3 (ścieżka przekazania).
-- i2: u4 prosi u1 o wprowadzenie do u2 (ścieżka CICHEJ odmowy).
-- i3: u2 prosi u1 ponownie (ścieżka wycofania).

INSERT INTO public.introduction_requests
  (id, tenant_id, requester_id, bridge_id, target_id, message, status) VALUES
  ('e2220000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-1111111100aa',
   'e0000000-0000-0000-0000-0000000000a2', 'e0000000-0000-0000-0000-0000000000a1',
   'e0000000-0000-0000-0000-0000000000a3', 'Prosze o wprowadzenie do osoby docelowej.', 'pending'),
  ('e2220000-0000-0000-0000-000000000002', 'e1111111-1111-1111-1111-1111111100aa',
   'e0000000-0000-0000-0000-0000000000a4', 'e0000000-0000-0000-0000-0000000000a1',
   'e0000000-0000-0000-0000-0000000000a2', 'Druga prosba, ta zostanie odrzucona.', 'pending'),
  ('e2220000-0000-0000-0000-000000000003', 'e1111111-1111-1111-1111-1111111100aa',
   'e0000000-0000-0000-0000-0000000000a2', 'e0000000-0000-0000-0000-0000000000a1',
   'e0000000-0000-0000-0000-0000000000a3', 'Trzecia prosba, ta zostanie wycofana.', 'pending');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'introduction'
      AND n.href LIKE '%intro=bridge%'
      AND n.href LIKE '%-pending'),
  3::bigint,
  'nowa prośba o wprowadzenie dociera do MOSTU (po jednej na prośbę)');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a2'
      AND n.kind = 'introduction'),
  0::bigint,
  'proszący nie dostaje powiadomienia o własnej prośbie');

-- Most przekazuje i1: sygnał dla proszącego ORAZ dla osoby docelowej.
UPDATE public.introduction_requests
   SET status = 'forwarded', responded_at = now()
 WHERE id = 'e2220000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a2'
      AND n.kind = 'introduction'
      AND n.href LIKE '%intro=requester%-forwarded'),
  1::bigint,
  'przekazanie prośby dociera do PROSZĄCEGO');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a3'
      AND n.kind = 'introduction'
      AND n.href LIKE '%intro=target%-forwarded'
      AND n.body_pl LIKE '%Piotr Aktor%'),
  1::bigint,
  'przekazanie dociera do OSOBY DOCELOWEJ z nazwą proszącego w treści');

-- Most odrzuca i2: proszący NIE MOŻE się o tym dowiedzieć.
UPDATE public.introduction_requests
   SET status = 'declined', responded_at = now()
 WHERE id = 'e2220000-0000-0000-0000-000000000002';

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a4'),
  0::bigint,
  'odmowa mostu jest CICHA - proszący nie dostaje żadnego powiadomienia');

-- Proszący wycofuje i3: sygnał dla mostu, żeby nie rozstrzygał martwej prośby.
UPDATE public.introduction_requests
   SET status = 'withdrawn', responded_at = now()
 WHERE id = 'e2220000-0000-0000-0000-000000000003';

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'introduction'
      AND n.href LIKE '%-withdrawn'),
  1::bigint,
  'wycofanie prośby dociera do MOSTU');

-- ── 3. REKOMENDACJE ────────────────────────────────────────────────────────

INSERT INTO public.profile_recommendations
  (id, tenant_id, recipient_id, author_id, relationship, body, status) VALUES
  ('e3330000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-1111111100aa',
   'e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000a2',
   'colleague', 'Wspolpraca merytoryczna na najwyzszym poziomie.', 'pending'),
  ('e3330000-0000-0000-0000-000000000002', 'e1111111-1111-1111-1111-1111111100aa',
   'e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000a4',
   'client', 'Ta rekomendacja zostanie odrzucona przez odbiorce.', 'pending');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'recommendation'
      AND n.href LIKE '/author/anna-hub#r-%-pending'),
  2::bigint,
  'nowa rekomendacja dociera do ODBIORCY (moderacja), z jego slugiem w href-ie');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a2'
      AND n.kind = 'recommendation'),
  0::bigint,
  'autor nie dostaje powiadomienia o własnej, jeszcze niezatwierdzonej rekomendacji');

UPDATE public.profile_recommendations
   SET status = 'published'
 WHERE id = 'e3330000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a2'
      AND n.kind = 'recommendation'
      AND n.href LIKE '%-published'),
  1::bigint,
  'publikacja rekomendacji dociera do AUTORA');

UPDATE public.profile_recommendations
   SET status = 'declined'
 WHERE id = 'e3330000-0000-0000-0000-000000000002';

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a4'),
  0::bigint,
  'odrzucenie rekomendacji jest CICHE - autor nie dostaje żadnego powiadomienia');

-- ── 4. POPARCIA UMIEJĘTNOŚCI ───────────────────────────────────────────────

INSERT INTO public.profile_skills (id, tenant_id, user_id, label) VALUES
  ('e4440000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-1111111100aa',
   'e0000000-0000-0000-0000-0000000000a1', 'Polityka energetyczna UE');

INSERT INTO public.profile_skill_endorsements
  (id, tenant_id, skill_id, recipient_id, endorser_id) VALUES
  ('e4440000-0000-0000-0000-0000000000f1', 'e1111111-1111-1111-1111-1111111100aa',
   'e4440000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a1',
   'e0000000-0000-0000-0000-0000000000a2');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'endorsement'
      AND n.body_pl LIKE '%Piotr Aktor%'
      AND n.body_pl LIKE '%Polityka energetyczna UE%'),
  1::bigint,
  'poparcie dociera do właściciela umiejętności - z popierającym I nazwą umiejętności');

-- ── 5. WYŚWIETLENIA PROFILU ────────────────────────────────────────────────
-- Widz 'public' ujawnia tożsamość (tak samo jak my_profile_viewers); widz
-- 'anonymous' NIE MOŻE jej ujawnić ani treścią, ani href-em.

INSERT INTO public.profile_view_events
  (tenant_id, profile_id, viewer_id, viewer_mode, viewer_snapshot) VALUES
  ('e1111111-1111-1111-1111-1111111100aa', 'e0000000-0000-0000-0000-0000000000a1',
   'e0000000-0000-0000-0000-0000000000a2', 'public',
   '{"display_name":"Piotr Aktor","job_title":"Analityk"}'::jsonb),
  ('e1111111-1111-1111-1111-1111111100aa', 'e0000000-0000-0000-0000-0000000000a1',
   'e0000000-0000-0000-0000-0000000000a3', 'anonymous', NULL);

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'profile_view'
      AND n.body_pl LIKE '%Piotr Aktor%'
      AND n.href = '/profile?tab=activity#pv-e0000000-0000-0000-0000-0000000000a2'),
  1::bigint,
  'wyświetlenie w trybie public dociera do właściciela z nazwą widza');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'profile_view'
      AND n.href = '/profile?tab=activity#pv-anon'
      AND n.body_pl LIKE '%anonimowy%'),
  1::bigint,
  'wyświetlenie w trybie anonymous dociera bez nazwy widza');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.kind = 'profile_view'
      AND (n.href LIKE '%e0000000-0000-0000-0000-0000000000a3%'
        OR n.body_pl LIKE '%Maria Cel%'
        OR n.body_en LIKE '%Maria Cel%')),
  0::bigint,
  'tryb anonymous nie przecieka tożsamością widza ANI w href-ie, ANI w treści');

-- ── 6. REZERWACJE SPOTKAŃ 1-1 ──────────────────────────────────────────────

INSERT INTO public.meeting_slots (id, tenant_id, host_user_id, starts_at, ends_at, location)
VALUES ('e5550000-0000-0000-0000-000000000001', 'e1111111-1111-1111-1111-1111111100aa',
        'e0000000-0000-0000-0000-0000000000a1',
        now() + interval '2 days', now() + interval '2 days 30 minutes', 'Sala Bruksela');

INSERT INTO public.meeting_bookings (id, tenant_id, slot_id, attendee_user_id, status)
VALUES ('e5550000-0000-0000-0000-0000000000f1', 'e1111111-1111-1111-1111-1111111100aa',
        'e5550000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a2',
        'confirmed');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'meeting_booking'
      AND n.href LIKE '%-booked'
      AND n.body_pl LIKE '%Piotr Aktor%'
      AND n.body_pl LIKE '%Sala Bruksela%'),
  1::bigint,
  'rezerwacja dociera do HOSTA z rezerwującym, terminem i miejscem w treści');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a2'
      AND n.kind = 'meeting_booking'
      AND n.href LIKE '%-confirmed'
      AND n.body_pl LIKE '%Anna Hub%'),
  1::bigint,
  'rezerwujący dostaje potwierdzenie (slot 1-1 jest wyłączny)');

UPDATE public.meeting_bookings
   SET status = 'cancelled'
 WHERE id = 'e5550000-0000-0000-0000-0000000000f1';

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'meeting_booking'
      AND n.href LIKE '%-cancelled'),
  1::bigint,
  'anulowanie rezerwacji dociera do HOSTA (slot wrócił do puli)');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'content'),
  0::bigint,
  'rezerwacja NIE jedzie już pod rodzajem content (koniec współdzielenia przełącznika)');

SELECT is(
  position('enqueue_notification' in
    pg_get_functiondef('public.book_meeting_slot(uuid, text)'::regprocedure)),
  0,
  'book_meeting_slot nie kolejkuje już powiadomień samo (brak podwójnego doręczenia)');

-- ── 7. Dwujęzyczność i stempel tenanta ─────────────────────────────────────
-- Skrzynka renderuje język CZYTELNIKA, więc brak title_en oznacza polski tytuł
-- w angielskim UI (fallback w pickTitle) - cicha regresja, którą widzi wyłącznie
-- czytelnik EN.

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.kind = ANY (pg_temp.new_kinds())
      AND (n.title_en IS NULL OR n.body_en IS NULL)),
  0::bigint,
  'każde powiadomienie nowych rodzajów ma wersję EN tytułu i treści');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.kind = ANY (pg_temp.new_kinds())
      AND n.tenant_id <> 'e1111111-1111-1111-1111-1111111100aa'),
  0::bigint,
  'powiadomienia stemplowane tenantem odbiorcy (izolacja obszarów roboczych)');

-- ── 8. Przełącznik REALNIE tłumi producenta ────────────────────────────────
-- Sweep katalogowy w notification_preferences_gating_test.sql dowodzi, że bramka
-- działa dla każdego rodzaju; tutaj domykamy pętlę PRODUCENT -> bramka, bo
-- producent mógłby wołać `enqueue_notification` z innym literałem rodzaju niż
-- ten, który ma kolumnę (wtedy CASE spada do `ELSE true` i przełącznik jest
-- martwy, choć sweep świeci na zielono).

UPDATE public.notification_preferences
   SET enabled_profile_view = false, enabled_introduction = false
 WHERE user_id = 'e0000000-0000-0000-0000-0000000000a1';

INSERT INTO public.profile_view_events
  (tenant_id, profile_id, viewer_id, viewer_mode, viewer_snapshot) VALUES
  ('e1111111-1111-1111-1111-1111111100aa', 'e0000000-0000-0000-0000-0000000000a1',
   'e0000000-0000-0000-0000-0000000000a4', 'public',
   '{"display_name":"Jan Cichy"}'::jsonb);

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'profile_view'
      AND n.href LIKE '%e0000000-0000-0000-0000-0000000000a4%'),
  0::bigint,
  'wyłączony enabled_profile_view tłumi producenta wyświetleń');

INSERT INTO public.introduction_requests
  (id, tenant_id, requester_id, bridge_id, target_id, message, status) VALUES
  ('e2220000-0000-0000-0000-000000000004', 'e1111111-1111-1111-1111-1111111100aa',
   'e0000000-0000-0000-0000-0000000000a4', 'e0000000-0000-0000-0000-0000000000a1',
   'e0000000-0000-0000-0000-0000000000a3', 'Prosba przy wylaczonym przelaczniku.', 'pending');

SELECT is(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = 'e0000000-0000-0000-0000-0000000000a1'
      AND n.kind = 'introduction'
      AND n.href LIKE '%e2220000-0000-0000-0000-000000000004%'),
  0::bigint,
  'wyłączony enabled_introduction tłumi producenta wprowadzeń');

-- ── 9. ACL: producenci i ich helpery są WYŁĄCZNIE serwerowe ────────────────
-- Helper `notification_actor_name` czyta `profiles` ponad RLS. Grant dla roli
-- klienckiej zamieniłby go w czytnik nazw dowolnego konta w dowolnym tenancie -
-- ta sama klasa błędu, którą 20260803090000 zamknęło dla enqueue_notification.

SELECT ok(
  NOT has_function_privilege('anon', 'public.notification_actor_name(uuid)', 'EXECUTE'),
  'anon bez EXECUTE na notification_actor_name');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.notification_actor_name(uuid)', 'EXECUTE'),
  'authenticated bez EXECUTE na notification_actor_name');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.tg_profile_view_notify()', 'EXECUTE'),
  'authenticated bez EXECUTE na producenta wyświetleń profilu');

SELECT * FROM finish();
ROLLBACK;
