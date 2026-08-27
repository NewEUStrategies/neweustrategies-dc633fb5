-- ============================================================================
-- 95_attendees_and_discussions - LISTA UCZESTNIKOW I DYSKUSJE NA FRONCIE
--
-- PO CO TEN PLIK ISTNIEJE
-- `event_attendees` i `event_discussions` to plpgsql, wiec CREATE FUNCTION nie
-- sprawdza w nich ANI JEDNEJ nazwy tabeli. Czysty przebieg migracji nie dowodzi
-- niczego o ciele - dowodzi go tylko WYWOLANIE na fiksturze. Ten plik wola obie
-- funkcje z czterech roznych tozsamosci i sprawdza piec rzeczy, ktore da sie
-- zlamac jedna linijka w RPC:
--   (a) gosc niezalogowany NIE dostaje listy uczestnikow,
--   (b) zalogowany NIEZAPISANY na to wydarzenie NIE dostaje listy,
--   (c) zapisany dostaje, ale WYLACZNIE osoby z profiles.discoverable = true
--       i bez event_registrations.directory_opt_out,
--   (d) przy events.chatham_house = true nazwiska NIE WYCHODZA z RPC nawet dla
--       zapisanego, a liczba wychodzi,
--   (e) wydarzenie bez przypietej grupy klubu nie wywala sie, tylko oddaje pusto.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * nie sprawdza komponentow (to vitest), ani i18n;
--   * nie sprawdza gieldy spotkan 1-1 - `event_attendees` celowo jej nie czyta;
--   * nie sprawdza moderacji klubu. Kolejka moderacji zyje w module klubow
--     i ma wlasny harness; tutaj interesuje nas WYLACZNIE to, ze stany
--     `pending`/`hidden`/`deleted` nie wychodza na strone wydarzenia.
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK i nie zostawia ani wiersza.
-- ============================================================================

\echo '== 95 uczestnicy i dyskusje =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA
--
-- Pieciu ludzi, zeby filtr zgody mial co odrzucic:
--   IN  - zapisany, discoverable, bez opt-outu  -> JEST na liscie,
--   HID - zapisany, discoverable = false        -> NIE MA (milczenie profilu),
--   OPT - zapisany, discoverable, opt_out       -> NIE MA (decyzja osoby),
--   NOA - zapisany, BEZ konta                   -> NIE MA (nie bylo o co pytac),
--   OUT - zalogowany, NIEZAPISANY               -> nie dostaje nawet listy.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('40000000-0000-0000-0000-00000000000a', 'in@example.org'),
  ('40000000-0000-0000-0000-00000000000b', 'hidden@example.org'),
  ('40000000-0000-0000-0000-00000000000c', 'optout@example.org'),
  ('40000000-0000-0000-0000-00000000000d', 'outsider@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, first_name, last_name,
                             slug, avatar_url, job_title, discoverable, hide_avatar)
VALUES
  ('40000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   NULL, 'Anna', 'Adamska', 'anna-adamska', 'https://x/a.png', 'Dyrektorka', true, false),
  ('40000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
   NULL, 'Bogdan', 'Bak', 'bogdan-bak', NULL, NULL, false, false),
  ('40000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
   NULL, 'Cecylia', 'Cis', 'cecylia-cis', NULL, NULL, true, false),
  ('40000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
   NULL, 'Damian', 'Dab', 'damian-dab', NULL, NULL, true, false)
ON CONFLICT (id) DO NOTHING;

-- Dwa wydarzenia: E1 zwykle, E2 w regule Chatham House.
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, chatham_house)
VALUES
  ('41000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'att-open', 'Kongres otwarty', 'Open congress', now() + interval '10 days',
   'published', 'rsvp', 'instant', false),
  ('41000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'att-chatham', 'Debata zamknieta', 'Closed debate', now() + interval '11 days',
   'published', 'rsvp', 'instant', true),
  -- E3: SZKIC. Nieopublikowane wydarzenie nie ma uczestnikow na froncie.
  ('41000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'att-draft', 'Szkic', 'Draft', now() + interval '12 days',
   'draft', 'rsvp', 'instant', false);

INSERT INTO public.event_people
  (id, tenant_id, user_id, email, first_name, last_name, job_title, company_text, source)
VALUES
  ('42000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   '40000000-0000-0000-0000-00000000000a', 'in@example.org', 'Anna', 'Adamska',
   'Dyrektorka dzialu', 'Alfa sp. z o.o.', 'self_registration'),
  ('42000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
   '40000000-0000-0000-0000-00000000000b', 'hidden@example.org', 'Bogdan', 'Bak',
   NULL, 'Beta', 'self_registration'),
  ('42000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
   '40000000-0000-0000-0000-00000000000c', 'optout@example.org', 'Cecylia', 'Cis',
   NULL, 'Gamma', 'self_registration'),
  ('42000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
   NULL, 'noaccount@example.org', 'Ewa', 'Ewicka',
   'Prelegentka', 'Delta', 'organizer'),
  ('42000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111',
   '40000000-0000-0000-0000-00000000000d', 'outsider@example.org', 'Damian', 'Dab',
   NULL, NULL, 'self_registration');

-- Zapisy na E1 i E2. `directory_opt_out` ustawiamy WPROST, bo to kolumna
-- zapisu, a nie decyzja tego testu o cudzej zgodzie.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, directory_opt_out)
VALUES
  ('43000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   '41000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-00000000000a',
   'approved', 'rsvp', false),
  ('43000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
   '41000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-00000000000b',
   'approved', 'rsvp', false),
  ('43000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
   '41000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-00000000000c',
   'approved', 'rsvp', true),
  ('43000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
   '41000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-00000000000d',
   'approved', 'rsvp', false),
  -- ten sam zestaw na wydarzeniu w regule Chatham House
  ('43000000-0000-0000-0000-00000000001a', '11111111-1111-1111-1111-111111111111',
   '41000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-00000000000a',
   'approved', 'rsvp', false),
  ('43000000-0000-0000-0000-00000000001c', '11111111-1111-1111-1111-111111111111',
   '41000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-00000000000c',
   'approved', 'rsvp', false);

CREATE TEMP TABLE att_out (k text PRIMARY KEY, j jsonb);

-- ---------------------------------------------------------------------------
-- (a) GOSC NIEZALOGOWANY
--
-- DWIE OSLONY, obie sprawdzane: brak grantu dla roli `anon` (curl nie ma czym
-- wolac) i wyjatek `auth_required` w ciele (token wygasly w trakcie wizyty).
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_attendees(jsonb)', 'EXECUTE') = false,
  '(a) rola anon NIE MA prawa wykonania event_attendees');

SELECT pg_temp.assert(
  has_function_privilege('authenticated', 'public.event_attendees(jsonb)', 'EXECUTE') = true,
  '(a) rola authenticated prawo wykonania MA');

SELECT pg_temp.act_as(NULL, '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $$SELECT public.event_attendees('{"event_slug":"att-open"}'::jsonb)$$,
  'auth_required',
  '(a) bez sesji event_attendees odmawia z kluczem auth_required');

-- ---------------------------------------------------------------------------
-- (b) ZALOGOWANY, ALE NIEZAPISANY
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('40000000-0000-0000-0000-00000000000d',
                      '11111111-1111-1111-1111-111111111111');
INSERT INTO att_out (k, j)
VALUES ('b', public.event_attendees('{"event_slug":"att-open"}'::jsonb));

SELECT pg_temp.assert(
  (SELECT j->>'blocked' FROM att_out WHERE k = 'b') = 'requester_not_participating',
  '(b) niezapisany dostaje blocked = requester_not_participating');
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(j->'rows') FROM att_out WHERE k = 'b') = 0,
  '(b) niezapisany dostaje ZERO wierszy');
SELECT pg_temp.assert(
  (SELECT (j->>'total_count')::int FROM att_out WHERE k = 'b') = 0,
  '(b) niezapisany nie dostaje nawet liczby uczestnikow');

-- ---------------------------------------------------------------------------
-- (c) ZAPISANY - DWIE ZGODY I NIC WIECEJ
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('40000000-0000-0000-0000-00000000000a',
                      '11111111-1111-1111-1111-111111111111');
INSERT INTO att_out (k, j)
VALUES ('c', public.event_attendees('{"event_slug":"att-open"}'::jsonb));

SELECT pg_temp.assert(
  (SELECT j->>'blocked' FROM att_out WHERE k = 'c') IS NULL,
  '(c) zapisany nie jest blokowany');
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(j->'rows') FROM att_out WHERE k = 'c') = 1,
  '(c) z czterech zapisanych na liscie stoi DOKLADNIE JEDEN');
SELECT pg_temp.assert(
  (SELECT j->'rows'->0->>'name' FROM att_out WHERE k = 'c') = 'Anna Adamska',
  '(c) na liscie jest osoba z discoverable = true i bez opt-outu');
SELECT pg_temp.assert(
  (SELECT NOT (j->>'rows' LIKE '%Bak%') FROM att_out WHERE k = 'c'),
  '(c) profil z discoverable = false NIE WYCHODZI');
SELECT pg_temp.assert(
  (SELECT NOT (j->>'rows' LIKE '%Cis%') FROM att_out WHERE k = 'c'),
  '(c) osoba z directory_opt_out NIE WYCHODZI');
SELECT pg_temp.assert(
  (SELECT NOT (j->>'rows' LIKE '%Ewicka%') FROM att_out WHERE k = 'c'),
  '(c) osoba BEZ KONTA nie wychodzi (nie mogla wyrazic zgody)');
SELECT pg_temp.assert(
  (SELECT j->'rows'->0->>'job_title' FROM att_out WHERE k = 'c') = 'Dyrektorka dzialu',
  '(c) stanowisko idzie z kartoteki wydarzenia, nie z profilu');
SELECT pg_temp.assert(
  (SELECT j->'rows'->0->>'company' FROM att_out WHERE k = 'c') = 'Alfa sp. z o.o.',
  '(c) firma idzie z kartoteki wydarzenia');
SELECT pg_temp.assert(
  (SELECT (j->>'my_listed')::boolean FROM att_out WHERE k = 'c'),
  '(c) wlasna widocznosc wraca jako my_listed = true');
SELECT pg_temp.assert(
  (SELECT j->>'rows' NOT LIKE '%@example.org%' FROM att_out WHERE k = 'c'),
  '(c) lista NIE NIESIE adresow poczty');

-- Ta sama funkcja na SZKICU: nieopublikowane wydarzenie nie istnieje na froncie.
SELECT pg_temp.assert_raises_like(
  $$SELECT public.event_attendees('{"event_slug":"att-draft"}'::jsonb)$$,
  'not_found',
  '(c) szkic wydarzenia nie ma listy uczestnikow');

-- Wlasna dzwignia: po wypisaniu sie znikam z listy TAKZE dla siebie.
UPDATE public.event_registrations SET directory_opt_out = true
 WHERE id = '43000000-0000-0000-0000-00000000000a';
INSERT INTO att_out (k, j)
VALUES ('c_opt', public.event_attendees('{"event_slug":"att-open"}'::jsonb));
SELECT pg_temp.assert(
  (SELECT (j->>'total_count')::int FROM att_out WHERE k = 'c_opt') = 0
  AND (SELECT (j->>'my_listed')::boolean FROM att_out WHERE k = 'c_opt') = false
  AND (SELECT (j->>'my_opt_out')::boolean FROM att_out WHERE k = 'c_opt') = true,
  '(c) wlasny opt-out zdejmuje mnie z listy i wraca w my_opt_out');
UPDATE public.event_registrations SET directory_opt_out = false
 WHERE id = '43000000-0000-0000-0000-00000000000a';

-- ---------------------------------------------------------------------------
-- (d) CHATHAM HOUSE - LICZBA WOLNO, NAZWISKA NIE
--
-- Na E2 zapisane sa DWIE osoby z discoverable = true i bez opt-outu, wiec
-- liczba MUSI byc 2, a wierszy MUSI byc zero. Asercja na liczbie jest tu tak
-- samo wazna jak na wierszach: reguly "nie pokazuj nikogo" nie wolno dowiezc
-- przez wygaszenie calej odpowiedzi.
-- ---------------------------------------------------------------------------
INSERT INTO att_out (k, j)
VALUES ('d', public.event_attendees('{"event_slug":"att-chatham"}'::jsonb));

SELECT pg_temp.assert(
  (SELECT j->>'blocked' FROM att_out WHERE k = 'd') = 'chatham_house',
  '(d) przy chatham_house = true powod wraca jako blocked = chatham_house');
SELECT pg_temp.assert(
  (SELECT (j->>'chatham_house')::boolean FROM att_out WHERE k = 'd'),
  '(d) flaga chatham_house wraca do frontu');
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(j->'rows') FROM att_out WHERE k = 'd') = 0,
  '(d) przy chatham_house = true ZADEN wiersz z nazwiskiem nie wychodzi');
SELECT pg_temp.assert(
  (SELECT j::text NOT LIKE '%Adamska%' AND j::text NOT LIKE '%Cis%'
     FROM att_out WHERE k = 'd'),
  '(d) w calej odpowiedzi nie ma ANI JEDNEGO nazwiska');
SELECT pg_temp.assert(
  (SELECT (j->>'total_count')::int FROM att_out WHERE k = 'd') = 2,
  '(d) liczba uczestnikow WYCHODZI (2 osoby ze zgoda)');
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(j->'groups') FROM att_out WHERE k = 'd') = 4,
  '(d) grupy wydarzenia WYCHODZA takze przy Chatham House');
SELECT pg_temp.assert(
  (SELECT sum((g->>'count')::int) FROM att_out, jsonb_array_elements(j->'groups') g
    WHERE k = 'd') = 2,
  '(d) licznik per grupa tez wychodzi (grupa domyslna: 2)');

-- ---------------------------------------------------------------------------
-- (e) DYSKUSJE
-- ---------------------------------------------------------------------------
-- (e1) BEZ PRZYPIETEJ GRUPY: nie wyjatek, tylko `not_configured` i pusto.
INSERT INTO att_out (k, j)
VALUES ('e1', public.event_discussions('att-open'));
SELECT pg_temp.assert(
  (SELECT j->>'state' FROM att_out WHERE k = 'e1') = 'not_configured',
  '(e) wydarzenie bez przypietej grupy klubu oddaje state = not_configured');
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(j->'threads') FROM att_out WHERE k = 'e1') = 0
  AND (SELECT (j->>'total_count')::int FROM att_out WHERE k = 'e1') = 0,
  '(e) ... i pusta liste watkow, bez wyjatku');

-- Klub, dwie grupy (imienna i w regule Chatham House), trzy watki.
INSERT INTO public.clubs (id, tenant_id, slug, name_pl, name_en, visibility, status,
                          attribution_mode, who_can_post)
VALUES ('44000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'klub-testowy', 'Klub testowy', 'Test club', 'public', 'active',
        'attributed', 'members');

INSERT INTO public.club_groups (id, tenant_id, club_id, slug, name_pl, name_en,
                                status, attribution_mode)
VALUES
  ('45000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '44000000-0000-0000-0000-000000000001', 'kongres', 'Kongres 2026', 'Congress 2026',
   'active', NULL),
  ('45000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '44000000-0000-0000-0000-000000000001', 'zamknieta', 'Sesja zamknieta', 'Closed session',
   'active', 'chatham');

INSERT INTO public.club_threads
  (id, tenant_id, club_id, group_id, author_id, slug, title, body, kind, status)
VALUES
  ('46000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '44000000-0000-0000-0000-000000000001', '45000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-00000000000a', 'pierwszy-watek',
   'Czy Europa ma plan', 'Tresc watku pierwszego, dluzsza niz dziesiec znakow.',
   'discussion', 'open'),
  ('46000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '44000000-0000-0000-0000-000000000001', '45000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-00000000000a', 'watek-ukryty',
   'Watek do moderacji', 'Tresc watku ukrytego, dluzsza niz dziesiec znakow.',
   'discussion', 'hidden'),
  ('46000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '44000000-0000-0000-0000-000000000001', '45000000-0000-0000-0000-000000000002',
   '40000000-0000-0000-0000-00000000000a', 'watek-chatham',
   'Rozmowa bez nazwisk', 'Tresc watku w regule Chatham House, dluzsza niz dziesiec.',
   'discussion', 'open');

-- (e2) PRZYPIECIE DZIALA: grupa imienna, autor wychodzi z nazwiskiem.
UPDATE public.events
   SET discussion_club_id = '44000000-0000-0000-0000-000000000001',
       discussion_group_id = '45000000-0000-0000-0000-000000000001'
 WHERE id = '41000000-0000-0000-0000-000000000001';

INSERT INTO att_out (k, j)
VALUES ('e2', public.event_discussions('att-open'));
SELECT pg_temp.assert(
  (SELECT j->>'state' FROM att_out WHERE k = 'e2') = 'ok',
  '(e) po przypieciu grupy state = ok');
SELECT pg_temp.assert(
  (SELECT (j->>'total_count')::int FROM att_out WHERE k = 'e2') = 1,
  '(e) z dwoch watkow grupy wychodzi JEDEN - `hidden` zostaje w klubie');
SELECT pg_temp.assert(
  (SELECT j->'threads'->0->>'slug' FROM att_out WHERE k = 'e2') = 'pierwszy-watek'
  AND (SELECT j->'club'->>'slug' FROM att_out WHERE k = 'e2') = 'klub-testowy',
  '(e) watek i slug klubu wystarczaja do zbudowania odnosnika');
SELECT pg_temp.assert(
  (SELECT j->'threads'->0->>'author_name' FROM att_out WHERE k = 'e2') = 'Anna Adamska',
  '(e) w trybie attributed autor wychodzi z nazwiskiem');

-- (e3) TRYB CHATHAM HOUSE GRUPY KLUBU: nazwisko autora nie wychodzi.
UPDATE public.events
   SET discussion_group_id = '45000000-0000-0000-0000-000000000002'
 WHERE id = '41000000-0000-0000-0000-000000000001';
INSERT INTO att_out (k, j)
VALUES ('e3', public.event_discussions('att-open'));
SELECT pg_temp.assert(
  (SELECT j->'threads'->0->>'author_name' FROM att_out WHERE k = 'e3') IS NULL
  AND (SELECT (j->'threads'->0->>'is_anonymous')::boolean FROM att_out WHERE k = 'e3'),
  '(e) grupa w trybie chatham nie oddaje nazwiska autora watku');

-- (e4) KLUB OBCEGO NAJEMCY czyta sie jak brak przypiecia.
INSERT INTO public.tenants (id, name, slug)
VALUES ('40000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tenant 40B', 't40b')
ON CONFLICT (id) DO NOTHING;
UPDATE public.clubs SET tenant_id = '40000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
 WHERE id = '44000000-0000-0000-0000-000000000001';
INSERT INTO att_out (k, j)
VALUES ('e4', public.event_discussions('att-open'));
SELECT pg_temp.assert(
  (SELECT j->>'state' FROM att_out WHERE k = 'e4') = 'not_configured',
  '(e) przypiecie do klubu obcego najemcy czyta sie jak brak przypiecia');

-- (e5) GOSC NIEZALOGOWANY dyskusje CZYTA (klub publiczny) - to jest osobna
-- powierzchnia od listy uczestnikow i ma osobny grant.
SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_discussions(text)', 'EXECUTE') = true,
  '(e) event_discussions ma grant dla anon - dyskusje publicznego klubu czyta gosc');

-- ---------------------------------------------------------------------------
-- KONTRAKT PARY KOLUMN
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  $$UPDATE public.events
       SET discussion_club_id = NULL,
           discussion_group_id = '45000000-0000-0000-0000-000000000001'
     WHERE id = '41000000-0000-0000-0000-000000000002'$$,
  'events_discussion_group_needs_club',
  'grupa dyskusji bez klubu jest odrzucana przez CHECK');


-- ---------------------------------------------------------------------------
-- DOSLOWNE ODPOWIEDZI RPC. Nie asercja - material do raportu i do czytania
-- przy nastepnej zmianie kontraktu. Wypis jest KOMPLETNY dla (d), bo tam
-- twierdzimy, ze czegos w odpowiedzi NIE MA.
-- ---------------------------------------------------------------------------
\echo ''
\echo '-- ODPOWIEDZI:'
\pset format aligned
\pset border 2
SELECT k, j::text AS odpowiedz FROM att_out ORDER BY k;

ROLLBACK;
