-- pgTAP: retencja dziennika webhooków płatności
-- (migracja 20261012101000_payment_webhook_events_retention, audyt SUB-11).
--
-- CO PRZYPINA:
--   1. zdarzenie domknięte starsze niż 30 dni traci dane osobowe (e-mail, imię,
--      adres, dane karty, e-mail w opisie i w treści błędu), a zachowuje
--      identyfikatory, kwoty i metadane domenowe - i dostaje znacznik
--      `_redacted`, po którym ponowienie z panelu odmawia;
--   2. świeże zdarzenie i `failed` młodsze niż 90 dni zostają w całości,
--      `failed` starsze niż 90 dni - już nie;
--   3. partia i idempotencja (wiersz ze znacznikiem nie jest liczony ponownie);
--   4. zamknięcie konta pseudonimizuje zdarzenia konta (po user_id i po
--      subskrypcji operatora z NASZEGO wiersza) w jego środowisku, zeruje
--      userId i kolumnę user_id, a cudzych zdarzeń nie dotyka;
--   5. wszystkie funkcje są wyłącznie dla service_role.
BEGIN;
SELECT plan(19);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  ('f1000000-0000-0000-0000-0000000000f1', 'zamykany@retention.test'),
  ('f1000000-0000-0000-0000-0000000000f2', 'inny@retention.test');
INSERT INTO public.profiles (id, tenant_id)
SELECT u.id, (SELECT id FROM public.tenants WHERE slug = 'nes')
  FROM (VALUES ('f1000000-0000-0000-0000-0000000000f1'::uuid),
               ('f1000000-0000-0000-0000-0000000000f2'::uuid)) AS u(id)
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

-- Ładunek w kształcie zapisywanym przez trasę webhooka (`payload: verified`).
CREATE TEMP TABLE retention_payload ON COMMIT DROP AS
SELECT '{
  "id": "evt_ret_1", "type": "checkout.session.completed", "created": 1790000000,
  "data": {"object": {
    "id": "cs_ret_1", "object": "checkout.session", "amount_total": 5000, "currency": "pln",
    "payment_intent": "pi_ret_1", "customer": "cus_ret_1",
    "customer_email": "platnik@example.com",
    "customer_details": {"email": "platnik@example.com", "name": "Jan Kowalski",
                         "address": {"city": "Warszawa", "line1": "Prosta 1"}, "phone": "+48500100200"},
    "description": "wpłata od jan.kowalski@example.org",
    "metadata": {"purpose": "donation", "donationId": "don-ret-1", "userId": "f1000000-0000-0000-0000-0000000000f1"}
  }}
}'::jsonb AS payload;

INSERT INTO public.payment_webhook_events
  (id, event_id, event_type, environment, status, payload, error, occurred_at, created_at)
VALUES
  ('f2000000-0000-0000-0000-000000000001', 'evt_ret_old', 'checkout.session.completed', 'live',
   'processed', (SELECT payload FROM retention_payload), 'odrzucono dla platnik@example.com',
   now() - interval '31 days', now() - interval '31 days'),
  ('f2000000-0000-0000-0000-000000000002', 'evt_ret_fresh', 'checkout.session.completed', 'live',
   'processed', (SELECT payload FROM retention_payload), NULL,
   now() - interval '5 days', now() - interval '5 days'),
  ('f2000000-0000-0000-0000-000000000003', 'evt_ret_failed_31', 'checkout.session.completed', 'live',
   'failed', (SELECT payload FROM retention_payload), 'boom',
   now() - interval '31 days', now() - interval '31 days'),
  ('f2000000-0000-0000-0000-000000000004', 'evt_ret_failed_91', 'checkout.session.completed', 'live',
   'failed', (SELECT payload FROM retention_payload), 'boom',
   now() - interval '91 days', now() - interval '91 days');

SELECT ok(
  NOT has_function_privilege('anon', 'public.payment_webhook_events_redact_expired(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.payment_webhook_events_redact_expired(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.payment_webhook_events_redact_for_user(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.payment_webhook_events_redact_for_user(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.payment_webhook_payload_scrub(jsonb, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.payment_webhook_payload_redact(jsonb, text, boolean)', 'EXECUTE'),
  'retencja: żadna funkcja nie jest dostępna dla ról klienckich'
);
SELECT ok(
  has_function_privilege('service_role', 'public.payment_webhook_events_redact_expired(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.payment_webhook_events_redact_for_user(uuid)', 'EXECUTE'),
  'retencja: service_role (pg_cron / zamknięcie konta)'
);

SET LOCAL ROLE service_role;
SELECT cmp_ok(public.payment_webhook_events_redact_expired(1), '=', 1,
  'partia 1 pseudonimizuje dokładnie jeden wiersz');
SELECT cmp_ok(public.payment_webhook_events_redact_expired(50000), '>=', 1,
  'kolejny przebieg domyka resztę zaległych');
SELECT is(
  (SELECT count(*)::int FROM public.payment_webhook_events
    WHERE id IN ('f2000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000004')
      AND NOT (payload ? '_redacted')),
  0,
  'po przebiegu nie zostaje zaległy wiersz z zakresu testu'
);
SELECT is(public.payment_webhook_events_redact_expired(50000), 0,
  'wiersz ze znacznikiem nie jest pseudonimizowany ponownie');
RESET ROLE;

SELECT is(
  (SELECT payload #> '{data,object,customer_details}' FROM public.payment_webhook_events
    WHERE id = 'f2000000-0000-0000-0000-000000000001'),
  'null'::jsonb,
  'dane klienta (e-mail, imię, adres, telefon) znikają w całości'
);
SELECT is(
  (SELECT payload #>> '{data,object,customer_email}' FROM public.payment_webhook_events
    WHERE id = 'f2000000-0000-0000-0000-000000000001'),
  NULL,
  'e-mail płatnika na poziomie obiektu znika'
);
SELECT is(
  (SELECT payload #>> '{data,object,description}' FROM public.payment_webhook_events
    WHERE id = 'f2000000-0000-0000-0000-000000000001'),
  'wpłata od [redacted-email]',
  'adres e-mail w dowolnym napisie jest maskowany'
);
SELECT is(
  (SELECT error FROM public.payment_webhook_events WHERE id = 'f2000000-0000-0000-0000-000000000001'),
  'odrzucono dla [redacted-email]',
  'adres e-mail w treści błędu też jest maskowany'
);
SELECT is(
  (SELECT jsonb_build_array(
            payload ->> 'id',
            payload #>> '{data,object,id}',
            payload #>> '{data,object,payment_intent}',
            payload #>> '{data,object,customer}',
            payload #>> '{data,object,amount_total}',
            payload #>> '{data,object,metadata,donationId}',
            payload #>> '{data,object,metadata,userId}',
            payload #>> '{_redacted,reason}')
     FROM public.payment_webhook_events WHERE id = 'f2000000-0000-0000-0000-000000000001'),
  '["evt_ret_1", "cs_ret_1", "pi_ret_1", "cus_ret_1", "5000", "don-ret-1", "f1000000-0000-0000-0000-0000000000f1", "retention"]'::jsonb,
  'zostają identyfikatory, kwota i metadane domenowe (uzgodnienie z wyciągiem) + znacznik'
);
SELECT ok(
  (SELECT NOT (payload ? '_redacted') AND payload #>> '{data,object,customer_email}' = 'platnik@example.com'
     FROM public.payment_webhook_events WHERE id = 'f2000000-0000-0000-0000-000000000002'),
  'zdarzenie z ostatnich 30 dni zostaje w całości (ponowienia, diagnostyka)'
);
SELECT ok(
  (SELECT NOT (payload ? '_redacted') FROM public.payment_webhook_events
    WHERE id = 'f2000000-0000-0000-0000-000000000003'),
  'nierozwiązane `failed` młodsze niż 90 dni zachowuje ładunek do diagnozy'
);
SELECT ok(
  (SELECT payload ? '_redacted' FROM public.payment_webhook_events
    WHERE id = 'f2000000-0000-0000-0000-000000000004'),
  '`failed` starsze niż 90 dni też traci dane osobowe'
);

-- ── Zamknięcie konta ────────────────────────────────────────────────────────
INSERT INTO public.donations
  (tenant_id, user_id, amount_cents, currency, provider, provider_session_id,
   provider_subscription_id, environment, recurring, status)
VALUES ((SELECT id FROM public.tenants WHERE slug = 'nes'), 'f1000000-0000-0000-0000-0000000000f1',
        5000, 'PLN', 'stripe', 'cs_ret_closure', 'sub_ret_closure', 'live', true, 'pending');

INSERT INTO public.payment_webhook_events
  (id, event_id, event_type, environment, status, payload, user_id, subscription_id, occurred_at)
VALUES
  ('f3000000-0000-0000-0000-000000000001', 'evt_cl_user', 'checkout.session.completed', 'live',
   'processed', (SELECT payload FROM retention_payload), 'f1000000-0000-0000-0000-0000000000f1', NULL, now()),
  ('f3000000-0000-0000-0000-000000000002', 'evt_cl_sub', 'invoice.paid', 'live',
   'processed', (SELECT payload FROM retention_payload), NULL, 'sub_ret_closure', now()),
  ('f3000000-0000-0000-0000-000000000003', 'evt_cl_sub_sbx', 'invoice.paid', 'sandbox',
   'processed', (SELECT payload FROM retention_payload), NULL, 'sub_ret_closure', now()),
  ('f3000000-0000-0000-0000-000000000004', 'evt_cl_other', 'checkout.session.completed', 'live',
   'processed', (SELECT payload FROM retention_payload), 'f1000000-0000-0000-0000-0000000000f2', NULL, now());

SET LOCAL ROLE service_role;
SELECT is(
  public.payment_webhook_events_redact_for_user('f1000000-0000-0000-0000-0000000000f1'),
  2,
  'zamknięcie konta obejmuje zdarzenie konta i zdarzenie jego subskrypcji'
);
RESET ROLE;

SELECT is(
  (SELECT jsonb_build_array(user_id, payload #>> '{data,object,metadata,userId}',
                            payload #>> '{_redacted,reason}')
     FROM public.payment_webhook_events WHERE id = 'f3000000-0000-0000-0000-000000000001'),
  '[null, null, "account_closure"]'::jsonb,
  'zdarzenie konta: bez user_id i bez userId w ładunku'
);
SELECT ok(
  (SELECT payload ? '_redacted' AND payload #> '{data,object,customer_details}' = 'null'::jsonb
     FROM public.payment_webhook_events WHERE id = 'f3000000-0000-0000-0000-000000000002'),
  'zdarzenie subskrypcji konta (bez user_id) też traci dane osobowe'
);
SELECT ok(
  (SELECT NOT (payload ? '_redacted') FROM public.payment_webhook_events
    WHERE id = 'f3000000-0000-0000-0000-000000000003'),
  'ten sam identyfikator w INNYM środowisku nie jest zdarzeniem tego konta'
);
SELECT ok(
  (SELECT NOT (payload ? '_redacted') AND user_id = 'f1000000-0000-0000-0000-0000000000f2'
     FROM public.payment_webhook_events WHERE id = 'f3000000-0000-0000-0000-000000000004'),
  'zdarzenie cudzego konta zostaje nietknięte'
);

SELECT * FROM finish();
ROLLBACK;
