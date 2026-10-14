-- ============================================================================
-- 78_ticket_checkout_integrity - KASA BILETOW: WPLATA, GOSCIE, KSIEGA MIEJSC,
-- PAKIETY, RSVP, OKNO KODU, PODATEK (audyt biletow TIX-01..TIX-13b)
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracje 20261012130000..090200 zamykaja dziury, w ktorych pieniadze
-- i miejsca rozjezdzaly sie z tym, za co zaplacono. Kazda sekcja to
-- kryterium akceptacji z audytu - scenariusz, ktory przed migracja dawal
-- zly wynik:
--   A. TIX-01/05 - wplata rozlicza wylacznie zgloszenie, za ktore zaplacono:
--      cudze konto, za niska kwota, inny bilet - odmowa, znacznik do przegladu
--      i zwrot w kolejce; zwrot odmowionej wplaty NIE odwoluje zgloszenia;
--      druga wplata (dwie zakladki) - zwrot w kolejce.
--   B. TIX-03 - goscie dopisani po otwarciu kasy nie sa oplacani bez doplaty.
--   C. TIX-04/07 - jedna ksiega miejsc (zgloszenia + miejsca pakietow),
--      zaproszenie z nieoplaconego zamowienia czeka bez kodu, oplacenie je
--      przyjmuje, anulowanie i przeglad terminow oddaja miejsca, limit
--      otwartych zamowien.
--   D. TIX-08 - miejsce RSVP po wplacie rozstrzyga baza pod blokada.
--   E. TIX-13b - granica `valid_until` ta sama w kasie biletu i pakietu.
--   F. TIX-09 - stawka i kod podatkowy biletu: kasa (opcje publiczne) i
--      faktura (szkic, podstawa zwolnienia przy wystawieniu) widza to samo.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * wspolbieznosci (jedna sesja) - tu jest kontrakt jednej transakcji;
--     blokady sa w cialach funkcji (wydarzenie -> bilet -> zgloszenie);
--   * kodu kasy w TS (vitest: checkoutPayloadIntegrity, oneTimeFulfilment);
--   * wysylki maili i workera zwrotow (vitest ticketLifecycleJob).
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 78 kasa biletow: wplata, goscie, ksiega miejsc, pakiety, RSVP, kod, podatek =='

BEGIN;

-- Najemca domowy dla funkcji publicznych (`public_tenant_id()`).
SELECT set_config('nes.public_tenant', '78000000-0000-0000-0000-0000000000a0', false);

INSERT INTO public.tenants (id, name, slug) VALUES
  ('78000000-0000-0000-0000-0000000000a0', 'Tenant 78 (kasa biletow)', 't78-kasa')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('78a00000-0000-0000-0000-0000000000a1', 'admin.78@example.org'),
  ('78a00000-0000-0000-0000-000000000001', 'owner.78@example.org'),
  ('78a00000-0000-0000-0000-000000000002', 'attacker.78@example.org'),
  ('78a00000-0000-0000-0000-000000000003', 'lead.78@example.org'),
  ('78a00000-0000-0000-0000-000000000004', 'buyer.78@example.org'),
  ('78a00000-0000-0000-0000-000000000005', 'rsvp1.78@example.org'),
  ('78a00000-0000-0000-0000-000000000006', 'rsvp2.78@example.org'),
  ('78a00000-0000-0000-0000-000000000007', 'regular.78@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id)
SELECT u.id, '78000000-0000-0000-0000-0000000000a0'::uuid
FROM auth.users u WHERE u.id::text LIKE '78a00000-%'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('78a00000-0000-0000-0000-0000000000a1', 'admin', '78000000-0000-0000-0000-0000000000a0')
ON CONFLICT DO NOTHING;

-- E1 bilety VIP/Standard, E2 grupa, E3 pakiety (sala 12, pula biletu 10),
-- E4 RSVP (sala 1), E5 podatek.
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode,
   registration_flow, capacity)
VALUES
  ('78e00000-0000-0000-0000-0000000000e1', '78000000-0000-0000-0000-0000000000a0',
   'kongres-78', 'Kongres 78', 'Congress 78', now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('78e00000-0000-0000-0000-0000000000e2', '78000000-0000-0000-0000-0000000000a0',
   'grupa-78', 'Grupa 78', 'Group 78', now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('78e00000-0000-0000-0000-0000000000e3', '78000000-0000-0000-0000-0000000000a0',
   'pakiety-78', 'Pakiety 78', 'Packages 78', now() + interval '30 days', 'published', 'form', 'instant', 12),
  ('78e00000-0000-0000-0000-0000000000e4', '78000000-0000-0000-0000-0000000000a0',
   'rsvp-78', 'RSVP 78', 'RSVP 78', now() + interval '30 days', 'published', 'form', 'instant', 1),
  ('78e00000-0000-0000-0000-0000000000e5', '78000000-0000-0000-0000-0000000000a0',
   'podatek-78', 'Podatek 78', 'Tax 78', now() + interval '30 days', 'published', 'form', 'instant', NULL);

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, quota,
   min_tier_rank, requires_approval, is_active, sort_order, group_registration_enabled,
   group_max_size, early_bird_price_cents, early_bird_until)
VALUES
  -- VIP 2000 zl z early birdem 1800 zl: dolna granica kwoty to 1800 zl.
  ('78100000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e1', 'vip', 'VIP', 'VIP', 200000, 'PLN', NULL,
   0, false, true, 10, false, 10, 180000, now() + interval '7 days'),
  ('78100000-0000-0000-0000-000000000002', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e1', 'std', 'Standard', 'Standard', 50000, 'PLN', NULL,
   0, false, true, 20, false, 10, NULL, NULL),
  ('78100000-0000-0000-0000-000000000003', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e2', 'grupa', 'Grupa', 'Group', 10000, 'PLN', NULL,
   0, false, true, 10, true, 10, NULL, NULL),
  ('78100000-0000-0000-0000-000000000004', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e3', 'firmowa', 'Firmowa', 'Corporate', 30000, 'PLN', 10,
   0, false, true, 10, false, 10, NULL, NULL),
  ('78100000-0000-0000-0000-000000000005', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e5', 'kultura', 'Kultura', 'Culture', 10800, 'PLN', NULL,
   0, false, true, 10, false, 10, NULL, NULL),
  ('78100000-0000-0000-0000-000000000006', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e5', 'szkolenie', 'Szkolenie', 'Training', 20000, 'PLN', NULL,
   0, false, true, 20, false, 10, NULL, NULL);

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('78300000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-0000000000a0',
   '78a00000-0000-0000-0000-000000000001', 'owner.78@example.org', 'Olga', 'Wlascicielka'),
  ('78300000-0000-0000-0000-000000000002', '78000000-0000-0000-0000-0000000000a0',
   '78a00000-0000-0000-0000-000000000002', 'attacker.78@example.org', 'Adam', 'Napastnik'),
  ('78300000-0000-0000-0000-000000000003', '78000000-0000-0000-0000-0000000000a0',
   '78a00000-0000-0000-0000-000000000003', 'lead.78@example.org', 'Lena', 'Prowadzaca'),
  ('78300000-0000-0000-0000-000000000011', '78000000-0000-0000-0000-0000000000a0',
   NULL, 'gosc1.78@example.org', 'Gosc', 'Pierwszy'),
  ('78300000-0000-0000-0000-000000000012', '78000000-0000-0000-0000-0000000000a0',
   NULL, 'gosc2.78@example.org', 'Gosc', 'Drugi'),
  ('78300000-0000-0000-0000-000000000013', '78000000-0000-0000-0000-0000000000a0',
   NULL, 'gosc3.78@example.org', 'Gosc', 'Trzeci'),
  ('78300000-0000-0000-0000-000000000007', '78000000-0000-0000-0000-0000000000a0',
   '78a00000-0000-0000-0000-000000000007', 'regular.78@example.org', 'Robert', 'Zwykly');

-- Zamowienie na wskazanie: konto, kwota, bilet, liczba miejsc; reszta jak kasa.
CREATE TEMP TABLE t78 (k text PRIMARY KEY, id uuid);
CREATE FUNCTION pg_temp.o78(_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT id FROM t78 WHERE k = _k $$;
CREATE FUNCTION pg_temp.order78(_k text, _user uuid, _amount integer, _meta jsonb,
  _status text DEFAULT 'paid', _created timestamptz DEFAULT now()) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency,
                                     metadata, created_at, provider_intent_id)
  VALUES (v_id, '78000000-0000-0000-0000-0000000000a0', _user, _status, _amount, 'PLN',
          _meta, _created, 'pi_' || replace(v_id::text, '-', ''));
  INSERT INTO t78 VALUES (_k, v_id);
  RETURN v_id;
END $$;
CREATE FUNCTION pg_temp.r78(_id text) RETURNS public.event_registrations
LANGUAGE sql STABLE AS $$ SELECT * FROM public.event_registrations WHERE id = _id::uuid $$;

-- ---------------------------------------------------------------------------
-- A. TIX-01 / TIX-05: WPLATA ROZLICZA TYLKO ZGLOSZENIE, ZA KTORE ZAPLACONO
-- ---------------------------------------------------------------------------
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, created_by)
VALUES
  -- R_VIP: zgloszenie wlascicielki na VIP, nieoplacone.
  ('78400000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e1', '78300000-0000-0000-0000-000000000001',
   '78100000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   '78a00000-0000-0000-0000-000000000001');

DO $$
DECLARE v jsonb; v_before public.event_registrations := pg_temp.r78('78400000-0000-0000-0000-000000000001');
BEGIN
  -- 1. Cudze konto: artykul za 5 zl z doklejonym zgloszeniem VIP.
  v := public.payments_apply_event_ticket_outcome(pg_temp.order78('cudze', '78a00000-0000-0000-0000-000000000002',
    500, jsonb_build_object('event_id', '78e00000-0000-0000-0000-0000000000e1',
      'registration_id', '78400000-0000-0000-0000-000000000001',
      'ticket_type_id', '78100000-0000-0000-0000-000000000001', 'quantity', 1)), 'paid');
  PERFORM pg_temp.assert(v->>'applied' = 'false' AND v->>'reason' = 'registration_not_owned'
    AND (v->>'refused')::boolean AND (v->>'refund_queued')::boolean,
    '78/A TIX-01: zamowienie innego konta nie rozlicza zgloszenia - odmowa, zwrot w kolejce');
  PERFORM pg_temp.assert(
    (SELECT status = 'pending' AND payment_status = 'unpaid' AND payment_order_id IS NULL
            AND qr_token_hash IS NULL
       FROM pg_temp.r78('78400000-0000-0000-0000-000000000001')),
    '78/A TIX-01: cudze zgloszenie VIP nietkniete (bez wplaty, bez kodu)');
  PERFORM pg_temp.assert(
    (SELECT (metadata->>'needs_manual_review')::boolean
            AND metadata->'ticket_refusal'->>'reason' = 'registration_not_owned'
       FROM public.payment_orders WHERE id = pg_temp.o78('cudze'))
    AND EXISTS (SELECT 1 FROM public.event_registration_refund_jobs j
                 WHERE j.payment_order_id = pg_temp.o78('cudze') AND j.state = 'pending'),
    '78/A TIX-05: odmowa = znacznik needs_manual_review z powodem + zadanie zwrotu');

  -- 2. Wlasne zgloszenie, kwota ponizej najnizszej ceny biletu (1800 zl).
  v := public.payments_apply_event_ticket_outcome(pg_temp.order78('tanio', '78a00000-0000-0000-0000-000000000001',
    500, jsonb_build_object('event_id', '78e00000-0000-0000-0000-0000000000e1',
      'registration_id', '78400000-0000-0000-0000-000000000001',
      'ticket_type_id', '78100000-0000-0000-0000-000000000001', 'quantity', 1)), 'paid');
  PERFORM pg_temp.assert(v->>'reason' = 'amount_mismatch' AND (v->>'refused')::boolean,
    '78/A TIX-01: kwota ponizej ceny biletu - odmowa amount_mismatch');

  -- 3. Wlasne zgloszenie VIP, zamowienie wycenione na Standard.
  v := public.payments_apply_event_ticket_outcome(pg_temp.order78('inny_bilet', '78a00000-0000-0000-0000-000000000001',
    50000, jsonb_build_object('event_id', '78e00000-0000-0000-0000-0000000000e1',
      'registration_id', '78400000-0000-0000-0000-000000000001',
      'ticket_type_id', '78100000-0000-0000-0000-000000000002', 'quantity', 1)), 'paid');
  PERFORM pg_temp.assert(v->>'reason' = 'ticket_mismatch',
    '78/A TIX-01: zamowienie na inny bilet niz zgloszenie - odmowa ticket_mismatch');

  -- 4. Kasa bez wskazania (samo event_id): dopasowanie po osobie NIE wiaze VIP.
  v := public.payments_apply_event_ticket_outcome(pg_temp.order78('samo_event', '78a00000-0000-0000-0000-000000000001',
    500, jsonb_build_object('event_id', '78e00000-0000-0000-0000-0000000000e1')), 'paid');
  PERFORM pg_temp.assert(v->>'reason' = 'registration_not_found'
    AND v->>'skipped_reason' = 'amount_mismatch'
    AND v->>'skipped_registration_id' = '78400000-0000-0000-0000-000000000001'
    AND (SELECT payment_status = 'unpaid' FROM pg_temp.r78('78400000-0000-0000-0000-000000000001')),
    '78/A TIX-01: samo event_id za 5 zl - zakup RSVP, zgloszenie VIP nieoplacone');

  -- 5. Zwrot odmowionej wplaty NIE odwoluje cudzego zgloszenia.
  v := public.payments_apply_event_ticket_outcome(pg_temp.o78('cudze'), 'refunded');
  PERFORM pg_temp.assert(v->>'reason' = 'refund_for_other_order'
    AND (SELECT status = 'pending' AND cancelled_at IS NULL
           FROM pg_temp.r78('78400000-0000-0000-0000-000000000001')),
    '78/A TIX-01: zwrot zamowienia napastnika nie anuluje zgloszenia ofiary');

  -- 6. Kod rabatowy z metadanych kasy liczy sie do pokrycia: 1500 + 300 zl.
  v := public.payments_apply_event_ticket_outcome(pg_temp.order78('z_kodem', '78a00000-0000-0000-0000-000000000001',
    150000, jsonb_build_object('event_id', '78e00000-0000-0000-0000-0000000000e1',
      'registration_id', '78400000-0000-0000-0000-000000000001',
      'ticket_type_id', '78100000-0000-0000-0000-000000000001', 'quantity', 1,
      'coupon_discount_cents', 30000)), 'paid');
  PERFORM pg_temp.assert(v->>'applied' = 'true' AND v->>'registration_status' = 'approved'
    AND (SELECT payment_status = 'paid' AND qr_token_hash IS NOT NULL
           FROM pg_temp.r78('78400000-0000-0000-0000-000000000001')),
    '78/A TIX-01: wlasna wplata pokrywajaca bilet (z kodem) - przyjeta z kodem QR');

  -- 7. Ponowiony webhook TEGO SAMEGO zamowienia przechodzi (idempotencja).
  v := public.payments_apply_event_ticket_outcome(pg_temp.o78('z_kodem'), 'paid');
  PERFORM pg_temp.assert(v->>'applied' = 'true' AND NOT (v->>'newly_settled')::boolean,
    '78/A: ponowienie tego samego zamowienia - bez odmowy, bez drugiego rozliczenia');

  -- 8. Druga zakladka: druga wplata za to samo zgloszenie - zwrot w kolejce.
  v := public.payments_apply_event_ticket_outcome(pg_temp.order78('druga', '78a00000-0000-0000-0000-000000000001',
    200000, jsonb_build_object('event_id', '78e00000-0000-0000-0000-0000000000e1',
      'registration_id', '78400000-0000-0000-0000-000000000001',
      'ticket_type_id', '78100000-0000-0000-0000-000000000001', 'quantity', 1)), 'paid');
  PERFORM pg_temp.assert(v->>'reason' = 'already_settled_by_another_order'
    AND (v->>'refund_queued')::boolean
    AND v->>'payment_order_id' = pg_temp.o78('z_kodem')::text
    AND EXISTS (SELECT 1 FROM public.event_registration_refund_jobs j
                 WHERE j.payment_order_id = pg_temp.o78('druga')
                   AND j.registration_id = '78400000-0000-0000-0000-000000000001'),
    '78/A TIX-05: druga wplata za to samo zgloszenie - zwrot w kolejce, nie potwierdzenie');

  -- 9. Wskazanie, ktorego nie ma: znacznik do przegladu (nie ma do czego
  --    przypiac zadania zwrotu).
  v := public.payments_apply_event_ticket_outcome(pg_temp.order78('brak', '78a00000-0000-0000-0000-000000000001',
    200000, jsonb_build_object('event_id', '78e00000-0000-0000-0000-0000000000e1',
      'registration_id', '78400000-0000-0000-0000-0000000000ff',
      'ticket_type_id', '78100000-0000-0000-0000-000000000001')), 'paid');
  PERFORM pg_temp.assert(v->>'reason' = 'registration_mismatch' AND (v->>'refused')::boolean
    AND NOT (v->>'refund_queued')::boolean
    AND (SELECT (metadata->>'needs_manual_review')::boolean FROM public.payment_orders
          WHERE id = pg_temp.o78('brak')),
    '78/A TIX-05: wskazanie nieistniejacego zgloszenia - odmowa i znacznik do przegladu');
END $$;

-- ---------------------------------------------------------------------------
-- B. TIX-03: GOSCIE PO OTWARCIU KASY
-- ---------------------------------------------------------------------------
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, created_by, group_lead_registration_id, created_at)
VALUES
  ('78400000-0000-0000-0000-000000000010', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e2', '78300000-0000-0000-0000-000000000003',
   '78100000-0000-0000-0000-000000000003', 'pending', 'form', 'unpaid',
   '78a00000-0000-0000-0000-000000000003', NULL, now() - interval '20 minutes'),
  -- Dwaj goscie SPRZED kasy; kasa liczy jednego (quantity 2 = prowadzacy + 1).
  ('78400000-0000-0000-0000-000000000011', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e2', '78300000-0000-0000-0000-000000000011',
   '78100000-0000-0000-0000-000000000003', 'pending', 'form', 'unpaid',
   '78a00000-0000-0000-0000-000000000003', '78400000-0000-0000-0000-000000000010',
   now() - interval '15 minutes'),
  ('78400000-0000-0000-0000-000000000012', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e2', '78300000-0000-0000-0000-000000000012',
   '78100000-0000-0000-0000-000000000003', 'pending', 'form', 'unpaid',
   '78a00000-0000-0000-0000-000000000003', '78400000-0000-0000-0000-000000000010',
   now() - interval '14 minutes');

SELECT pg_temp.order78('grupa', '78a00000-0000-0000-0000-000000000003', 20000,
  jsonb_build_object('event_id', '78e00000-0000-0000-0000-0000000000e2',
    'registration_id', '78400000-0000-0000-0000-000000000010',
    'ticket_type_id', '78100000-0000-0000-0000-000000000003', 'quantity', 2),
  'processing', now() - interval '10 minutes');

DO $$
DECLARE v jsonb;
BEGIN
  -- SCALENIE Z MAIN (PR #504): od R38 (REG 20261012180300) dopisanie gosci
  -- oddaje odmowe WARTOSCIA `{ok:false, error}` (rdzen
  -- `_event_register_group_guests`, wrapper tylko service_role), a nie
  -- wyjatkiem - TIX-03 siedzi w tym rdzeniu (20261013900300). Ta sama odmowa,
  -- inny ksztalt; wiersz goscia nie powstaje.
  PERFORM pg_temp.act_as('78a00000-0000-0000-0000-000000000003', '78000000-0000-0000-0000-0000000000a0');
  v := public.event_register_group_guests('78400000-0000-0000-0000-000000000010',
         '[{"first_name":"Nowy","last_name":"Gosc","email":"nowy.78@example.org"}]'::jsonb);
  PERFORM pg_temp.assert(v = '{"ok": false, "error": "checkout_in_progress"}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM public.event_people WHERE email_norm = 'nowy.78@example.org'),
    '78/B TIX-03: dopisanie goscia przy otwartej kasie zgloszenia - odmowa');
  PERFORM pg_temp.act_as();

  -- Gosc dopisany mimo wszystko PO zalozeniu zamowienia (np. przez starsza
  -- sciezke albo po oknie 30 minut) - ten wiersz wstawia test wprost.
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
     payment_status, created_by, group_lead_registration_id)
  VALUES
    ('78400000-0000-0000-0000-000000000013', '78000000-0000-0000-0000-0000000000a0',
     '78e00000-0000-0000-0000-0000000000e2', '78300000-0000-0000-0000-000000000013',
     '78100000-0000-0000-0000-000000000003', 'pending', 'form', 'unpaid',
     '78a00000-0000-0000-0000-000000000003', '78400000-0000-0000-0000-000000000010');

  v := public.payments_apply_event_ticket_outcome(pg_temp.o78('grupa'), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'approved',
    '78/B: wplata za grupe przyjmuje prowadzacego');
  PERFORM pg_temp.assert(
    (SELECT payment_status = 'paid' FROM pg_temp.r78('78400000-0000-0000-0000-000000000011'))
    AND (SELECT payment_status = 'unpaid' FROM pg_temp.r78('78400000-0000-0000-0000-000000000012'))
    AND (SELECT payment_status = 'unpaid' FROM pg_temp.r78('78400000-0000-0000-0000-000000000013')),
    '78/B TIX-03: wplata za 2 miejsca oplaca 1 goscia - nie trzech (reszta nieoplacona)');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' FROM pg_temp.r78('78400000-0000-0000-0000-000000000011'))
    AND (SELECT status = 'pending' AND qr_token_hash IS NULL
           FROM pg_temp.r78('78400000-0000-0000-0000-000000000013')),
    '78/B TIX-03: gosc dopisany po kasie nie dostaje miejsca ani kodu');
END $$;

-- ---------------------------------------------------------------------------
-- C. TIX-04 / TIX-07: JEDNA KSIEGA MIEJSC, ZAMOWIENIA PAKIETOW
-- ---------------------------------------------------------------------------
INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, audience, seats,
   price_cents, currency, quota)
VALUES
  ('78800000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e3', '78100000-0000-0000-0000-000000000004',
   'firma4', 'Firmowy 4', 'Corporate 4', 'company', 4, 100000, 'PLN', NULL);

CREATE FUNCTION pg_temp.sold78() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT sold_count FROM public.event_ticket_types WHERE id = '78100000-0000-0000-0000-000000000004' $$;
CREATE FUNCTION pg_temp.st78(_order uuid, _status text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.act_as('78a00000-0000-0000-0000-0000000000a1', '78000000-0000-0000-0000-0000000000a0');
  RETURN public.admin_event_package_order_set_status(jsonb_build_object('id', _order, 'status', _status));
END $$;
CREATE FUNCTION pg_temp.invite78(_order uuid, _email text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.act_as('78a00000-0000-0000-0000-000000000004', '78000000-0000-0000-0000-0000000000a0');
  RETURN public.event_package_seat_invite(jsonb_build_object(
    'package_order_id', _order, 'email', _email))->>'token';
END $$;
CREATE FUNCTION pg_temp.accept78(_token text, _first text) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.act_as();
  RETURN public.event_package_invite_accept(jsonb_build_object(
    'token', _token, 'first_name', _first, 'last_name', 'Delegat',
    'consent_data_processing', true, 'ip_hash', md5(_token)));
END $$;

DO $$
DECLARE v jsonb; v_order uuid; v_tok text; v_reg uuid; v_left integer;
BEGIN
  PERFORM pg_temp.act_as('78a00000-0000-0000-0000-000000000004', '78000000-0000-0000-0000-0000000000a0');
  v := public.event_package_purchase(jsonb_build_object('package_id', '78800000-0000-0000-0000-000000000001'));
  v_order := (v->>'order_id')::uuid;
  INSERT INTO t78 VALUES ('pakiet', v_order);
  PERFORM pg_temp.assert(v->>'status' = 'pending' AND (v->>'pay_by')::timestamptz > now()
    AND (SELECT pay_by FROM public.event_package_orders WHERE id = v_order) IS NOT NULL,
    '78/C TIX-07: zakup samoobslugowy dostaje termin platnosci');
  PERFORM pg_temp.assert(pg_temp.sold78() = 4
    AND public._event_seats_left('78000000-0000-0000-0000-0000000000a0',
          '78e00000-0000-0000-0000-0000000000e3', '78100000-0000-0000-0000-000000000004') = 6,
    '78/C TIX-04: 4 miejsca pakietu zajmuja pule biletu (10 - 4 = 6)');
  PERFORM pg_temp.assert(
    (SELECT going = 4 AND seats_left = 8 FROM public.event_seat_state('78e00000-0000-0000-0000-0000000000e3')),
    '78/C TIX-04: miejsca pakietu licza sie do sali (12 - 4 = 8, going = 4)');

  -- Zwykly zapis i zmiana jego statusu NIE oddaje miejsc pakietu do sprzedazy.
  PERFORM pg_temp.act_as();
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
     payment_status, decided_at, decision_source)
  VALUES ('78400000-0000-0000-0000-000000000020', '78000000-0000-0000-0000-0000000000a0',
          '78e00000-0000-0000-0000-0000000000e3', '78300000-0000-0000-0000-000000000007',
          '78100000-0000-0000-0000-000000000004', 'approved', 'form', 'not_required', now(), 'system');
  PERFORM pg_temp.assert(pg_temp.sold78() = 5,
    '78/C TIX-04: zwykly zapis dolicza sie do miejsc pakietu (5), nie kasuje ich (bylo: 1)');
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
  WHERE id = '78400000-0000-0000-0000-000000000020';
  PERFORM pg_temp.assert(pg_temp.sold78() = 4,
    '78/C TIX-04: odwolanie zapisu oddaje TYLKO jego miejsce (4)');

  -- Zaproszenie z NIEOPLACONEGO zamowienia: delegat czeka bez kodu.
  v_tok := pg_temp.invite78(v_order, 'delegat1.78@example.org');
  v := pg_temp.accept78(v_tok, 'Pierwszy');
  v_reg := (v->>'registration_id')::uuid;
  INSERT INTO t78 VALUES ('delegat1', v_reg);
  PERFORM pg_temp.assert(v->>'status' = 'pending' AND (v->>'awaiting_payment')::boolean
    AND v->'qr_token' = 'null'::jsonb
    AND (SELECT status = 'pending' AND qr_token_hash IS NULL AND source = 'package_invitation'
           FROM public.event_registrations WHERE id = v_reg),
    '78/C TIX-07: zaproszenie z nieoplaconego zamowienia - pending bez kodu QR');
  PERFORM pg_temp.assert(pg_temp.sold78() = 4,
    '78/C TIX-04: delegat czekajacy trzyma SWOJE miejsce pakietu - pula bez zmian');

  -- Oplacenie zamowienia przyjmuje delegata; ksiega bez zmian (miejsce -> zgloszenie).
  PERFORM pg_temp.assert(pg_temp.st78(v_order, 'paid'), '78/C: organizator oznacza zamowienie jako oplacone');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND decision_source = 'system' FROM public.event_registrations WHERE id = v_reg)
    AND pg_temp.sold78() = 4,
    '78/C TIX-07: oplacenie przyjmuje delegata; pula nadal 4 (bez podwojnego liczenia)');

  -- Sprzedaz do konca puli, a potem przyjecie zaproszenia z oplaconego zamowienia.
  PERFORM pg_temp.act_as();
  INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
  SELECT ('78300000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid,
         '78000000-0000-0000-0000-0000000000a0', 'pula' || i || '.78@example.org', 'Pula', 'Os' || i
  FROM generate_series(1, 7) i;
  INSERT INTO public.event_registrations
    (tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
     decided_at, decision_source)
  SELECT '78000000-0000-0000-0000-0000000000a0', '78e00000-0000-0000-0000-0000000000e3',
         ('78300000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid,
         '78100000-0000-0000-0000-000000000004', 'approved', 'form', 'not_required', now(), 'system'
  FROM generate_series(1, 6) i;
  PERFORM pg_temp.assert(pg_temp.sold78() = 10,
    '78/C TIX-04: sprzedaz konczy sie na puli (6 zapisow + 4 miejsca pakietu = 10)');
  PERFORM pg_temp.assert_raises_like(
    $q$INSERT INTO public.event_registrations
         (tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
          decided_at, decision_source)
       VALUES ('78000000-0000-0000-0000-0000000000a0', '78e00000-0000-0000-0000-0000000000e3',
               '78300000-0000-0000-0000-000000000107', '78100000-0000-0000-0000-000000000004',
               'approved', 'form', 'not_required', now(), 'system')$q$,
    'event_ticket_types_sold_within_quota',
    '78/C TIX-04: zapis ponad pule (miejsca pakietu zajete) - odmowa CHECK puli');
  v_tok := pg_temp.invite78(v_order, 'delegat2.78@example.org');
  v := pg_temp.accept78(v_tok, 'Drugi');
  PERFORM pg_temp.assert(v->>'status' = 'approved' AND v->>'qr_token' IS NOT NULL
    AND pg_temp.sold78() = 10,
    '78/C TIX-04: delegat z oplaconym zaproszeniem wchodzi przy pelnej puli (bylo: CHECK)');

  -- Anulowanie: dwa miejsca bez delegata wracaja do puli; delegaci na miejscu zostaja.
  PERFORM pg_temp.assert(pg_temp.st78(v_order, 'cancelled'), '78/C: organizator anuluje zamowienie');
  PERFORM pg_temp.assert(pg_temp.sold78() = 8
    AND (SELECT count(*) FROM public.event_package_seats
          WHERE package_order_id = v_order AND revoked_at IS NOT NULL) = 2,
    '78/C TIX-04: anulowanie oddaje 2 nieprzypisane miejsca (10 -> 8)');
  PERFORM pg_temp.assert(
    (SELECT sold_count FROM public.event_ticket_packages
      WHERE id = '78800000-0000-0000-0000-000000000001') = 0,
    '78/C TIX-04: licznik pakietow przelicza anulowane zamowienie');
END $$;

DO $$
DECLARE v jsonb; v_order uuid; v_tok text; v_reg uuid;
BEGIN
  -- Miejsce na drugie zamowienie: czterech zwyklych uczestnikow odwoluje udzial.
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
  WHERE person_id IN ('78300000-0000-0000-0000-000000000101', '78300000-0000-0000-0000-000000000102',
                      '78300000-0000-0000-0000-000000000103', '78300000-0000-0000-0000-000000000104');
  PERFORM pg_temp.assert(pg_temp.sold78() = 4, '78/C: po odwolaniach w puli 2 zapisy + 2 delegatow (4)');

  -- Przeglad terminow: zamowienie po `pay_by`, z delegatem czekajacym.
  PERFORM pg_temp.act_as('78a00000-0000-0000-0000-000000000004', '78000000-0000-0000-0000-0000000000a0');
  v := public.event_package_purchase(jsonb_build_object('package_id', '78800000-0000-0000-0000-000000000001'));
  v_order := (v->>'order_id')::uuid;
  v_tok := pg_temp.invite78(v_order, 'delegat3.78@example.org');
  v := pg_temp.accept78(v_tok, 'Trzeci');
  v_reg := (v->>'registration_id')::uuid;
  PERFORM pg_temp.assert(pg_temp.sold78() = 8 AND v->>'status' = 'pending',
    '78/C: drugie zamowienie trzyma 4 miejsca (4 + 4 = 8), delegat czeka');
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(public._event_package_orders_expire(100) = 0,
    '78/C TIX-07: zamowienie przed terminem nie jest anulowane');
  UPDATE public.event_package_orders SET pay_by = now() - interval '1 hour' WHERE id = v_order;
  PERFORM pg_temp.assert(public._event_package_orders_expire(100) = 1,
    '78/C TIX-07: przeglad anuluje zamowienie po terminie platnosci');
  PERFORM pg_temp.assert(
    (SELECT status = 'cancelled' FROM public.event_package_orders WHERE id = v_order)
    AND (SELECT status = 'cancelled' FROM public.event_registrations WHERE id = v_reg)
    AND pg_temp.sold78() = 4,
    '78/C TIX-07: po terminie - zamowienie i delegat czekajacy anulowani, miejsca wracaja (4)');
  PERFORM pg_temp.assert(public._event_package_orders_expire(100) = 0,
    '78/C TIX-07: przeglad jest idempotentny');

  -- Limit otwartych zamowien kupujacego.
  UPDATE public.event_ticket_packages SET max_open_orders_per_buyer = 1
  WHERE id = '78800000-0000-0000-0000-000000000001';
  PERFORM pg_temp.act_as('78a00000-0000-0000-0000-000000000004', '78000000-0000-0000-0000-0000000000a0');
  PERFORM public.event_package_purchase(jsonb_build_object('package_id', '78800000-0000-0000-0000-000000000001'));
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object('package_id', '78800000-0000-0000-0000-000000000001'))$q$,
    'too_many_open_orders',
    '78/C TIX-07: drugie otwarte zamowienie tego samego kupujacego - odmowa');
  PERFORM pg_temp.act_as();
END $$;

-- ---------------------------------------------------------------------------
-- D. TIX-08: MIEJSCE RSVP PO WPLACIE POD BLOKADA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.order78('rsvp1', '78a00000-0000-0000-0000-000000000005', 5000,
    jsonb_build_object('event_id', '78e00000-0000-0000-0000-0000000000e4'));
  PERFORM pg_temp.order78('rsvp2', '78a00000-0000-0000-0000-000000000006', 5000,
    jsonb_build_object('event_id', '78e00000-0000-0000-0000-0000000000e4'));
  v := public._event_rsvp_claim_paid_seat(pg_temp.o78('rsvp1'));
  PERFORM pg_temp.assert((v->>'ok')::boolean AND NOT (v->>'already')::boolean
    AND EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = '78e00000-0000-0000-0000-0000000000e4'
                  AND user_id = '78a00000-0000-0000-0000-000000000005' AND status = 'going'),
    '78/D TIX-08: pierwsza wplata zajmuje ostatnie miejsce RSVP');
  v := public._event_rsvp_claim_paid_seat(pg_temp.o78('rsvp2'));
  PERFORM pg_temp.assert(NOT (v->>'ok')::boolean AND v->>'reason' = 'event_full'
    AND NOT EXISTS (SELECT 1 FROM public.event_rsvps WHERE event_id = '78e00000-0000-0000-0000-0000000000e4'
                      AND user_id = '78a00000-0000-0000-0000-000000000006'),
    '78/D TIX-08: druga wplata o to samo miejsce - event_full (do zwrotu), bez RSVP');
  v := public._event_rsvp_claim_paid_seat(pg_temp.o78('rsvp1'));
  PERFORM pg_temp.assert((v->>'ok')::boolean AND (v->>'already')::boolean,
    '78/D TIX-08: ponowiony webhook pierwszej wplaty - idempotentnie OK');
  PERFORM pg_temp.assert(
    NOT has_function_privilege('authenticated', 'public._event_rsvp_claim_paid_seat(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public._event_rsvp_claim_paid_seat(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public._event_rsvp_claim_paid_seat(uuid)', 'EXECUTE'),
    '78/D: zajecie miejsca RSVP wylacznie dla roli serwisowej');
END $$;

-- ---------------------------------------------------------------------------
-- E. TIX-13b: JEDNA GRANICA OKNA KODU
-- ---------------------------------------------------------------------------
INSERT INTO public.b2b_coupons
  (id, tenant_id, code, discount_kind, discount_cents, currency, event_ids, ticket_type_ids,
   package_ids, active, valid_from, valid_until, applies_discount)
VALUES
  ('78c00000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-0000000000a0',
   'KONIEC-TERAZ-78', 'fixed', 1000, 'PLN', ARRAY['78e00000-0000-0000-0000-0000000000e3']::uuid[],
   ARRAY[]::uuid[], ARRAY[]::uuid[], true, NULL, now(), true);

DO $$
DECLARE v jsonb; c public.b2b_coupons; r record;
BEGIN
  SELECT * INTO c FROM public.b2b_coupons WHERE id = '78c00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(public._b2b_coupon_window_open(NULL, now())
    AND NOT public._b2b_coupon_window_open(NULL, now() - interval '1 microsecond')
    AND public._b2b_coupon_window_open(now(), NULL),
    '78/E TIX-13b: okno domkniete po obu stronach');
  PERFORM pg_temp.act_as('78a00000-0000-0000-0000-000000000004', '78000000-0000-0000-0000-0000000000a0');
  v := public.event_admission_quote(jsonb_build_object(
    'package_id', '78800000-0000-0000-0000-000000000001', 'coupon_code', 'KONIEC-TERAZ-78'));
  SELECT * INTO r FROM public._b2b_coupon_evaluate(c, 30000, 'PLN', '78a00000-0000-0000-0000-000000000004'::uuid);
  PERFORM pg_temp.assert((v->>'ok')::boolean AND r.ok,
    '78/E TIX-13b: kod w ostatniej chwili waznosci dziala i w pakiecie, i w bilecie');
  PERFORM pg_temp.act_as();
END $$;

-- ---------------------------------------------------------------------------
-- F. TIX-09: STAWKA BILETU - SESJA (opcje kasy) = FAKTURA
-- ---------------------------------------------------------------------------
INSERT INTO public.event_invoice_settings
  (tenant_id, enabled, confirmed_at, seller_name, seller_tax_id, seller_address,
   seller_postal_code, seller_city, default_vat_rate, vat_exempt_basis)
VALUES ('78000000-0000-0000-0000-0000000000a0', true, now(), 'Organizator 78', '7011278375',
        'ul. Krotka 1', '00-001', 'Warszawa', '23', '')
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, paid_at, created_by)
VALUES
  ('78400000-0000-0000-0000-000000000030', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e5', '78300000-0000-0000-0000-000000000001',
   '78100000-0000-0000-0000-000000000005', 'approved', 'form', 'paid', now(),
   '78a00000-0000-0000-0000-000000000001'),
  ('78400000-0000-0000-0000-000000000031', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e5', '78300000-0000-0000-0000-000000000003',
   '78100000-0000-0000-0000-000000000006', 'approved', 'form', 'paid', now(),
   '78a00000-0000-0000-0000-000000000003');

DO $$
DECLARE v jsonb; v_id uuid; v_rates text;
BEGIN
  PERFORM pg_temp.act_as('78a00000-0000-0000-0000-0000000000a1', '78000000-0000-0000-0000-0000000000a0');
  PERFORM public.admin_event_ticket_set_tax_profile('78100000-0000-0000-0000-000000000005',
    '{"vat_rate":"8","stripe_tax_code":"txcd_20030000"}'::jsonb);
  PERFORM public.admin_event_ticket_set_tax_profile('78100000-0000-0000-0000-000000000006',
    '{"vat_rate":"zw","vat_exempt_basis":"art. 43 ust. 1 pkt 29 lit. c ustawy o VAT"}'::jsonb);
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_ticket_set_tax_profile('78100000-0000-0000-0000-000000000005',
         '{"stripe_tax_code":"txcd_1"}'::jsonb)$q$,
    'invalid_tax_code', '78/F TIX-09: kod podatkowy Stripe w zlym ksztalcie - odmowa');
  -- Podstawa zwolnienia dluzsza niz 300 znakow: odmowa w pakiecie tak jak w bilecie,
  -- nigdy ucieta po cichu cytata przepisu.
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_package_upsert(jsonb_build_object(
         'event_id', '78e00000-0000-0000-0000-0000000000e5',
         'ticket_type_id', '78100000-0000-0000-0000-000000000005',
         'key', 'za_dluga_podstawa', 'name_pl', 'Pakiet', 'name_en', 'Package',
         'vat_rate', 'zw', 'vat_exempt_basis', %L))$q$, repeat('x', 301)),
    'invalid_exempt_basis', '78/F TIX-09: za dluga podstawa zwolnienia pakietu - odmowa, nie ucinanie');
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_ticket_set_tax_profile('78100000-0000-0000-0000-000000000005',
         jsonb_build_object('vat_rate', 'zw', 'vat_exempt_basis', %L))$q$, repeat('x', 301)),
    'invalid_exempt_basis', '78/F TIX-09: za dluga podstawa zwolnienia biletu - odmowa');

  v := public.event_ticket_public_options('78100000-0000-0000-0000-000000000005');
  PERFORM pg_temp.assert(v->>'vat_rate' = '8' AND v->>'stripe_tax_code' = 'txcd_20030000',
    '78/F TIX-09: kasa dostaje stawke i kod podatkowy biletu');

  v_id := public.admin_event_invoice_draft_create(jsonb_build_object(
    'event_id', '78e00000-0000-0000-0000-0000000000e5', 'kind', 'invoice',
    'sources', jsonb_build_array(
      jsonb_build_object('kind', 'registration', 'id', '78400000-0000-0000-0000-000000000030'))));
  SELECT string_agg(l.vat_rate, ',' ORDER BY l.position) INTO v_rates
    FROM public.event_invoice_lines l WHERE l.invoice_id = v_id;
  PERFORM pg_temp.assert(v_rates = '8',
    '78/F TIX-09: faktura bierze stawke 8% z biletu, nie domyslne 23% najemcy');

  -- INV-14 (20261012100200): faktura za oplacone zgloszenie wymaga
  -- zaksiegowanej kwoty przelewu - ksiegujemy ja przed szkicem, wiec pozycje
  -- ida z zaksiegowanej kwoty (20000 = cena biletu szkoleniowego).
  PERFORM public.admin_event_registration_record_payment(jsonb_build_object(
    'registration_id', '78400000-0000-0000-0000-000000000031', 'amount_cents', 20000));
  v_id := public.admin_event_invoice_draft_create(jsonb_build_object(
    'event_id', '78e00000-0000-0000-0000-0000000000e5', 'kind', 'invoice',
    'buyer', jsonb_build_object('is_company', false, 'name', 'Lena Prowadzaca',
      'address', 'ul. Prosta 2', 'postal_code', '00-002', 'city', 'Warszawa', 'country', 'PL',
      'email', 'lead.78@example.org'),
    'sources', jsonb_build_array(
      jsonb_build_object('kind', 'registration', 'id', '78400000-0000-0000-0000-000000000031'))));
  PERFORM pg_temp.assert(
    (SELECT string_agg(l.vat_rate, ',') FROM public.event_invoice_lines l WHERE l.invoice_id = v_id) = 'zw'
    AND (SELECT vat_exempt_basis LIKE 'art. 43%' FROM public.event_invoices WHERE id = v_id),
    '78/F TIX-09: szkolenie zwolnione - pozycja zw i podstawa zwolnienia z biletu');
  v := public.admin_event_invoice_issue(v_id);
  PERFORM pg_temp.assert(
    (SELECT status = 'issued' AND vat_exempt_basis LIKE 'art. 43%' FROM public.event_invoices WHERE id = v_id),
    '78/F TIX-09: wystawienie bez podstawy w ustawieniach najemcy - podstawa z biletu');
  PERFORM pg_temp.act_as();
END $$;

-- ---------------------------------------------------------------------------
-- G. TIX-13a: DARMOWE ZAMOWIENIE BEZ SLADU ROZLICZENIA WRACA DO PONOWIENIA
-- ---------------------------------------------------------------------------
-- Kasa rozlicza bilet za zero bez operatora, wiec bez webhooka, ktory ponowilby
-- rozliczenie urwane w polowie. Tick zadan bierze liste z bazy - kryterium to
-- fakty: `pending` po oknie laski albo `paid` bez zgloszenia, RSVP i odmowy.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, created_by)
VALUES
  ('78400000-0000-0000-0000-000000000040', '78000000-0000-0000-0000-0000000000a0',
   '78e00000-0000-0000-0000-0000000000e5', '78300000-0000-0000-0000-000000000007',
   '78100000-0000-0000-0000-000000000005', 'pending', 'form', 'unpaid',
   '78a00000-0000-0000-0000-000000000007');
INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status) VALUES
  ('78000000-0000-0000-0000-0000000000a0', '78e00000-0000-0000-0000-0000000000e5',
   '78a00000-0000-0000-0000-000000000005', 'going');

DO $$
DECLARE
  v_meta jsonb := '{"event_id":"78e00000-0000-0000-0000-0000000000e5","coupon_id":"78c00000-0000-0000-0000-0000000000c1","quantity":1}';
  v_user uuid := '78a00000-0000-0000-0000-000000000007';
  v_id uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_listed uuid[];
  rec record;
BEGIN
  FOR rec IN SELECT * FROM (VALUES
    -- klucz,              konto,                                    status,     dostawca, metadane,                                     wiek
    ('g_pending_old',      v_user,                                   'pending',  'coupon', v_meta,                                       interval '5 minutes'),
    ('g_pending_fresh',    v_user,                                   'pending',  'coupon', v_meta,                                       interval '0 minutes'),
    ('g_paid_unsettled',   v_user,                                   'paid',     'coupon', v_meta,                                       interval '5 minutes'),
    ('g_paid_rsvp',        '78a00000-0000-0000-0000-000000000005'::uuid, 'paid', 'coupon', v_meta,                                       interval '5 minutes'),
    ('g_paid_refused',     v_user,                                   'paid',     'coupon', v_meta || '{"ticket_refusal":{"reason":"amount_mismatch"}}', interval '5 minutes'),
    ('g_paid_registered',  v_user,                                   'paid',     'coupon', v_meta || '{"registration_id":"78400000-0000-0000-0000-000000000040"}', interval '5 minutes'),
    ('g_canceled',         v_user,                                   'canceled', 'coupon', v_meta,                                       interval '5 minutes'),
    ('g_stripe',           v_user,                                   'pending',  'stripe', v_meta,                                       interval '5 minutes'),
    ('g_too_old',          v_user,                                   'pending',  'coupon', v_meta,                                       interval '8 days'),
    ('g_no_coupon',        v_user,                                   'pending',  'coupon', v_meta - 'coupon_id',                         interval '5 minutes')
  ) AS t(k, u, st, prov, meta, age)
  LOOP
    INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency,
                                       provider, metadata, created_at)
    VALUES (gen_random_uuid(), '78000000-0000-0000-0000-0000000000a0', rec.u, 'one_time', rec.st, 0,
            'PLN', rec.prov, rec.meta, now() - rec.age)
    RETURNING id INTO STRICT v_id;
    v_ids := array_append(v_ids, v_id);
    INSERT INTO t78 VALUES (rec.k, v_id);
  END LOOP;
  UPDATE public.event_registrations SET payment_order_id = pg_temp.o78('g_paid_registered')
   WHERE id = '78400000-0000-0000-0000-000000000040';

  SELECT array_agg(x ORDER BY x) INTO v_listed
    FROM public._event_free_ticket_orders_unsettled(100) AS x
   WHERE x = ANY (v_ids);
  PERFORM pg_temp.assert(
    v_listed = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[
      pg_temp.o78('g_pending_old'), pg_temp.o78('g_paid_unsettled')]) AS x),
    '78/G TIX-13a: do ponowienia tylko pending po oknie laski i paid bez zgloszenia, RSVP i odmowy');

  PERFORM pg_temp.assert(
    NOT has_function_privilege('authenticated', 'public._event_free_ticket_orders_unsettled(integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public._event_free_ticket_orders_unsettled(integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public._event_free_ticket_orders_unsettled(integer)', 'EXECUTE'),
    '78/G TIX-13a: lista zamowien wszystkich najemcow tylko dla roli serwisowej');
END $$;

-- ---------------------------------------------------------------------------
-- H. TIX-09 RAZEM Z FAKTURAMI Z MAIN (INV): STAWKA ZRODLA WSZEDZIE TA SAMA
-- ---------------------------------------------------------------------------
-- Bilet z cena NETTO (8%), osoby i zgloszenia do proformy - kazde na innej osobie.
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('78300000-0000-0000-0000-000000000021', '78000000-0000-0000-0000-0000000000a0', NULL, 'h1.78@example.org', 'Hanna', 'Netto'),
  ('78300000-0000-0000-0000-000000000022', '78000000-0000-0000-0000-0000000000a0', NULL, 'h2.78@example.org', 'Henryk', 'Proforma'),
  ('78300000-0000-0000-0000-000000000023', '78000000-0000-0000-0000-0000000000a0', NULL, 'h3.78@example.org', 'Helena', 'Zwolniona');
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, quota,
   min_tier_rank, requires_approval, is_active, sort_order, group_registration_enabled,
   group_max_size, early_bird_price_cents, early_bird_until, tax_mode, vat_rate)
VALUES
  ('78100000-0000-0000-0000-000000000007', '78000000-0000-0000-0000-0000000000a0', '78e00000-0000-0000-0000-0000000000e5', 'netto', 'Netto', 'Net', 10000, 'PLN', NULL,
   0, false, true, 30, false, 10, NULL, NULL, 'exclusive', '8');
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, created_by)
VALUES
  ('78400000-0000-0000-0000-000000000034', '78000000-0000-0000-0000-0000000000a0', '78e00000-0000-0000-0000-0000000000e5', '78300000-0000-0000-0000-000000000021',
   '78100000-0000-0000-0000-000000000007', 'approved', 'form', 'unpaid',
   '78a00000-0000-0000-0000-000000000001'),
  ('78400000-0000-0000-0000-000000000032', '78000000-0000-0000-0000-0000000000a0', '78e00000-0000-0000-0000-0000000000e5', '78300000-0000-0000-0000-000000000022',
   '78100000-0000-0000-0000-000000000005', 'approved', 'form', 'unpaid',
   '78a00000-0000-0000-0000-000000000001'),
  ('78400000-0000-0000-0000-000000000033', '78000000-0000-0000-0000-0000000000a0', '78e00000-0000-0000-0000-0000000000e5', '78300000-0000-0000-0000-000000000023',
   '78100000-0000-0000-0000-000000000006', 'approved', 'form', 'unpaid',
   '78a00000-0000-0000-0000-000000000001');

DO $$
DECLARE
  v_buyer jsonb := jsonb_build_object('is_company', false, 'name', 'Henryk Proforma',
    'address', 'ul. Prosta 3', 'postal_code', '00-003', 'city', 'Warszawa', 'country', 'PL',
    'email', 'h2.78@example.org');
  v_id uuid;
  v_pro uuid;
  v_inv uuid;
  v_corr uuid;
  v_pkg uuid;
  v_ord_invoiced uuid;
  v_ord_plain uuid;
  v_rates text;
BEGIN
  PERFORM pg_temp.act_as('78a00000-0000-0000-0000-0000000000a1', '78000000-0000-0000-0000-0000000000a0');

  -- H1: bilet NETTO 100 zl ze stawka 8% - brutto 108 zl, nie 123 zl ze stawki najemcy.
  v_id := public.admin_event_invoice_draft_create(jsonb_build_object(
    'event_id', '78e00000-0000-0000-0000-0000000000e5', 'kind', 'invoice', 'buyer', v_buyer,
    'sources', jsonb_build_array(jsonb_build_object('kind', 'registration',
      'id', '78400000-0000-0000-0000-000000000034'))));
  PERFORM pg_temp.assert(
    (SELECT l.vat_rate = '8' AND l.gross_cents = 10800 AND l.net_cents = 10000
       FROM public.event_invoice_lines l WHERE l.invoice_id = v_id),
    '78/H TIX-09: bilet netto liczony stawka biletu (8%): 100 zl netto = 108 zl brutto');

  -- H2: pakiet BEZ wlasnej stawki dziedziczy stawke i podstawe swojego biletu (zw).
  v_pkg := public.admin_event_package_upsert(jsonb_build_object(
    'event_id', '78e00000-0000-0000-0000-0000000000e5', 'ticket_type_id', '78100000-0000-0000-0000-000000000006',
    'key', 'szkolenie_firmowe', 'name_pl', 'Szkolenie firmowe', 'name_en', 'Company training',
    'seats', 2, 'price_cents', 40000, 'currency', 'PLN'));
  v_ord_invoiced := public.admin_event_package_order_create(jsonb_build_object(
    'package_id', v_pkg, 'buyer_email', 'firma.78@example.org', 'buyer_name', 'Firma 78'));
  v_inv := public.admin_event_invoice_draft_create(jsonb_build_object(
    'event_id', '78e00000-0000-0000-0000-0000000000e5', 'kind', 'invoice',
    'buyer', jsonb_build_object('is_company', true, 'name', 'Firma 78', 'tax_id', '5260250274',
      'address', 'ul. Firmowa 1', 'postal_code', '00-004', 'city', 'Warszawa', 'country', 'PL',
      'email', 'firma.78@example.org'),
    'sources', jsonb_build_array(jsonb_build_object('kind', 'package_order', 'id', v_ord_invoiced))));
  PERFORM pg_temp.assert(
    (SELECT string_agg(DISTINCT l.vat_rate, ',') FROM public.event_invoice_lines l WHERE l.invoice_id = v_inv) = 'zw'
    AND (SELECT vat_exempt_basis LIKE 'art. 43%' FROM public.event_invoices WHERE id = v_inv),
    '78/H TIX-09: pakiet bez stawki dziedziczy stawke zw i podstawe zwolnienia swojego biletu');

  -- H3: przeglad terminow NIE anuluje zamowienia z wystawiona faktura; bez niej - tak.
  PERFORM public.admin_event_invoice_issue(v_inv);
  v_ord_plain := public.admin_event_package_order_create(jsonb_build_object(
    'package_id', v_pkg, 'buyer_email', 'druga.78@example.org', 'buyer_name', 'Druga 78'));
  UPDATE public.event_package_orders SET pay_by = now() - interval '1 day'
   WHERE id IN (v_ord_invoiced, v_ord_plain);
  PERFORM pg_temp.act_as();
  PERFORM public._event_package_orders_expire(200);
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_package_orders WHERE id = v_ord_invoiced) = 'pending'
    AND (SELECT status FROM public.event_package_orders WHERE id = v_ord_plain) = 'cancelled',
    '78/H TIX-07: termin platnosci nie anuluje zamowienia z wystawiona faktura (decyduje organizator)');
  PERFORM pg_temp.act_as('78a00000-0000-0000-0000-0000000000a1', '78000000-0000-0000-0000-0000000000a0');

  -- H4: korekta faktury zwolnionej (podstawa z biletu, najemca bez podstawy)
  -- dziedziczy podstawe faktury korygowanej - wystawienie przechodzi.
  v_corr := public.admin_event_invoice_correction_create(jsonb_build_object(
    'invoice_id', v_inv, 'mode', 'full', 'reason', 'Rezygnacja firmy'));
  PERFORM public.admin_event_invoice_issue(v_corr);
  PERFORM pg_temp.assert(
    (SELECT status = 'issued' AND vat_exempt_basis LIKE 'art. 43%' FROM public.event_invoices WHERE id = v_corr),
    '78/H TIX-09: korekta faktury zw wychodzi z podstawa zwolnienia faktury korygowanej');

  -- H5: proforma na bilet 8% i bilet zw, potem wplaty INNE niz proforma
  -- (przebudowa pozycji z wplat, INV-14): kazde zrodlo zachowuje swoja stawke,
  -- a faktura - podstawe zwolnienia proformy.
  v_pro := public.admin_event_invoice_draft_create(jsonb_build_object(
    'event_id', '78e00000-0000-0000-0000-0000000000e5', 'kind', 'proforma', 'buyer', v_buyer,
    'sources', jsonb_build_array(
      jsonb_build_object('kind', 'registration', 'id', '78400000-0000-0000-0000-000000000032'),
      jsonb_build_object('kind', 'registration', 'id', '78400000-0000-0000-0000-000000000033'))));
  PERFORM public.admin_event_invoice_issue(v_pro);
  UPDATE public.event_registrations SET payment_status = 'paid', paid_at = now()
   WHERE id IN ('78400000-0000-0000-0000-000000000032', '78400000-0000-0000-0000-000000000033');
  PERFORM public.admin_event_registration_record_payment(jsonb_build_object(
    'registration_id', '78400000-0000-0000-0000-000000000032', 'amount_cents', 10000));
  PERFORM public.admin_event_registration_record_payment(jsonb_build_object(
    'registration_id', '78400000-0000-0000-0000-000000000033', 'amount_cents', 20000));
  v_id := public.admin_event_invoice_from_proforma(v_pro);
  -- Zbior pozycji, nie kolejnosc: zrodla jednego szkicu maja ten sam czas utworzenia.
  SELECT string_agg(l.vat_rate || ':' || l.gross_cents, ',' ORDER BY l.vat_rate) INTO v_rates
    FROM public.event_invoice_lines l WHERE l.invoice_id = v_id;
  PERFORM pg_temp.assert(v_rates = '8:10000,zw:20000'
    AND (SELECT vat_exempt_basis LIKE 'art. 43%' FROM public.event_invoices WHERE id = v_id),
    format('78/H TIX-09: faktura z proformy po wplatach - stawka kazdego biletu i podstawa zwolnienia (%s)', v_rates));
  PERFORM public.admin_event_invoice_issue(v_id);
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_invoices WHERE id = v_id) = 'issued',
    '78/H TIX-09: faktura z proformy (8% + zw) wychodzi bez podstawy w ustawieniach najemcy');
  PERFORM pg_temp.act_as();
END $$;

ROLLBACK;
