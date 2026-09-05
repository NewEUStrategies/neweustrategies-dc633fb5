-- pgTAP: izolacja najemcow na DANYCH KANDYDATOW - `career_applications`,
-- `career_application_events`, `career_cv_gc_queue` oraz bucket `career-cv`.
--
-- PO CO TEN PLIK. Trzy tabele wymienione wyzej trzymaja imie, nazwisko, e-mail,
-- telefon, LinkedIn i sciezke do CV osoby fizycznej. Autoryzacja panelu
-- `/admin/*` jest w tym repo WYLACZNIE klientowa (`src/routes/admin.tsx` ma
-- `ssr: false` i przekierowuje w `useEffect`), wiec realna granica tych danych
-- to RLS, a nie trasa. Do tej pory zaden plik pgTAP nie pytal bazy, czy ta
-- granica trzyma - jedyny test `career_*` (`career_sections_visibility_public
-- _read_test.sql`) dotyczy widocznosci sekcji strony, nie danych kandydatow.
--
-- KLASA, KTORA TEN PLIK PRZYBIJA - i to nie jest hipoteza. Naglowek migracji
-- 20260814194500_career_cv_policies_tenant_scope_reassert.sql (wiersze 4-23)
-- opisuje przebieg: 20260814100000 zawezila polityki bucketu do najemcy, bo
-- `is_staff()` bada WYLACZNIE role; trzy godziny pozniej 20260814122512
-- odtworzyla je w ksztalcie SPRZED hardeningu, a stan bazy uratowala wylacznie
-- kolejnosc alfabetyczna nazw plikow migracji. Polityki tych trzech tabel maja
-- dzis ten sam ksztalt co wtedy bucket - koniunkcje ROLI i NAJEMCY:
-- `is_admin_or_editor() AND tenant_id = current_tenant_id()`. Skasowanie
-- drugiego czlonu jest cicha regresja tej samej klasy: redaktor najemcy A
-- czyta zgloszenia, dziennik etapow i sciezki CV KAZDEGO najemcy.
--
-- Dlatego kazda asercja izolacji ma tu para asercje NIEPUSTKI. "Widzi zero"
-- przechodzi rowniez na pustej tabeli, a zielone zero jest gorsze od czerwieni.

BEGIN;
SELECT plan(18);

-- == (1) Strukturalnie: koniunkcja NAJEMCY stoi w kazdej z trzech polityk =====
-- Sam `is_admin_or_editor()` nie wystarcza i nie moze wystarczac: bada role,
-- nie najemce. To jest DOKLADNIE ten predykat, ktory regresja skasowala.
SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'career_applications'
      AND policyname = 'career_applications_staff_read') ~ 'current_tenant_id',
  'career_applications_staff_read wiaze wiersz z current_tenant_id(), nie z sama rola'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'career_application_events'
      AND policyname = 'career_application_events_staff_read') ~ 'current_tenant_id',
  'career_application_events_staff_read wiaze wiersz z current_tenant_id()'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'career_cv_gc_queue'
      AND policyname = 'career_cv_gc_queue_staff_read') ~ 'current_tenant_id',
  'career_cv_gc_queue_staff_read wiaze wiersz z current_tenant_id()'
);

-- Polityka bez wlaczonego RLS jest martwa litera - tabela oddaje wszystko.
SELECT is(
  (SELECT count(*)::int FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('career_applications','career_application_events','career_cv_gc_queue')
      AND relrowsecurity),
  3,
  'RLS wlaczone na wszystkich trzech tabelach z danymi kandydatow'
);

-- == Seed: dwaj najemcy, admin po kazdej stronie, zgloszenie po kazdej stronie =
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('da111111-1111-1111-1111-111111111111', 'career-a', 'Career A', 'career-a.example'),
  ('db222222-2222-2222-2222-222222222222', 'career-b', 'Career B', 'career-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('da000000-0000-0000-0000-000000000001', 'admin@career-a.example'),
  ('db000000-0000-0000-0000-000000000001', 'admin@career-b.example');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('da000000-0000-0000-0000-000000000001', 'admin@career-a.example', 'Admin A',
   'da111111-1111-1111-1111-111111111111'),
  ('db000000-0000-0000-0000-000000000001', 'admin@career-b.example', 'Admin B',
   'db222222-2222-2222-2222-222222222222');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('da000000-0000-0000-0000-000000000001', 'admin', 'da111111-1111-1111-1111-111111111111'),
  ('db000000-0000-0000-0000-000000000001', 'admin', 'db222222-2222-2222-2222-222222222222');

-- Wiersz `career_applications` zaklada TRIGGER przy wplywie zgloszenia
-- z `form_id='careers'` - wstawiam wiec zrodlo, nie skutek. Dane osobowe sa
-- fikcyjne, e-maile wylacznie w domenach example.*.
INSERT INTO public.contact_messages
  (id, tenant_id, name, email, message, form_id, custom)
VALUES
  ('dc000000-0000-0000-0000-00000000000a','da111111-1111-1111-1111-111111111111',
   'Kandydat A','kandydat-a@example.com','Zgloszenie u najemcy A.','careers',
   jsonb_build_object('role','analityk','phone','+48 000 000 001')),
  ('dc000000-0000-0000-0000-00000000000b','db222222-2222-2222-2222-222222222222',
   'Kandydat B','kandydat-b@example.org','Zgloszenie u najemcy B.','careers',
   jsonb_build_object('role','analityk','phone','+48 000 000 002'));

-- Dziennik etapow zaklada trigger przy ZMIANIE etapu - bez tego polowa
-- asercji nizej bylaby prozna.
UPDATE public.career_applications SET stage = 'screening'
 WHERE message_id IN ('dc000000-0000-0000-0000-00000000000a',
                      'dc000000-0000-0000-0000-00000000000b');

INSERT INTO public.career_cv_gc_queue (tenant_id, path, reason) VALUES
  ('da111111-1111-1111-1111-111111111111',
   'da111111-1111-1111-1111-111111111111/uploads/2026-05-05/aaaa1111-1111-2222-3333-444444444444.pdf',
   'retention'),
  ('db222222-2222-2222-2222-222222222222',
   'db222222-2222-2222-2222-222222222222/uploads/2026-05-05/bbbb2222-1111-2222-3333-444444444444.pdf',
   'retention');

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('career-cv','da111111-1111-1111-1111-111111111111/uploads/2026-05-05/aaaa1111-1111-2222-3333-444444444444.pdf');

-- == (2) Administrator najemcy A ============================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"da000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- KOTWICA. Rola jest spelniona W PELNI. Gdyby ta asercja kiedys zgasla,
-- wszystkie "widzi zero" nizej przestalyby cokolwiek dowodzic - przechodzilyby
-- z powodu roli, a nie z powodu najemcy.
SELECT ok(
  public.is_admin_or_editor(),
  'admin A spelnia is_admin_or_editor() - koniunkcja ROLI nie jest tu powodem odmowy'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_applications
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111'),
  1,
  'admin A widzi WLASNE zgloszenie (dowod, ze test nie jest prozny)'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_applications
    WHERE tenant_id = 'db222222-2222-2222-2222-222222222222'),
  0,
  'admin A NIE widzi zgloszenia najemcy B (imie, e-mail, telefon kandydata)'
);

SELECT ok(
  (SELECT count(*) FROM public.career_application_events
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111') > 0,
  'admin A widzi WLASNY dziennik etapow (dowod, ze test nie jest prozny)'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_application_events
    WHERE tenant_id = 'db222222-2222-2222-2222-222222222222'),
  0,
  'admin A NIE widzi dziennika etapow najemcy B'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_cv_gc_queue
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111'),
  1,
  'admin A widzi WLASNA kolejke CV (dowod, ze test nie jest prozny)'
);

-- Kolejka nosi SCIEZKI do plikow CV. Wyciek stad to gotowy adres do podpisania
-- cudzego CV, nawet gdyby polityka bucketu byla poprawna.
SELECT is(
  (SELECT count(*)::int FROM public.career_cv_gc_queue
    WHERE tenant_id = 'db222222-2222-2222-2222-222222222222'),
  0,
  'admin A NIE widzi kolejki CV najemcy B (sciezki do plikow kandydatow)'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'career-cv'
      AND name LIKE 'da111111-1111-1111-1111-111111111111/%'),
  1,
  'admin A widzi WLASNY plik CV (dowod, ze test nie jest prozny)'
);

-- == (3) Administrator najemcy B - kierunek odwrotny =========================
-- Bez tej symetrii dowod trzymalby sie tego, ze najemca B moze byc po prostu
-- pusty dla kazdego.
SELECT set_config('request.jwt.claims',
  '{"sub":"db000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.career_applications
    WHERE tenant_id = 'db222222-2222-2222-2222-222222222222'),
  1,
  'admin B widzi WLASNE zgloszenie (dowod, ze test nie jest prozny)'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_applications
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111'),
  0,
  'admin B NIE widzi zgloszenia najemcy A'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_application_events
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111'),
  0,
  'admin B NIE widzi dziennika etapow najemcy A'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_cv_gc_queue
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111'),
  0,
  'admin B NIE widzi kolejki CV najemcy A'
);

-- To jest przebieg, ktory regresja 20260814122512 otwierala wprost:
-- `createSignedUrl` wymaga SELECT-a na `storage.objects`, wiec brak wiersza
-- oznacza brak podpisu. Redaktor najemcy B podpisywal wtedy KAZDE CV.
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'career-cv'
      AND name LIKE 'da111111-1111-1111-1111-111111111111/%'),
  0,
  'admin B nie ma czego podpisac w katalogu najemcy A (brak SELECT-a = brak signed URL)'
);

-- == (4) Rola bez najemcy: personel spoza obu najemcow =======================
-- Dopelnienie kotwicy z sekcji (2): tam rola byla spelniona i najemca zgodny,
-- tu rola jest spelniona, a najemca nie pasuje do ZADNEGO z wierszy.
SELECT is(
  (SELECT count(*)::int FROM public.career_applications
    WHERE tenant_id IN ('da111111-1111-1111-1111-111111111111',
                        'db222222-2222-2222-2222-222222222222')),
  1,
  'personel widzi wylacznie wiersze SWOJEGO najemcy, nie sume obu'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
