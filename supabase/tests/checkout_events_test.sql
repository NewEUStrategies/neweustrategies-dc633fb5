-- pgTAP: zdarzenia kasy (S3, migracja 20261020120300).
--
-- CO PRZYPINA:
--   * 4 typy z realnymi wierszami `domain_events`: INSERT -> started,
--     -> paid = completed, -> failed = failed (z powodem), -> canceled
--     z `cancel_reason = 'session_expired'` = abandoned;
--   * anulowanie BEZ tego powodu nie jest porzuceniem (zero zdarzeń);
--   * sandbox i atrapa (`provider = 'mock'`) nie emitują niczego;
--   * UPDATE bez zmiany statusu nie emituje;
--   * payload bez PII (identyfikatory, kwota minor, waluta, flaga kuponu),
--     `tier_key` z planu, zdarzenie w najemcy ZAMÓWIENIA (dwóch najemców);
--   * awaria szyny nie przerywa zapisu zamówienia i zostawia ślad (Z-02).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test checkout_events
BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c3300000-0000-0000-0000-0000000000a0', 'hub-s3-co-a', 'Hub S3 kasa A'),
  ('c3300000-0000-0000-0000-0000000000b0', 'hub-s3-co-b', 'Hub S3 kasa B');
SELECT public.seed_membership_tiers('c3300000-0000-0000-0000-0000000000a0');

INSERT INTO auth.users (id, email) VALUES
  ('c3300000-0000-0000-0000-00000000a001', 'buyer-a@hub-s3-co.test'),
  ('c3300000-0000-0000-0000-00000000b001', 'buyer-b@hub-s3-co.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c3300000-0000-0000-0000-00000000a001', 'buyer-a@hub-s3-co.test', 'Kupujący A', 'c3300000-0000-0000-0000-0000000000a0'),
  ('c3300000-0000-0000-0000-00000000b001', 'buyer-b@hub-s3-co.test', 'Kupujący B', 'c3300000-0000-0000-0000-0000000000b0');

INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, currency, interval, active, tier_key)
VALUES ('c3300000-0000-0000-0000-0000000000c1', 'c3300000-0000-0000-0000-0000000000a0',
        'Członek', 'Member', 4900, 'PLN', 'month', true, 'member');

DELETE FROM public.domain_events
 WHERE tenant_id IN ('c3300000-0000-0000-0000-0000000000a0', 'c3300000-0000-0000-0000-0000000000b0');

-- Zamówienia piszemy spod service_role, jak kasa i webhook (strażnik
-- `payment_orders_secure_insert` przepuszcza wyłącznie tę rolę bez konta).
SET LOCAL ROLE service_role;
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency, plan_id,
                                   provider, environment, metadata) VALUES
  ('c3300000-0000-0000-0000-0000000000f1', 'c3300000-0000-0000-0000-0000000000a0',
   'c3300000-0000-0000-0000-00000000a001', 'subscription', 'pending', 4900, 'PLN',
   'c3300000-0000-0000-0000-0000000000c1', 'stripe', 'live', '{"coupon_id":"x"}'),
  ('c3300000-0000-0000-0000-0000000000f2', 'c3300000-0000-0000-0000-0000000000a0',
   'c3300000-0000-0000-0000-00000000a001', 'one_time', 'pending', 1900, 'PLN', NULL,
   'stripe', 'live', '{}'),
  ('c3300000-0000-0000-0000-0000000000f3', 'c3300000-0000-0000-0000-0000000000a0',
   'c3300000-0000-0000-0000-00000000a001', 'one_time', 'pending', 1900, 'PLN', NULL,
   'stripe', 'live', '{}'),
  ('c3300000-0000-0000-0000-0000000000f4', 'c3300000-0000-0000-0000-0000000000a0',
   'c3300000-0000-0000-0000-00000000a001', 'one_time', 'pending', 1900, 'PLN', NULL,
   'stripe', 'live', '{}'),
  -- sandbox i atrapa
  ('c3300000-0000-0000-0000-0000000000f5', 'c3300000-0000-0000-0000-0000000000a0',
   'c3300000-0000-0000-0000-00000000a001', 'one_time', 'pending', 1900, 'PLN', NULL,
   'stripe', 'sandbox', '{}'),
  ('c3300000-0000-0000-0000-0000000000f6', 'c3300000-0000-0000-0000-0000000000a0',
   'c3300000-0000-0000-0000-00000000a001', 'one_time', 'pending', 1900, 'PLN', NULL,
   'mock', 'live', '{}'),
  -- najemca B
  ('c3300000-0000-0000-0000-0000000000f7', 'c3300000-0000-0000-0000-0000000000b0',
   'c3300000-0000-0000-0000-00000000b001', 'one_time', 'pending', 2500, 'EUR', NULL,
   'stripe', 'live', '{}');
RESET ROLE;

-- 1. started: każde zamówienie live/nie-mock, w najemcy zamówienia.
SELECT results_eq(
  $$ SELECT tenant_id, aggregate_id FROM public.domain_events
      WHERE event_type = 'checkout.started.v1'
        AND tenant_id IN ('c3300000-0000-0000-0000-0000000000a0', 'c3300000-0000-0000-0000-0000000000b0')
      ORDER BY aggregate_id $$,
  $$ VALUES ('c3300000-0000-0000-0000-0000000000a0'::uuid, 'c3300000-0000-0000-0000-0000000000f1'),
            ('c3300000-0000-0000-0000-0000000000a0'::uuid, 'c3300000-0000-0000-0000-0000000000f2'),
            ('c3300000-0000-0000-0000-0000000000a0'::uuid, 'c3300000-0000-0000-0000-0000000000f3'),
            ('c3300000-0000-0000-0000-0000000000a0'::uuid, 'c3300000-0000-0000-0000-0000000000f4'),
            ('c3300000-0000-0000-0000-0000000000b0'::uuid, 'c3300000-0000-0000-0000-0000000000f7') $$,
  'started: pięć zamówień live (sandbox i mock pominięte), najemca zamówienia');

-- 2. Payload started: bez PII, tier z planu, kupon jako flaga.
SELECT results_eq(
  $$ SELECT payload, actor_id, aggregate_type FROM public.domain_events
      WHERE event_type = 'checkout.started.v1' AND aggregate_id = 'c3300000-0000-0000-0000-0000000000f1' $$,
  $$ VALUES ('{"order_id":"c3300000-0000-0000-0000-0000000000f1","user_id":"c3300000-0000-0000-0000-00000000a001","kind":"subscription","plan_id":"c3300000-0000-0000-0000-0000000000c1","tier_key":"member","amount_minor":4900,"currency":"PLN","has_coupon":true}'::jsonb,
             'c3300000-0000-0000-0000-00000000a001'::uuid, 'checkout') $$,
  'started: payload z identyfikatorami, tier z planu, flagą kuponu - aktor = kupujący');

-- Przejścia statusu (webhook).
SET LOCAL ROLE service_role;
UPDATE public.payment_orders SET status = 'processing' WHERE id = 'c3300000-0000-0000-0000-0000000000f1';
UPDATE public.payment_orders SET status = 'paid', paid_at = now() WHERE id = 'c3300000-0000-0000-0000-0000000000f1';
UPDATE public.payment_orders SET status = 'failed', metadata = metadata || '{"failure_reason":"card_declined"}'
 WHERE id = 'c3300000-0000-0000-0000-0000000000f2';
UPDATE public.payment_orders SET status = 'canceled', metadata = metadata || '{"cancel_reason":"session_expired"}'
 WHERE id = 'c3300000-0000-0000-0000-0000000000f3';
UPDATE public.payment_orders SET status = 'canceled' WHERE id = 'c3300000-0000-0000-0000-0000000000f4';
UPDATE public.payment_orders SET status = 'canceled', metadata = metadata || '{"cancel_reason":"session_expired"}'
 WHERE id IN ('c3300000-0000-0000-0000-0000000000f5', 'c3300000-0000-0000-0000-0000000000f6');
-- UPDATE bez zmiany statusu.
UPDATE public.payment_orders SET receipt_email = 'x@hub-s3-co.test' WHERE id = 'c3300000-0000-0000-0000-0000000000f1';
RESET ROLE;

-- 3-6. Cztery typy.
SELECT results_eq(
  $$ SELECT aggregate_id FROM public.domain_events WHERE event_type = 'checkout.completed.v1'
       AND tenant_id = 'c3300000-0000-0000-0000-0000000000a0' $$,
  $$ VALUES ('c3300000-0000-0000-0000-0000000000f1') $$,
  'completed: dokładnie jedno, przy przejściu na paid (processing nie emituje)');
SELECT results_eq(
  $$ SELECT aggregate_id, payload ->> 'reason' FROM public.domain_events WHERE event_type = 'checkout.failed.v1'
       AND tenant_id = 'c3300000-0000-0000-0000-0000000000a0' $$,
  $$ VALUES ('c3300000-0000-0000-0000-0000000000f2', 'card_declined') $$,
  'failed: z powodem z metadanych');
SELECT results_eq(
  $$ SELECT aggregate_id, payload ->> 'reason' FROM public.domain_events WHERE event_type = 'checkout.abandoned.v1'
       AND tenant_id = 'c3300000-0000-0000-0000-0000000000a0' $$,
  $$ VALUES ('c3300000-0000-0000-0000-0000000000f3', 'session_expired') $$,
  'abandoned: wyłącznie anulowanie z cancel_reason = session_expired');
SELECT is_empty(
  $$ SELECT 1 FROM public.domain_events
      WHERE aggregate_id IN ('c3300000-0000-0000-0000-0000000000f4')
        AND event_type <> 'checkout.started.v1' $$,
  'anulowanie bez session_expired nie jest porzuceniem');

-- 7. Sandbox i mock - zero zdarzeń kasy.
SELECT is_empty(
  $$ SELECT 1 FROM public.domain_events
      WHERE aggregate_id IN ('c3300000-0000-0000-0000-0000000000f5', 'c3300000-0000-0000-0000-0000000000f6')
        AND event_type LIKE 'checkout.%' $$,
  'sandbox i provider mock nie emitują zdarzeń kasy');

-- 8. UPDATE bez zmiany statusu - bez kolejnego zdarzenia.
SELECT is(
  (SELECT count(*)::int FROM public.domain_events WHERE aggregate_id = 'c3300000-0000-0000-0000-0000000000f1'),
  2, 'zamówienie f1: started + completed (zmiana e-maila nie emituje)');

-- 9. Brak PII w żadnym payloadzie.
SELECT is_empty(
  $$ SELECT 1 FROM public.domain_events
      WHERE event_type LIKE 'checkout.%'
        AND tenant_id IN ('c3300000-0000-0000-0000-0000000000a0', 'c3300000-0000-0000-0000-0000000000b0')
        AND (payload::text ILIKE '%@hub-s3-co.test%' OR payload ? 'receipt_email' OR payload ? 'metadata') $$,
  'payload kasy bez e-maila i bez surowych metadanych');

-- 10. Zamówienie wstawione od razu jako paid - started + completed.
SET LOCAL ROLE service_role;
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency,
                                   provider, environment, paid_at, metadata)
VALUES ('c3300000-0000-0000-0000-0000000000f8', 'c3300000-0000-0000-0000-0000000000a0',
        'c3300000-0000-0000-0000-00000000a001', 'one_time', 'paid', 1900, 'PLN', 'stripe', 'live', now(), '{}');
RESET ROLE;
SELECT results_eq(
  $$ SELECT event_type FROM public.domain_events
      WHERE aggregate_id = 'c3300000-0000-0000-0000-0000000000f8' ORDER BY event_type $$,
  $$ VALUES ('checkout.completed.v1'), ('checkout.started.v1') $$,
  'zamówienie wstawione jako paid: started i completed');

-- 11-12. Awaria szyny nie przerywa zapisu zamówienia.
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text, p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_actor_id uuid DEFAULT NULL, p_suppress_actor boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bus down' USING ERRCODE = 'P0001';
END;
$$;
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$ UPDATE public.payment_orders SET status = 'paid', paid_at = now()
      WHERE id = 'c3300000-0000-0000-0000-0000000000f7' $$,
  'awaria emit_domain_event nie przerywa zmiany statusu zamówienia');
RESET ROLE;
SELECT results_eq(
  $$ SELECT (SELECT status::text FROM public.payment_orders WHERE id = 'c3300000-0000-0000-0000-0000000000f7'),
            (SELECT event_type FROM public.domain_event_emit_errors
              WHERE source = 'tg_payment_orders_checkout_emit'
                AND tenant_id = 'c3300000-0000-0000-0000-0000000000b0') $$,
  $$ VALUES ('paid', 'checkout.completed.v1') $$,
  'status zapisany, ślad awarii z typem zdarzenia w domain_event_emit_errors');

-- 13-14. Wyzwalacz: atrybuty i ACL.
SELECT ok(
  (SELECT p.prosecdef AND 'search_path=public, pg_temp' = ANY (p.proconfig)
     FROM pg_proc p WHERE p.oid = 'public.tg_payment_orders_checkout_emit()'::regprocedure),
  'wyzwalacz: SECURITY DEFINER z search_path public, pg_temp');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.tg_payment_orders_checkout_emit()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.tg_payment_orders_checkout_emit()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.tg_payment_orders_checkout_emit()', 'EXECUTE'),
  'wyzwalacz bez EXECUTE dla ról API');

SELECT * FROM finish();
ROLLBACK;
