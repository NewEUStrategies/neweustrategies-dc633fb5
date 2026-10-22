-- pgTAP: narzut trasy szyny ścieżek na zapis zdarzenia (migracja
-- 20261020140000, hub S5).
--
-- Trasa jest wyzwalaczem AFTER INSERT na `domain_events` - tabeli, do której
-- piszą płatności, rejestracje, CRM i klub. Sprawdza:
--   * 1000 zdarzeń najemcy BEZ tras nie tworzy ani jednego wiersza skrzynki,
--     a narzut wyzwalacza (porównanie z wyłączonym) mieści się w 1,5 ms na
--     zdarzenie - przy pustym indeksie tras to jedno wyszukanie po PK;
--   * zapytanie trasy idzie po kluczu głównym `journey_event_routes`
--     (EXPLAIN FORMAT JSON; `enable_seqscan = off`, bo na pustej tabeli
--     planista i tak wybrałby skan - asercja dowodzi, że kształt zapytania
--     JEST obsługiwany przez prefiks PK (tenant_id, event_type));
--   * wyzwalacz ma warunek WHEN (agregaty ścieżek nie wchodzą do funkcji);
--   * awaria funkcji trasy (skrzynka odrzuca zapis) NIE przerywa zapisu
--     zdarzenia i zostawia ślad `route` w `journey_engine_errors`.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test journeys_route_overhead
BEGIN;
SELECT plan(7);

INSERT INTO public.tenants (id, slug, name) VALUES
  ('e5200000-0000-0000-0000-0000000000a0', 'hub-s5-overhead-a', 'Hub S5 narzut A');

CREATE TEMP TABLE s5_timing (label text PRIMARY KEY, ms double precision) ON COMMIT DROP;

CREATE FUNCTION pg_temp.burst(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
BEGIN
  INSERT INTO public.domain_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
  SELECT 'e5200000-0000-0000-0000-0000000000a0', 'post', g::text, 'post.published.v1',
         jsonb_build_object('n', g)
    FROM generate_series(1, 1000) g;
  INSERT INTO s5_timing VALUES (p_label, extract(epoch FROM clock_timestamp() - v_started) * 1000);
END;
$$;

-- ── 1. 1000 zdarzeń bez tras ─────────────────────────────────────────────────
SELECT pg_temp.burst('with_route_trigger');
SELECT is(
  (SELECT count(*)::int FROM public.journey_event_inbox WHERE tenant_id = 'e5200000-0000-0000-0000-0000000000a0'),
  0, '1000 zdarzeń najemcy bez tras: zero wierszy skrzynki');
SELECT is(
  (SELECT count(*)::int FROM public.journey_engine_errors WHERE tenant_id = 'e5200000-0000-0000-0000-0000000000a0'),
  0, '1000 zdarzeń: zero błędów trasy');

ALTER TABLE public.domain_events DISABLE TRIGGER trg_journey_route_event;
SELECT pg_temp.burst('without_route_trigger');
ALTER TABLE public.domain_events ENABLE TRIGGER trg_journey_route_event;
SELECT cmp_ok(
  (SELECT (w.ms - wo.ms) FROM s5_timing w, s5_timing wo
    WHERE w.label = 'with_route_trigger' AND wo.label = 'without_route_trigger'),
  '<', 1500::double precision,
  'narzut trasy na 1000 zdarzeń < 1500 ms (< 1,5 ms na zdarzenie)');

-- ── 2. Plan po PK ────────────────────────────────────────────────────────────
SET LOCAL enable_seqscan = off;
CREATE TEMP TABLE s5_plan (p json) ON COMMIT DROP;
DO $$
DECLARE v json;
BEGIN
  EXECUTE $q$EXPLAIN (FORMAT JSON) SELECT 1 FROM public.journey_event_routes r
             WHERE r.tenant_id = 'e5200000-0000-0000-0000-0000000000a0' AND r.event_type = 'post.published.v1'$q$
     INTO v;
  INSERT INTO s5_plan VALUES (v);
END $$;
RESET enable_seqscan;
SELECT ok(
  (SELECT p::text LIKE '%journey_event_routes_pkey%' FROM s5_plan),
  'zapytanie trasy obsługuje indeks klucza głównego journey_event_routes');
SELECT ok(
  (SELECT tgqual IS NOT NULL FROM pg_trigger
    WHERE tgname = 'trg_journey_route_event' AND tgrelid = 'public.domain_events'::regclass),
  'wyzwalacz trasy ma warunek WHEN (agregaty ścieżek odsiane przed funkcją)');

-- ── 3. Awaria trasy nie przerywa zapisu zdarzenia ───────────────────────────
INSERT INTO public.journey_definitions (id, tenant_id, key, name, status) VALUES
  ('e5200000-0000-0000-0000-0000000010a1', 'e5200000-0000-0000-0000-0000000000a0', 'awaria', 'Awaria', 'active');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum) VALUES
  ('e5200000-0000-0000-0000-0000000011a1', 'e5200000-0000-0000-0000-0000000000a0', 'e5200000-0000-0000-0000-0000000010a1', 1,
   'post.published.v1', '{"nodes":[],"edges":[]}', 'x');
INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role) VALUES
  ('e5200000-0000-0000-0000-0000000000a0', 'post.published.v1', 'e5200000-0000-0000-0000-0000000010a1',
   'e5200000-0000-0000-0000-0000000011a1', 'enroll');
-- Skrzynka odrzuca każdy wiersz: symulacja awarii (np. pełny dysk, blokada).
ALTER TABLE public.journey_event_inbox ADD CONSTRAINT s5_test_inbox_down CHECK (false) NOT VALID;
INSERT INTO public.domain_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload)
VALUES ('e5200000-0000-0000-0000-00000000e001', 'e5200000-0000-0000-0000-0000000000a0', 'post', 'p1',
        'post.published.v1', '{}');
SELECT is(
  (SELECT count(*)::int FROM public.domain_events WHERE id = 'e5200000-0000-0000-0000-00000000e001'),
  1, 'awaria skrzynki: zdarzenie szyny zapisane mimo błędu trasy');
SELECT is(
  (SELECT phase FROM public.journey_engine_errors WHERE event_id = 'e5200000-0000-0000-0000-00000000e001'),
  'route', 'awaria skrzynki: ślad w journey_engine_errors (faza route)');

SELECT * FROM finish();
ROLLBACK;
