-- pgTAP: pomiar uderzeń w paywall (S3, migracja 20261020120100).
--
-- CO PRZYPINA:
--   * konto WYŁĄCZNIE z `auth.uid()`, najemca WYŁĄCZNIE z `public_tenant_id()`
--     - treść innego najemcy nie zapisuje nic (dwóch najemców);
--   * deduplikacja doby: drugie uderzenie w tę samą treść podnosi `hits`,
--     nie dokłada wiersza; powód i warstwa z ostatniego uderzenia;
--   * `paywall.hit.v1` raz na konto i dobę (także przy uderzeniu w drugą
--     treść), z payloadem bez PII;
--   * treść publiczna i nieznana nie zapisuje wiersza (brak śmieci w lejku);
--   * złe wejście = 22023 (bez przycinania), nieznana warstwa = NULL;
--   * `anon` bez EXECUTE na obu funkcjach, wariant gościa wyłącznie dla
--     `service_role` (bez zdarzenia na szynie), skrót gościa z dziedziny hex;
--   * awaria szyny nie przerywa zapisu uderzenia i zostawia ślad (Z-02).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test paywall_hits
BEGIN;
SELECT plan(23);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Najemca A jest najemcą PUBLICZNYM (public_tenant_id() bez nagłówka hosta
-- spada na is_default) - ten sam zabieg co metering_paywall_test.
UPDATE public.tenants SET is_default = false WHERE is_default;
INSERT INTO public.tenants (id, slug, name, is_default) VALUES
  ('c3100000-0000-0000-0000-0000000000a0', 'hub-s3-hit-a', 'Hub S3 paywall A', true),
  ('c3100000-0000-0000-0000-0000000000b0', 'hub-s3-hit-b', 'Hub S3 paywall B', false);
SELECT public.seed_membership_tiers('c3100000-0000-0000-0000-0000000000a0');

INSERT INTO auth.users (id, email) VALUES
  ('c3100000-0000-0000-0000-00000000a001', 'r1@hub-s3-hit.test'),
  ('c3100000-0000-0000-0000-00000000a002', 'r2@hub-s3-hit.test'),
  ('c3100000-0000-0000-0000-00000000a003', 'r3@hub-s3-hit.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c3100000-0000-0000-0000-00000000a001', 'r1@hub-s3-hit.test', 'R1', 'c3100000-0000-0000-0000-0000000000a0'),
  ('c3100000-0000-0000-0000-00000000a002', 'r2@hub-s3-hit.test', 'R2', 'c3100000-0000-0000-0000-0000000000a0'),
  ('c3100000-0000-0000-0000-00000000a003', 'r3@hub-s3-hit.test', 'R3', 'c3100000-0000-0000-0000-0000000000a0');

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('c3100000-0000-0000-0000-0000000000d1', 'c3100000-0000-0000-0000-0000000000a0', 'hit-home-a'),
  ('c3100000-0000-0000-0000-0000000000d2', 'c3100000-0000-0000-0000-0000000000b0', 'hit-home-b');
INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl) VALUES
  ('c3100000-0000-0000-0000-0000000000e1', 'hit-paid-a', 'c3100000-0000-0000-0000-00000000a001', 'published',
   'c3100000-0000-0000-0000-0000000000a0', 'c3100000-0000-0000-0000-0000000000d1', 'Paid A'),
  ('c3100000-0000-0000-0000-0000000000e2', 'hit-members-a', 'c3100000-0000-0000-0000-00000000a001', 'published',
   'c3100000-0000-0000-0000-0000000000a0', 'c3100000-0000-0000-0000-0000000000d1', 'Members A'),
  ('c3100000-0000-0000-0000-0000000000e3', 'hit-public-a', 'c3100000-0000-0000-0000-00000000a001', 'published',
   'c3100000-0000-0000-0000-0000000000a0', 'c3100000-0000-0000-0000-0000000000d1', 'Public A'),
  ('c3100000-0000-0000-0000-0000000000f1', 'hit-paid-b', 'c3100000-0000-0000-0000-00000000a001', 'published',
   'c3100000-0000-0000-0000-0000000000b0', 'c3100000-0000-0000-0000-0000000000d2', 'Paid B');
INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode, plan_ids, min_tier_rank) VALUES
  ('c3100000-0000-0000-0000-0000000000a0', 'post', 'c3100000-0000-0000-0000-0000000000e1', 'paid', '{}', 20),
  ('c3100000-0000-0000-0000-0000000000a0', 'post', 'c3100000-0000-0000-0000-0000000000e2', 'members', '{}', 0),
  ('c3100000-0000-0000-0000-0000000000a0', 'post', 'c3100000-0000-0000-0000-0000000000e3', 'public', '{}', 0),
  ('c3100000-0000-0000-0000-0000000000b0', 'post', 'c3100000-0000-0000-0000-0000000000f1', 'paid', '{}', 0);

DELETE FROM public.domain_events
 WHERE tenant_id IN ('c3100000-0000-0000-0000-0000000000a0', 'c3100000-0000-0000-0000-0000000000b0');

-- ── Czytelnik R1 ─────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3100000-0000-0000-0000-00000000a001","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000e1', 'tier_rank', 'pro', 'default') $$,
  'R1: pierwsze uderzenie w treść płatną');
SELECT lives_ok(
  $$ SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000e1', 'paid', 'pro', 'default') $$,
  'R1: drugie uderzenie w tę samą treść');

RESET ROLE;

-- 3-5. Jeden wiersz z licznikiem, konto i najemca z sesji, doba UTC.
SELECT results_eq(
  $$ SELECT tenant_id, user_id, visitor_hash, day, hits, reason, required_tier_key, variant
       FROM public.paywall_hits WHERE entity_id = 'c3100000-0000-0000-0000-0000000000e1' $$,
  $$ VALUES ('c3100000-0000-0000-0000-0000000000a0'::uuid, 'c3100000-0000-0000-0000-00000000a001'::uuid,
             NULL::text, (now() AT TIME ZONE 'UTC')::date, 2, 'paid', 'pro', 'default') $$,
  'dedup doby: jeden wiersz, hits=2, konto z auth.uid(), najemca z public_tenant_id(), powód z ostatniego uderzenia');

SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE event_type = 'paywall.hit.v1' AND tenant_id = 'c3100000-0000-0000-0000-0000000000a0'),
  1, 'dwa uderzenia w dobie = jedno zdarzenie paywall.hit.v1');

SELECT results_eq(
  $$ SELECT aggregate_type, aggregate_id, actor_id, payload FROM public.domain_events
      WHERE event_type = 'paywall.hit.v1' AND tenant_id = 'c3100000-0000-0000-0000-0000000000a0' $$,
  $$ VALUES ('paywall', 'c3100000-0000-0000-0000-00000000a001', 'c3100000-0000-0000-0000-00000000a001'::uuid,
             '{"user_id":"c3100000-0000-0000-0000-00000000a001","entity_type":"post","entity_id":"c3100000-0000-0000-0000-0000000000e1","reason":"tier_rank","required_tier_key":"pro","variant":"default"}'::jsonb) $$,
  'payload pierwszego uderzenia: identyfikatory i enumy, bez PII');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3100000-0000-0000-0000-00000000a001","role":"authenticated"}', true);

-- 6. Druga treść tego samego dnia: nowy wiersz, bez drugiego zdarzenia.
SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000e2', 'members', NULL, 'meter_register');
-- 7. Treść publiczna i treść innego najemcy - bez wiersza.
SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000e3', 'paid', NULL, 'default');
SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000f1', 'paid', NULL, 'default');
-- 8. Nieznana warstwa - zapis bez klucza.
SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000e2', 'tier_rank', 'no_such_tier', 'ab_b');

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.paywall_hits WHERE user_id = 'c3100000-0000-0000-0000-00000000a001'),
  3, 'R1: trzy wiersze (dwie treści A, dwa warianty drugiej) - treść publiczna i treść B pominięte');
SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE event_type = 'paywall.hit.v1' AND aggregate_id = 'c3100000-0000-0000-0000-00000000a001'),
  1, 'R1: kolejne treści tego dnia nie emitują drugiego zdarzenia');
SELECT is_empty(
  $$ SELECT 1 FROM public.paywall_hits
      WHERE entity_id IN ('c3100000-0000-0000-0000-0000000000e3', 'c3100000-0000-0000-0000-0000000000f1') $$,
  'treść publiczna i treść innego najemcy nie zostawiają wiersza');
SELECT is(
  (SELECT required_tier_key FROM public.paywall_hits
    WHERE user_id = 'c3100000-0000-0000-0000-00000000a001' AND variant = 'ab_b'),
  NULL, 'warstwa spoza katalogu najemcy zapisuje się jako NULL');
SELECT is_empty(
  $$ SELECT 1 FROM public.paywall_hits WHERE tenant_id = 'c3100000-0000-0000-0000-0000000000b0' $$,
  'najemca B nie dostał żadnego wiersza od czytelnika hosta A');

-- 11. Drugi czytelnik ma własne zdarzenie.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3100000-0000-0000-0000-00000000a002","role":"authenticated"}', true);
SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000e1', 'paid', NULL, 'default');

-- 12-14. Złe wejście = 22023, bez przycinania.
SELECT throws_ok(
  $$ SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000e1', 'because', NULL, 'default') $$,
  '22023', NULL, 'nieznany powód -> 22023');
SELECT throws_ok(
  $$ SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000e1', 'paid', NULL, 'Wariant B') $$,
  '22023', NULL, 'wariant spoza ^[a-z0-9_-]{1,32}$ -> 22023');
SELECT throws_ok(
  $$ SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000e1', 'paid', repeat('x', 65), 'default') $$,
  '22023', NULL, 'klucz warstwy dłuższy niż 64 znaki -> 22023 (bez przycinania)');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE event_type = 'paywall.hit.v1' AND tenant_id = 'c3100000-0000-0000-0000-0000000000a0'),
  2, 'dwóch czytelników = dwa zdarzenia (raz na konto i dobę)');

-- 16-18. Granty.
SELECT ok(
  NOT has_function_privilege('anon', 'public.record_paywall_hit(text, uuid, text, text, text)', 'EXECUTE'),
  'anon bez EXECUTE na record_paywall_hit');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.record_paywall_hit_visitor(text, uuid, text, uuid, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.record_paywall_hit_visitor(text, uuid, text, uuid, text, text, text)', 'EXECUTE'),
  'wariant gościa bez EXECUTE dla anon i authenticated');
SELECT ok(
  has_function_privilege('service_role', 'public.record_paywall_hit_visitor(text, uuid, text, uuid, text, text, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.record_paywall_hit(text, uuid, text, text, text)', 'EXECUTE'),
  'service_role woła wariant gościa, authenticated - wariant konta');

-- 19-21. Gość przez serwer: dedup doby, bez zdarzenia, walidacja skrótu.
SET LOCAL ROLE service_role;
SELECT public.record_paywall_hit_visitor(repeat('ab', 16), 'c3100000-0000-0000-0000-0000000000a0',
  'post', 'c3100000-0000-0000-0000-0000000000e1', 'registration', NULL, 'default');
SELECT public.record_paywall_hit_visitor(repeat('ab', 16), 'c3100000-0000-0000-0000-0000000000a0',
  'post', 'c3100000-0000-0000-0000-0000000000e1', 'registration', NULL, 'default');
SELECT throws_ok(
  $$ SELECT public.record_paywall_hit_visitor('not-a-hash', 'c3100000-0000-0000-0000-0000000000a0',
       'post', 'c3100000-0000-0000-0000-0000000000e1', 'registration', NULL, 'default') $$,
  '22023', NULL, 'skrót gościa spoza dziedziny hex -> 22023');
RESET ROLE;

SELECT results_eq(
  $$ SELECT user_id, visitor_hash, hits FROM public.paywall_hits
      WHERE visitor_hash IS NOT NULL AND tenant_id = 'c3100000-0000-0000-0000-0000000000a0' $$,
  $$ VALUES (NULL::uuid, repeat('ab', 16), 2) $$,
  'gość: jeden wiersz na dobę ze skrótem i licznikiem, bez konta');
SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE event_type = 'paywall.hit.v1' AND tenant_id = 'c3100000-0000-0000-0000-0000000000a0'),
  2, 'uderzenie gościa nie emituje zdarzenia na szynę');

-- 22-23. Awaria szyny nie przerywa zapisu uderzenia.
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text, p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_actor_id uuid DEFAULT NULL, p_suppress_actor boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bus down' USING ERRCODE = 'P0001';
END;
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3100000-0000-0000-0000-00000000a003","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.record_paywall_hit('post', 'c3100000-0000-0000-0000-0000000000e1', 'paid', NULL, 'default') $$,
  'awaria emit_domain_event nie przerywa zapisu uderzenia');
RESET ROLE;
SELECT results_eq(
  $$ SELECT (SELECT count(*)::int FROM public.paywall_hits WHERE user_id = 'c3100000-0000-0000-0000-00000000a003'),
            (SELECT count(*)::int FROM public.domain_event_emit_errors
              WHERE source = 'record_paywall_hit' AND event_type = 'paywall.hit.v1'
                AND tenant_id = 'c3100000-0000-0000-0000-0000000000a0') $$,
  $$ VALUES (1, 1) $$,
  'wiersz uderzenia zapisany, awaria w domain_event_emit_errors');

-- 24. Atrybuty bezpieczeństwa obu funkcji.
SELECT ok(
  (SELECT bool_and(p.prosecdef AND 'search_path=public, pg_temp' = ANY (p.proconfig))
     FROM pg_proc p
    WHERE p.oid IN ('public.record_paywall_hit(text, uuid, text, text, text)'::regprocedure,
                    'public.record_paywall_hit_visitor(text, uuid, text, uuid, text, text, text)'::regprocedure)),
  'obie funkcje: SECURITY DEFINER z search_path public, pg_temp');

SELECT * FROM finish();
ROLLBACK;
