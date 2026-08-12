-- pgTAP: wyszukiwarka odbiorców czatu (§8) + poziom prywatności 'contacts' (§9).
--
-- Weryfikuje własności z dwóch migracji:
--   20260806220000_search_chat_contacts_indexed.sql
--     1. `%`, `_` i `\` z frazy są TEKSTEM, nie metaznakami wzorca LIKE
--        (przed zmianą „100%" pasowało do każdego wiersza),
--     2. dopasowanie idzie po `discovery_search`, więc łapie każde z siedmiu
--        pól i ignoruje diakrytyki („Zolw" -> „Żółw"),
--     3. zbiór wyników nadal jest ograniczony do: discoverable + ten sam
--        tenant + zaakceptowane połączenie (super_admin widzi wszystkich),
--     4. `total_count` liczy zbiór PO filtrach, nie po `LIMIT`.
--   20260806221000_chat_privacy_contacts_level.sql
--     5. 'contacts' jest dozwoloną wartością CHECK-a,
--     6. `chat_accepts_new_thread` ROZSTRZYGA wartość zamiast dopasowywać
--        literał: 'contacts' bez połączenia = false, z połączeniem = true,
--     7. nieznana wartość preferencji zamyka bramkę (fail-closed),
--     8. `filter_group_candidates` czyta z tego samego predykatu - obcy
--        z organizacji nie doprosi Cię do kręgu, gdy masz 'contacts'.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(19);

-- ── Seed ───────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'chat-search-a', 'Chat Search A'),
  ('c2222222-2222-2222-2222-222222222222', 'chat-search-b', 'Chat Search B');

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'seeker@chat.test'),
  ('c0000000-0000-0000-0000-0000000000a2', 'percent@chat.test'),
  ('c0000000-0000-0000-0000-0000000000a3', 'zolw@chat.test'),
  ('c0000000-0000-0000-0000-0000000000a4', 'stranger@chat.test'),
  ('c0000000-0000-0000-0000-0000000000a5', 'hidden@chat.test'),
  ('c0000000-0000-0000-0000-0000000000b1', 'other-tenant@chat.test');

-- A2: nazwa firmy z METAZNAKAMI LIKE - to ona demaskuje brak escapowania.
-- A3: diakrytyki - dopasowanie ma je ignorować przez unaccent.
-- A4: kontakt spoza sieci (brak user_connections) - nie wolno go pokazać.
-- A5: w sieci, ale discoverable = false.
INSERT INTO public.profiles
  (id, email, display_name, first_name, last_name, current_company, specialization, tenant_id, discoverable) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'seeker@chat.test',       'Anna Szukacz',  'Anna',  'Szukacz',  NULL,           NULL,        'c1111111-1111-1111-1111-111111111111', true),
  ('c0000000-0000-0000-0000-0000000000a2', 'percent@chat.test',      'Bogdan Procent','Bogdan','Procent',  '100% Energia', 'a_b Consulting', 'c1111111-1111-1111-1111-111111111111', true),
  ('c0000000-0000-0000-0000-0000000000a3', 'zolw@chat.test',         'Żółw Śliwiński','Żółw',  'Śliwiński',NULL,           NULL,        'c1111111-1111-1111-1111-111111111111', true),
  ('c0000000-0000-0000-0000-0000000000a4', 'stranger@chat.test',     'Obcy Nieznany', 'Obcy',  'Nieznany', NULL,           NULL,        'c1111111-1111-1111-1111-111111111111', true),
  ('c0000000-0000-0000-0000-0000000000a5', 'hidden@chat.test',       'Ukryty Kontakt','Ukryty','Kontakt',  NULL,           NULL,        'c1111111-1111-1111-1111-111111111111', false),
  ('c0000000-0000-0000-0000-0000000000b1', 'other-tenant@chat.test', 'Bogdan Procent','Bogdan','Procent',  '100% Energia', NULL,        'c2222222-2222-2222-2222-222222222222', true);

-- Sieć: A1 <-> {A2, A3, A5}. A4 celowo poza siecią.
INSERT INTO public.user_connections (tenant_id, requester_id, addressee_id) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a2'),
  ('c1111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a3'),
  ('c1111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a5');
UPDATE public.user_connections SET status = 'accepted'
 WHERE requester_id = 'c0000000-0000-0000-0000-0000000000a1';

-- ── §8.1 Escapowanie metaznaków LIKE ───────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.search_chat_contacts('100%', 50)),
  1,
  'fraza „100%” dopasowuje TYLKO firmę „100% Energia” - % jest tekstem, nie wzorcem'
);

-- Ta asercja oczekiwala wczesniej ZERA wierszy i byla sprzeczna z asercja
-- powyzej: skoro `%` jest TEKSTEM, a fikstura celowo trzyma firme „100% Energia",
-- to szukanie tekstu `%` MUSI trafic w ten profil. Zera nie da sie pogodzic
-- z „100%" dopasowujacym ten sam wiersz - i nie da sie tego naprawic fikstura,
-- bo profil musi istniec dla asercji poprzedniej.
--
-- Porownanie ZBIORU zamiast licznika zachowuje pelna wartosc regresyjna: bez
-- escapowania `%` jest wzorcem „cokolwiek" i wracaja OBA widoczne kontakty,
-- wiec asercja pada - tylko pada czysto, na roznicy zbiorow, a nie na
-- niespelnialnym kontrakcie.
SELECT is(
  (SELECT array_agg(display_name ORDER BY display_name)
     FROM public.search_chat_contacts('%', 50)),
  ARRAY['Bogdan Procent'],
  'samo „%” nie enumeruje kontaktów - trafia wyłącznie w profil ze znakiem % w danych'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_chat_contacts('a_b', 50)),
  1,
  'fraza „a_b” trafia w „a_b Consulting”, a „_” nie działa jak dowolny znak'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_chat_contacts('aXb', 50)),
  0,
  'fraza „aXb” NIE trafia w „a_b Consulting” - podkreślenie przestało być jokerem'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_chat_contacts('\', 50)),
  0,
  'goły backslash nie wywraca zapytania i nie dopasowuje niczego'
);

-- ── §8.2 Dopasowanie po discovery_search: wszystkie pola + diakrytyki ──────
SELECT is(
  (SELECT display_name FROM public.search_chat_contacts('Zolw', 50)),
  'Żółw Śliwiński',
  'fraza bez diakrytyków znajduje profil z diakrytykami (unaccent po obu stronach)'
);

SELECT is(
  (SELECT display_name FROM public.search_chat_contacts('Energia', 50)),
  'Bogdan Procent',
  'dopasowanie łapie pole current_company, nie tylko nazwę wyświetlaną'
);

SELECT is(
  (SELECT display_name FROM public.search_chat_contacts('consulting', 50)),
  'Bogdan Procent',
  'dopasowanie łapie pole specialization i ignoruje wielkość liter'
);

-- ── §8.3 Zakres wyników: sieć + tenant + discoverable ──────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.search_chat_contacts('Obcy', 50)),
  0,
  'osoba spoza zaakceptowanej sieci nie pojawia się w wyszukiwarce odbiorców'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_chat_contacts('Ukryty', 50)),
  0,
  'kontakt z discoverable = false nie pojawia się mimo zaakceptowanego połączenia'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_chat_contacts('Procent', 50)),
  1,
  'imiennik z INNEGO tenanta nie przecieka do wyników (izolacja tenanta)'
);

-- ── §8.4 total_count liczy zbiór po filtrach, nie po LIMIT ─────────────────
SELECT is(
  (SELECT DISTINCT total_count::int FROM public.search_chat_contacts('', 1)),
  2,
  'total_count = liczba widocznych kontaktów (A2, A3) mimo LIMIT 1'
);

-- ── §9.1 'contacts' jest dozwoloną wartością ───────────────────────────────
RESET ROLE;

SELECT lives_ok(
  $$INSERT INTO public.notification_preferences (user_id, tenant_id, allow_messages_from)
    VALUES ('c0000000-0000-0000-0000-0000000000a2',
            'c1111111-1111-1111-1111-111111111111', 'contacts')$$,
  'CHECK dopuszcza poziom ''contacts'' - literał z bramki przestał być fantomem'
);

SELECT throws_ok(
  $$INSERT INTO public.notification_preferences (user_id, tenant_id, allow_messages_from)
    VALUES ('c0000000-0000-0000-0000-0000000000a4',
            'c1111111-1111-1111-1111-111111111111', 'friends-of-friends')$$,
  '23514',
  NULL,
  'CHECK nadal odrzuca wartości spoza czwórki everyone/contacts/existing/nobody'
);

-- ── §9.2 Predykat ROZSTRZYGA wartość, nie dopasowuje literału ──────────────
-- A2 = 'contacts'. A1 jest z nim połączony, A4 nie jest.
SELECT ok(
  public.chat_accepts_new_thread(
    'c0000000-0000-0000-0000-0000000000a1',
    'c0000000-0000-0000-0000-0000000000a2'),
  'poziom ''contacts'': osoba z zaakceptowanej sieci MOŻE zacząć nowy wątek'
);

SELECT ok(
  NOT public.chat_accepts_new_thread(
    'c0000000-0000-0000-0000-0000000000a4',
    'c0000000-0000-0000-0000-0000000000a2'),
  'poziom ''contacts'': osoba spoza sieci NIE może - bramka sprawdza połączenie, nie napis'
);

-- ── §9.3 Fail-closed na nieznanej wartości ─────────────────────────────────
-- Omijamy CHECK, żeby zasymulować import / rozluźnienie ograniczenia.
ALTER TABLE public.notification_preferences
  DROP CONSTRAINT notification_preferences_allow_messages_from_check;
UPDATE public.notification_preferences
   SET allow_messages_from = 'friends-of-friends'
 WHERE user_id = 'c0000000-0000-0000-0000-0000000000a2';

SELECT ok(
  NOT public.chat_accepts_new_thread(
    'c0000000-0000-0000-0000-0000000000a1',
    'c0000000-0000-0000-0000-0000000000a2'),
  'nieznana wartość preferencji ZAMYKA bramkę (fail-closed), nie otwiera jej'
);

UPDATE public.notification_preferences
   SET allow_messages_from = 'contacts'
 WHERE user_id = 'c0000000-0000-0000-0000-0000000000a2';

-- ── §9.4 Kręgi czytają z tego samego predykatu ─────────────────────────────
SELECT is(
  public.filter_group_candidates(
    'c0000000-0000-0000-0000-0000000000a4',
    ARRAY['c0000000-0000-0000-0000-0000000000a2']::uuid[]),
  '{}'::uuid[],
  'obcy z organizacji nie doprosi do kręgu osoby z poziomem ''contacts'''
);

SELECT is(
  public.filter_group_candidates(
    'c0000000-0000-0000-0000-0000000000a1',
    ARRAY['c0000000-0000-0000-0000-0000000000a2']::uuid[]),
  ARRAY['c0000000-0000-0000-0000-0000000000a2']::uuid[],
  'kontakt z sieci nadal może doprosić do kręgu - ten sam predykat, oba konsumenty'
);

SELECT * FROM finish();
ROLLBACK;
