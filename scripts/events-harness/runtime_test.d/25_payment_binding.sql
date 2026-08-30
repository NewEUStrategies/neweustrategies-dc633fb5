-- ============================================================================
-- 25_payment_binding - DO KTOREGO ZGLOSZENIA TRAFIA WPLATA
--
-- PO CO TEN PLIK ISTNIEJE
-- `payments_apply_event_ticket_outcome` jest JEDYNYM miejscem, w ktorym
-- „transakcja oplacona u operatora" zamienia sie w wejsciowke: ustawia
-- `payment_status`, wydaje kod QR, promuje `pending -> approved`, a przy
-- zwrocie odwraca to i zwalnia miejsce. Wolaja ja DWIE drogi - webhook
-- (`oneTimeFulfilment.server.ts`) i reczne ksiegowanie organizatora - wiec
-- pomylka w DOPASOWANIU zgloszenia jest pomylka o pieniadze, nie o ekran.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * nie sprawdza operatora platnosci (Stripe), webhookow ani dokumentow -
--     to inny modul i inny harness. Wchodzi TYLKO to, co robi baza;
--   * nie sprawdza `event_register` (plik 20_) ani odprawy kodem (plik 50_);
--   * nie sprawdza powiadomien - tresc dla uczestnika zyje w slowniku i18n.
--
-- CO SPRAWDZA
--   1. Dopasowanie po `metadata.registration_id` WYGRYWA z dopasowaniem po
--      osobie (defekt naprawiony migracja 20260830090000).
--   2. Dwa zgloszenia TEJ SAMEJ osoby na to samo wydarzenie ksieguja sie
--      KAZDE DO SWOJEGO.
--   3. Wskazanie cudzego wydarzenia albo cudzego najemcy to JAWNA ODMOWA
--      (`registration_mismatch`), a nie ciche zejscie do zgadywania po osobie.
--   4. Dopasowanie po osobie DZIALA NADAL dla zamowien bez tego klucza
--      (kasa spolecznosci ich nie ustawia).
--   5. `refunded` zwalnia miejsce i promuje pierwszego z listy rezerwowej.
--   6. NADSPRZEDAZ: wplata promuje `pending -> approved` BEZ sprawdzenia puli.
--      To jest DEFEKT ZAREJESTROWANY, nie naprawiony - patrz sekcja 6.
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK. Zadna asercja nie
-- potrzebuje drugiej sesji, wiec nic nie musi byc zacommitowane.
-- ============================================================================

\echo '== 25 wplata: do ktorego zgloszenia trafia =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA
--
-- Wlasny najemca (`dddddddd-...`) plus DRUGI (`eeeeeeee-...`) wylacznie po to,
-- zeby asercja o izolacji miala czego nie zobaczyc. Identyfikatory sa stale -
-- asercje czytaja sie wtedy same, bez podzapytan po kluczu naturalnym.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Tenant D (wplaty)', 'td-pay'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Tenant E (wplaty)', 'te-pay')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('d5000000-0000-0000-0000-000000000001', 'pay.one@example.org'),
  ('d5000000-0000-0000-0000-000000000002', 'pay.two@example.org'),
  ('d5000000-0000-0000-0000-000000000003', 'pay.three@example.org'),
  ('d5000000-0000-0000-0000-000000000004', 'pay.four@example.org'),
  ('d5000000-0000-0000-0000-000000000005', 'pay.five@example.org'),
  ('d5000000-0000-0000-0000-000000000006', 'pay.six@example.org'),
  ('d5000000-0000-0000-0000-0000000000e1', 'pay.alien@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  ('d1000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'pay-bind-a', 'Kongres D', 'Congress D', now() + interval '30 days', 'published',
   'form', 'instant', NULL),
  ('d1000000-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'pay-bind-b', 'Panel D', 'Panel D', now() + interval '31 days', 'published',
   'form', 'instant', NULL),
  ('d1000000-0000-0000-0000-000000000003', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'pay-refund-d', 'Kolacja D', 'Dinner D', now() + interval '32 days', 'published',
   'form', 'instant', NULL),
  ('d1000000-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'pay-oversell-d', 'Warsztat D', 'Workshop D', now() + interval '33 days', 'published',
   'form', 'instant', NULL),
  ('e1000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'pay-bind-e', 'Kongres E', 'Congress E', now() + interval '30 days', 'published',
   'form', 'instant', NULL);

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order)
VALUES
  ('d2000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000001', 'vip', 'VIP', 'VIP', 30000, 'PLN',
   NULL, 0, false, true, 10),
  ('d2000000-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000002', 'std', 'Standard', 'Standard', 10000, 'PLN',
   NULL, 0, false, true, 10),
  -- Pula 1: bez skonczonej puli nie da sie zmierzyc ani zwolnienia miejsca,
  -- ani nadsprzedazy.
  ('d2000000-0000-0000-0000-000000000003', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000003', 'lim', 'Limitowany', 'Limited', 20000, 'PLN',
   1, 0, false, true, 10),
  ('d2000000-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000004', 'lim2', 'Limitowany 2', 'Limited 2', 20000, 'PLN',
   1, 0, false, true, 10),
  ('e2000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'e1000000-0000-0000-0000-000000000001', 'vip', 'VIP', 'VIP', 30000, 'PLN',
   NULL, 0, false, true, 10);

INSERT INTO public.event_people
  (id, tenant_id, user_id, email, first_name, last_name)
VALUES
  ('d3000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000001', 'pay.one@example.org', 'Ola', 'Pierwsza'),
  ('d3000000-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000002', 'pay.two@example.org', 'Bartek', 'Drugi'),
  ('d3000000-0000-0000-0000-000000000003', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000003', 'pay.three@example.org', 'Cela', 'Trzecia'),
  ('d3000000-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000004', 'pay.four@example.org', 'Dawid', 'Czwarty'),
  ('d3000000-0000-0000-0000-000000000005', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000005', 'pay.five@example.org', 'Ewa', 'Piata'),
  ('d3000000-0000-0000-0000-000000000006', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000006', 'pay.six@example.org', 'Filip', 'Szosty'),
  ('e3000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'd5000000-0000-0000-0000-0000000000e1', 'pay.alien@example.org', 'Obcy', 'Najemca');

-- ---------------------------------------------------------------------------
-- ZGLOSZENIA
--
-- R1 i R2 naleza do TEJ SAMEJ osoby i do tego samego wydarzenia. Indeks
-- `event_registrations_active_uniq` dopuszcza tylko JEDNO aktywne zgloszenie
-- na osobe i wydarzenie, wiec starsze (R1) jest aktywne, a nowsze (R2) jest
-- odwolane - dokladnie tak, jak wyglada druga proba po porzuceniu pierwszej.
--
-- STARE DOPASOWANIE brało `ORDER BY created_at DESC LIMIT 1` BEZ filtra
-- statusu, wiec wplata za R1 ladowala na R2. Ta scenografia jest po to, zeby
-- to bylo mierzalne, a nie opowiedziane.
-- ---------------------------------------------------------------------------
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, cancelled_at, created_at)
VALUES
  ('d4000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001',
   'd2000000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid', NULL,
   now() - interval '2 hours'),
  ('d4000000-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001',
   'd2000000-0000-0000-0000-000000000001', 'cancelled', 'form', 'unpaid', now(),
   now() - interval '1 hour'),
  -- R3: inne WYDARZENIE tego samego najemcy - cel asercji o niezgodnosci.
  ('d4000000-0000-0000-0000-000000000003', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000002',
   'd2000000-0000-0000-0000-000000000002', 'pending', 'form', 'unpaid', NULL, now()),
  -- R4: sciezka ZAPASOWA - zamowienie bez `registration_id`, dopasowanie po osobie.
  ('d4000000-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000003',
   'd2000000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid', NULL, now()),
  -- R5/R6: zwrot zwalnia miejsce i promuje pierwszego z rezerwy.
  ('d4000000-0000-0000-0000-000000000005', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000004',
   'd2000000-0000-0000-0000-000000000003', 'pending', 'form', 'unpaid', NULL, now()),
  -- R7/R8: nadsprzedaz - obie na puli 1.
  ('d4000000-0000-0000-0000-000000000007', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000005',
   'd2000000-0000-0000-0000-000000000004', 'pending', 'form', 'unpaid', NULL, now()),
  ('d4000000-0000-0000-0000-000000000008', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000006',
   'd2000000-0000-0000-0000-000000000004', 'pending', 'form', 'unpaid', NULL, now()),
  -- R9: zgloszenie OBCEGO NAJEMCY - cel asercji o izolacji.
  ('e4000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'e1000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001',
   'e2000000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid', NULL, now());

-- R6 stoi w kolejce rezerwowej wydarzenia z pula 1 (wstawione osobno, bo
-- `waitlist_position` ma sens WYLACZNIE przy statusie `waitlist`).
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, waitlist_position, created_at)
VALUES
  ('d4000000-0000-0000-0000-000000000006', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd1000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000006',
   'd2000000-0000-0000-0000-000000000003', 'waitlist', 'form', 'not_required', 1, now());

INSERT INTO public.payment_orders
  (id, tenant_id, user_id, status, amount_cents, currency, metadata)
VALUES
  -- O1 -> R1 (starsze, AKTYWNE). Stare dopasowanie trafialoby w R2.
  ('d6000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000001', 'paid', 30000, 'PLN',
   jsonb_build_object('event_id','d1000000-0000-0000-0000-000000000001',
                      'ticket_type_id','d2000000-0000-0000-0000-000000000001',
                      'registration_id','d4000000-0000-0000-0000-000000000001')),
  -- O2 -> R2 (nowsze, ODWOLANE). Ta sama osoba, to samo wydarzenie, INNY wiersz.
  ('d6000000-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000001', 'paid', 30000, 'PLN',
   jsonb_build_object('event_id','d1000000-0000-0000-0000-000000000001',
                      'ticket_type_id','d2000000-0000-0000-0000-000000000001',
                      'registration_id','d4000000-0000-0000-0000-000000000002')),
  -- O3: wskazuje zgloszenie z INNEGO wydarzenia niz `event_id` zamowienia.
  ('d6000000-0000-0000-0000-000000000003', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000002', 'paid', 10000, 'PLN',
   jsonb_build_object('event_id','d1000000-0000-0000-0000-000000000001',
                      'ticket_type_id','d2000000-0000-0000-0000-000000000001',
                      'registration_id','d4000000-0000-0000-0000-000000000003')),
  -- O4: BEZ `registration_id` - sciezka zapasowa po osobie.
  ('d6000000-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000003', 'paid', 30000, 'PLN',
   jsonb_build_object('event_id','d1000000-0000-0000-0000-000000000001',
                      'ticket_type_id','d2000000-0000-0000-0000-000000000001')),
  -- O5 -> R5, potem zwrot.
  ('d6000000-0000-0000-0000-000000000005', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000004', 'paid', 20000, 'PLN',
   jsonb_build_object('event_id','d1000000-0000-0000-0000-000000000003',
                      'ticket_type_id','d2000000-0000-0000-0000-000000000003',
                      'registration_id','d4000000-0000-0000-0000-000000000005')),
  -- O7/O8 -> nadsprzedaz na puli 1.
  ('d6000000-0000-0000-0000-000000000007', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000005', 'paid', 20000, 'PLN',
   jsonb_build_object('event_id','d1000000-0000-0000-0000-000000000004',
                      'ticket_type_id','d2000000-0000-0000-0000-000000000004',
                      'registration_id','d4000000-0000-0000-0000-000000000007')),
  ('d6000000-0000-0000-0000-000000000008', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000006', 'paid', 20000, 'PLN',
   jsonb_build_object('event_id','d1000000-0000-0000-0000-000000000004',
                      'ticket_type_id','d2000000-0000-0000-0000-000000000004',
                      'registration_id','d4000000-0000-0000-0000-000000000008')),
  -- O9: najemca D wskazuje zgloszenie najemcy E. Granica obszaru roboczego.
  ('d6000000-0000-0000-0000-000000000009', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-0000000000e1', 'paid', 30000, 'PLN',
   jsonb_build_object('event_id','d1000000-0000-0000-0000-000000000001',
                      'ticket_type_id','d2000000-0000-0000-0000-000000000001',
                      'registration_id','e4000000-0000-0000-0000-000000000001')),
  -- O10: `registration_id` o ZLYM KSZTALCIE. Rzutowanie bez regexu podnosiloby
  -- 22P02 i wywracalo ksiegowanie wplaty, ktora u operatora JUZ przeszla.
  ('d6000000-0000-0000-0000-000000000010', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'd5000000-0000-0000-0000-000000000003', 'paid', 30000, 'PLN',
   jsonb_build_object('event_id','d1000000-0000-0000-0000-000000000001',
                      'ticket_type_id','d2000000-0000-0000-0000-000000000001',
                      'registration_id','to-nie-jest-uuid'));

-- ---------------------------------------------------------------------------
-- 1) WSKAZANY WIERSZ WYGRYWA Z NAJNOWSZYM
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome(
    'd6000000-0000-0000-0000-000000000001', 'paid');

  PERFORM pg_temp.assert((v->>'applied')::boolean = true,
    'wskazanie: wplata ze wskazanym zgloszeniem jest ksiegowana');
  PERFORM pg_temp.assert(v->>'registration_id' = 'd4000000-0000-0000-0000-000000000001',
    'wskazanie: wplata trafia w WSKAZANY wiersz, a nie w najnowszy tej samej osoby');

  PERFORM pg_temp.assert(
    (SELECT payment_status FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000001') = 'paid',
    'wskazanie: wskazane zgloszenie jest oplacone');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000001') = 'approved',
    'wskazanie: wplata przyjmuje zgloszenie (pending -> approved)');
  PERFORM pg_temp.assert(
    (SELECT qr_token_hash IS NOT NULL FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000001'),
    'wskazanie: DOPIERO teraz powstaje kod QR - to jest wyjscie z bramki 20260828206000');

  -- Drugi bok tej samej asercji: cudzy wiersz ma zostac NIETKNIETY. Bez tego
  -- pierwsza czesc przechodzilaby takze wtedy, gdyby funkcja ksiegowala OBA.
  PERFORM pg_temp.assert(
    (SELECT payment_status FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000002') = 'unpaid',
    'wskazanie: drugie zgloszenie tej samej osoby NIE zostalo ruszone');
  PERFORM pg_temp.assert(
    (SELECT payment_order_id IS NULL FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000002'),
    'wskazanie: drugie zgloszenie nie dostalo cudzego zamowienia');
END $$;

-- ---------------------------------------------------------------------------
-- 2) DWA ZGLOSZENIA TEJ SAMEJ OSOBY - KAZDE DO SWOJEGO
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome(
    'd6000000-0000-0000-0000-000000000002', 'paid');

  PERFORM pg_temp.assert(v->>'registration_id' = 'd4000000-0000-0000-0000-000000000002',
    'rozdzielnosc: drugie zamowienie tej samej osoby ksieguje sie do SWOJEGO zgloszenia');
  PERFORM pg_temp.assert(
    (SELECT payment_status FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000002') = 'paid',
    'rozdzielnosc: drugie zgloszenie jest oplacone');
  -- Pieniadze, ktore przyszly za ODWOLANE zgloszenie, NIE wskrzeszaja go.
  -- Organizator ma zobaczyc „oplacone i odwolane" i zwrocic - a nie wydac
  -- wejsciowke na wiersz, ktorego uczestnik sam sie pozbyl.
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000002') = 'cancelled',
    'rozdzielnosc: wplata NIE wskrzesza odwolanego zgloszenia');
  PERFORM pg_temp.assert(
    (SELECT payment_order_id FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000001')
    = 'd6000000-0000-0000-0000-000000000001',
    'rozdzielnosc: pierwsze zgloszenie nadal wskazuje SWOJE zamowienie');

  -- REGRESJA NA NAPRAWE Z 2026-08-30. Cialo sprzed niej czyscilo `cancelled_at`
  -- BEZWARUNKOWO, a status flipuje sie tylko z `draft/pending/waitlist`.
  -- Wplata na zgloszenie odwolane zostawiala wiec `status = 'cancelled'`
  -- z pustym `cancelled_at` - naruszenie `event_registrations_cancelled_dated`,
  -- czyli wyjatek w calej funkcji, 500 z webhooka i petla ponowien, w ktorej
  -- pieniadze sa pobrane, a zgloszenie nietkniete.
  PERFORM pg_temp.assert(
    (SELECT cancelled_at IS NOT NULL FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000002'),
    'rozdzielnosc: odwolane zgloszenie ZACHOWUJE date odwolania (inaczej wplata wywraca funkcje)');
END $$;

-- ---------------------------------------------------------------------------
-- 3) NIEZGODNOSC TO JAWNA ODMOWA, NIE CICHE ZGADYWANIE
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome(
    'd6000000-0000-0000-0000-000000000003', 'paid');
  PERFORM pg_temp.assert((v->>'applied')::boolean = false,
    'niezgodnosc: zgloszenie z INNEGO wydarzenia nie jest ksiegowane');
  PERFORM pg_temp.assert(v->>'reason' = 'registration_mismatch',
    'niezgodnosc: powod nazywa problem, a nie udaje braku zgloszenia');
  PERFORM pg_temp.assert(
    (SELECT payment_status FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000003') = 'unpaid',
    'niezgodnosc: wskazane zgloszenie zostaje NIETKNIETE');

  -- IZOLACJA NAJEMCOW: wskazanie wiersza obcego najemcy jest tym samym bledem.
  v := public.payments_apply_event_ticket_outcome(
    'd6000000-0000-0000-0000-000000000009', 'paid');
  PERFORM pg_temp.assert(v->>'reason' = 'registration_mismatch',
    'izolacja: zamowienie najemcy D nie ksieguje sie na zgloszeniu najemcy E');
  PERFORM pg_temp.assert(
    (SELECT payment_status FROM public.event_registrations
      WHERE id = 'e4000000-0000-0000-0000-000000000001') = 'unpaid',
    'izolacja: zgloszenie obcego najemcy zostaje NIETKNIETE');

  -- ZLY KSZTALT identyfikatora nie moze wywracac ksiegowania.
  v := public.payments_apply_event_ticket_outcome(
    'd6000000-0000-0000-0000-000000000010', 'paid');
  PERFORM pg_temp.assert(v ? 'applied',
    'ksztalt: nieparsowalny registration_id NIE rzuca wyjatkiem (wplata juz przeszla u operatora)');
END $$;

-- ---------------------------------------------------------------------------
-- 4) SCIEZKA ZAPASOWA PO OSOBIE ZOSTAJE
--
-- Kasa spolecznosci (`EventTicketPurchase` -> cena z wiersza wydarzenia) NIE
-- zna zgloszen etapu 4 i nie ustawia `registration_id`. Zamowienia zalozone
-- przed migracja 20260830090000 tez go nie maja. Gdyby dopasowanie po osobie
-- znikło, ich wplaty przestalyby cokolwiek robic.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome(
    'd6000000-0000-0000-0000-000000000004', 'paid');
  PERFORM pg_temp.assert((v->>'applied')::boolean = true,
    'zapasowa: zamowienie BEZ registration_id nadal sie ksieguje');
  PERFORM pg_temp.assert(v->>'registration_id' = 'd4000000-0000-0000-0000-000000000004',
    'zapasowa: dopasowanie po osobie trafia w jej zgloszenie na tym wydarzeniu');
END $$;

-- ---------------------------------------------------------------------------
-- 5) ZWROT ZWALNIA MIEJSCE I PROMUJE Z REZERWY
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_left integer;
BEGIN
  PERFORM public.payments_apply_event_ticket_outcome(
    'd6000000-0000-0000-0000-000000000005', 'paid');

  v_left := public._event_seats_left(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'd1000000-0000-0000-0000-000000000003',
    'd2000000-0000-0000-0000-000000000003');
  PERFORM pg_temp.assert(v_left = 0,
    'zwrot: przed zwrotem pula jest wyczerpana (pula 1, wolne 0)');

  v := public.payments_apply_event_ticket_outcome(
    'd6000000-0000-0000-0000-000000000005', 'refunded');

  PERFORM pg_temp.assert(
    (SELECT payment_status FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000005') = 'refunded',
    'zwrot: stan platnosci mowi o zwrocie');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000005') = 'cancelled',
    'zwrot: zwrot odwoluje zapis');
  PERFORM pg_temp.assert((v->'waitlist'->>'promoted')::integer = 1,
    'zwrot: zwolnione miejsce promuje DOKLADNIE jednego z rezerwy');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000006') = 'approved',
    'zwrot: pierwszy z kolejki rezerwowej jest przyjety');
END $$;

-- ---------------------------------------------------------------------------
-- 6) PULA WYCZERPANA MIEDZY KASA A WEBHOOKIEM - DEFEKT ZAREJESTROWANY
--
-- CO ZMIERZYLEM, A CZEGO SIE SPODZIEWALEM. Spodziewalem sie NADSPRZEDAZY:
-- `payments_apply_event_ticket_outcome` promuje `pending -> approved`
-- bezwarunkowo, `_event_seats_left` ani `sold_count` nie padaja w jej ciele
-- ANI RAZU. Pomiar pokazal cos INNEGO i gorszego dla kupujacego.
--
-- Ostatnia linia obrony ISTNIEJE: trigger przeliczajacy `sold_count` plus
-- `CONSTRAINT event_ticket_types_sold_within_quota CHECK (quota IS NULL OR
-- sold_count <= quota)` (20260823150000). Pula NIE zostaje wiec przekroczona.
-- Zamiast tego CALA FUNKCJA RZUCA - i to jest defekt:
--
--   * `applyTicketOutcome` (oneTimeFulfilment.server.ts) loguje blad i wraca
--     bez rzucania, wiec webhook konczy sie 200 i operator NIE ponawia:
--     pieniadze pobrane, zgloszenie NIETKNIETE (`pending`, `unpaid`),
--     bez kodu QR, bez zwrotu, bez powiadomienia. Uczestnik ma paragon
--     i nie ma biletu, a organizator nie widzi w panelu niczego niezwyklego;
--   * przy recznym ksiegowaniu organizatora ten sam stan konczy sie gola
--     odmowa bazy na ekranie.
--
-- `refundIfOversold` z `oneTimeFulfilment.server.ts` obsluguje juz ten
-- scenariusz - ale WYLACZNIE dla sciezki `rsvp_event`: wola
-- `assertSeatAvailable`, ktore liczy miejsca WYDARZENIA, a nie pule
-- WEJSCIOWKI z cennika. Sciezka etapu 4 przez nia nie przechodzi.
--
-- DLACZEGO NIE NAPRAWIAM TEGO TUTAJ. Kazde wyjscie jest decyzja o PIENIADZACH
-- KLIENTA, nie refaktorem:
--   (a) rezerwacja miejsca na czas sesji operatora, z wygasnieciem - wraca
--       ryzyko wyczerpania puli przez zgloszenia, ktorych nikt nie oplaci,
--       tylko ograniczone w czasie;
--   (b) swiadoma nadsprzedaz z alertem dla organizatora - sala czasem to
--       zniesie, a odmowa wplaty kosztuje wiecej niz dostawienie krzesla;
--   (c) automatyczny zwrot ostatniej wplaty - rozszerzenie `refundIfOversold`
--       o pule wejsciowki, czyli o `_event_seats_left(tenant, event, ticket)`.
-- Wybor nalezy do wlasciciela produktu. Asercja pilnuje, zeby nie zniknal
-- po cichu ANI zeby nie zostal "naprawiony" zdjeciem ograniczenia z puli.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_raised boolean := false;
  v_err text := '';
  v_approved integer;
  v_second record;
BEGIN
  -- Pierwsza wplata przechodzi i zajmuje jedyne miejsce.
  PERFORM public.payments_apply_event_ticket_outcome(
    'd6000000-0000-0000-0000-000000000007', 'paid');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations
      WHERE id = 'd4000000-0000-0000-0000-000000000007') = 'approved',
    'pula: pierwsza wplata zajmuje jedyne miejsce z puli');
  PERFORM pg_temp.assert(
    public._event_seats_left('dddddddd-dddd-dddd-dddd-dddddddddddd',
                             'd1000000-0000-0000-0000-000000000004',
                             'd2000000-0000-0000-0000-000000000004') = 0,
    'pula: po pierwszej wplacie nie ma juz wolnych miejsc');

  -- Druga wplata za bilet, ktorego pula w miedzyczasie sie wyczerpala.
  BEGIN
    PERFORM public.payments_apply_event_ticket_outcome(
      'd6000000-0000-0000-0000-000000000008', 'paid');
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    v_err := SQLERRM;
  END;

  PERFORM pg_temp.assert_known_defect(
    v_raised,
    'PULA/WPLATA: ksiegowanie wplaty na wyczerpanej puli RZUCA zamiast obsluzyc brak miejsca ('
      || left(v_err, 60) || ')',
    'do rozstrzygniecia: rezerwacja na czas sesji / swiadoma nadsprzedaz z alertem / rozszerzenie refundIfOversold o pule wejsciowki');

  SELECT status, payment_status, qr_token_hash IS NOT NULL AS has_qr
    INTO v_second
  FROM public.event_registrations WHERE id = 'd4000000-0000-0000-0000-000000000008';

  PERFORM pg_temp.assert_known_defect(
    v_second.payment_status = 'unpaid' AND v_second.status = 'pending' AND NOT v_second.has_qr,
    'PULA/WPLATA: po nieudanym ksiegowaniu zgloszenie zostaje "pending/unpaid" - pieniadze sa, biletu nie ma i nikt o tym nie wie',
    'ten sam wybor produktowy, co wyzej');

  -- KONTRAPUNKT, ktory MUSI byc zielony na zawsze: ograniczenie puli dziala.
  -- Gdyby ktos "naprawil" defekt zdejmujac CHECK z `sold_count`, ta asercja
  -- zapali sie na czerwono - i o to chodzi.
  SELECT count(*)::integer INTO v_approved
  FROM public.event_registrations
  WHERE ticket_type_id = 'd2000000-0000-0000-0000-000000000004'
    AND status IN ('approved','attended','no_show');
  PERFORM pg_temp.assert(v_approved = 1,
    'pula: mimo dwoch wplat pula NIE zostala przekroczona (ostatnia linia obrony trzyma)');
END $$;

ROLLBACK;

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants
              WHERE id IN ('dddddddd-dddd-dddd-dddd-dddddddddddd',
                           'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')),
  'sprzatanie: 25_payment_binding nie zostawil ani jednego wiersza');

\echo '== 25 wplata: koniec =='
