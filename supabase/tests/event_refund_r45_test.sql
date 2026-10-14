-- pgTAP: przeglad R45 - zwroty, odwolanie wydarzenia, kolejka, kody QR,
-- blokady (REG-03, REG-06, REG-07, REG-08, REG-13). Migracje
-- 20261012181000..20261012181500.
--
-- CO SPRAWDZA (kazdy punkt oblewa sie na ciele sprzed poprawki):
--   1. Odwolanie calego wydarzenia zamyka OTWARTE oplacone zgloszenia ze
--      zwrotem organizer_cancelled (prowadzacy grupy z calym zamowieniem),
--      JEDEN zbiorczy dzwonek, bez awansu kolejki, bezplatne bez zmian,
--      powtorne przelaczenie statusu niczego nie dubluje, uczestnik widzi stan
--      zwrotu; odwolanie po koncu -> przeglad; ta sama droga przez UPDATE
--      panelu (RLS).
--   2. Usuniecie wydarzenia z pieniedzmi albo historia zwrotow ->
--      event_has_payments (administrator przez RLS i rola serwisowa);
--      wydarzenie bez pieniedzy i kaskada z usuniecia najemcy przechodza.
--   3. Ponowne przyjecie goscia nie anuluje zwrotu prowadzacego (przeglad
--      shared_payment); ponowne przyjecie prowadzacego - anuluje.
--   4. Odrzucenie goscia przy aktywnym prowadzacym -> przeglad, nie pending;
--      rezygnacja organizatora ze zwrotu zdejmuje pending; zlecenie w drodze
--      -> refund_in_progress.
--   5. Oznaczenie zwrotu goscia nie konczy zwrotu prowadzacego; 'refund' na
--      wplacie dzielonej z aktywnym -> refund_order_shared; prawdziwy zwrot
--      zamowienia konczy zlecenie.
--   6. Odwolane / zakonczone wydarzenie: bez awansu (hurt i pojedynczy), bez
--      biletu z crona, bez przyjecia po wplacie; wplata na odwolanym zamyka sie
--      zwrotem.
--   7. Kod QR tylko dla rozliczonych albo furtki organizatora (identyfikatory,
--      'approve'); lista offline bez przyjetych nierozliczonych.
--   8/9. Statyczny straznik kolejnosci blokad (bilet nigdy przed wydarzeniem,
--      zamowienie i zgloszenie nigdy przed wydarzeniem).
--   10. „Moje zgloszenia": gosc nie widzi zamowienia prowadzacego.
--   11. Granty kolumnowe decided_by/cancel_reason; wplata na zamkniete
--      zgloszenie (po scaleniu z main: odmowa ze zwrotem automatycznym).
BEGIN;
SELECT plan(52);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e4500000-0000-0000-0000-0000000000aa', 'r45t-a', 'R45 Test A', 'r45t-a.example'),
  ('e4500000-0000-0000-0000-0000000000bb', 'r45t-b', 'R45 Test B', 'r45t-b.example');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('e4500000-0000-0000-0000-0000000000a1', 'r45t-admin@example.org', now()),
  ('e4500000-0000-0000-0000-0000000000c1', 'r45t-part@example.org', now()),
  ('e4500000-0000-0000-0000-0000000000c2', 'r45t-lead@example.org', now()),
  ('e4500000-0000-0000-0000-0000000000d1', 'r45t-guest@example.org', now());

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e4500000-0000-0000-0000-0000000000a1', 'r45t-admin@example.org', 'Admin', 'e4500000-0000-0000-0000-0000000000aa'),
  ('e4500000-0000-0000-0000-0000000000c1', 'r45t-part@example.org', 'Uczestnik', 'e4500000-0000-0000-0000-0000000000aa'),
  ('e4500000-0000-0000-0000-0000000000c2', 'r45t-lead@example.org', 'Prowadzaca', 'e4500000-0000-0000-0000-0000000000aa'),
  ('e4500000-0000-0000-0000-0000000000d1', 'r45t-guest@example.org', 'Gosc', 'e4500000-0000-0000-0000-0000000000aa');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e4500000-0000-0000-0000-0000000000a1', 'admin', 'e4500000-0000-0000-0000-0000000000aa');

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('e4530000-0000-0000-0000-0000000000c1', 'e4500000-0000-0000-0000-0000000000aa', 'e4500000-0000-0000-0000-0000000000c1', 'r45t-part@example.org', 'Pola', 'Uczestnik'),
  ('e4530000-0000-0000-0000-0000000000c2', 'e4500000-0000-0000-0000-0000000000aa', 'e4500000-0000-0000-0000-0000000000c2', 'r45t-lead@example.org', 'Lena', 'Prowadzaca'),
  ('e4530000-0000-0000-0000-0000000000d1', 'e4500000-0000-0000-0000-0000000000aa', 'e4500000-0000-0000-0000-0000000000d1', 'r45t-guest@example.org', 'Gosia', 'Gosc'),
  ('e4530000-0000-0000-0000-0000000000f1', 'e4500000-0000-0000-0000-0000000000aa', NULL, 'r45t-free@example.org', 'Filip', 'Bezplatny'),
  ('e4530000-0000-0000-0000-0000000000f2', 'e4500000-0000-0000-0000-0000000000aa', NULL, 'r45t-wait@example.org', 'Wanda', 'Kolejka'),
  ('e4530000-0000-0000-0000-0000000000f3', 'e4500000-0000-0000-0000-0000000000aa', NULL, 'r45t-unpaid@example.org', 'Urszula', 'Nieoplacona'),
  ('e4530000-0000-0000-0000-0000000000b1', 'e4500000-0000-0000-0000-0000000000aa', NULL, 'r45t-s1@example.org', 'Sara', 'Rozliczona'),
  ('e4530000-0000-0000-0000-0000000000b2', 'e4500000-0000-0000-0000-0000000000aa', NULL, 'r45t-s2@example.org', 'Szymon', 'Systemowy'),
  ('e4530000-0000-0000-0000-0000000000b3', 'e4500000-0000-0000-0000-0000000000aa', NULL, 'r45t-s3@example.org', 'Stefan', 'Oczekujacy'),
  ('e4530000-0000-0000-0000-0000000000b4', 'e4500000-0000-0000-0000-0000000000aa', NULL, 'r45t-s4@example.org', 'Sonia', 'Furtka'),
  ('e4530000-0000-0000-0000-0000000000b5', 'e4500000-0000-0000-0000-0000000000aa', NULL, 'r45t-s5@example.org', 'Sebastian', 'Zwrocony'),
  ('e4530000-0000-0000-0000-0000000000e1', 'e4500000-0000-0000-0000-0000000000aa', NULL, 'r45t-late@example.org', 'Lucja', 'Spozniona');

-- Wydarzenia (kazdy scenariusz ma wlasne - pgTAP nie lubi SAVEPOINT-ow):
--   01 odwolanie calego (RPC), 02 odwolanie po koncu (UPDATE panelu przez RLS),
--   03/04/05 usuwanie, 06 odwolane bez oplaconych (kolejka, cron, wplata),
--   07 zakonczone, 08 zwykle (kontrprzyklad crona), 09 kody QR,
--   0a wplata na zamkniete zgloszenie, 11..18 grupy (prowadzacy + gosc, wspolne zamowienie).
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status, registration_mode, capacity) VALUES
  ('e4510000-0000-0000-0000-000000000001', 'e4500000-0000-0000-0000-0000000000aa', 'r45t-e01', 'Odwolane R45', 'Cancelled R45', now() + interval '10 days', NULL, 'published', 'form', NULL),
  ('e4510000-0000-0000-0000-000000000002', 'e4500000-0000-0000-0000-0000000000aa', 'r45t-e02', 'Po koncu R45', 'Ended R45', now() - interval '3 days', now() - interval '2 days', 'published', 'form', NULL),
  ('e4510000-0000-0000-0000-000000000003', 'e4500000-0000-0000-0000-0000000000aa', 'r45t-e03', 'Usun oplacone', 'Delete paid', now() + interval '10 days', NULL, 'published', 'form', NULL),
  ('e4510000-0000-0000-0000-000000000004', 'e4500000-0000-0000-0000-0000000000aa', 'r45t-e04', 'Usun bezplatne', 'Delete free', now() + interval '10 days', NULL, 'published', 'form', NULL),
  ('e4510000-0000-0000-0000-000000000005', 'e4500000-0000-0000-0000-0000000000aa', 'r45t-e05', 'Usun z historia', 'Delete history', now() + interval '10 days', NULL, 'published', 'form', NULL),
  ('e4510000-0000-0000-0000-000000000006', 'e4500000-0000-0000-0000-0000000000aa', 'r45t-e06', 'Odwolane bez wplat', 'Cancelled free', now() + interval '5 days', NULL, 'published', 'form', NULL),
  ('e4510000-0000-0000-0000-000000000007', 'e4500000-0000-0000-0000-0000000000aa', 'r45t-e07', 'Zakonczone', 'Ended', now() - interval '2 days', now() - interval '1 day', 'published', 'form', NULL),
  ('e4510000-0000-0000-0000-000000000008', 'e4500000-0000-0000-0000-0000000000aa', 'r45t-e08', 'Zwykle', 'Regular', now() + interval '5 days', NULL, 'published', 'form', NULL),
  ('e4510000-0000-0000-0000-000000000009', 'e4500000-0000-0000-0000-0000000000aa', 'r45t-e09', 'Kody QR', 'QR codes', now() + interval '1 day', now() + interval '1 day 5 hours', 'published', 'form', NULL),
  ('e4510000-0000-0000-0000-00000000000a', 'e4500000-0000-0000-0000-0000000000aa', 'r45t-e0a', 'Wplata na zamkniete', 'Late payment', now() + interval '5 days', NULL, 'published', 'form', NULL),
  ('e4510000-0000-0000-0000-0000000000b1', 'e4500000-0000-0000-0000-0000000000bb', 'r45t-eb1', 'Najemca B', 'Tenant B', now() + interval '5 days', NULL, 'published', 'form', NULL);

INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency)
SELECT ('e4520000-0000-0000-0000-0000000000' || s)::uuid, 'e4500000-0000-0000-0000-0000000000aa',
       ('e4510000-0000-0000-0000-0000000000' || s)::uuid, 'r45t_' || s, 'Wstep', 'Admission', 10000, 'PLN'
  FROM unnest(ARRAY['01', '02', '03', '06', '07', '08', '09', '0a']) AS s;

-- Zamowienia Stripe: tylko rola serwisowa zaklada zamowienie `paid`.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency, provider,
                                   environment, provider_payment_intent_id, paid_at, metadata)
SELECT ('e4550000-0000-0000-0000-000000000' || o.s)::uuid, 'e4500000-0000-0000-0000-0000000000aa',
       o.uid::uuid, 'one_time', 'paid', o.amount, 'PLN', 'stripe', 'sandbox', 'pi_r45t_' || o.s, now(),
       jsonb_build_object('event_id', ('e4510000-0000-0000-0000-0000000000' || o.e)::text,
                          'registration_id', ('e4540000-0000-0000-0000-000000000' || o.s)::text,
                          'ticket_type_id', ('e4520000-0000-0000-0000-0000000000' || o.e)::text)
  FROM (VALUES ('111', '01', 10000, 'e4500000-0000-0000-0000-0000000000c1'),
               ('112', '01', 20000, 'e4500000-0000-0000-0000-0000000000c2'),
               ('121', '02', 10000, 'e4500000-0000-0000-0000-0000000000c1'),
               ('163', '06', 10000, 'e4500000-0000-0000-0000-0000000000c1'),
               ('1a1', '0a', 10000, 'e4500000-0000-0000-0000-0000000000c1'))
       AS o(s, e, amount, uid);
SELECT set_config('request.jwt.claim.role', '', true);

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   payment_order_id, paid_at, group_lead_registration_id, waitlist_position, qr_token_hash, qr_issued_at,
   decided_at, decision_source, promoted_at, cancelled_at) VALUES
  -- 01: oplacony, prowadzacy + gosc, bezplatny, kolejka bezplatna, nieoplacony
  ('e4540000-0000-0000-0000-000000000111', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000001',
   'e4530000-0000-0000-0000-0000000000c1', 'e4520000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   'e4550000-0000-0000-0000-000000000111', now(), NULL, NULL, repeat('a', 64), now(), NULL, NULL, NULL, NULL),
  ('e4540000-0000-0000-0000-000000000112', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000001',
   'e4530000-0000-0000-0000-0000000000c2', 'e4520000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   'e4550000-0000-0000-0000-000000000112', now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e4540000-0000-0000-0000-000000000113', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000001',
   'e4530000-0000-0000-0000-0000000000d1', 'e4520000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   'e4550000-0000-0000-0000-000000000112', now(), 'e4540000-0000-0000-0000-000000000112', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e4540000-0000-0000-0000-000000000114', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000001',
   'e4530000-0000-0000-0000-0000000000f1', NULL, 'approved', 'form', 'not_required',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e4540000-0000-0000-0000-000000000115', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000001',
   'e4530000-0000-0000-0000-0000000000f2', 'e4520000-0000-0000-0000-000000000001', 'waitlist', 'form', 'not_required',
   NULL, NULL, NULL, 1, NULL, NULL, now(), 'capacity', NULL, NULL),
  ('e4540000-0000-0000-0000-000000000116', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000001',
   'e4530000-0000-0000-0000-0000000000f3', 'e4520000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  -- 02: oplacony na wydarzeniu, ktore juz sie odbylo
  ('e4540000-0000-0000-0000-000000000121', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000002',
   'e4530000-0000-0000-0000-0000000000c1', 'e4520000-0000-0000-0000-000000000002', 'approved', 'form', 'paid',
   'e4550000-0000-0000-0000-000000000121', now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  -- 03: wplata reczna (bez zamowienia), 04: tylko bezplatne, 05: zwrocone ze zleceniem
  ('e4540000-0000-0000-0000-000000000131', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000003',
   'e4530000-0000-0000-0000-0000000000c1', 'e4520000-0000-0000-0000-000000000003', 'approved', 'form', 'paid',
   NULL, now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e4540000-0000-0000-0000-000000000141', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000004',
   'e4530000-0000-0000-0000-0000000000f1', NULL, 'approved', 'form', 'not_required',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e4540000-0000-0000-0000-000000000151', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000005',
   'e4530000-0000-0000-0000-0000000000c1', NULL, 'cancelled', 'form', 'refunded',
   NULL, NULL, NULL, NULL, NULL, NULL, now(), 'organizer', NULL, now()),
  -- 06: kolejka bezplatna, przyjety bezplatny bez biletu z crona, nieoplacony z kasa w toku
  ('e4540000-0000-0000-0000-000000000161', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000006',
   'e4530000-0000-0000-0000-0000000000f2', 'e4520000-0000-0000-0000-000000000006', 'waitlist', 'form', 'not_required',
   NULL, NULL, NULL, 1, NULL, NULL, now(), 'capacity', NULL, NULL),
  ('e4540000-0000-0000-0000-000000000162', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000006',
   'e4530000-0000-0000-0000-0000000000f1', 'e4520000-0000-0000-0000-000000000006', 'approved', 'form', 'not_required',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e4540000-0000-0000-0000-000000000163', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000006',
   'e4530000-0000-0000-0000-0000000000c1', 'e4520000-0000-0000-0000-000000000006', 'pending', 'form', 'unpaid',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  -- 07: kolejka bezplatna i nieoplacona po koncu
  ('e4540000-0000-0000-0000-000000000171', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000007',
   'e4530000-0000-0000-0000-0000000000f2', 'e4520000-0000-0000-0000-000000000007', 'waitlist', 'form', 'not_required',
   NULL, NULL, NULL, 1, NULL, NULL, now(), 'capacity', NULL, NULL),
  ('e4540000-0000-0000-0000-000000000172', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000007',
   'e4530000-0000-0000-0000-0000000000f3', 'e4520000-0000-0000-0000-000000000007', 'waitlist', 'form', 'unpaid',
   NULL, NULL, NULL, 2, NULL, NULL, now(), 'organizer', NULL, NULL),
  -- 08: kontrprzyklad crona biletow
  ('e4540000-0000-0000-0000-000000000181', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000008',
   'e4530000-0000-0000-0000-0000000000f1', 'e4520000-0000-0000-0000-000000000008', 'approved', 'form', 'not_required',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  -- 09: rozliczony, awansowany przez system bez wplaty (stary kod QR), oczekujacy,
  -- furtka organizatora, zwrocony (do ponownego przyjecia)
  ('e4540000-0000-0000-0000-000000000191', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000009',
   'e4530000-0000-0000-0000-0000000000b1', 'e4520000-0000-0000-0000-000000000009', 'approved', 'form', 'paid',
   NULL, now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e4540000-0000-0000-0000-000000000192', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000009',
   'e4530000-0000-0000-0000-0000000000b2', 'e4520000-0000-0000-0000-000000000009', 'approved', 'form', 'unpaid',
   NULL, NULL, NULL, NULL, repeat('b', 64), now(), now(), 'system', now(), NULL),
  ('e4540000-0000-0000-0000-000000000193', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000009',
   'e4530000-0000-0000-0000-0000000000b3', 'e4520000-0000-0000-0000-000000000009', 'pending', 'form', 'unpaid',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('e4540000-0000-0000-0000-000000000194', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000009',
   'e4530000-0000-0000-0000-0000000000b4', 'e4520000-0000-0000-0000-000000000009', 'approved', 'form', 'unpaid',
   NULL, NULL, NULL, NULL, NULL, NULL, now(), 'organizer', NULL, NULL),
  ('e4540000-0000-0000-0000-000000000195', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000009',
   'e4530000-0000-0000-0000-0000000000b5', 'e4520000-0000-0000-0000-000000000009', 'cancelled', 'form', 'refunded',
   NULL, NULL, NULL, NULL, NULL, NULL, now(), 'system', NULL, now()),
  -- 0a: zgloszenie odwolane PRZED wplata, ktora wlasnie dociera
  ('e4540000-0000-0000-0000-0000000001a1', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-00000000000a',
   'e4530000-0000-0000-0000-0000000000e1', 'e4520000-0000-0000-0000-00000000000a', 'cancelled', 'form', 'unpaid',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, now());

-- Historia zwrotow wydarzenia 05: zlecenie reczne zakonczone.
INSERT INTO public.event_registration_refund_jobs
  (tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason)
VALUES ('e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000005', NULL,
        'e4540000-0000-0000-0000-000000000151', 'completed', 'organizer_cancelled', 'manual_payment');

-- Najemca B: wydarzenie z oplaconym zgloszeniem (kaskada usuniecia najemcy).
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
  ('e4530000-0000-0000-0000-0000000000bb', 'e4500000-0000-0000-0000-0000000000bb', 'r45t-b@example.org', 'Bea', 'Obca');
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode, payment_status, paid_at)
VALUES ('e4540000-0000-0000-0000-0000000001b1', 'e4500000-0000-0000-0000-0000000000bb', 'e4510000-0000-0000-0000-0000000000b1',
        'e4530000-0000-0000-0000-0000000000bb', 'approved', 'form', 'paid', now());

-- Czytnik offline wydarzenia 09.
INSERT INTO public.event_checkpoints (id, tenant_id, event_id, name_pl, name_en, kind, direction_mode, access_mode, dedupe_window_seconds)
VALUES ('e4560000-0000-0000-0000-000000000009', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000009',
        'Brama', 'Gate', 'event_entry', 'in_out', 'control', 60);
INSERT INTO public.event_scanner_devices (id, tenant_id, event_id, checkpoint_id, sponsor_id, label, token_hash, token_prefix,
                                          scopes, is_active, expires_at, revoked_at, offline_roster)
VALUES ('e4570000-0000-0000-0000-000000000009', 'e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000009',
        'e4560000-0000-0000-0000-000000000009', NULL, 'Offline R45',
        encode(extensions.digest('tokr45t-offline-0001', 'sha256'), 'hex'), 'tokr45t-', ARRAY['checkin']::text[],
        true, now() + interval '2 days', NULL, true);

-- Grupa: prowadzacy (konto c2) i gosc (konto d1) na jednym zamowieniu 20000.
-- Prowadzacy 'e4540000-...-0000000a00NN', gosc '...-0000000b00NN'.
CREATE FUNCTION pg_temp.r45_group(_n text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := 'e4500000-0000-0000-0000-0000000000aa';
  v_event uuid := ('e4510000-0000-0000-0000-0000000000' || _n)::uuid;
  v_ticket uuid := ('e4520000-0000-0000-0000-0000000000' || _n)::uuid;
  v_order uuid := ('e4550000-0000-0000-0000-0000000000' || _n)::uuid;
  v_lead uuid := ('e4540000-0000-0000-0000-0000000a00' || _n)::uuid;
  v_guest uuid := ('e4540000-0000-0000-0000-0000000b00' || _n)::uuid;
BEGIN
  INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode)
  VALUES (v_event, v_tenant, 'r45t-g' || _n, 'Grupa ' || _n, 'Group ' || _n, now() + interval '30 days', 'published', 'form');
  INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency)
  VALUES (v_ticket, v_tenant, v_event, 'r45t_g' || _n, 'Wstep', 'Admission', 10000, 'PLN');
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency, provider,
                                     environment, provider_payment_intent_id, provider_customer_id, paid_at, metadata)
  VALUES (v_order, v_tenant, 'e4500000-0000-0000-0000-0000000000c2', 'one_time', 'paid', 20000, 'PLN', 'stripe',
          'sandbox', 'pi_r45t_g' || _n, 'cus_r45t_lead', now(),
          jsonb_build_object('event_id', v_event::text, 'registration_id', v_lead::text, 'ticket_type_id', v_ticket::text));
  PERFORM set_config('request.jwt.claim.role', '', true);
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
     payment_order_id, paid_at, group_lead_registration_id)
  VALUES
    (v_lead, v_tenant, v_event, 'e4530000-0000-0000-0000-0000000000c2', v_ticket, 'approved', 'form', 'paid', v_order, now(), NULL),
    (v_guest, v_tenant, v_event, 'e4530000-0000-0000-0000-0000000000d1', v_ticket, 'approved', 'form', 'paid', v_order, now(), v_lead);
END $$;

SELECT pg_temp.r45_group(g) FROM unnest(ARRAY['11', '12', '13', '14', '15', '16', '17', '18']) AS g;

-- Zlecenie zamowienia (jedno na zamowienie) albo zlecenie reczne zgloszenia.
CREATE FUNCTION pg_temp.r45_job(_order uuid) RETURNS public.event_registration_refund_jobs
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT j.* FROM public.event_registration_refund_jobs j WHERE j.payment_order_id = _order
$$;

-- Zlecenia w toku zalozone wprost (13: pending, 14: processing u operatora).
INSERT INTO public.event_registration_refund_jobs
  (tenant_id, event_id, payment_order_id, registration_id, state, origin, claim_token, claimed_at, attempts)
VALUES
  ('e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000013', 'e4550000-0000-0000-0000-000000000013',
   'e4540000-0000-0000-0000-0000000a0013', 'pending', 'organizer_rejected', NULL, NULL, 0),
  ('e4500000-0000-0000-0000-0000000000aa', 'e4510000-0000-0000-0000-000000000014', 'e4550000-0000-0000-0000-000000000014',
   'e4540000-0000-0000-0000-0000000a0014', 'processing', 'organizer_rejected', gen_random_uuid(), now(), 1);

-- Webhooki klienta Stripe prowadzacej (takze z innych zakupow).
INSERT INTO public.payment_webhook_events (tenant_id, environment, event_id, event_type, status, customer_id, user_id, occurred_at, payload)
SELECT 'e4500000-0000-0000-0000-0000000000aa', 'sandbox', 'evt_r45t_' || g, 'invoice.paid', 'processed', 'cus_r45t_lead',
       'e4500000-0000-0000-0000-0000000000c2', now() - g * interval '1 day', '{}'::jsonb
  FROM generate_series(1, 3) g;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. ODWOLANIE CALEGO WYDARZENIA (RPC organizatora)
-- ═════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.headers', '{"x-tenant-host":"r45t-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"sub":"e4500000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(public.admin_event_set_status('e4510000-0000-0000-0000-000000000001', 'cancelled'), 'cancelled',
  '1: organizator odwoluje wydarzenie z oplaconymi zgloszeniami');
RESET ROLE;

SELECT ok(
  (SELECT r.status = 'cancelled' AND r.payment_status = 'paid' AND r.qr_token_hash IS NULL
          AND r.decision_source = 'organizer' AND r.decided_by = 'e4500000-0000-0000-0000-0000000000a1'
     FROM public.event_registrations r WHERE r.id = 'e4540000-0000-0000-0000-000000000111')
  AND (SELECT j.state = 'pending' AND j.origin = 'organizer_cancelled' AND j.amount_cents = 10000
              AND j.registration_id = 'e4540000-0000-0000-0000-000000000111'
         FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000111') j),
  '1 KRYTERIUM: odwolanie zamyka oplacone zgloszenie (bez kodu QR) i zleca pelny zwrot organizer_cancelled');
SELECT ok(
  (SELECT bool_and(r.status = 'cancelled') FROM public.event_registrations r
    WHERE r.id IN ('e4540000-0000-0000-0000-000000000112', 'e4540000-0000-0000-0000-000000000113'))
  AND (SELECT j.state = 'pending' AND j.amount_cents = 20000
              AND j.registration_id = 'e4540000-0000-0000-0000-000000000112'
         FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000112') j),
  '1: grupa - gosc zamkniety kaskada, zwrot calego zamowienia na prowadzacym (platniku)');
SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'e4500000-0000-0000-0000-0000000000a1'
      AND n.kind = 'billing'
      AND n.href = '/admin/events/e4510000-0000-0000-0000-000000000001/registration/list'),
  1, '1: JEDEN zbiorczy dzwonek do organizatora (nie po jednym na zgloszenie)');
SELECT ok(
  (SELECT r.status = 'waitlist' AND r.promoted_at IS NULL FROM public.event_registrations r
    WHERE r.id = 'e4540000-0000-0000-0000-000000000115')
  AND NOT EXISTS (SELECT 1 FROM public.domain_events d
                   WHERE d.aggregate_id = 'e4540000-0000-0000-0000-000000000115'
                     AND d.event_type = 'event.registration.promoted.v1'),
  '1: bez awansu kolejki na odwolanym wydarzeniu (miejsca grupy nie trafiaja do kolejki)');
SELECT ok(
  (SELECT r.status = 'approved' FROM public.event_registrations r WHERE r.id = 'e4540000-0000-0000-0000-000000000114')
  AND (SELECT r.status = 'pending' FROM public.event_registrations r WHERE r.id = 'e4540000-0000-0000-0000-000000000116'),
  '1: zgloszenia bezplatne i nieoplacone bez zmian (dotychczasowe zachowanie)');

-- Powtorne przelaczenie statusu (opublikowane -> odwolane) niczego nie dubluje.
UPDATE public.events SET status = 'published' WHERE id = 'e4510000-0000-0000-0000-000000000001';
UPDATE public.events SET status = 'cancelled' WHERE id = 'e4510000-0000-0000-0000-000000000001';
SELECT ok(
  (SELECT count(*) FROM public.event_registration_refund_jobs j
    WHERE j.event_id = 'e4510000-0000-0000-0000-000000000001') = 2
  AND (SELECT count(*) FROM public.notifications n
        WHERE n.user_id = 'e4500000-0000-0000-0000-0000000000a1'
          AND n.href = '/admin/events/e4510000-0000-0000-0000-000000000001/registration/list') = 1
  AND (SELECT j.state = 'pending' FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000111') j),
  '1: idempotentne - ponowne odwolanie bez nowych zlecen i dzwonkow');

SELECT set_config('request.jwt.claims', '{"sub":"e4500000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT x->>'status' = 'cancelled' AND x->>'payment_status' = 'paid' AND x->>'refund_state' = 'queued'
          AND (x->>'amount_cents')::int = 10000
     FROM jsonb_array_elements(public.event_my_registrations('{}')->'registrations') x
    WHERE x->>'registration_id' = 'e4540000-0000-0000-0000-000000000111'),
  '1: uczestnik odwolanego wydarzenia widzi stan zwrotu (refund_state queued) i swoja wplate');
RESET ROLE;

-- Odwolanie PO koncu wydarzenia - przez UPDATE panelu (polityka RLS).
SELECT set_config('request.jwt.claims', '{"sub":"e4500000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.events SET status = 'cancelled' WHERE id = 'e4510000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT ok(
  (SELECT r.status = 'cancelled' FROM public.event_registrations r WHERE r.id = 'e4540000-0000-0000-0000-000000000121')
  AND (SELECT j.state = 'needs_review' AND j.review_reason = 'closed_without_refund_decision'
              AND j.origin = 'organizer_cancelled'
         FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000121') j),
  '1: odwolanie po koncu (UPDATE panelu) - zamkniete, zwrot czeka na decyzje organizatora');

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. USUNIECIE WYDARZENIA Z PIENIEDZMI
-- ═════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$DELETE FROM public.events WHERE id = 'e4510000-0000-0000-0000-000000000003'$$,
  'event_has_payments%', '2: administrator (RLS) nie usunie wydarzenia z oplaconym zgloszeniem');
SELECT lives_ok(
  $$DELETE FROM public.events WHERE id = 'e4510000-0000-0000-0000-000000000004'$$,
  '2: wydarzenie bez pieniedzy usuwa sie jak dotad');
RESET ROLE;
SELECT ok(NOT EXISTS (SELECT 1 FROM public.events WHERE id = 'e4510000-0000-0000-0000-000000000004'),
  '2: kontrprzyklad - wydarzenie bez pieniedzy naprawde zniknelo');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT throws_like(
  $$DELETE FROM public.events WHERE id = 'e4510000-0000-0000-0000-000000000003'$$,
  'event_has_payments%', '2: rola serwisowa tez nie usunie wydarzenia z oplaconym zgloszeniem');
SELECT throws_like(
  $$DELETE FROM public.events WHERE id = 'e4510000-0000-0000-0000-000000000005'$$,
  'event_has_payments%', '2: historia zwrotow - czytelna odmowa zamiast surowego 23503');
RESET ROLE;
SELECT lives_ok(
  $$DELETE FROM public.tenants WHERE id = 'e4500000-0000-0000-0000-0000000000bb'$$,
  '2: kaskada z usuniecia najemcy (operacja platformy) przechodzi');

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. PONOWNE PRZYJECIE GOSCIA NIE ANULUJE ZWROTU PROWADZACEGO (grupa 11)
-- ═════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims', '{"sub":"e4500000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.event_registration_cancel(jsonb_build_object('registration_id', 'e4540000-0000-0000-0000-0000000a0011',
    'acknowledged_effect', 'full_refund')) -> 'refund' ->> 'job_state',
  'pending', '3: prowadzaca rezygnuje - zwrot calego zamowienia zlecony');
SELECT set_config('request.jwt.claims', '{"sub":"e4500000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object(
      'registration_id', 'e4540000-0000-0000-0000-0000000b0011', 'action', 'approve'))$$,
  '3: organizator przyjmuje ponownie TYLKO goscia');
RESET ROLE;
-- SCALENIE Z MAIN (PR #504): przeglad wspolnej wplaty w KOLEJCE to eskalacja
-- INV-19c (main 20261012120000: powod `active_registrations_share_payment`
-- i alarm `escalated_at` - ten sam powod, ktory nadaje zamiatanie dzierzawy);
-- intencja R45 (zlecenie platnika zostaje, idzie do przegladu) bez zmian.
-- Unia: 20261013900000. `shared_payment` zostaje powodem ZAMKNIECIA (ocena).
SELECT ok(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'active_registrations_share_payment'
          AND j.escalated_at IS NOT NULL
          AND j.registration_id = 'e4540000-0000-0000-0000-0000000a0011'
     FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000011') j),
  '3 KRYTERIUM: zwrot prowadzacej nie znika - przeglad wspolnej wplaty z alarmem (gosc dzieli wplate)');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object(
      'registration_id', 'e4540000-0000-0000-0000-0000000a0011', 'action', 'approve'))$$,
  '3: organizator przyjmuje ponownie prowadzaca');
RESET ROLE;
SELECT is((SELECT j.state FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000011') j), 'cancelled',
  '3: ponowne przyjecie PLATNIKA wycofuje jego zlecenie');

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. ODRZUCENIE GOSCIA I REZYGNACJA ZE ZWROTU (grupy 12, 13, 14)
-- ═════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object(
      'registration_id', 'e4540000-0000-0000-0000-0000000b0012', 'action', 'reject', 'note', 'brak miejsca dla goscia'))$$,
  '4: organizator odrzuca oplaconego goscia aktywnej prowadzacej');
RESET ROLE;
-- SCALENIE Z MAIN (PR #504): jak w 3 - eskalacja INV-19c z alarmem.
SELECT ok(
  (SELECT j.state = 'needs_review' AND j.review_reason = 'active_registrations_share_payment'
          AND j.escalated_at IS NOT NULL
          AND j.registration_id = 'e4540000-0000-0000-0000-0000000b0012'
     FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000012') j),
  '4 KRYTERIUM: odrzucony gosc aktywnej prowadzacej - przeglad wspolnej wplaty z alarmem, nie zwrot calosci');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object(
      'registration_id', 'e4540000-0000-0000-0000-0000000a0012', 'action', 'cancel', 'refund', 'none',
      'note', 'bez zwrotu - umowa z firma'))$$,
  '4: organizator anuluje prowadzaca bez zwrotu');
SELECT is(
  public.admin_event_registration_decide(jsonb_build_object(
      'registration_id', 'e4540000-0000-0000-0000-0000000a0013', 'action', 'cancel', 'refund', 'none',
      'note', 'bez zwrotu - umowa z firma')) -> 'refund' ->> 'job_state',
  'cancelled', '4: rezygnacja ze zwrotu przy zleceniu pending - odpowiedz mowi prawde');
SELECT throws_like(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object(
      'registration_id', 'e4540000-0000-0000-0000-0000000a0014', 'action', 'cancel', 'refund', 'none',
      'note', 'bez zwrotu - umowa z firma'))$$,
  'refund_in_progress%', '4: zwrot juz u operatora - rezygnacja odrzucona (refund_in_progress)');
RESET ROLE;
SELECT ok(
  (SELECT j.state = 'cancelled' AND j.review_reason = 'organizer_waived'
     FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000012') j)
  AND (SELECT j.state = 'cancelled' AND j.review_reason = 'organizer_waived'
         FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000013') j),
  '4 KRYTERIUM: rezygnacja organizatora ze zwrotu wygrywa z przegladem i z pending');
SELECT ok(
  (SELECT j.state = 'processing' FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000014') j)
  AND (SELECT r.status = 'approved' FROM public.event_registrations r WHERE r.id = 'e4540000-0000-0000-0000-0000000a0014'),
  '4: przy odmowie zlecenie w drodze i zgloszenie bez zmian');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT ok(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public._event_registration_refunds_claim(100)) c
               WHERE c->>'order_id' IN ('e4550000-0000-0000-0000-000000000011', 'e4550000-0000-0000-0000-000000000012',
                                        'e4550000-0000-0000-0000-000000000013')),
  '3/4: worker nie zwraca zamowien wycofanych, w przegladzie ani z rezygnacja organizatora');
RESET ROLE;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. OZNACZENIE ZWROTU NA GOSCIU (grupy 15, 16, 17)
-- ═════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims', '{"sub":"e4500000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.event_registration_cancel(jsonb_build_object('registration_id', 'e4540000-0000-0000-0000-0000000a0015',
    'acknowledged_effect', 'full_refund'))$$,
  '5: prowadzaca 15 rezygnuje (zwrot calosci pending)');
SELECT lives_ok(
  $$SELECT public.event_registration_cancel(jsonb_build_object('registration_id', 'e4540000-0000-0000-0000-0000000a0017',
    'acknowledged_effect', 'full_refund'))$$,
  '5: prowadzaca 17 rezygnuje (zwrot calosci pending)');
SELECT set_config('request.jwt.claims', '{"sub":"e4500000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object(
      'registration_id', 'e4540000-0000-0000-0000-0000000b0015', 'action', 'refund', 'note', 'gosc oddany gotowka'))$$,
  '5: organizator oznacza zwrot zamknietego goscia');
SELECT throws_like(
  $$SELECT public.admin_event_registration_decide(jsonb_build_object(
      'registration_id', 'e4540000-0000-0000-0000-0000000b0016', 'action', 'refund'))$$,
  'refund_order_shared%', '5: oznaczenie zwrotu wplaty dzielonej z aktywna prowadzaca - odmowa');
RESET ROLE;
SELECT ok(
  (SELECT j.state = 'pending' AND j.registration_id = 'e4540000-0000-0000-0000-0000000a0015'
     FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000015') j)
  AND (SELECT r.payment_status = 'refunded' FROM public.event_registrations r WHERE r.id = 'e4540000-0000-0000-0000-0000000b0015'),
  '5 KRYTERIUM: zwrot goscia nie konczy zwrotu calego zamowienia prowadzacej');
-- Wynik platnosci w OSOBNEJ instrukcji: zwykle podzapytanie tej samej
-- instrukcji widzi migawke sprzed zmian funkcji.
CREATE TEMP TABLE r45_outcome (k text PRIMARY KEY, v jsonb);
INSERT INTO r45_outcome
SELECT 'refund17', public.payments_apply_event_ticket_outcome('e4550000-0000-0000-0000-000000000017', 'refunded');
SELECT ok(
  (SELECT (v->>'applied')::boolean FROM r45_outcome WHERE k = 'refund17')
  AND (SELECT j.state = 'completed' FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000017') j),
  '5: prawdziwy zwrot zamowienia (webhook) konczy zlecenie');

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. ODWOLANE I ZAKONCZONE WYDARZENIE NIKOGO NIE PRZYJMUJE
-- ═════════════════════════════════════════════════════════════════════════════
UPDATE public.events SET status = 'cancelled' WHERE id = 'e4510000-0000-0000-0000-000000000006';
INSERT INTO r45_outcome
SELECT 'promote06', public._event_waitlist_promote('e4500000-0000-0000-0000-0000000000aa',
                                                   'e4510000-0000-0000-0000-000000000006', NULL, 5, NULL);
SELECT ok(
  (SELECT (v->>'promoted')::int = 0 FROM r45_outcome WHERE k = 'promote06')
  AND (SELECT r.status = 'waitlist' FROM public.event_registrations r WHERE r.id = 'e4540000-0000-0000-0000-000000000161'),
  '6 KRYTERIUM: odwolane wydarzenie - zero awansow z kolejki');
SELECT set_config('request.jwt.claims', '{"sub":"e4500000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT public.admin_event_waitlist_promote(jsonb_build_object('registration_id', 'e4540000-0000-0000-0000-000000000161'))$$,
  'event_cancelled%', '6: reczny awans na odwolanym wydarzeniu - odmowa');
SELECT throws_like(
  $$SELECT public.admin_event_waitlist_promote(jsonb_build_object('registration_id', 'e4540000-0000-0000-0000-000000000171'))$$,
  'event_ended%', '6: reczny awans po koncu wydarzenia - odmowa');
RESET ROLE;
SELECT ok(
  NOT ('e4540000-0000-0000-0000-000000000162'::uuid = ANY (public._event_ticket_codes_pending(500)))
  AND 'e4540000-0000-0000-0000-000000000181'::uuid = ANY (public._event_ticket_codes_pending(500)),
  '6: cron biletow pomija odwolane wydarzenie (kontrprzyklad: zwykle wydarzenie w kolejce)');
SELECT ok(
  public._event_registration_paid_admission(
    (SELECT r FROM public.event_registrations r WHERE r.id = 'e4540000-0000-0000-0000-000000000163'),
    'e4520000-0000-0000-0000-000000000006') = 'pending'
  AND public._event_registration_paid_admission(
    (SELECT r FROM public.event_registrations r WHERE r.id = 'e4540000-0000-0000-0000-000000000172'),
    'e4520000-0000-0000-0000-000000000007') = 'waitlist',
  '6: wplata nie przyjmuje na miejsce na odwolanym ani po koncu wydarzenia');
INSERT INTO r45_outcome
SELECT 'late163', public.payments_apply_event_ticket_outcome('e4550000-0000-0000-0000-000000000163', 'paid');
SELECT ok(
  (SELECT v->>'registration_status' = 'cancelled' AND (v->>'organizer_alerted')::boolean
     FROM r45_outcome WHERE k = 'late163')
  AND (SELECT r.payment_status = 'paid' AND r.qr_token_hash IS NULL
         FROM public.event_registrations r WHERE r.id = 'e4540000-0000-0000-0000-000000000163')
  AND (SELECT j.state = 'pending' AND j.origin = 'organizer_cancelled'
         FROM pg_temp.r45_job('e4550000-0000-0000-0000-000000000163') j),
  '6: wplata po odwolaniu - zgloszenie zamkniete ze zwrotem, organizator powiadomiony przez baze');

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. KOD QR TYLKO DLA ROZLICZONYCH, LISTA OFFLINE BEZ NIEROZLICZONYCH
-- ═════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE r45_badges AS
SELECT b->>'registration_id' AS reg, b->>'qr_code' AS qr
  FROM jsonb_array_elements(public.admin_event_badge_batch(jsonb_build_object(
    'event_id', 'e4510000-0000-0000-0000-000000000009',
    'person_ids', jsonb_build_array('e4530000-0000-0000-0000-0000000000b1', 'e4530000-0000-0000-0000-0000000000b2',
                                    'e4530000-0000-0000-0000-0000000000b3', 'e4530000-0000-0000-0000-0000000000b4')))->'badges') b;
SELECT is(
  public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', 'e4540000-0000-0000-0000-000000000195', 'action', 'approve')) ->> 'qr_token',
  NULL, '7: ponowne przyjecie zwroconego zgloszenia - miejsce bez kodu QR');
RESET ROLE;
SELECT is(
  (SELECT array_agg(reg ORDER BY reg) FROM r45_badges WHERE qr IS NOT NULL),
  ARRAY['e4540000-0000-0000-0000-000000000191', 'e4540000-0000-0000-0000-000000000194'],
  '7 KRYTERIUM: identyfikator z kodem QR tylko dla rozliczonego i furtki organizatora');
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT ok(
  (SELECT array_agg(x->>'r' ORDER BY x->>'r') = ARRAY['e4540000-0000-0000-0000-000000000191',
                                                      'e4540000-0000-0000-0000-000000000194']
          AND (v->>'total')::int = 2
     FROM (SELECT public.event_scanner_roster(jsonb_build_object('device_token', 'tokr45t-offline-0001')) AS v) s,
          jsonb_array_elements(s.v->'rows') x
    GROUP BY v),
  '7: lista offline bez przyjetego nierozliczonego (stary kod awansu systemowego nie wpuszcza offline)');
RESET ROLE;

-- ═════════════════════════════════════════════════════════════════════════════
-- 8/9. STATYCZNY STRAZNIK KOLEJNOSCI BLOKAD
-- ═════════════════════════════════════════════════════════════════════════════
-- Pierwsze blokady FOR UPDATE (bez komentarzy) w kolejnosci instrukcji.
CREATE TEMP TABLE r45_locks AS
WITH src AS (
  SELECT p.oid::regprocedure::text AS fn, regexp_replace(p.prosrc, '--[^\n]*', '', 'g') AS body
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosrc ~* 'for\s+update'
), stmts AS (
  SELECT s.fn, t.ord,
         (regexp_match(t.stmt, 'FROM\s+(?:public\.)?(events|event_ticket_types|event_registrations|payment_orders)\M', 'i'))[1] AS tbl
    FROM src s, regexp_split_to_table(s.body, ';') WITH ORDINALITY AS t(stmt, ord)
   WHERE t.stmt ~* 'for\s+update'
)
SELECT fn, tbl, min(ord) AS first_ord FROM stmts WHERE tbl IS NOT NULL GROUP BY fn, tbl;

SELECT is(
  (SELECT array_agg(t.fn ORDER BY t.fn) FROM r45_locks t
    WHERE t.tbl = 'event_ticket_types'
      AND NOT EXISTS (SELECT 1 FROM r45_locks e WHERE e.fn = t.fn AND e.tbl = 'events' AND e.first_ord < t.first_ord)),
  NULL, '8: zadna funkcja nie blokuje biletu przed wydarzeniem (np. zakup pakietu)');
SELECT is(
  (SELECT array_agg(t.fn ORDER BY t.fn) FROM r45_locks t
    WHERE t.tbl IN ('payment_orders', 'event_registrations')
      AND EXISTS (SELECT 1 FROM r45_locks e WHERE e.fn = t.fn AND e.tbl = 'events' AND e.first_ord > t.first_ord)),
  NULL, '9: zadna funkcja nie blokuje zamowienia ani zgloszenia przed wydarzeniem (np. wynik platnosci)');
SELECT ok(
  EXISTS (SELECT 1 FROM r45_locks WHERE fn = 'payments_apply_event_ticket_outcome(uuid,text,integer)' AND tbl = 'events')
  AND EXISTS (SELECT 1 FROM r45_locks WHERE fn = '_event_package_purchase(jsonb,text)' AND tbl = 'events'),
  '8/9: straznik widzi blokade wydarzenia w zakupie pakietu i w wyniku platnosci (skan nie jest pusty)');

-- ═════════════════════════════════════════════════════════════════════════════
-- 10. „MOJE ZGLOSZENIA": GOSC NIE WIDZI ZAMOWIENIA PROWADZACEGO (grupa 18)
-- ═════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims', '{"sub":"e4500000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  (SELECT x->>'payment_status' = 'paid' AND (x->>'payment_shared')::boolean
          AND x->>'order_id' IS NULL AND x->>'amount_cents' IS NULL
          AND x->>'provider_payment_intent_id' IS NULL AND x->>'provider_session_id' IS NULL
          AND jsonb_array_length(x->'webhooks') = 0
     FROM jsonb_array_elements(public.event_my_registrations('{}')->'registrations') x
    WHERE x->>'registration_id' = 'e4540000-0000-0000-0000-0000000b0018'),
  '10 KRYTERIUM: gosc widzi wlasny payment_status, bez kwoty, identyfikatorow i webhookow prowadzacej');
SELECT set_config('request.jwt.claims', '{"sub":"e4500000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
SELECT ok(
  (SELECT x->>'order_id' = 'e4550000-0000-0000-0000-000000000018' AND (x->>'amount_cents')::int = 20000
          AND NOT (x->>'payment_shared')::boolean AND jsonb_array_length(x->'webhooks') = 3
     FROM jsonb_array_elements(public.event_my_registrations('{}')->'registrations') x
    WHERE x->>'registration_id' = 'e4540000-0000-0000-0000-0000000a0018'),
  '10: kontrprzyklad - platnik widzi swoje zamowienie i webhooki');
RESET ROLE;

-- ═════════════════════════════════════════════════════════════════════════════
-- 11. GRANTY KOLUMNOWE I DZWONEK PRZY WPLACIE NA ZAMKNIETE ZGLOSZENIE
-- ═════════════════════════════════════════════════════════════════════════════
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.event_registrations', 'decided_by', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.event_registrations', 'cancel_reason', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.event_registrations', 'decision_note', 'SELECT')
  AND has_column_privilege('authenticated', 'public.event_registrations', 'status', 'SELECT'),
  '11: authenticated nie czyta decided_by ani cancel_reason (status nadal tak)');
-- SCALENIE Z MAIN (PR #504): od TIX-01 (main 20261012130100) wplata rozlicza
-- wskazane zgloszenie tylko, gdy konto zamowienia jest jego wlascicielem -
-- zgloszenie 0a zalozylo to samo konto, ktore teraz placi (inaczej odmowa
-- `registration_not_owned` zaslonilaby sciezke zamknietego zgloszenia).
UPDATE public.event_registrations SET created_by = 'e4500000-0000-0000-0000-0000000000c1'
 WHERE id = 'e4540000-0000-0000-0000-0000000001a1';
INSERT INTO r45_outcome
SELECT 'closed1a1', public.payments_apply_event_ticket_outcome('e4550000-0000-0000-0000-0000000001a1', 'paid');
-- SCALENIE Z MAIN (PR #504): wplata na zgloszenie odwolane PRZED wplata nie
-- kupila niczego - main 20261012130100 (TIX-05) robi z niej ODMOWE ze zwrotem
-- automatycznym (`refused`, `refund_queued`, pochodzenie `system`), a REG R45
-- (20261012181400) zostawial zlecenie siatki w przegladzie z dzwonkiem z bazy.
-- Unia (20261013900100/900200): zwrot automatyczny, gdy nikt aktywny nie
-- dzieli wplaty - organizatora zawiadamia odmowa (TS), baza nie dzwoni drugi
-- raz; przeglad z dzwonkiem z bazy zostaje dla wspolnej wplaty
-- (supabase/tests/reg_main_merge_test.sql).
SELECT ok(
  (SELECT v->>'registration_status' = 'cancelled' AND (v->>'refused')::boolean
          AND (v->>'refund_queued')::boolean AND v->>'reason' = 'registration_closed'
          AND NOT (v->>'organizer_alerted')::boolean
     FROM r45_outcome WHERE k = 'closed1a1')
  AND (SELECT j.state = 'pending' AND j.origin = 'system' AND j.review_reason IS NULL
              AND j.amount_cents = 10000 AND j.currency = 'PLN'
         FROM pg_temp.r45_job('e4550000-0000-0000-0000-0000000001a1') j)
  AND NOT EXISTS (SELECT 1 FROM public.notifications n
               WHERE n.user_id = 'e4500000-0000-0000-0000-0000000000a1'
                 AND n.kind = 'billing'
                 AND n.href = '/admin/events/e4510000-0000-0000-0000-00000000000a/registration/list'),
  '11: wplata na zamkniete zgloszenie - odmowa ze zwrotem automatycznym (TIX-05), bez drugiego dzwonka z bazy');

-- ═════════════════════════════════════════════════════════════════════════════
-- ACL NOWYCH FUNKCJI
-- ═════════════════════════════════════════════════════════════════════════════
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_cancelled_event_close_paid(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_cancelled_event_close_paid(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._tg_event_cancelled_closes_paid()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._tg_events_delete_keeps_payments()', 'EXECUTE'),
  'ACL: procedura zamkniecia i triggery bez EXECUTE dla anon i authenticated');
SELECT ok(
  has_function_privilege('service_role', 'public._event_cancelled_event_close_paid(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_badge_batch(jsonb)', 'EXECUTE'),
  'ACL: service_role zachowuje procedure zamkniecia; identyfikatory bez anon');

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '', true);
SELECT * FROM finish();
ROLLBACK;
