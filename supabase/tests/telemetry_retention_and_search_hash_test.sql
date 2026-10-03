-- pgTAP: retencja telemetrii i skrot frazy wyszukiwania (migracja
-- 20261003190000_telemetry_retention_and_search_hash).
--
--   1. Pieprz skrotu: RLS bez ani jednej polityki, zero uprawnien dla anon
--      i authenticated - sekret czytaja tylko funkcje SECURITY DEFINER.
--   2. Trigger BEFORE INSERT: fraza -> `sq1:` + 64 hex, `meta.q` znika, reszta
--      `meta` zostaje; wielkosc liter i biale znaki nie zmieniaja skrotu (ASCII
--      - lokalny runner ma locale C, gdzie `lower()` zwija tylko ASCII); ten sam
--      tekst u innego najemcy daje inny skrot; wiersz spoza wyszukiwania
--      przechodzi bez zmian; sam prefiks `sq1:` nie jest furtka dla jawnego
--      tekstu; blad skrotu (najemca spoza `tenants` -> FK pieprzu) daje NULL
--      i NIE wywraca wstawienia.
--   3. Backfill: przepisuje wiersze historyczne tym samym skrotem co trigger,
--      zeruje fraze przy porazce najemcy, a powtorka niczego nie zmienia.
--   4. Retencja: kasuje tylko wiersze sprzed horyzontu kazdej tabeli (wiersz
--      DOKLADNIE na horyzoncie zostaje - `now()` jest czasem transakcji, wiec
--      test i funkcja licza te sama granice), szanuje `p_limit`, zaczyna od
--      najstarszych, zwraca liczniki; NULL/0 to partia domyslna, gorny limit
--      przycina partie reczna.
--   5. Uprawnienia: retencja, skrot i backfill bez EXECUTE dla anon
--      i authenticated, z EXECUTE dla service_role.
--   6. Zadanie pg_cron i indeksy `created_at`, na ktorych stoja partie.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(35);

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d7a11111-1111-1111-1111-1111111111a1', 'tenant-telemetry-a', 'Tenant telemetrii A'),
  ('d7b22222-2222-2222-2222-2222222222b2', 'tenant-telemetry-b', 'Tenant telemetrii B');

-- ---------------------------------------------------------------------------
-- 1) Pieprz: sekret bez sciezki dla rol klienckich
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT c.relrowsecurity FROM pg_class c
    WHERE c.oid = 'public.analytics_search_peppers'::regclass),
  'analytics_search_peppers ma wlaczony RLS'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'analytics_search_peppers'),
  0,
  'analytics_search_peppers nie ma zadnej polityki - czytaja go tylko funkcje SECURITY DEFINER'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.analytics_search_peppers',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.analytics_search_peppers',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'anon i authenticated nie maja zadnego uprawnienia do pieprzu'
);

-- ---------------------------------------------------------------------------
-- 2) Trigger na ingest
-- ---------------------------------------------------------------------------
SELECT has_trigger('public', 'analytics_events', 'analytics_events_search_hash_trg',
  'analytics_events ma trigger skrotu frazy');

INSERT INTO public.analytics_events
  (tenant_id, event_type, event_name, entity_type, entity_id, session_id, meta) VALUES
  -- Ta sama fraza w trzech postaciach: tabulator, podwojne spacje, wielkie litery.
  ('d7a11111-1111-1111-1111-1111111111a1', 'search', 'internal_search', 'search_query',
   E'\tPolityka   Spojnosci \n', 'sess-sq-1', '{"q":"Polityka Spojnosci","results":3}'),
  ('d7a11111-1111-1111-1111-1111111111a1', 'search', 'internal_search', 'search_query',
   'polityka spojnosci', 'sess-sq-2', '{"results":3}'),
  -- Inny najemca, identyczny tekst.
  ('d7b22222-2222-2222-2222-2222222222b2', 'search', 'internal_search', 'search_query',
   'polityka spojnosci', 'sess-sq-3', '{}'),
  -- Odslona wpisu: ani `entity_id`, ani `meta.q` nie sa tu fraza.
  ('d7a11111-1111-1111-1111-1111111111a1', 'page_view', 'page_view', 'post',
   'Wpis-ABC', 'sess-sq-4', '{"q":"zostaje"}'),
  -- Kombinacja sfalszowana: typ zdarzenia spoza wyszukiwania, encja frazy.
  ('d7a11111-1111-1111-1111-1111111111a1', 'interaction', 'forged', 'search_query',
   'jan kowalski', 'sess-sq-5', '{}'),
  -- Prefiks skrotu przed jawnym tekstem.
  ('d7a11111-1111-1111-1111-1111111111a1', 'search', 'internal_search', 'search_query',
   'sq1:jan kowalski', 'sess-sq-6', '{}');

SELECT ok(
  (SELECT entity_id ~ '^sq1:[0-9a-f]{64}$' AND length(entity_id) = 68
     FROM public.analytics_events WHERE session_id = 'sess-sq-1'),
  'fraza wyszukiwania zapisuje sie jako sq1: + 64 znaki hex'
);

SELECT ok(
  (SELECT NOT (meta ? 'q') AND meta ->> 'results' = '3'
     FROM public.analytics_events WHERE session_id = 'sess-sq-1'),
  'meta traci klucz q, reszta kontekstu zdarzenia zostaje'
);

SELECT is(
  (SELECT entity_id FROM public.analytics_events WHERE session_id = 'sess-sq-2'),
  (SELECT entity_id FROM public.analytics_events WHERE session_id = 'sess-sq-1'),
  'wielkosc liter i biale znaki nie zmieniaja skrotu'
);

SELECT isnt(
  (SELECT entity_id FROM public.analytics_events WHERE session_id = 'sess-sq-3'),
  (SELECT entity_id FROM public.analytics_events WHERE session_id = 'sess-sq-1'),
  'ta sama fraza u innego najemcy daje inny skrot'
);

SELECT is(
  (SELECT count(*)::int FROM public.analytics_search_peppers
    WHERE tenant_id IN ('d7a11111-1111-1111-1111-1111111111a1',
                        'd7b22222-2222-2222-2222-2222222222b2')
      AND length(pepper) = 32),
  2,
  'pieprz zalozony leniwie: jeden 32-bajtowy sekret na najemce'
);

SELECT row_eq(
  $$ SELECT entity_id, meta FROM public.analytics_events WHERE session_id = 'sess-sq-4' $$,
  ROW('Wpis-ABC'::text, '{"q":"zostaje"}'::jsonb),
  'wiersz spoza wyszukiwania przechodzi bez zmian'
);

SELECT ok(
  (SELECT entity_id ~ '^sq1:[0-9a-f]{64}$'
     FROM public.analytics_events WHERE session_id = 'sess-sq-5'),
  'entity_type search_query przy innym event_type tez dostaje skrot'
);

SELECT ok(
  (SELECT entity_id ~ '^sq1:[0-9a-f]{64}$' AND entity_id <> 'sq1:jan kowalski'
     FROM public.analytics_events WHERE session_id = 'sess-sq-6'),
  'sam prefiks sq1: nie przepuszcza jawnego tekstu - za prefiksem tez liczy sie skrot'
);

-- Najemca spoza `tenants`: `analytics_events.tenant_id` nie ma klucza obcego,
-- ale pieprz ma - zasianie pada na FK wewnatrz triggera.
SELECT lives_ok(
  $$ INSERT INTO public.analytics_events
       (tenant_id, event_type, event_name, entity_type, entity_id, session_id, meta)
     VALUES ('d7f00000-0000-0000-0000-0000000000f0', 'search', 'internal_search',
             'search_query', 'fraza sieroty', 'sess-sq-orphan', '{"q":"fraza sieroty"}') $$,
  'blad skrotu (najemca spoza tenants, FK pieprzu) nie wywraca wstawienia'
);

SELECT row_eq(
  $$ SELECT entity_id, meta ? 'q' FROM public.analytics_events
      WHERE session_id = 'sess-sq-orphan' $$,
  ROW(NULL::text, false),
  'po bledzie skrotu wiersz zostaje, a fraza i meta.q znikaja'
);

-- ---------------------------------------------------------------------------
-- 3) Backfill
-- ---------------------------------------------------------------------------
-- Wiersze „sprzed migracji": trigger wylaczony na czas wstawienia.
ALTER TABLE public.analytics_events DISABLE TRIGGER analytics_events_search_hash_trg;
INSERT INTO public.analytics_events
  (tenant_id, event_type, event_name, entity_type, entity_id, session_id, meta) VALUES
  ('d7a11111-1111-1111-1111-1111111111a1', 'search', 'internal_search', 'search_query',
   'Stara  Fraza', 'sess-bf-1', '{"q":"Stara Fraza","results":1}'),
  ('d7a11111-1111-1111-1111-1111111111a1', 'search', 'internal_search', NULL,
   NULL, 'sess-bf-2', '{"q":"tylko w meta"}'),
  ('d7f00000-0000-0000-0000-0000000000f0', 'search', 'internal_search', 'search_query',
   'osierocona fraza', 'sess-bf-3', '{}');
ALTER TABLE public.analytics_events ENABLE TRIGGER analytics_events_search_hash_trg;

-- Trzy wiersze historyczne; zaden z wierszy wstawionych przez trigger wyzej
-- (skroty, NULL po porazce, odslona z wlasnym `meta.q`) nie spelnia filtra.
SELECT is(
  public.analytics_search_hash_backfill(),
  3,
  'backfill przepisuje tylko trzy wiersze historyczne'
);

SELECT row_eq(
  $$ SELECT entity_id = public.analytics_search_phrase_hash(
              'd7a11111-1111-1111-1111-1111111111a1', 'stara fraza'),
            meta ? 'q',
            meta ->> 'results'
       FROM public.analytics_events WHERE session_id = 'sess-bf-1' $$,
  ROW(true, false, '1'::text),
  'backfill daje ten sam skrot co trigger i zdejmuje meta.q'
);

SELECT ok(
  (SELECT entity_id IS NULL AND NOT (meta ? 'q')
     FROM public.analytics_events WHERE session_id = 'sess-bf-2'),
  'backfill zdejmuje meta.q takze z wiersza bez entity_id'
);

SELECT row_eq(
  $$ SELECT entity_id, meta ? 'q' FROM public.analytics_events
      WHERE session_id = 'sess-bf-3' $$,
  ROW(NULL::text, false),
  'porazka skrotu najemcy w backfillu zeruje fraze zamiast zostawic jawny tekst'
);

CREATE TEMP TABLE _sq_before ON COMMIT DROP AS
  SELECT id, entity_id, meta FROM public.analytics_events
   WHERE session_id LIKE 'sess-sq-%' OR session_id LIKE 'sess-bf-%';

SELECT is(
  public.analytics_search_hash_backfill(),
  0,
  'powtorka backfillu niczego nie przepisuje'
);

SELECT is_empty(
  $$ SELECT b.id FROM _sq_before b
       JOIN public.analytics_events e USING (id)
      WHERE e.entity_id IS DISTINCT FROM b.entity_id
         OR e.meta IS DISTINCT FROM b.meta $$,
  'po powtorce skroty i meta sa identyczne'
);

-- ---------------------------------------------------------------------------
-- 4) Retencja
-- ---------------------------------------------------------------------------
-- Po dwa wiersze za horyzontem i jeden DOKLADNIE na nim w kazdej tabeli.
INSERT INTO public.analytics_events (tenant_id, event_type, event_name, session_id, created_at) VALUES
  ('d7a11111-1111-1111-1111-1111111111a1', 'page_view', 'page_view', 'sess-ret-old-1',
   now() - interval '14 months'),
  ('d7a11111-1111-1111-1111-1111111111a1', 'page_view', 'page_view', 'sess-ret-old-2',
   now() - interval '13 months'),
  ('d7a11111-1111-1111-1111-1111111111a1', 'page_view', 'page_view', 'sess-ret-edge',
   now() - interval '12 months');

INSERT INTO public.web_vitals (tenant_id, metric, value, path, created_at) VALUES
  ('d7a11111-1111-1111-1111-1111111111a1', 'LCP', 1000, '/ret-old-1', now() - interval '250 days'),
  ('d7a11111-1111-1111-1111-1111111111a1', 'LCP', 1000, '/ret-old-2', now() - interval '201 days'),
  ('d7a11111-1111-1111-1111-1111111111a1', 'LCP', 1000, '/ret-edge', now() - interval '200 days');

INSERT INTO public.client_errors (tenant_id, message, path, created_at) VALUES
  ('d7a11111-1111-1111-1111-1111111111a1', 'ret old 1', '/ret-old-1', now() - interval '120 days'),
  ('d7a11111-1111-1111-1111-1111111111a1', 'ret old 2', '/ret-old-2', now() - interval '91 days'),
  ('d7a11111-1111-1111-1111-1111111111a1', 'ret edge', '/ret-edge', now() - interval '90 days');

SELECT is(
  public.telemetry_retention_prune(1),
  '{"analytics_events": 1, "web_vitals": 1, "client_errors": 1, "batch_limit": 1}'::jsonb,
  'p_limit ogranicza partie: po jednym wierszu na tabele, liczniki per tabela'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.analytics_events WHERE session_id = 'sess-ret-old-1')
  AND EXISTS (SELECT 1 FROM public.analytics_events WHERE session_id = 'sess-ret-old-2')
  AND NOT EXISTS (SELECT 1 FROM public.web_vitals WHERE path = '/ret-old-1')
  AND EXISTS (SELECT 1 FROM public.web_vitals WHERE path = '/ret-old-2')
  AND NOT EXISTS (SELECT 1 FROM public.client_errors WHERE path = '/ret-old-1')
  AND EXISTS (SELECT 1 FROM public.client_errors WHERE path = '/ret-old-2'),
  'partia zaczyna od najstarszych wierszy'
);

SELECT is(
  public.telemetry_retention_prune(NULL),
  '{"analytics_events": 1, "web_vitals": 1, "client_errors": 1, "batch_limit": 10000}'::jsonb,
  'NULL to partia domyslna 10000 - reszta zaleglosci znika'
);

SELECT row_eq(
  $$ SELECT (SELECT count(*)::int FROM public.analytics_events WHERE session_id LIKE 'sess-ret-%'),
            (SELECT count(*)::int FROM public.web_vitals WHERE path LIKE '/ret-%'),
            (SELECT count(*)::int FROM public.client_errors WHERE path LIKE '/ret-%') $$,
  ROW(1, 1, 1),
  'wiersze dokladnie na horyzoncie - 12 miesiecy, 200 dni, 90 dni - zostaja'
);

SELECT is(
  (SELECT count(*)::int FROM public.analytics_events
    WHERE session_id LIKE 'sess-sq-%' OR session_id LIKE 'sess-bf-%'),
  10,
  'swieze zdarzenia (wyszukiwania i backfill) nietkniete przez retencje'
);

SELECT is(
  public.telemetry_retention_prune(0),
  '{"analytics_events": 0, "web_vitals": 0, "client_errors": 0, "batch_limit": 10000}'::jsonb,
  'p_limit 0 to partia domyslna; tabele czyste do horyzontu daja zera'
);

SELECT is(
  public.telemetry_retention_prune(1000000) ->> 'batch_limit',
  '100000',
  'partia reczna ma gorny limit 100000'
);

-- ---------------------------------------------------------------------------
-- 5) Uprawnienia
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.telemetry_retention_prune(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.telemetry_retention_prune(integer)', 'EXECUTE'),
  'retencja niedostepna dla anon i authenticated'
);

SELECT ok(
  has_function_privilege('service_role', 'public.telemetry_retention_prune(integer)', 'EXECUTE'),
  'retencje wola service_role'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.analytics_search_phrase_hash(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.analytics_search_phrase_hash(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.analytics_search_hash_backfill()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.analytics_search_hash_backfill()', 'EXECUTE'),
  'skrot i backfill niedostepne dla anon i authenticated - admin czytajacy skroty nie ma hurtowej wyroczni slownikowej (wolna przez ingest zostaje - ryzyko przyjete w migracji)'
);

SELECT ok(
  has_function_privilege('service_role', 'public.analytics_search_phrase_hash(uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.analytics_search_hash_backfill()', 'EXECUTE'),
  'skrot i backfill wola service_role'
);

-- ---------------------------------------------------------------------------
-- 6) Harmonogram i indeksy
-- ---------------------------------------------------------------------------
SELECT row_eq(
  $$ SELECT schedule, command, active FROM cron.job
      WHERE jobname = 'telemetry-retention-prune' $$,
  ROW('41 * * * *'::text, 'SELECT public.telemetry_retention_prune(10000)'::text, true),
  'pg_cron: telemetry-retention-prune co godzine o minucie 41, partia 10000'
);

SELECT has_index('public', 'web_vitals', 'web_vitals_created_at_idx', ARRAY['created_at'],
  'web_vitals ma indeks prowadzony przez created_at pod partie retencji');

SELECT has_index('public', 'analytics_events', 'analytics_events_created_at_idx', ARRAY['created_at'],
  'analytics_events ma indeks prowadzony przez created_at pod partie retencji');

SELECT has_index('public', 'client_errors', 'client_errors_created_idx', ARRAY['created_at'],
  'client_errors ma indeks prowadzony przez created_at pod partie retencji');

SELECT * FROM finish();
ROLLBACK;
