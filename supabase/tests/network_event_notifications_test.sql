-- pgTAP: PIEC ZDARZEN SIECIOWYCH PRZESTAJE MILCZEC (20260807140000).
--
-- Stan przed migracja: wprowadzenia, rekomendacje, endorsementy, odslony
-- profilu i rezerwacje spotkan zapisywaly wiersz i nie emitowaly ZADNEGO
-- powiadomienia. Cala rura doreczen (enqueue_notification -> in-app + push +
-- digest) dzialala od 20260710152630 - brakowalo wylacznie PRODUCENTOW.
--
-- Weryfikowane wlasnosci:
--   1. Katalog rodzajow: piec nowych wpisow w notifications_kind_check ORAZ
--      blizniacza kolumna enabled_<rodzaj> w notification_preferences.
--      Oba sprawdzenia sa sterowane KATALOGIEM (tymczasowa tabela rodzajow),
--      wiec nowy rodzaj bez kolumny wywala test bez dopisywania asercji.
--   2. Bramka CASE w enqueue_notification realnie tlumi kazdy z pieciu
--      rodzajow - rodzaj bez galezi trafia w `ELSE true` i przecieka.
--   3. Wprowadzenia: INSERT -> most, 'forwarded' -> cel ORAZ proszacy,
--      'withdrawn' -> CISZA (prywatnosc wlasnej rezygnacji).
--   4. Rekomendacje: 'pending' -> odbiorca (moderacja), 'published' -> autor,
--      'hidden' -> CISZA.
--   5. Endorsementy: INSERT -> odbiorca, href niesie skill_id, wiec dedup
--      5-minutowy nie zjada drugiej umiejetnosci od tej samej osoby.
--   6. Odslony profilu: run_profile_view_alerts liczy ponad znakiem wodnym,
--      stempluje profile_view_alert_state i NIE wysyla drugi raz w tej samej
--      dobie (alert per odslona = wylaczony przelacznik po tygodniu).
--   7. Spotkania 1-1: rezerwacja i anulowanie w rodzaju 'meeting_booking' (nie
--      w ogolnym 'content'), host poznaje nazwe rezerwujacego i dowiaduje sie
--      o zwolnionym slocie.
--   8. ACL: profile_view_alert_state bez grantow klienckich,
--      run_profile_view_alerts wylacznie dla service_role.
--
-- Wszystkie wiersze seeda leza w tenancie PUBLICZNYM: book_meeting_slot skaluje
-- sloty po public_tenant_id() (plaszczyzna tresci widgetu), a trigger
-- profiles_pin_tenant nie pozwala przepiac profilu po fakcie.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(33);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  ('ad000000-0000-0000-0000-0000000000aa'::uuid, 'a@ad.test'),
  ('ad000000-0000-0000-0000-0000000000bb'::uuid, 'b@ad.test'),
  ('ad000000-0000-0000-0000-0000000000cc'::uuid, 'c@ad.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable, slug) VALUES
  ('ad000000-0000-0000-0000-0000000000aa'::uuid, 'a@ad.test', 'Ala AD',
   (SELECT public.public_tenant_id()), true, 'ala-ad'),
  ('ad000000-0000-0000-0000-0000000000bb'::uuid, 'b@ad.test', 'Bartek AD',
   (SELECT public.public_tenant_id()), true, 'bartek-ad'),
  ('ad000000-0000-0000-0000-0000000000cc'::uuid, 'c@ad.test', 'Celina AD',
   (SELECT public.public_tenant_id()), true, 'celina-ad');

-- ---------------------------------------------------------------------------
-- Katalog rodzajow: CHECK i kolumny preferencji (sweep po katalogu)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE ad_new_kinds(kind text) ON COMMIT DROP;
INSERT INTO ad_new_kinds VALUES
  ('introduction'), ('recommendation'), ('endorsement'), ('profile_view'), ('meeting_booking');

SELECT is(
  (SELECT count(*)::int
     FROM ad_new_kinds k
    WHERE EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conname = 'notifications_kind_check'
         AND c.conrelid = 'public.notifications'::regclass
         AND pg_get_constraintdef(c.oid) LIKE '%''' || k.kind || '''%'
    )),
  5,
  'wszystkie piec rodzajow jest w notifications_kind_check'
);

SELECT is(
  (SELECT count(*)::int
     FROM ad_new_kinds k
    WHERE EXISTS (
      SELECT 1 FROM information_schema.columns col
       WHERE col.table_schema = 'public'
         AND col.table_name = 'notification_preferences'
         AND col.column_name = 'enabled_' || k.kind
    )),
  5,
  'kazdy nowy rodzaj ma blizniacza kolumne enabled_<rodzaj>'
);

-- ---------------------------------------------------------------------------
-- Bramka CASE: kazdy rodzaj realnie tlumiony wlasna flaga
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_preferences (user_id, tenant_id)
VALUES ('ad000000-0000-0000-0000-0000000000cc'::uuid,
        (SELECT public.public_tenant_id()));

UPDATE public.notification_preferences
   SET enabled_introduction = false, enabled_recommendation = false,
       enabled_endorsement = false, enabled_profile_view = false,
       enabled_meeting_booking = false
 WHERE user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid;

SELECT is(
  public.enqueue_notification('ad000000-0000-0000-0000-0000000000cc'::uuid,
    'introduction', 'x', 'x', NULL, NULL, '/probe/intro', NULL),
  NULL::uuid,
  'enabled_introduction=false tlumi rodzaj introduction'
);
SELECT is(
  public.enqueue_notification('ad000000-0000-0000-0000-0000000000cc'::uuid,
    'recommendation', 'x', 'x', NULL, NULL, '/probe/rec', NULL),
  NULL::uuid,
  'enabled_recommendation=false tlumi rodzaj recommendation'
);
SELECT is(
  public.enqueue_notification('ad000000-0000-0000-0000-0000000000cc'::uuid,
    'endorsement', 'x', 'x', NULL, NULL, '/probe/end', NULL),
  NULL::uuid,
  'enabled_endorsement=false tlumi rodzaj endorsement'
);
SELECT is(
  public.enqueue_notification('ad000000-0000-0000-0000-0000000000cc'::uuid,
    'profile_view', 'x', 'x', NULL, NULL, '/probe/view', NULL),
  NULL::uuid,
  'enabled_profile_view=false tlumi rodzaj profile_view'
);
SELECT is(
  public.enqueue_notification('ad000000-0000-0000-0000-0000000000cc'::uuid,
    'meeting_booking', 'x', 'x', NULL, NULL, '/probe/meet', NULL),
  NULL::uuid,
  'enabled_meeting_booking=false tlumi rodzaj meeting_booking'
);

-- Wlaczenie z powrotem: rodzaj musi dojsc - dowod, ze wyzej zadzialala FLAGA,
-- a nie jakikolwiek inny warunek producenta.
UPDATE public.notification_preferences
   SET enabled_meeting_booking = true
 WHERE user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid;

SELECT isnt(
  public.enqueue_notification('ad000000-0000-0000-0000-0000000000cc'::uuid,
    'meeting_booking', 'x', 'x', NULL, NULL, '/probe/meet-on', NULL),
  NULL::uuid,
  'enabled_meeting_booking=true przepuszcza rodzaj meeting_booking'
);

DELETE FROM public.notifications
 WHERE user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid;

-- Reszta pliku sprawdza PRODUCENTOW, wiec preferencje wracaja na domyslne.
UPDATE public.notification_preferences
   SET enabled_introduction = true, enabled_recommendation = true,
       enabled_endorsement = true, enabled_profile_view = true
 WHERE user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid;

-- ---------------------------------------------------------------------------
-- Wprowadzenia (introduction_requests): A -> B (most) -> C (cel)
-- ---------------------------------------------------------------------------
INSERT INTO public.introduction_requests
  (id, tenant_id, requester_id, bridge_id, target_id, message)
VALUES
  ('ad999999-0000-0000-0000-000000000001'::uuid,
   (SELECT public.public_tenant_id()),
   'ad000000-0000-0000-0000-0000000000aa'::uuid,
   'ad000000-0000-0000-0000-0000000000bb'::uuid,
   'ad000000-0000-0000-0000-0000000000cc'::uuid,
   'Prosze o wprowadzenie w sprawie konsorcjum Horizon.');

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000bb'::uuid
      AND n.kind = 'introduction'),
  1,
  'INSERT wprowadzenia powiadamia MOST'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid
      AND n.kind = 'introduction'),
  0,
  'cel NIE dowiaduje sie o prosbie przed decyzja mostu'
);

UPDATE public.introduction_requests SET status = 'forwarded'
 WHERE id = 'ad999999-0000-0000-0000-000000000001'::uuid;

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid
      AND n.kind = 'introduction'),
  1,
  'przekazanie powiadamia CEL'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000aa'::uuid
      AND n.kind = 'introduction'),
  1,
  'przekazanie powiadamia takze PROSZACEGO'
);

SELECT matches(
  (SELECT n.body_pl FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid
      AND n.kind = 'introduction' LIMIT 1),
  'Bartek AD',
  'cel dowiaduje sie, KTO go przedstawia (nazwa mostu w tresci)'
);

INSERT INTO public.introduction_requests
  (id, tenant_id, requester_id, bridge_id, target_id, message, status)
VALUES
  ('ad999999-0000-0000-0000-000000000002'::uuid,
   (SELECT public.public_tenant_id()),
   'ad000000-0000-0000-0000-0000000000cc'::uuid,
   'ad000000-0000-0000-0000-0000000000aa'::uuid,
   'ad000000-0000-0000-0000-0000000000bb'::uuid,
   'Druga prosba o wprowadzenie w innej sprawie.', 'pending');
DELETE FROM public.notifications WHERE kind = 'introduction';
UPDATE public.introduction_requests SET status = 'withdrawn'
 WHERE id = 'ad999999-0000-0000-0000-000000000002'::uuid;

SELECT is(
  (SELECT count(*)::int FROM public.notifications n WHERE n.kind = 'introduction'),
  0,
  'wycofanie prosby przez proszacego jest CISZA'
);

-- ---------------------------------------------------------------------------
-- Rekomendacje (profile_recommendations)
-- ---------------------------------------------------------------------------
INSERT INTO public.profile_recommendations
  (id, tenant_id, recipient_id, author_id, relationship, body)
VALUES
  ('ad888888-0000-0000-0000-000000000001'::uuid,
   (SELECT public.public_tenant_id()),
   'ad000000-0000-0000-0000-0000000000cc'::uuid,
   'ad000000-0000-0000-0000-0000000000aa'::uuid,
   'colleague', 'Wspolpracowalismy przy dossier CBAM - rekomenduje bez zastrzezen.');

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid
      AND n.kind = 'recommendation'),
  1,
  'nowa rekomendacja powiadamia ODBIORCE (moderacja)'
);

UPDATE public.profile_recommendations SET status = 'published'
 WHERE id = 'ad888888-0000-0000-0000-000000000001'::uuid;

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000aa'::uuid
      AND n.kind = 'recommendation'),
  1,
  'publikacja rekomendacji powiadamia AUTORA'
);

SELECT matches(
  (SELECT n.href FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000aa'::uuid
      AND n.kind = 'recommendation' LIMIT 1),
  '/author/celina-ad',
  'href rekomendacji prowadzi na profil, na ktorym stoi tekst'
);

DELETE FROM public.notifications WHERE kind = 'recommendation';
UPDATE public.profile_recommendations SET status = 'hidden'
 WHERE id = 'ad888888-0000-0000-0000-000000000001'::uuid;

SELECT is(
  (SELECT count(*)::int FROM public.notifications n WHERE n.kind = 'recommendation'),
  0,
  'ukrycie rekomendacji przez odbiorce jest CISZA'
);

-- ---------------------------------------------------------------------------
-- Endorsementy (profile_skill_endorsements)
-- ---------------------------------------------------------------------------
INSERT INTO public.profile_skills (id, tenant_id, user_id, label) VALUES
  ('ad777777-0000-0000-0000-000000000001'::uuid,
   (SELECT public.public_tenant_id()),
   'ad000000-0000-0000-0000-0000000000cc'::uuid, 'CBAM'),
  ('ad777777-0000-0000-0000-000000000002'::uuid,
   (SELECT public.public_tenant_id()),
   'ad000000-0000-0000-0000-0000000000cc'::uuid, 'Handel UE');

INSERT INTO public.profile_skill_endorsements
  (tenant_id, skill_id, recipient_id, endorser_id)
VALUES
  ((SELECT public.public_tenant_id()),
   'ad777777-0000-0000-0000-000000000001'::uuid,
   'ad000000-0000-0000-0000-0000000000cc'::uuid,
   'ad000000-0000-0000-0000-0000000000aa'::uuid);

SELECT matches(
  (SELECT n.body_pl FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid
      AND n.kind = 'endorsement' LIMIT 1),
  'CBAM',
  'endorsement mowi, KTORA umiejetnosc potwierdzono'
);

-- Druga umiejetnosc od TEJ SAMEJ osoby w tej samej minucie: dedup patrzy na
-- pare (kind, href), a href niesie skill_id - wiec nie zjada tego zdarzenia.
INSERT INTO public.profile_skill_endorsements
  (tenant_id, skill_id, recipient_id, endorser_id)
VALUES
  ((SELECT public.public_tenant_id()),
   'ad777777-0000-0000-0000-000000000002'::uuid,
   'ad000000-0000-0000-0000-0000000000cc'::uuid,
   'ad000000-0000-0000-0000-0000000000aa'::uuid);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid
      AND n.kind = 'endorsement'),
  2,
  'href z skill_id chroni drugie potwierdzenie od dedupu 5-minutowego'
);

DELETE FROM public.profile_skill_endorsements
 WHERE skill_id = 'ad777777-0000-0000-0000-000000000001'::uuid;

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000cc'::uuid
      AND n.kind = 'endorsement'),
  2,
  'wycofanie potwierdzenia jest CISZA (bez nowego powiadomienia)'
);

-- ---------------------------------------------------------------------------
-- Odslony profilu: skan cykliczny ze znakiem wodnym
--
-- Czyscimy odslony i znaki wodne z seeda, bo run_profile_view_alerts jest
-- skanem GLOBALNYM - jego zwrotka musi byc deterministyczna, zeby asercja
-- "drugi przebieg nie wysyla nic" cokolwiek dowodzila.
-- ---------------------------------------------------------------------------
DELETE FROM public.notifications;
DELETE FROM public.profile_view_alert_state;
DELETE FROM public.profile_view_events;

INSERT INTO public.profile_view_events
  (tenant_id, profile_id, viewer_id, viewer_mode, viewer_snapshot, viewed_at)
VALUES
  ((SELECT public.public_tenant_id()),
   'ad000000-0000-0000-0000-0000000000aa'::uuid,
   'ad000000-0000-0000-0000-0000000000bb'::uuid, 'public',
   jsonb_build_object('display_name', 'Bartek AD'), now() - interval '2 hours'),
  ((SELECT public.public_tenant_id()),
   'ad000000-0000-0000-0000-0000000000aa'::uuid,
   NULL, 'anonymous', NULL, now() - interval '1 hour');

SELECT is(
  public.run_profile_view_alerts(),
  1,
  'run_profile_view_alerts wysyla jeden zbiorczy sygnal na profil'
);

SELECT matches(
  (SELECT n.title_pl FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000aa'::uuid
      AND n.kind = 'profile_view' LIMIT 1),
  '2',
  'tytul niesie LICZBE odslon, nie pojedyncze zdarzenie'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.profile_view_alert_state s
           WHERE s.user_id = 'ad000000-0000-0000-0000-0000000000aa'::uuid),
  'przebieg stempluje znak wodny profile_view_alert_state'
);

SELECT is(
  public.run_profile_view_alerts(),
  0,
  'drugi przebieg w tej samej dobie nie wysyla nic (znak wodny + okno 20 h)'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000aa'::uuid
      AND n.kind = 'profile_view'),
  1,
  'brak duplikatu sygnalu o odslonach'
);

-- ---------------------------------------------------------------------------
-- Spotkania 1-1: rodzaj 'meeting_booking' i DRUGA strona wymiany
-- ---------------------------------------------------------------------------
DELETE FROM public.notifications;

INSERT INTO public.meeting_slots (id, tenant_id, host_user_id, starts_at, ends_at, is_public)
VALUES ('ad666666-0000-0000-0000-000000000001'::uuid,
        (SELECT public.public_tenant_id()),
        'ad000000-0000-0000-0000-0000000000aa'::uuid,
        now() + interval '2 days', now() + interval '2 days 30 minutes', true);

SELECT set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.book_meeting_slot('ad666666-0000-0000-0000-000000000001'::uuid, NULL)$$,
  'rezerwacja slotu przechodzi'
);

SELECT is(
  (SELECT n.kind FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000aa'::uuid LIMIT 1),
  'meeting_booking'::text,
  'rezerwacja uzywa dedykowanego rodzaju meeting_booking (nie ogolnego content)'
);

SELECT matches(
  (SELECT n.body_pl FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000aa'::uuid
      AND n.kind = 'meeting_booking' LIMIT 1),
  'Bartek AD',
  'host wie, KTO zarezerwowal jego czas'
);

DELETE FROM public.notifications;

SELECT lives_ok(
  $$SELECT public.cancel_my_meeting_booking('ad666666-0000-0000-0000-000000000001'::uuid)$$,
  'anulowanie wlasnej rezerwacji przechodzi'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ad000000-0000-0000-0000-0000000000aa'::uuid
      AND n.kind = 'meeting_booking'),
  1,
  'anulowanie powiadamia HOSTA o zwolnionym slocie'
);

SELECT set_config('request.jwt.claims', NULL, true);

-- ---------------------------------------------------------------------------
-- ACL producenta i tabeli stanu
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon',
    'public.run_profile_view_alerts(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.run_profile_view_alerts(integer)', 'EXECUTE'),
  'run_profile_view_alerts wylacznie dla service_role'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.profile_view_alert_state', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.profile_view_alert_state', 'SELECT'),
  'profile_view_alert_state bez grantow klienckich'
);

SELECT * FROM finish();
ROLLBACK;
