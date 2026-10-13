-- pgTAP: SCALENIE origin/main z gałęzią REG (PR #504) - migracje uzgadniające
-- 20261013900000..20261013900900. Każda asercja sprawdza UNIĘ obu intencji
-- w funkcji, którą redefiniowały obie strony, więc pada na ciele KAŻDEJ strony
-- z osobna (dowód mutacyjny w review/MAIN-MERGE-reconciliation.md):
--
--   A. Zapis i decyzje zleceń zwrotu (20261013900100): ponowne zlecenie
--      z czystym budżetem (main INV-19c) w funkcjach REG-03; zlecenie
--      `refund_unconfirmed` ani nadpisywane, ani rozstrzygane ręcznie; odmowa
--      wpłaty (main TIX-05) z pochodzeniem `system` i kwotą (kolumny REG-03).
--   B. Kolejka (20261013900000): straż przywrócenia zna `refund_unconfirmed`
--      (main) i zlecenia ręczne (REG); ostatnia porażka eskaluje z alarmem
--      (main) i zdarzeniem na szynie (REG); dzierżawa i dziennik niosą pola
--      obu stron.
--   C. Wynik płatności (20261013900200): wpłata na zamknięte zgłoszenie przy
--      wspólnej wpłacie to odmowa wobec kupującego (main) ze zleceniem
--      w przeglądzie i dzwonkiem z bazy (REG R45).
--   D. Księga miejsc i kody (20261013900300): TIX-03 w rdzeniu gości R38,
--      jedna reguła okna kodu, kontrakt `_event_seats_left`.
--   E. Źródło faktury (20261013900500): kwota zaksięgowana (main INV-14) i cena
--      z chwili zapisu (REG-16).
--   F. Naprawa REG-01 po uzgodnieniach (20261013900900): audyt = 0.
BEGIN;
SELECT plan(23);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('9e000000-0000-0000-0000-0000000000aa', 'mm-a', 'Scalenie A', 'mm-a.example');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('9e000000-0000-0000-0000-0000000000a1', 'mm-admin@example.org', now()),
  ('9e000000-0000-0000-0000-0000000000c1', 'mm-payer@example.org', now()),
  ('9e000000-0000-0000-0000-0000000000c2', 'mm-lead@example.org', now()),
  ('9e000000-0000-0000-0000-0000000000c3', 'mm-other@example.org', now());

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('9e000000-0000-0000-0000-0000000000a1', 'mm-admin@example.org', 'Admin', '9e000000-0000-0000-0000-0000000000aa'),
  ('9e000000-0000-0000-0000-0000000000c1', 'mm-payer@example.org', 'Platnik', '9e000000-0000-0000-0000-0000000000aa'),
  ('9e000000-0000-0000-0000-0000000000c2', 'mm-lead@example.org', 'Prowadzacy', '9e000000-0000-0000-0000-0000000000aa'),
  ('9e000000-0000-0000-0000-0000000000c3', 'mm-other@example.org', 'Obcy', '9e000000-0000-0000-0000-0000000000aa');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('9e000000-0000-0000-0000-0000000000a1', 'admin', '9e000000-0000-0000-0000-0000000000aa');

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('9e030000-0000-0000-0000-0000000000c1', '9e000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-0000000000c1', 'mm-payer@example.org', 'Pawel', 'Platnik'),
  ('9e030000-0000-0000-0000-0000000000c2', '9e000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-0000000000c2', 'mm-lead@example.org', 'Lena', 'Prowadzaca'),
  ('9e030000-0000-0000-0000-0000000000f1', '9e000000-0000-0000-0000-0000000000aa', NULL, 'mm-free1@example.org', 'Filip', 'Pierwszy'),
  ('9e030000-0000-0000-0000-0000000000f2', '9e000000-0000-0000-0000-0000000000aa', NULL, 'mm-free2@example.org', 'Franka', 'Druga');

-- 01 zlecenia i decyzje, 02 wplata na zamkniete przy wspolnej wplacie,
-- 03 zrodlo faktury, 04 goscie przy otwartej kasie.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode) VALUES
  ('9e010000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-0000000000aa', 'mm-e01', 'Zwroty MM', 'Refunds MM', now() + interval '20 days', 'published', 'form'),
  ('9e010000-0000-0000-0000-000000000002', '9e000000-0000-0000-0000-0000000000aa', 'mm-e02', 'Wspolna wplata MM', 'Shared MM', now() + interval '20 days', 'published', 'form'),
  ('9e010000-0000-0000-0000-000000000003', '9e000000-0000-0000-0000-0000000000aa', 'mm-e03', 'Faktura MM', 'Invoice MM', now() + interval '20 days', 'published', 'form'),
  ('9e010000-0000-0000-0000-000000000004', '9e000000-0000-0000-0000-0000000000aa', 'mm-e04', 'Grupa MM', 'Group MM', now() + interval '20 days', 'published', 'form');

INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
                                       group_registration_enabled, group_max_size)
SELECT ('9e020000-0000-0000-0000-0000000000' || s)::uuid, '9e000000-0000-0000-0000-0000000000aa',
       ('9e010000-0000-0000-0000-0000000000' || s)::uuid, 'mm_' || s, 'Wstep', 'Admission', 10000, 'PLN',
       s = '04', CASE WHEN s = '04' THEN 5 ELSE 2 END
  FROM unnest(ARRAY['01', '02', '03', '04']) AS s;

-- Zamowienia Stripe (tylko rola serwisowa zaklada `paid`): 11..17 wydarzenie 01,
-- 22 wydarzenie 02, 41 otwarta kasa prowadzacego (04).
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency, provider,
                                   environment, provider_payment_intent_id, paid_at, metadata)
SELECT ('9e050000-0000-0000-0000-000000000' || o.s)::uuid, '9e000000-0000-0000-0000-0000000000aa',
       o.uid::uuid, 'one_time', o.status::public.order_status, 10000, 'PLN', 'stripe', 'sandbox', 'pi_mm_' || o.s,
       CASE WHEN o.status = 'paid' THEN now() END,
       jsonb_build_object('event_id', ('9e010000-0000-0000-0000-0000000000' || o.e)::text,
                          'registration_id', ('9e040000-0000-0000-0000-000000000' || o.s)::text,
                          'ticket_type_id', ('9e020000-0000-0000-0000-0000000000' || o.e)::text)
  FROM (VALUES ('011', '01', 'paid', '9e000000-0000-0000-0000-0000000000c1'),
               ('012', '01', 'paid', '9e000000-0000-0000-0000-0000000000c1'),
               ('013', '01', 'paid', '9e000000-0000-0000-0000-0000000000c1'),
               ('015', '01', 'paid', '9e000000-0000-0000-0000-0000000000c1'),
               ('016', '01', 'paid', '9e000000-0000-0000-0000-0000000000c1'),
               ('018', '01', 'paid', '9e000000-0000-0000-0000-0000000000c1'),
               ('017', '01', 'paid', '9e000000-0000-0000-0000-0000000000c3'),
               ('022', '02', 'paid', '9e000000-0000-0000-0000-0000000000c1'),
               ('041', '04', 'processing', '9e000000-0000-0000-0000-0000000000c2'))
       AS o(s, e, status, uid);
SELECT set_config('request.jwt.claim.role', '', true);

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   payment_order_id, paid_at, decided_at, decision_source, cancelled_at, created_by,
   quoted_price_cents, quoted_currency, quote_valid_until,
   paid_amount_cents, paid_amount_currency, paid_amount_recorded_at) VALUES
  -- 01: zamkniete oplacone (zlecenia zapisuje test), 17 - zgloszenie osoby bez konta
  ('9e040000-0000-0000-0000-000000000011', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000001',
   '9e030000-0000-0000-0000-0000000000c1', '9e020000-0000-0000-0000-000000000001', 'cancelled', 'form', 'paid',
   '9e050000-0000-0000-0000-000000000011', now(), now(), 'organizer', now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('9e040000-0000-0000-0000-000000000012', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000001',
   '9e030000-0000-0000-0000-0000000000c1', '9e020000-0000-0000-0000-000000000001', 'cancelled', 'form', 'paid',
   '9e050000-0000-0000-0000-000000000012', now(), now(), 'organizer', now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('9e040000-0000-0000-0000-000000000013', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000001',
   '9e030000-0000-0000-0000-0000000000c1', '9e020000-0000-0000-0000-000000000001', 'cancelled', 'form', 'paid',
   '9e050000-0000-0000-0000-000000000013', now(), now(), 'organizer', now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('9e040000-0000-0000-0000-000000000015', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000001',
   '9e030000-0000-0000-0000-0000000000c1', '9e020000-0000-0000-0000-000000000001', 'cancelled', 'form', 'paid',
   '9e050000-0000-0000-0000-000000000015', now(), now(), 'organizer', now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('9e040000-0000-0000-0000-000000000016', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000001',
   '9e030000-0000-0000-0000-0000000000c1', '9e020000-0000-0000-0000-000000000001', 'cancelled', 'form', 'paid',
   '9e050000-0000-0000-0000-000000000016', now(), now(), 'organizer', now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('9e040000-0000-0000-0000-000000000018', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000001',
   '9e030000-0000-0000-0000-0000000000c1', '9e020000-0000-0000-0000-000000000001', 'cancelled', 'form', 'paid',
   '9e050000-0000-0000-0000-000000000018', now(), now(), 'organizer', now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('9e040000-0000-0000-0000-000000000017', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000001',
   '9e030000-0000-0000-0000-0000000000f1', '9e020000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  -- 02: zgloszenie platnika odwolane PRZED wplata (22) i aktywne zgloszenie
  -- juz rozliczone tym samym zamowieniem (23) - wspolna wplata.
  ('9e040000-0000-0000-0000-000000000022', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000002',
   '9e030000-0000-0000-0000-0000000000c1', '9e020000-0000-0000-0000-000000000002', 'cancelled', 'form', 'unpaid',
   NULL, NULL, NULL, NULL, now(), '9e000000-0000-0000-0000-0000000000c1', NULL, NULL, NULL, NULL, NULL, NULL),
  ('9e040000-0000-0000-0000-000000000023', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000002',
   '9e030000-0000-0000-0000-0000000000f2', '9e020000-0000-0000-0000-000000000002', 'approved', 'form', 'paid',
   '9e050000-0000-0000-0000-000000000022', now(), now(), 'system', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  -- 03: nieoplacone z oferta 7000 (REG-16) i oplacone poza kasa z wplata 8000 (INV-14)
  ('9e040000-0000-0000-0000-000000000031', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000003',
   '9e030000-0000-0000-0000-0000000000c1', '9e020000-0000-0000-0000-000000000003', 'approved', 'form', 'unpaid',
   NULL, NULL, now(), 'organizer', NULL, NULL, 7000, 'PLN', now() + interval '1 day', NULL, NULL, NULL),
  ('9e040000-0000-0000-0000-000000000032', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000003',
   '9e030000-0000-0000-0000-0000000000f1', '9e020000-0000-0000-0000-000000000003', 'approved', 'form', 'paid',
   NULL, now(), now(), 'organizer', NULL, NULL, NULL, NULL, NULL, 8000, 'PLN', now()),
  -- 04: prowadzacy grupy z otwarta kasa (zamowienie 041 w toku)
  ('9e040000-0000-0000-0000-000000000041', '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000004',
   '9e030000-0000-0000-0000-0000000000c2', '9e020000-0000-0000-0000-000000000004', 'pending', 'form', 'unpaid',
   NULL, NULL, NULL, NULL, NULL, '9e000000-0000-0000-0000-0000000000c2', NULL, NULL, NULL, NULL, NULL, NULL);

-- Zlecenia zastane: 11 po eskalacji (budzet wyczerpany, stary identyfikator
-- zwrotu), 12 zwrot bez potwierdzenia, 13 zwrot odrzucony przez operatora,
-- 15 ostatnia proba w toku, 16 czeka na dzierzawe, 18 porazka z budzetem
-- wyczerpanym przed eskalacja (zastane po wdrozeniu - zamiata je dzierzawa).
INSERT INTO public.event_registration_refund_jobs
  (tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason, attempts,
   escalated_at, provider_refund_id, claim_token, claimed_at, next_attempt_at)
SELECT '9e000000-0000-0000-0000-0000000000aa', '9e010000-0000-0000-0000-000000000001',
       ('9e050000-0000-0000-0000-000000000' || j.s)::uuid, ('9e040000-0000-0000-0000-000000000' || j.s)::uuid,
       j.state, 'participant_cancelled', j.reason, j.attempts, j.escalated, j.refund_id,
       j.claim::uuid, CASE WHEN j.claim IS NOT NULL THEN now() END, now() - interval '1 minute'
  FROM (VALUES ('011', 'needs_review', 'attempts_exhausted', 10, now(), 're_mm_old', NULL),
               ('012', 'needs_review', 'refund_unconfirmed', 1, now(), 're_mm_pending', NULL),
               ('013', 'needs_review', 'provider_refund_failed', 3, now(), 're_mm_failed', NULL),
               ('015', 'processing', NULL, 10, NULL, NULL, '9e060000-0000-0000-0000-000000000015'),
               ('016', 'pending', NULL, 0, NULL, NULL, NULL),
               ('018', 'failed', NULL, 10, NULL, NULL, NULL))
       AS j(s, state, reason, attempts, escalated, refund_id, claim);

CREATE FUNCTION pg_temp.mm_job(_order uuid) RETURNS public.event_registration_refund_jobs
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT j.* FROM public.event_registration_refund_jobs j WHERE j.payment_order_id = _order
$$;

CREATE TEMP TABLE mm_out (k text PRIMARY KEY, v jsonb);
GRANT ALL ON mm_out TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- A. ZAPIS I DECYZJE ZLECEN (20261013900100)
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO mm_out SELECT 'cancel11', public._event_registration_cancel_refund(
  '9e000000-0000-0000-0000-0000000000aa', '9e040000-0000-0000-0000-000000000011', 'organizer_cancelled',
  '9e000000-0000-0000-0000-0000000000a1',
  jsonb_build_object('job_state', 'pending', 'payment_order_id', '9e050000-0000-0000-0000-000000000011',
                     'amount_cents', 10000, 'currency', 'PLN'));
SELECT ok(
  (SELECT j.state = 'pending' AND j.attempts = 0 AND j.escalated_at IS NULL AND j.provider_refund_id IS NULL
          AND j.review_reason IS NULL AND j.origin = 'organizer_cancelled' AND j.amount_cents = 10000
     FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000011') j),
  'A1 (REG-03 x INV-19c): ponowne zlecenie z czystym budzetem - bez starego alarmu i identyfikatora zwrotu');

INSERT INTO mm_out SELECT 'cancel12', public._event_registration_cancel_refund(
  '9e000000-0000-0000-0000-0000000000aa', '9e040000-0000-0000-0000-000000000012', 'organizer_cancelled',
  '9e000000-0000-0000-0000-0000000000a1',
  jsonb_build_object('job_state', 'pending', 'payment_order_id', '9e050000-0000-0000-0000-000000000012',
                     'amount_cents', 10000, 'currency', 'PLN'));
SELECT ok(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'refund_unconfirmed'
          AND j.provider_refund_id = 're_mm_pending' AND j.attempts = 1
     FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000012') j)
  AND (SELECT v->>'job_state' = 'needs_review' AND v->>'review_reason' = 'refund_unconfirmed'
         FROM mm_out WHERE k = 'cancel12'),
  'A2 (REG-03 x INV-19c): zwrot bez potwierdzenia operatora nie jest nadpisywany drugim zleceniem');

SELECT set_config('request.jwt.claims', '{"sub":"9e000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  format($$SELECT public.admin_event_refund_job_decide(jsonb_build_object('job_id', %L, 'action', 'dismiss',
           'note', 'zamykam recznie'))$$,
         (SELECT j.id FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000012') j)),
  'invalid_transition: refund awaits provider confirmation%',
  'A3 (REG-03 x INV-19c): zwrotu w drodze u operatora nie da sie rozstrzygnac recznie');
INSERT INTO mm_out SELECT 'decide13', public.admin_event_refund_job_decide(jsonb_build_object(
  'job_id', (SELECT j.id FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000013') j), 'action', 'refund'));
RESET ROLE;
SELECT ok(
  (SELECT j.state = 'pending' AND j.attempts = 0 AND j.escalated_at IS NULL AND j.provider_refund_id IS NULL
          AND j.review_reason IS NULL AND j.decided_by = '9e000000-0000-0000-0000-0000000000a1'
     FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000013') j),
  'A4 (REG-03 x INV-19c): decyzja "zwroc" po odrzuceniu u operatora startuje z czystym budzetem');

-- ═════════════════════════════════════════════════════════════════════════════
-- B. KOLEJKA (20261013900000)
-- ═════════════════════════════════════════════════════════════════════════════
SELECT throws_like(
  $$UPDATE public.event_registrations SET status = 'approved', cancelled_at = NULL
     WHERE id = '9e040000-0000-0000-0000-000000000012'$$,
  'invalid_transition: refund already in progress%',
  'B1 (INV-19c x R45): przywrocenie zgloszenia przy zwrocie bez potwierdzenia - odmowa');

SELECT ok(
  public._event_registration_refunds_settle(
    (SELECT j.id FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000015') j),
    '9e060000-0000-0000-0000-000000000015', NULL, 'card_declined')
  AND (SELECT j.state = 'needs_review' AND j.review_reason = 'attempts_exhausted' AND j.escalated_at IS NOT NULL
              AND j.last_error = 'card_declined'
         FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000015') j),
  'B2 (INV-19c): ostatnia porazka eskaluje - powod, stempel alarmu, blad operatora');
SELECT ok(
  (SELECT count(*) = 1 FROM public.domain_events d
    WHERE d.tenant_id = '9e000000-0000-0000-0000-0000000000aa'
      AND d.event_type = 'event.registration.refund_failed.v1'
      AND d.payload->>'job_id' = (SELECT j.id::text FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000015') j))
  AND (SELECT count(*) = 1 FROM public.notifications n
        WHERE n.user_id = '9e000000-0000-0000-0000-0000000000a1'
          AND n.title_pl = 'Zwrot wymaga decyzji'
          -- Zlecenie z rezygnacji, nie z odrzucenia: tresc alarmu nie mowi
          -- „odrzucone zgloszenie" (REG-03 zaklada zlecenia przy kazdym zamknieciu).
          AND n.body_pl LIKE 'Zwrot za zgłoszenie na „Zwroty MM”%po 10 próbach%'
          AND n.href LIKE '%refund_job=' || (SELECT j.id::text FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000015') j)),
  'B3 (REG-03 x INV-19c): jedno zdarzenie refund_failed.v1 na szynie (REG) i jeden alarm administratora (main) bez slowa "odrzucone"');

SELECT ok(
  EXISTS (SELECT 1 FROM jsonb_array_elements(public._event_registration_refunds_claim(100)) c
           WHERE c->>'order_id' = '9e050000-0000-0000-0000-000000000016'
             AND c->>'origin' = 'participant_cancelled'),
  'B4 (REG-03 x INV-19c): dzierzawa po zamiataniu eskalacji oddaje pochodzenie zlecenia');
SELECT ok(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'attempts_exhausted' AND j.escalated_at IS NOT NULL
     FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000018') j),
  'B4b (INV-19c): ta sama dzierzawa zamiata zlecenie z wyczerpanym budzetem do przegladu z alarmem');

SELECT set_config('request.jwt.claims', '{"sub":"9e000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT bool_and(x ? 'escalated_at' AND x ? 'origin' AND x ? 'amount_cents' AND x ? 'review_note'
                   AND NOT x ? 'claim_token' AND NOT x ? 'provider_refund_id')
     FROM jsonb_array_elements(public.admin_event_refund_jobs('9e010000-0000-0000-0000-000000000001')) x)
  AND jsonb_array_length(public.admin_event_refund_jobs('9e010000-0000-0000-0000-000000000001')) = 6,
  'B5 (REG-03 x INV-19c): dziennik zwrotow - pola REG i chwila alarmu main, bez dzierzawy i identyfikatora zwrotu');
RESET ROLE;

-- ═════════════════════════════════════════════════════════════════════════════
-- A/C. ODMOWA WPLATY (20261013900100 + 20261013900200)
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO mm_out SELECT 'notowned17',
  public.payments_apply_event_ticket_outcome('9e050000-0000-0000-0000-000000000017', 'paid');
SELECT ok(
  (SELECT (v->>'refused')::boolean AND v->>'reason' = 'registration_not_owned' AND (v->>'refund_queued')::boolean
     FROM mm_out WHERE k = 'notowned17')
  AND (SELECT j.state = 'pending' AND j.origin = 'system' AND j.amount_cents = 10000 AND j.currency = 'PLN'
              AND j.registration_id = '9e040000-0000-0000-0000-000000000017'
         FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000017') j)
  AND (SELECT payment_status = 'unpaid' AND payment_order_id IS NULL
         FROM public.event_registrations WHERE id = '9e040000-0000-0000-0000-000000000017'),
  'C1 (TIX-01/05 x REG-03): cudze zamowienie - odmowa, zgloszenie nietkniete, zwrot z pochodzeniem system i kwota');

INSERT INTO mm_out SELECT 'shared22',
  public.payments_apply_event_ticket_outcome('9e050000-0000-0000-0000-000000000022', 'paid');
SELECT ok(
  (SELECT (v->>'applied')::boolean AND (v->>'refused')::boolean AND v->>'reason' = 'registration_closed'
          AND NOT (v->>'refund_queued')::boolean AND (v->>'organizer_alerted')::boolean
          AND v->>'registration_status' = 'cancelled'
     FROM mm_out WHERE k = 'shared22'),
  'C2 (TIX-05 x R45): wplata na zamkniete zgloszenie przy wspolnej wplacie - odmowa, zwrot czeka na decyzje, baza juz zadzwonila');
SELECT ok(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'closed_without_refund_decision' AND j.origin = 'system'
          AND j.registration_id = '9e040000-0000-0000-0000-000000000022'
     FROM pg_temp.mm_job('9e050000-0000-0000-0000-000000000022') j)
  AND (SELECT count(*) = 1 FROM public.notifications n
        WHERE n.user_id = '9e000000-0000-0000-0000-0000000000a1'
          AND n.title_pl = 'Wpłata za zamknięte zgłoszenie - do zwrotu'
          AND n.href = '/admin/events/9e010000-0000-0000-0000-000000000002/registration/list')
  AND (SELECT (metadata->>'needs_manual_review')::boolean AND metadata->'ticket_refusal'->>'reason' = 'registration_closed'
         FROM public.payment_orders WHERE id = '9e050000-0000-0000-0000-000000000022'),
  'C3 (R45 x TIX-05): zlecenie siatki w przegladzie (wspolnej wplaty nie zwracamy w calosci), jeden dzwonek z bazy, znacznik na zamowieniu');

-- ═════════════════════════════════════════════════════════════════════════════
-- D. KSIEGA MIEJSC I KODY (20261013900300)
-- ═════════════════════════════════════════════════════════════════════════════
SELECT is(
  public._event_register_group_guests('9e000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-0000000000c2',
    '9e040000-0000-0000-0000-000000000041',
    '[{"first_name":"Gosc","last_name":"Pierwszy","email":"mm-guest1@example.org"}]'::jsonb)->'client',
  '{"ok": false, "error": "checkout_in_progress"}'::jsonb,
  'D1 (TIX-03 x R38): otwarta kasa prowadzacego - odmowa wartoscia z rdzenia gosci');
-- Wrapper zgodnosci (najemca z hosta, konto z JWT): ta sama odmowa WARTOSCIA
-- (R38), a nie wyjatkiem jak w ciele main 20261012130000.
SELECT set_config('request.headers', '{"x-tenant-host":"mm-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"sub":"9e000000-0000-0000-0000-0000000000c2","role":"service_role"}', true);
SELECT set_config('request.jwt.claim.sub', '9e000000-0000-0000-0000-0000000000c2', true);
SELECT is(
  public.event_register_group_guests('9e040000-0000-0000-0000-000000000041',
    '[{"first_name":"Gosc","last_name":"Pierwszy","email":"mm-guest1@example.org"}]'::jsonb),
  '{"ok": false, "error": "checkout_in_progress"}'::jsonb,
  'D1b (TIX-03 x R38): wrapper zgodnosci oddaje te sama odmowe wartoscia');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '', true);
UPDATE public.payment_orders SET created_at = now() - interval '2 hours'
 WHERE id = '9e050000-0000-0000-0000-000000000041';
SELECT is(
  public._event_register_group_guests('9e000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-0000000000c2',
    '9e040000-0000-0000-0000-000000000041',
    '[{"first_name":"Gosc","last_name":"Pierwszy","email":"mm-guest1@example.org"}]'::jsonb)->'client',
  '{"ok": true, "added": 1}'::jsonb,
  'D2 (TIX-03): kontrprzyklad - porzucona kasa (ponad 30 minut) nie blokuje dopisania');

SELECT ok(
  pg_get_functiondef('public._event_reveal_coupon_covers(uuid,uuid,uuid,text)'::regprocedure)
    LIKE '%public._b2b_coupon_window_open(c.valid_from, c.valid_until)%',
  'D3 (TIX-13b x REG-05): odslanianie biletow liczy okno kodu jedna regula _b2b_coupon_window_open');
SELECT ok(
  pg_get_functiondef('public.event_coupon_revealed_tickets(uuid,uuid,text)'::regprocedure)
    LIKE '%public._event_reveal_coupon_covers(p_tenant, p_event_id, t.id, v_norm)%'
  AND NOT has_function_privilege('anon', 'public.event_coupon_revealed_tickets(uuid,uuid,text)', 'EXECUTE'),
  'D3b (REG-05 x TIX-13b): stara sciezka odslaniania na tym samym predykacie co zapis, tylko serwer');
SELECT ok(
  obj_description('public._event_seats_left(uuid,uuid,uuid)'::regprocedure, 'pg_proc') LIKE '%_event_package_seats_held%'
  AND obj_description('public._event_seats_left(uuid,uuid,uuid)'::regprocedure, 'pg_proc') LIKE '%wydarzenie -> bilet -> zgloszenie%'
  AND NOT has_function_privilege('authenticated', 'public._event_seats_left(uuid,uuid,uuid)', 'EXECUTE'),
  'D4 (TIX-04 x REG-08): kontrakt _event_seats_left - miejsca pakietow i kolejnosc blokad, bez EXECUTE klienta');

-- ═════════════════════════════════════════════════════════════════════════════
-- E. ZRODLO FAKTURY (20261013900500)
-- ═════════════════════════════════════════════════════════════════════════════
SELECT ok(
  (SELECT (s->>'gross')::bigint = 7000 AND s->>'basis' = 'price_list'
     FROM public._event_invoice_registration_source('9e000000-0000-0000-0000-0000000000aa',
            '9e040000-0000-0000-0000-000000000031', '23') s),
  'E1 (REG-16): proforma zgloszenia nieoplaconego - cena z oferty z chwili zapisu (7000, nie 10000)');
SELECT ok(
  (SELECT (s->>'gross')::bigint = 8000 AND s->>'basis' = 'booked' AND (s->>'seats')::int = 1
     FROM public._event_invoice_registration_source('9e000000-0000-0000-0000-0000000000aa',
            '9e040000-0000-0000-0000-000000000032', '23') s),
  'E2 (INV-14): zgloszenie oplacone poza kasa - kwota zaksiegowanej wplaty (8000, basis booked)');

-- ═════════════════════════════════════════════════════════════════════════════
-- F. NAPRAWA REG-01 I GRANTY (20261013900900)
-- ═════════════════════════════════════════════════════════════════════════════
SELECT is((SELECT count(*)::int FROM public.event_people_account_binding_audit()), 0,
  'F1 (REG-01): audyt dowiazan po migracjach uzgadniajacych = 0');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_ticket_payment_refused(public.payment_orders,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_ticket_payment_refused(public.payment_orders,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_registration_cancel_refund(uuid,uuid,text,uuid,jsonb,boolean,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_register_group_guests(uuid,uuid,uuid,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_refund_job_decide(jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_ticket_payment_refused(public.payment_orders,uuid,uuid,text)', 'EXECUTE'),
  'F2: granty funkcji uzgodnionych - pomocnicze tylko service_role, decyzja organizatora dla authenticated');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
