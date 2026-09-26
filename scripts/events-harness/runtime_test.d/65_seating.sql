-- ============================================================================
-- 65_seating - PLAN SALI Z PRZYDZIALEM MIEJSC (migracja 20260926130000)
--
-- PO CO TEN PLIK ISTNIEJE
-- Plan sali stoi na gwarancjach, ktorych nie da sie potwierdzic czytaniem SQL-a
-- jako tekstu: dwa indeksy czesciowe (jedno aktywne miejsce na zgloszenie
-- w planie, jeden aktywny posiadacz miejsca), trzy triggery (walidacja
-- przydzialu, straznik usuwania/blokady miejsca, zwolnienie po zmianie statusu
-- zgloszenia), regeneracja miejsc po kluczu naturalnym, reguly rezerwacji dla
-- firmy CRM / sponsora / pakietu i dwie plaszczyzny uczestnika, ktore nie moga
-- wypuscic cudzych danych. Kazda obietnica ma tu dowod z oboma bokami.
--
-- CZEGO TU DOWODZIMY
--   (a) geometria SQL = zloty wzorzec (ten sam blok czyta test parytetu
--       `src/lib/events/__tests__/seatingGeometryParity.test.ts`);
--   (b) plany, kategorie, sekcje: zapis, walidacje i kazdy kod odmowy;
--   (c) rezerwacje i blokady + wpis osi czasu CRM firmy;
--   (d) przydzial: rezerwacje, kategorie vs bilet, przeniesienie, zamiana,
--       force, zajete miejsce, statusy zgloszen;
--   (e) gwarancje bazy golym INSERT-em/UPDATE-em/DELETE-em (indeksy, triggery,
--       klucze zlozone miedzy najemcami);
--   (f) przydzial zbiorczy z odrzutami per pozycja, zwolnienie, blokada z
--       zwolnieniem;
--   (g) odczyty panelu (lista, szczegol, kandydaci, lookup, eksport per firma);
--   (h) edycja sekcji: przesuniecie, zmniejszenie z historia, odmowa usuniecia
--       zajetych, usuwanie sekcji i kategorii;
--   (i) zwolnienie przy anulowaniu zgloszenia;
--   (j) plaszczyzna uczestnika: tylko plany opublikowane, tylko wlasne miejsce,
--       strona biletu po skrocie kodu, bez rozrozniania przyczyny odmowy;
--   (k) izolacja najemcow, odmowy rol (redaktor, zwykly uzytkownik, anonim),
--       granty, RLS;
--   (l) kaskady: usuniecie planu, wydarzenia, firmy CRM;
--   (m) zdarzenia domenowe faktycznie zapisane.
--
-- CZEGO NIE SPRAWDZA: wspolbieznosci dwoch sesji (blokada planu i indeksy sa
-- sprawdzane sekwencyjnie), wysylki poczty (plan nie wysyla maili).
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 65 plan sali: miejsca, przydzialy, rezerwacje, uczestnik =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('65000000-0000-0000-0000-0000000000b0', 'Tenant 65 B', 't65b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('65a00000-0000-0000-0000-0000000000a1', 'plan.admin@example.org'),
  ('65a00000-0000-0000-0000-0000000000a2', 'plan.redaktor@example.org'),
  ('65a00000-0000-0000-0000-0000000000a3', 'plan.uzytkownik@example.org'),
  ('65a00000-0000-0000-0000-0000000000a4', 'plan.uczestniczka@example.org'),
  ('65a00000-0000-0000-0000-0000000000a5', 'plan.super@example.org'),
  ('65a00000-0000-0000-0000-0000000000b1', 'plan.admin.b@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('65a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111'),
  ('65a00000-0000-0000-0000-0000000000a2', 'editor', '11111111-1111-1111-1111-111111111111'),
  ('65a00000-0000-0000-0000-0000000000a5', 'super_admin', '11111111-1111-1111-1111-111111111111'),
  ('65a00000-0000-0000-0000-0000000000b1', 'admin', '65000000-0000-0000-0000-0000000000b0')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('65a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 65', 'plan-admin'),
  ('65a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Redaktor 65', 'plan-redaktor'),
  ('65a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Uzytkownik 65', 'plan-uzytkownik'),
  ('65a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'Uczestniczka 65', 'plan-uczestniczka'),
  ('65a00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'Super 65', 'plan-super'),
  ('65a00000-0000-0000-0000-0000000000b1', '65000000-0000-0000-0000-0000000000b0', 'Admin 65 B', 'plan-admin-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('65e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'plan-65', 'Gala 65', 'Gala 65 EN', now() + interval '20 days', 'published'),
  ('65e00000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
   'plan-65-druga', 'Druga 65', 'Second 65', now() + interval '25 days', 'published'),
  ('65e00000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111',
   'plan-65-kaskada', 'Kaskada 65', 'Cascade 65', now() + interval '30 days', 'draft'),
  ('65e00000-0000-0000-0000-0000000000eb', '65000000-0000-0000-0000-0000000000b0',
   'plan-65-b', 'Obca 65', 'Foreign 65', now() + interval '20 days', 'published')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_rooms (id, tenant_id, event_id, name, capacity, floor, location_note) VALUES
  ('65100000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '65e00000-0000-0000-0000-0000000000e1', 'Sala 65', 300, 'Parter', 'Wejscie od dziedzinca'),
  ('65100000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '65e00000-0000-0000-0000-0000000000e2', 'Sala obca 65', 50, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sessions (
  id, tenant_id, event_id, room_id, title_pl, title_en, starts_at, ends_at, status
) VALUES (
  '65200000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
  '65e00000-0000-0000-0000-0000000000e1', '65100000-0000-0000-0000-0000000000a1',
  'Kolacja galowa', 'Gala dinner', now() + interval '20 days', now() + interval '20 days 3 hours', 'published'
), (
  '65200000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
  '65e00000-0000-0000-0000-0000000000e2', NULL,
  'Sesja obca', 'Foreign session', now() + interval '25 days', now() + interval '25 days 1 hour', 'published'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('65c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Firma C1 65'),
  ('65c00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 'Sponsor C2 65'),
  ('65c00000-0000-0000-0000-0000000000c3', '11111111-1111-1111-1111-111111111111', 'Ulotna C3 65'),
  ('65c00000-0000-0000-0000-0000000000cb', '65000000-0000-0000-0000-0000000000b0', 'Obca CB 65')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en) VALUES
  ('65300000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '65e00000-0000-0000-0000-0000000000e1', 'standard', 'Standard', 'Standard'),
  ('65300000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '65e00000-0000-0000-0000-0000000000e1', 'vip', 'VIP', 'VIP'),
  ('65300000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '65e00000-0000-0000-0000-0000000000e2', 'standard', 'Standard 2', 'Standard 2')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sponsors (id, tenant_id, event_id, company_id, snapshot_name) VALUES
  ('65400000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '65e00000-0000-0000-0000-0000000000e1', '65c00000-0000-0000-0000-0000000000c2', 'Sponsor C2 65')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_ticket_packages (id, tenant_id, event_id, key, name_pl, name_en, seats, ticket_type_id) VALUES
  ('65500000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '65e00000-0000-0000-0000-0000000000e1', 'pakiet_firmowy', 'Pakiet firmowy', 'Company pack', 5,
   '65300000-0000-0000-0000-0000000000a1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_package_orders (id, tenant_id, event_id, package_id, buyer_email, buyer_name, company_id, seats_total) VALUES
  ('65600000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '65e00000-0000-0000-0000-0000000000e1', '65500000-0000-0000-0000-0000000000a1',
   'kupiec@example.org', 'Kupiec Pakietu', '65c00000-0000-0000-0000-0000000000c1', 5)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, company_id, company_text, user_id, source) VALUES
  ('65f00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'anna@example.org', 'Anna', 'Kowalska', '65c00000-0000-0000-0000-0000000000c1', NULL, NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'bartosz@example.org', 'Bartosz', 'Kowalski', '65c00000-0000-0000-0000-0000000000c1', NULL, NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'celina@example.org', 'Celina', 'Nowak', '65c00000-0000-0000-0000-0000000000c2', 'Sponsor Tekstem', NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'dawid@example.org', 'Dawid', 'Oczekujacy', NULL, NULL, NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'ewa@example.org', 'Ewa', 'Pakietowa', NULL, NULL, NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'filip@example.org', 'Filip', 'Obecny', NULL, NULL, NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'gosia@example.org', 'Gosia', 'Anulowana', NULL, NULL, NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'hanna@example.org', 'Hanna', 'Uczestniczka', NULL, NULL, '65a00000-0000-0000-0000-0000000000a4', 'self_registration'),
  ('65f00000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'igor@example.org', 'Igor', 'Inny', NULL, NULL, NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'jan@example.org', 'Jan', 'Bezmiejsca', NULL, NULL, NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'karol@example.org', 'Karol', 'Stolik', NULL, NULL, NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'lena@example.org', 'Lena', 'Kaskada', NULL, NULL, NULL, 'self_registration'),
  ('65f00000-0000-0000-0000-0000000000b1', '65000000-0000-0000-0000-0000000000b0', 'obcy@example.org', 'Obcy', 'Najemca', NULL, NULL, NULL, 'self_registration')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, group_lead_registration_id, attended_at, cancelled_at) VALUES
  ('65900000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', '65f00000-0000-0000-0000-000000000001', '65300000-0000-0000-0000-0000000000a1', 'approved', 'rsvp', NULL, NULL, NULL),
  ('65900000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', '65f00000-0000-0000-0000-000000000002', '65300000-0000-0000-0000-0000000000a1', 'approved', 'rsvp', '65900000-0000-0000-0000-000000000001', NULL, NULL),
  ('65900000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', '65f00000-0000-0000-0000-000000000003', '65300000-0000-0000-0000-0000000000a2', 'approved', 'rsvp', NULL, NULL, NULL),
  ('65900000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', '65f00000-0000-0000-0000-000000000004', '65300000-0000-0000-0000-0000000000a1', 'pending', 'rsvp', NULL, NULL, NULL),
  ('65900000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', '65f00000-0000-0000-0000-000000000005', '65300000-0000-0000-0000-0000000000a1', 'approved', 'rsvp', NULL, NULL, NULL),
  ('65900000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', '65f00000-0000-0000-0000-000000000006', '65300000-0000-0000-0000-0000000000a2', 'attended', 'rsvp', NULL, now(), NULL),
  ('65900000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', '65f00000-0000-0000-0000-000000000007', '65300000-0000-0000-0000-0000000000a1', 'cancelled', 'rsvp', NULL, NULL, now()),
  ('65900000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', '65f00000-0000-0000-0000-000000000008', '65300000-0000-0000-0000-0000000000a1', 'approved', 'rsvp', NULL, NULL, NULL),
  ('65900000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e2', '65f00000-0000-0000-0000-000000000009', '65300000-0000-0000-0000-0000000000a3', 'approved', 'rsvp', NULL, NULL, NULL),
  ('65900000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', '65f00000-0000-0000-0000-000000000010', '65300000-0000-0000-0000-0000000000a1', 'approved', 'rsvp', NULL, NULL, NULL),
  ('65900000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', '65f00000-0000-0000-0000-000000000011', '65300000-0000-0000-0000-0000000000a1', 'approved', 'rsvp', NULL, NULL, NULL),
  ('65900000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e3', '65f00000-0000-0000-0000-000000000012', NULL, 'approved', 'rsvp', NULL, NULL, NULL),
  ('65900000-0000-0000-0000-0000000000b1', '65000000-0000-0000-0000-0000000000b0', '65e00000-0000-0000-0000-0000000000eb', '65f00000-0000-0000-0000-0000000000b1', NULL, 'approved', 'rsvp', NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Klucz samoobslugi i kod QR uczestniczki - baza trzyma wylacznie skroty.
UPDATE public.event_registrations
   SET manage_token_hash = encode(digest('mg65mg65mg65mg65mg65mg65mg65mg65', 'sha256'), 'hex'),
       qr_token_hash = encode(digest('qr65qr65qr65qr65qr65qr65qr65qr65', 'sha256'), 'hex'),
       qr_issued_at = now()
 WHERE id = '65900000-0000-0000-0000-000000000008';

INSERT INTO public.event_package_seats (tenant_id, event_id, package_order_id, registration_id, assigned_at) VALUES
  ('11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1',
   '65600000-0000-0000-0000-0000000000a1', '65900000-0000-0000-0000-000000000005', now());

-- Pomocnicy pliku: zapisane identyfikatory, SQL wywolania RPC z payloadem
-- i odszukanie miejsca po kluczu naturalnym.
CREATE TEMP TABLE t65 (k text PRIMARY KEY, v uuid NOT NULL);

CREATE OR REPLACE FUNCTION pg_temp.v65(_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v FROM t65 WHERE k = _k $$;

CREATE OR REPLACE FUNCTION pg_temp.q65(_fn text, _payload jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT format('SELECT public.%I(%L::jsonb)', _fn, _payload) $$;

CREATE OR REPLACE FUNCTION pg_temp.seat65(_section uuid, _row text, _num integer) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT s.id FROM public.event_seats s
   WHERE s.section_id = _section AND COALESCE(s.row_label, '') = COALESCE(_row, '') AND s.seat_number = _num
$$;

CREATE OR REPLACE FUNCTION pg_temp.active65(_reg uuid, _map uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT a.seat_id FROM public.event_seat_assignments a
   WHERE a.registration_id = _reg AND a.map_id = _map AND a.released_at IS NULL
$$;

-- ---------------------------------------------------------------------------
-- SEKCJA 2: GEOMETRIA - ZLOTY WZORZEC
--
-- Blok miedzy znacznikami czyta `seatingGeometryParity.test.ts`: bierze
-- argumenty kazdego wywolania `_event_seat_section_layout(...)` i oczekiwana
-- tablice, liczy to samo w `generateSectionSeats()` i porownuje. Jedna zmiana
-- formuly po ktorejkolwiek stronie czerwieni jedna z dwoch bramek.
-- Format wiersza: rzad|numer|x|y|sort_key ("-" = brak rzedu).
-- ---------------------------------------------------------------------------
-- GEOMETRY-GOLDEN-BEGIN
SELECT pg_temp.assert(
  (SELECT array_agg(format('%s|%s|%s|%s|%s', COALESCE(g.row_label, '-'), g.seat_number, g.x, g.y, g.sort_key) ORDER BY g.sort_key)
     FROM public._event_seat_section_layout('rows', 2, 5, 'alpha', 1, 'odd_even', 1, 50, 60, ARRAY[2], NULL, NULL) AS g)
  = ARRAY['A|5|0.00|0.00|0', 'A|3|50.00|0.00|1', 'A|1|150.00|0.00|2', 'A|2|200.00|0.00|3', 'A|4|250.00|0.00|4',
          'B|5|0.00|60.00|1000', 'B|3|50.00|60.00|1001', 'B|1|150.00|60.00|1002', 'B|2|200.00|60.00|1003', 'B|4|250.00|60.00|1004'],
  '65/geometria: rzedy od srodka (odd_even) z przejsciem po 2. miejscu');
SELECT pg_temp.assert(
  (SELECT array_agg(format('%s|%s|%s|%s|%s', COALESCE(g.row_label, '-'), g.seat_number, g.x, g.y, g.sort_key) ORDER BY g.sort_key)
     FROM public._event_seat_section_layout('rows', 1, 3, 'numeric', 5, 'rtl', 10, 45.5, 60, ARRAY[]::integer[], NULL, NULL) AS g)
  = ARRAY['5|12|0.00|0.00|0', '5|11|45.50|0.00|1', '5|10|91.00|0.00|2'],
  '65/geometria: rzad numeryczny od 5, numeracja od prawej od 10, rozstaw 45.5');
SELECT pg_temp.assert(
  (SELECT array_agg(format('%s|%s|%s|%s|%s', COALESCE(g.row_label, '-'), g.seat_number, g.x, g.y, g.sort_key) ORDER BY g.sort_key)
     FROM public._event_seat_section_layout('rows', 2, 2, 'alpha', 26, 'ltr', 1, 50, 70, ARRAY[1], NULL, NULL) AS g)
  = ARRAY['Z|1|0.00|0.00|0', 'Z|2|100.00|0.00|1', 'AA|1|0.00|70.00|1000', 'AA|2|100.00|70.00|1001'],
  '65/geometria: etykiety alfabetyczne przechodza z Z na AA');
SELECT pg_temp.assert(
  (SELECT array_agg(format('%s|%s|%s|%s|%s', COALESCE(g.row_label, '-'), g.seat_number, g.x, g.y, g.sort_key) ORDER BY g.sort_key)
     FROM public._event_seat_section_layout('table', NULL, NULL, NULL, 1, NULL, 1, 50, 60, ARRAY[]::integer[], 'round', 8) AS g)
  = ARRAY['-|1|0.00|-64.00|0', '-|2|45.25|-45.25|1', '-|3|64.00|0.00|2', '-|4|45.25|45.25|3',
          '-|5|0.00|64.00|4', '-|6|-45.25|45.25|5', '-|7|-64.00|0.00|6', '-|8|-45.25|-45.25|7'],
  '65/geometria: stol okragly 8 miejsc, promien 64, start u gory');
SELECT pg_temp.assert(
  (SELECT array_agg(format('%s|%s|%s|%s|%s', COALESCE(g.row_label, '-'), g.seat_number, g.x, g.y, g.sort_key) ORDER BY g.sort_key)
     FROM public._event_seat_section_layout('table', NULL, NULL, NULL, 1, NULL, 1, 50, 60, ARRAY[]::integer[], 'round', 1) AS g)
  = ARRAY['-|1|0.00|-50.00|0'],
  '65/geometria: stol okragly 1 miejsce - promien nie mniejszy niz rozstaw');
SELECT pg_temp.assert(
  (SELECT array_agg(format('%s|%s|%s|%s|%s', COALESCE(g.row_label, '-'), g.seat_number, g.x, g.y, g.sort_key) ORDER BY g.sort_key)
     FROM public._event_seat_section_layout('table', NULL, NULL, NULL, 1, NULL, 3, 50, 60, ARRAY[]::integer[], 'rect', 5) AS g)
  = ARRAY['-|3|0.00|0.00|0', '-|4|50.00|0.00|1', '-|5|100.00|0.00|2', '-|6|100.00|60.00|3', '-|7|50.00|60.00|4'],
  '65/geometria: stol prostokatny 5 miejsc, obieg zgodny z ruchem wskazowek');
-- GEOMETRY-GOLDEN-END

SELECT pg_temp.assert(
  public._event_seat_label('A', 'rows', 'C', 12) = 'A / C / 12'
  AND public._event_seat_label('Stol 5', 'table', NULL, 3) = 'Stol 5 / 3',
  '65/etykieta migawki: sekcja / rzad / numer albo stol / numer');

-- ---------------------------------------------------------------------------
-- SEKCJA 3: PLANY - ZAPIS I WALIDACJE
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

INSERT INTO t65 SELECT 'm1', public.admin_event_seat_map_save(jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', ' Gala 65 ',
  'room_id', '65100000-0000-0000-0000-0000000000a1', 'session_id', '65200000-0000-0000-0000-0000000000a1',
  'width', 1600, 'height', 900, 'stage', jsonb_build_object('x', 500, 'y', 20, 'w', 600, 'h', 80)));
INSERT INTO t65 SELECT 'm2', public.admin_event_seat_map_save(jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', 'Sala B 65'));

SELECT pg_temp.assert(
  (SELECT m.name = 'Gala 65' AND m.status = 'draft' AND m.published_at IS NULL AND m.width = 1600
          AND m.stage_w = 600 AND m.room_id = '65100000-0000-0000-0000-0000000000a1'
          AND m.created_by = '65a00000-0000-0000-0000-0000000000a1'
     FROM public.event_seat_maps m WHERE m.id = pg_temp.v65('m1')),
  '65/plan: utworzony jako szkic, nazwa przycieta, sala, sesja, scena, autor');
SELECT pg_temp.assert(
  (SELECT m.width = 1200 AND m.height = 800 AND m.stage_x IS NULL AND m.room_id IS NULL
     FROM public.event_seat_maps m WHERE m.id = pg_temp.v65('m2')),
  '65/plan: domyslny rozmiar 1200x800, bez sceny i sali');

SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', 'gala 65')), 'name_taken', '65/plan: nazwa zajeta bez wzgledu na wielkosc liter');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', '   ')), 'invalid_name', '65/plan: pusta nazwa');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', 'X', 'width', 100)), 'invalid_size', '65/plan: za maly rozmiar');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', 'X', 'room_id', '65100000-0000-0000-0000-0000000000a2')),
  'room_not_found', '65/plan: sala innego wydarzenia');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', 'X', 'session_id', '65200000-0000-0000-0000-0000000000a2')),
  'session_not_found', '65/plan: sesja innego wydarzenia');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', 'X', 'stage', jsonb_build_object('x', 1100, 'y', 0, 'w', 200, 'h', 50))),
  'invalid_stage', '65/plan: scena wystaje poza plan');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', 'X', 'status', 'archived')),
  'invalid_status', '65/plan: nieznany status');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object('name', 'X')),
  'invalid_event', '65/plan: bez wydarzenia');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000eb', 'name', 'X')), 'not_found', '65/plan: wydarzenie obcego najemcy');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object(
  'id', '65000000-0000-0000-0000-00000000dead', 'name', 'X')), 'not_found', '65/plan: edycja nieistniejacego');

-- Brak klucza = bez zmian; null = wyczysc.
SELECT public.admin_event_seat_map_save(jsonb_build_object('id', pg_temp.v65('m1'), 'sort_order', 5));
SELECT pg_temp.assert(
  (SELECT m.sort_order = 5 AND m.name = 'Gala 65' AND m.stage_w = 600 AND m.session_id IS NOT NULL
     FROM public.event_seat_maps m WHERE m.id = pg_temp.v65('m1')),
  '65/plan: edycja jednego klucza nie rusza pozostalych');
SELECT public.admin_event_seat_map_save(jsonb_build_object('id', pg_temp.v65('m2'), 'stage', NULL, 'room_id', NULL));
SELECT pg_temp.assert(
  (SELECT m.stage_x IS NULL AND m.room_id IS NULL FROM public.event_seat_maps m WHERE m.id = pg_temp.v65('m2')),
  '65/plan: jawny null czysci scene i sale');

-- ---------------------------------------------------------------------------
-- SEKCJA 4: KATEGORIE
-- ---------------------------------------------------------------------------
INSERT INTO t65 SELECT 'vip', public.admin_event_seat_category_save(jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'key', 'vip', 'name_pl', 'Strefa VIP', 'name_en', 'VIP zone',
  'color', '#AA3355', 'ticket_type_ids', jsonb_build_array('65300000-0000-0000-0000-0000000000a2')));
SELECT pg_temp.assert(
  (SELECT c.key = 'vip' AND c.name_pl = 'Strefa VIP' AND c.color = '#AA3355' FROM public.event_seat_categories c WHERE c.id = pg_temp.v65('vip'))
  AND (SELECT array_agg(ct.ticket_type_id) FROM public.event_seat_category_tickets ct WHERE ct.category_id = pg_temp.v65('vip'))
      = ARRAY['65300000-0000-0000-0000-0000000000a2'::uuid],
  '65/kategoria: utworzona z jednym dozwolonym biletem');

-- Edycja: klucz niezmienny, zbior biletow zastepowany w calosci.
SELECT public.admin_event_seat_category_save(jsonb_build_object(
  'id', pg_temp.v65('vip'), 'key', 'zmieniony', 'name_en', 'VIP area',
  'ticket_type_ids', jsonb_build_array('65300000-0000-0000-0000-0000000000a2', '65300000-0000-0000-0000-0000000000a1')));
SELECT pg_temp.assert(
  (SELECT c.key = 'vip' AND c.name_en = 'VIP area' AND c.name_pl = 'Strefa VIP' FROM public.event_seat_categories c WHERE c.id = pg_temp.v65('vip'))
  AND (SELECT count(*) FROM public.event_seat_category_tickets ct WHERE ct.category_id = pg_temp.v65('vip')) = 2,
  '65/kategoria: klucz niezmienny, zbior biletow zastapiony');
SELECT public.admin_event_seat_category_save(jsonb_build_object(
  'id', pg_temp.v65('vip'), 'ticket_type_ids', jsonb_build_array('65300000-0000-0000-0000-0000000000a2')));
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seat_category_tickets ct WHERE ct.category_id = pg_temp.v65('vip')) = 1,
  '65/kategoria: bilet spoza nowego zbioru usuniety');

SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_category_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'key', 'VIP!', 'name_pl', 'a', 'name_en', 'a', 'color', '#000000')),
  'invalid_key', '65/kategoria: zly klucz');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_category_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'key', 'vip', 'name_pl', 'a', 'name_en', 'a', 'color', '#000000')),
  'key_taken', '65/kategoria: klucz zajety');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_category_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'key', 'prasa', 'name_pl', '', 'name_en', 'Press', 'color', '#000000')),
  'invalid_names', '65/kategoria: pusta nazwa PL');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_category_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'key', 'prasa', 'name_pl', 'Prasa', 'name_en', 'Press', 'color', 'red')),
  'invalid_color', '65/kategoria: kolor spoza #RRGGBB');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_category_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'key', 'prasa', 'name_pl', 'Prasa', 'name_en', 'Press', 'color', '#101010',
  'ticket_type_ids', jsonb_build_array('65300000-0000-0000-0000-0000000000a3'))),
  'ticket_not_found', '65/kategoria: bilet innego wydarzenia');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_category_save', jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000e1', 'key', 'prasa', 'name_pl', 'Prasa', 'name_en', 'Press', 'color', '#101010',
  'ticket_type_ids', 'x')),
  'invalid_payload', '65/kategoria: bilety nie jako tablica');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_category_save', jsonb_build_object(
  'id', '65000000-0000-0000-0000-00000000dead')), 'not_found', '65/kategoria: edycja nieistniejacej');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_category_save', jsonb_build_object('key', 'x1')),
  'invalid_event', '65/kategoria: bez wydarzenia');

-- ---------------------------------------------------------------------------
-- SEKCJA 5: SEKCJE I MATERIALIZACJA MIEJSC
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.admin_event_seat_section_save(jsonb_build_object(
    'map_id', pg_temp.v65('m1'), 'label', 'A', 'kind', 'rows', 'rows_count', 2, 'seats_per_row', 5,
    'row_label_scheme', 'alpha', 'seat_numbering', 'odd_even', 'aisle_after', jsonb_build_array(2, 2),
    'origin_x', 100, 'origin_y', 200));
  INSERT INTO t65 VALUES ('sa', (v_res->>'section_id')::uuid);
  PERFORM pg_temp.assert((v_res->>'seats_created')::int = 10 AND (v_res->>'seats_kept')::int = 0,
    '65/sekcja: rzedy 2x5 tworza 10 miejsc');

  v_res := public.admin_event_seat_section_save(jsonb_build_object(
    'map_id', pg_temp.v65('m1'), 'label', 'VIP', 'kind', 'rows', 'rows_count', 1, 'seats_per_row', 4,
    'row_label_scheme', 'alpha', 'seat_numbering', 'ltr', 'category_id', pg_temp.v65('vip')));
  INSERT INTO t65 VALUES ('sv', (v_res->>'section_id')::uuid);

  v_res := public.admin_event_seat_section_save(jsonb_build_object(
    'map_id', pg_temp.v65('m1'), 'label', 'Stol 1', 'kind', 'table', 'table_shape', 'round', 'table_seats', 8,
    'rotation_deg', 15));
  INSERT INTO t65 VALUES ('st', (v_res->>'section_id')::uuid);
  PERFORM pg_temp.assert((v_res->>'seats_created')::int = 8, '65/sekcja: stol 8 miejsc');

  v_res := public.admin_event_seat_section_save(jsonb_build_object(
    'map_id', pg_temp.v65('m2'), 'label', 'S', 'kind', 'table', 'table_shape', 'rect', 'table_seats', 2));
  INSERT INTO t65 VALUES ('s2', (v_res->>'section_id')::uuid);
END
$do$;

SELECT pg_temp.assert(
  (SELECT s.aisle_after = ARRAY[2] AND s.rotation_deg = 0 AND s.origin_x = 100
     FROM public.event_seat_sections s WHERE s.id = pg_temp.v65('sa'))
  AND (SELECT count(*) FROM public.event_seats s WHERE s.section_id = pg_temp.v65('sa') AND s.status = 'available') = 10
  AND (SELECT s.x FROM public.event_seats s WHERE s.id = pg_temp.seat65(pg_temp.v65('sa'), 'A', 1)) = 150,
  '65/sekcja: przejscia bez powtorzen, miejsca wolne, wspolrzedne lokalne z formuly');

INSERT INTO t65 VALUES
  ('A5', pg_temp.seat65(pg_temp.v65('sa'), 'A', 5)), ('A3', pg_temp.seat65(pg_temp.v65('sa'), 'A', 3)),
  ('A1', pg_temp.seat65(pg_temp.v65('sa'), 'A', 1)), ('A2', pg_temp.seat65(pg_temp.v65('sa'), 'A', 2)),
  ('A4', pg_temp.seat65(pg_temp.v65('sa'), 'A', 4)), ('B1', pg_temp.seat65(pg_temp.v65('sa'), 'B', 1)),
  ('B2', pg_temp.seat65(pg_temp.v65('sa'), 'B', 2)), ('B3', pg_temp.seat65(pg_temp.v65('sa'), 'B', 3)),
  ('B4', pg_temp.seat65(pg_temp.v65('sa'), 'B', 4)), ('B5', pg_temp.seat65(pg_temp.v65('sa'), 'B', 5)),
  ('V1', pg_temp.seat65(pg_temp.v65('sv'), 'A', 1)), ('V2', pg_temp.seat65(pg_temp.v65('sv'), 'A', 2)),
  ('T1', pg_temp.seat65(pg_temp.v65('st'), NULL, 1)), ('T8', pg_temp.seat65(pg_temp.v65('st'), NULL, 8)),
  ('M2S1', pg_temp.seat65(pg_temp.v65('s2'), NULL, 1));

SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', 'a', 'kind', 'table', 'table_shape', 'round', 'table_seats', 2)),
  'label_taken', '65/sekcja: etykieta zajeta bez wzgledu na wielkosc liter');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', '', 'kind', 'table', 'table_shape', 'round', 'table_seats', 2)),
  'invalid_label', '65/sekcja: pusta etykieta');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', 'Z', 'kind', 'rows', 'rows_count', 1, 'seats_per_row', 4,
  'row_label_scheme', 'alpha', 'seat_numbering', 'ltr', 'aisle_after', jsonb_build_array(4))),
  'invalid_shape', '65/sekcja: przejscie poza rzedem');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', 'Z', 'kind', 'rows', 'rows_count', 100, 'seats_per_row', 30,
  'row_label_scheme', 'alpha', 'seat_numbering', 'ltr')),
  'invalid_shape', '65/sekcja: ponad 2000 miejsc w sekcji');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', 'Z', 'kind', 'rows', 'rows_count', 1, 'seats_per_row', 4,
  'row_label_scheme', 'roman', 'seat_numbering', 'ltr')),
  'invalid_shape', '65/sekcja: nieznany schemat rzedow');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', 'Z', 'kind', 'rows', 'rows_count', 1, 'seats_per_row', 4,
  'aisle_after', 'x')),
  'invalid_shape', '65/sekcja: przejscia nie jako tablica');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', 'Z', 'kind', 'table', 'table_shape', 'round', 'table_seats', 30)),
  'invalid_shape', '65/sekcja: stol ponad 24 krzesla');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', 'Z', 'kind', 'table', 'table_shape', 'oval', 'table_seats', 4)),
  'invalid_shape', '65/sekcja: nieznany ksztalt stolu');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', 'Z', 'kind', 'balcony')),
  'invalid_shape', '65/sekcja: nieznany rodzaj');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', 'Z', 'kind', 'table', 'table_shape', 'round', 'table_seats', 4, 'seat_pitch', 5)),
  'invalid_shape', '65/sekcja: rozstaw ponizej 10');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', pg_temp.v65('m1'), 'label', 'Z', 'kind', 'table', 'table_shape', 'round', 'table_seats', 4,
  'category_id', '65000000-0000-0000-0000-00000000dead')),
  'category_not_found', '65/sekcja: obca kategoria');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'map_id', '65000000-0000-0000-0000-00000000dead', 'label', 'Z', 'kind', 'table', 'table_shape', 'round', 'table_seats', 4)),
  'not_found', '65/sekcja: nieistniejacy plan');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
  'id', '65000000-0000-0000-0000-00000000dead', 'label', 'Z')),
  'not_found', '65/sekcja: edycja nieistniejacej');

-- Limit planu 5000 miejsc - na osobnym planie, zeby nie ruszac M1.
DO $do$
DECLARE
  v_map uuid;
BEGIN
  v_map := public.admin_event_seat_map_save(jsonb_build_object(
    'event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', 'Stadion 65'));
  PERFORM public.admin_event_seat_section_save(jsonb_build_object(
    'map_id', v_map, 'label', 'S1', 'kind', 'rows', 'rows_count', 40, 'seats_per_row', 50,
    'row_label_scheme', 'numeric', 'seat_numbering', 'ltr'));
  PERFORM public.admin_event_seat_section_save(jsonb_build_object(
    'map_id', v_map, 'label', 'S2', 'kind', 'rows', 'rows_count', 40, 'seats_per_row', 50,
    'row_label_scheme', 'numeric', 'seat_numbering', 'ltr'));
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
    'map_id', v_map, 'label', 'S3', 'kind', 'rows', 'rows_count', 40, 'seats_per_row', 30,
    'row_label_scheme', 'numeric', 'seat_numbering', 'ltr')),
    'map_too_large', '65/sekcja: plan ponad 5000 miejsc');
  PERFORM pg_temp.assert(public.admin_event_seat_map_delete(v_map), '65/plan: pusty plan usuniety');
  PERFORM pg_temp.assert(NOT EXISTS (SELECT 1 FROM public.event_seats s WHERE s.map_id = v_map),
    '65/plan: usuniecie planu zabiera jego miejsca');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 6: STATUSY MIEJSC, REZERWACJE, CRM
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public.admin_event_seats_update(jsonb_build_object('map_id', pg_temp.v65('m1'),
    'seat_ids', jsonb_build_array(pg_temp.v65('A5'), pg_temp.v65('A3'), pg_temp.v65('A5')),
    'status', 'held', 'hold_company_id', '65c00000-0000-0000-0000-0000000000c1', 'hold_note', ' Delegacja ')) = 2,
  '65/rezerwacja: dwa miejsca (duplikat w wejsciu liczony raz) dla firmy C1');
SELECT public.admin_event_seats_update(jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('A1')), 'status', 'held', 'hold_sponsor_id', '65400000-0000-0000-0000-0000000000a1'));
SELECT public.admin_event_seats_update(jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('A2')), 'status', 'held', 'hold_package_order_id', '65600000-0000-0000-0000-0000000000a1'));
SELECT public.admin_event_seats_update(jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('A4')), 'status', 'blocked', 'block_reason', 'Filar'));
SELECT public.admin_event_seats_update(jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('T8')), 'status', 'held', 'hold_note', 'Prasa'));
SELECT public.admin_event_seats_update(jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B5')), 'is_accessible', true, 'category_id', pg_temp.v65('vip')));

SELECT pg_temp.assert(
  (SELECT s.status = 'held' AND s.hold_company_id = '65c00000-0000-0000-0000-0000000000c1' AND s.hold_note = 'Delegacja'
     FROM public.event_seats s WHERE s.id = pg_temp.v65('A5'))
  AND (SELECT s.status = 'blocked' AND s.block_reason = 'Filar' FROM public.event_seats s WHERE s.id = pg_temp.v65('A4'))
  AND (SELECT s.is_accessible AND s.category_id = pg_temp.v65('vip') AND s.status = 'available'
         FROM public.event_seats s WHERE s.id = pg_temp.v65('B5')),
  '65/rezerwacja: firma + notatka, blokada z powodem, dostepnosc i kategoria bez zmiany statusu');

-- Powrot do "available" czysci rezerwujacego (CHECK held_only_when_held).
SELECT public.admin_event_seats_update(jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('V2')), 'status', 'held', 'hold_company_id', '65c00000-0000-0000-0000-0000000000c3'));
SELECT public.admin_event_seats_update(jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B5')), 'status', 'available', 'category_id', NULL));
SELECT pg_temp.assert(
  (SELECT s.hold_company_id IS NULL AND s.category_id IS NULL AND s.is_accessible FROM public.event_seats s WHERE s.id = pg_temp.v65('B5')),
  '65/rezerwacja: powrot do wolnego i null kategorii (dostepnosc zostaje)');

-- CRM: wpis osi czasu firmy przy rezerwacji (wprost i przez sponsora/pakiet).
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_log l
    WHERE l.action = 'event.seating.hold_set' AND l.entity_type = 'crm_company'
      AND l.entity_id = '65c00000-0000-0000-0000-0000000000c1'
      AND l.tenant_id = '11111111-1111-1111-1111-111111111111'
      AND l.actor_id = '65a00000-0000-0000-0000-0000000000a1'
      AND l.metadata ?& ARRAY['event_id', 'event_slug', 'event_title_pl', 'event_title_en', 'summary_pl', 'summary_en', 'map_id', 'seats_count']
      AND l.metadata->>'event_slug' = 'plan-65') = 2
  AND (SELECT l.metadata->>'seats_count' FROM public.audit_log l
        WHERE l.action = 'event.seating.hold_set' AND l.entity_id = '65c00000-0000-0000-0000-0000000000c1'
        ORDER BY l.created_at, (l.metadata->>'seats_count') DESC LIMIT 1) = '2',
  '65/CRM: rezerwacja dla firmy i dla zamowienia pakietowego firmy trafia na os czasu C1 z kontraktem metadanych');
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.audit_log l WHERE l.action = 'event.seating.hold_set'
           AND l.entity_id = '65c00000-0000-0000-0000-0000000000c2'),
  '65/CRM: rezerwacja dla sponsora trafia na os czasu firmy sponsora');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.audit_log l WHERE l.action = 'event.seating.hold_set'
               AND l.metadata->>'summary_pl' LIKE '%Prasa%'),
  '65/CRM: rezerwacja bez firmy (notatka) nie pisze do osi czasu');

SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('M2S1')), 'status', 'blocked')), 'seat_not_found', '65/miejsca: miejsce innego planu');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 2001)), 'status', 'blocked')),
  'too_many_seats', '65/miejsca: ponad 2000 w jednym wywolaniu');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array())), 'invalid_payload', '65/miejsca: pusta lista');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'))),
  'invalid_payload', '65/miejsca: brak listy');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B1')), 'status', 'sold')), 'invalid_status', '65/miejsca: nieznany status');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B1')), 'status', 'held', 'hold_company_id', '65c00000-0000-0000-0000-0000000000cb')),
  'company_not_found', '65/miejsca: firma obcego najemcy');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B1')), 'status', 'held', 'hold_sponsor_id', '65000000-0000-0000-0000-00000000dead')),
  'sponsor_not_found', '65/miejsca: nieznany sponsor');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B1')), 'status', 'held', 'hold_package_order_id', '65000000-0000-0000-0000-00000000dead')),
  'package_not_found', '65/miejsca: nieznane zamowienie pakietowe');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B1')), 'status', 'held', 'hold_note', repeat('x', 201))),
  'invalid_note', '65/miejsca: notatka rezerwacji za dluga');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B1')), 'status', 'blocked', 'block_reason', repeat('x', 201))),
  'invalid_note', '65/miejsca: powod blokady za dlugi');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B1')), 'category_id', '65000000-0000-0000-0000-00000000dead')),
  'category_not_found', '65/miejsca: obca kategoria');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', '65000000-0000-0000-0000-00000000dead',
  'seat_ids', jsonb_build_array(pg_temp.v65('B1')))), 'not_found', '65/miejsca: nieistniejacy plan');

-- ---------------------------------------------------------------------------
-- SEKCJA 7: PRZYDZIAL POJEDYNCZY
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_m1 uuid := pg_temp.v65('m1');
  v_res jsonb;
  v_first uuid;
BEGIN
  -- 1. Osoba firmy rezerwujacej siada bez force.
  v_res := public.admin_event_seat_assign(jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('A5'),
    'registration_id', '65900000-0000-0000-0000-000000000001', 'note', ' przy przejsciu '));
  PERFORM pg_temp.assert(
    (SELECT a.seat_label_snapshot = 'A / A / 5' AND a.source = 'manual' AND a.note = 'przy przejsciu'
            AND a.assigned_by = '65a00000-0000-0000-0000-0000000000a1'
       FROM public.event_seat_assignments a WHERE a.id = (v_res->>'assignment_id')::uuid)
    AND v_res->'moved_from_seat_id' = 'null'::jsonb AND v_res->'swapped_registration_id' = 'null'::jsonb,
    '65/przydzial: osoba firmy C1 na miejscu zarezerwowanym dla C1 (migawka, zrodlo, notatka, autor)');

  -- 2. Obca firma na miejscu C1 - odmowa.
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('A3'), 'registration_id', '65900000-0000-0000-0000-000000000003')),
    'seat_held_for_other', '65/przydzial: osoba innej firmy na rezerwacji C1');

  -- 3. Osoba firmy sponsora na rezerwacji sponsora.
  PERFORM public.admin_event_seat_assign(jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('A1'),
    'registration_id', '65900000-0000-0000-0000-000000000003'));
  PERFORM pg_temp.assert(pg_temp.active65('65900000-0000-0000-0000-000000000003', v_m1) = pg_temp.v65('A1'),
    '65/przydzial: osoba firmy sponsora na rezerwacji sponsora');

  -- 4. Uczestnik zamowienia pakietowego na rezerwacji pakietu.
  PERFORM public.admin_event_seat_assign(jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('A2'),
    'registration_id', '65900000-0000-0000-0000-000000000005'));
  PERFORM pg_temp.assert(pg_temp.active65('65900000-0000-0000-0000-000000000005', v_m1) = pg_temp.v65('A2'),
    '65/przydzial: osoba z pakietu na rezerwacji zamowienia');

  -- 5-9. Odmowy.
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('A2'), 'registration_id', '65900000-0000-0000-0000-000000000006', 'force', true)),
    'seat_taken', '65/przydzial: zajete miejsce (force nie pomaga)');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('A4'), 'registration_id', '65900000-0000-0000-0000-000000000002', 'force', true)),
    'seat_blocked', '65/przydzial: zablokowane miejsce (force nie pomaga)');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('B1'), 'registration_id', '65900000-0000-0000-0000-000000000004')),
    'registration_not_seatable', '65/przydzial: zgloszenie oczekujace');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('B1'), 'registration_id', '65900000-0000-0000-0000-000000000007')),
    'registration_not_seatable', '65/przydzial: zgloszenie anulowane');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('B1'), 'registration_id', '65900000-0000-0000-0000-000000000009')),
    'registration_not_found', '65/przydzial: zgloszenie innego wydarzenia');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('M2S1'), 'registration_id', '65900000-0000-0000-0000-000000000002')),
    'seat_not_found', '65/przydzial: miejsce innego planu');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('B1'))), 'invalid_payload', '65/przydzial: brak zgloszenia');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('B1'), 'registration_id', '65900000-0000-0000-0000-000000000002', 'note', repeat('x', 501))),
    'invalid_note', '65/przydzial: notatka za dluga');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object(
    'map_id', '65000000-0000-0000-0000-00000000dead', 'seat_id', pg_temp.v65('B1'),
    'registration_id', '65900000-0000-0000-0000-000000000002')), 'not_found', '65/przydzial: nieistniejacy plan');

  -- 10. Kategoria vs bilet.
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('V1'), 'registration_id', '65900000-0000-0000-0000-000000000001')),
    'category_ticket_mismatch', '65/przydzial: bilet standard w kategorii tylko dla VIP');
  PERFORM public.admin_event_seat_assign(jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('V1'),
    'registration_id', '65900000-0000-0000-0000-000000000006'));
  PERFORM pg_temp.assert(pg_temp.active65('65900000-0000-0000-0000-000000000006', v_m1) = pg_temp.v65('V1'),
    '65/przydzial: bilet VIP (zgloszenie odprawione) w kategorii VIP');

  -- 11. Zajete bez zamiany -> odmowa; z zamiana -> obie osoby sie przesiadaja.
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('A5'), 'registration_id', '65900000-0000-0000-0000-000000000002')),
    'seat_taken', '65/przydzial: zajete miejsce bez zamiany');
  PERFORM public.admin_event_seat_assign(jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('B1'),
    'registration_id', '65900000-0000-0000-0000-000000000002'));
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('A5'), 'registration_id', '65900000-0000-0000-0000-000000000010', 'swap', true, 'force', true)),
    'seat_taken', '65/przydzial: zamiana wymaga, zeby przesiadajacy sie mial miejsce (force nie pomaga)');
  v_res := public.admin_event_seat_assign(jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('A5'),
    'registration_id', '65900000-0000-0000-0000-000000000002', 'swap', true));
  PERFORM pg_temp.assert(
    pg_temp.active65('65900000-0000-0000-0000-000000000002', v_m1) = pg_temp.v65('A5')
    AND pg_temp.active65('65900000-0000-0000-0000-000000000001', v_m1) = pg_temp.v65('B1')
    AND (v_res->>'moved_from_seat_id')::uuid = pg_temp.v65('B1')
    AND (v_res->>'swapped_registration_id')::uuid = '65900000-0000-0000-0000-000000000001'
    AND (SELECT a.note FROM public.event_seat_assignments a
          WHERE a.registration_id = '65900000-0000-0000-0000-000000000001' AND a.released_at IS NULL) = 'przy przejsciu'
    AND (SELECT count(*) FROM public.event_seat_assignments a
          WHERE a.map_id = v_m1 AND a.release_reason = 'moved') = 2,
    '65/przydzial: zamiana przesadza obie osoby, notatka jedzie z osoba, historia ma dwa "moved"');

  -- 12. Zamiana, w ktorej dotychczasowy posiadacz nie moze usiasc na drugim miejscu.
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('V1'), 'registration_id', '65900000-0000-0000-0000-000000000003', 'swap', true)),
    'swap_not_allowed', '65/przydzial: zamiana odrzucona, gdy posiadacz nie moze zajac miejsca sponsora');

  -- 13. To samo miejsce - bez zmian.
  v_first := (SELECT a.id FROM public.event_seat_assignments a
               WHERE a.registration_id = '65900000-0000-0000-0000-000000000001' AND a.released_at IS NULL);
  v_res := public.admin_event_seat_assign(jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('B1'),
    'registration_id', '65900000-0000-0000-0000-000000000001'));
  PERFORM pg_temp.assert((v_res->>'assignment_id')::uuid = v_first,
    '65/przydzial: ponowny przydzial tego samego miejsca niczego nie zmienia');

  -- 14. Przeniesienie.
  v_res := public.admin_event_seat_assign(jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('B2'),
    'registration_id', '65900000-0000-0000-0000-000000000001'));
  PERFORM pg_temp.assert(
    (v_res->>'moved_from_seat_id')::uuid = pg_temp.v65('B1')
    AND pg_temp.active65('65900000-0000-0000-0000-000000000001', v_m1) = pg_temp.v65('B2')
    AND (SELECT a.release_reason FROM public.event_seat_assignments a WHERE a.id = v_first) = 'moved',
    '65/przydzial: przeniesienie zwalnia poprzednie miejsce jako "moved"');

  -- 15. force omija rezerwacje dla innej firmy.
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1,
    'seat_id', pg_temp.v65('A3'), 'registration_id', '65900000-0000-0000-0000-000000000008')),
    'seat_held_for_other', '65/przydzial: rezerwacja C1 bez force');
  PERFORM public.admin_event_seat_assign(jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('A3'),
    'registration_id', '65900000-0000-0000-0000-000000000008', 'force', true));
  PERFORM pg_temp.assert(pg_temp.active65('65900000-0000-0000-0000-000000000008', v_m1) = pg_temp.v65('A3'),
    '65/przydzial: force omija rezerwacje dla innej firmy');
  PERFORM public.admin_event_seat_assign(jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('V2'),
    'registration_id', '65900000-0000-0000-0000-000000000011', 'force', true));
  PERFORM pg_temp.assert(pg_temp.active65('65900000-0000-0000-0000-000000000011', v_m1) = pg_temp.v65('V2'),
    '65/przydzial: force omija takze regule kategorii vs bilet');
  PERFORM public.admin_event_seat_release(jsonb_build_object('map_id', v_m1,
    'registration_ids', jsonb_build_array('65900000-0000-0000-0000-000000000011')));
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 8: GWARANCJE BAZY (goly INSERT / UPDATE / DELETE)
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(format($q$
  INSERT INTO public.event_seat_assignments (tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot)
  VALUES ('11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', %L, %L,
          '65900000-0000-0000-0000-000000000010', 'x')$q$, pg_temp.v65('m1'), pg_temp.v65('A5')),
  'event_seat_assignments_seat_active_uniq', '65/indeks: drugi aktywny posiadacz miejsca');
SELECT pg_temp.assert_raises_like(format($q$
  INSERT INTO public.event_seat_assignments (tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot)
  VALUES ('11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', %L, %L,
          '65900000-0000-0000-0000-000000000001', 'x')$q$, pg_temp.v65('m1'), pg_temp.v65('B3')),
  'event_seat_assignments_registration_active_uniq', '65/indeks: drugie aktywne miejsce zgloszenia w planie');
SELECT pg_temp.assert_raises_like(format($q$
  INSERT INTO public.event_seat_assignments (tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot)
  VALUES ('11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', %L, %L,
          '65900000-0000-0000-0000-000000000010', 'x')$q$, pg_temp.v65('m1'), pg_temp.v65('A4')),
  'seat_blocked', '65/trigger: przydzial na zablokowane miejsce poza RPC');
SELECT pg_temp.assert_raises_like(format($q$
  INSERT INTO public.event_seat_assignments (tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot)
  VALUES ('11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', %L, %L,
          '65900000-0000-0000-0000-000000000004', 'x')$q$, pg_temp.v65('m1'), pg_temp.v65('B3')),
  'registration_not_seatable', '65/trigger: przydzial zgloszenia oczekujacego poza RPC');
SELECT pg_temp.assert_raises_like(format($q$
  INSERT INTO public.event_seat_assignments (tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot)
  VALUES ('11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', %L, NULL,
          '65900000-0000-0000-0000-000000000010', 'x')$q$, pg_temp.v65('m1')),
  'seat_required', '65/trigger: aktywny przydzial bez miejsca przy istniejacym planie');
SELECT pg_temp.assert_raises_like(format($q$
  INSERT INTO public.event_seat_assignments (tenant_id, event_id, map_id, seat_id, registration_id, seat_label_snapshot)
  VALUES ('65000000-0000-0000-0000-0000000000b0', '65e00000-0000-0000-0000-0000000000e1', %L, NULL,
          '65900000-0000-0000-0000-0000000000b1', 'x')$q$, pg_temp.v65('m1')),
  'foreign key', '65/izolacja: przydzial najemcy B nie wskaze planu najemcy A');
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_seat_maps (tenant_id, event_id, name)
  VALUES ('65000000-0000-0000-0000-0000000000b0', '65e00000-0000-0000-0000-0000000000e1', 'Podrzucony')$q$,
  'foreign key', '65/izolacja: plan najemcy B nie wskaze wydarzenia najemcy A');
SELECT pg_temp.assert_raises_like(format($q$
  INSERT INTO public.event_seats (tenant_id, event_id, map_id, section_id, seat_number, x, y, sort_key)
  VALUES ('11111111-1111-1111-1111-111111111111', '65e00000-0000-0000-0000-0000000000e1', %L, %L, 99, 0, 0, 0)$q$,
  pg_temp.v65('m2'), pg_temp.v65('sa')),
  'foreign key', '65/klucz: miejsce nie wskaze sekcji innego planu');
SELECT pg_temp.assert_raises_like(format($q$
  UPDATE public.event_seats SET hold_company_id = '65c00000-0000-0000-0000-0000000000c1' WHERE id = %L$q$, pg_temp.v65('B4')),
  'event_seats_hold_only_when_held', '65/CHECK: rezerwujacy tylko przy statusie held');

-- ---------------------------------------------------------------------------
-- SEKCJA 9: PRZYDZIAL ZBIORCZY
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_m1 uuid := pg_temp.v65('m1');
  v_res jsonb;
BEGIN
  v_res := public.admin_event_seat_assign_batch(jsonb_build_object('map_id', v_m1, 'source', 'auto', 'items', jsonb_build_array(
    jsonb_build_object('seat_id', pg_temp.v65('B3'), 'registration_id', '65900000-0000-0000-0000-000000000010'),
    jsonb_build_object('seat_id', pg_temp.v65('B3'), 'registration_id', '65900000-0000-0000-0000-000000000011'),
    jsonb_build_object('seat_id', pg_temp.v65('B4'), 'registration_id', '65900000-0000-0000-0000-000000000001'),
    jsonb_build_object('seat_id', 'nope', 'registration_id', '65900000-0000-0000-0000-000000000010'),
    jsonb_build_object('seat_id', pg_temp.v65('B5'), 'registration_id', '65900000-0000-0000-0000-000000000004'),
    jsonb_build_object('seat_id', pg_temp.v65('T8'), 'registration_id', '65900000-0000-0000-0000-000000000011'),
    jsonb_build_object('seat_id', pg_temp.v65('A4'), 'registration_id', '65900000-0000-0000-0000-000000000011'))));
  PERFORM pg_temp.assert(
    (v_res->>'applied')::int = 1
    AND (SELECT array_agg(e->>'code' ORDER BY ord) FROM jsonb_array_elements(v_res->'rejected') WITH ORDINALITY AS r(e, ord))
        = ARRAY['seat_taken', 'already_seated', 'invalid_payload', 'registration_not_seatable', 'seat_held_for_other', 'seat_blocked']
    AND (SELECT a.source FROM public.event_seat_assignments a
          WHERE a.registration_id = '65900000-0000-0000-0000-000000000010' AND a.released_at IS NULL) = 'auto',
    '65/zbiorczy: jedna pozycja przeszla (zrodlo auto), szesc odrzuconych z kodem w kolejnosci wejscia');

  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign_batch', jsonb_build_object('map_id', v_m1,
    'items', (SELECT jsonb_agg(jsonb_build_object('seat_id', gen_random_uuid(), 'registration_id', gen_random_uuid()))
                FROM generate_series(1, 501)))), 'too_many_items', '65/zbiorczy: ponad 500 pozycji');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign_batch', jsonb_build_object('map_id', v_m1,
    'items', jsonb_build_array())), 'invalid_payload', '65/zbiorczy: pusta lista');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign_batch', jsonb_build_object('map_id', v_m1,
    'source', 'magic', 'items', jsonb_build_array(jsonb_build_object('seat_id', pg_temp.v65('B4'))))),
    'invalid_payload', '65/zbiorczy: nieznane zrodlo');
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_assign_batch', jsonb_build_object(
    'map_id', '65000000-0000-0000-0000-00000000dead',
    'items', jsonb_build_array(jsonb_build_object('seat_id', pg_temp.v65('B4'))))), 'not_found', '65/zbiorczy: nieistniejacy plan');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 10: ZWOLNIENIE, BLOKADA ZAJETEGO, STRAZNIK MIEJSCA
-- ---------------------------------------------------------------------------
-- UWAGA: wywolanie zmieniajace stan i jego sprawdzenie w OSOBNYCH instrukcjach -
-- jedna instrukcja SQL widzi jedna migawke (i planista moze policzyc podzapytanie
-- przed funkcja), wiec sprawdzenie w tej samej instrukcji widzialoby stan sprzed zmiany.
SELECT pg_temp.assert(
  public.admin_event_seat_release(jsonb_build_object('map_id', pg_temp.v65('m1'), 'seat_ids', jsonb_build_array(pg_temp.v65('B3')))) = 1,
  '65/zwolnienie: po miejscu zwalnia dokladnie jedno');
SELECT pg_temp.assert(
  (SELECT a.release_reason = 'manual' AND a.released_by = '65a00000-0000-0000-0000-0000000000a1'
         FROM public.event_seat_assignments a
        WHERE a.registration_id = '65900000-0000-0000-0000-000000000010' AND a.seat_id = pg_temp.v65('B3')),
  '65/zwolnienie: po miejscu, powod manual, kto zwolnil');
SELECT pg_temp.assert(
  public.admin_event_seat_release(jsonb_build_object('map_id', pg_temp.v65('m1'),
    'registration_ids', jsonb_build_array('65900000-0000-0000-0000-000000000010'))) = 0,
  '65/zwolnienie: ponowne zwolnienie nic nie zmienia');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_release', jsonb_build_object('map_id', pg_temp.v65('m1'))),
  'invalid_payload', '65/zwolnienie: bez wskazania');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_release', jsonb_build_object(
  'map_id', '65000000-0000-0000-0000-00000000dead', 'all', true)), 'not_found', '65/zwolnienie: nieistniejacy plan');

SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B2')), 'status', 'blocked')),
  'seat_assigned', '65/blokada: zajetego miejsca bez release');
SELECT public.admin_event_seats_update(jsonb_build_object('map_id', pg_temp.v65('m1'),
  'seat_ids', jsonb_build_array(pg_temp.v65('B2')), 'status', 'blocked', 'block_reason', 'Kamera', 'release', true));
SELECT pg_temp.assert(
  (SELECT s.status = 'blocked' AND s.block_reason = 'Kamera' FROM public.event_seats s WHERE s.id = pg_temp.v65('B2'))
  AND (SELECT a.release_reason FROM public.event_seat_assignments a
        WHERE a.registration_id = '65900000-0000-0000-0000-000000000001' AND a.seat_id = pg_temp.v65('B2')) = 'seat_blocked'
  AND pg_temp.active65('65900000-0000-0000-0000-000000000001', pg_temp.v65('m1')) IS NULL,
  '65/blokada: z release zwalnia osobe (powod seat_blocked) i blokuje miejsce');

SELECT pg_temp.assert_raises_like(format('UPDATE public.event_seats SET status = %L WHERE id = %L', 'blocked', pg_temp.v65('A5')),
  'seat_assigned', '65/straznik: zablokowanie zajetego miejsca poza RPC');
SELECT pg_temp.assert_raises_like(format('DELETE FROM public.event_seats WHERE id = %L', pg_temp.v65('A5')),
  'seats_in_use', '65/straznik: usuniecie zajetego miejsca poza RPC');
UPDATE public.event_seats SET status = 'blocked' WHERE id = pg_temp.v65('B4');
UPDATE public.event_seats SET status = 'available' WHERE id = pg_temp.v65('B4');
SELECT pg_temp.assert(
  (SELECT s.status FROM public.event_seats s WHERE s.id = pg_temp.v65('B4')) = 'available',
  '65/straznik: wolne miejsce da sie zablokowac i odblokowac (kontrapunkt)');

-- ---------------------------------------------------------------------------
-- SEKCJA 11: ODCZYTY PANELU
-- Stan: A5 r2, A1 r3, A2 r5, V1 r6, A3 r8 (piec aktywnych), blokady A4 i B2.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_seat_maps_list('65e00000-0000-0000-0000-0000000000e1')) = 2
  AND (SELECT l.sections_count = 3 AND l.seats_total = 22 AND l.seats_blocked = 2 AND l.seats_held = 6
              AND l.seats_assigned = 5 AND l.seatable_registrations = 8 AND l.room_name = 'Sala 65'
              AND l.session_title_pl = 'Kolacja galowa' AND l.status = 'draft'
         FROM public.admin_event_seat_maps_list('65e00000-0000-0000-0000-0000000000e1') l WHERE l.id = pg_temp.v65('m1')),
  '65/lista: dwa plany, liczniki sekcji/miejsc/blokad/rezerwacji/zajetych i uprawnionych zgloszen');

DO $do$
DECLARE
  v_d jsonb := public.admin_event_seat_map_detail(pg_temp.v65('m1'));
BEGIN
  PERFORM pg_temp.assert(
    v_d ?& ARRAY['map', 'categories', 'sections', 'seats', 'assignments']
    AND jsonb_array_length(v_d->'seats') = 22
    AND jsonb_array_length(v_d->'sections') = 3
    AND jsonb_array_length(v_d->'assignments') = 5
    AND jsonb_array_length(v_d->'categories') = 1
    AND v_d->'categories'->0->'ticket_type_ids' = jsonb_build_array('65300000-0000-0000-0000-0000000000a2')
    AND (v_d->'map'->'stage'->>'w')::numeric = 600,
    '65/szczegol: komplet jednym zapytaniem');
  PERFORM pg_temp.assert(
    (SELECT s->>'hold_company_name' FROM jsonb_array_elements(v_d->'seats') s WHERE (s->>'id')::uuid = pg_temp.v65('A5')) = 'Firma C1 65'
    AND (SELECT s->>'hold_sponsor_name' FROM jsonb_array_elements(v_d->'seats') s WHERE (s->>'id')::uuid = pg_temp.v65('A1')) = 'Sponsor C2 65'
    AND (SELECT s->>'hold_package_buyer' FROM jsonb_array_elements(v_d->'seats') s WHERE (s->>'id')::uuid = pg_temp.v65('A2')) = 'Kupiec Pakietu'
    AND (SELECT a->>'company' FROM jsonb_array_elements(v_d->'assignments') a
          WHERE a->>'registration_id' = '65900000-0000-0000-0000-000000000003') = 'Sponsor Tekstem'
    AND (SELECT a->>'company' FROM jsonb_array_elements(v_d->'assignments') a
          WHERE a->>'registration_id' = '65900000-0000-0000-0000-000000000002') = 'Firma C1 65',
    '65/szczegol: nazwy rezerwujacych i projekcja firmy CRM (tekst przed kartoteka)');
END
$do$;
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_seat_map_detail('65000000-0000-0000-0000-00000000dead')$q$,
  'not_found', '65/szczegol: nieistniejacy plan');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_seating_candidates(jsonb_build_object('map_id', pg_temp.v65('m1')))) = 8
  AND (SELECT max(c.total_count) FROM public.admin_event_seating_candidates(jsonb_build_object('map_id', pg_temp.v65('m1'), 'limit', 2)) c) = 8
  AND (SELECT count(*) FROM public.admin_event_seating_candidates(jsonb_build_object('map_id', pg_temp.v65('m1'), 'limit', 2, 'offset', 7))) = 1
  AND NOT EXISTS (SELECT 1 FROM public.admin_event_seating_candidates(jsonb_build_object('map_id', pg_temp.v65('m1'))) c
                   WHERE c.registration_status NOT IN ('approved', 'attended', 'no_show')),
  '65/kandydaci: tylko statusy zajmujace miejsce, stronicowanie z licznikiem calosci');
SELECT pg_temp.assert(
  (SELECT array_agg(c.last_name ORDER BY c.last_name) FROM public.admin_event_seating_candidates(
     jsonb_build_object('map_id', pg_temp.v65('m1'), 'only_unassigned', true)) c) = ARRAY['Bezmiejsca', 'Kowalska', 'Stolik']
  AND (SELECT array_agg(c.last_name ORDER BY c.last_name) FROM public.admin_event_seating_candidates(
     jsonb_build_object('map_id', pg_temp.v65('m1'), 'company_id', '65c00000-0000-0000-0000-0000000000c1')) c)
     = ARRAY['Kowalska', 'Kowalski', 'Pakietowa']
  AND (SELECT count(*) FROM public.admin_event_seating_candidates(
     jsonb_build_object('map_id', pg_temp.v65('m1'), 'ticket_type_id', '65300000-0000-0000-0000-0000000000a2'))) = 2
  AND (SELECT array_agg(c.last_name) FROM public.admin_event_seating_candidates(
     jsonb_build_object('map_id', pg_temp.v65('m1'), 'q', 'kowalsk')) c) = ARRAY['Kowalska', 'Kowalski']
  AND (SELECT count(*) FROM public.admin_event_seating_candidates(
     jsonb_build_object('map_id', pg_temp.v65('m1'), 'q', 'sponsor tek'))) = 1
  AND (SELECT count(*) FROM public.admin_event_seating_candidates(
     jsonb_build_object('map_id', pg_temp.v65('m1'), 'q', 'k'))) = 8
  AND (SELECT count(*) FROM public.admin_event_seating_candidates(
     jsonb_build_object('map_id', pg_temp.v65('m1'), 'q', '%%'))) = 0,
  '65/kandydaci: nieprzydzieleni, firma (takze przez pakiet), bilet, szukanie po nazwisku i firmie, 1 znak ignorowany, % doslownie');
SELECT pg_temp.assert(
  (SELECT c.party_key = '65900000-0000-0000-0000-000000000001' AND c.seat_label = 'A / A / 5' AND c.company = 'Firma C1 65'
     FROM public.admin_event_seating_candidates(jsonb_build_object('map_id', pg_temp.v65('m1'))) c
    WHERE c.registration_id = '65900000-0000-0000-0000-000000000002')
  AND (SELECT c.package_order_id = '65600000-0000-0000-0000-0000000000a1' AND c.package_company_id = '65c00000-0000-0000-0000-0000000000c1'
     FROM public.admin_event_seating_candidates(jsonb_build_object('map_id', pg_temp.v65('m1'))) c
    WHERE c.registration_id = '65900000-0000-0000-0000-000000000005'),
  '65/kandydaci: klucz zespolu = prowadzacy grupy, zamowienie pakietowe i jego firma, etykieta miejsca');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seating_candidates', jsonb_build_object(
  'map_id', '65000000-0000-0000-0000-00000000dead')), 'not_found', '65/kandydaci: nieistniejacy plan');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_seat_lookup(jsonb_build_object('event_id', '65e00000-0000-0000-0000-0000000000e1',
     'registration_ids', jsonb_build_array('65900000-0000-0000-0000-000000000002', '65900000-0000-0000-0000-000000000004',
                                           '65900000-0000-0000-0000-000000000001')))) = 1
  AND (SELECT l.section_label = 'A' AND l.row_label = 'A' AND l.seat_number = 5 AND l.category_key IS NULL AND l.map_name = 'Gala 65'
         FROM public.admin_event_seat_lookup(jsonb_build_object('event_id', '65e00000-0000-0000-0000-0000000000e1',
           'registration_ids', jsonb_build_array('65900000-0000-0000-0000-000000000002'))) l)
  AND (SELECT l.category_key = 'vip' AND l.category_color = '#AA3355'
         FROM public.admin_event_seat_lookup(jsonb_build_object('event_id', '65e00000-0000-0000-0000-0000000000e1',
           'registration_ids', jsonb_build_array('65900000-0000-0000-0000-000000000006'))) l)
  AND (SELECT count(*) FROM public.admin_event_seat_lookup(jsonb_build_object('event_id', '65e00000-0000-0000-0000-0000000000e1'))) = 0,
  '65/lookup: tylko aktywne miejsca podanych zgloszen, kategoria z sekcji, brak listy = pusto');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_lookup', jsonb_build_object('event_id', '65e00000-0000-0000-0000-0000000000e1',
  'registration_ids', (SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1, 201)))), 'too_many_ids', '65/lookup: ponad 200 zgloszen');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_seating_export(jsonb_build_object('map_id', pg_temp.v65('m1')))) = 22
  AND (SELECT count(*) FROM public.admin_event_seating_export(jsonb_build_object('map_id', pg_temp.v65('m1'),
         'company_id', '65c00000-0000-0000-0000-0000000000c1'))) = 3
  AND (SELECT e.email = 'bartosz@example.org' AND e.hold_company_name = 'Firma C1 65' AND e.ticket_name_pl = 'Standard'
         FROM public.admin_event_seating_export(jsonb_build_object('map_id', pg_temp.v65('m1'))) e WHERE e.seat_id = pg_temp.v65('A5'))
  AND (SELECT e.hold_company_id = '65c00000-0000-0000-0000-0000000000c2'
         FROM public.admin_event_seating_export(jsonb_build_object('map_id', pg_temp.v65('m1'))) e WHERE e.seat_id = pg_temp.v65('A1')),
  '65/eksport: wiersz na miejsce, lista gosci firmy (osoby firmy + jej rezerwacje), rezerwujacy przez sponsora');
SELECT pg_temp.assert_raises_like(pg_temp.q65('admin_event_seating_export', jsonb_build_object(
  'map_id', '65000000-0000-0000-0000-00000000dead')), 'not_found', '65/eksport: nieistniejacy plan');

-- ---------------------------------------------------------------------------
-- SEKCJA 12: EDYCJA SEKCJI, USUWANIE SEKCJI I KATEGORII
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.admin_event_seat_section_save(jsonb_build_object('id', pg_temp.v65('sa'), 'origin_x', 300));
  PERFORM pg_temp.assert(
    (v_res->>'seats_kept')::int = 10 AND (v_res->>'seats_created')::int = 0 AND (v_res->>'seats_removed')::int = 0
    AND pg_temp.active65('65900000-0000-0000-0000-000000000002', pg_temp.v65('m1')) = pg_temp.v65('A5')
    AND (SELECT s.status FROM public.event_seats s WHERE s.id = pg_temp.v65('A4')) = 'blocked',
    '65/sekcja: przesuniecie zachowuje miejsca, przydzialy i blokady');

  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
    'id', pg_temp.v65('sa'), 'seats_per_row', 3)), 'seats_in_use', '65/sekcja: zmniejszenie usuwaloby zajete miejsce');

  v_res := public.admin_event_seat_section_save(jsonb_build_object('id', pg_temp.v65('sa'), 'rows_count', 1));
  PERFORM pg_temp.assert(
    (v_res->>'seats_removed')::int = 5 AND (v_res->>'seats_kept')::int = 5
    AND NOT EXISTS (SELECT 1 FROM public.event_seats s WHERE s.id = pg_temp.v65('B1'))
    AND (SELECT count(*) FROM public.event_seat_assignments a
          WHERE a.map_id = pg_temp.v65('m1') AND a.seat_id IS NULL AND a.released_at IS NOT NULL) >= 3,
    '65/sekcja: usuniecie wolnego rzedu zostawia historie przydzialow (seat_id NULL)');

  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_section_save', jsonb_build_object(
    'id', pg_temp.v65('sv'), 'label', ' a ')), 'label_taken', '65/sekcja: zmiana etykiety na zajeta');

  -- Zmiana rodzaju: stol -> rzedy (parametry stolu wyczyszczone).
  v_res := public.admin_event_seat_section_save(jsonb_build_object('id', pg_temp.v65('s2'), 'kind', 'rows',
    'rows_count', 1, 'seats_per_row', 2));
  PERFORM pg_temp.assert(
    (SELECT s.table_shape IS NULL AND s.table_seats IS NULL AND s.row_label_scheme = 'alpha' AND s.seat_numbering = 'ltr'
       FROM public.event_seat_sections s WHERE s.id = pg_temp.v65('s2'))
    AND (v_res->>'seats_created')::int = 2 AND (v_res->>'seats_removed')::int = 2,
    '65/sekcja: zmiana rodzaju czysci parametry stolu i przebudowuje miejsca');
  UPDATE t65 SET v = pg_temp.seat65(pg_temp.v65('s2'), 'A', 1) WHERE k = 'M2S1';

  -- Usuniecie sekcji z osoba -> odmowa; po zwolnieniu -> usunieta.
  PERFORM public.admin_event_seat_assign(jsonb_build_object('map_id', pg_temp.v65('m1'), 'seat_id', pg_temp.v65('T1'),
    'registration_id', '65900000-0000-0000-0000-000000000011'));
  PERFORM pg_temp.assert_raises_like(format('SELECT public.admin_event_seat_section_delete(%L)', pg_temp.v65('st')),
    'section_has_assignments', '65/sekcja: usuniecie sekcji z osoba');
  PERFORM public.admin_event_seat_release(jsonb_build_object('map_id', pg_temp.v65('m1'), 'seat_ids', jsonb_build_array(pg_temp.v65('T1'))));
  PERFORM pg_temp.assert(public.admin_event_seat_section_delete(pg_temp.v65('st')),
    '65/sekcja: usuniecie wolnej sekcji zwraca true');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_seats s WHERE s.section_id = pg_temp.v65('st'))
    AND EXISTS (SELECT 1 FROM public.event_seat_assignments a
                 WHERE a.registration_id = '65900000-0000-0000-0000-000000000011' AND a.seat_id IS NULL),
    '65/sekcja: usuniecie wolnej sekcji zabiera miejsca, historia zostaje');
  PERFORM pg_temp.assert_raises_like($q$SELECT public.admin_event_seat_section_delete('65000000-0000-0000-0000-00000000dead')$q$,
    'not_found', '65/sekcja: usuniecie nieistniejacej');

  PERFORM pg_temp.assert_raises_like(format('SELECT public.admin_event_seat_category_delete(%L)', pg_temp.v65('vip')),
    'category_in_use', '65/kategoria: usuniecie uzywanej');
  PERFORM pg_temp.assert(public.admin_event_seat_category_delete(public.admin_event_seat_category_save(jsonb_build_object(
    'event_id', '65e00000-0000-0000-0000-0000000000e1', 'key', 'zapas', 'name_pl', 'Zapas', 'name_en', 'Spare', 'color', '#00AA00'))),
    '65/kategoria: nieuzywana usunieta');
  PERFORM pg_temp.assert_raises_like($q$SELECT public.admin_event_seat_category_delete('65000000-0000-0000-0000-00000000dead')$q$,
    'not_found', '65/kategoria: usuniecie nieistniejacej');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 13: ZMIANA STATUSU ZGLOSZENIA ZWALNIA MIEJSCE
-- ---------------------------------------------------------------------------
UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now() WHERE id = '65900000-0000-0000-0000-000000000003';
UPDATE public.event_registrations SET status = 'attended', attended_at = now() WHERE id = '65900000-0000-0000-0000-000000000005';
SELECT pg_temp.assert(
  pg_temp.active65('65900000-0000-0000-0000-000000000003', pg_temp.v65('m1')) IS NULL
  AND (SELECT a.release_reason FROM public.event_seat_assignments a
        WHERE a.registration_id = '65900000-0000-0000-0000-000000000003' AND a.seat_id = pg_temp.v65('A1')) = 'registration_status'
  AND pg_temp.active65('65900000-0000-0000-0000-000000000005', pg_temp.v65('m1')) = pg_temp.v65('A2')
  AND EXISTS (SELECT 1 FROM public.domain_events d
               WHERE d.event_type = 'event_seat.released.v1' AND d.payload->>'reason' = 'registration_status'
                 AND d.payload->>'event_id' = '65e00000-0000-0000-0000-0000000000e1'),
  '65/zwolnienie: anulowane zgloszenie traci miejsce (zdarzenie domenowe), odprawione je zachowuje');

-- ---------------------------------------------------------------------------
-- SEKCJA 14: PLASZCZYZNA UCZESTNIKA
-- Stan: r8 siedzi na A3 w M1; M1 w szkicu.
-- ---------------------------------------------------------------------------
SELECT public.admin_event_seat_assign(jsonb_build_object('map_id', pg_temp.v65('m2'), 'seat_id', pg_temp.v65('M2S1'),
  'registration_id', '65900000-0000-0000-0000-000000000008'));

SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  public.event_my_seats('{"slug":"plan-65"}') = '{"seats":[]}'::jsonb,
  '65/uczestnik: plany w szkicu sa niewidoczne');

SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT public.admin_event_seat_map_save(jsonb_build_object('id', pg_temp.v65('m1'), 'status', 'published'));
SELECT pg_temp.assert(
  (SELECT m.status = 'published' AND m.published_at IS NOT NULL FROM public.event_seat_maps m WHERE m.id = pg_temp.v65('m1')),
  '65/publikacja: status i znacznik czasu');

SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111');
DO $do$
DECLARE
  v_r jsonb := public.event_my_seats('{"slug":"plan-65"}');
  v_card jsonb := v_r->'seats'->0;
BEGIN
  PERFORM pg_temp.assert(
    jsonb_array_length(v_r->'seats') = 1
    AND v_card->>'map_name' = 'Gala 65' AND v_card->>'room_name' = 'Sala 65' AND v_card->>'room_floor' = 'Parter'
    AND v_card->>'session_title_pl' = 'Kolacja galowa'
    AND v_card->>'section_label' = 'A' AND v_card->>'row_label' = 'A' AND (v_card->>'seat_number')::int = 3
    AND v_card->'category' = 'null'::jsonb
    AND (v_card->'geometry'->>'width')::int = 1600
    AND (v_card->'geometry'->'stage'->>'w')::numeric = 600
    AND (v_card->'geometry'->'section'->>'origin_x')::numeric = 300
    AND jsonb_array_length(v_card->'geometry'->'seats') = 5
    AND (SELECT count(*) FROM jsonb_array_elements(v_card->'geometry'->'seats') s WHERE (s->>'mine')::boolean) = 1,
    '65/uczestnik: jedna karta z opublikowanego planu (szkic M2 pominiety), geometria wlasnej sekcji, jedno "moje"');
  PERFORM pg_temp.assert(
    NOT (v_r::text ILIKE '%Kowalsk%') AND NOT (v_r::text ILIKE '%registration%')
    AND NOT (v_r::text ILIKE '%held%') AND NOT (v_r::text ILIKE '%Firma%')
    AND (SELECT bool_and(s ?& ARRAY['x', 'y', 'mine'] AND (SELECT count(*) FROM jsonb_object_keys(s)) = 3)
           FROM jsonb_array_elements(v_card->'geometry'->'seats') s),
    '65/uczestnik: karta bez cudzych danych (nazwiska, identyfikatory, rezerwacje)');
END
$do$;

SELECT pg_temp.assert(
  public.event_my_seats('{"slug":"nie-ma-takiego"}') = '{"seats":[]}'::jsonb,
  '65/uczestnik: nieznany slug = pusta lista');
SELECT pg_temp.assert_raises_like($q$SELECT public.event_my_seats('{}')$q$, 'invalid_slug', '65/uczestnik: brak sluga');
SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  public.event_my_seats('{"slug":"plan-65"}') = '{"seats":[]}'::jsonb,
  '65/uczestnik: osoba bez zgloszenia nie widzi cudzych miejsc');
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like($q$SELECT public.event_my_seats('{"slug":"plan-65"}')$q$, 'auth_required', '65/uczestnik: anonim');

-- Strona biletu: skrot klucza samoobslugi albo kodu QR, bez sesji.
SELECT pg_temp.assert(
  (public.event_ticket_seats('{"slug":"plan-65","manage_token":"mg65mg65mg65mg65mg65mg65mg65mg65"}')->'seats'->0->>'seat_number') = '3'
  AND jsonb_array_length(public.event_ticket_seats('{"slug":"plan-65","qr_token":"qr65qr65qr65qr65qr65qr65qr65qr65"}')->'seats') = 1
  AND jsonb_array_length(public.event_ticket_seats(
        '{"slug":"plan-65","manage_token":"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz","qr_token":"qr65qr65qr65qr65qr65qr65qr65qr65"}')->'seats') = 1,
  '65/bilet: miejsce po kluczu samoobslugi, po kodzie QR i po kodzie, gdy klucz nie pasuje');
SELECT pg_temp.assert(
  public.event_ticket_seats('{"slug":"plan-65","qr_token":"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"}') = '{"seats":[]}'::jsonb
  AND public.event_ticket_seats('{"slug":"plan-65","qr_token":"za-krotki"}') = '{"seats":[]}'::jsonb
  AND public.event_ticket_seats('{"slug":"plan-65-druga","qr_token":"qr65qr65qr65qr65qr65qr65qr65qr65"}') = '{"seats":[]}'::jsonb
  AND public.event_ticket_seats('{"qr_token":"qr65qr65qr65qr65qr65qr65qr65qr65"}') = '{"seats":[]}'::jsonb,
  '65/bilet: zly kod, zly ksztalt, inne wydarzenie i brak sluga daja ta sama pusta odpowiedz');
SELECT set_config('nes.public_tenant', '65000000-0000-0000-0000-0000000000b0', false);
SELECT pg_temp.assert(
  public.event_ticket_seats('{"slug":"plan-65","qr_token":"qr65qr65qr65qr65qr65qr65qr65qr65"}') = '{"seats":[]}'::jsonb,
  '65/bilet: host obcego najemcy nie odczyta miejsca najemcy A');
SELECT set_config('nes.public_tenant', '', false);

SET ROLE anon;
SELECT pg_temp.assert(
  jsonb_array_length(public.event_ticket_seats('{"slug":"plan-65","qr_token":"qr65qr65qr65qr65qr65qr65qr65qr65"}')->'seats') = 1,
  '65/bilet: anonim ma prawo wywolac odczyt strony biletu');
SELECT pg_temp.assert_raises_like($q$SELECT public.event_my_seats('{"slug":"plan-65"}')$q$,
  'permission denied', '65/granty: anonim nie wywola event_my_seats');
RESET ROLE;

-- Wycofanie publikacji znow ukrywa miejsce.
SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT public.admin_event_seat_map_save(jsonb_build_object('id', pg_temp.v65('m1'), 'status', 'draft'));
SELECT pg_temp.assert(
  (SELECT m.published_at IS NULL FROM public.event_seat_maps m WHERE m.id = pg_temp.v65('m1'))
  AND public.event_ticket_seats('{"slug":"plan-65","qr_token":"qr65qr65qr65qr65qr65qr65qr65qr65"}') = '{"seats":[]}'::jsonb,
  '65/publikacja: wycofanie czysci znacznik i ukrywa miejsce');
SELECT public.admin_event_seat_map_save(jsonb_build_object('id', pg_temp.v65('m1'), 'status', 'published'));

-- ---------------------------------------------------------------------------
-- SEKCJA 15: IZOLACJA, ROLE, GRANTY, RLS
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000b1', '65000000-0000-0000-0000-0000000000b0');
INSERT INTO t65 SELECT 'mb', public.admin_event_seat_map_save(jsonb_build_object(
  'event_id', '65e00000-0000-0000-0000-0000000000eb', 'name', 'Plan B'));
SELECT public.admin_event_seat_section_save(jsonb_build_object('map_id', pg_temp.v65('mb'), 'label', 'B',
  'kind', 'table', 'table_shape', 'round', 'table_seats', 3));

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_seat_maps_list('65e00000-0000-0000-0000-0000000000e1')) = 0
  AND (SELECT count(*) FROM public.admin_event_seat_lookup(jsonb_build_object('event_id', '65e00000-0000-0000-0000-0000000000e1',
         'registration_ids', jsonb_build_array('65900000-0000-0000-0000-000000000002')))) = 0,
  '65/izolacja: admin B nie widzi planow ani miejsc najemcy A');
DO $do$
DECLARE
  v_m1 uuid := pg_temp.v65('m1');
  v_sql text;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    format('SELECT public.admin_event_seat_map_detail(%L)', v_m1),
    format('SELECT public.admin_event_seat_map_delete(%L)', v_m1),
    format('SELECT public.admin_event_seat_section_delete(%L)', pg_temp.v65('sa')),
    format('SELECT public.admin_event_seat_category_delete(%L)', pg_temp.v65('vip')),
    pg_temp.q65('admin_event_seat_map_save', jsonb_build_object('id', v_m1, 'name', 'Przejety')),
    pg_temp.q65('admin_event_seat_map_save', jsonb_build_object('event_id', '65e00000-0000-0000-0000-0000000000e1', 'name', 'Obcy')),
    pg_temp.q65('admin_event_seat_category_save', jsonb_build_object('id', pg_temp.v65('vip'), 'name_pl', 'X')),
    pg_temp.q65('admin_event_seat_category_save', jsonb_build_object('event_id', '65e00000-0000-0000-0000-0000000000e1', 'key', 'obca',
      'name_pl', 'X', 'name_en', 'X', 'color', '#000000')),
    pg_temp.q65('admin_event_seat_section_save', jsonb_build_object('map_id', v_m1, 'label', 'Z', 'kind', 'table', 'table_shape', 'round', 'table_seats', 2)),
    pg_temp.q65('admin_event_seat_section_save', jsonb_build_object('id', pg_temp.v65('sa'), 'label', 'Z')),
    pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', v_m1, 'seat_ids', jsonb_build_array(pg_temp.v65('A5')), 'status', 'blocked')),
    pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1, 'seat_id', pg_temp.v65('B4'), 'registration_id', '65900000-0000-0000-0000-000000000010')),
    pg_temp.q65('admin_event_seat_assign_batch', jsonb_build_object('map_id', v_m1, 'items', jsonb_build_array(jsonb_build_object('seat_id', pg_temp.v65('B4'))))),
    pg_temp.q65('admin_event_seat_release', jsonb_build_object('map_id', v_m1, 'all', true)),
    pg_temp.q65('admin_event_seating_candidates', jsonb_build_object('map_id', v_m1)),
    pg_temp.q65('admin_event_seating_export', jsonb_build_object('map_id', v_m1))
  ] LOOP
    PERFORM pg_temp.assert_raises_like(v_sql, 'not_found', '65/izolacja: admin B -> ' || left(v_sql, 60));
  END LOOP;
  PERFORM pg_temp.assert_raises_like(pg_temp.q65('admin_event_seat_map_save', jsonb_build_object(
    'event_id', '65e00000-0000-0000-0000-0000000000eb', 'name', 'Z sala A', 'room_id', '65100000-0000-0000-0000-0000000000a1')),
    'room_not_found', '65/izolacja: admin B nie przypnie sali najemcy A');
END
$do$;
SELECT pg_temp.assert(
  (SELECT m.name FROM public.event_seat_maps m WHERE m.id = pg_temp.v65('m1')) = 'Gala 65',
  '65/izolacja: plan A nietkniety po probach admina B');

-- Odmowy rol: redaktor, zwykly uzytkownik, anonim.
DO $do$
DECLARE
  v_m1 uuid := pg_temp.v65('m1');
  v_sql text;
  v_who record;
BEGIN
  FOR v_who IN
    SELECT * FROM (VALUES
      ('65a00000-0000-0000-0000-0000000000a2'::uuid, 'redaktor', 'admin role required'),
      ('65a00000-0000-0000-0000-0000000000a3'::uuid, 'uzytkownik', 'admin role required'),
      (NULL::uuid, 'anonim', 'authentication required')
    ) AS w(uid, label, reason)
  LOOP
    PERFORM pg_temp.act_as(v_who.uid, CASE WHEN v_who.uid IS NULL THEN NULL ELSE '11111111-1111-1111-1111-111111111111'::uuid END);
    FOREACH v_sql IN ARRAY ARRAY[
      $q$SELECT count(*) FROM public.admin_event_seat_maps_list('65e00000-0000-0000-0000-0000000000e1')$q$,
      format('SELECT public.admin_event_seat_map_detail(%L)', v_m1),
      format('SELECT public.admin_event_seat_map_delete(%L)', v_m1),
      format('SELECT public.admin_event_seat_section_delete(%L)', pg_temp.v65('sa')),
      format('SELECT public.admin_event_seat_category_delete(%L)', pg_temp.v65('vip')),
      pg_temp.q65('admin_event_seat_map_save', jsonb_build_object('id', v_m1, 'name', 'X')),
      pg_temp.q65('admin_event_seat_category_save', jsonb_build_object('id', pg_temp.v65('vip'))),
      pg_temp.q65('admin_event_seat_section_save', jsonb_build_object('id', pg_temp.v65('sa'))),
      pg_temp.q65('admin_event_seats_update', jsonb_build_object('map_id', v_m1)),
      pg_temp.q65('admin_event_seat_assign', jsonb_build_object('map_id', v_m1)),
      pg_temp.q65('admin_event_seat_assign_batch', jsonb_build_object('map_id', v_m1)),
      pg_temp.q65('admin_event_seat_release', jsonb_build_object('map_id', v_m1)),
      'SELECT count(*) FROM ' || substr(pg_temp.q65('admin_event_seating_candidates', jsonb_build_object('map_id', v_m1)), 8),
      'SELECT count(*) FROM ' || substr(pg_temp.q65('admin_event_seat_lookup', jsonb_build_object('event_id', '65e00000-0000-0000-0000-0000000000e1')), 8),
      'SELECT count(*) FROM ' || substr(pg_temp.q65('admin_event_seating_export', jsonb_build_object('map_id', v_m1)), 8)
    ] LOOP
      PERFORM pg_temp.assert_raises_like(v_sql, v_who.reason, '65/role: ' || v_who.label || ' -> ' || left(v_sql, 60));
    END LOOP;
  END LOOP;
END
$do$;

-- Granty funkcji i tabel.
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_seat_assign(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_seat_assign(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_seat_maps_list(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_seating_export(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_seat_assign_problem(uuid,uuid,uuid,uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_seat_cards(uuid,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_seat_row_label(text,integer)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.event_ticket_seats(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_my_seats(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_my_seats(jsonb)', 'EXECUTE'),
  '65/granty: panel tylko dla zalogowanych, pomocnicy tylko dla service_role, bilet takze dla anonima');
SELECT pg_temp.assert(
  NOT has_table_privilege('authenticated', 'public.event_seats', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.event_seat_assignments', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.event_seat_maps', 'DELETE')
  AND has_table_privilege('authenticated', 'public.event_seat_maps', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.event_seat_maps', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.event_seat_categories', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.event_seat_category_tickets', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.event_seat_sections', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.event_seats', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.event_seat_assignments', 'SELECT'),
  '65/granty: klient nie pisze tabel planu, anonim ich nie czyta');

-- RLS: odczyt tylko admina / super_admina wlasnego najemcy.
SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seats WHERE tenant_id = '11111111-1111-1111-1111-111111111111') > 0
  AND (SELECT count(*) FROM public.event_seats WHERE tenant_id <> '11111111-1111-1111-1111-111111111111') = 0
  AND (SELECT count(*) FROM public.event_seat_maps) >= 2
  AND (SELECT count(*) FROM public.event_seat_assignments) > 0
  AND (SELECT count(*) FROM public.event_seat_categories) = 1
  AND (SELECT count(*) FROM public.event_seat_category_tickets) = 1
  AND (SELECT count(*) FROM public.event_seat_sections WHERE tenant_id <> '11111111-1111-1111-1111-111111111111') = 0,
  '65/RLS: admin A czyta plany wlasnego najemcy i tylko jego');
RESET ROLE;
SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) FROM public.event_seat_maps) >= 2, '65/RLS: super_admin czyta plany najemcy');
RESET ROLE;
SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seat_maps) = 0 AND (SELECT count(*) FROM public.event_seats) = 0
  AND (SELECT count(*) FROM public.event_seat_assignments) = 0,
  '65/RLS: redaktor nie czyta planu sali (modul Wydarzen tylko dla admina)');
RESET ROLE;
SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seat_maps) = 0 AND (SELECT count(*) FROM public.event_seat_assignments) = 0,
  '65/RLS: uczestniczka z miejscem nie czyta tabel planu (tylko przez event_my_seats)');
RESET ROLE;
SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000b1', '65000000-0000-0000-0000-0000000000b0');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seat_maps) = 1
  AND (SELECT count(*) FROM public.event_seats) = 3
  AND (SELECT count(*) FROM public.event_seat_maps WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0,
  '65/RLS: admin B czyta wylacznie swoj plan');
RESET ROLE;
SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
SELECT pg_temp.assert_raises_like($q$SELECT count(*) FROM public.event_seat_maps$q$, 'permission denied',
  '65/RLS: anonim nie ma nawet grantu do planow');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- SEKCJA 16: KASKADY - PLAN, WYDARZENIE, FIRMA CRM
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('65a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(format('SELECT public.admin_event_seat_map_delete(%L)', pg_temp.v65('m2')),
  'map_has_assignments', '65/plan: usuniecie planu z aktywnym przydzialem');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_seat_map_delete('65000000-0000-0000-0000-00000000dead')$q$,
  'not_found', '65/plan: usuniecie nieistniejacego');
SELECT pg_temp.assert(
  public.admin_event_seat_release(jsonb_build_object('map_id', pg_temp.v65('m2'), 'all', true)) = 1,
  '65/zwolnienie: all=true zwalnia jedyna osobe planu M2');
SELECT pg_temp.assert(public.admin_event_seat_map_delete(pg_temp.v65('m2')), '65/plan: usuniety po zwolnieniu');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_seat_sections s WHERE s.map_id = pg_temp.v65('m2'))
  AND NOT EXISTS (SELECT 1 FROM public.event_seats s WHERE s.map_id = pg_temp.v65('m2'))
  AND NOT EXISTS (SELECT 1 FROM public.event_seat_assignments a WHERE a.map_id = pg_temp.v65('m2')),
  '65/plan: po zwolnieniu usuniecie planu zabiera sekcje, miejsca i historie');

DO $do$
DECLARE
  v_map uuid;
  v_section uuid;
BEGIN
  v_map := public.admin_event_seat_map_save(jsonb_build_object(
    'event_id', '65e00000-0000-0000-0000-0000000000e3', 'name', 'Kaskada'));
  v_section := (public.admin_event_seat_section_save(jsonb_build_object('map_id', v_map, 'label', 'K',
    'kind', 'table', 'table_shape', 'round', 'table_seats', 2))->>'section_id')::uuid;
  PERFORM public.admin_event_seat_assign(jsonb_build_object('map_id', v_map,
    'seat_id', pg_temp.seat65(v_section, NULL, 1), 'registration_id', '65900000-0000-0000-0000-000000000012'));
  DELETE FROM public.events WHERE id = '65e00000-0000-0000-0000-0000000000e3';
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_seat_maps m WHERE m.id = v_map)
    AND NOT EXISTS (SELECT 1 FROM public.event_seats s WHERE s.map_id = v_map)
    AND NOT EXISTS (SELECT 1 FROM public.event_seat_assignments a WHERE a.map_id = v_map),
    '65/kaskada: usuniecie wydarzenia z aktywnym przydzialem przechodzi i sprzata caly plan');
END
$do$;

DELETE FROM public.crm_companies WHERE id = '65c00000-0000-0000-0000-0000000000c3';
SELECT pg_temp.assert(
  (SELECT s.status = 'held' AND s.hold_company_id IS NULL FROM public.event_seats s WHERE s.id = pg_temp.v65('V2')),
  '65/kaskada: usuniecie firmy z CRM zeruje rezerwujacego, miejsce zostaje zarezerwowane');

-- ---------------------------------------------------------------------------
-- SEKCJA 17: ZDARZENIA DOMENOWE FAKTYCZNIE ZAPISANE
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM public.domain_events d
           WHERE d.event_type = 'event_seat.assigned.v1' AND d.aggregate_type = 'event_seat'
             AND d.aggregate_id = pg_temp.v65('m1')::text AND d.payload->>'source' = 'manual'
             AND d.actor_id = '65a00000-0000-0000-0000-0000000000a1')
  AND EXISTS (SELECT 1 FROM public.domain_events d
               WHERE d.event_type = 'event_seat.assigned.v1' AND d.payload->>'source' = 'auto'
                 AND (d.payload->>'count')::int = 1)
  AND EXISTS (SELECT 1 FROM public.domain_events d
               WHERE d.event_type = 'event_seat.released.v1' AND d.payload->>'reason' = 'seat_blocked')
  AND EXISTS (SELECT 1 FROM public.domain_events d
               WHERE d.event_type = 'event_seat_map.changed.v1' AND d.aggregate_type = 'event_seat_map'
                 AND d.payload->>'change' = 'status'
                 AND d.payload->>'event_id' = '65e00000-0000-0000-0000-0000000000e1')
  AND EXISTS (SELECT 1 FROM public.domain_events d
               WHERE d.event_type = 'event_seat_map.changed.v1' AND d.payload->>'change' = 'deleted')
  AND NOT EXISTS (SELECT 1 FROM public.domain_events d
                   WHERE d.event_type LIKE 'event_seat%' AND (d.payload ? 'first_name' OR d.payload ? 'email')),
  '65/zdarzenia: przydzial (manual, auto), zwolnienie, zmiana planu - payload bez danych osobowych');

ROLLBACK;

\echo '== 65 plan sali: koniec =='
