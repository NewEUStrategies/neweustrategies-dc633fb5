-- Funkcjonalna weryfikacja modulu REKRUTACJA na ZYWEJ bazie.
-- pgtap nie jest dostepny w tym obrazie, wiec asercje sa golym SQL-em:
-- kazda niespelniona rzuca wyjatek i przerywa skrypt.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert(_ok boolean, _label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS NOT TRUE THEN
    RAISE EXCEPTION 'ASERCJA NIESPELNIONA: %', _label;
  END IF;
  RAISE NOTICE '  ok  %', _label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(_sql text, _label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ok  % (odrzucone: %)', _label, left(SQLERRM, 60);
    RETURN;
  END;
  RAISE EXCEPTION 'ASERCJA NIESPELNIONA: % - operacja PRZESZLA, a miala zostac odrzucona', _label;
END $$;

-- ---------------------------------------------------------------------------
-- Fixture: dwa tenanty, admin w kazdym
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111','Tenant A','ta'),
  ('22222222-2222-2222-2222-222222222222','Tenant B','tb')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001','admin-a@t'),
  ('a0000000-0000-0000-0000-000000000002','super-a@t'),
  ('b0000000-0000-0000-0000-000000000001','admin-b@t')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name) VALUES
  ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Admin A'),
  ('a0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Super A'),
  ('b0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Admin B')
ON CONFLICT (id) DO NOTHING;

-- Rola MUSI nieść tenanta. Na produkcji `user_roles.tenant_id` jest NOT NULL od
-- 20260531181120, a od 20260824074231 `is_super_admin()` czyta tę kolumnę
-- i zakresuje po `current_tenant_id()`. Fixture bez tenanta zakładałby wiersz,
-- którego produkcja nie dopuszcza, i `is_super_admin()` zwracałoby na nim po
-- cichu FALSE - czyli test mierzyłby stan nieosiągalny. Tenant jest ten sam, co
-- w profilu danego użytkownika, bo taki jest sens backfillu z 20260531181120.
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a0000000-0000-0000-0000-000000000001','admin','11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000002','super_admin','11111111-1111-1111-1111-111111111111'),
  ('b0000000-0000-0000-0000-000000000001','admin','22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

\echo '== 1. Bucket career-cv istnieje i egzekwuje limit oraz MIME =='
DO $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'career-cv';
  PERFORM pg_temp.assert(b.id IS NOT NULL, 'bucket career-cv utworzony migracja');
  PERFORM pg_temp.assert(b.public IS FALSE, 'bucket jest prywatny');
  -- 5 MB = CV_MAX_BYTES z applicationSchema.ts. To NIE jest kosmetyka: polityka
  -- INSERT dla anon sprawdza tylko prefiks, wiec limit bucketu jest jedyna
  -- egzekucja rozmiaru po stronie serwera.
  PERFORM pg_temp.assert(b.file_size_limit = 5242880, 'limit rozmiaru = 5 MB');
  PERFORM pg_temp.assert(
    'application/pdf' = ANY (b.allowed_mime_types)
    AND array_length(b.allowed_mime_types, 1) = 3,
    'lista MIME zawiera pdf/doc/docx'
  );
END $$;

\echo '== 2. career_roles: slug unikalny W OBREBIE najemcy, nie globalnie =='
INSERT INTO public.career_roles
  (tenant_id, slug, department, engagement, seniority, location, title_pl, title_en)
VALUES
  ('11111111-1111-1111-1111-111111111111','analityk','analysis','full_time','mid','remote','Analityk','Analyst'),
  ('22222222-2222-2222-2222-222222222222','analityk','analysis','full_time','mid','remote','Analityk B','Analyst B');
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.career_roles WHERE slug = 'analityk') = 2,
    'ten sam slug w dwoch tenantach wspolistnieje'
  );
END $$;
SELECT pg_temp.assert_raises(
  $$INSERT INTO public.career_roles
      (tenant_id, slug, department, engagement, seniority, location, title_pl, title_en)
    VALUES ('11111111-1111-1111-1111-111111111111','analityk','policy','contract','lead','hybrid','Dubel','Dupe')$$,
  'duplikat slugu W TYM SAMYM tenancie odrzucony'
);

\echo '== 3. career_page_sections: klucz glowny niesie tenanta =='
INSERT INTO public.career_page_sections (tenant_id, key, is_visible) VALUES
  ('22222222-2222-2222-2222-222222222222','hero',false)
ON CONFLICT (tenant_id, key) DO UPDATE SET is_visible = EXCLUDED.is_visible;
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.career_page_sections WHERE key = 'hero') = 2,
    'sekcja hero istnieje osobno w kazdym tenancie'
  );
  PERFORM pg_temp.assert(
    (SELECT is_visible FROM public.career_page_sections
      WHERE key='hero' AND tenant_id='11111111-1111-1111-1111-111111111111'),
    'ukrycie hero u najemcy B nie ruszylo najemcy A'
  );
END $$;

\echo '== 4. Pipeline zaklada sie SAM przy wplywie zgloszenia =='
INSERT INTO public.contact_messages
  (id, tenant_id, name, email, message, form_id, custom)
VALUES
  ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'Jan Kowalski','jan@example.com','Chce pracowac.','careers',
   jsonb_build_object(
     'role','analityk','role_label','Analityk','department','analysis',
     'seniority','mid','start','month',
     'cv_path','11111111-1111-1111-1111-111111111111/uploads/2026-01-01/aaaaaaaa-1111-2222-3333-444444444444.pdf',
     'cv_file_name','cv-jan.pdf')),
  -- Wiadomosc z formularza KONTAKTOWEGO nie moze dostac wiersza pipeline.
  ('c0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   'Anna Nowak','anna@example.com','Pytanie o konferencje.','contact','{}'::jsonb);

DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT stage FROM public.career_applications
      WHERE message_id='c0000000-0000-0000-0000-000000000001') = 'new',
    'zgloszenie careers dostalo pipeline w etapie new'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_applications
                 WHERE message_id='c0000000-0000-0000-0000-000000000002'),
    'wiadomosc z formularza kontaktowego NIE dostala pipeline'
  );
END $$;

\echo '== 5. Zmiana etapu: znacznik czasu + wpis w dzienniku, bez RPC =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.career_applications
   SET stage = 'screening', stage_note = 'Dobre proby pisarskie.'
 WHERE message_id = 'c0000000-0000-0000-0000-000000000001';
DO $$
DECLARE a record; e record;
BEGIN
  SELECT * INTO a FROM public.career_applications
   WHERE message_id='c0000000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(a.stage = 'screening', 'etap zmieniony na screening');
  PERFORM pg_temp.assert(a.stage_changed_at > a.created_at - interval '1 second',
    'stage_changed_at przestawiony przez trigger');

  SELECT * INTO e FROM public.career_application_events
   WHERE application_id = a.id ORDER BY created_at DESC LIMIT 1;
  -- Dziennik powstaje w TRIGGERZE, nie w RPC - dlatego zwykly UPDATE z panelu
  -- tez zostawia slad i audytu nie da sie ominac.
  PERFORM pg_temp.assert(e.from_stage = 'new' AND e.to_stage = 'screening',
    'dziennik zapisal przejscie new -> screening');
  PERFORM pg_temp.assert(e.note = 'Dobre proby pisarskie.', 'notatka trafila do dziennika');
  PERFORM pg_temp.assert(e.actor_id = 'a0000000-0000-0000-0000-000000000001',
    'dziennik zapisal autora zmiany');
END $$;

\echo '== 5b. UPDATE bez zmiany etapu NIE produkuje wpisu w dzienniku =='
UPDATE public.career_applications
   SET rating = 4
 WHERE message_id = 'c0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.career_application_events e
       JOIN public.career_applications a ON a.id = e.application_id
      WHERE a.message_id='c0000000-0000-0000-0000-000000000001') = 1,
    'ocena bez zmiany etapu nie zasmiecila dziennika'
  );
END $$;

\echo '== 5c. UPDATE nie przenosi procesu do innego najemcy =='
UPDATE public.career_applications
   SET tenant_id = '22222222-2222-2222-2222-222222222222'
 WHERE message_id = 'c0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT tenant_id FROM public.career_applications
      WHERE message_id='c0000000-0000-0000-0000-000000000001')
      = '11111111-1111-1111-1111-111111111111',
    'trigger przypial tenant_id do wartosci pierwotnej'
  );
END $$;
RESET request.jwt.claim.sub;

\echo '== 6. Skan retencji: otwarty proces TRZYMA CV, domkniety je oddaje =='
-- Cofniecie zegara MUSI byc osobna instrukcja. Trigger `career_application_touch`
-- przestawia `stage_changed_at` na now() przy KAZDEJ zmianie etapu, wiec
-- "SET stage=..., stage_changed_at=<przeszlosc>" w jednym UPDATE zostawiloby
-- znacznik na dzisiaj - i test przechodzilby na fikcji. Drugi UPDATE nie rusza
-- etapu, wiec trigger nie nadpisuje juz znacznika.
UPDATE public.career_applications SET stage = 'rejected'
 WHERE message_id = 'c0000000-0000-0000-0000-000000000001';
UPDATE public.career_applications SET stage_changed_at = now() - interval '730 days'
 WHERE message_id = 'c0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT stage_changed_at FROM public.career_applications
      WHERE message_id='c0000000-0000-0000-0000-000000000001') < now() - interval '700 days',
    'znacznik domkniecia realnie cofniety (fixture jest wiarygodny)'
  );
END $$;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.career_cv_gc_scan(100);
  PERFORM pg_temp.assert((r->>'retention')::int = 1, 'CV po retencji trafilo do kolejki');
  PERFORM pg_temp.assert(
    (SELECT reason FROM public.career_cv_gc_queue
      WHERE path LIKE '%aaaaaaaa-1111%') = 'retention',
    'powod w kolejce = retention'
  );
END $$;

-- Ten sam plik przy OTWARTYM procesie nie moze zniknac: rekrutacja potrafi stac
-- miesiacami, a CV jest wtedy nadal narzedziem pracy.
DELETE FROM public.career_cv_gc_queue;
UPDATE public.career_applications SET stage = 'interview'
 WHERE message_id = 'c0000000-0000-0000-0000-000000000001';
UPDATE public.career_applications SET stage_changed_at = now() - interval '730 days'
 WHERE message_id = 'c0000000-0000-0000-0000-000000000001';
DO $$
DECLARE r jsonb;
BEGIN
  r := public.career_cv_gc_scan(100);
  PERFORM pg_temp.assert((r->>'retention')::int = 0,
    'otwarty proces (interview) nie oddaje CV mimo wieku');
END $$;

\echo '== 7. Skan osieroconych: wiek i referencja decyduja =='
INSERT INTO storage.buckets (id, name, public) VALUES ('career-cv','career-cv',false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.objects (bucket_id, name, created_at) VALUES
  -- osierocony i stary -> do kolejki
  ('career-cv','11111111-1111-1111-1111-111111111111/uploads/2026-01-01/bbbbbbbb-1111-2222-3333-444444444444.pdf',
   now() - interval '48 hours'),
  -- osierocony, ale SWIEZY -> kandydat moze wlasnie wypelniac kreator
  ('career-cv','11111111-1111-1111-1111-111111111111/uploads/2026-01-01/cccccccc-1111-2222-3333-444444444444.pdf',
   now() - interval '10 minutes'),
  -- stary, ale REFEROWANY przez zgloszenie -> nietykalny
  ('career-cv','11111111-1111-1111-1111-111111111111/uploads/2026-01-01/aaaaaaaa-1111-2222-3333-444444444444.pdf',
   now() - interval '400 days');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.career_cv_gc_scan(100);
  PERFORM pg_temp.assert((r->>'orphans')::int = 1, 'dokladnie jeden plik uznany za osierocony');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.career_cv_gc_queue
             WHERE path LIKE '%bbbbbbbb-1111%' AND reason = 'orphan'),
    'stary plik bez referencji trafil do kolejki'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_cv_gc_queue WHERE path LIKE '%cccccccc-1111%'),
    'swiezy plik zostal w spokoju (okno laski)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_cv_gc_queue WHERE path LIKE '%aaaaaaaa-1111%'),
    'plik referowany przez zgloszenie nie jest osierocony'
  );
  PERFORM pg_temp.assert(
    (SELECT tenant_id FROM public.career_cv_gc_queue WHERE path LIKE '%bbbbbbbb-1111%')
      = '11111111-1111-1111-1111-111111111111',
    'tenant odczytany z pierwszego segmentu sciezki'
  );
END $$;

\echo '== 8. Claim / done: kolejka drenuje sie i ZDEJMUJE CV ze zgloszenia =='
DO $$
DECLARE claimed jsonb; removed integer; c record;
BEGIN
  claimed := public.career_cv_gc_claim(10);
  PERFORM pg_temp.assert(jsonb_array_length(claimed) = 1, 'claim wydal jedna sciezke');
  PERFORM pg_temp.assert(
    (claimed->0->>'attempts')::int = 1, 'claim podbil licznik prob'
  );

  -- Drugi claim w tym samym oknie nie wydaje tego samego pliku dwa razy.
  PERFORM pg_temp.assert(
    jsonb_array_length(public.career_cv_gc_claim(10)) = 0,
    'ponowny claim nie wydaje juz zajetej sciezki'
  );

  -- Domkniecie partii na sciezce, ktora JEST w zgloszeniu (ta z retencji).
  DELETE FROM public.career_cv_gc_queue;
  INSERT INTO public.career_cv_gc_queue (tenant_id, path, reason)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '11111111-1111-1111-1111-111111111111/uploads/2026-01-01/aaaaaaaa-1111-2222-3333-444444444444.pdf',
          'retention');
  removed := public.career_cv_gc_done(ARRAY[
    '11111111-1111-1111-1111-111111111111/uploads/2026-01-01/aaaaaaaa-1111-2222-3333-444444444444.pdf'
  ]);
  PERFORM pg_temp.assert(removed = 1, 'done zdjal wpis z kolejki');

  SELECT * INTO c FROM public.contact_messages
   WHERE id='c0000000-0000-0000-0000-000000000001';
  -- Bez tego panel dalej pokazywalby przycisk "Otworz CV" celujacy w nicosc.
  PERFORM pg_temp.assert(NOT (c.custom ? 'cv_path'), 'cv_path zdjety ze zgloszenia');
  PERFORM pg_temp.assert(NOT (c.custom ? 'cv_file_name'), 'cv_file_name zdjety ze zgloszenia');
  PERFORM pg_temp.assert(c.custom ? 'cv_purged_at',
    'zostal slad cv_purged_at - operator widzi "usuniete", nie "brak"');
  PERFORM pg_temp.assert(c.custom ->> 'role' = 'analityk',
    'reszta pol rekrutacyjnych nietknieta');
END $$;

\echo '== 9. Usuniecie zgloszenia kolejkuje jego CV =='
DELETE FROM public.career_cv_gc_queue;
INSERT INTO public.contact_messages
  (id, tenant_id, name, email, message, form_id, custom)
VALUES
  ('c0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   'Piotr Zielinski','piotr@example.com','Aplikuje.','careers',
   jsonb_build_object('cv_path','11111111-1111-1111-1111-111111111111/uploads/2026-02-02/dddddddd-1111-2222-3333-444444444444.pdf'));
DELETE FROM public.contact_messages WHERE id='c0000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT reason FROM public.career_cv_gc_queue WHERE path LIKE '%dddddddd-1111%')
      = 'application_deleted',
    'usuniecie zgloszenia zakolejkowalo jego plik CV'
  );
  -- ON DELETE CASCADE musi zabrac takze pipeline.
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_applications
                 WHERE message_id='c0000000-0000-0000-0000-000000000003'),
    'pipeline usunietego zgloszenia poszedl kaskada'
  );
END $$;

\echo '== 10. Polityki bucketu: personel widzi WYLACZNIE swojego najemce =='
INSERT INTO storage.objects (bucket_id, name, created_at) VALUES
  ('career-cv','22222222-2222-2222-2222-222222222222/uploads/2026-01-01/eeeeeeee-1111-2222-3333-444444444444.pdf', now()),
  -- Plik w starej konwencji (bez tenanta w sciezce), referowany przez najemce A.
  ('career-cv','uploads/2026-01-01/ffffffff-1111-2222-3333-444444444444.pdf', now());
-- Wiersz legacy powstal PRZED straznikiem referencji (20261003120000), ktory
-- nowych sciezek bez tenanta juz nie przyjmuje - fixture odtwarza wiec stan
-- zastany z wylaczonym straznikiem, a nie omija go w kodzie produkcyjnym.
ALTER TABLE public.contact_messages DISABLE TRIGGER trg_contact_messages_career_cv_path_guard;
INSERT INTO public.contact_messages
  (id, tenant_id, name, email, message, form_id, custom, created_at)
VALUES
  ('c0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',
   'Legacy Kandydat','legacy@example.com','Stare zgloszenie.','careers',
   jsonb_build_object('cv_path','uploads/2026-01-01/ffffffff-1111-2222-3333-444444444444.pdf'),
   now() - interval '300 days');
ALTER TABLE public.contact_messages ENABLE TRIGGER trg_contact_messages_career_cv_path_guard;

SET ROLE authenticated;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM storage.objects
             WHERE name LIKE '11111111-1111-1111-1111-111111111111/uploads/%bbbbbbbb%'),
    'admin A widzi pliki wlasnego najemcy'
  );
  -- TO JEST NAPRAWIANA LUKA: przed zmiana polityka brzmiala
  -- `bucket_id='career-cv' AND is_staff()`, wiec ten SELECT zwracal wiersz.
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM storage.objects
                 WHERE name LIKE '22222222-2222-2222-2222-222222222222/uploads/%'),
    'admin A NIE widzi plikow najemcy B'
  );
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM storage.objects
             WHERE name = 'uploads/2026-01-01/ffffffff-1111-2222-3333-444444444444.pdf'),
    'admin A widzi plik legacy, na ktory powoluje sie JEGO zgloszenie'
  );
END $$;
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM storage.objects
             WHERE name LIKE '22222222-2222-2222-2222-222222222222/uploads/%'),
    'admin B widzi pliki wlasnego najemcy'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM storage.objects
                 WHERE name LIKE '11111111-1111-1111-1111-111111111111/uploads/%'),
    'admin B NIE widzi plikow najemcy A'
  );
  -- Sciezka legacy nie nosi tenanta, wiec prawo do niej wynika WYLACZNIE
  -- z referencji - a ta jest w tenancie A.
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM storage.objects
                 WHERE name = 'uploads/2026-01-01/ffffffff-1111-2222-3333-444444444444.pdf'),
    'admin B NIE widzi pliku legacy nalezacego do najemcy A'
  );
END $$;
RESET ROLE;

\echo '== 11. Upload: sciezka MUSI niesc tenanta przegladanego hosta =='
-- Kandydat jest ANONIMEM. Bez tego resetu w sesji zostaje admin B z sekcji 10,
-- a `public_tenant_id()` przypina zalogowanego wolajacego do tenanta DOMOWEGO
-- (mitygacja podrobionego naglowka x-tenant-host, 20260805114407) - wiec upload
-- do katalogu A odpadalby z prawidlowego powodu, mierzac nie to, co trzeba.
RESET request.jwt.claim.sub;
SET ROLE anon;
SET request.tenant.id = '11111111-1111-1111-1111-111111111111';
DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('career-cv','11111111-1111-1111-1111-111111111111/uploads/2026-03-03/99999999-1111-2222-3333-444444444444.pdf');
  PERFORM pg_temp.assert(true, 'anonim wgral CV do katalogu swojego najemcy');
END $$;
-- Podszycie sie pod katalog innego najemcy musi odpasc na polityce.
SELECT pg_temp.assert_raises(
  $$INSERT INTO storage.objects (bucket_id, name)
    VALUES ('career-cv','22222222-2222-2222-2222-222222222222/uploads/2026-03-03/88888888-1111-2222-3333-444444444444.pdf')$$,
  'anonim NIE wgra pliku do katalogu obcego najemcy'
);
-- Stara konwencja (bez tenanta) jest juz zamknieta dla nowych plikow.
SELECT pg_temp.assert_raises(
  $$INSERT INTO storage.objects (bucket_id, name)
    VALUES ('career-cv','uploads/2026-03-03/77777777-1111-2222-3333-444444444444.pdf')$$,
  'nowy upload w starej konwencji odrzucony'
);
RESET ROLE;
RESET request.tenant.id;

\echo '== 12. career_settings: domyslne wartosci retencji =='
INSERT INTO public.career_settings (tenant_id) VALUES ('11111111-1111-1111-1111-111111111111');
DO $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM public.career_settings
   WHERE tenant_id='11111111-1111-1111-1111-111111111111';
  PERFORM pg_temp.assert(s.cv_retention_days = 365, 'domyslna retencja CV = 365 dni');
  PERFORM pg_temp.assert(s.orphan_grace_hours = 24, 'domyslne okno laski = 24 h');
END $$;
SELECT pg_temp.assert_raises(
  $$UPDATE public.career_settings SET cv_retention_days = 0
     WHERE tenant_id='11111111-1111-1111-1111-111111111111'$$,
  'retencja 0 dni odrzucona przez CHECK'
);

\echo '== 13. Funkcje GC sa zamkniete dla roli klienckiej =='
SET ROLE authenticated;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_raises(
  $$SELECT public.career_cv_gc_scan(10)$$,
  'admin (nie super admin) nie uruchomi skanu GC'
);
SELECT pg_temp.assert_raises(
  $$SELECT public.career_cv_gc_done(ARRAY['x'])$$,
  'admin nie domknie partii GC'
);
RESET ROLE;
RESET request.jwt.claim.sub;

\echo '== 14. Dziennik etapow jest niezapisywalny z panelu =='
SET ROLE authenticated;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_raises(
  $$INSERT INTO public.career_application_events (tenant_id, application_id, to_stage)
    VALUES ('11111111-1111-1111-1111-111111111111',
            (SELECT id FROM public.career_applications LIMIT 1), 'hired')$$,
  'personel nie dopisze wpisu do dziennika recznie'
);
RESET ROLE;
RESET request.jwt.claim.sub;

\echo '== 15. Rola author NIE jest personelem rekrutacji =='
-- PO CO TA SEKCJA. Migracja 20260824074231 przestawia polityki `career_*`
-- i `career_cv_*` z `is_staff()` na `is_admin_or_editor()`. Roznica jest
-- DOKLADNIE jedna rola: `is_staff()` przepuszcza `author`, `is_admin_or_editor()`
-- nie. Bez tej sekcji harness to zaostrzenie WYKONYWAL, ale go nie SPRAWDZAL -
-- wszystkie pozostale asercje przechodza tez na starym zestawie polityk, wiec
-- cofniecie zmiany do `is_staff()` nie zapaliloby niczego. To ta sama klasa
-- braku, ktora README wymienia jako powod istnienia tego harnessu: "polityka
-- odczytu bucketu, ktora przepuszczala obcego najemce - tego nie widzi zaden
-- test jednostkowy".
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000003','author-a@t')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id, display_name) VALUES
  ('a0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Author A')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a0000000-0000-0000-0000-000000000003','author','11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

-- Najpierw DOWOD, ze test nie jest prozny: admin TEGO SAMEGO najemcy musi
-- widziec te wiersze. Bez tego "author widzi zero" przechodziloby rowniez na
-- pustej tabeli - a zielone zero to klamstwo.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.career_applications) > 0,
    'admin A widzi procesy wlasnego najemcy (test nie jest prozny)'
  );
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SET ROLE authenticated;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  -- Kotwica zmiany: pod STARA polityka ten warunek dawal dostep. Jesli kiedys
  -- przestanie byc prawda, ta asercja zapali sie pierwsza i powie, ze test
  -- porownuje sie z nieaktualnym stanem odniesienia.
  PERFORM pg_temp.assert(
    public.is_staff(),
    'author przechodzi is_staff() - czyli STARA polityka by go wpuscila'
  );
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.career_applications) = 0,
    'author NIE widzi procesow rekrutacyjnych (is_admin_or_editor, nie is_staff)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_application_events),
    'author NIE widzi dziennika etapow'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'career-cv'),
    'author NIE widzi ZADNEGO CV, takze u wlasnego najemcy'
  );
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

\echo '== 16. Izolacja najemcy na powierzchni danych kandydata =='
-- PO CO TA SEKCJA. Sekcja 10 dowodzi izolacji najemcy na `storage.objects`,
-- sekcja 15 dowodzi, ze sama ROLA nie wystarcza (`author` odpada). Zadna z nich
-- nie dowodzi trzeciego przypadku - a to wlasnie o niego rozbila sie polityka
-- bucketu w 20260814122512: personel, ktory ROLE spelnia w PELNI, ale nalezy
-- do INNEGO najemcy.
--
-- Luka byla strukturalna, nie przypadkowa. Sekcje 4-9 dotykaja
-- `contact_messages`, `career_applications`, `career_application_events`
-- i `career_cv_gc_queue` z roli harnessu, ktora RLS nie podlega. Skasowanie
-- koniunkcji najemcy z ich polityk przechodzilo caly harness na zielono.
--
-- GDZIE LEZA DANE OSOBOWE - sprostowanie pierwszej wersji tej sekcji.
-- Pierwsza wersja twierdzila, ze imie, e-mail i telefon kandydata trzymaja
-- tabele `career_*`. To nieprawda: `career_applications` nie ma ani jednej
-- takiej kolumny. Dane osobowe siedza w `contact_messages`, a tabele `career_*`
-- dokladaja warstwe procesu i - w `career_cv_gc_queue` - SCIEZKI do plikow CV.
-- Dlatego sekcja dowodzi izolacji CZTERECH tabel, nie trzech.
--
-- KAZDE "widzi zero" ma tu pare - asercje niepustki po TEJ SAMEJ stronie.
-- Zielone zero jest gorsze od czerwieni.

-- Fixture w OBU najemcach. E-maile wylacznie w domenach example.*.
INSERT INTO public.contact_messages
  (id, tenant_id, name, email, message, form_id, custom)
VALUES
  ('c0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',
   'Kandydat A','kandydat-a@example.com','Zgloszenie u najemcy A.','careers',
   jsonb_build_object('role','analityk','phone','+48 000 000 001')),
  ('c0000000-0000-0000-0000-000000000006','22222222-2222-2222-2222-222222222222',
   'Kandydat B','kandydat-b@example.org','Zgloszenie u najemcy B.','careers',
   jsonb_build_object('role','analityk','phone','+48 000 000 002'));

-- Dziennik etapow zaklada trigger przy ZMIANIE etapu (sekcja 5).
UPDATE public.career_applications SET stage = 'screening'
 WHERE message_id IN ('c0000000-0000-0000-0000-000000000005',
                      'c0000000-0000-0000-0000-000000000006');

-- Kolejka GC: sekcje 6-8 ja oprozniaja, wiec wstawiam wlasne wiersze.
INSERT INTO public.career_cv_gc_queue (tenant_id, path, reason) VALUES
  ('11111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111/uploads/2026-04-04/a5555555-1111-2222-3333-444444444444.pdf',
   'retention'),
  ('22222222-2222-2222-2222-222222222222',
   '22222222-2222-2222-2222-222222222222/uploads/2026-04-04/b6666666-1111-2222-3333-444444444444.pdf',
   'retention');

-- Plik CV najemcy A dla asercji bucketu. BEZ `ON CONFLICT DO NOTHING`: cichy
-- no-op zrobilby z asercji nizej zielone zero.
INSERT INTO storage.objects (bucket_id, name, created_at) VALUES
  ('career-cv','11111111-1111-1111-1111-111111111111/uploads/2026-04-04/a7777777-1111-2222-3333-444444444444.pdf', now());

-- ADMIN NAJEMCY A.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  -- Kotwica: rola spelniona W PELNI, wiec kazde "zero" nizej bierze sie
  -- wylacznie z najemcy.
  PERFORM pg_temp.assert(
    public.is_admin_or_editor(),
    'admin A spelnia is_admin_or_editor() - koniunkcja roli NIE jest tu powodem odmowy'
  );

  -- dane osobowe kandydata
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.contact_messages
             WHERE id='c0000000-0000-0000-0000-000000000005'),
    'admin A widzi WLASNE zgloszenie z danymi osobowymi (dowod niepustki)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.contact_messages
                 WHERE tenant_id='22222222-2222-2222-2222-222222222222'),
    'admin A NIE widzi danych osobowych kandydata najemcy B'
  );

  -- warstwa procesu
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.career_applications
             WHERE message_id='c0000000-0000-0000-0000-000000000005'),
    'admin A widzi WLASNY proces (dowod niepustki)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_applications
                 WHERE tenant_id='22222222-2222-2222-2222-222222222222'),
    'admin A NIE widzi procesu najemcy B'
  );
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.career_application_events
             WHERE tenant_id='11111111-1111-1111-1111-111111111111'),
    'admin A widzi WLASNY dziennik etapow (dowod niepustki)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_application_events
                 WHERE tenant_id='22222222-2222-2222-2222-222222222222'),
    'admin A NIE widzi dziennika etapow najemcy B'
  );
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.career_cv_gc_queue
             WHERE path LIKE '11111111%2026-04-04%'),
    'admin A widzi WLASNA kolejke CV (dowod niepustki)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_cv_gc_queue
                 WHERE tenant_id='22222222-2222-2222-2222-222222222222'),
    'admin A NIE widzi kolejki CV najemcy B (sciezki do plikow kandydatow)'
  );
  -- Para niepustki dla asercji bucketu w bloku admina B.
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM storage.objects
             WHERE bucket_id='career-cv' AND name LIKE '%a7777777%'),
    'admin A widzi WLASNY plik CV (dowod niepustki dla asercji bucketu nizej)'
  );
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

-- ADMIN NAJEMCY B. Kierunek odwrotny, z wlasna para niepustki przy KAZDYM
-- zerze - inaczej dowod trzymalby sie tego, ze najemca B moze byc pusty.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    public.is_admin_or_editor(), 'admin B spelnia is_admin_or_editor()'
  );

  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.contact_messages
             WHERE id='c0000000-0000-0000-0000-000000000006'),
    'admin B widzi WLASNE zgloszenie z danymi osobowymi (dowod niepustki)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.contact_messages
                 WHERE tenant_id='11111111-1111-1111-1111-111111111111'),
    'admin B NIE widzi danych osobowych kandydata najemcy A'
  );

  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.career_applications
             WHERE message_id='c0000000-0000-0000-0000-000000000006'),
    'admin B widzi WLASNY proces (dowod niepustki)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_applications
                 WHERE tenant_id='11111111-1111-1111-1111-111111111111'),
    'admin B NIE widzi procesu najemcy A'
  );
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.career_application_events
             WHERE tenant_id='22222222-2222-2222-2222-222222222222'),
    'admin B widzi WLASNY dziennik etapow (dowod niepustki - bez tego asercja nizej jest prozna)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_application_events
                 WHERE tenant_id='11111111-1111-1111-1111-111111111111'),
    'admin B NIE widzi dziennika etapow najemcy A'
  );
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.career_cv_gc_queue
             WHERE tenant_id='22222222-2222-2222-2222-222222222222'),
    'admin B widzi WLASNA kolejke CV (dowod niepustki - bez tego asercja nizej jest prozna)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_cv_gc_queue
                 WHERE tenant_id='11111111-1111-1111-1111-111111111111'),
    'admin B NIE widzi kolejki CV najemcy A'
  );
  -- Przebieg, ktory regresja 20260814122512 otwierala wprost: `createSignedUrl`
  -- wymaga SELECT-a na `storage.objects`, wiec brak wiersza = brak podpisu.
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM storage.objects
                 WHERE bucket_id='career-cv' AND name LIKE '%a7777777%'),
    'admin B nie ma czego podpisac w katalogu najemcy A (brak SELECT-a = brak signed URL)'
  );
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

\echo '== 17. ZNALEZISKO: hardening roli OMINAL kolejke CV =='
-- ZAREJESTROWANE ZACHOWANIE ISTNIEJACE, NIE POSTULAT. Migracja 20260824074231
-- przestawila polityki `career_*` z `is_staff()` na `is_admin_or_editor()`,
-- ale `career_cv_gc_queue` NIE WYSTEPUJE W TYM PLIKU ANI RAZU. Jej polityka
-- odczytu stoi do dzis na `is_staff() AND tenant_id = current_tenant_id()`.
--
-- Skutek: `author` - ktory sekcja 15 wyklucza z procesow, z dziennika etapow
-- i z CALEGO bucketu CV - widzi mimo to SCIEZKI plikow CV wlasnego najemcy.
-- Sekcja 15 testuje `author` przeciw trzem powierzchniom i pomija dokladnie te
-- jedna, ktorej czlon roli jest slaby.
--
-- Asercje nizej PRZYBIJAJA STAN OBECNY, zeby nie zniknal po cichu w zadna
-- strone. Kontrakt docelowy (kolejka ma wymagac `is_admin_or_editor()`, jak
-- pozostale piec powierzchni) jest zarejestrowany jako `it.fails`
-- w `src/routes/__tests__/adminCareersRoute.test.tsx`. Gdy ktos go domknie
-- migracja, TA sekcja zapali sie pierwsza i wskaze, co dokladnie sie zmienilo.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    public.is_staff() AND NOT public.is_admin_or_editor(),
    'author przechodzi is_staff(), ale NIE is_admin_or_editor() - to caly mechanizm'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_applications),
    'author NIE widzi procesow (polityka po hardeningu 20260824074231)'
  );
  -- TO JEST ZNALEZISKO: ta sama osoba, ta sama rola, inna tabela - i widzi.
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.career_cv_gc_queue
             WHERE tenant_id='11111111-1111-1111-1111-111111111111'),
    'ZNALEZISKO: author WIDZI sciezki CV w kolejce - hardening ominal ta tabele'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='career-cv'),
    'author nadal NIE widzi samych plikow CV - wyciek jest ograniczony do sciezek'
  );
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

\echo '== 18. Referencja cv_path NIE otwiera pliku innego najemcy (20261003120000) =='
-- LUKA, KTORA TA SEKCJA PRZYBIJA. Do 20261003120000 polityki odczytu i usuwania
-- bucketu mialy galaz `OR EXISTS (zgloszenie MOJEGO najemcy z cv_path = name)`
-- bez ograniczenia do plikow legacy. Wiersz najemcy A z `cv_path` wskazujacym
-- katalog B (sfalszowane zgloszenie albo UPDATE `custom` z panelu) otwieral
-- personelowi A odczyt i usuniecie CV kandydata B, a GC kolejkowal plik B do
-- trwalego usuniecia przy usunieciu/retencji wiersza A.
--
-- Wiersze-falszywki zakladamy z WYLACZONYM straznikiem: tak wyglada stan
-- zastany sprzed migracji, a polityki i GC musza byc odporne takze na niego -
-- straznik chroni wylacznie przed NOWYMI referencjami.
DELETE FROM public.career_cv_gc_queue;

-- 18a. Straznik referencji: nowa albo zmieniona sciezka musi nalezec do najemcy wiersza.
SELECT pg_temp.assert_raises(
  $$INSERT INTO public.contact_messages (tenant_id, name, email, message, form_id, custom)
    VALUES ('11111111-1111-1111-1111-111111111111','Falszerz','f@example.com','x','careers',
      jsonb_build_object('cv_path','22222222-2222-2222-2222-222222222222/uploads/2026-01-01/eeeeeeee-1111-2222-3333-444444444444.pdf'))$$,
  'straznik: zgloszenie najemcy A ze sciezka w katalogu B odrzucone'
);
SELECT pg_temp.assert_raises(
  $$INSERT INTO public.contact_messages (tenant_id, name, email, message, form_id, custom)
    VALUES ('11111111-1111-1111-1111-111111111111','Falszerz','f@example.com','x','careers',
      jsonb_build_object('cv_path','  22222222-2222-2222-2222-222222222222/uploads/2026-01-01/eeeeeeee-1111-2222-3333-444444444444.pdf '))$$,
  'straznik: biale znaki wokol cudzej sciezki nie omijaja kontroli'
);
SELECT pg_temp.assert_raises(
  $$INSERT INTO public.contact_messages (tenant_id, name, email, message, form_id, custom)
    VALUES ('11111111-1111-1111-1111-111111111111','Falszerz','f@example.com','x','careers',
      jsonb_build_object('cv_path','uploads/2026-01-01/ffffffff-1111-2222-3333-444444444444.pdf'))$$,
  'straznik: NOWA referencja w ksztalcie legacy (bez tenanta) odrzucona'
);
-- Droga panelu: personel ma UPDATE na `contact_messages` swojego najemcy, wiec
-- bramka aplikacji (`submitContact`) tej drogi w ogole nie widzi.
SELECT pg_temp.assert_raises(
  $$UPDATE public.contact_messages
       SET custom = custom || jsonb_build_object('cv_path',
         '22222222-2222-2222-2222-222222222222/uploads/2026-01-01/eeeeeeee-1111-2222-3333-444444444444.pdf')
     WHERE id = 'c0000000-0000-0000-0000-000000000002'$$,
  'straznik: UPDATE custom (droga panelu) nie podmieni sciezki na cudza'
);
SELECT pg_temp.assert_raises(
  $$UPDATE public.contact_messages SET tenant_id = '22222222-2222-2222-2222-222222222222'
     WHERE id = 'c0000000-0000-0000-0000-000000000004'$$,
  'straznik: przeniesienie wiersza z referencja do innego najemcy odrzucone'
);
DO $$
BEGIN
  -- Zastany wiersz legacy dalej daje sie obslugiwac, dopoki sciezki nikt nie rusza.
  UPDATE public.contact_messages SET status = 'read'
   WHERE id = 'c0000000-0000-0000-0000-000000000004';
  PERFORM pg_temp.assert(
    (SELECT status FROM public.contact_messages
      WHERE id = 'c0000000-0000-0000-0000-000000000004') = 'read',
    'straznik przepuszcza UPDATE zastanego wiersza legacy, ktory nie rusza sciezki'
  );
  INSERT INTO public.contact_messages (id, tenant_id, name, email, message, form_id, custom)
  VALUES ('c0000000-0000-0000-0000-000000000180','11111111-1111-1111-1111-111111111111',
    'Uczciwy Kandydat','u@example.com','Aplikuje.','careers',
    jsonb_build_object('cv_path','11111111-1111-1111-1111-111111111111/uploads/2026-03-03/99999999-1111-2222-3333-444444444444.pdf'));
  PERFORM pg_temp.assert(true, 'straznik przepuszcza sciezke w katalogu WLASNEGO najemcy');
END $$;

-- 18b. Falszywki zastane: A wskazuje plik B, B wskazuje (pozniej) plik legacy A.
ALTER TABLE public.contact_messages DISABLE TRIGGER trg_contact_messages_career_cv_path_guard;
INSERT INTO public.contact_messages (id, tenant_id, name, email, message, form_id, custom)
VALUES
  ('c0000000-0000-0000-0000-000000000181','11111111-1111-1111-1111-111111111111',
   'Falszerz A','fa@example.com','Podrzucona referencja.','careers',
   jsonb_build_object('cv_path','22222222-2222-2222-2222-222222222222/uploads/2026-01-01/eeeeeeee-1111-2222-3333-444444444444.pdf')),
  ('c0000000-0000-0000-0000-000000000182','22222222-2222-2222-2222-222222222222',
   'Falszerz B','fb@example.com','Podrzucona referencja legacy.','careers',
   jsonb_build_object('cv_path','uploads/2026-01-01/ffffffff-1111-2222-3333-444444444444.pdf'));
ALTER TABLE public.contact_messages ENABLE TRIGGER trg_contact_messages_career_cv_path_guard;

DO $$
BEGIN
  PERFORM pg_temp.assert(
    public.career_cv_object_owner('22222222-2222-2222-2222-222222222222/uploads/2026-01-01/eeeeeeee-1111-2222-3333-444444444444.pdf')
      = '22222222-2222-2222-2222-222222222222',
    'wlasciciel pliku z tenantem w sciezce = tenant ze sciezki, mimo referencji w A'
  );
  PERFORM pg_temp.assert(
    public.career_cv_object_owner('uploads/2026-01-01/ffffffff-1111-2222-3333-444444444444.pdf')
      = '11111111-1111-1111-1111-111111111111',
    'wlasciciel pliku legacy = najemca NAJWCZESNIEJSZEJ referencji (A), nie pozniejszej (B)'
  );
  PERFORM pg_temp.assert(
    public.career_cv_object_owner('nie/ta/konwencja.pdf') IS NULL
      AND public.career_cv_object_owner('uploads/2026-01-01/nikt-nie-wskazuje.pdf') IS NULL,
    'obiekt bez rozpoznanego wlasciciela nie nalezy do nikogo'
  );
END $$;

SET ROLE authenticated;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
DO $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM storage.objects
                 WHERE name = '22222222-2222-2222-2222-222222222222/uploads/2026-01-01/eeeeeeee-1111-2222-3333-444444444444.pdf'),
    'TO JEST NAPRAWIANA LUKA: admin A z podrzucona referencja NIE widzi CV najemcy B (brak signed URL)'
  );
  DELETE FROM storage.objects
   WHERE name = '22222222-2222-2222-2222-222222222222/uploads/2026-01-01/eeeeeeee-1111-2222-3333-444444444444.pdf';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert(n = 0, 'admin A z podrzucona referencja NIE usunie CV najemcy B');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM storage.objects
             WHERE name = 'uploads/2026-01-01/ffffffff-1111-2222-3333-444444444444.pdf'),
    'admin A nadal widzi WLASNY plik legacy (dowod niepustki)'
  );
END $$;
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM storage.objects
             WHERE name = '22222222-2222-2222-2222-222222222222/uploads/2026-01-01/eeeeeeee-1111-2222-3333-444444444444.pdf'),
    'admin B nadal widzi WLASNE CV (dowod niepustki - plik przetrwal probe usuniecia z A)'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM storage.objects
                 WHERE name = 'uploads/2026-01-01/ffffffff-1111-2222-3333-444444444444.pdf'),
    'admin B z POZNIEJSZA referencja legacy NIE widzi pliku najemcy A'
  );
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

-- 18c. GC: obca referencja ani nie kasuje cudzego pliku, ani nie trzyma go przy zyciu.
DELETE FROM public.contact_messages WHERE id = 'c0000000-0000-0000-0000-000000000181';
DELETE FROM public.contact_messages WHERE id = 'c0000000-0000-0000-0000-000000000182';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_cv_gc_queue WHERE path LIKE '%eeeeeeee-1111%'),
    'usuniecie podrzuconego zgloszenia w A NIE kolejkuje CV najemcy B do usuniecia'
  );
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_cv_gc_queue WHERE path LIKE '%ffffffff-1111%'),
    'usuniecie POZNIEJSZEJ referencji legacy w B NIE kolejkuje pliku najemcy A'
  );
END $$;

-- Retencja: domkniety, przeterminowany proces w A z podrzucona sciezka B.
ALTER TABLE public.contact_messages DISABLE TRIGGER trg_contact_messages_career_cv_path_guard;
INSERT INTO public.contact_messages (id, tenant_id, name, email, message, form_id, custom)
VALUES
  ('c0000000-0000-0000-0000-000000000183','11111111-1111-1111-1111-111111111111',
   'Falszerz A','fa@example.com','Podrzucona referencja.','careers',
   jsonb_build_object('cv_path','22222222-2222-2222-2222-222222222222/uploads/2026-01-01/eeeeeeee-1111-2222-3333-444444444444.pdf')),
  -- Plik B bez zgloszenia B: jedyna referencja to falszywka w A.
  ('c0000000-0000-0000-0000-000000000184','11111111-1111-1111-1111-111111111111',
   'Falszerz A','fa@example.com','Podrzucona referencja.','careers',
   jsonb_build_object('cv_path','22222222-2222-2222-2222-222222222222/uploads/2026-01-01/b0b0b0b0-1111-2222-3333-444444444444.pdf')),
  -- Pozniejsza referencja B do pliku legacy A - przy usunieciu WLASCICIELA nie moze go blokowac.
  ('c0000000-0000-0000-0000-000000000185','22222222-2222-2222-2222-222222222222',
   'Falszerz B','fb@example.com','Podrzucona referencja legacy.','careers',
   jsonb_build_object('cv_path','uploads/2026-01-01/ffffffff-1111-2222-3333-444444444444.pdf'));
ALTER TABLE public.contact_messages ENABLE TRIGGER trg_contact_messages_career_cv_path_guard;
INSERT INTO storage.objects (bucket_id, name, created_at) VALUES
  ('career-cv','22222222-2222-2222-2222-222222222222/uploads/2026-01-01/b0b0b0b0-1111-2222-3333-444444444444.pdf',
   now() - interval '48 hours');
UPDATE public.career_applications SET stage = 'rejected'
 WHERE message_id = 'c0000000-0000-0000-0000-000000000183';
UPDATE public.career_applications SET stage_changed_at = now() - interval '730 days'
 WHERE message_id = 'c0000000-0000-0000-0000-000000000183';
DO $$
BEGIN
  PERFORM public.career_cv_gc_scan(1000);
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.career_cv_gc_queue WHERE path LIKE '%eeeeeeee-1111%'),
    'retencja procesu w A NIE kolejkuje CV najemcy B, na ktore wskazuje podrzucona sciezka'
  );
  PERFORM pg_temp.assert(
    (SELECT reason || ':' || tenant_id::text FROM public.career_cv_gc_queue
      WHERE path LIKE '%b0b0b0b0-1111%')
      = 'orphan:22222222-2222-2222-2222-222222222222',
    'plik B wskazywany WYLACZNIE przez falszywke w A jest osierocony (RODO: nie zyje wiecznie)'
  );
END $$;

DELETE FROM public.contact_messages WHERE id = 'c0000000-0000-0000-0000-000000000004';
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT reason || ':' || tenant_id::text FROM public.career_cv_gc_queue
      WHERE path LIKE '%ffffffff-1111%')
      = 'application_deleted:11111111-1111-1111-1111-111111111111',
    'usuniecie zgloszenia-WLASCICIELA pliku legacy kolejkuje go mimo pozniejszej obcej referencji'
  );
END $$;

-- 18d. Struktura: polityki nie czytaja juz referencji, indeks po sciezce dziala.
DO $$
DECLARE r record; plan text := '';
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname IN ('career_cv_staff_read','career_cv_staff_delete')
        AND qual ~ 'career_cv_object_owner\(name\) = current_tenant_id\(\)'
        AND qual !~ 'contact_messages'
        AND qual !~ ' OR ') = 2,
    'odczyt i usuniecie CV: wylacznie wlasciciel obiektu = current_tenant_id(), bez galezi OR'
  );
  PERFORM pg_temp.assert(
    to_regclass('public.contact_messages_cv_path_idx') IS NULL,
    'nieuzywany indeks (tenant_id, cv_path) zdjety'
  );
  SET LOCAL enable_seqscan = off;
  FOR r IN EXECUTE $q$EXPLAIN SELECT m.tenant_id FROM public.contact_messages m
                       WHERE m.custom ? 'cv_path' AND m.custom ->> 'cv_path' = 'uploads/x.pdf'$q$ LOOP
    plan := plan || r."QUERY PLAN" || E'\n';
  END LOOP;
  PERFORM pg_temp.assert(
    plan LIKE '%contact_messages_cv_path_lookup_idx%',
    'wyszukanie wlasciciela po sciezce moze uzyc indeksu czesciowego'
  );
END $$;

\echo ''
\echo 'Wszystkie asercje modulu rekrutacji przeszly.'
