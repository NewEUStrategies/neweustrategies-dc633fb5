-- pgTAP: `missing_schema_columns` (20261009110000) - kontrakt kolumn po
-- wdrozeniu. Czyta wylacznie katalog, zwraca tylko podzbior podanych par,
-- a EXECUTE ma dokladnie wolajacy z CI (anon, service_role).
BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(17);

CREATE TABLE public.column_probe_canary (kept integer, gone integer);
ALTER TABLE public.column_probe_canary DROP COLUMN gone;
CREATE VIEW public.column_probe_canary_view AS SELECT kept AS exposed FROM public.column_probe_canary;
REVOKE ALL ON TABLE public.column_probe_canary FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.column_probe_canary_view FROM PUBLIC, anon, authenticated;

SELECT is(public.missing_schema_columns('[{"table":"column_probe_canary","column":"kept"}]'), '[]'::jsonb,
  'existing column of a private table is present');
SELECT is(public.missing_schema_columns('[{"table":"column_probe_canary","column":"absent"}]'),
  '[{"table":"column_probe_canary","column":"absent"}]'::jsonb, 'missing column is reported');
SELECT is(public.missing_schema_columns('[{"table":"column_probe_canary","column":"gone"}]'),
  '[{"table":"column_probe_canary","column":"gone"}]'::jsonb, 'dropped column is not present');
SELECT is(public.missing_schema_columns('[{"table":"column_probe_canary","column":"ctid"}]'),
  '[{"table":"column_probe_canary","column":"ctid"}]'::jsonb, 'system columns are not contract columns');
SELECT is(public.missing_schema_columns('[{"table":"column_probe_missing","column":"kept"}]'),
  '[{"table":"column_probe_missing","column":"kept"}]'::jsonb, 'column of a missing table is reported');
SELECT is(public.missing_schema_columns('[{"table":"column_probe_canary_view","column":"exposed"}]'), '[]'::jsonb,
  'view columns count - a table replaced by a view still exposes them');
SELECT is(public.missing_schema_columns('[{"table":"column_probe_canary","column":"absent"},{"table":"column_probe_canary","column":"absent"},{"table":"column_probe_canary","column":"kept"}]'),
  '[{"table":"column_probe_canary","column":"absent"}]'::jsonb, 'answer is a deduplicated subset of the request');
SELECT is(public.missing_schema_columns('[]'), '[]'::jsonb, 'empty input enumerates nothing');
SELECT throws_ok($$SELECT public.missing_schema_columns('{}')$$, '22023', 'contract: expected an array', 'reject non-array');
SELECT throws_ok($$SELECT public.missing_schema_columns(NULL)$$, '22023', 'contract: expected an array', 'reject null');
SELECT throws_ok($$SELECT public.missing_schema_columns('[{"table":"auth.users","column":"email"}]')$$, '22023',
  'contract: invalid public column', 'cannot inspect managed schemas');
SELECT throws_ok($$SELECT public.missing_schema_columns('[{"table":"column_probe_canary"}]')$$, '22023',
  'contract: invalid public column', 'reject absent column names');
SELECT throws_ok($$SELECT public.missing_schema_columns((SELECT jsonb_agg(jsonb_build_object('table','x','column','y')) FROM generate_series(1,101)))$$,
  '22023', 'contract: maximum 100 columns per request', 'request size is bounded');
SELECT is((SELECT provolatile::text FROM pg_proc WHERE oid = 'public.missing_schema_columns(jsonb)'::regprocedure), 's',
  'RPC is stable and read-only through PostgREST');
SELECT ok(has_function_privilege('anon', 'public.missing_schema_columns(jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.missing_schema_columns(jsonb)', 'EXECUTE'),
  'CI callers (publishable and service key) may execute');
SELECT ok(NOT has_function_privilege('authenticated', 'public.missing_schema_columns(jsonb)', 'EXECUTE'),
  'signed-in clients have no path to the probe');
SET LOCAL ROLE anon;
SELECT is(public.missing_schema_columns('[{"table":"column_probe_canary","column":"kept"},{"table":"column_probe_canary","column":"absent"}]'),
  '[{"table":"column_probe_canary","column":"absent"}]'::jsonb, 'publishable key may verify columns of private tables');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
