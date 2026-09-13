-- pgTAP: CAŁA decyzja zgód RODO zapisuje się albo w całości, albo wcale.
--
-- Weryfikuje migrację 20260913170000_set_user_consents_atomic.sql.
--
-- PO CO TO STOI. `setMyConsentsBulk` dostaje JEDNĄ decyzję z banera („odrzuć
-- wszystko", „zapisz wybrane") obejmującą kilka kategorii cookie naraz, a
-- zapisywał ją PĘTLĄ po osobnych wywołaniach `set_user_consent`. Każde z nich
-- to własna transakcja, więc błąd na trzeciej z pięciu kategorii zostawiał dwie
-- pierwsze ZATWIERDZONE: użytkownik klikał „odrzuć wszystko", a część zgód
-- zostawała włączona - trwale i bez komunikatu. Ścieżka naprawcza tego nie
-- łapie (`backfillRegistryOnLogin` uzupełnia wyłącznie klucze NIEOBECNE
-- w rejestrze, a te są obecne, tyle że ze starą wartością).
--
-- Rejestr zgód jest dowodem, na czyją zgodę powołuje się administrator danych,
-- więc rozjazd między tym, co wybrał użytkownik, a tym, co stoi w bazie, jest
-- naruszeniem zapisu zgody - nie usterką kosmetyczną.
--
-- CZEGO TEN TEST PILNUJE. Nie tego, że funkcja istnieje, tylko SKUTKU przerwania
-- w połowie: po nieudanej decyzji stan MUSI być bit w bit taki, jak przed nią -
-- razem z brakiem zdarzeń audytowych z przerwanej próby.
--
-- WYZWALACZE UŻYTKOWNIKA WYŁĄCZONE - konwencja tej suity: `on_auth_user_created`
-- woła `handle_new_user()`, który sam zakłada wiersz w `public.profiles`, więc
-- ręczne wstawienie profilu padłoby na kluczu głównym przed pierwszą asercją.

BEGIN;
SELECT plan(8);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c0000000-0000-4000-8000-00000000000c', 'consent-tenant', 'Consent Tenant');

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-1111-4000-8000-00000000000c', 'zgody@example.org');

INSERT INTO public.profiles (id, tenant_id, email) VALUES
  ('c0000000-1111-4000-8000-00000000000c',
   'c0000000-0000-4000-8000-00000000000c',
   'zgody@example.org');

SELECT has_function(
  'public', 'set_user_consents', ARRAY['jsonb'],
  'set_user_consents(jsonb) istnieje - to ona niesie całą decyzję w jednej transakcji'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-1111-4000-8000-00000000000c","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- 1) Stan wyjściowy: trzy kategorie WŁĄCZONE.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.set_user_consents('[
       {"key":"analytics","given":true,"version":"1","gpc":false,"source":"account"},
       {"key":"marketing","given":true,"version":"1","gpc":false,"source":"account"},
       {"key":"functional","given":true,"version":"1","gpc":false,"source":"account"}
     ]'::jsonb) $$,
  'decyzja poprawna przechodzi w całości'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_consents WHERE given), 3,
  'trzy kategorie są włączone - to jest stan, którego broni następny przypadek'
);

-- ---------------------------------------------------------------------------
-- 2) SEDNO: decyzja, w której DRUGI wpis jest nieprawidłowy (pusta wersja ->
--    `set_user_consent` rzuca `invalid_version`). Pierwszy wpis zdążyłby się
--    zapisać, gdyby każdy szedł własną transakcją - i dokładnie tak było.
-- ---------------------------------------------------------------------------
SELECT throws_like(
  $$ SELECT public.set_user_consents('[
       {"key":"analytics","given":false,"version":"2","gpc":false,"source":"banner"},
       {"key":"marketing","given":false,"version":"","gpc":false,"source":"banner"},
       {"key":"functional","given":false,"version":"2","gpc":false,"source":"banner"}
     ]'::jsonb) $$,
  '%invalid_version%',
  'przerwana decyzja podnosi wyjątek zamiast zapisać się częściowo'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_consents WHERE given), 3,
  'po nieudanej decyzji NADAL trzy włączone - wpis przed błędem został wycofany'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_consents WHERE version <> '1'), 0,
  'żadna kategoria nie została przestawiona na wersję z przerwanej decyzji'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_consent_events WHERE version = '2'), 0,
  'ani jedno zdarzenie audytowe z przerwanej decyzji nie zostało w dzienniku'
);

-- ---------------------------------------------------------------------------
-- 3) Sufit partii odwzorowuje `SetConsentsBulkSchema` (max 10). Baza powtarza
--    limit warstwy aplikacji, bo wywołanie RPC może przyjść z pominięciem Zoda.
-- ---------------------------------------------------------------------------
SELECT throws_like(
  $$ SELECT public.set_user_consents(
       (SELECT jsonb_agg(jsonb_build_object(
          'key', 'k' || i, 'given', true, 'version', '1', 'gpc', false))
        FROM generate_series(1, 11) AS i)) $$,
  '%too_many_entries%',
  'partia większa niż katalog kategorii jest odrzucana przez bazę'
);

SELECT * FROM finish();
ROLLBACK;
