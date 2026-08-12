-- pgTAP: każdy przełącznik preferencji powiadomień REALNIE tłumi swój rodzaj.
--
-- Blokuje regresję "martwych przełączników": enqueue_notification (wspólny
-- producent wołany przez WSZYSTKIE 22 funkcje-producentów: message/comment/
-- follow/subscription/content/system/tracker/connection/saved_search/crm_task)
-- musi pominąć wstawienie, gdy odbiorca wyłączył dany rodzaj, a 'security' ma
-- docierać ZAWSZE (przełącznik always-on).
--
-- Zakres (po rozszerzeniu katalogu rodzajów do 11):
--   1. Komplet rodzajów jawnie - dla KAŻDEGO z 10 przełączalnych: włączony =>
--      wstawia, wyłączony => pomija. Wcześniej test kończył się na 'system',
--      więc gałęzie tracker/connection/saved_search/crm_task w CASE nie były
--      niczym przykryte.
--   2. Parytet strukturalny CZTERECH nóg kontraktu rodzaju: katalog
--      (`notifications_kind_check`) <-> kolumny `enabled_<rodzaj>` <-> gałęzie
--      `WHEN '<rodzaj>' THEN np.enabled_<rodzaj>` w źródle producenta <->
--      rodzaje, które PRODUCENCI faktycznie emitują. Trzy pierwsze nogi żyły
--      w osobnych migracjach i rozjechały się (dryf `meeting` vs
--      `meeting_booking`, 20260807140000 -> 20260812091000); czwarta jest
--      jedyną, która łapie regres U ŹRÓDŁA: producent emitujący rodzaj spoza
--      katalogu łamie CHECK, a `EXCEPTION WHEN OTHERS` połyka błąd, więc
--      powiadomienie ginie bez śladu w zachowaniu i w logu testów.
--   3. Sweep behawioralny sterowany katalogiem: 11. rodzaj dodany do CHECK-a
--      bez gałęzi w CASE (ELSE true => przeciek) albo bez kolumny wywala ten
--      test SAM Z SIEBIE, bez dopisywania asercji.
--   4. Bramka czyta preferencje ODBIORCY (p_user_id), nie wołającego
--      (auth.uid()) - klasyczna pomyłka w SECURITY DEFINER.
--   5. Fail-open bez wiersza preferencji (świeże konto nie gubi powiadomień).
--   6. Stempel tenanta bierze się z profilu ODBIORCY, nie z tenanta wołającego,
--      a RLS nie pokazuje cudzego powiadomienia (izolacja obszarów roboczych).
--   7. ACL producenta: enqueue_notification jest wyłącznie serwerowy
--      (service_role + funkcje SECURITY DEFINER). Grant dla `authenticated`
--      pozwalał dowolnemu zalogowanemu wstrzyknąć dowolną treść do skrzynki
--      dowolnego użytkownika w dowolnym tenancie - patrz migracja
--      20260803090000_harden_enqueue_notification_acl.sql.
--   8. Odporność wywołania z triggera: NULL/pusty/nieznany rodzaj zwraca NULL
--      zamiast wyjątku (wyjątek przerwałby zapis użytkownika, np. komentarz).
--   9. Dedup 5-minutowy po (user, kind, href).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(44);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1111111-1111-1111-1111-1111111100ff', 'prefs-tenant', 'Prefs Tenant'),
  ('c1111111-1111-1111-1111-1111111100fe', 'prefs-tenant-b', 'Prefs Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-0000000000ff', 'prefs@test.test'),
  ('c0000000-0000-0000-0000-0000000000fe', 'peer@test.test'),
  ('c0000000-0000-0000-0000-0000000000fd', 'other-tenant@test.test'),
  ('c0000000-0000-0000-0000-0000000000fc', 'no-prefs@test.test'),
  ('c0000000-0000-0000-0000-0000000000fb', 'sweep@test.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c0000000-0000-0000-0000-0000000000ff', 'prefs@test.test', 'Prefs User',
   'c1111111-1111-1111-1111-1111111100ff'),
  ('c0000000-0000-0000-0000-0000000000fe', 'peer@test.test', 'Peer User',
   'c1111111-1111-1111-1111-1111111100ff'),
  ('c0000000-0000-0000-0000-0000000000fd', 'other-tenant@test.test', 'Other Tenant User',
   'c1111111-1111-1111-1111-1111111100fe'),
  ('c0000000-0000-0000-0000-0000000000fc', 'no-prefs@test.test', 'No Prefs User',
   'c1111111-1111-1111-1111-1111111100ff'),
  ('c0000000-0000-0000-0000-0000000000fb', 'sweep@test.test', 'Sweep User',
   'c1111111-1111-1111-1111-1111111100ff');

-- Wiersze preferencji: komplet flag na true (kolumny mają DEFAULT true, więc
-- wystarczy user_id + tenant_id; 'c...fc' CELOWO bez wiersza - fail-open).
INSERT INTO public.notification_preferences (user_id, tenant_id) VALUES
  ('c0000000-0000-0000-0000-0000000000ff', 'c1111111-1111-1111-1111-1111111100ff'),
  ('c0000000-0000-0000-0000-0000000000fe', 'c1111111-1111-1111-1111-1111111100ff'),
  ('c0000000-0000-0000-0000-0000000000fd', 'c1111111-1111-1111-1111-1111111100fe'),
  ('c0000000-0000-0000-0000-0000000000fb', 'c1111111-1111-1111-1111-1111111100ff');

-- ── 1. Komplet rodzajów jawnie ──────────────────────────────────────────────
-- enqueue_notification jest SECURITY DEFINER, bierze odbiorcę wprost i czyta
-- jego tenant z profilu; wołamy jako właściciel (tak jak robią to triggery).
-- Każde wywołanie ma UNIKALNY href, by ominąć 5-min dedup po (user,kind,href).

-- message
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'message',
    't', 't', 'b', 'b', '/m-on', 'i'),
  NULL, 'message włączony: powiadomienie wstawione');
UPDATE public.notification_preferences SET enabled_message = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'message',
    't', 't', 'b', 'b', '/m-off', 'i'),
  NULL, 'message wyłączony: powiadomienie pominięte');

-- comment
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'comment',
    't', 't', 'b', 'b', '/c-on', 'i'),
  NULL, 'comment włączony: wstawione');
UPDATE public.notification_preferences SET enabled_comment = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'comment',
    't', 't', 'b', 'b', '/c-off', 'i'),
  NULL, 'comment wyłączony: pominięte');

-- follow
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'follow',
    't', 't', 'b', 'b', '/f-on', 'i'),
  NULL, 'follow włączony: wstawione');
UPDATE public.notification_preferences SET enabled_follow = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'follow',
    't', 't', 'b', 'b', '/f-off', 'i'),
  NULL, 'follow wyłączony: pominięte');

-- subscription
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'subscription',
    't', 't', 'b', 'b', '/s-on', 'i'),
  NULL, 'subscription włączony: wstawione');
UPDATE public.notification_preferences SET enabled_subscription = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'subscription',
    't', 't', 'b', 'b', '/s-off', 'i'),
  NULL, 'subscription wyłączony: pominięte');

-- content
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'content',
    't', 't', 'b', 'b', '/ct-on', 'i'),
  NULL, 'content włączony: wstawione');
UPDATE public.notification_preferences SET enabled_content = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'content',
    't', 't', 'b', 'b', '/ct-off', 'i'),
  NULL, 'content wyłączony: pominięte');

-- system
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'system',
    't', 't', 'b', 'b', '/sys-on', 'i'),
  NULL, 'system włączony: wstawione');
UPDATE public.notification_preferences SET enabled_system = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'system',
    't', 't', 'b', 'b', '/sys-off', 'i'),
  NULL, 'system wyłączony: pominięte');

-- connection (producent: tg_user_connections_notify - zaproszenia do sieci)
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'connection',
    't', 't', 'b', 'b', '/cn-on', 'i'),
  NULL, 'connection włączony: wstawione');
UPDATE public.notification_preferences SET enabled_connection = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'connection',
    't', 't', 'b', 'b', '/cn-off', 'i'),
  NULL, 'connection wyłączony: pominięte');

-- tracker (producent: tg_eu_policy_update_applied - zmiana etapu dossier)
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'tracker',
    't', 't', 'b', 'b', '/tr-on', 'i'),
  NULL, 'tracker włączony: wstawione');
UPDATE public.notification_preferences SET enabled_tracker = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'tracker',
    't', 't', 'b', 'b', '/tr-off', 'i'),
  NULL, 'tracker wyłączony: pominięte');

-- saved_search (producent: run_saved_search_alerts - alerty zapisanych wyszukiwań)
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'saved_search',
    't', 't', 'b', 'b', '/ss-on', 'i'),
  NULL, 'saved_search włączony: wstawione');
UPDATE public.notification_preferences SET enabled_saved_search = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'saved_search',
    't', 't', 'b', 'b', '/ss-off', 'i'),
  NULL, 'saved_search wyłączony: pominięte');

-- crm_task (producent: run_crm_task_reminders - przypomnienia o follow-upach)
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'crm_task',
    't', 't', 'b', 'b', '/ct-task-on', 'i'),
  NULL, 'crm_task włączony: wstawione');
UPDATE public.notification_preferences SET enabled_crm_task = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'crm_task',
    't', 't', 'b', 'b', '/ct-task-off', 'i'),
  NULL, 'crm_task wyłączony: pominięte');

-- ── 2. security: always-on ──────────────────────────────────────────────────
UPDATE public.notification_preferences SET enabled_security = false
  WHERE user_id = 'c0000000-0000-0000-0000-0000000000ff';
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'security',
    't', 't', 'b', 'b', '/sec', 'i'),
  NULL, 'security dociera ZAWSZE, nawet przy wyłączonym przełączniku');

-- ── 3. Parytet strukturalny: katalog rodzajów <-> kolumny-flagi ─────────────
-- Źródłem prawdy dla obu stron jest schemat, nie lista w teście - dzięki temu
-- dorzucenie 11. rodzaju bez kolumny (albo kolumny bez rodzaju) jest czerwone.

CREATE FUNCTION pg_temp.allowed_kinds() RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(array_agg(DISTINCT m[1] ORDER BY m[1]), '{}'::text[])
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
   WHERE c.conrelid = 'public.notifications'::regclass
     AND c.conname = 'notifications_kind_check';
$fn$;

CREATE FUNCTION pg_temp.flag_kinds() RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(array_agg(substring(column_name FROM 9) ORDER BY column_name), '{}'::text[])
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'notification_preferences'
     AND column_name LIKE 'enabled\_%'
     AND data_type = 'boolean';
$fn$;

SELECT is(
  ARRAY(SELECT k FROM unnest(pg_temp.allowed_kinds()) AS k
         WHERE k <> 'security' AND NOT (k = ANY (pg_temp.flag_kinds())) ORDER BY k),
  ARRAY[]::text[],
  'każdy rodzaj z notifications_kind_check (poza security) ma kolumnę enabled_<rodzaj>');

SELECT is(
  ARRAY(SELECT k FROM unnest(pg_temp.flag_kinds()) AS k
         WHERE NOT (k = ANY (pg_temp.allowed_kinds())) ORDER BY k),
  ARRAY[]::text[],
  'żadna kolumna enabled_<x> nie wisi bez rodzaju w katalogu');

-- ── 3b. Parytet ŹRÓDŁOWY: katalog <-> gałęzie CASE <-> producenci ───────────
-- Sweep behawioralny niżej łapie rodzaj, który PRZECIEKA (gałąź w `ELSE true`),
-- ale nie łapie rodzaju, którego producent emituje POZA katalogiem: taki nigdy
-- nie dociera, więc "brak powiadomienia" wygląda jak wyłączony przełącznik.
-- Dokładnie tak zniknęły spotkania 1-1: trigger tg_meeting_booking_notify
-- kolejkował 'meeting_booking', katalog znał wyłącznie 'meeting', a CHECK padał
-- wewnątrz `EXCEPTION WHEN OTHERS THEN RETURN NULL`.
--
-- Te asercje czytają ŹRÓDŁO funkcji z katalogu systemowego, nie plik migracji,
-- więc kolejny "powrót do wcześniejszej wersji funkcji" (a tak powstał ten
-- regres - leksykograficznie późniejsza migracja odtworzyła starsze ciało) jest
-- czerwony niezależnie od tego, która migracja go wprowadzi.

CREATE FUNCTION pg_temp.case_branches() RETURNS TABLE(kind text, col text)
LANGUAGE sql STABLE AS $fn$
  SELECT m[1], m[2]
    FROM regexp_matches(
           pg_get_functiondef(
             'public.enqueue_notification(uuid,text,text,text,text,text,text,text)'::regprocedure),
           'WHEN\s+''([a-z_]+)''\s+THEN\s+np\.enabled_([a-z_]+)', 'g') AS m;
$fn$;

-- Rodzaje wołane z ciał funkcji w `public` - drugi argument
-- enqueue_notification podany LITERAŁEM. Wywołania przekazujące rodzaj zmienną
-- (np. sweep w tym pliku) nie pasują do wzorca i są pomijane: asercja jest
-- zachowawcza, ma nie mieć fałszywych trafień.
CREATE FUNCTION pg_temp.emitted_kinds() RETURNS TABLE(fn text, kind text)
LANGUAGE sql STABLE AS $fn$
  SELECT p.proname::text, m[1]
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN LATERAL regexp_matches(
           p.prosrc, 'enqueue_notification\s*\(\s*[^,]+,\s*''([a-z_]+)''', 'g') AS m
   WHERE n.nspname = 'public'
     AND p.proname <> 'enqueue_notification';
$fn$;

SELECT is(
  ARRAY(SELECT k FROM unnest(pg_temp.allowed_kinds()) AS k
         WHERE k <> 'security'
           AND NOT EXISTS (SELECT 1 FROM pg_temp.case_branches() b
                            WHERE b.kind = k AND b.col = k)
         ORDER BY k),
  ARRAY[]::text[],
  'każdy rodzaj z katalogu ma w bramce gałąź czytającą WŁASNĄ kolumnę enabled_<rodzaj>');

SELECT is(
  ARRAY(SELECT DISTINCT b.kind || ' -> enabled_' || b.col FROM pg_temp.case_branches() b
         WHERE b.col <> b.kind OR NOT (b.kind = ANY (pg_temp.allowed_kinds()))
         ORDER BY 1),
  ARRAY[]::text[],
  'żadna gałąź bramki nie czyta obcej kolumny ani rodzaju spoza katalogu');

SELECT is(
  ARRAY(SELECT DISTINCT e.fn || ' -> ' || e.kind FROM pg_temp.emitted_kinds() e
         WHERE NOT (e.kind = ANY (pg_temp.allowed_kinds())) ORDER BY 1),
  ARRAY[]::text[],
  'żaden producent nie emituje rodzaju spoza katalogu (inaczej CHECK ginie w połkniętym wyjątku)');

-- Alias porzucony przy ujednoliceniu (20260812091000). Klient nie zna rodzaju
-- 'meeting' - nie ma dla niego ikony, etykiety i18n ani sekcji digestu - więc
-- jego powrót do katalogu albo do kolumn odtwarza dryf, przechodząc wszystkie
-- asercje wyżej (byłby rodzajem "poprawnym", tylko niewidocznym w UI).
SELECT is(
  ARRAY(SELECT x FROM unnest(ARRAY['meeting']) AS x
         WHERE x = ANY (pg_temp.allowed_kinds()) OR x = ANY (pg_temp.flag_kinds())
         ORDER BY x),
  ARRAY[]::text[],
  'porzucony alias rodzaju spotkań nie wraca ani do katalogu, ani do kolumn preferencji');

-- ── 4. Sweep behawioralny sterowany katalogiem ──────────────────────────────
-- Dla KAŻDEGO rodzaju z CHECK-a (poza security) ustawia flagę i sprawdza, czy
-- producent zachował się zgodnie z kontraktem. Zwraca rodzaje, które kontrakt
-- ŁAMIĄ - pusta tablica to jedyny poprawny wynik.

CREATE FUNCTION pg_temp.gating_violations(p_user uuid, p_flag boolean) RETURNS text[]
LANGUAGE plpgsql AS $fn$
DECLARE
  v_kind text;
  v_id uuid;
  v_bad text[] := '{}'::text[];
BEGIN
  FOREACH v_kind IN ARRAY pg_temp.allowed_kinds() LOOP
    CONTINUE WHEN v_kind = 'security';
    -- Rodzaj bez kolumny-flagi raportuje asercja parytetu wyżej; tutaj tylko
    -- go omijamy, żeby dynamiczny UPDATE nie wywrócił całego pliku.
    CONTINUE WHEN NOT (v_kind = ANY (pg_temp.flag_kinds()));
    EXECUTE format(
      'UPDATE public.notification_preferences SET %I = $1 WHERE user_id = $2',
      'enabled_' || v_kind
    ) USING p_flag, p_user;
    v_id := public.enqueue_notification(
      p_user, v_kind, 'sweep', 'sweep', NULL, NULL,
      '/sweep/' || v_kind || '/' || p_flag::text, NULL);
    -- Włączony, a nie dotarł ALBO wyłączony, a przeciekł.
    IF (p_flag AND v_id IS NULL) OR (NOT p_flag AND v_id IS NOT NULL) THEN
      v_bad := v_bad || v_kind;
    END IF;
  END LOOP;
  RETURN v_bad;
END;
$fn$;

SELECT is(
  pg_temp.gating_violations('c0000000-0000-0000-0000-0000000000fb', false),
  ARRAY[]::text[],
  'każdy rodzaj z katalogu jest TŁUMIONY przy wyłączonej fladze (bez wyjątków)');

SELECT is(
  pg_temp.gating_violations('c0000000-0000-0000-0000-0000000000fb', true),
  ARRAY[]::text[],
  'każdy rodzaj z katalogu DOCIERA przy włączonej fladze (kontrola pozytywna)');

-- ── 5. Bramka czyta preferencje ODBIORCY, nie wołającego ────────────────────
-- Wcielenie się w wołającego (claims) bez zmiany roli: enqueue_notification
-- jest SECURITY DEFINER, więc liczy się WYŁĄCZNIE p_user_id. Regresja
-- "WHERE user_id = auth.uid()" wyciszyłaby cudze powiadomienia.

-- Wołający 'c...ff' ma WSZYSTKO wyłączone, odbiorca 'c...fe' - włączone.
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000fe', 'crm_task',
    't', 't', 'b', 'b', '/peer-on', 'i'),
  NULL, 'odbiorca z włączoną flagą dostaje powiadomienie, choć wołający ma ją wyłączoną');

-- Odwrotnie: wołający z włączoną flagą nie przepycha powiadomienia do odbiorcy,
-- który ją wyłączył.
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000fe","role":"authenticated"}', true);
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'crm_task',
    't', 't', 'b', 'b', '/main-off', 'i'),
  NULL, 'odbiorca z wyłączoną flagą nie dostaje nic, choć wołający ma ją włączoną');

-- ── 6. Fail-open bez wiersza preferencji ────────────────────────────────────
-- Świeże konto nie ma jeszcze wiersza (upsert powstaje przy pierwszym zapisie
-- ustawień) - brak wiersza NIE MOŻE oznaczać ciszy.
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000fc', 'crm_task',
    't', 't', 'b', 'b', '/no-prefs', 'i'),
  NULL, 'brak wiersza preferencji: powiadomienie dociera (fail-open)');

-- ── 7. Stempel tenanta = tenant ODBIORCY + izolacja RLS ─────────────────────
-- Wołający z tenanta B kolejkuje powiadomienie dla odbiorcy z tenanta A
-- (rodzaj 'security', żeby wynik nie zależał od flag ustawionych wyżej).
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000fd","role":"authenticated"}', true);

-- Identyfikator wędruje przez GUC transakcyjny, a nie tabelę tymczasową:
-- po SET LOCAL ROLE tabela pg_temp należałaby do innego właściciela.
SELECT set_config('tests.cross_tenant_note',
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000ff', 'security',
    't', 't', 'b', 'b', '/cross-tenant', 'i')::text, true);

SELECT is(
  (SELECT n.tenant_id FROM public.notifications n
    WHERE n.id = current_setting('tests.cross_tenant_note')::uuid),
  'c1111111-1111-1111-1111-1111111100ff'::uuid,
  'powiadomienie stemplowane tenantem ODBIORCY, nie wołającego z obcego tenanta');

-- RLS: wołający z tenanta B nie widzi wyprodukowanego wiersza...
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.id = current_setting('tests.cross_tenant_note')::uuid),
  0, 'obcy tenant nie odczyta powiadomienia, które wyprodukował');

-- ...a odbiorca widzi je u siebie (kontrola pozytywna dla polityki SELECT).
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.id = current_setting('tests.cross_tenant_note')::uuid),
  1, 'odbiorca widzi swoje powiadomienie w swoim tenancie');
RESET ROLE;

-- ── 8. ACL producenta: wyłącznie serwerowy ──────────────────────────────────
-- enqueue_notification wstawia DOWOLNĄ treść (tytuł, treść, href) do skrzynki
-- DOWOLNEGO user_id - to kanał phishingowy, jeśli wystawić go klientowi.
-- Wszystkie 22 funkcje-producenci są SECURITY DEFINER, więc grant dla ról
-- klienckich jest zbędny.
SELECT ok(
  NOT has_function_privilege('anon',
    'public.enqueue_notification(uuid,text,text,text,text,text,text,text)', 'EXECUTE'),
  'anon NIE MOŻE wołać enqueue_notification');
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.enqueue_notification(uuid,text,text,text,text,text,text,text)', 'EXECUTE'),
  'authenticated NIE MOŻE wołać enqueue_notification (brak wstrzykiwania powiadomień)');
SELECT ok(
  has_function_privilege('service_role',
    'public.enqueue_notification(uuid,text,text,text,text,text,text,text)', 'EXECUTE'),
  'service_role zachowuje EXECUTE (runnery zadań tła)');

-- ── 9. Odporność wywołania z triggera ───────────────────────────────────────
-- Producent wisi na triggerach zapisu użytkownika (komentarz, obserwacja,
-- wiadomość). Wyjątek z tej funkcji przerwałby CAŁĄ transakcję użytkownika,
-- więc kontrakt brzmi: zawsze NULL zamiast błędu.
SELECT is(
  public.enqueue_notification(NULL, 'message', 't', 't', 'b', 'b', '/nil', 'i'),
  NULL, 'brak odbiorcy: NULL zamiast wyjątku');
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000fe', '   ',
    't', 't', 'b', 'b', '/blank', 'i'),
  NULL, 'pusty rodzaj: NULL zamiast wyjątku');
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000fe', 'bogus_kind',
    't', 't', 'b', 'b', '/bogus', 'i'),
  NULL, 'rodzaj spoza katalogu: NULL zamiast naruszenia CHECK-a');
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000fe', 'system',
    't', 't', 'b', 'b', '/after-bogus', 'i'),
  NULL, 'transakcja pozostaje sprawna po odrzuconym rodzaju');

-- ── 10. Dedup 5-minutowy po (user, kind, href) ──────────────────────────────
SELECT isnt(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000fe', 'follow',
    't', 't', 'b', 'b', '/dedup', 'i'),
  NULL, 'pierwsze powiadomienie o danym href przechodzi');
SELECT is(
  public.enqueue_notification('c0000000-0000-0000-0000-0000000000fe', 'follow',
    't', 't', 'b', 'b', '/dedup', 'i'),
  NULL, 'powtórka tego samego (user, kind, href) w oknie 5 minut jest pomijana');

SELECT * FROM finish();
ROLLBACK;
