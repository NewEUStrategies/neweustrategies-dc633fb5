-- pgTAP: przepływ wprowadzeń (migracje 20260724120000 i 20260913171000).
--
-- Sprawdza naprawione ścieżki: most 'forward' -> 'forwarded' i widoczność dla
-- targetu z avatarem mostu; proszący 'withdraw' -> 'withdrawn'; brak ścieżki
-- dla obcego aktora.
--
-- DOŁOŻONE 20260913171000 - PIERWSZA POŁOWA PRZEPŁYWU. Do tej pory ten plik
-- testował wyłącznie `respond_introduction` i `my_introduction_requests`, czyli
-- DRUGĄ połowę: `request_introduction` nie było wołane w ŻADNYM teście pgTAP
-- (grep po całym supabase/tests/ dawał zero trafień). Tymczasem to właśnie
-- pierwsza połowa zapisuje wiersze i to w niej były dziury:
--   * trzy bramki prywatności, które ma wzorzec `connection_request`
--     (blokada pary, `discoverable` celu, `connections_allowed_from`), NIE
--     ZOSTAŁY do wprowadzeń przepisane - a przy statusie `forwarded` wyzwalacz
--     `tg_introduction_notify` wysyła celowi powiadomienie, więc blokada nie
--     blokowała i wyłączenie nie wyłączało;
--   * deklarowana "deduplikacja w bazie" nie istniała - ani UNIQUE, ani indeksu
--     częściowego, ani SELECT-a w funkcji.
--
-- DLACZEGO TRZY ODMOWY MAJĄ IDENTYCZNY KOMUNIKAT. To jest asercja o
-- PRYWATNOŚCI, nie o ergonomii: rozróżnialne teksty powiedziałyby proszącemu,
-- KTÓRE ustawienie celu go zatrzymało ("zablokował mnie" kontra "nie przyjmuje
-- zaproszeń" kontra "ukrył profil"), czyli wydałyby informację o osobie, która
-- właśnie odmówiła kontaktu. `connection_request` rozstrzygnęło to tak samo
-- (20260717170000:136-139) i wprowadzenia mają to POWTÓRZYĆ, a nie wymyślać
-- własne zachowanie - stąd oczekiwany tekst jest tu wpisany DOSŁOWNIE.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(15);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('d1a11111-1111-1111-1111-111111111111', 'intro-a', 'Intro Tenant A', 'a.intro.example');

-- Trójka: proszący R, most B (z avatarem), cel T - wszyscy w jednym tenancie.
INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'r@intro.test'),
  ('d0000000-0000-0000-0000-0000000000b1', 'b@intro.test'),
  ('d0000000-0000-0000-0000-0000000000c1', 't@intro.test'),
  ('d0000000-0000-0000-0000-0000000000d1', 't1b@intro.test');

INSERT INTO public.profiles (id, email, display_name, avatar_url, tenant_id) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'r@intro.test', 'Requester', NULL,
   'd1a11111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-0000000000b1', 'b@intro.test', 'Bridge',
   'https://cdn/bridge.jpg', 'd1a11111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-0000000000c1', 't@intro.test', 'Target', NULL,
   'd1a11111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-0000000000d1', 't1b@intro.test', 'Target B', NULL,
   'd1a11111-1111-1111-1111-111111111111');

-- Dwie oczekujące prośby: intro1 (do przekazania), intro2 (do wycofania).
--
-- INTRO2 CELUJE W INNĄ OSOBĘ (Target B) i to jest zmiana wymuszona przez
-- 20260913171000, a nie kosmetyka. Do tej pory oba wiersze miały tę SAMĄ trójkę
-- (R, B, T) w stanie `pending` - czyli fixture kodował dokładnie ten stan, który
-- indeks `introduction_requests_active_uidx` od teraz wyklucza jako defekt
-- (jedna aktywna prośba na trójkę). Rozdzielony jest CEL, a nie most, bo obie
-- asercje niżej mówią o rolach `bridge` i `requester`, więc pozostają dosłownie
-- tym samym twierdzeniem, co przed zmianą.
INSERT INTO public.introduction_requests
  (id, tenant_id, requester_id, bridge_id, target_id, message, status) VALUES
  ('11110000-0000-0000-0000-000000000001', 'd1a11111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000b1',
   'd0000000-0000-0000-0000-0000000000c1', 'Prosze o wprowadzenie do celu.', 'pending'),
  ('11110000-0000-0000-0000-000000000002', 'd1a11111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000b1',
   'd0000000-0000-0000-0000-0000000000d1', 'Druga prosba do wycofania teraz.', 'pending');

SET LOCAL ROLE authenticated;

-- ── Most przekazuje intro1 ──────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.respond_introduction('11110000-0000-0000-0000-000000000001', 'forward')$$,
  'most: forward oczekującej prośby przechodzi'
);
SELECT is(
  (SELECT status FROM public.introduction_requests
     WHERE id = '11110000-0000-0000-0000-000000000001'),
  'forwarded',
  'most: status po forward = forwarded'
);

-- Most NIE może przekazać cudzej (już nie-pending) prośby ponownie.
SELECT throws_ok(
  $$SELECT public.respond_introduction('11110000-0000-0000-0000-000000000001', 'forward')$$,
  NULL,
  'most: ponowny forward nie-pending prośby jest odrzucony'
);

-- ── Cel widzi przekazane wprowadzenie z avatarem mostu ──────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SELECT is(
  (SELECT bridge_avatar FROM public.my_introduction_requests('target')
     WHERE id = '11110000-0000-0000-0000-000000000001'),
  'https://cdn/bridge.jpg',
  'target: RPC zwraca avatar mostu (naprawiona zakładka "O mnie")'
);

-- ── Proszący wycofuje intro2 ────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.respond_introduction('11110000-0000-0000-0000-000000000002', 'withdraw')$$,
  'proszący: withdraw własnej oczekującej prośby przechodzi (wcześniej: wyjątek)'
);
SELECT is(
  (SELECT status FROM public.introduction_requests
     WHERE id = '11110000-0000-0000-0000-000000000002'),
  'withdrawn',
  'proszący: status po withdraw = withdrawn'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- request_introduction: bramki prywatności i deduplikacja (20260913171000)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Trójka R2 -> B2 -> T2 z ZAAKCEPTOWANYMI relacjami R2-B2 i B2-T2, bo bez nich
-- funkcja odpada na wcześniejszym warunku i test bramki prywatności mierzyłby
-- kształt trójkąta, a nie prywatność.
--
-- `RESET ROLE` PRZED fiksturą: wyżej stoi już `SET LOCAL ROLE authenticated`,
-- a `authenticated` nie ma prawa pisać do `auth.users` (i nie ma go mieć -
-- to konto aplikacji, nie migracji). Bez tego cała sekcja pada na
-- "permission denied for table users", zanim dojdzie do pierwszej asercji.
RESET ROLE;

INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-0000000000a2', 'r2@intro.test'),
  ('d0000000-0000-0000-0000-0000000000b2', 'b2@intro.test'),
  ('d0000000-0000-0000-0000-0000000000c2', 't2@intro.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('d0000000-0000-0000-0000-0000000000a2', 'r2@intro.test', 'Requester 2',
   'd1a11111-1111-1111-1111-111111111111', true),
  ('d0000000-0000-0000-0000-0000000000b2', 'b2@intro.test', 'Bridge 2',
   'd1a11111-1111-1111-1111-111111111111', true),
  ('d0000000-0000-0000-0000-0000000000c2', 't2@intro.test', 'Target 2',
   'd1a11111-1111-1111-1111-111111111111', true);

-- Relacje idą TĄ SAMĄ DROGĄ, CO APLIKACJA: `tg_user_connections_guard`
-- (20260717162432:63) dopuszcza wyłącznie INSERT w stanie 'pending' i dopiero
-- przejście pending -> accepted. Fikstura wstawiająca od razu 'accepted'
-- wywraca się na wyzwalaczu, zanim dojdzie do jakiejkolwiek asercji. Ten sam
-- wzorzec, co w `connection_degree_test.sql`.
INSERT INTO public.user_connections (requester_id, addressee_id) VALUES
  ('d0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000b2'),
  ('d0000000-0000-0000-0000-0000000000b2', 'd0000000-0000-0000-0000-0000000000c2');
UPDATE public.user_connections
   SET status = 'accepted', responded_at = now()
 WHERE requester_id IN ('d0000000-0000-0000-0000-0000000000a2',
                        'd0000000-0000-0000-0000-0000000000b2');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

-- ── Ścieżka szczęśliwa: komplet warunków spełniony ──────────────────────────
SELECT lives_ok(
  $$SELECT public.request_introduction(
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000c2',
      'Prosze o wprowadzenie do celu w sprawie energii.')$$,
  'request: komplet warunków spełniony - prośba przechodzi'
);

-- ── DEDUPLIKACJA: drugie wywołanie tej samej trójki ─────────────────────────
-- Przed 20260913171000 ochroną było WYŁĄCZNIE `usedBridges` liczone w kliencie
-- z zapytania o `staleTime: 15_000` - dwie karty obok siebie zakładały dwa
-- wiersze i most dostawał tę samą prośbę dwa razy.
SELECT is(
  (SELECT public.request_introduction(
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000c2',
      'Zupelnie inna tresc, ta sama trojka osob.')),
  (SELECT id FROM public.introduction_requests
    WHERE requester_id = 'd0000000-0000-0000-0000-0000000000a2'
      AND status = 'pending'),
  'dedup: powtórzenie zwraca id istniejącej prośby (bezszkodliwie, bez wyjątku)'
);
SELECT is(
  (SELECT count(*)::int FROM public.introduction_requests
    WHERE requester_id = 'd0000000-0000-0000-0000-0000000000a2'
      AND bridge_id = 'd0000000-0000-0000-0000-0000000000b2'
      AND target_id = 'd0000000-0000-0000-0000-0000000000c2'
      AND status = 'pending'),
  1,
  'dedup: po dwóch wywołaniach istnieje DOKŁADNIE JEDEN aktywny wiersz'
);

-- Sprzątamy aktywną prośbę, żeby kolejne przypadki mierzyły BRAMKĘ, a nie
-- deduplikację (ta odpowiedziałaby id istniejącego wiersza przed odmową).
RESET ROLE;
UPDATE public.introduction_requests SET status = 'withdrawn'
 WHERE requester_id = 'd0000000-0000-0000-0000-0000000000a2';
SET LOCAL ROLE authenticated;

-- ── BRAMKA 1: blokada pary ──────────────────────────────────────────────────
RESET ROLE;
INSERT INTO public.user_blocks (blocker_id, blocked_id, tenant_id) VALUES
  ('d0000000-0000-0000-0000-0000000000c2', 'd0000000-0000-0000-0000-0000000000a2',
   'd1a11111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.request_introduction(
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000c2',
      'Prosze o wprowadzenie do celu w sprawie energii.')$$,
  'connections: peer not available',
  'bramka: cel, który mnie ZABLOKOWAŁ, jest nieosiągalny drogą wprowadzenia'
);
SELECT is(
  (SELECT count(*)::int FROM public.introduction_requests
    WHERE requester_id = 'd0000000-0000-0000-0000-0000000000a2' AND status = 'pending'),
  0,
  'bramka: odmowa nie zostawia wiersza (most nie dostaje powiadomienia)'
);

-- ── BRAMKA 2: cel zdjął `discoverable` ──────────────────────────────────────
RESET ROLE;
DELETE FROM public.user_blocks
 WHERE blocker_id = 'd0000000-0000-0000-0000-0000000000c2';
UPDATE public.profiles SET discoverable = false
 WHERE id = 'd0000000-0000-0000-0000-0000000000c2';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.request_introduction(
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000c2',
      'Prosze o wprowadzenie do celu w sprawie energii.')$$,
  'connections: peer not available',
  'bramka: cel bez discoverable jest nieosiągalny - TEN SAM komunikat'
);

-- ── BRAMKA 3: cel nie przyjmuje zaproszeń ───────────────────────────────────
RESET ROLE;
UPDATE public.profiles SET discoverable = true
 WHERE id = 'd0000000-0000-0000-0000-0000000000c2';
-- `tenant_id` jest tu NOT NULL (20260710152630:4), więc musi paść jawnie -
-- preferencje powiadomień są zakresowane najemcą tak samo, jak profil.
INSERT INTO public.notification_preferences (user_id, tenant_id, allow_connections_from)
VALUES ('d0000000-0000-0000-0000-0000000000c2',
        'd1a11111-1111-1111-1111-111111111111', 'nobody')
ON CONFLICT (user_id) DO UPDATE SET allow_connections_from = 'nobody';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.request_introduction(
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000c2',
      'Prosze o wprowadzenie do celu w sprawie energii.')$$,
  'connections: peer not available',
  'bramka: cel z allow_connections_from = nobody - TEN SAM komunikat'
);

-- ── LIMIT DOBOWY NIE MOŻE ZJEŚĆ POWTÓRZENIA ────────────────────────────────
--
-- Znalezione w przeglądzie PR #361 (Codex, P2): sprawdzenie limitu stało PRZED
-- wyszukaniem istniejącego wiersza, więc proszący z pięcioma oczekującymi
-- prośbami, ponawiając trójkę, KTÓRA JEST JUŻ WŚRÓD TYCH PIĘCIU, dostawał
-- 'rate limited' zamiast identyfikatora. Obietnica bezszkodliwego powtórzenia
-- pękała dokładnie na granicy limitu - czyli tam, gdzie użytkownik ponawia
-- najczęściej (zgubiona odpowiedź, druga karta).
--
-- Oba twierdzenia stoją razem, bo dopiero para czyni z tego kontrakt:
-- powtórzenie MA przechodzić, a nowa prośba ponad limitem MA odpadać.
RESET ROLE;
INSERT INTO auth.users (id, email)
  SELECT ('d9000000-0000-0000-0000-00000000000' || g)::uuid, 'q' || g || '@intro.test'
    FROM generate_series(1, 8) g;
INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable)
  SELECT ('d9000000-0000-0000-0000-00000000000' || g)::uuid, 'q' || g || '@intro.test',
         'Limit ' || g, 'd1a11111-1111-1111-1111-111111111111', true
    FROM generate_series(1, 8) g;
-- Jak wyżej: wstawka w 'pending', dopiero potem przejście na 'accepted'.
INSERT INTO public.user_connections (requester_id, addressee_id)
  SELECT 'd9000000-0000-0000-0000-000000000002',
         ('d9000000-0000-0000-0000-00000000000' || g)::uuid
    FROM generate_series(3, 8) g;
INSERT INTO public.user_connections (requester_id, addressee_id) VALUES
  ('d9000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000002');
UPDATE public.user_connections
   SET status = 'accepted', responded_at = now()
 WHERE requester_id IN ('d9000000-0000-0000-0000-000000000001',
                        'd9000000-0000-0000-0000-000000000002');
-- Pięć oczekujących prośb = dokładnie limit dobowy.
INSERT INTO public.introduction_requests
  (tenant_id, requester_id, bridge_id, target_id, message, status)
  SELECT 'd1a11111-1111-1111-1111-111111111111',
         'd9000000-0000-0000-0000-000000000001',
         'd9000000-0000-0000-0000-000000000002',
         ('d9000000-0000-0000-0000-00000000000' || g)::uuid,
         'Prosba numer ' || g || ' o wprowadzenie do celu.', 'pending'
    FROM generate_series(3, 7) g;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT public.request_introduction(
      'd9000000-0000-0000-0000-000000000002',
      'd9000000-0000-0000-0000-000000000003',
      'Ponowienie tej samej prosby po zgubionej odpowiedzi.')),
  (SELECT id FROM public.introduction_requests
    WHERE requester_id = 'd9000000-0000-0000-0000-000000000001'
      AND target_id = 'd9000000-0000-0000-0000-000000000003'
      AND status = 'pending'),
  'limit: powtórzenie trójki NA GRANICY limitu zwraca istniejące id, nie błąd'
);

SELECT throws_ok(
  $$SELECT public.request_introduction(
      'd9000000-0000-0000-0000-000000000002',
      'd9000000-0000-0000-0000-000000000008',
      'Zupelnie nowa prosba ponad limitem dobowym.')$$,
  'rate limited',
  'limit: NOWA prośba ponad limitem nadal odpada (kolejność nie luzuje kwoty)'
);

SELECT * FROM finish();
ROLLBACK;
