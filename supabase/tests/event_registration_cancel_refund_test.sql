-- pgTAP: rezygnacja, anulowanie przez organizatora i zwroty (REG-03, REG-13
-- czesc rezygnacji, REG-17 czesc rezygnacji). Migracje 20261012170000
-- i 20261012170100.
--
-- KRYTERIUM AUDYTU REG-03: „oplacone + rezygnacja -> zlecenie albo
-- needs_review". Kazde zamkniecie oplaconego zgloszenia - w terminie zwrotu,
-- po terminie, przy wylaczonych zwrotach, przy wspolnej wplacie grupy, przy
-- wplacie recznej, przez organizatora (ze zwrotem i bez) i surowym UPDATE -
-- zostawia wiersz w `event_registration_refund_jobs` (pending albo
-- needs_review/cancelled z powodem). Rezygnacja w terminie dzwoni do
-- administratorow najemcy (rodzaj billing, takze przy wylaczonych
-- powiadomieniach o wydarzeniach), nie do obcego najemcy.
--
-- KRYTERIUM AUDYTU REG-13 (rezygnacja): „anulowanie po ends_at -> odmowa".
-- Rezygnacja po koncu (takze bez ends_at: starts_at + 24 h) to `event_ended`,
-- kolejka nie awansuje; organizator moze zamknac zgloszenie po koncu, ale bez
-- awansu. Klucz samoobslugi po koncu: `manage_expired`.
--
-- Plus: migawka zasady zwrotu, potwierdzenie skutku (refund_ack_required /
-- refund_terms_changed), podglad bez wyroczni, decyzje organizatora o zleceniu,
-- straznik ponownego przyjecia i ACL nowych funkcji.
BEGIN;
SELECT plan(64);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b40a0000-0000-0000-0000-0000000000aa', 'b4cr-a', 'B4 Cancel Refund A', 'b4cr-a.example'),
  ('b40b0000-0000-0000-0000-0000000000bb', 'b4cr-b', 'B4 Cancel Refund B', 'b4cr-b.example');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b4000000-0000-0000-0000-0000000000a1', 'b4-admin-a@example.org', now()),
  ('b4000000-0000-0000-0000-0000000000b1', 'b4-admin-b@example.org', now()),
  ('b4000000-0000-0000-0000-0000000000c1', 'b4-participant@example.org', now());

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b4000000-0000-0000-0000-0000000000a1', 'b4-admin-a@example.org', 'Admin A', 'b40a0000-0000-0000-0000-0000000000aa'),
  ('b4000000-0000-0000-0000-0000000000b1', 'b4-admin-b@example.org', 'Admin B', 'b40b0000-0000-0000-0000-0000000000bb'),
  ('b4000000-0000-0000-0000-0000000000c1', 'b4-participant@example.org', 'Uczestnik', 'b40a0000-0000-0000-0000-0000000000aa');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('b4000000-0000-0000-0000-0000000000a1', 'admin', 'b40a0000-0000-0000-0000-0000000000aa'),
  ('b4000000-0000-0000-0000-0000000000b1', 'admin', 'b40b0000-0000-0000-0000-0000000000bb');

-- Administrator A wylaczyl dzwonki o wydarzeniach - pieniadze (billing) i tak
-- dochodza.
INSERT INTO public.notification_preferences (user_id, tenant_id, enabled_event) VALUES
  ('b4000000-0000-0000-0000-0000000000a1', 'b40a0000-0000-0000-0000-0000000000aa', false);

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status, registration_mode) VALUES
  ('b4100000-0000-0000-0000-000000000001', 'b40a0000-0000-0000-0000-0000000000aa', 'b4cr-window',
   'B4 w terminie', 'B4 in window', now() + interval '30 days', NULL, 'published', 'form'),
  ('b4100000-0000-0000-0000-000000000002', 'b40a0000-0000-0000-0000-0000000000aa', 'b4cr-late',
   'B4 po terminie', 'B4 late', now() + interval '10 days', NULL, 'published', 'form'),
  ('b4100000-0000-0000-0000-000000000003', 'b40a0000-0000-0000-0000-0000000000aa', 'b4cr-none',
   'B4 bez zwrotow', 'B4 no refunds', now() + interval '30 days', NULL, 'published', 'form'),
  ('b4100000-0000-0000-0000-000000000004', 'b40a0000-0000-0000-0000-0000000000aa', 'b4cr-ended',
   'B4 zakonczone', 'B4 ended', now() - interval '2 days', now() - interval '1 hour', 'published', 'form'),
  ('b4100000-0000-0000-0000-000000000005', 'b40a0000-0000-0000-0000-0000000000aa', 'b4cr-ended-24h',
   'B4 bez konca', 'B4 no end', now() - interval '25 hours', NULL, 'published', 'form'),
  ('b4100000-0000-0000-0000-000000000006', 'b40a0000-0000-0000-0000-0000000000aa', 'b4cr-running',
   'B4 trwa', 'B4 running', now() - interval '1 hour', now() + interval '5 hours', 'published', 'form'),
  ('b4100000-0000-0000-0000-000000000007', 'b40a0000-0000-0000-0000-0000000000aa', 'b4cr-group',
   'B4 grupa', 'B4 group', now() + interval '30 days', NULL, 'published', 'form'),
  ('b4100000-0000-0000-0000-000000000008', 'b40a0000-0000-0000-0000-0000000000aa', 'b4cr-manual',
   'B4 wplata reczna', 'B4 manual', now() + interval '30 days', NULL, 'published', 'form'),
  ('b4100000-0000-0000-0000-000000000009', 'b40a0000-0000-0000-0000-0000000000aa', 'b4cr-organizer',
   'B4 organizator', 'B4 organizer', now() + interval '30 days', NULL, 'published', 'form'),
  ('b4100000-0000-0000-0000-00000000000a', 'b40a0000-0000-0000-0000-0000000000aa', 'b4cr-snapshot',
   'B4 migawka', 'B4 snapshot', now() + interval '30 days', NULL, 'published', 'form'),
  ('b4100000-0000-0000-0000-0000000000b1', 'b40b0000-0000-0000-0000-0000000000bb', 'b4cr-b',
   'B4 najemca B', 'B4 tenant B', now() + interval '30 days', NULL, 'published', 'form');

INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency)
SELECT ('b4200000-0000-0000-0000-0000000000' || s)::uuid, 'b40a0000-0000-0000-0000-0000000000aa',
       ('b4100000-0000-0000-0000-0000000000' || s)::uuid, 'b4-' || s, 'Wstep', 'Admission', 10000, 'PLN'
  FROM unnest(ARRAY['01', '02', '03', '07', '08', '09', '0a']) AS s;

-- Zasady zwrotu PRZED zaplata (migawka czyta je przy wstawieniu):
-- e2 - zwroty do 720 h przed startem (startuje za 10 dni: termin minal),
-- e3 - bez samodzielnych zwrotow.
INSERT INTO public.event_participant_settings (tenant_id, event_id, refund_mode, refund_deadline_hours) VALUES
  ('b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000002', 'policy', 720),
  ('b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000003', 'none', 168);

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('b4300000-0000-0000-0000-0000000000c1', 'b40a0000-0000-0000-0000-0000000000aa',
   'b4000000-0000-0000-0000-0000000000c1', 'b4-participant@example.org', 'Ula', 'Uczestnik'),
  ('b4300000-0000-0000-0000-0000000000d1', 'b40a0000-0000-0000-0000-0000000000aa', NULL,
   'b4-lead@example.org', 'Lena', 'Prowadzaca'),
  ('b4300000-0000-0000-0000-0000000000d2', 'b40a0000-0000-0000-0000-0000000000aa', NULL,
   'b4-guest@example.org', 'Gosia', 'Gosc'),
  ('b4300000-0000-0000-0000-0000000000d3', 'b40a0000-0000-0000-0000-0000000000aa', NULL,
   'b4-waitlist@example.org', 'Wit', 'Kolejka'),
  ('b4300000-0000-0000-0000-0000000000e1', 'b40a0000-0000-0000-0000-0000000000aa', NULL,
   'b4-org1@example.org', 'Olga', 'Jeden'),
  ('b4300000-0000-0000-0000-0000000000e2', 'b40a0000-0000-0000-0000-0000000000aa', NULL,
   'b4-org2@example.org', 'Olek', 'Dwa'),
  ('b4300000-0000-0000-0000-0000000000e3', 'b40a0000-0000-0000-0000-0000000000aa', NULL,
   'b4-org3@example.org', 'Ola', 'Trzy'),
  ('b4300000-0000-0000-0000-0000000000b1', 'b40b0000-0000-0000-0000-0000000000bb', NULL,
   'b4-tenant-b@example.org', 'Bea', 'Obca');

-- Zamowienia Stripe: tylko rola serwisowa zaklada zamowienie `paid`.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency, provider,
                                   environment, provider_payment_intent_id, paid_at, metadata)
SELECT ('b4500000-0000-0000-0000-0000000000' || o.s)::uuid, 'b40a0000-0000-0000-0000-0000000000aa',
       'b4000000-0000-0000-0000-0000000000c1', 'one_time', 'paid', o.amount, 'PLN', 'stripe', 'sandbox',
       'pi_b4_' || o.s, now(),
       jsonb_build_object('event_id', ('b4100000-0000-0000-0000-0000000000' || o.e)::text,
                          'registration_id', ('b4400000-0000-0000-0000-0000000000' || o.s)::text,
                          'ticket_type_id', ('b4200000-0000-0000-0000-0000000000' || o.e)::text)
  FROM (VALUES ('01', '01', 10000), ('02', '02', 10000), ('03', '03', 10000), ('71', '07', 20000),
               ('91', '09', 10000), ('92', '09', 10000), ('93', '09', 10000), ('0a', '0a', 10000))
       AS o(s, e, amount);
SELECT set_config('request.jwt.claim.role', '', true);

-- Zgloszenia. Klucze samoobslugi: 32 znaki base64url, w bazie tylko sha256.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   payment_order_id, paid_at, manage_token_hash, group_lead_registration_id, waitlist_position) VALUES
  ('b4400000-0000-0000-0000-000000000001', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000001',
   'b4300000-0000-0000-0000-0000000000c1', 'b4200000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   'b4500000-0000-0000-0000-000000000001', now(), NULL, NULL, NULL),
  ('b4400000-0000-0000-0000-000000000002', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000002',
   'b4300000-0000-0000-0000-0000000000c1', 'b4200000-0000-0000-0000-000000000002', 'approved', 'form', 'paid',
   'b4500000-0000-0000-0000-000000000002', now(), NULL, NULL, NULL),
  ('b4400000-0000-0000-0000-000000000003', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000003',
   'b4300000-0000-0000-0000-0000000000c1', 'b4200000-0000-0000-0000-000000000003', 'approved', 'form', 'paid',
   'b4500000-0000-0000-0000-000000000003', now(), NULL, NULL, NULL),
  ('b4400000-0000-0000-0000-000000000004', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000004',
   'b4300000-0000-0000-0000-0000000000c1', NULL, 'approved', 'form', 'not_required',
   NULL, NULL, encode(extensions.digest(rpad('b4-ended', 32, 'x'), 'sha256'), 'hex'), NULL, NULL),
  ('b4400000-0000-0000-0000-000000000041', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000004',
   'b4300000-0000-0000-0000-0000000000d3', NULL, 'waitlist', 'form', 'not_required',
   NULL, NULL, NULL, NULL, 1),
  ('b4400000-0000-0000-0000-000000000005', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000005',
   'b4300000-0000-0000-0000-0000000000c1', NULL, 'approved', 'form', 'not_required',
   NULL, NULL, NULL, NULL, NULL),
  ('b4400000-0000-0000-0000-000000000006', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000006',
   'b4300000-0000-0000-0000-0000000000c1', NULL, 'approved', 'form', 'not_required',
   NULL, NULL, NULL, NULL, NULL),
  ('b4400000-0000-0000-0000-000000000071', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000007',
   'b4300000-0000-0000-0000-0000000000d1', 'b4200000-0000-0000-0000-000000000007', 'approved', 'form', 'paid',
   'b4500000-0000-0000-0000-000000000071', now(), encode(extensions.digest(rpad('b4-lead', 32, 'x'), 'sha256'), 'hex'), NULL, NULL),
  ('b4400000-0000-0000-0000-000000000072', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000007',
   'b4300000-0000-0000-0000-0000000000d2', 'b4200000-0000-0000-0000-000000000007', 'approved', 'form', 'paid',
   'b4500000-0000-0000-0000-000000000071', now(), encode(extensions.digest(rpad('b4-guest', 32, 'x'), 'sha256'), 'hex'),
   'b4400000-0000-0000-0000-000000000071', NULL),
  ('b4400000-0000-0000-0000-000000000008', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000008',
   'b4300000-0000-0000-0000-0000000000c1', 'b4200000-0000-0000-0000-000000000008', 'approved', 'form', 'paid',
   NULL, now(), NULL, NULL, NULL),
  ('b4400000-0000-0000-0000-000000000091', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000009',
   'b4300000-0000-0000-0000-0000000000e1', 'b4200000-0000-0000-0000-000000000009', 'approved', 'form', 'paid',
   'b4500000-0000-0000-0000-000000000091', now(), NULL, NULL, NULL),
  ('b4400000-0000-0000-0000-000000000092', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000009',
   'b4300000-0000-0000-0000-0000000000e2', 'b4200000-0000-0000-0000-000000000009', 'approved', 'form', 'paid',
   'b4500000-0000-0000-0000-000000000092', now(), NULL, NULL, NULL),
  ('b4400000-0000-0000-0000-000000000093', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000009',
   'b4300000-0000-0000-0000-0000000000e3', 'b4200000-0000-0000-0000-000000000009', 'approved', 'form', 'paid',
   'b4500000-0000-0000-0000-000000000093', now(), NULL, NULL, NULL),
  ('b4400000-0000-0000-0000-00000000000a', 'b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-00000000000a',
   'b4300000-0000-0000-0000-0000000000c1', 'b4200000-0000-0000-0000-00000000000a', 'approved', 'form', 'paid',
   'b4500000-0000-0000-0000-00000000000a', now(), NULL, NULL, NULL),
  ('b4400000-0000-0000-0000-0000000000b1', 'b40b0000-0000-0000-0000-0000000000bb', 'b4100000-0000-0000-0000-0000000000b1',
   'b4300000-0000-0000-0000-0000000000b1', NULL, 'approved', 'form', 'not_required',
   NULL, NULL, encode(extensions.digest(rpad('b4-tenant-b', 32, 'x'), 'sha256'), 'hex'), NULL, NULL);

-- Organizator zmienia zasade e10 na „bez zwrotow" PO zaplacie (migawka trzyma
-- „do terminu").
INSERT INTO public.event_participant_settings (tenant_id, event_id, refund_mode, refund_deadline_hours) VALUES
  ('b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-00000000000a', 'none', 168);

-- Zlecenie zwrotu (jeden wiersz) - zamowieniem albo, recznie, zgloszeniem.
CREATE FUNCTION pg_temp.b4_job(_reg uuid) RETURNS public.event_registration_refund_jobs
LANGUAGE sql AS $$
  SELECT j.* FROM public.event_registration_refund_jobs j
   WHERE j.registration_id = _reg
      OR j.payment_order_id = (SELECT r.payment_order_id FROM public.event_registrations r WHERE r.id = _reg)
   ORDER BY j.created_at DESC LIMIT 1
$$;

-- ── 1-8. ACL i opisy ─────────────────────────────────────────────────────────
SELECT ok(has_function_privilege('anon', 'public.event_registration_cancel_preview(jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.event_registration_cancel_preview(jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.event_registration_cancel_preview(jsonb)', 'EXECUTE'),
  'podglad rezygnacji: anon, authenticated, service_role (dowodem jest klucz albo konto)');
SELECT ok(has_function_privilege('anon', 'public.event_registration_cancel(jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.event_registration_cancel(jsonb)', 'EXECUTE'),
  'rezygnacja: nadal dla goscia z kluczem i dla konta');
SELECT ok(NOT has_function_privilege('anon', 'public._event_registration_refund_assess(uuid,uuid,text,timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_registration_refund_assess(uuid,uuid,text,timestamptz)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public._event_registration_refund_assess(uuid,uuid,text,timestamptz)', 'EXECUTE'),
  '_event_registration_refund_assess: tylko service_role');
SELECT ok(NOT has_function_privilege('anon', 'public._event_registration_cancel_refund(uuid,uuid,text,uuid,jsonb,boolean,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_registration_cancel_refund(uuid,uuid,text,uuid,jsonb,boolean,text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public._event_registration_cancel_refund(uuid,uuid,text,uuid,jsonb,boolean,text)', 'EXECUTE'),
  '_event_registration_cancel_refund: tylko service_role');
SELECT ok(NOT has_function_privilege('anon', 'public._event_refund_alert_organizers(uuid,uuid,text,text,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_refund_alert_organizers(uuid,uuid,text,text,text,text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public._event_refund_alert_organizers(uuid,uuid,text,text,text,text)', 'EXECUTE'),
  '_event_refund_alert_organizers: tylko service_role');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_event_registration_refund_preview(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.admin_event_refund_job_decide(jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.admin_event_registration_refund_preview(uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.admin_event_refund_job_decide(jsonb)', 'EXECUTE'),
  'RPC organizatora: bez anon, authenticated za bramka administratora');
SELECT ok(NOT has_table_privilege('anon', 'public.event_registration_refund_jobs', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.event_registration_refund_jobs', 'SELECT'),
  'tabela zlecen zwrotu nadal niewidoczna dla klienta');
SELECT ok(
  (SELECT bool_and(obj_description(p.oid, 'pg_proc') IS NOT NULL)
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('_event_registration_refund_assess', '_event_refund_alert_organizers',
                        '_event_registration_cancel_refund', '_event_registration_refund_terms_snapshot',
                        'event_registration_cancel_preview', 'admin_event_registration_refund_preview',
                        'admin_event_refund_job_decide', 'event_registration_cancel',
                        'admin_event_registration_decide')),
  'kazda nowa i zmieniona funkcja ma COMMENT');

-- ── 9-11. Migawka i ksztalt zlecenia ────────────────────────────────────────────
SELECT ok(
  (SELECT r.refund_terms_mode = 'policy'
      AND r.refund_terms_deadline_at = LEAST(e.starts_at - interval '168 hours', r.paid_at + interval '30 days')
     FROM public.event_registrations r JOIN public.events e ON e.id = r.event_id
    WHERE r.id = 'b4400000-0000-0000-0000-000000000001'),
  'migawka: zaplata zapisuje tryb i termin (LEAST(start - 168 h, zaplata + 30 dni))');
SELECT ok(
  (SELECT refund_terms_mode = 'none' AND refund_terms_deadline_at IS NULL
     FROM public.event_registrations WHERE id = 'b4400000-0000-0000-0000-000000000003'),
  'migawka: tryb none bez terminu');
SELECT throws_ok(
  $$INSERT INTO public.event_registration_refund_jobs (tenant_id, event_id, payment_order_id, registration_id, state)
    VALUES ('b40a0000-0000-0000-0000-0000000000aa', 'b4100000-0000-0000-0000-000000000008', NULL,
            'b4400000-0000-0000-0000-000000000008', 'pending')$$,
  '23514', NULL, 'zlecenie bez zamowienia nie trafia do kolejki operatora (CHECK)');

-- ── 12-21. REG-03: rezygnacja w terminie zwrotu (konto uczestnika) ───────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.event_registration_cancel_preview(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000001'))
    -> 'refund' ->> 'effect',
  'full_refund', 'podglad: w terminie - pelny zwrot');
SELECT ok(
  (SELECT (v->'refund'->>'amount_cents')::int = 10000
      AND (v->'refund'->>'acknowledgement_required')::boolean
      AND (v->>'can_cancel')::boolean
      AND NOT (v->'refund' ? 'payment_order_id')
     FROM (SELECT public.event_registration_cancel_preview(
             jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000001')) AS v) x),
  'podglad: kwota, wymagane potwierdzenie, bez identyfikatora zamowienia');
SELECT throws_like(
  $$SELECT public.event_registration_cancel(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000001'))$$,
  'refund_ack_required%', 'oplacone: rezygnacja bez potwierdzenia skutku jest odrzucana');
SELECT throws_like(
  $$SELECT public.event_registration_cancel(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000001',
    'acknowledged_effect', 'no_refund'))$$,
  'refund_terms_changed%', 'oplacone: potwierdzony inny skutek niz biezacy -> refund_terms_changed');
SELECT is(
  public.event_registration_cancel(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000001',
    'acknowledged_effect', 'full_refund')) -> 'refund' ->> 'job_state',
  'pending', 'rezygnacja w terminie: wynik mowi o zleconym zwrocie');
RESET ROLE;

SELECT ok(
  (SELECT j.state = 'pending' AND j.origin = 'participant_cancelled' AND j.amount_cents = 10000
      AND j.currency = 'PLN' AND j.payment_order_id = 'b4500000-0000-0000-0000-000000000001'
     FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000001') j),
  'REG-03 KRYTERIUM: oplacone + rezygnacja w terminie -> zlecenie pending (participant_cancelled, 10000 PLN)');
SELECT is(
  (SELECT count(*)::int FROM public.domain_events d
    WHERE d.aggregate_id = 'b4400000-0000-0000-0000-000000000001'
      AND d.event_type = 'event.registration.refund_requested.v1'
      AND d.payload->>'job_id' = (SELECT j.id::text FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000001') j)),
  1, 'szyna: dokladnie jedno event.registration.refund_requested.v1 ze zleceniem');
SELECT ok(
  EXISTS (SELECT 1 FROM public.notifications n
           WHERE n.user_id = 'b4000000-0000-0000-0000-0000000000a1'
             AND n.kind = 'billing'
             AND n.href = '/admin/events/b4100000-0000-0000-0000-000000000001/registration/list'),
  'dzwonek billing do administratora najemcy (mimo wylaczonych dzwonkow o wydarzeniach)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.notifications n
               WHERE n.user_id = 'b4000000-0000-0000-0000-0000000000b1'
                 AND n.href LIKE '/admin/events/b41%'),
  'izolacja: administrator OBCEGO najemcy nie dostaje dzwonka');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT ok(
  EXISTS (SELECT 1 FROM jsonb_array_elements(public._event_registration_refunds_claim(100)) c
           WHERE c->>'id' = (SELECT j.id::text FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000001') j)
             AND c->>'origin' = 'participant_cancelled'),
  'dzierzawa: worker dostaje zlecenie z pochodzeniem participant_cancelled');
RESET ROLE;

-- ── 22-25. Po terminie, bez zwrotow, migawka korzystniejsza ──────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.event_registration_cancel_preview(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000002'))
    -> 'refund' ->> 'review_reason',
  'outside_refund_window', 'podglad: po terminie - bez zwrotu, decyduje organizator');
SELECT lives_ok(
  $$SELECT public.event_registration_cancel(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000002',
    'acknowledged_effect', 'no_refund'))$$,
  'po terminie: rezygnacja z potwierdzonym brakiem zwrotu przechodzi');
SELECT lives_ok(
  $$SELECT public.event_registration_cancel(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000003',
    'acknowledged_effect', 'no_refund'))$$,
  'bez zwrotow: rezygnacja z potwierdzeniem przechodzi');
SELECT is(
  public.event_registration_cancel(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-00000000000a',
    'acknowledged_effect', 'full_refund')) -> 'refund' ->> 'effect',
  'full_refund', 'migawka: zmiana zasady na „bez zwrotow" PO zaplacie nie skraca prawa do zwrotu');
RESET ROLE;

SELECT ok(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'outside_refund_window'
     FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000002') j),
  'REG-03 KRYTERIUM: oplacone + rezygnacja po terminie -> needs_review (outside_refund_window)');
SELECT ok(
  EXISTS (SELECT 1 FROM public.notifications n
           WHERE n.user_id = 'b4000000-0000-0000-0000-0000000000a1'
             AND n.kind = 'billing'
             AND n.href = '/admin/events/b4100000-0000-0000-0000-000000000002/registration/list'
             AND n.title_pl LIKE '%czeka na decyzję%'),
  'po terminie: dzwonek do organizatora „zwrot czeka na decyzje"');
SELECT ok(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'refund_disabled'
     FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000003') j),
  'REG-03 KRYTERIUM: refund_mode none -> needs_review (refund_disabled)');
SELECT ok(
  (SELECT j.state = 'pending' FROM pg_temp.b4_job('b4400000-0000-0000-0000-00000000000a') j),
  'migawka: zlecenie pending mimo biezacej zasady „bez zwrotow"');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT ok(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public._event_registration_refunds_claim(100)) c
               WHERE c->>'id' = (SELECT j.id::text FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000002') j)),
  'needs_review nie trafia do workera (zwrot po terminie decyduje organizator)');
RESET ROLE;

-- Webhook zwrotu konczy zlecenie (stan po dzierzawie: processing).
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT lives_ok($$SELECT public.payments_apply_event_ticket_outcome('b4500000-0000-0000-0000-000000000001', 'refunded')$$,
  'webhook zwrotu przyjety');
SELECT set_config('request.jwt.claim.role', '', true);
SELECT is((SELECT j.state FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000001') j), 'completed',
  'webhook zwrotu konczy zlecenie z rezygnacji');

-- ── 32-35. Wspolna wplata grupy (gosc, potem prowadzacy; klucze, anon) ───────
SELECT set_config('request.headers', '{"x-tenant-host":"b4cr-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT ok(
  (SELECT v->'refund'->>'effect' = 'organizer_review'
      AND v->'refund'->>'review_reason' = 'shared_payment'
      AND v->'refund'->'amount_cents' = 'null'::jsonb
     FROM (SELECT public.event_registration_cancel_preview(
             jsonb_build_object('manage_token', rpad('b4-guest', 32, 'x'))) AS v) x),
  'podglad goscia: wspolna wplata -> decyduje organizator, BEZ kwoty prowadzacego');
SELECT lives_ok(
  $$SELECT public.event_registration_cancel(jsonb_build_object('manage_token', rpad('b4-guest', 32, 'x'),
    'acknowledged_effect', 'organizer_review'))$$,
  'gosc rezygnuje kluczem z potwierdzeniem');
RESET ROLE;
SELECT ok(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'shared_payment'
      AND j.registration_id = 'b4400000-0000-0000-0000-000000000072'
     FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000072') j),
  'REG-03 KRYTERIUM: wspolna wplata grupy -> needs_review (shared_payment)');
SET LOCAL ROLE anon;
SELECT lives_ok(
  $$SELECT public.event_registration_cancel(jsonb_build_object('manage_token', rpad('b4-lead', 32, 'x'),
    'acknowledged_effect', 'full_refund'))$$,
  'prowadzacy rezygnuje kluczem - wplata nie jest juz wspolna');
RESET ROLE;
SELECT ok(
  (SELECT count(*) = 1 AND bool_and(j.state = 'pending' AND j.registration_id = 'b4400000-0000-0000-0000-000000000071'
                                    AND j.amount_cents = 20000)
     FROM public.event_registration_refund_jobs j
    WHERE j.payment_order_id = 'b4500000-0000-0000-0000-000000000071'),
  'ten sam wiersz zlecenia przechodzi na prowadzacego: pending, cala kwota zamowienia');

-- ── 37-40. Wplata reczna (bez zamowienia) ───────────────────────────────────────
SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.event_registration_cancel(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000008',
    'acknowledged_effect', 'organizer_review'))$$,
  'wplata reczna: rezygnacja z potwierdzeniem przechodzi');
RESET ROLE;
SELECT ok(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'manual_payment' AND j.payment_order_id IS NULL
     FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000008') j),
  'REG-03 KRYTERIUM: wplata reczna -> needs_review (manual_payment, bez zamowienia)');

SELECT set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  format($$SELECT public.admin_event_refund_job_decide(jsonb_build_object('job_id', %L, 'action', 'refund'))$$,
         (SELECT j.id FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000008') j)),
  'refund_manual_payment%', 'decyzja: wplaty recznej nie da sie zwrocic przez operatora');
SELECT is(
  public.admin_event_refund_job_decide(jsonb_build_object(
    'job_id', (SELECT j.id FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000008') j),
    'action', 'mark_refunded', 'note', 'Przelew zwrotny 12.10')) ->> 'state',
  'completed', 'decyzja: oznaczenie zwrotu recznego konczy zlecenie');
RESET ROLE;
SELECT is((SELECT payment_status FROM public.event_registrations WHERE id = 'b4400000-0000-0000-0000-000000000008'),
  'refunded', 'oznaczenie zwrotu recznego ustawia payment_status refunded');

-- ── 42-48. Anulowanie przez organizatora ────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT v->>'effect' = 'full_refund' AND v->>'payment_status' = 'paid' AND (v->>'amount_cents')::int = 10000
     FROM (SELECT public.admin_event_registration_refund_preview('b4400000-0000-0000-0000-000000000091') AS v) x),
  'podglad organizatora: anulowanie oplaconego = pelny zwrot 10000');
SELECT is(
  public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000091',
    'action', 'cancel')) -> 'refund' ->> 'job_state',
  'pending', 'organizator anuluje oplacone -> zwrot automatyczny');
SELECT throws_like(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000092',
    'action', 'cancel', 'refund', 'none'))$$,
  'reason_required%', 'organizator: „nie zwracaj" bez notatki jest odrzucane');
SELECT lives_ok(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000092',
    'action', 'cancel', 'refund', 'none', 'note', 'Uzgodnione telefonicznie - bilet przechodzi na 2027'))$$,
  'organizator: „nie zwracaj" z notatka przechodzi');
SELECT throws_like(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000093',
    'action', 'approve', 'refund', 'none'))$$,
  'invalid_request%', 'wybor zwrotu tylko przy anulowaniu');
RESET ROLE;
SELECT ok(
  (SELECT j.state = 'pending' AND j.origin = 'organizer_cancelled' AND j.requested_by = 'b4000000-0000-0000-0000-0000000000a1'
     FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000091') j)
  AND NOT EXISTS (SELECT 1 FROM public.notifications n
                   WHERE n.href = '/admin/events/b4100000-0000-0000-0000-000000000009/registration/list'),
  'REG-03 KRYTERIUM: anulowanie przez organizatora -> pending (organizer_cancelled), bez dzwonka');
SELECT ok(
  (SELECT j.state = 'cancelled' AND j.review_reason = 'organizer_waived' AND j.review_note LIKE 'Uzgodnione%'
      AND j.decided_by = 'b4000000-0000-0000-0000-0000000000a1'
     FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000092') j),
  'REG-03 KRYTERIUM: „nie zwracaj" -> zlecenie cancelled/organizer_waived z notatka');

-- ── 49-50. Siatka bezpieczenstwa: surowy UPDATE ──────────────────────────────────
UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
 WHERE id = 'b4400000-0000-0000-0000-000000000093';
SELECT ok(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'closed_without_refund_decision' AND j.origin = 'system'
     FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000093') j),
  'siatka: surowe zamkniecie oplaconego -> needs_review (closed_without_refund_decision)');

-- ── 50-55. Decyzje o zleceniu ───────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT throws_like(
  format($$SELECT public.admin_event_refund_job_decide(jsonb_build_object('job_id', %L, 'action', 'dismiss'))$$,
         (SELECT j.id FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000093') j)),
  'reason_required%', 'decyzja „nie zwracaj" wymaga notatki');
SELECT is(
  public.admin_event_refund_job_decide(jsonb_build_object(
    'job_id', (SELECT j.id FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000093') j),
    'action', 'refund', 'note', 'Zwrot mimo braku decyzji')) ->> 'state',
  'pending', 'decyzja „zwroc": needs_review wraca do kolejki operatora');
SELECT is(
  public.admin_event_refund_job_decide(jsonb_build_object(
    'job_id', (SELECT j.id FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000002') j),
    'action', 'dismiss', 'note', 'Po terminie - regulamin')) ->> 'state',
  'cancelled', 'decyzja „nie zwracaj" z notatka zamyka zlecenie po terminie');
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  format($$SELECT public.admin_event_refund_job_decide(jsonb_build_object('job_id', %L, 'action', 'refund'))$$,
         (SELECT j.id FROM pg_temp.b4_job('b4400000-0000-0000-0000-000000000003') j)),
  'not_found%', 'izolacja: administrator obcego najemcy nie widzi zlecenia');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.admin_event_refund_job_decide('{}'::jsonb)$$,
  '42501', NULL, 'anon nie wola decyzji o zleceniu');
RESET ROLE;

-- ── 56-63. REG-13: po koncu wydarzenia ──────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT public.event_registration_cancel(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000004'))$$,
  'event_ended%', 'REG-13 KRYTERIUM: rezygnacja po ends_at -> odmowa event_ended');
SELECT throws_like(
  $$SELECT public.event_registration_cancel(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000005'))$$,
  'event_ended%', 'REG-13: bez ends_at granica to starts_at + 24 h');
SELECT ok(
  (SELECT NOT (v->>'can_cancel')::boolean AND v->>'refusal' = 'event_ended' AND v->'refund' = 'null'::jsonb
     FROM (SELECT public.event_registration_cancel_preview(
             jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000004')) AS v) x),
  'podglad: po koncu wydarzenia odmowa event_ended, bez skutku finansowego');
SELECT ok(
  (public.event_registration_cancel(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000006'))
     -> 'refund' ->> 'effect') = 'none',
  'wydarzenie trwa: bezplatna rezygnacja przechodzi bez potwierdzenia, skutek none');
RESET ROLE;
SELECT is((SELECT status FROM public.event_registrations WHERE id = 'b4400000-0000-0000-0000-000000000041'),
  'waitlist', 'REG-13: odmowa po koncu nie awansuje kolejki');

SELECT set_config('request.headers', '{"x-tenant-host":"b4cr-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_like(
  $$SELECT public.event_registration_cancel(jsonb_build_object('manage_token', rpad('b4-ended', 32, 'x')))$$,
  'manage_expired%', 'klucz samoobslugi po koncu wydarzenia: manage_expired');
SELECT is(
  public.event_registration_cancel_preview(jsonb_build_object('manage_token', rpad('b4-ended', 32, 'x'))),
  '{"ok": false, "reason": "expired"}'::jsonb, 'podglad kluczem po koncu: expired, bez danych');
SELECT ok(
  public.event_registration_cancel_preview(jsonb_build_object('manage_token', rpad('b4-tenant-b', 32, 'x')))
    = '{"ok": false, "reason": "not_found"}'::jsonb
  AND public.event_registration_cancel_preview(jsonb_build_object('manage_token', rpad('zmyslony', 32, 'x')))
    = '{"ok": false, "reason": "not_found"}'::jsonb
  AND public.event_registration_cancel_preview(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000001'))
    = '{"ok": false, "reason": "not_found"}'::jsonb,
  'podglad bez wyroczni: obcy najemca, zmyslony klucz i cudzy identyfikator to ten sam not_found');
RESET ROLE;
SELECT set_config('request.headers', '', true);

SELECT set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-000000000004',
     'action', 'cancel')) ->> 'promoted_from_waitlist')::int,
  0, 'REG-13: organizator zamyka zgloszenie po koncu - bez awansu z kolejki');
-- Ponowne przyjecie po rezygnacji wycofuje zlecenie, ktore nie wyszlo do operatora.
SELECT lives_ok(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object('registration_id', 'b4400000-0000-0000-0000-00000000000a',
    'action', 'approve'))$$,
  'organizator przywraca zgloszenie po rezygnacji');
RESET ROLE;
SELECT ok(
  (SELECT status FROM public.event_registrations WHERE id = 'b4400000-0000-0000-0000-000000000041') = 'waitlist'
  AND (SELECT j.state FROM pg_temp.b4_job('b4400000-0000-0000-0000-00000000000a') j) = 'cancelled',
  'kolejka po koncu nietknieta; ponowne przyjecie wycofuje zlecenie zwrotu');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
