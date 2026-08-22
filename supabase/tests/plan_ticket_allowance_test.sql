-- pgTAP: bilet wliczony w plan + bramka biletowa i Chatham House
-- (20260822091000, 20260822092000).
--
-- Finding: `rsvp_event` bramkowało wyłącznie rangę / flagę `pro_briefings`
-- i limit miejsc - o `events.ticket_price_cents` NIE PYTAŁO WCALE. Wydarzenie
-- płatne było więc dostępne za darmo każdemu, kto spełniał próg rangi
-- i wywołał RPC bezpośrednio; jedyną przeszkodą był przycisk w interfejsie,
-- a RPC jest nadane roli `authenticated`. Dopóki ta dziura była otwarta,
-- sprzedawany w katalogu „bilet wliczony w plan" nie miał czego sprzedawać.
--
-- Ten plik przybija komplet reguł puli:
--
--   1. Kształt: `plan_ticket_claims` ma unikalność (user, event) i NIE przyjmuje
--      bezpośredniego INSERT-u od klienta (zapis wyłącznie przez RPC SECURITY
--      DEFINER - inaczej pula byłaby do nabicia jednym POST-em do PostgREST).
--   2. Pula OSOBOWA: próg Członek daje 1 bilet, Pro dziedziczy TEN SAM
--      (MAKSIMUM z warstw, nie suma) - katalog obiecuje jeden, nie dwa.
--   3. Stawki ulgowe: zniżka zamiast biletu (`event_ticket_discount_pct = 50`,
--      `included_event_tickets` nieobecne) - korekta 2.4 audytu.
--   4. Pula ORGANIZACYJNA: Zespół ma 3 bilety NA ORGANIZACJĘ, nie na miejsce,
--      i wyczerpuje się po trzech niezależnie od tego, kto je wziął.
--   5. Miejsce ZAWIESZONE nie czerpie z puli, miejsce w KARENCJI czerpie -
--      ten sam predykat, co `current_membership_tier` (20260729210625).
--   6. Bramka biletowa: bez puli i bez opłaconego zamówienia zapis odrzucony;
--      opłacone zamówienie wchodzi i NIE spala puli.
--   7. Rezygnacja zwraca bilet do puli (`released_at`), wiersz zostaje jako
--      ślad audytowy - ale WYŁĄCZNIE rezygnacja uczestnika. Przeniesienie na
--      listę rezerwową przez serwer bilet ZATRZYMUJE: `promote_event_waitlist`
--      awansuje bez bramki biletowej, więc zwolniony tam bilet oznaczałby
--      darmowe wejście na płatne wydarzenie z nietkniętą pulą.
--   7b. Wiersz z POPRZEDNIEGO roku członkowskiego nie jest darmowym wejściem:
--      licznik puli widzi tylko bieżące okno, więc przeterminowany wiersz musi
--      przejść normalne sprawdzenie puli i zostać przestemplowany.
--   8. Reguła Chatham House: konto bez flagi `chatham_house_events` nie zapisze
--      się i nie dostanie dostępu (`get_event_access` -> `tier_required`).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(28);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Kształt tabeli ──────────────────────────────────────────────────────────
SELECT has_table('public', 'plan_ticket_claims', 'plan_ticket_claims istnieje');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.plan_ticket_claims'::regclass
       AND c.contype = 'u'
       AND c.conkey = ARRAY[
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = 'public.plan_ticket_claims'::regclass AND attname = 'user_id'),
             (SELECT attnum FROM pg_attribute
               WHERE attrelid = 'public.plan_ticket_claims'::regclass AND attname = 'event_id')
           ]::smallint[]
  ),
  'unikalnosc (user_id, event_id) - jeden bilet z puli na wydarzenie, nie dwa'
);

-- Zapis do rejestru puli idzie WYLACZNIE przez RPC SECURITY DEFINER. Polityka
-- INSERT dla roli klienckiej oznaczalaby, ze pule mozna nabic bez zapisu na
-- wydarzenie - benefit rozdawany POST-em do PostgREST.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'plan_ticket_claims'
      AND cmd IN ('INSERT', 'ALL')),
  0,
  'brak polityki INSERT/ALL na plan_ticket_claims - pula nie jest zapisywalna z klienta'
);

-- ── Seed ────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('b1000000-0000-0000-0000-0000000000a1', 'tk-member@tk.test'),
  ('b1000000-0000-0000-0000-0000000000a2', 'tk-pro@tk.test'),
  ('b1000000-0000-0000-0000-0000000000a3', 'tk-student@tk.test'),
  ('b1000000-0000-0000-0000-0000000000b1', 'tk-seat-active@tk.test'),
  ('b1000000-0000-0000-0000-0000000000b2', 'tk-seat-grace@tk.test'),
  ('b1000000-0000-0000-0000-0000000000b3', 'tk-seat-susp@tk.test'),
  ('b1000000-0000-0000-0000-0000000000b4', 'tk-seat-second@tk.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT u.id, u.email, split_part(u.email, '@', 1), (SELECT public.public_tenant_id())
  FROM auth.users u
 WHERE u.email LIKE 'tk-%@tk.test';

INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key) VALUES
  ('b1222222-0000-0000-0000-000000000001', (SELECT public.public_tenant_id()),
   'Czlonek (tk)', 'Member (tk)', 3900, 'PLN', 'month', 'member'),
  ('b1222222-0000-0000-0000-000000000002', (SELECT public.public_tenant_id()),
   'Pro (tk)', 'Pro (tk)', 11900, 'PLN', 'month', 'pro'),
  ('b1222222-0000-0000-0000-000000000003', (SELECT public.public_tenant_id()),
   'Student (tk)', 'Student (tk)', 1900, 'PLN', 'month', 'student'),
  ('b1222222-0000-0000-0000-000000000004', (SELECT public.public_tenant_id()),
   'Zespol (tk)', 'Team (tk)', 8900, 'PLN', 'month', 'team');

INSERT INTO public.user_subscriptions (user_id, plan_id, tenant_id, status, current_period_end) VALUES
  ('b1000000-0000-0000-0000-0000000000a1', 'b1222222-0000-0000-0000-000000000001',
   (SELECT public.public_tenant_id()), 'active', now() + interval '30 days'),
  ('b1000000-0000-0000-0000-0000000000a2', 'b1222222-0000-0000-0000-000000000002',
   (SELECT public.public_tenant_id()), 'active', now() + interval '30 days'),
  ('b1000000-0000-0000-0000-0000000000a3', 'b1222222-0000-0000-0000-000000000003',
   (SELECT public.public_tenant_id()), 'active', now() + interval '30 days');

INSERT INTO public.user_subscriptions (user_id, plan_id, tenant_id, status, current_period_end)
SELECT p.id, 'b1222222-0000-0000-0000-000000000004', (SELECT public.public_tenant_id()),
       'active', now() + interval '30 days'
  FROM public.profiles p
 WHERE p.email IN ('tk-seat-active@tk.test', 'tk-seat-grace@tk.test',
                   'tk-seat-susp@tk.test', 'tk-seat-second@tk.test');

-- Jedna organizacja, cztery miejsca w trzech stanach.
INSERT INTO public.member_organizations (id, tenant_id, name, tier_key, seats_limit) VALUES
  ('b1333333-0000-0000-0000-000000000001', (SELECT public.public_tenant_id()),
   'Organizacja testowa (tk)', 'team', 20);

INSERT INTO public.organization_seats (tenant_id, org_id, invited_email, user_id, status, grace_until) VALUES
  ((SELECT public.public_tenant_id()), 'b1333333-0000-0000-0000-000000000001',
   'tk-seat-active@tk.test', 'b1000000-0000-0000-0000-0000000000b1', 'active', NULL),
  ((SELECT public.public_tenant_id()), 'b1333333-0000-0000-0000-000000000001',
   'tk-seat-grace@tk.test', 'b1000000-0000-0000-0000-0000000000b2', 'grace', now() + interval '3 days'),
  ((SELECT public.public_tenant_id()), 'b1333333-0000-0000-0000-000000000001',
   'tk-seat-susp@tk.test', 'b1000000-0000-0000-0000-0000000000b3', 'suspended', NULL),
  ((SELECT public.public_tenant_id()), 'b1333333-0000-0000-0000-000000000001',
   'tk-seat-second@tk.test', 'b1000000-0000-0000-0000-0000000000b4', 'active', NULL);

-- Cztery wydarzenia biletowane + jedno w regule Chatham House.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, kind, starts_at, visibility, min_tier_rank, status, ticket_price_cents) VALUES
  ('b1444444-0000-0000-0000-000000000001', (SELECT public.public_tenant_id()),
   'tk-e1', 'Konferencja 1', 'Conference 1', 'in_person', now() + interval '30 days', 'public', 0, 'published', 30000),
  ('b1444444-0000-0000-0000-000000000002', (SELECT public.public_tenant_id()),
   'tk-e2', 'Konferencja 2', 'Conference 2', 'in_person', now() + interval '40 days', 'public', 0, 'published', 30000),
  ('b1444444-0000-0000-0000-000000000003', (SELECT public.public_tenant_id()),
   'tk-e3', 'Konferencja 3', 'Conference 3', 'in_person', now() + interval '50 days', 'public', 0, 'published', 30000),
  ('b1444444-0000-0000-0000-000000000004', (SELECT public.public_tenant_id()),
   'tk-e4', 'Konferencja 4', 'Conference 4', 'in_person', now() + interval '60 days', 'public', 0, 'published', 30000);

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, kind, starts_at, visibility, min_tier_rank, status, chatham_house) VALUES
  ('b1444444-0000-0000-0000-0000000000c1', (SELECT public.public_tenant_id()),
   'tk-ch', 'Okragly stol', 'Roundtable', 'roundtable', now() + interval '30 days', 'public', 0, 'published', true);

-- ── 2. Pula osobowa: Czlonek ────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (public.my_ticket_allowance() ->> 'granted')::int, 1,
  'prog Czlonek: 1 wliczony bilet rocznie'
);
SELECT is(
  public.my_ticket_allowance() ->> 'scope', 'personal',
  'pula Czlonka jest OSOBOWA'
);

-- ── 3. Pro dziedziczy TEN SAM bilet, nie drugi ──────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (public.my_ticket_allowance() ->> 'granted')::int, 1,
  'prog Pro dziedziczy bilet po Czlonku i NIE dostaje drugiego (MAKSIMUM z warstw, nie suma)'
);

-- ── 4. Stawka ulgowa: znizka zamiast biletu ─────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  ARRAY[(public.my_ticket_allowance() ->> 'granted')::int,
        (public.my_ticket_allowance() ->> 'discount_pct')::int],
  ARRAY[0, 50],
  'stawka studencka: zero biletow, znizka 50% (korekta 2.4 audytu - bilet za 300 zl przy skladce 190 zl/rok)'
);

-- ── 6. Bramka biletowa: bez biletu ani rusz ─────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000001', 'going') $$,
  'P0001',
  'events: ticket required',
  'wydarzenie biletowane odrzuca zapis bez puli i bez oplaconego zamowienia (dziura sprzed 20260822091000)'
);

-- ── Czlonek: bilet z puli wchodzi, drugi juz nie ────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000001', 'going') $$,
  'Czlonek wchodzi na wydarzenie biletowane biletem z puli'
);

SELECT is(
  (public.my_ticket_allowance() ->> 'remaining')::int, 0,
  'pula Czlonka wyczerpana po jednym bilecie'
);

SELECT throws_ok(
  $$ SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000002', 'going') $$,
  'P0001',
  'events: ticket required',
  'drugie wydarzenie w tym samym roku czlonkowskim - pula pusta, zapis odrzucony'
);

-- ── 7. Rezygnacja zwraca bilet do puli ──────────────────────────────────────
SELECT lives_ok(
  $$ SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000001', 'cancelled') $$,
  'rezygnacja z udzialu przechodzi'
);

SELECT is(
  (public.my_ticket_allowance() ->> 'remaining')::int, 1,
  'bilet wraca do puli po rezygnacji - jedno omylkowe klikniecie nie kasuje rocznego benefitu'
);

SELECT is(
  (SELECT count(*)::int FROM public.plan_ticket_claims c
    WHERE c.user_id = 'b1000000-0000-0000-0000-0000000000a1'
      AND c.event_id = 'b1444444-0000-0000-0000-000000000001'
      AND c.released_at IS NOT NULL),
  1,
  'zwolniony wiersz ZOSTAJE ze stemplem released_at - slad audytowy, nie kasowanie'
);

-- ── 6b. Oplacone zamowienie wchodzi i NIE spala puli ────────────────────────
-- Zamowienie od razu w stanie `paid` zaklada WYLACZNIE service_role
-- (`payment_orders_guard_status`) - w produkcji robi to webhook operatora.
RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders (user_id, status, kind, amount_cents, currency, metadata)
VALUES ('b1000000-0000-0000-0000-0000000000a1', 'paid', 'one_time', 30000, 'PLN',
        jsonb_build_object('event_id', 'b1444444-0000-0000-0000-000000000003'));
SELECT set_config('request.jwt.claim.role', '', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000003', 'going') $$,
  'oplacone zamowienie otwiera wejscie bez siegania do puli'
);

SELECT is(
  (public.my_ticket_allowance() ->> 'remaining')::int, 1,
  'zakup biletu NIE spala puli wliczonej w plan'
);

-- ── 5. Miejsce zawieszone vs karencja ───────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);

SELECT is(
  (public.my_ticket_allowance() ->> 'granted')::int, 0,
  'miejsce ZAWIESZONE nie czerpie z puli organizacji (ten sam predykat, co current_membership_tier)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

SELECT is(
  ARRAY[(public.my_ticket_allowance() ->> 'granted')::int,
        (public.my_ticket_allowance() ->> 'used')::int],
  ARRAY[3, 0],
  'miejsce w KARENCJI czerpie z puli organizacji do konca karencji'
);

-- ── 4b. Pula organizacyjna jest WSPOLNA i konczy sie po trzech ──────────────
SELECT lives_ok(
  $$ SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000001', 'going') $$,
  'pierwsze miejsce bierze bilet z puli organizacji'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000002', 'going');
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000b4","role":"authenticated"}', true);
SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000003', 'going');

-- Czwarty czlonek tej samej organizacji: pula wyczerpana. To jest dokladnie
-- korekta 2.4 audytu - v6.1 dawala bilet NA KAZDE MIEJSCE, czyli przy dwudziestu
-- miejscach oddawala do polowy przychodu progu.
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000004', 'going') $$,
  'P0001',
  'events: ticket required',
  'czwarty bilet z puli organizacji odrzucony - pula jest NA ORGANIZACJE (3), nie na miejsce'
);

-- ── 7a. Lista rezerwowa ZATRZYMUJE bilet ────────────────────────────────────
-- `promote_event_waitlist` awansuje z `waitlist` na `going` BEZ bramki
-- biletowej - bramka stoi w `rsvp_event`, nie w awansie. Gdyby degradacja na
-- liste rezerwowa zwalniala bilet, kazdy awans byl by darmowym wejsciem na
-- platne wydarzenie z nietknieta pula. Miejsce w kolejce to REZERWACJA
-- oplacona biletem.
RESET ROLE;
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, kind, starts_at,
                           visibility, min_tier_rank, status, ticket_price_cents, capacity)
VALUES ('b1444444-0000-0000-0000-0000000000d1', (SELECT public.public_tenant_id()),
        'tk-e5', 'Konferencja 5', 'Conference 5', 'in_person', now() + interval '70 days',
        'public', 0, 'published', 30000, 1);

-- Jedyne miejsce zajmuje konto z oplaconym zamowieniem (stawka studencka nie ma
-- puli, wiec nie miesza w licznikach).
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders (user_id, status, kind, amount_cents, currency, metadata)
VALUES ('b1000000-0000-0000-0000-0000000000a3', 'paid', 'one_time', 30000, 'PLN',
        jsonb_build_object('event_id', 'b1444444-0000-0000-0000-0000000000d1'));
SELECT set_config('request.jwt.claim.role', '', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
SELECT public.rsvp_event('b1444444-0000-0000-0000-0000000000d1', 'going');

-- Czlonek ma jeden bilet w puli (wykorzystany na e1 wrocil po rezygnacji,
-- e3 poszlo z oplaconego zamowienia).
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  public.rsvp_event('b1444444-0000-0000-0000-0000000000d1', 'going') ->> 'status',
  'waitlist',
  'komplet miejsc przenosi na liste rezerwowa'
);

SELECT is(
  (public.my_ticket_allowance() ->> 'remaining')::int, 0,
  'bilet ZOSTAJE przy miejscu w kolejce - degradacja serwera to nie rezygnacja uczestnika'
);

-- Zwolnienie miejsca uruchamia awans (rsvp_event wola promote_event_waitlist).
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
SELECT public.rsvp_event('b1444444-0000-0000-0000-0000000000d1', 'cancelled');

SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT er.status FROM public.event_rsvps er
    WHERE er.event_id = 'b1444444-0000-0000-0000-0000000000d1'
      AND er.user_id = 'b1000000-0000-0000-0000-0000000000a1'),
  'going',
  'awans z listy rezerwowej daje miejsce'
);

SELECT is(
  (public.my_ticket_allowance() ->> 'remaining')::int, 0,
  'awansowany wchodzi na SWOIM bilecie, a nie za darmo z nietknieta pula'
);

-- ── 7b. Wiersz sprzed rocznicy nie jest darmowym wejsciem ───────────────────
-- Licznik `my_ticket_allowance` liczy wylacznie wiersze, ktorych okno obejmuje
-- dzis. Wiersz z poprzedniego roku czlonkowskiego jest dla niego niewidzialny,
-- wiec samo zdjecie `released_at` dawaloby wejscie, ktorego pula nie widzi.
RESET ROLE;
UPDATE public.plan_ticket_claims
   SET period_start = period_start - interval '1 year',
       period_end   = period_end   - interval '1 year'
 WHERE user_id = 'b1000000-0000-0000-0000-0000000000a1'
   AND event_id = 'b1444444-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000001', 'going') $$,
  'P0001',
  'events: ticket required',
  'zwolniony wiersz sprzed rocznicy NIE otwiera wejscia przy wyczerpanej puli'
);

-- Po zwolnieniu biezacego biletu ten sam zapis przechodzi, a wiersz dostaje
-- stempel BIEZACEGO okna - inaczej pula dalej by go nie liczyla.
SELECT public.rsvp_event('b1444444-0000-0000-0000-0000000000d1', 'cancelled');
SELECT public.rsvp_event('b1444444-0000-0000-0000-000000000001', 'going');

SELECT is(
  (SELECT count(*)::int FROM public.plan_ticket_claims c
    WHERE c.user_id = 'b1000000-0000-0000-0000-0000000000a1'
      AND c.event_id = 'b1444444-0000-0000-0000-000000000001'
      AND c.released_at IS NULL
      AND c.period_start <= CURRENT_DATE
      AND c.period_end > CURRENT_DATE),
  1,
  'ponowne wyjecie biletu przestemplowuje wiersz biezacym oknem roku czlonkowskiego'
);

-- ── 8. Regula Chatham House ─────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b1000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT a.reason FROM public.get_event_access('b1444444-0000-0000-0000-0000000000c1') a),
  'tier_required',
  'get_event_access: spotkanie w regule Chatham House zamkniete dla konta bez flagi chatham_house_events'
);

SELECT throws_ok(
  $$ SELECT public.rsvp_event('b1444444-0000-0000-0000-0000000000c1', 'going') $$,
  'P0001',
  'events: chatham house membership required',
  'rsvp_event mowi to samo co get_event_access - zapis nie omija bramki odczytu'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
