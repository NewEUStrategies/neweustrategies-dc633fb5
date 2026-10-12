-- pgTAP: metering - PRAWDZIWA wspolbieznosc dwoch sesji (audyt billingowy
-- SUB-17, kryterium "rownolegle zadania nie przekraczaja limitu"; przeglad
-- adwersaryjny, poz. 30). Migracja 20261012110200_metering_signed_visitor_ip_limit.sql.
--
-- PO CO TEN PLIK ISTNIEJE
-- metering_visitor_identity_test.sql dowodzi blokady przez pg_locks PO
-- powrocie RPC, w tej samej transakcji. Blokada doradcza transakcyjna jest
-- trzymana do COMMIT i wspolbiezna w jednym procesie, wiec taka asercja
-- przechodzi GDZIEKOLWIEK w ciele stoi pg_advisory_xact_lock - takze ZA
-- count(*)/INSERT, czyli przy powrocie wyscigu SUB-17. Tu dwie osobne sesje
-- (dblink) wolaja rdzen naprawde rownolegle:
--   * sesja A konsumuje slot i NIE zatwierdza (trzyma blokady),
--   * sesja B wola konsumpcje innego bytu - musi ZAWISNAC na blokadzie
--     doradczej (dowod z pg_stat_activity: wait_event = 'advisory'),
--   * A zatwierdza; B liczy dopiero teraz i widzi slot A -> odmowa.
-- Gdyby blokada stala za zliczeniem, B policzylby 0 jeszcze przed
-- zawisnieciem, a po COMMIT A wstawilby drugi wiersz - asercja "odmowa"
-- i "dokladnie limit wierszy" pada. Dwa scenariusze:
--   1. ten sam gosc, dwa rozne byty, limit goscia 1 (blokada PODMIOTU),
--   2. dwoch roznych gosci z jednego adresu przy suficie adresu
--      (5 x 1 = 5 bytow; 4 juz zajete) - blokada ADRESU; odmowa B niesie
--      requires_registration = true (wlasny limit nietkniety).
--
-- DLACZEGO SCENOGRAFIA JEST ZATWIERDZONA. Druga sesja nie widzi cudzej
-- otwartej transakcji (BEGIN pgTAP), wiec dane leca przez trzecia sesje
-- dblink w autocommit - na dedykowanym najemcy, ktorego plik sprzata na
-- poczatku (po ewentualnym przerwanym przebiegu) i na koncu (takze po bledzie
-- asercji). Konto nie jest testowane wspolbieznie: wymagaloby
-- zatwierdzonego wiersza auth.users (triggery rejestracji); konto i gosc
-- dziela te sama linie blokady podmiotu w rdzeniu, a kolejnosc "blokada przed
-- zliczeniem" pilnuje tez asercja strukturalna w metering_visitor_identity_test.sql.
--
-- GDZIE BIEGNIE. Lokalny harness (scripts/pgtap-local/run.sh: superuser,
-- gniazdo unix) i CI (`supabase test db`): dblink jest w obrazie Supabase,
-- a rola postgres nie jest tam superuserem, wiec polaczenie idzie TCP
-- z haslem domyslnej bazy lokalnej (postgres/postgres) na adres, na ktorym
-- przyszla sesja testowa (inet_server_addr - loopback bywa tam `trust`,
-- a dblink nie-superusera wymaga uzytego hasla). Gdy zadna droga nie dziala
-- (brak rozszerzenia, inne haslo), plik oznacza asercje jako SKIP z powodem
-- w diagnostyce - nie udaje zielonego dowodu, ale nie blokuje CI srodowiska
-- bez dblink. Zawsze aktywna zostaje asercja strukturalna (tamten plik).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(9);

-- dblink w biezacej transakcji (ROLLBACK na koncu zdejmuje go, jesli to my
-- go zalozylismy). Brak uprawnien/rozszerzenia nie przerywa pliku.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'dblink') THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
      CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
    ELSE
      CREATE EXTENSION IF NOT EXISTS dblink;
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'dblink niedostepny: %', SQLERRM;
END $$;

-- Schemat rozszerzenia na sciezce wyszukiwania tej transakcji (bez wiersza
-- wyniku - wyjscie pliku to czysty TAP).
DO $$
BEGIN
  PERFORM set_config('search_path',
    current_setting('search_path') || ', ' || quote_ident(n.nspname), true)
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'dblink';
END $$;

-- Laczy nazwane polaczenie pierwsza dzialajaca droga; NULL = brak drogi.
CREATE FUNCTION pg_temp.mc_connect(p_name text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_candidates text[] := ARRAY[]::text[];
  v_conn text;
  v_errors text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'dblink') THEN
    RETURN NULL;
  END IF;
  -- 1) gniazdo unix jako biezaca rola (lokalny harness: superuser, trust),
  v_candidates := v_candidates || format('host=%s port=%s dbname=%s user=%s',
    split_part(current_setting('unix_socket_directories'), ',', 1),
    current_setting('port'), current_database(), current_user);
  -- 2) adres sesji testowej z haslem bazy lokalnej Supabase (CI),
  IF inet_server_addr() IS NOT NULL THEN
    v_candidates := v_candidates || format('host=%s port=%s dbname=%s user=postgres password=postgres',
      host(inet_server_addr()), inet_server_port(), current_database());
  END IF;
  -- 3) loopback z haslem.
  v_candidates := v_candidates || format('host=127.0.0.1 port=%s dbname=%s user=postgres password=postgres',
    current_setting('port'), current_database());
  FOREACH v_conn IN ARRAY v_candidates LOOP
    BEGIN
      EXECUTE 'SELECT dblink_connect($1, $2)' USING p_name, v_conn;
      RETURN v_conn;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || ' | ' || SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'dblink: brak polaczenia (%)', v_errors;
  RETURN NULL;
END $$;

-- Czeka, az proces p_pid zawisnie na blokadzie DORADCZEJ (max ~10 s).
CREATE FUNCTION pg_temp.mc_waits_on_advisory(p_pid integer) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  i integer := 0;
BEGIN
  WHILE i < 200 LOOP
    PERFORM pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1 FROM pg_stat_activity
       WHERE pid = p_pid AND wait_event_type = 'Lock' AND wait_event = 'advisory'
    ) THEN
      RETURN true;
    END IF;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
  RETURN false;
END $$;

-- Sprzatanie zatwierdzonej scenografii (sesja autocommit).
CREATE FUNCTION pg_temp.mc_cleanup() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SELECT dblink_exec(''mc_seed'', $sql$
    DELETE FROM public.metering_event_log WHERE tenant_id = ''a7000000-0000-0000-0000-0000000000aa'';
    DELETE FROM public.metered_views      WHERE tenant_id = ''a7000000-0000-0000-0000-0000000000aa'';
    DELETE FROM public.content_access     WHERE tenant_id = ''a7000000-0000-0000-0000-0000000000aa'';
    DELETE FROM public.metering_settings  WHERE tenant_id = ''a7000000-0000-0000-0000-0000000000aa'';
    DELETE FROM public.pages              WHERE tenant_id = ''a7000000-0000-0000-0000-0000000000aa'';
    DELETE FROM public.tenants            WHERE id        = ''a7000000-0000-0000-0000-0000000000aa'';
  $sql$)';
END $$;

-- Jedna konsumpcja goscia jako zapytanie tekstowe (dla obu sesji).
CREATE FUNCTION pg_temp.mc_consume_sql(p_page integer, p_visitor text, p_ip text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT format(
    'SELECT granted, requires_registration FROM public.consume_metered_view_visitor(%L, %L, %L, %L, %L)',
    'a7000000-0000-0000-0000-0000000000aa', 'page',
    'a7000000-0000-0000-0000-0000000002' || lpad(p_page::text, 2, '0'),
    p_visitor, p_ip);
$$;

CREATE FUNCTION pg_temp.mc_run() RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE
  v_ip_y text := 'ip:' || substr(md5('mc-adres-y'), 1, 32);
  v_ip_x text := 'ip:' || substr(md5('mc-adres-x'), 1, 32);
  v_a_pid integer;
  v_b_pid integer;
  v_a_granted boolean;
  v_b_granted boolean;
  v_b_reg boolean;
  v_waited boolean;
BEGIN
  IF pg_temp.mc_connect('mc_seed') IS NULL THEN
    RETURN NEXT skip('dblink niedostepny w tym srodowisku - dowod wspolbieznosci pominiety '
      || '(asercja strukturalna w metering_visitor_identity_test.sql nadal biegnie)', 9);
    RETURN;
  END IF;
  PERFORM pg_temp.mc_connect('mc_a');
  PERFORM pg_temp.mc_connect('mc_b');

  BEGIN
    -- Scenografia (zatwierdzona): najemca, 8 platnych stron, limit goscia 1
    -- (sufit adresu 5), adres X ma juz 4 rozne strony od innych gosci.
    PERFORM pg_temp.mc_cleanup();
    PERFORM dblink_exec('mc_seed', $sql$
      INSERT INTO public.tenants (id, slug, name, is_default)
      VALUES ('a7000000-0000-0000-0000-0000000000aa', 'meter-concurrency-tenant',
              'Meter Concurrency Tenant', false);
      INSERT INTO public.pages (id, tenant_id, slug, status, content_pl)
      SELECT ('a7000000-0000-0000-0000-0000000002' || lpad(g::text, 2, '0'))::uuid,
             'a7000000-0000-0000-0000-0000000000aa', 'meter-concurrency-' || g,
             'published', '<p>Strona ' || g || '</p>'
        FROM generate_series(1, 8) AS g;
      INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode, plan_ids, metering_policy)
      SELECT 'a7000000-0000-0000-0000-0000000000aa', 'page',
             ('a7000000-0000-0000-0000-0000000002' || lpad(g::text, 2, '0'))::uuid,
             'paid', '{}', 'inherit'
        FROM generate_series(1, 8) AS g;
      INSERT INTO public.metering_settings
        (tenant_id, enabled, member_monthly_limit, anon_monthly_limit, meter_paid, meter_members, show_counter)
      VALUES ('a7000000-0000-0000-0000-0000000000aa', true, 2, 1, true, true, true)
      ON CONFLICT (tenant_id) DO UPDATE
        SET enabled = true, member_monthly_limit = 2, anon_monthly_limit = 1,
            meter_paid = true, meter_members = true, show_counter = true;
    $sql$);
    PERFORM dblink_exec('mc_seed', format($sql$
      INSERT INTO public.metered_views (tenant_id, visitor_id, entity_type, entity_id, ip_subject)
      SELECT 'a7000000-0000-0000-0000-0000000000aa',
             ('a7000000-0000-0000-0000-0000000c00' || lpad(g::text, 2, '0'))::uuid, 'page',
             ('a7000000-0000-0000-0000-0000000002' || lpad(g::text, 2, '0'))::uuid, %L
        FROM generate_series(1, 4) AS g
    $sql$, v_ip_x));

    -- Obie sesje jako serwer (service_role), z bezpiecznikiem czasu: zawieszona
    -- blokada konczy sie bledem, a nie wiszacym CI.
    PERFORM dblink_exec('mc_a', 'SET ROLE service_role');
    PERFORM dblink_exec('mc_b', 'SET ROLE service_role');
    PERFORM dblink_exec('mc_a', 'SET lock_timeout = ''15s''');
    PERFORM dblink_exec('mc_b', 'SET lock_timeout = ''15s''');
    SELECT t.pid INTO v_a_pid FROM dblink('mc_a', 'SELECT pg_backend_pid()') AS t(pid integer);
    SELECT t.pid INTO v_b_pid FROM dblink('mc_b', 'SELECT pg_backend_pid()') AS t(pid integer);
    RETURN NEXT ok(v_a_pid <> v_b_pid AND v_a_pid <> pg_backend_pid() AND v_b_pid <> pg_backend_pid(),
      'dwie osobne sesje serwera (dblink), niezalezne od sesji testu');

    -- ── 1) Ten sam gosc, dwa rozne byty, limit 1 - blokada PODMIOTU ────────
    PERFORM dblink_exec('mc_a', 'BEGIN');
    SELECT t.granted INTO v_a_granted
      FROM dblink('mc_a', pg_temp.mc_consume_sql(1, 'a7000000-0000-0000-0000-0000000000f1', v_ip_y))
        AS t(granted boolean, requires_registration boolean);
    RETURN NEXT ok(v_a_granted, '1/A: pierwszy byt goscia wydany (transakcja A otwarta)');

    PERFORM dblink_exec('mc_b', 'BEGIN');
    PERFORM dblink_send_query('mc_b', pg_temp.mc_consume_sql(2, 'a7000000-0000-0000-0000-0000000000f1', v_ip_y));
    v_waited := pg_temp.mc_waits_on_advisory(v_b_pid);
    RETURN NEXT ok(v_waited,
      '1/B: rownolegla konsumpcja innego bytu CZEKA na blokadzie doradczej podmiotu');

    PERFORM dblink_exec('mc_a', 'COMMIT');
    SELECT t.granted INTO v_b_granted
      FROM dblink_get_result('mc_b') AS t(granted boolean, requires_registration boolean);
    PERFORM * FROM dblink_get_result('mc_b') AS t(granted boolean, requires_registration boolean);
    PERFORM dblink_exec('mc_b', 'COMMIT');
    RETURN NEXT ok(NOT v_b_granted,
      '1/B: po COMMIT A liczy slot A i odmawia (limit nieprzekroczony)');
    RETURN NEXT is(
      (SELECT count(*)::int FROM public.metered_views
        WHERE tenant_id = 'a7000000-0000-0000-0000-0000000000aa'
          AND visitor_id = 'a7000000-0000-0000-0000-0000000000f1'),
      1, '1: zatwierdzony stan - dokladnie limit (1) wierszy goscia');

    -- ── 2) Dwoch gosci, jeden adres przy suficie - blokada ADRESU ──────────
    PERFORM dblink_exec('mc_a', 'BEGIN');
    SELECT t.granted INTO v_a_granted
      FROM dblink('mc_a', pg_temp.mc_consume_sql(5, 'a7000000-0000-0000-0000-0000000000f2', v_ip_x))
        AS t(granted boolean, requires_registration boolean);
    RETURN NEXT ok(v_a_granted, '2/A: piaty rozny byt adresu wydany (transakcja A otwarta)');

    PERFORM dblink_exec('mc_b', 'BEGIN');
    PERFORM dblink_send_query('mc_b', pg_temp.mc_consume_sql(6, 'a7000000-0000-0000-0000-0000000000f3', v_ip_x));
    v_waited := pg_temp.mc_waits_on_advisory(v_b_pid);
    RETURN NEXT ok(v_waited,
      '2/B: inny gosc z tego adresu CZEKA na blokadzie doradczej adresu');

    PERFORM dblink_exec('mc_a', 'COMMIT');
    SELECT t.granted, t.requires_registration INTO v_b_granted, v_b_reg
      FROM dblink_get_result('mc_b') AS t(granted boolean, requires_registration boolean);
    PERFORM * FROM dblink_get_result('mc_b') AS t(granted boolean, requires_registration boolean);
    PERFORM dblink_exec('mc_b', 'COMMIT');
    RETURN NEXT ok(NOT v_b_granted AND v_b_reg,
      '2/B: po COMMIT A sufit adresu pelny - odmowa z requires_registration (wlasny limit nietkniety)');
    RETURN NEXT is(
      (SELECT count(DISTINCT entity_id)::int FROM public.metered_views
        WHERE tenant_id = 'a7000000-0000-0000-0000-0000000000aa' AND ip_subject = v_ip_x),
      5, '2: zatwierdzony stan - adres ma dokladnie sufit (5) roznych bytow');
  EXCEPTION WHEN OTHERS THEN
    -- Blad w trakcie: zamkniecie sesji A/B (ich otwarte transakcje ida do
    -- ROLLBACK), sprzatanie scenografii, dopiero potem blad testu.
    PERFORM dblink_disconnect(c) FROM unnest(dblink_get_connections()) AS c WHERE c <> 'mc_seed';
    PERFORM pg_temp.mc_cleanup();
    PERFORM dblink_disconnect('mc_seed');
    RAISE;
  END;

  PERFORM pg_temp.mc_cleanup();
  PERFORM dblink_disconnect('mc_a');
  PERFORM dblink_disconnect('mc_b');
  PERFORM dblink_disconnect('mc_seed');
END $$;

SELECT * FROM pg_temp.mc_run();

SELECT * FROM finish();
ROLLBACK;
