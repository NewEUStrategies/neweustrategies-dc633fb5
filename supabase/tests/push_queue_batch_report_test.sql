-- pgTAP: report_push_jobs - zbiorczy raport partii zadań push
-- (20261002190300_push_queue_batch_report.sql).
--
--   1. Semantyka statusu 1:1 z report_push_job: ok -> 'sent' (+ sent_at),
--      dead -> 'dead', porażka przechodnia -> 'pending', porażka po
--      wyczerpaniu 8 prób -> 'dead'.
--   2. Duplikat id w jednym wywołaniu aktualizuje wiersz raz i rozstrzyga się
--      na korzyść dostarczenia (ta sama zasada, co agregacja w dyspozytorze),
--      a bez dostarczenia deterministycznie na korzyść trwałego werdyktu.
--   3. Zadanie spoza raportu zostaje nietknięte; wejście niebędące tablicą to
--      zero zmian, nie wyjątek.
--   4. Wyłącznie service_role (jak claim_push_jobs / report_push_job).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(12);

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a9222222-2222-2222-2222-222222222222', 'tenant-push-batch', 'Tenant Push Batch');

INSERT INTO public.notification_push_queue (tenant_id, user_id, payload, attempts) VALUES
  ('a9222222-2222-2222-2222-222222222222', 'a9000000-0000-0000-0000-0000000000cc', '{"t":"ok"}', 1),
  ('a9222222-2222-2222-2222-222222222222', 'a9000000-0000-0000-0000-0000000000cc', '{"t":"dead"}', 1),
  ('a9222222-2222-2222-2222-222222222222', 'a9000000-0000-0000-0000-0000000000cc', '{"t":"retry"}', 1),
  ('a9222222-2222-2222-2222-222222222222', 'a9000000-0000-0000-0000-0000000000cc', '{"t":"exhausted"}', 8),
  ('a9222222-2222-2222-2222-222222222222', 'a9000000-0000-0000-0000-0000000000cc', '{"t":"dup"}', 1),
  ('a9222222-2222-2222-2222-222222222222', 'a9000000-0000-0000-0000-0000000000cc', '{"t":"dup_dead"}', 1),
  ('a9222222-2222-2222-2222-222222222222', 'a9000000-0000-0000-0000-0000000000cc', '{"t":"untouched"}', 1);

-- -- 1-3. Jedno wywołanie na całą partię -----------------------------------------
SELECT is(
  public.report_push_jobs((
    SELECT jsonb_agg(jsonb_build_object('id', q.id, 'ok', v.ok, 'dead', v.dead))
      FROM public.notification_push_queue q
      JOIN (VALUES ('ok', true, false),
                   ('dead', false, true),
                   ('retry', false, false),
                   ('exhausted', false, false),
                   ('dup', false, false),
                   ('dup', true, false),
                   ('dup_dead', false, true),
                   ('dup_dead', false, false)) AS v(t, ok, dead)
        ON v.t = q.payload->>'t'
     WHERE q.tenant_id = 'a9222222-2222-2222-2222-222222222222'
  )),
  6,
  'report_push_jobs aktualizuje kazde zgloszone zadanie dokladnie raz'
);

SELECT ok(
  (SELECT status = 'sent' AND sent_at IS NOT NULL FROM public.notification_push_queue
    WHERE tenant_id = 'a9222222-2222-2222-2222-222222222222' AND payload->>'t' = 'ok'),
  'ok -> sent ze stemplem sent_at'
);

SELECT is(
  (SELECT status FROM public.notification_push_queue
    WHERE tenant_id = 'a9222222-2222-2222-2222-222222222222' AND payload->>'t' = 'dead'),
  'dead',
  'dead -> dead bez dalszych prob'
);

SELECT is(
  (SELECT status FROM public.notification_push_queue
    WHERE tenant_id = 'a9222222-2222-2222-2222-222222222222' AND payload->>'t' = 'retry'),
  'pending',
  'porazka przechodnia zostawia zadanie w kolejce do retry'
);

SELECT is(
  (SELECT status FROM public.notification_push_queue
    WHERE tenant_id = 'a9222222-2222-2222-2222-222222222222' AND payload->>'t' = 'exhausted'),
  'dead',
  'porazka po wyczerpaniu 8 prob -> dead (jak report_push_job)'
);

SELECT is(
  (SELECT status FROM public.notification_push_queue
    WHERE tenant_id = 'a9222222-2222-2222-2222-222222222222' AND payload->>'t' = 'dup'),
  'sent',
  'duplikat id rozstrzyga sie na korzysc dostarczenia'
);

SELECT is(
  (SELECT status FROM public.notification_push_queue
    WHERE tenant_id = 'a9222222-2222-2222-2222-222222222222' AND payload->>'t' = 'dup_dead'),
  'dead',
  'duplikat id bez dostarczenia: trwaly werdykt wygrywa deterministycznie'
);

SELECT ok(
  (SELECT status = 'pending' AND sent_at IS NULL FROM public.notification_push_queue
    WHERE tenant_id = 'a9222222-2222-2222-2222-222222222222' AND payload->>'t' = 'untouched'),
  'zadanie spoza raportu zostaje nietkniete'
);

SELECT is(
  public.report_push_jobs('{"id": 1, "ok": true}'::jsonb),
  0,
  'wejscie niebedace tablica to zero zmian, nie wyjatek'
);

-- -- 4. Uprawnienia -----------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.report_push_jobs(jsonb)', 'EXECUTE'),
  'anon nie wola report_push_jobs'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.report_push_jobs(jsonb)', 'EXECUTE'),
  'authenticated nie wola report_push_jobs'
);

SELECT ok(
  has_function_privilege('service_role', 'public.report_push_jobs(jsonb)', 'EXECUTE'),
  'service_role wola report_push_jobs'
);

SELECT * FROM finish();
ROLLBACK;
