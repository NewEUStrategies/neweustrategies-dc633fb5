BEGIN;
SET LOCAL search_path = public, extensions;
SELECT plan(15);

CREATE TABLE public.contract_probe_canary (value integer);
CREATE FUNCTION public.contract_probe_mutation() RETURNS void LANGUAGE sql VOLATILE AS $$
  INSERT INTO public.contract_probe_canary VALUES (1);
$$;
REVOKE ALL ON TABLE public.contract_probe_canary FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contract_probe_mutation() FROM PUBLIC, anon;

SELECT is(public.missing_schema_objects('[{"kind":"table","name":"contract_probe_canary"},{"kind":"function","name":"contract_probe_mutation"}]'), '[]'::jsonb, 'private objects exist without execution');
SELECT is((SELECT count(*)::integer FROM public.contract_probe_canary), 0, 'metadata probe never executes volatile RPC');
SELECT is(public.missing_schema_objects('[{"kind":"table","name":"contract_probe_missing"}]'), '[{"kind":"table","name":"contract_probe_missing"}]'::jsonb, 'missing table is reported');
SELECT is(public.missing_schema_objects('[{"kind":"view","name":"contract_probe_canary"}]'), '[{"kind":"view","name":"contract_probe_canary"}]'::jsonb, 'wrong object kind is not present');
SELECT is(public.missing_schema_objects('[{"kind":"function","name":"queue_membership_crm_sync"}]'), '[{"kind":"function","name":"queue_membership_crm_sync"}]'::jsonb, 'triggers are not API functions');
SELECT is(public.missing_schema_objects('[{"kind":"table","name":"contract_probe_missing"},{"kind":"table","name":"contract_probe_missing"}]'), '[{"kind":"table","name":"contract_probe_missing"}]'::jsonb, 'missing names are deduplicated');
SELECT is(public.missing_schema_objects('[]'), '[]'::jsonb, 'empty input enumerates nothing');
SELECT throws_ok($$SELECT public.missing_schema_objects('{}')$$, '22023', 'contract: expected an array', 'reject non-array');
SELECT throws_ok($$SELECT public.missing_schema_objects(NULL)$$, '22023', 'contract: expected an array', 'reject null');
SELECT throws_ok($$SELECT public.missing_schema_objects('[{"kind":"table","name":"auth.users"}]')$$, '22023', 'contract: invalid public object', 'cannot inspect managed schemas');
SELECT throws_ok($$SELECT public.missing_schema_objects('[{"kind":"secret","name":"x"}]')$$, '22023', 'contract: invalid public object', 'reject invalid kinds');
SELECT throws_ok($$SELECT public.missing_schema_objects('[{}]')$$, '22023', 'contract: invalid public object', 'reject absent names');
SELECT throws_ok($$SELECT public.missing_schema_objects((SELECT jsonb_agg(jsonb_build_object('kind','table','name','x')) FROM generate_series(1,101)))$$, '22023', 'contract: maximum 100 objects per request', 'request size is bounded');
SELECT is((SELECT provolatile::text FROM pg_proc WHERE oid = 'public.missing_schema_objects(jsonb)'::regprocedure), 's', 'RPC is stable and read-only through PostgREST');
SET LOCAL ROLE anon;
SELECT is(public.missing_schema_objects('[{"kind":"table","name":"contract_probe_canary"},{"kind":"function","name":"contract_probe_mutation"}]'), '[]'::jsonb, 'publishable key may verify metadata for private objects');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
