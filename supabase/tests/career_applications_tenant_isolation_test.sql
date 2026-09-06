-- pgTAP: izolacja najemcow na powierzchni rekrutacji - `contact_messages`
-- (dane osobowe kandydata), `career_applications`, `career_application_events`,
-- `career_cv_gc_queue` (warstwa procesu i sciezki CV) oraz bucket `career-cv`.
--
-- GDZIE NAPRAWDE LEZA DANE OSOBOWE - sprostowanie pierwszej wersji tego pliku.
-- Pierwsza wersja twierdzila, ze imie, nazwisko, e-mail, telefon i LinkedIn
-- trzymaja trzy tabele `career_*`. To NIEPRAWDA: `\d career_applications` to
-- id / tenant_id / message_id / stage / stage_changed_at / stage_note /
-- owner_id / rating / rejection_reason / next_step_at / created_at /
-- updated_at. Zadnej z tych kolumn tam nie ma. Dane osobowe kandydata siedza
-- w `public.contact_messages` (tam idzie publiczny zapis formularza), a tabele
-- `career_*` dokladaja WARSTWE PROCESU i - w `career_cv_gc_queue` - SCIEZKI
-- do plikow CV. Dlatego ten plik dowodzi izolacji CZTERECH tabel, nie trzech:
-- bez `contact_messages` dowod omijalby dokladnie te tabele, o ktora chodzi.
--
-- PO CO TEN PLIK. Autoryzacja panelu `/admin/*` jest w tym repo WYLACZNIE
-- klientowa (`src/routes/admin.tsx` ma `ssr: false` i przekierowuje
-- w `useEffect`), wiec realna granica tych danych to RLS, a nie trasa.
--
-- KLASA, KTORA PLIK PRZYBIJA - i to nie jest hipoteza. Naglowek migracji
-- 20260814194500_career_cv_policies_tenant_scope_reassert.sql (wiersze 4-23)
-- opisuje przebieg: 20260814100000 zawezila polityki bucketu do najemcy, bo
-- `is_staff()` bada WYLACZNIE role; trzy godziny pozniej 20260814122512
-- odtworzyla je w ksztalcie SPRZED hardeningu, a stan bazy uratowala wylacznie
-- kolejnosc alfabetyczna nazw plikow migracji.
--
-- KAZDA asercja izolacji ma tu PARE - asercje niepustki po TEJ SAMEJ stronie,
-- ktora ma zero. "Widzi zero" przechodzi rowniez na pustej tabeli, a zielone
-- zero jest gorsze od czerwieni.

BEGIN;
SELECT plan(29);

-- == (1) Strukturalnie: koniunkcja NAJEMCY w kazdej polityce odczytu =========
-- Asercje sa mocniejsze niz sam fakt wystapienia `current_tenant_id`: wymagaja
-- KONIUNKCJI i jawnie wykluczaja `OR`, bo `rola OR najemca` to pelny obchod,
-- a tekst polityki nadal zawieralby oba czlony.
SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname='public'
     AND tablename='career_applications' AND policyname='career_applications_staff_read')
    ~ 'tenant_id = current_tenant_id\(\)'
  AND (SELECT qual FROM pg_policies WHERE schemaname='public'
     AND tablename='career_applications' AND policyname='career_applications_staff_read')
    !~ ' OR ',
  'career_applications_staff_read: koniunkcja z current_tenant_id(), bez OR'
);

SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname='public'
     AND tablename='career_application_events' AND policyname='career_application_events_staff_read')
    ~ 'tenant_id = current_tenant_id\(\)'
  AND (SELECT qual FROM pg_policies WHERE schemaname='public'
     AND tablename='career_application_events' AND policyname='career_application_events_staff_read')
    !~ ' OR ',
  'career_application_events_staff_read: koniunkcja z current_tenant_id(), bez OR'
);

SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname='public'
     AND tablename='career_cv_gc_queue' AND policyname='career_cv_gc_queue_staff_read')
    ~ 'tenant_id = current_tenant_id\(\)'
  AND (SELECT qual FROM pg_policies WHERE schemaname='public'
     AND tablename='career_cv_gc_queue' AND policyname='career_cv_gc_queue_staff_read')
    !~ ' OR ',
  'career_cv_gc_queue_staff_read: koniunkcja z current_tenant_id(), bez OR'
);

-- Tabela z danymi osobowymi kandydata. Bez tej asercji plik pilnowalby
-- warstwy procesu i przegapil warstwe, o ktora chodzi.
SELECT ok(
  (SELECT qual FROM pg_policies WHERE schemaname='public'
     AND tablename='contact_messages' AND policyname='Admins and editors can read contact messages')
    ~ 'tenant_id = current_tenant_id\(\)'
  AND (SELECT qual FROM pg_policies WHERE schemaname='public'
     AND tablename='contact_messages' AND policyname='Admins and editors can read contact messages')
    !~ ' OR \(tenant_id',
  'contact_messages read: koniunkcja z current_tenant_id() (tabela z danymi osobowymi)'
);

-- Polityka bez wlaczonego RLS jest martwa litera - tabela oddaje wszystko.
SELECT is(
  (SELECT count(*)::int FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('career_applications','career_application_events',
                      'career_cv_gc_queue','contact_messages')
      AND relrowsecurity),
  4,
  'RLS wlaczone na wszystkich czterech tabelach powierzchni rekrutacji'
);

-- NAJSLABSZE OGNIWO CALEJ KONSTRUKCJI. Kazda z powyzszych koniunkcji opiera sie
-- na `current_tenant_id()`. Gdyby ta funkcja czytala najemce z czegokolwiek, co
-- podaje KLIENT, wszystkie polityki w repozytorium daloby sie obejsc jednym
-- naglowkiem, a asercje tekstowe wyzej nadal by przechodzily - bo `qual` sie
-- nie zmienia. Funkcja ma czytac `profiles` po `auth.uid()` i nic wiecej.
SELECT ok(
  pg_get_functiondef('public.current_tenant_id()'::regprocedure) ~ 'profiles'
  AND pg_get_functiondef('public.current_tenant_id()'::regprocedure) !~ 'current_setting',
  'current_tenant_id() bierze najemce z profiles po auth.uid(), NIE z ustawienia podanego przez klienta'
);

-- == Seed: trzej najemcy, personel po kazdej stronie ==========================
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('da111111-1111-1111-1111-111111111111', 'career-a', 'Career A', 'career-a.example'),
  ('db222222-2222-2222-2222-222222222222', 'career-b', 'Career B', 'career-b.example'),
  ('dc333333-3333-3333-3333-333333333333', 'career-c', 'Career C', 'career-c.example');

INSERT INTO auth.users (id, email) VALUES
  ('da000000-0000-0000-0000-000000000001', 'admin@career-a.example'),
  ('db000000-0000-0000-0000-000000000001', 'admin@career-b.example'),
  ('dc000000-0000-0000-0000-000000000001', 'admin@career-c.example');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('da000000-0000-0000-0000-000000000001', 'admin@career-a.example', 'Admin A',
   'da111111-1111-1111-1111-111111111111'),
  ('db000000-0000-0000-0000-000000000001', 'admin@career-b.example', 'Admin B',
   'db222222-2222-2222-2222-222222222222'),
  ('dc000000-0000-0000-0000-000000000001', 'admin@career-c.example', 'Admin C',
   'dc333333-3333-3333-3333-333333333333');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('da000000-0000-0000-0000-000000000001', 'admin', 'da111111-1111-1111-1111-111111111111'),
  ('db000000-0000-0000-0000-000000000001', 'admin', 'db222222-2222-2222-2222-222222222222'),
  ('dc000000-0000-0000-0000-000000000001', 'admin', 'dc333333-3333-3333-3333-333333333333');

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

-- Dziennik etapow zaklada trigger przy ZMIANIE etapu.
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

-- == (2) Administrator najemcy A =============================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"da000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- KOTWICA. Rola jest spelniona W PELNI, wiec kazde "widzi zero" nizej moze
-- brac sie wylacznie z najemcy.
SELECT ok(
  public.is_admin_or_editor(),
  'admin A spelnia is_admin_or_editor() - koniunkcja ROLI nie jest tu powodem odmowy'
);

-- -- dane osobowe kandydata --------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.contact_messages
    WHERE tenant_id='da111111-1111-1111-1111-111111111111' AND form_id='careers'),
  1,
  'admin A widzi WLASNE zgloszenie z danymi osobowymi (dowod niepustki)'
);

SELECT is(
  (SELECT count(*)::int FROM public.contact_messages
    WHERE tenant_id='db222222-2222-2222-2222-222222222222'),
  0,
  'admin A NIE widzi danych osobowych kandydata najemcy B (imie, e-mail, telefon)'
);

-- -- warstwa procesu ---------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.career_applications
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111'),
  1,
  'admin A widzi WLASNY proces rekrutacyjny (dowod niepustki)'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_applications
    WHERE tenant_id = 'db222222-2222-2222-2222-222222222222'),
  0,
  'admin A NIE widzi procesu najemcy B'
);

SELECT ok(
  (SELECT count(*) FROM public.career_application_events
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111') > 0,
  'admin A widzi WLASNY dziennik etapow (dowod niepustki)'
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
  'admin A widzi WLASNA kolejke CV (dowod niepustki)'
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
  'admin A widzi WLASNY plik CV (dowod niepustki dla asercji bucketu nizej)'
);

-- == (3) Administrator najemcy B - kierunek odwrotny =========================
-- Bez symetrii dowod trzymalby sie tego, ze najemca B moze byc po prostu pusty.
-- KAZDE "widzi zero" ma tu wlasna pare niepustki po stronie B.
SELECT set_config('request.jwt.claims',
  '{"sub":"db000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.contact_messages
    WHERE tenant_id='db222222-2222-2222-2222-222222222222' AND form_id='careers'),
  1,
  'admin B widzi WLASNE zgloszenie z danymi osobowymi (dowod niepustki)'
);

SELECT is(
  (SELECT count(*)::int FROM public.contact_messages
    WHERE tenant_id='da111111-1111-1111-1111-111111111111'),
  0,
  'admin B NIE widzi danych osobowych kandydata najemcy A'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_applications
    WHERE tenant_id = 'db222222-2222-2222-2222-222222222222'),
  1,
  'admin B widzi WLASNY proces (dowod niepustki)'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_applications
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111'),
  0,
  'admin B NIE widzi procesu najemcy A'
);

SELECT ok(
  (SELECT count(*) FROM public.career_application_events
    WHERE tenant_id = 'db222222-2222-2222-2222-222222222222') > 0,
  'admin B widzi WLASNY dziennik etapow (dowod niepustki - bez tego asercja nizej jest prozna)'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_application_events
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111'),
  0,
  'admin B NIE widzi dziennika etapow najemcy A'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_cv_gc_queue
    WHERE tenant_id = 'db222222-2222-2222-2222-222222222222'),
  1,
  'admin B widzi WLASNA kolejke CV (dowod niepustki - bez tego asercja nizej jest prozna)'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_cv_gc_queue
    WHERE tenant_id = 'da111111-1111-1111-1111-111111111111'),
  0,
  'admin B NIE widzi kolejki CV najemcy A'
);

-- To jest przebieg, ktory regresja 20260814122512 otwierala wprost:
-- `createSignedUrl` wymaga SELECT-a na `storage.objects`, wiec brak wiersza
-- oznacza brak podpisu. Para niepustki stoi wyzej (admin A ten plik widzi).
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'career-cv'
      AND name LIKE 'da111111-1111-1111-1111-111111111111/%'),
  0,
  'admin B nie ma czego podpisac w katalogu najemcy A (brak SELECT-a = brak signed URL)'
);

-- == (4) Personel TRZECIEGO najemcy - rola spelniona, najemca nie pasuje =====
-- Sprostowanie pierwszej wersji: stala tu asercja opisana jako "personel spoza
-- obu najemcow", ale bez `set_config`, wiec wykonywala sie NADAL jako admin B.
-- Byla przez to powtorzeniem asercji wyzej. Tu jest prawdziwy trzeci najemca.
SELECT set_config('request.jwt.claims',
  '{"sub":"dc000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT ok(
  public.is_admin_or_editor(),
  'admin C spelnia is_admin_or_editor() - odmowy nizej sa wylacznie kwestia najemcy'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_applications
    WHERE tenant_id IN ('da111111-1111-1111-1111-111111111111',
                        'db222222-2222-2222-2222-222222222222')),
  0,
  'admin C nie widzi procesow ZADNEGO z dwoch pozostalych najemcow'
);

SELECT is(
  (SELECT count(*)::int FROM public.contact_messages
    WHERE tenant_id IN ('da111111-1111-1111-1111-111111111111',
                        'db222222-2222-2222-2222-222222222222')),
  0,
  'admin C nie widzi danych osobowych kandydatow ZADNEGO z dwoch pozostalych najemcow'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_cv_gc_queue
    WHERE tenant_id IN ('da111111-1111-1111-1111-111111111111',
                        'db222222-2222-2222-2222-222222222222')),
  0,
  'admin C nie widzi kolejki CV ZADNEGO z dwoch pozostalych najemcow'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
