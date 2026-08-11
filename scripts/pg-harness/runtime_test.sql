-- Funkcjonalna weryfikacja inwariantow modulu na ZYWEJ bazie.
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

-- Zrodlo funkcji po SAMEJ NAZWIE. Asercje strukturalne (sekcja 41) wpisywaly
-- wczesniej pelna liste typow w `::regprocedure`, wiec kazda migracja dokladajaca
-- parametr przewracala je komunikatem "function does not exist" - o czyms, czego
-- nie sprawdzaly. Jednoznacznosc nazwy pilnuje sekcja 0.
CREATE OR REPLACE FUNCTION pg_temp.fndef(_name text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT pg_get_functiondef(p.oid) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = _name
$$;

-- ---------------------------------------------------------------------------
-- Fixture: dwa tenanty, pieciu aktorow
-- ---------------------------------------------------------------------------
-- Tenant A zaklada JUZ harness.sql - migracje modulu seeduja dane wzgledem
-- `public_tenant_id()`, wiec musi istniec przed nimi. Tutaj zostaje wylacznie
-- domknieciem fixture'a (tenant B) i dlatego wstawka jest idempotentna.
INSERT INTO public.tenants (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111','Tenant A','ta'),
  ('22222222-2222-2222-2222-222222222222','Tenant B','tb')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001','admin-a@t'),
  ('a0000000-0000-0000-0000-000000000002','super-a@t'),
  ('a0000000-0000-0000-0000-000000000003','member-a@t'),
  ('a0000000-0000-0000-0000-000000000004','outsider-a@t'),
  ('a0000000-0000-0000-0000-000000000005','lead-a@t'),
  ('b0000000-0000-0000-0000-000000000001','admin-b@t');

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable) VALUES
  ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Admin A',true),
  ('a0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Super A',true),
  ('a0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Czlonek A',true),
  ('a0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Obcy A',true),
  ('a0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','Prowadzacy A',true),
  ('b0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Admin B',true);

-- Slugi sa potrzebne wzmiankom: process_mentions rozwiazuje "@slug" po
-- profiles.slug, wiec bez nich sekcja szwow testowalaby nic.
UPDATE public.profiles SET slug = 'admin-a' WHERE id='a0000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET slug = 'czlonek-a' WHERE id='a0000000-0000-0000-0000-000000000003';
UPDATE public.profiles SET slug = 'prowadzacy-a' WHERE id='a0000000-0000-0000-0000-000000000005';

-- super_admin CELOWO bez osobnej roli 'admin' - uklad, w ktorym padlo
-- profiles_guard_verification (audyt 2026-08-06).
INSERT INTO public.user_roles (user_id, role) VALUES
  ('a0000000-0000-0000-0000-000000000001','admin'),
  ('a0000000-0000-0000-0000-000000000002','super_admin'),
  ('b0000000-0000-0000-0000-000000000001','admin');

\echo '== 0. [8.1] Zadna funkcja modulu nie ma dwoch przeciazen =='
-- Ta asercja stoi PIERWSZA, bo kolizja sygnatur przewraca kazde pozniejsze
-- wywolanie komunikatem "function ... is not unique", ktory nie mowi, KTORA
-- migracja zapomniala DROP-a. Lepiej dostac nazwe funkcji od razu.
--
-- Wzorzec jest ten sam, co w sekcji 54 (emit_domain_event po A12): migracja
-- zmienia liste parametrow, robi `CREATE OR REPLACE`, a stary wariant zostaje
-- obok nowego. Przy odtwarzaniu schematu od zera - czyli w CI i na nowym
-- srodowisku - kazde wywolanie z krotsza lista argumentow staje sie
-- niejednoznaczne (42725), mimo ze na dlugo zyjacej bazie developerskiej
-- wszystko dzialalo.
--
-- Sprawdzamy CALY modul, a nie wybrane nazwy: lista funkcji rosnie z kazda
-- migracja, wiec asercja wskazujaca palcem musialaby byc dopisywana rownolegle
-- do kodu i wlasnie dlatego nigdy nie jest.
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'club\_%' OR p.proname LIKE 'admin\_club\_%')
     GROUP BY p.proname HAVING count(*) > 1
  ),
  format('8.1: kazda funkcja modulu ma jedno przeciazenie (kolizje: %s)',
    COALESCE((SELECT string_agg(x.sigs, ' ;; ') FROM (
      SELECT string_agg(p.oid::regprocedure::text, ' | ' ORDER BY p.pronargs) AS sigs
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND (p.proname LIKE 'club\_%' OR p.proname LIKE 'admin\_club\_%')
       GROUP BY p.proname HAVING count(*) > 1
    ) x), 'brak')));

\echo '== 1. Bramka administracyjna i inwariant super_admin >= admin =='
SELECT pg_temp.assert(public.is_club_admin('a0000000-0000-0000-0000-000000000001'),
  'admin przechodzi is_club_admin');
SELECT pg_temp.assert(public.is_club_admin('a0000000-0000-0000-0000-000000000002'),
  'super_admin BEZ roli admin przechodzi is_club_admin');
SELECT pg_temp.assert(NOT public.is_club_admin('a0000000-0000-0000-0000-000000000003'),
  'zwykly czlonek nie przechodzi');
SELECT pg_temp.assert(NOT public.is_club_admin(NULL), 'anonim nie przechodzi');

\echo '== 2. Tworzenie struktury (admin tenanta A) =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';

SELECT public.admin_club_upsert('{"slug":"klub","name_pl":"Klub","name_en":"Club",
  "visibility":"members","who_can_post":"moderators","moderation_mode":"post",
  "attribution_mode":"anonymous_allowed","status":"active"}'::jsonb) AS club_id \gset

SELECT pg_temp.assert((SELECT count(*) FROM public.clubs WHERE slug='klub') = 1, 'klub powstal');
SELECT pg_temp.assert((SELECT count(*) FROM public.club_groups WHERE slug='ogolna') = 1,
  'nowy klub dostaje domyslna grupe');
SELECT pg_temp.assert(
  (SELECT tenant_id FROM public.club_groups LIMIT 1) = '11111111-1111-1111-1111-111111111111',
  'grupa dziedziczy tenanta z klubu');

SELECT pg_temp.assert_raises(
  $q$ SELECT public.admin_club_upsert('{"slug":"klub","name_pl":"Duplikat"}'::jsonb) $q$,
  'powtorzony slug w tym samym tenancie');

\echo '== 3. Izolacja tenanta =='
SET request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';

SELECT pg_temp.assert((SELECT count(*) FROM public.admin_club_list(NULL,NULL,NULL,50,0)) = 0,
  'admin tenanta B nie widzi klubow tenanta A');
SELECT pg_temp.assert((SELECT count(*) FROM public.admin_club_get(:'club_id'::uuid)) = 0,
  'admin tenanta B nie odczyta klubu tenanta A po id');
SELECT pg_temp.assert(
  (SELECT reason FROM public.club_capabilities(:'club_id'::uuid, NULL,
     'b0000000-0000-0000-0000-000000000001')) = 'not_found',
  'obcy tenant dostaje not_found, nie forbidden');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.admin_club_group_upsert('{"club_id":"%s","slug":"obca","name_pl":"Obca"}'::jsonb) $q$, :'club_id'),
  'admin tenanta B nie dopisze grupy do klubu tenanta A');

\echo '== 4. Rola klubowa NIGDY nie jest rola platformy =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';

SELECT pg_temp.assert_raises(
  format($q$ SELECT public.admin_club_member_upsert('%s','a0000000-0000-0000-0000-000000000003','admin','active',NULL) $q$, :'club_id'),
  'rola platformy "admin" odrzucona jako rola klubowa');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.admin_club_member_upsert('%s','b0000000-0000-0000-0000-000000000001','member','active',NULL) $q$, :'club_id'),
  'osoba z obcego tenanta nie zostanie czlonkiem');

SELECT public.admin_club_member_upsert(:'club_id'::uuid,'a0000000-0000-0000-0000-000000000003','member','active',NULL);
SELECT public.admin_club_member_upsert(:'club_id'::uuid,'a0000000-0000-0000-0000-000000000005','lead','active',NULL);
SELECT pg_temp.assert((SELECT member_count FROM public.clubs WHERE slug='klub') = 2,
  'trigger policzyl czlonkow');

\echo '== 5. who_can_post = moderators: kto realnie moze zalozyc temat =='
SELECT pg_temp.assert(
  (SELECT can_post_thread FROM public.club_capabilities(:'club_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000001')),
  'admin moze zalozyc temat');
SELECT pg_temp.assert(
  (SELECT can_post_thread FROM public.club_capabilities(:'club_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000002')),
  'super_admin moze zalozyc temat');
SELECT pg_temp.assert(
  (SELECT can_post_thread FROM public.club_capabilities(:'club_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000005')),
  'prowadzacy (nadany przez admina) moze zalozyc temat');
SELECT pg_temp.assert(
  NOT (SELECT can_post_thread FROM public.club_capabilities(:'club_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000003')),
  'zwykly czlonek NIE moze - zgodnie z ustawieniem moderators');
SELECT pg_temp.assert(
  NOT (SELECT can_post_thread FROM public.club_capabilities(:'club_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000004')),
  'nie-czlonek NIE moze');

\echo '== 6. Zdolnosci: struktura i ujawnianie autora =='
SELECT pg_temp.assert(
  (SELECT can_manage FROM public.club_capabilities(:'club_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000002')),
  'super_admin zarzadza struktura');
SELECT pg_temp.assert(
  NOT (SELECT can_manage FROM public.club_capabilities(:'club_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000005')),
  'prowadzacy NIE zarzadza struktura');
SELECT pg_temp.assert(
  NOT (SELECT can_reveal_author FROM public.club_capabilities(:'club_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000005')),
  'prowadzacy NIE ujawnia autora - jest strona dyskusji');

\echo '== 7. Kadencja roli odbiera uprawnienia NATYCHMIAST =='
SELECT public.admin_club_member_upsert(:'club_id'::uuid,'a0000000-0000-0000-0000-000000000005',
  'lead','active', now() - interval '1 day');
SELECT pg_temp.assert(
  (SELECT effective_role FROM public.club_capabilities(:'club_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000005')) = 'member',
  'wygasla kadencja sprowadza lead do member natychmiast, bez joba');
SELECT pg_temp.assert(
  NOT (SELECT can_post_thread FROM public.club_capabilities(:'club_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000005')),
  'po wygasnieciu kadencji traci prawo zakladania tematow');
-- Przywrocenie na potrzeby dalszych testow. Kadencje trzeba teraz zdjac
-- JAWNIE: NULL w p_role_expires_at znaczy "nie ruszaj", a nie "wyczysc" -
-- wczesniej ta linia dzialala tylko dzieki bledowi, ktory cicho zerowal
-- kadencje przy kazdej zmianie roli z panelu.
SELECT public.admin_club_member_upsert(:'club_id'::uuid,'a0000000-0000-0000-0000-000000000005',
  'lead','active',NULL,true);
SELECT pg_temp.assert(
  (SELECT role_expires_at FROM public.club_members
    WHERE club_id=:'club_id'::uuid AND user_id='a0000000-0000-0000-0000-000000000005') IS NULL,
  'jawne czyszczenie kadencji dziala');

\echo '== 8. Klub secret nie istnieje dla obcego =='
SELECT public.admin_club_upsert('{"slug":"tajny","name_pl":"Tajny","name_en":"Secret",
  "visibility":"secret","status":"active"}'::jsonb) AS secret_id \gset
SELECT pg_temp.assert(
  NOT (SELECT can_read FROM public.club_capabilities(:'secret_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000004')),
  'nie-czlonek nie czyta klubu secret');
SELECT pg_temp.assert(
  (SELECT reason FROM public.club_capabilities(:'secret_id'::uuid,NULL,'a0000000-0000-0000-0000-000000000004')) = 'not_found',
  'klub secret nie zdradza swojego istnienia');
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert((SELECT count(*) FROM public.club_list() WHERE slug='tajny') = 0,
  'klub secret nie pojawia sie na liscie obcego');
SELECT pg_temp.assert((SELECT count(*) FROM public.club_view('tajny')) = 0,
  'club_view klubu secret zwraca zero wierszy dla obcego (404, nie 403)');

\echo '== 9. Tresc: tworzenie, drzewo, splaszczenie =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT g.id AS group_id FROM public.club_groups g WHERE g.club_id = :'club_id'::uuid LIMIT 1 \gset

SELECT id AS thread_id FROM public.club_create_thread(:'group_id'::uuid,
  'Rozporzadzenie CBAM i granica','Tresc pierwszego tematu, dluzsza niz dziesiec znakow.',
  'discussion', false, NULL, NULL) \gset

SELECT pg_temp.assert((SELECT slug FROM public.club_threads WHERE id=:'thread_id'::uuid)
  ~ '^[a-z0-9]+(-[a-z0-9]+)*$', 'slug tematu ma poprawny format');
SELECT pg_temp.assert((SELECT slug FROM public.club_threads WHERE id=:'thread_id'::uuid)
  = 'rozporzadzenie-cbam-i-granica', 'slug przeszedl przez unaccent, nie zamienil sie w myslniki');
SELECT pg_temp.assert((SELECT thread_count FROM public.clubs WHERE slug='klub') = 1,
  'trigger policzyl temat');

-- `club_reply` oddaje dzis PARE (reply_id, reply_status) - premoderacja musi
-- powiedziec wolajacemu, czy glos jest juz widoczny. Wczesniej harness nie
-- widzial migracji, ktora to zmienila (padala na braku `public.polls`), wiec
-- wywolanie skalarne przechodzilo. Bierzemy kolumnę, nie caly rekord.
SELECT reply_id AS r0 FROM public.club_reply(:'thread_id'::uuid,'Poziom 0',NULL,false) \gset
SELECT reply_id AS r1 FROM public.club_reply(:'thread_id'::uuid,'Poziom 1',:'r0'::uuid,false) \gset
SELECT reply_id AS r2 FROM public.club_reply(:'thread_id'::uuid,'Poziom 2',:'r1'::uuid,false) \gset
SELECT reply_id AS r3 FROM public.club_reply(:'thread_id'::uuid,'Probowal 3',:'r2'::uuid,false) \gset

SELECT pg_temp.assert((SELECT max(depth) FROM public.club_replies) = 2,
  'drzewo NIGDY nie przekracza glebokosci 2');
SELECT pg_temp.assert((SELECT depth FROM public.club_replies WHERE id=:'r3'::uuid) = 2,
  'odpowiedz na poziom 2 splaszcza sie, nie znika');
SELECT pg_temp.assert(
  (SELECT parent_id FROM public.club_replies WHERE id=:'r3'::uuid) = :'r1'::uuid,
  'splaszczona odpowiedz przypina sie do dziadka');
SELECT pg_temp.assert((SELECT reply_count FROM public.club_threads WHERE id=:'thread_id'::uuid) = 4,
  'trigger policzyl odpowiedzi');

\echo '== 10. ANONIMOWOSC: author_id nie opuszcza bazy =='
SELECT public.admin_club_upsert('{"slug":"chatham","name_pl":"Chatham","name_en":"Chatham",
  "visibility":"members","who_can_post":"moderators","attribution_mode":"chatham",
  "status":"active"}'::jsonb) AS ch_id \gset
SELECT g.id AS ch_group FROM public.club_groups g WHERE g.club_id = :'ch_id'::uuid LIMIT 1 \gset
SELECT id AS ch_thread FROM public.club_create_thread(:'ch_group'::uuid,
  'Temat pod regula Chatham','Tresc tematu w trybie chatham, dluzsza niz dziesiec znakow.',
  'discussion', false, NULL, NULL) \gset

SELECT pg_temp.assert(
  (SELECT author_id FROM public.club_threads WHERE id=:'ch_thread'::uuid) IS NOT NULL,
  'author_id JEST w bazie - moderacja musi dzialac');
SELECT pg_temp.assert(
  (SELECT author_id FROM public.club_thread_view(:'ch_id'::uuid,'temat-pod-regula-chatham')) IS NULL,
  'club_thread_view NIE zwraca author_id w trybie chatham');
SELECT pg_temp.assert(
  (SELECT author_name FROM public.club_thread_view(:'ch_id'::uuid,'temat-pod-regula-chatham')) IS NULL,
  'club_thread_view nie zwraca imienia w trybie chatham');
SELECT pg_temp.assert(
  (SELECT author_alias FROM public.club_thread_view(:'ch_id'::uuid,'temat-pod-regula-chatham')) IS NOT NULL,
  'zamiast tego zwraca alias');
SELECT pg_temp.assert(
  (SELECT author_id FROM public.club_threads_list(:'ch_id'::uuid,NULL,'hot',NULL,NULL,20) LIMIT 1) IS NULL,
  'club_threads_list NIE zwraca author_id w trybie chatham');

-- Alias stabilny w watku, ROZNY miedzy watkami (osolenie per watek).
SELECT pg_temp.assert(
  public.club_author_alias(:'ch_thread'::uuid,'a0000000-0000-0000-0000-000000000001')
  = public.club_author_alias(:'ch_thread'::uuid,'a0000000-0000-0000-0000-000000000001'),
  'alias stabilny w obrebie watku');

\echo '== 11. Reakcje: rozlacznosc stanowiska =='
SELECT public.club_react('thread',:'thread_id'::uuid,'agree');
SELECT pg_temp.assert((SELECT count(*) FROM public.club_reactions WHERE kind='agree')=1,'agree zapisane');
SELECT public.club_react('thread',:'thread_id'::uuid,'disagree');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_reactions
    WHERE kind IN ('agree','disagree') AND user_id='a0000000-0000-0000-0000-000000000001')=1,
  'ta sama osoba NIGDY nie ma agree i disagree naraz');
SELECT pg_temp.assert(
  (SELECT kind FROM public.club_reactions
    WHERE kind IN ('agree','disagree') AND user_id='a0000000-0000-0000-0000-000000000001')='disagree',
  'po zmianie zdania zostaje nowe stanowisko');

SELECT public.club_react('thread',:'thread_id'::uuid,'insightful');
SELECT public.club_react('thread',:'thread_id'::uuid,'evidence');
SELECT public.club_react('thread',:'thread_id'::uuid,'thanks');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_reactions
    WHERE kind IN ('insightful','evidence','thanks') AND user_id='a0000000-0000-0000-0000-000000000001')=3,
  'reakcje jakosciowe sa niezalezne');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_react('thread','%s','fire') $q$, :'thread_id'),
  'reakcja spoza slownika odrzucona w bazie');
SELECT pg_temp.assert((SELECT hotness FROM public.club_threads WHERE id=:'thread_id'::uuid) > 0,
  'reakcje jakosciowe podbily ranking');

\echo '== 12. Powiadomienia: kontrakt kompletny =='
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_name='notification_preferences' AND column_name='enabled_club'),
  'kolumna enabled_club istnieje');
SELECT pg_temp.assert(
  (SELECT pg_get_constraintdef(oid) LIKE '%''club''%' FROM pg_constraint
    WHERE conname='notifications_kind_check'),
  'CHECK dopuszcza rodzaj club');
SELECT pg_temp.assert(
  (SELECT position('enabled_club' IN pg_get_functiondef(p.oid))>0 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='enqueue_notification'),
  'enqueue_notification zna galaz club');
-- Producent realnie wstawia wiersz.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.notifications WHERE kind='club') > 0,
  'producenci REALNIE wstawily powiadomienia rodzaju club');

\echo '== 13. Moderacja i ujawnienie autora =='
SELECT pg_temp.assert(public.club_moderate('thread',:'thread_id'::uuid,'pin','wazne'),'przypiecie');
SELECT pg_temp.assert((SELECT pinned_at IS NOT NULL FROM public.club_threads WHERE id=:'thread_id'::uuid),
  'przypiecie zapisane');
SELECT pg_temp.assert((SELECT count(*) FROM public.club_moderation_log WHERE action='pin')=1,
  'akcja zostawila slad w logu');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_moderate('reply','%s','pin',NULL) $q$, :'r0'),
  'przypiecie nie dotyczy odpowiedzi');

SELECT pg_temp.assert_raises(
  format($q$ SELECT * FROM public.club_moderator_reveal_author('thread','%s',NULL) $q$, :'ch_thread'),
  'ujawnienie BEZ POWODU odrzucone');
SELECT pg_temp.assert_raises(
  format($q$ SELECT * FROM public.club_moderator_reveal_author('thread','%s','   ') $q$, :'ch_thread'),
  'sam bialy znak nie jest powodem');
SELECT pg_temp.assert(
  (SELECT author_id FROM public.club_moderator_reveal_author('thread',:'ch_thread'::uuid,'zgloszenie'))
   = 'a0000000-0000-0000-0000-000000000001',
  'admin ujawnia autora podajac powod');
SELECT pg_temp.assert((SELECT count(*) FROM public.audit_log WHERE action='club.reveal_author')=1,
  'ujawnienie w audycie platformy');
SELECT pg_temp.assert((SELECT count(*) FROM public.club_moderation_log WHERE action='reveal_author')=1,
  'ujawnienie w logu klubu');

\echo '== 14. Zamkniety temat nie przyjmuje odpowiedzi =='
SELECT public.club_moderate('thread',:'thread_id'::uuid,'lock',NULL);
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_reply('%s','Jeszcze jedna',NULL,false) $q$, :'thread_id'),
  'zamkniety temat odrzuca odpowiedz');

\echo '== 15. Zaproszenia: rola platformy zawsze user =='
SELECT public.club_invite_by_email(:'club_id'::uuid,'ktos@zewnatrz.eu','moderator',NULL);
SELECT pg_temp.assert(
  (SELECT role::text FROM public.user_invitations WHERE email='ktos@zewnatrz.eu')='user',
  'rola PLATFORMY to zawsze user, nigdy rola klubowa');
SELECT pg_temp.assert(
  (SELECT metadata->>'club_role' FROM public.user_invitations WHERE email='ktos@zewnatrz.eu')='moderator',
  'rola KLUBOWA jedzie w metadata.club_role');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_invite_by_email('%s','zly-adres','member',NULL) $q$, :'club_id'),
  'niepoprawny e-mail odrzucony w bazie');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_invite_by_email('%s','x@y.eu','lead',NULL) $q$, :'club_id'),
  'rola lead nie przechodzi sciezka e-mailowa');

\echo '== 16. Linki zapraszajace: limit odporny na powtorzenia =='
SELECT token AS link_token FROM public.admin_club_invite_link_create(
  :'club_id'::uuid,'Konferencja','member',1,NULL,false,NULL) \gset
SELECT pg_temp.assert(length(:'link_token') >= 40,'token dlugi, nie sekwencyjny');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert(
  (SELECT status FROM public.club_redeem_invite_link(:'link_token'))='active',
  'obcy wchodzi linkiem');
SELECT pg_temp.assert(
  (SELECT used_count FROM public.club_invite_links WHERE token=:'link_token')=1,
  'licznik uzyc podniesiony raz');
-- Ta sama osoba drugi raz NIE zjada limitu.
SELECT public.club_redeem_invite_link(:'link_token');
SELECT pg_temp.assert(
  (SELECT used_count FROM public.club_invite_links WHERE token=:'link_token')=1,
  'ta sama osoba nie zjada limitu drugi raz');

\echo '== 17. Wyszukiwanie: puste zapytanie nie zwraca wszystkiego =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert((SELECT count(*) FROM public.club_search('',NULL,20))=0,
  'puste zapytanie zwraca zero');
SELECT pg_temp.assert((SELECT count(*) FROM public.club_search('   ',NULL,20))=0,
  'biale znaki zwracaja zero');
SELECT pg_temp.assert((SELECT count(*) FROM public.club_search('CBAM',NULL,20))>0,
  'wyszukiwanie po slowie z tytulu dziala');
-- Diakrytyki nie maja znaczenia dzieki unaccent w nes_polish.
SELECT pg_temp.assert((SELECT count(*) FROM public.club_search('rozporządzenie',NULL,20))>0,
  'zapytanie z polskimi znakami trafia w tresc bez nich');

\echo '== 18. Harmonogram =='
SELECT pg_temp.assert((public.club_scheduler_tick() ? 'groups_opened'),
  'club_scheduler_tick zwraca raport');


\echo '== 19. Koordynacja w panelu: publikacja W IMIENIU ze znacznikiem =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';

-- Autor spoza klubu jest odrzucany: publikacja w imieniu kogos, kto nie nalezy,
-- bylaby fabrykowaniem uczestnictwa.
SELECT pg_temp.assert_raises(
  format($q$ SELECT * FROM public.admin_club_thread_create('%s','Protokol ze spotkania',
    'Tresc protokolu, dluzsza niz dziesiec znakow.','b0000000-0000-0000-0000-000000000001','discussion',false) $q$,
    :'group_id'),
  'autor spoza klubu odrzucony przy publikacji w imieniu');

SELECT thread_slug AS behalf_slug FROM public.admin_club_thread_create(
  :'group_id'::uuid,'Protokol ze spotkania','Tresc protokolu, dluzsza niz dziesiec znakow.',
  'a0000000-0000-0000-0000-000000000003','discussion',false) \gset

SELECT pg_temp.assert(
  (SELECT author_id FROM public.club_threads WHERE slug=:'behalf_slug')
   = 'a0000000-0000-0000-0000-000000000003',
  'autorstwo przypisane wskazanej osobie');
SELECT pg_temp.assert(
  (SELECT posted_by_admin_id FROM public.club_threads WHERE slug=:'behalf_slug')
   = 'a0000000-0000-0000-0000-000000000001',
  'znacznik "wprowadzil admin" jest zapisany');
SELECT pg_temp.assert(
  (SELECT posted_by_admin_name FROM public.club_thread_view(:'club_id'::uuid,:'behalf_slug')) IS NOT NULL,
  'znacznik WYCHODZI w projekcji produktowej - podszycie nie jest ciche');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_moderation_log WHERE action='post_on_behalf')=1,
  'publikacja w imieniu zostawila slad w logu');

-- Publikacja pod wlasnym nazwiskiem NIE dostaje znacznika.
SELECT thread_slug AS own_slug FROM public.admin_club_thread_create(
  :'group_id'::uuid,'Wlasny temat admina','Tresc wlasnego tematu, dluzsza niz dziesiec znakow.',
  NULL,'discussion',false) \gset
SELECT pg_temp.assert(
  (SELECT posted_by_admin_id FROM public.club_threads WHERE slug=:'own_slug') IS NULL,
  'wlasny wpis admina nie dostaje znacznika');

\echo '== 20. Admin odpowiada w ZAMKNIETYM watku =='
-- Watek z sekcji 14 jest zamkniety; zwykly club_reply go odrzucil.
SELECT pg_temp.assert(
  public.admin_club_reply_create(:'thread_id'::uuid,'Sprostowanie redakcyjne',NULL,NULL) IS NOT NULL,
  'admin odpowiada w zamknietym watku - zamkniecie dotyczy dyskusji, nie sprostowania');

\echo '== 21. Miekkie usuwanie i przywracanie =='
SELECT public.club_moderate('reply',:'r0'::uuid,'delete','test');
SELECT pg_temp.assert((SELECT status FROM public.club_replies WHERE id=:'r0'::uuid)='deleted',
  'odpowiedz oznaczona jako usunieta');
SELECT pg_temp.assert((SELECT count(*) FROM public.club_replies WHERE id=:'r0'::uuid)=1,
  'wiersz ZOSTAJE w bazie - usuniecie jest miekkie');
SELECT pg_temp.assert(public.admin_club_restore('reply',:'r0'::uuid,'pomylka'),
  'przywrocenie dziala');
SELECT pg_temp.assert((SELECT status FROM public.club_replies WHERE id=:'r0'::uuid)='visible',
  'odpowiedz wrocila do widocznych');
SELECT pg_temp.assert((SELECT count(*) FROM public.club_moderation_log WHERE action='restore')=1,
  'przywrocenie w logu');

\echo '== 22. Przenoszenie tematu miedzy grupami =='
SELECT public.admin_club_group_upsert(
  format('{"club_id":"%s","slug":"druga","name_pl":"Druga","name_en":"Second","status":"active"}', :'club_id')::jsonb
) AS group2 \gset
SELECT pg_temp.assert(public.admin_club_thread_move(:'thread_id'::uuid, :'group2'::uuid),
  'temat przeniesiony');
SELECT pg_temp.assert(
  (SELECT group_id FROM public.club_threads WHERE id=:'thread_id'::uuid) = :'group2'::uuid,
  'temat jest w nowej grupie');
SELECT pg_temp.assert((SELECT count(*) FROM public.club_moderation_log WHERE action='move')=1,
  'przeniesienie w logu');

-- Grupa z INNEGO klubu jest odrzucana: ma inne czlonkostwo, wiec przeniesienie
-- odslonilo by tresc obcym.
SELECT g.id AS foreign_group FROM public.club_groups g
  JOIN public.clubs c ON c.id=g.club_id WHERE c.slug='chatham' LIMIT 1 \gset
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.admin_club_thread_move('%s','%s') $q$, :'thread_id', :'foreign_group'),
  'przeniesienie do grupy innego klubu odrzucone');

\echo '== 23. Akcje wsadowe =='
SELECT pg_temp.assert(
  public.admin_club_bulk_moderate('thread',
    ARRAY[:'thread_id'::uuid, :'ch_thread'::uuid], 'pin', 'partia') = 2,
  'akcja wsadowa objela oba tematy');
-- Bledny element nie przerywa partii.
SELECT pg_temp.assert(
  public.admin_club_bulk_moderate('reply', ARRAY[:'r1'::uuid, :'r2'::uuid], 'pin', NULL) = 0,
  'przypiecie odpowiedzi nie przechodzi, ale nie wywala partii');
SELECT pg_temp.assert(
  public.admin_club_bulk_member_role(:'club_id'::uuid,
    ARRAY['a0000000-0000-0000-0000-000000000003'::uuid], 'observer') = 1,
  'wsadowa zmiana roli');

\echo '== 24. Statystyki: odsetek tematow bez odpowiedzi =='
SELECT pg_temp.assert(
  (SELECT unanswered_pct FROM public.admin_club_stats(:'club_id'::uuid)) BETWEEN 0 AND 100,
  'unanswered_pct jest procentem, nie NULL-em');
SELECT pg_temp.assert(
  (SELECT unanswered_count FROM public.admin_club_stats(:'club_id'::uuid)) >= 0,
  'licznik tematow bez odpowiedzi policzony');
SELECT pg_temp.assert(
  (SELECT median_first_reply_hours FROM public.admin_club_stats(:'club_id'::uuid)) >= 0,
  'mediana czasu do pierwszej odpowiedzi policzona');

\echo '== 25. Panel widzi autora takze w trybie chatham =='
SELECT pg_temp.assert(
  (SELECT author_id FROM public.admin_club_threads(:'ch_id'::uuid,NULL,NULL,NULL,NULL,50,0) LIMIT 1)
   IS NOT NULL,
  'panel widzi autora w klubie chatham - bez tego nie da sie moderowac');
-- ...ale projekcja PRODUKTOWA nadal go nie zwraca.
SELECT pg_temp.assert(
  (SELECT author_id FROM public.club_threads_list(:'ch_id'::uuid,NULL,'hot',NULL,NULL,20) LIMIT 1)
   IS NULL,
  'projekcja produktowa NADAL nie zwraca author_id w chatham');

\echo '== 26. Izolacja tenanta w nowych funkcjach A7 =='
SET request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_club_threads(:'club_id'::uuid,NULL,NULL,NULL,NULL,50,0))=0,
  'admin tenanta B nie widzi tematow tenanta A');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_club_replies(:'thread_id'::uuid,100,0))=0,
  'admin tenanta B nie widzi odpowiedzi tenanta A');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_club_stats(:'club_id'::uuid))=0,
  'admin tenanta B nie odczyta statystyk tenanta A');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.admin_club_thread_move('%s','%s') $q$, :'thread_id', :'group2'),
  'admin tenanta B nie przeniesie tematu tenanta A');
SELECT pg_temp.assert_raises(
  format($q$ SELECT * FROM public.admin_club_thread_create('%s','Obcy','Tresc obcego tematu.',NULL,'discussion',false) $q$, :'group_id'),
  'admin tenanta B nie zalozy tematu w klubie tenanta A');
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';


\echo '== 27. [HARTOWANIE] Deanonimizacja przez alias jest zamknieta =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
-- UWAGA: harness biegnie jako superuser, ktory omija granty. Wlasciwym testem
-- jest wiec sprawdzenie SAMEGO GRANTU, nie proba wywolania.
SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated','public.club_author_alias(uuid,uuid)','EXECUTE'),
  'authenticated nie ma EXECUTE na aliasie');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon','public.club_author_alias(uuid,uuid)','EXECUTE'),
  'anon nie ma EXECUTE na aliasie');
-- ...a projekcja NADAL zwraca alias, bo jest SECURITY DEFINER.
SELECT pg_temp.assert(
  (SELECT author_alias FROM public.club_thread_view(:'ch_id'::uuid,'temat-pod-regula-chatham'))
   IS NOT NULL,
  'projekcja nadal pokazuje alias - interfejs nic nie traci');
-- Sol per tenant istnieje i jest niedostepna dla klienta.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_anonymity_salts) > 0, 'sol per tenant zostala utworzona');
SELECT pg_temp.assert(
  NOT has_table_privilege('authenticated','public.club_anonymity_salts','SELECT'),
  'klient nie odczyta soli');

\echo '== 28. [HARTOWANIE] club_capabilities nie odpowiada o CUDZE uprawnienia =='
-- Nie-staff pyta o role PROWADZACEGO. Ma dostac SWOJE uprawnienia.
-- Ta osoba weszla wczesniej linkiem (sekcja 16), wiec jej wlasna rola to
-- 'member' - i wlasnie ta wartosc musi wrocic, nigdy 'lead'.
SELECT pg_temp.assert(
  (SELECT effective_role FROM public.club_capabilities(:'club_id'::uuid,NULL,
     'a0000000-0000-0000-0000-000000000005'))
  = (SELECT effective_role FROM public.club_capabilities(:'club_id'::uuid,NULL,NULL)),
  'pytanie o cudze id zwraca WLASNE uprawnienia - parametr jest ignorowany');
SELECT pg_temp.assert(
  (SELECT effective_role FROM public.club_capabilities(:'club_id'::uuid,NULL,
     'a0000000-0000-0000-0000-000000000005')) <> 'lead',
  'rola prowadzacego NIE wycieka do nie-staffu');
SELECT pg_temp.assert(
  NOT (SELECT can_manage FROM public.club_capabilities(:'club_id'::uuid,NULL,
     'a0000000-0000-0000-0000-000000000001')),
  'zdolnosci ADMINA nie wyciekaja do nie-staffu');
-- Klub secret jest nieodrozniany od nieistniejacego takze dla cudzego id.
SELECT pg_temp.assert(
  (SELECT reason FROM public.club_capabilities(:'secret_id'::uuid,NULL,
     'a0000000-0000-0000-0000-000000000001')) = 'not_found',
  'klub secret nie zdradza istnienia nawet przy pytaniu o admina');
-- Staff NADAL moze podejrzec cudze uprawnienia - to jest narzedzie diagnostyczne.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT effective_role FROM public.club_capabilities(:'club_id'::uuid,NULL,
     'a0000000-0000-0000-0000-000000000005')) = 'lead',
  'staff NADAL widzi cudze uprawnienia - Podglad jako... dziala');
-- ...ale WYLACZNIE we wlasnym tenancie. is_club_admin() to rola platformowa,
-- wiec bez zwiazania z current_tenant_id() admin tenanta B pytalby o role
-- dowolnej osoby w klubie tenanta A - ta sama luka co w club_set_role.
SET request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT effective_role FROM public.club_capabilities(:'club_id'::uuid,NULL,
     'a0000000-0000-0000-0000-000000000005')) <> 'lead',
  'admin tenanta B NIE podejrzy roli czlonka klubu tenanta A');
SELECT pg_temp.assert(
  (SELECT reason FROM public.club_capabilities(:'club_id'::uuid,NULL,
     'a0000000-0000-0000-0000-000000000005')) = 'not_found',
  'obcy tenant dostaje not_found, a nie czastkowa odpowiedz');

\echo '== 29. [HARTOWANIE] club_set_role skalowany po tenancie =='
SET request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_set_role('%s','a0000000-0000-0000-0000-000000000003','lead',NULL) $q$, :'club_id'),
  'admin tenanta B NIE zmieni roli w klubie tenanta A');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_ban_member('%s','a0000000-0000-0000-0000-000000000003',true,'x') $q$, :'club_id'),
  'admin tenanta B NIE zbanuje czlonka klubu tenanta A');

\echo '== 30. [HARTOWANIE] Trigger zaproszen nie wywala sie na enumie =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_members m JOIN public.clubs c ON c.id=m.club_id
    WHERE c.slug='klub' AND m.user_id='a0000000-0000-0000-0000-000000000002') >= 0,
  'stan wyjsciowy');
UPDATE public.user_invitations
   SET auth_user_id='a0000000-0000-0000-0000-000000000002', status='accepted'
 WHERE email='ktos@zewnatrz.eu';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_members m JOIN public.clubs c ON c.id=m.club_id
    WHERE c.slug='klub' AND m.user_id='a0000000-0000-0000-0000-000000000002'
      AND m.invite_source='email') = 1,
  'akceptacja zaproszenia e-mailowego REALNIE zapisuje czlonkostwo');

\echo '== 31. [HARTOWANIE] Podglad segmentu dziala =='
SELECT pg_temp.assert(
  (SELECT matched FROM public.admin_club_segment_preview(:'club_id'::uuid,
     '{"kind":"badge","badge":"expert"}'::jsonb)) >= 0,
  'segment_preview zwraca liczby zamiast bledu');
SELECT pg_temp.assert(
  (SELECT will_send FROM public.admin_club_segment_preview(:'club_id'::uuid,
     '{"kind":"nieznany"}'::jsonb)) = 0,
  'nieznana regula daje zera, nie wyjatek');

\echo '== 32. [HARTOWANIE] Kolejka moderacji nie ujawnia autora anonimowego =='
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_club_moderation_queue(:'ch_id'::uuid)
    WHERE author_name IS NOT NULL AND is_anonymous) = 0,
  'w kolejce nie ma nazwiska przy wpisie chronionym regula');

\echo '== 33. [HARTOWANIE] Subskrypcja wymaga dostepu do klubu =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT id AS secret_group FROM public.club_groups
 WHERE club_id = :'secret_id'::uuid LIMIT 1 \gset
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT id AS secret_thread FROM public.club_create_thread(:'secret_group'::uuid,
  'Temat w klubie tajnym','Tresc tematu tajnego, dluzsza niz dziesiec znakow.',
  'discussion', false, NULL, NULL) \gset
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_subscribe_thread('%s','subscribed') $q$, :'secret_thread'),
  'obcy NIE zasubskrybuje watku z klubu secret');

\echo '== 34. [HARTOWANIE] Limit zaproszen liczy OBIE sciezki =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(public.club_invite_quota_ok('a0000000-0000-0000-0000-000000000001'),
  'admin ma jeszcze limit');
SELECT pg_temp.assert(
  (SELECT position('user_invitations' IN pg_get_functiondef(p.oid)) > 0
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='club_invite_quota_ok'),
  'limit liczy takze zaproszenia e-mailowe');

\echo '== 35. [HARTOWANIE] IMMUTABLE -> STABLE tam, gdzie czytamy now() =='
SELECT pg_temp.assert(
  (SELECT provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='club_effective_member_role') = 's',
  'club_effective_member_role jest STABLE, nie IMMUTABLE');
SELECT pg_temp.assert(
  (SELECT provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='club_thread_hotness') = 's',
  'club_thread_hotness jest STABLE');

\echo '== 36. [HARTOWANIE] Ranking nie gubi skladnika jakosciowego =='
SELECT id AS hot_thread FROM public.club_create_thread(:'group_id'::uuid,
  'Temat do rankingu jakosci','Tresc tematu do sprawdzenia rankingu, dluzsza niz dziesiec znakow.',
  'discussion', false, NULL, NULL) \gset
SELECT public.club_react('thread', :'hot_thread'::uuid, 'insightful');
SELECT public.club_react('thread', :'hot_thread'::uuid, 'evidence');
SELECT hotness AS h_before FROM public.club_threads WHERE id = :'hot_thread'::uuid \gset
-- Odpowiedz PODNOSI ranking; wczesniej zerowala skladnik jakosciowy.
-- Sciezka administracyjna, bo limit 5 odpowiedzi/min zdazyl sie wyczerpac
-- wczesniejszymi sekcjami - i to jest poprawne zachowanie limitu.
SELECT public.admin_club_reply_create(:'hot_thread'::uuid, 'Odpowiedz podnoszaca ranking', NULL, NULL);
SELECT pg_temp.assert(
  (SELECT hotness FROM public.club_threads WHERE id = :'hot_thread'::uuid) > :'h_before'::numeric,
  'odpowiedz PODNOSI ranking zamiast kasowac wklad reakcji jakosciowych');

\echo '== 37. [HARTOWANIE] Paginacja odpowiedzi ma limit =='
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_replies_list(:'thread_id'::uuid,'chronological',2,0)) <= 2,
  'club_replies_list respektuje limit');
SELECT pg_temp.assert(
  (SELECT total_count FROM public.club_replies_list(:'thread_id'::uuid,'chronological',2,0) LIMIT 1) >= 2,
  'total_count zwraca pelna liczbe mimo limitu');

\echo '== 38. [HARTOWANIE] Zbanowani niewidoczni dla zwyklego czlonka =='
SELECT public.club_ban_member(:'club_id'::uuid,'a0000000-0000-0000-0000-000000000004',true,'test');
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_members_list(:'club_id'::uuid,NULL,100,0)
    WHERE status='banned') = 0,
  'zwykly czlonek nie widzi zbanowanych');
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_members_list(:'club_id'::uuid,NULL,100,0)
    WHERE status='banned') = 1,
  'moderacja NADAL widzi zbanowanych');

\echo '== 39. [A9] Grupa robocza nie wychodzi zadnym kanalem =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.admin_club_group_upsert(
  format('{"club_id":"%s","slug":"robocza","name_pl":"Robocza","name_en":"Draft","status":"draft"}',
         :'club_id')::jsonb
) AS draft_group \gset
-- Admin ma can_post_thread takze w grupie roboczej - i wlasnie dlatego watek
-- w niej powstaje normalnie, ze statusem 'open'. To jest scenariusz z audytu.
SELECT id AS draft_thread, slug AS draft_slug FROM public.club_create_thread(
  :'draft_group'::uuid, 'Temat w grupie roboczej',
  'Tresc, ktora nie moze wyjsc poza zarzadzajacego.',
  'discussion', false, NULL, NULL) \gset
-- Sciezka administracyjna: limit 5 odpowiedzi/min zdazyl sie wyczerpac
-- wczesniejszymi sekcjami, a tu chodzi o WIDOCZNOSC, nie o limit.
SELECT public.admin_club_reply_create(:'draft_thread'::uuid,
  'Odpowiedz w grupie roboczej', NULL, NULL);
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_thread_view(:'club_id'::uuid, :'draft_slug')) = 1,
  'zarzadzajacy NADAL widzi swoja grupe robocza');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  NOT (SELECT can_read FROM public.club_capabilities(:'club_id'::uuid, :'draft_group'::uuid,
       'a0000000-0000-0000-0000-000000000003')),
  'czlonek NIE czyta grupy roboczej - can_read, nie tylko can_post');
SELECT pg_temp.assert(
  (SELECT reason FROM public.club_capabilities(:'club_id'::uuid, :'draft_group'::uuid,
     'a0000000-0000-0000-0000-000000000003')) = 'not_open_yet',
  'powod mowi, co jest grane, zamiast milczec');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_thread_view(:'club_id'::uuid, :'draft_slug')) = 0,
  'widok watku nie oddaje tresci z grupy roboczej');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_replies_list(:'draft_thread'::uuid,'chronological',200,0)) = 0,
  'lista odpowiedzi nie oddaje dyskusji z grupy roboczej');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_search('robocz', :'club_id'::uuid, 20)) = 0,
  'wyszukiwarka nie znajduje watku z grupy roboczej');
-- Grupa zamrozona zostaje CZYTELNA: "mozna czytac, nie mozna pisac" to inna
-- regula niz "grupa w przygotowaniu nie istnieje".
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.admin_club_group_upsert(
  format('{"club_id":"%s","slug":"zamrozona","name_pl":"Zamrozona","name_en":"Frozen","status":"frozen"}',
         :'club_id')::jsonb
) AS frozen_group \gset
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT can_read FROM public.club_capabilities(:'club_id'::uuid, :'frozen_group'::uuid,
     'a0000000-0000-0000-0000-000000000003')),
  'grupa zamrozona NADAL jest do czytania');
SELECT pg_temp.assert(
  NOT (SELECT can_post_thread FROM public.club_capabilities(:'club_id'::uuid,
       :'frozen_group'::uuid, 'a0000000-0000-0000-0000-000000000003')),
  'grupa zamrozona nie przyjmuje nowych tematow');
-- Wektory: kolejka pomija grupe robocza, a prune sprzata to, co juz w niej jest.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_threads_needing_embeddings(50)
    WHERE thread_id = :'draft_thread'::uuid) = 0,
  'kolejka osadzen pomija watek z grupy roboczej');

\echo '== 40. [A9] Jedno stanowisko na wpis i osobe =='
-- Aktorem jest admin, a celem hot_thread: uzytkownik ...003 jest w tym
-- momencie 'observer' (zdegradowany w sekcji akcji wsadowych), a thread_id
-- jest 'locked' - obserwator na zamknietym watku nie ma can_react i to jest
-- poprawne zachowanie, nie przeszkoda do obejscia.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.club_react('thread', :'hot_thread'::uuid, 'agree');
SELECT public.club_react('thread', :'hot_thread'::uuid, 'disagree');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_reactions
    WHERE target_type='thread' AND target_id=:'hot_thread'::uuid
      AND user_id='a0000000-0000-0000-0000-000000000001'
      AND kind IN ('agree','disagree')) = 1,
  'po zmianie zdania zostaje DOKLADNIE jedno stanowisko');
SELECT pg_temp.assert(
  (SELECT kind FROM public.club_reactions
    WHERE target_type='thread' AND target_id=:'hot_thread'::uuid
      AND user_id='a0000000-0000-0000-0000-000000000001'
      AND kind IN ('agree','disagree')) = 'disagree',
  'obowiazuje ostatnia deklaracja, nie pierwsza');
-- Trigger realizuje UX (podmiana zamiast bledu), ale to indeks jest
-- ograniczeniem. Harness jest jednosesyjny, wiec wyscigu nie odtworzy -
-- sprawdzamy wiec, ze twarda bramka ISTNIEJE, a nie ze "dziala sekwencyjnie".
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM pg_indexes
           WHERE schemaname='public' AND indexname='club_reactions_one_stance'),
  'rozlacznosci stanowiska pilnuje indeks, nie sam trigger');
-- Trigger wylaczony CELOWO: z nim wlaczonym kazdy INSERT przechodzi, bo to
-- on kasuje przeciwne stanowisko. Pytanie brzmi, czy pod nim jest cokolwiek -
-- i wlasnie to sprawdzamy. Rownolegla transakcja robi dokladnie to samo:
-- jej DELETE nie widzi niezatwierdzonego wiersza obok, wiec do indeksu
-- docieraja dwa stanowiska naraz.
ALTER TABLE public.club_reactions DISABLE TRIGGER club_reactions_stance_exclusive_tg;
SELECT pg_temp.assert_raises(
  format($q$ INSERT INTO public.club_reactions
             (tenant_id, club_id, target_type, target_id, user_id, kind)
             SELECT r.tenant_id, r.club_id, 'thread', r.target_id, r.user_id, 'agree'
               FROM public.club_reactions r
              WHERE r.target_id='%s'
                AND r.user_id='a0000000-0000-0000-0000-000000000001'
                AND r.kind='disagree' $q$, :'hot_thread'),
  'drugie stanowisko odrzuca INDEKS, nie trigger');
ALTER TABLE public.club_reactions ENABLE TRIGGER club_reactions_stance_exclusive_tg;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_reactions
    WHERE target_type='thread' AND target_id=:'hot_thread'::uuid
      AND user_id='a0000000-0000-0000-0000-000000000001'
      AND kind IN ('agree','disagree')) = 1,
  'po odrzuconej probie nadal jest jedno stanowisko');

\echo '== 41. [A9] Limity antyspamowe sa zserializowane =='
-- Wyscigu nie da sie odtworzyc w jednej sesji. Asercja jest STRUKTURALNA:
-- pilnuje, ze blokada nie wyparuje z ciala funkcji przy kolejnym CREATE OR
-- REPLACE - a to jest dokladnie ten sposob, w jaki znikaja takie poprawki.
SELECT pg_temp.assert(
  pg_temp.fndef('club_create_thread') LIKE '%pg_advisory_xact_lock%',
  'club_create_thread bierze blokade przed liczeniem limitu');
SELECT pg_temp.assert(
  pg_temp.fndef('club_invite_by_email') LIKE '%club_invite:%',
  'club_invite_by_email bierze TEN SAM klucz blokady co club_invite');
SELECT pg_temp.assert(
  pg_temp.fndef('club_invite') LIKE '%club_invite:%',
  'club_invite nadal bierze ten klucz - obie sciezki dziela licznik');

\echo '== 42. [A10] Kadencja przezywa zmiane roli, zmiana idzie do dziennika =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.admin_club_member_upsert(:'club_id'::uuid,'a0000000-0000-0000-0000-000000000005',
  'lead','active', now() + interval '30 days');
SELECT role_expires_at AS kadencja FROM public.club_members
 WHERE club_id=:'club_id'::uuid AND user_id='a0000000-0000-0000-0000-000000000005' \gset
-- Zmiana samej roli, bez podania terminu. Wczesniej ta operacja cicho
-- kasowala kadencje, wiec club_scheduler_tick nie mial czego wygaszac.
SELECT public.admin_club_member_upsert(:'club_id'::uuid,'a0000000-0000-0000-0000-000000000005',
  'moderator','active',NULL);
SELECT pg_temp.assert(
  (SELECT role_expires_at FROM public.club_members
    WHERE club_id=:'club_id'::uuid AND user_id='a0000000-0000-0000-0000-000000000005')
  = :'kadencja'::timestamptz,
  'kadencja PRZEZYWA zmiane roli - pusty parametr znaczy "nie ruszaj"');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_moderation_log
    WHERE action='role_change' AND target_type='member'
      AND target_id='a0000000-0000-0000-0000-000000000005') >= 1,
  'zmiana roli z panelu zostawia slad w dzienniku');
-- Ta sama rola i status drugi raz: dziennik nie moze puchnac od zapisow
-- "ustawiono moderator na moderator".
SELECT count(*)::int AS log_before FROM public.club_moderation_log WHERE action='role_change' \gset
SELECT public.admin_club_member_upsert(:'club_id'::uuid,'a0000000-0000-0000-0000-000000000005',
  'moderator','active',NULL);
SELECT pg_temp.assert(
  (SELECT count(*)::int FROM public.club_moderation_log WHERE action='role_change') = :log_before,
  'zapis bez realnej zmiany NIE trafia do dziennika');
SELECT public.admin_club_member_upsert(:'club_id'::uuid,'a0000000-0000-0000-0000-000000000005',
  'lead','active',NULL,true);

\echo '== 43. [A10] Kasowanie grupy =='
SELECT public.admin_club_group_upsert(
  format('{"club_id":"%s","slug":"do-skasowania","name_pl":"Do skasowania","name_en":"Scratch","status":"active"}',
         :'club_id')::jsonb
) AS doomed \gset
SELECT pg_temp.assert(public.admin_club_group_delete(:'doomed'::uuid) = 0,
  'pusta grupa znika bez pytania');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_groups WHERE id=:'doomed'::uuid) = 0,
  'grupy naprawde nie ma');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_moderation_log
    WHERE action='group_delete' AND target_type='group') = 1,
  'kasowanie grupy jest w dzienniku');
-- Grupa z watkami wymaga wskazania celu.
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.admin_club_group_delete('%s') $q$, :'group2'),
  'grupa z watkami nie znika po cichu');
SELECT g.id AS survivor FROM public.club_groups g
 WHERE g.club_id=:'club_id'::uuid AND g.id <> :'group2'::uuid
   AND g.slug NOT IN ('robocza','zamrozona') LIMIT 1 \gset
SELECT pg_temp.assert(
  public.admin_club_group_delete(:'group2'::uuid, :'survivor'::uuid) >= 1,
  'grupa z watkami znika razem z przeniesieniem tresci');
SELECT pg_temp.assert(
  (SELECT group_id FROM public.club_threads WHERE id=:'thread_id'::uuid) = :'survivor'::uuid,
  'watki wyladowaly w grupie docelowej, a nie zniknely');
-- Grupa docelowa z innego klubu jest odrzucana, tak samo jak przy przenoszeniu.
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.admin_club_group_delete('%s','%s') $q$, :'survivor', :'ch_group'),
  'grupa docelowa z obcego klubu odrzucona');

\echo '== 44. [A10] Redakcja moderatorska poza oknem 15 minut =='
-- Watek autorstwa CZLONKA (wprowadzony w imieniu w sekcji 19), postarzony
-- recznie: okno autora zamkniete. Watek zalozony przez admina by tu nie
-- pasowal - moderator bylby jednoczesnie autorem i sciezka by sie nie rozeszla.
SELECT id AS member_thread FROM public.club_threads WHERE slug = :'behalf_slug' \gset
UPDATE public.club_threads SET created_at = now() - interval '2 hours'
 WHERE id = :'member_thread'::uuid;
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_edit_thread('%s','Nowy tytul','Nowa tresc',NULL) $q$, :'member_thread'),
  'autor po oknie 15 minut NIE poprawi wlasnego wpisu');
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  public.club_edit_thread(:'member_thread'::uuid,'Tytul po zaczernieniu',
    'Tresc po usunieciu danych osobowych','zgloszenie RODO'),
  'moderacja poprawia takze po oknie - zaczernienie nie czeka na zegar');
SELECT pg_temp.assert(
  (SELECT title FROM public.club_threads WHERE id=:'member_thread'::uuid) = 'Tytul po zaczernieniu',
  'poprawka faktycznie weszla');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_moderation_log
    WHERE action='edit' AND target_type='thread' AND target_id=:'member_thread'::uuid
      AND reason='zgloszenie RODO') = 1,
  'ingerencja w cudzy wpis zostawia slad z powodem');
-- Wlasna poprawka w oknie NIE zasmieca dziennika.
SELECT count(*)::int AS edits_before FROM public.club_moderation_log WHERE action='edit' \gset
SELECT own_id AS fresh_thread FROM (
  SELECT t.id AS own_id FROM public.club_threads t
   WHERE t.author_id='a0000000-0000-0000-0000-000000000001'
     AND t.created_at > now() - interval '15 minutes'
   ORDER BY t.created_at DESC LIMIT 1) x \gset
SELECT pg_temp.assert(
  public.club_edit_thread(:'fresh_thread'::uuid,'Poprawiona literowka','',NULL),
  'autor poprawia swoj swiezy wpis');
SELECT pg_temp.assert(
  (SELECT count(*)::int FROM public.club_moderation_log WHERE action='edit') = :edits_before,
  'wlasna poprawka NIE trafia do dziennika moderacji');

\echo '== 45. [A12] Szyny miedzymodulowe: zdarzenia, wzmianki, krawedzie =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT g.id AS seam_group FROM public.club_groups g
 WHERE g.club_id=:'club_id'::uuid AND g.status='active' LIMIT 1 \gset
SELECT id AS seam_thread, slug AS seam_slug FROM public.club_create_thread(
  :'seam_group'::uuid, 'Watek ze wzmianka',
  'Pytanie do @czlonek-a o stanowisko w tej sprawie.',
  'discussion', false, 'eu_policy_item', 'akt-2026-1') \gset

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.domain_events
    WHERE event_type='club_thread.created.v1' AND aggregate_id=:'seam_thread') = 1,
  'zalozenie watku emituje zdarzenie domenowe');
SELECT pg_temp.assert(
  (SELECT actor_id FROM public.domain_events
    WHERE event_type='club_thread.created.v1' AND aggregate_id=:'seam_thread')
  = 'a0000000-0000-0000-0000-000000000001',
  'wpis podpisany niesie aktora - workflow i inwalidacja maja z czego korzystac');
SELECT pg_temp.assert(
  (SELECT payload->>'club_id' FROM public.domain_events
    WHERE event_type='club_thread.created.v1' AND aggregate_id=:'seam_thread') = :'club_id',
  'payload niesie klub, po ktorym filtruje sie strumien');
SELECT pg_temp.assert(
  (SELECT payload ? 'title' FROM public.domain_events
    WHERE event_type='club_thread.created.v1' AND aggregate_id=:'seam_thread') = false,
  'payload NIE niesie tytulu - domain_events czyta caly staff tenantu');

-- Kotwica zamieniona na krawedz grafu: po to istnieje anchor_type.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.cross_references
    WHERE source_type='club_thread' AND source_id=:'seam_thread'
      AND target_type='eu_policy_item' AND relation='discusses') = 1,
  'kotwica watku staje sie krawedzia "discusses"');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.cross_references
    WHERE source_type='club_thread' AND source_id=:'seam_thread'
      AND target_type='club' AND relation='belongs_to') = 1,
  'watek jest przypiety do klubu w grafie powiazan');

-- Wzmianka dziala i niesie prawdziwe nazwisko przy wpisie podpisanym.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id='a0000000-0000-0000-0000-000000000003'
      AND n.kind='club' AND n.title_pl LIKE 'Admin A%') = 1,
  'wzmianka w watku podpisanym powiadamia i podaje autora');

\echo '== 46. [A12] Anonimowosc przezywa kazda z trzech szyn =='
-- Wpis anonimowy: zdarzenie BEZ aktora, krawedz BEZ tworcy, wzmianka bez nazwiska.
SELECT id AS anon_thread FROM public.club_create_thread(
  :'seam_group'::uuid, 'Watek anonimowy ze wzmianka',
  'Chcialbym uslyszec @prowadzacy-a w tej sprawie, ale zostaje anonimowy.',
  'discussion', true, NULL, NULL) \gset
SELECT pg_temp.assert(
  (SELECT actor_id FROM public.domain_events
    WHERE event_type='club_thread.created.v1' AND aggregate_id=:'anon_thread') IS NULL,
  'wpis anonimowy emituje zdarzenie BEZ aktora - redakcja nie zdeanonimizuje go z szyny');
SELECT pg_temp.assert(
  (SELECT created_by FROM public.cross_references
    WHERE source_type='club_thread' AND source_id=:'anon_thread'
      AND target_type='club') IS NULL,
  'krawedz grafu takze nie niesie autora');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id='a0000000-0000-0000-0000-000000000005'
      AND n.kind='club' AND n.title_pl LIKE 'Uczestnik dyskusji%') = 1,
  'wzmianka z wpisu anonimowego uzywa etykiety zastepczej, nie nazwiska');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id='a0000000-0000-0000-0000-000000000005'
      AND n.kind='club' AND n.title_pl LIKE 'Admin A%') = 0,
  'nazwisko ukrytego autora NIE pada w zadnym powiadomieniu');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.domain_events
    WHERE event_type='mention.created.v1' AND aggregate_id=:'anon_thread'
      AND actor_id IS NOT NULL) = 0,
  'zdarzenie wzmianki z wpisu anonimowego takze jest bez aktora');

-- Klub 'secret' nie emituje NICZEGO: nieodrozniany od nieistniejacego znaczy
-- nieodrozniany takze w szynie zdarzen i w grafie powiazan.
SELECT count(*)::int AS ev_before FROM public.domain_events \gset
SELECT count(*)::int AS xr_before FROM public.cross_references \gset
SELECT g.id AS secret_group FROM public.club_groups g
 WHERE g.club_id = :'secret_id'::uuid LIMIT 1 \gset
SELECT id AS secret_thread FROM public.club_create_thread(
  :'secret_group'::uuid, 'Watek w klubie ukrytym',
  'Tresc z klubu ukrytego, ze wzmianka @czlonek-a.',
  'discussion', false, 'eu_policy_item', 'akt-2026-9') \gset
SELECT pg_temp.assert(
  (SELECT count(*)::int FROM public.domain_events) = :ev_before,
  'klub secret nie emituje ZADNEGO zdarzenia');
SELECT pg_temp.assert(
  (SELECT count(*)::int FROM public.cross_references) = :xr_before,
  'klub secret nie zostawia sladu w grafie powiazan');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id='a0000000-0000-0000-0000-000000000003'
      AND n.href LIKE '%' || :'secret_thread' || '%') = 0,
  'wzmianka z klubu secret nie wychodzi na zewnatrz');

-- Etykieta w panelu powiazan: tytul tylko z klubu public/members.
SELECT pg_temp.assert(
  public.club_linked_item_label('club_thread', :'seam_thread') = 'Watek ze wzmianka',
  'panel powiazan pokazuje tytul watku z klubu czlonkowskiego');
SELECT pg_temp.assert(
  public.club_linked_item_label('club_thread', :'secret_thread') IS NULL,
  'panel powiazan nie zna watku z klubu ukrytego');

\echo '== 47. [A13] Ranking wsadowy liczy to samo, co wersja per wiersz =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
-- Uklad, ktory demaskuje iloczyn kartezjanski: watek z KILKOMA odpowiedziami
-- i JEDNA reakcja jakosciowa NA SAM WATEK. Naiwne zlaczenie po warunku OR
-- policzyloby te reakcje raz na kazda odpowiedz.
SELECT id AS cart_thread, slug AS cart_slug FROM public.club_create_thread(
  :'seam_group'::uuid, 'Watek do testu iloczynu',
  'Tresc watku, przy ktorym liczymy reakcje jakosciowe.',
  'discussion', false, NULL, NULL) \gset
SELECT public.admin_club_reply_create(:'cart_thread'::uuid, 'Pierwsza odpowiedz', NULL, NULL) AS c_r1 \gset
SELECT public.admin_club_reply_create(:'cart_thread'::uuid, 'Druga odpowiedz', NULL, NULL) AS c_r2 \gset
SELECT public.admin_club_reply_create(:'cart_thread'::uuid, 'Trzecia odpowiedz', NULL, NULL) AS c_r3 \gset
SELECT public.club_react('thread', :'cart_thread'::uuid, 'insightful');

SELECT pg_temp.assert(
  public.club_thread_quality_score(:'cart_thread'::uuid) = 1,
  'wersja per wiersz liczy JEDNA reakcje na watek, mimo trzech odpowiedzi');
-- Porownanie MUSI byc w jednej transakcji: club_thread_hotness ma czlon
-- wygaszania po czasie i czyta now(), ktore miedzy dwoma poleceniami psql
-- jest juz inne. Bez BEGIN/COMMIT test mierzylby uplyw czasu, nie wzor.
BEGIN;
SELECT public.club_threads_refresh_hotness(1000);
SELECT pg_temp.assert(
  (SELECT t.hotness FROM public.club_threads t WHERE t.id=:'cart_thread'::uuid)
  = (SELECT public.club_thread_hotness(
       1, t.reply_count, t.participant_count, 0, t.created_at)
       FROM public.club_threads t WHERE t.id=:'cart_thread'::uuid),
  'przebieg WSADOWY daje ten sam ranking co wzor z jedna reakcja - bez iloczynu');
-- Kontrola negatywna: gdyby zlaczenie dawalo iloczyn, reakcja policzylaby sie
-- trzy razy (po jednej na kazda odpowiedz) i wynik bylby INNY.
SELECT pg_temp.assert(
  (SELECT t.hotness FROM public.club_threads t WHERE t.id=:'cart_thread'::uuid)
  <> (SELECT public.club_thread_hotness(
        3, t.reply_count, t.participant_count, 0, t.created_at)
        FROM public.club_threads t WHERE t.id=:'cart_thread'::uuid),
  'wynik NIE odpowiada policzeniu reakcji raz na kazda odpowiedz');
COMMIT;

-- Reakcja na SAM WATEK podnosi ranking. To jest przypadek, ktory poprzedni
-- test rankingu omijal, bo szedl wylacznie sciezka przez odpowiedz.
SELECT hotness AS cart_h1 FROM public.club_threads WHERE id=:'cart_thread'::uuid \gset
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
SELECT public.club_react('thread', :'cart_thread'::uuid, 'evidence');
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.club_threads_refresh_hotness(1000);
SELECT pg_temp.assert(
  (SELECT hotness FROM public.club_threads WHERE id=:'cart_thread'::uuid) > :'cart_h1'::numeric,
  'reakcja jakosciowa NA WATEK podnosi ranking, nie tylko ta na odpowiedzi');

\echo '== 48. [A13] Spacer po kursorze nie gubi i nie dubluje tematow =='
-- Blad z A8 (przypiety watek wracajacy na kazdej stronie) byl bledem
-- PAGINACJI i zostal naprawiony bez testu, ktory by go zlapal. Ten test
-- przechodzi trzy strony i porownuje liczbe pobranych z liczba unikatow.
DO $$
DECLARE
  v_group uuid;
  v_i integer;
  v_id uuid;
BEGIN
  SELECT g.id INTO v_group FROM public.club_groups g
   JOIN public.clubs c ON c.id = g.club_id
   WHERE c.slug = 'klub' AND g.status = 'active' LIMIT 1;
  FOR v_i IN 1..45 LOOP
    INSERT INTO public.club_threads (
      tenant_id, club_id, group_id, author_id, slug, title, body, kind, status
    )
    SELECT g.club_id, g.club_id, v_group, 'a0000000-0000-0000-0000-000000000001',
           'kursor-' || v_i::text, 'Kursor ' || v_i::text,
           'Tresc watku numer ' || v_i::text, 'discussion', 'open'
      FROM public.club_groups g WHERE g.id = v_group
    RETURNING id INTO v_id;
    -- Co pietnasty przypiety: przypiecie jest najbardziej znaczacym czlonem
    -- klucza kursora, wiec bez niego test nie dotyka realnego ryzyka.
    IF v_i % 15 = 0 THEN
      UPDATE public.club_threads SET pinned_at = now() WHERE id = v_id;
    END IF;
  END LOOP;
END $$;

CREATE TEMP TABLE walk(id uuid);
DO $$
DECLARE
  v_cursor text := NULL;
  v_page   integer := 0;
  v_rows   integer;
  v_club   uuid;
BEGIN
  SELECT c.id INTO v_club FROM public.clubs c WHERE c.slug = 'klub';
  LOOP
    v_page := v_page + 1;
    EXIT WHEN v_page > 10;
    INSERT INTO walk(id)
    SELECT l.id FROM public.club_threads_list(v_club, NULL, 'hot', NULL, v_cursor, 20) l;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXIT WHEN v_rows = 0;
    SELECT l.cursor_value INTO v_cursor
      FROM public.club_threads_list(v_club, NULL, 'hot', NULL, v_cursor, 20) l
     ORDER BY l.cursor_value ASC LIMIT 1;
    EXIT WHEN v_rows < 20;
  END LOOP;
END $$;

SELECT pg_temp.assert(
  (SELECT count(*) FROM walk) = (SELECT count(DISTINCT id) FROM walk),
  'spacer po kursorze nie zwraca ZADNEGO duplikatu - takze przy przypietych');
SELECT pg_temp.assert(
  (SELECT count(*) FROM walk) >= 45,
  'spacer po kursorze obchodzi wszystkie zasiane tematy, nie gubi zadnego');

\echo '== 49. [A13] Kolejka moderacji jest stronicowana i przycieta =='
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_club_moderation_queue(:'club_id'::uuid, 1, 0)) <= 1,
  'kolejka respektuje limit strony');
SELECT pg_temp.assert(
  (SELECT coalesce(max(length(body)), 0)
     FROM public.admin_club_moderation_queue(:'club_id'::uuid, 200, 0)) <= 500,
  'kolejka zwraca PODGLAD tresci, nie dwadziescia tysiecy znakow');

\echo '== 50. [A13] Zakres rankingu przybity ograniczeniem =='
SELECT pg_temp.assert_raises(
  format($q$ UPDATE public.club_threads SET hotness = -1 WHERE id = '%s' $q$, :'cart_thread'),
  'ujemny ranking odrzucony - kursor tekstowy odwrocilby dla niego porzadek');
SELECT pg_temp.assert_raises(
  format($q$ UPDATE public.club_threads SET hotness = 1e10 WHERE id = '%s' $q$, :'cart_thread'),
  'ranking poza szerokoscia klucza kursora odrzucony');

\echo '== 51. [A13] club_list: stronicowanie i klub secret =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_list(1, 0)) <= 1,
  'lista klubow respektuje limit strony');
SELECT pg_temp.assert(
  (SELECT total_count FROM public.club_list(1, 0) LIMIT 1) >= 1,
  'total_count zwraca pelna liczbe mimo limitu');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_list(100, 0) WHERE slug = 'tajny') = 0,
  'tania bramka NADAL nie wpuszcza nie-czlonka do klubu secret');
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_list(100, 0) WHERE slug = 'tajny') = 1,
  'administrator NADAL widzi klub secret - bramka nie zgubila tej sciezki');

\echo '== 52. [A14] Zakladanie klubu: adres, uklad, czytelne odmowy =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';

-- Dostepnosc adresu ZANIM cokolwiek zapiszemy.
SELECT pg_temp.assert(
  public.admin_club_slug_available('adres-ktorego-nie-ma', NULL),
  'wolny adres jest raportowany jako wolny');
SELECT pg_temp.assert(
  NOT public.admin_club_slug_available('klub', NULL),
  'zajety adres jest raportowany jako zajety');
-- Przy edycji WLASNY slug klubu nie moze liczyc sie jako zajety, inaczej nie
-- dalo by sie zapisac formularza bez zmiany adresu.
SELECT pg_temp.assert(
  public.admin_club_slug_available('klub', :'club_id'::uuid),
  'wlasny adres klubu nie blokuje zapisu tego klubu');

-- Kolizja adresu ma WLASNY kod, nie surowy 23505 z indeksu.
SELECT pg_temp.assert_raises(
  $q$ SELECT public.admin_club_upsert('{"slug":"klub","name_pl":"Duplikat"}'::jsonb) $q$,
  'zalozenie klubu na zajetym adresie odrzucone');
SELECT pg_temp.assert_raises(
  $q$ SELECT public.admin_club_upsert('{"name_pl":"Bez adresu"}'::jsonb) $q$,
  'zalozenie bez adresu odrzucone');

-- Uklad: domyslny, zapisywalny, domkniety slownikiem.
SELECT public.admin_club_upsert(
  '{"slug":"klub-z-ukladem","name_pl":"Klub z ukladem","layout":"magazine"}'::jsonb) AS lay_club \gset
SELECT pg_temp.assert(
  (SELECT layout FROM public.admin_club_get(:'lay_club'::uuid)) = 'magazine',
  'uklad zapisuje sie przy zakladaniu');
SELECT pg_temp.assert(
  (SELECT layout FROM public.club_view('klub')) = 'list',
  'domyslny uklad to lista - strona produktowa wie, jak sie narysowac');
SELECT public.admin_club_upsert(
  format('{"id":"%s","layout":"cards"}', :'lay_club')::jsonb);
SELECT pg_temp.assert(
  (SELECT layout FROM public.admin_club_get(:'lay_club'::uuid)) = 'cards',
  'uklad da sie zmienic patchem');
SELECT pg_temp.assert_raises(
  format($q$ UPDATE public.clubs SET layout = 'karuzela' WHERE id = '%s' $q$, :'lay_club'),
  'uklad spoza slownika odrzucony przez baze');

-- Patch NIE gubi pol, ktorych nie przyslano - to jest cala umowa tej funkcji.
SELECT pg_temp.assert(
  (SELECT name_pl FROM public.admin_club_get(:'lay_club'::uuid)) = 'Klub z ukladem',
  'patch ukladu nie skasowal nazwy');
-- Okladka: pole istnialo od A1 i nikt go nie ustawial. Teraz jedzie patchem
-- i - co wazniejsze - da sie je WYCZYSCIC, bo pusty string znaczy NULL.
SELECT public.admin_club_upsert(
  format('{"id":"%s","cover_image_url":"https://example.test/cover.jpg"}', :'lay_club')::jsonb);
SELECT pg_temp.assert(
  (SELECT cover_image_url FROM public.admin_club_get(:'lay_club'::uuid))
    = 'https://example.test/cover.jpg',
  'okladka zapisuje sie patchem');
SELECT public.admin_club_upsert(
  format('{"id":"%s","cover_image_url":""}', :'lay_club')::jsonb);
SELECT pg_temp.assert(
  (SELECT cover_image_url FROM public.admin_club_get(:'lay_club'::uuid)) IS NULL,
  'pusta okladka znaczy WYCZYSC, nie "nie ruszaj"');

-- Nowy klub dostaje grupe domyslna: bez niej nie ma gdzie zalozyc tematu.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_groups g WHERE g.club_id = :'lay_club'::uuid) = 1,
  'nowy klub ma od razu grupe domyslna');

-- Nie-admin nie zaklada klubu i nie pyta o dostepnosc adresu.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert_raises(
  $q$ SELECT public.admin_club_upsert('{"slug":"z-ulicy","name_pl":"Z ulicy"}'::jsonb) $q$,
  'nie-admin nie zaklada klubu');
SELECT pg_temp.assert(
  NOT public.admin_club_slug_available('cokolwiek', NULL),
  'nie-admin nie dostaje odpowiedzi o dostepnosci adresu');


\echo '== 53. [A15] Strumien aktywnosci ponad klubami =='
-- Hub pokazuje jedna liste z wielu klubow, wiec kazda regula dostepu, ktora
-- w club_threads_list dziala na jeden klub, musi tu dzialac PER WIERSZ.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_feed(30, 'new', NULL)) > 0,
  'strumien zwraca watki bez podania klubu');
-- Watek z klubu secret jest w strumieniu admina...
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_feed(30, 'new', NULL)
    WHERE thread_id = :'secret_thread'::uuid) = 1,
  'admin widzi w strumieniu watek z klubu secret');
-- ...i znika dla obcego. To jest ten sam wyciek, co lista klubow, tylko
-- jedno pietro nizej: tresc zdradzalaby istnienie klubu, ktorego nazwa nie
-- ma prawa wyjsc.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_feed(30, 'new', NULL)
    WHERE thread_id = :'secret_thread'::uuid) = 0,
  'obcy nie widzi w strumieniu watku z klubu secret');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_feed(30, 'new', NULL)
    WHERE club_slug = 'tajny') = 0,
  'nazwa klubu secret nie wychodzi strumieniem');

-- Limit jest przybity po obu stronach: 0 podnosi sie do 1, 999 scina do 30.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_feed(1, 'new', NULL)) = 1,
  'limit jednego wiersza jest respektowany');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_feed(999, 'new', NULL)) <= 30,
  'limit strumienia jest przybity od gory');

-- Dlawik rownowagi. Klub 'klub' ma kilkadziesiat zasianych watkow; bez tej
-- reguly zajmowal cala liste i hub pokazywal jeden klub zamiast wszystkich.
SELECT pg_temp.assert(
  (SELECT max(cnt) FROM (
     SELECT count(*) AS cnt FROM public.club_activity_feed(30, 'new', NULL, 2)
      GROUP BY club_slug) q) <= 2,
  'zaden klub nie zajmuje w strumieniu wiecej miejsc, niz mu wolno');
SELECT pg_temp.assert(
  (SELECT count(DISTINCT club_slug) FROM public.club_activity_feed(30, 'new', NULL, 2)) > 1,
  'strumien pokazuje wiecej niz jeden klub - po to jest dlawik');

-- Filtr obszaru polityki - nawigacja "per tematyka" na stronie glownej.
-- Limit dobowy watkow liczy sie na autora, a admin zdazyl w tym pliku zalozyc
-- ich dziesiec. Cofamy znaczniki czasu poza okno - nie luzujemy limitu, tylko
-- przestajemy testowac go po raz kolejny przy okazji innej rzeczy.
UPDATE public.club_threads SET created_at = created_at - interval '48 hours';
SELECT public.admin_club_upsert(
  '{"slug":"klub-energia","name_pl":"Energia","policy_area":"energy","status":"active"}'::jsonb)
  AS energy_club \gset
SELECT id AS energy_group FROM public.club_groups
 WHERE club_id = :'energy_club'::uuid LIMIT 1 \gset
SELECT id AS energy_thread FROM public.club_create_thread(:'energy_group'::uuid,
  'Ceny energii','Tresc watku o cenach energii, dluzsza niz dziesiec znakow.',
  'discussion') \gset
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_feed(30, 'new', 'energy')
    WHERE thread_id = :'energy_thread'::uuid) = 1,
  'filtr obszaru wpuszcza watek z tego obszaru');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_feed(30, 'new', 'climate')
    WHERE thread_id = :'energy_thread'::uuid) = 0,
  'filtr obszaru odcina watek z innego obszaru');

-- Anonimowosc jest wlasnoscia KLUBU, wiec w strumieniu miesza sie z jawna.
-- Watek z klubu chatham nie moze wyjsc z nazwiskiem, a klub attributed musi.
SELECT public.admin_club_upsert(
  '{"slug":"klub-chatham","name_pl":"Chatham","attribution_mode":"chatham","status":"active"}'::jsonb)
  AS ch_club \gset
SELECT id AS ch_group FROM public.club_groups
 WHERE club_id = :'ch_club'::uuid LIMIT 1 \gset
SELECT id AS ch_thread FROM public.club_create_thread(:'ch_group'::uuid,
  'Watek pod regula Chatham','Tresc watku chatham, dluzsza niz dziesiec znakow.',
  'discussion') \gset
SELECT pg_temp.assert(
  (SELECT author_name FROM public.club_activity_feed(30, 'new', NULL)
    WHERE thread_id = :'ch_thread'::uuid) IS NULL,
  'strumien nie zdradza nazwiska w klubie chatham');
SELECT pg_temp.assert(
  (SELECT author_alias FROM public.club_activity_feed(30, 'new', NULL)
    WHERE thread_id = :'ch_thread'::uuid) IS NOT NULL,
  'w klubie chatham strumien podaje pseudonim');
SELECT pg_temp.assert(
  (SELECT author_name FROM public.club_activity_feed(30, 'new', NULL)
    WHERE thread_id = :'energy_thread'::uuid) IS NOT NULL,
  'w klubie attributed strumien podaje nazwisko - inaczej filtr bylby zawsze-null');

-- Sortowanie "gorace" musi realnie zmieniac kolejnosc, a nie tylko przyjmowac
-- parametr. Podbijamy ranking najstarszego watku i sprawdzamy, ze wyszedl na gore.
BEGIN;
UPDATE public.club_threads SET hotness = 999999 WHERE id = :'energy_thread'::uuid;
SELECT pg_temp.assert(
  (SELECT thread_id FROM public.club_activity_feed(30, 'hot', NULL) LIMIT 1)
    = :'energy_thread'::uuid,
  'sort "gorace" wypycha watek o najwyzszym rankingu na pierwsze miejsce');
ROLLBACK;

-- Watek oczekujacy na moderacje nie nalezy do powierzchni odkrywania NAWET
-- dla admina: hub pokazuje dyskusje, nie prace do wykonania.
BEGIN;
UPDATE public.club_threads SET status = 'pending' WHERE id = :'energy_thread'::uuid;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_feed(30, 'new', NULL)
    WHERE thread_id = :'energy_thread'::uuid) = 0,
  'watek pending nie trafia do strumienia nawet adminowi');
ROLLBACK;

-- Grupa robocza nie wystawia tresci nikomu poza zarzadzajacym.
BEGIN;
UPDATE public.club_groups SET status = 'draft' WHERE id = :'energy_group'::uuid;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_feed(30, 'new', NULL)
    WHERE thread_id = :'energy_thread'::uuid) = 0,
  'watek z grupy roboczej nie wychodzi strumieniem do obcego');
ROLLBACK;

\echo '== 54. [NAPRAWA] emit_domain_event ma DOKLADNIE jedno przeciazenie =='
-- Regresja z A12: obok wariantu (…, jsonb, uuid) stanal wariant
-- (…, jsonb, boolean), oba z domyslnym szostym argumentem. Wszystkie 82
-- wywolania w kodzie podaja PIEC argumentow, wiec kazde stalo sie
-- niejednoznaczne (42725) - a wlasny EXCEPTION emiterow zamienil blad w cisze.
-- Asercja liczy PRZECIAZENIA, nie efekt: efekt byl caly czas "brak zdarzenia",
-- czyli dokladnie to samo, co poprawne odrzucenie.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'emit_domain_event') = 1,
  'emit_domain_event istnieje w dokladnie jednym wariancie');

-- Wywolanie pieciooargumentowe MUSI sie rozstrzygnac. To jest ksztalt, ktorego
-- uzywa kazdy z trzydziestu triggerow fan-outu.
SELECT pg_temp.assert(
  public.emit_domain_event(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'club', gen_random_uuid()::text, 'club.smoke.v1', '{}'::jsonb) IS NOT NULL,
  'wywolanie pieciooargumentowe rozstrzyga sie i zapisuje zdarzenie');

-- Aktor: domyslnie sesja, jawny parametr ma pierwszenstwo, a tlumienie bije
-- jedno i drugie. Trzy sciezki, bo A12 zgubila srodkowa.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.emit_domain_event(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'club', 'aktor-sesja', 'club.smoke.v1', '{}'::jsonb) AS ev_session \gset
SELECT pg_temp.assert(
  (SELECT actor_id FROM public.domain_events WHERE id = :'ev_session'::uuid)
    = 'a0000000-0000-0000-0000-000000000001',
  'bez parametrow aktorem jest sesja');

-- Aktor jawny POZYCYJNIE na szostej pozycji. To jest ksztalt dwudziestu
-- pieciu wywolan w billingu, monetyzacji i odznakach - A16 przestawila ten
-- parametr na siodme miejsce i wszystkie przestaly sie wiazac. Asercja
-- pozycyjna, nie nazwana: nazwana przechodzila przy zlej kolejnosci i to
-- dlatego regresja wyszla dopiero z CI.
SELECT public.emit_domain_event(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'club', 'aktor-jawny', 'club.smoke.v1', '{}'::jsonb,
  'a0000000-0000-0000-0000-000000000005'::uuid) AS ev_explicit \gset
SELECT pg_temp.assert(
  (SELECT actor_id FROM public.domain_events WHERE id = :'ev_explicit'::uuid)
    = 'a0000000-0000-0000-0000-000000000005',
  'jawny aktor bije sesje - parametr z migracji lipcowej NIE zniknal');

SELECT public.emit_domain_event(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'club', 'aktor-ukryty', 'club.smoke.v1', '{}'::jsonb,
  'a0000000-0000-0000-0000-000000000005'::uuid, true) AS ev_hidden \gset
SELECT pg_temp.assert(
  (SELECT actor_id FROM public.domain_events WHERE id = :'ev_hidden'::uuid) IS NULL,
  'tlumienie aktora bije nawet jawny parametr - reguly chatham nie da sie obejsc');

-- Tlumienie aktora WYLACZNIE argumentem nazwanym - tak wolaja teraz szwy
-- z A12. Pozycyjny boolean na szostym miejscu jest od A17 bledem typu i to
-- jest zamierzone: szosta pozycja nalezy do aktora.
SELECT public.emit_domain_event(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'club', 'ksztalt-a12', 'club.smoke.v1', '{}'::jsonb,
  p_suppress_actor => true) AS ev_a12 \gset
SELECT pg_temp.assert(
  (SELECT actor_id FROM public.domain_events WHERE id = :'ev_a12'::uuid) IS NULL,
  'tlumienie argumentem nazwanym wiaze sie i zeruje aktora');

-- KONTRAKT KOLEJNOSCI, spisany wprost. Ta asercja jest odpowiedzia na to, co
-- poszlo zle w A16: sprawdzalem WLASNY nowy ksztalt wywolania zamiast
-- ksztaltow, ktorych uzywa reszta bazy.
SELECT pg_temp.assert(
  pg_get_function_identity_arguments(
    'public.emit_domain_event(uuid,text,text,text,jsonb,uuid,boolean)'::regprocedure)
    LIKE '%p_actor_id uuid%p_suppress_actor boolean%',
  'aktor stoi PRZED tlumieniem - odwrotna kolejnosc rozwiazuje 25 wywolan billingu');

\echo '== 55. [A28] Przestrzen robocza: dokumenty, kalendarz, harmonogram, pomiar =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';

-- Bramka kuratorska. Jedna funkcja obsluguje dwanascie wywolan, wiec jej
-- odmowa jest jedynym miejscem, w ktorym te dwanascie moze sie rozjechac.
SELECT public.club_document_upsert(:'club_id'::uuid, format(
  '{"slug":"raport-zapasy","title_pl":"Raport: zapasy","title_en":"Report: stocks",
    "kind":"analysis","external_url":"https://example.org/a","visibility":"club"}')::jsonb)
  AS doc_public \gset
SELECT public.club_document_upsert(:'club_id'::uuid, format(
  '{"slug":"notatka-robocza","title_pl":"Notatka","title_en":"Note",
    "kind":"minutes","external_url":"https://example.org/b","visibility":"moderators"}')::jsonb)
  AS doc_mod \gset

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_documents WHERE club_id = :'club_id'::uuid) = 2,
  'A28: kurator dodal dwa dokumenty');
SELECT pg_temp.assert(
  (SELECT tenant_id FROM public.club_documents WHERE id = :'doc_public'::uuid)
    = '11111111-1111-1111-1111-111111111111',
  'A28: dokument dziedziczy tenanta z klubu (trigger, nie wejscie)');

-- Dokument prowadzenia jest odsiewany W PROJEKCJI. Gdyby filtr siedzial
-- w kliencie, notatka i tak przyjechalaby po sieci.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_documents_list(:'club_id'::uuid,NULL,NULL,NULL,50,0)) = 2,
  'A28: kurator widzi takze dokument moderatorski');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_documents_list(:'club_id'::uuid,NULL,NULL,NULL,50,0)) = 1,
  'A28: czlonek nie widzi dokumentu o widocznosci "moderators"');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_document_upsert('%s','{"slug":"x","title_pl":"X","title_en":"X","external_url":"https://e.org"}'::jsonb) $q$, :'club_id'),
  'A28: czlonek bez can_moderate nie dodaje dokumentu');

-- UWAGA NA SEMANTYKE `members`: to jest "widoczne dla zalogowanych", a NIE
-- "widoczne dla czlonkow klubu" (club_capabilities: visibility IN
-- ('public','members') => can_read). Nie-czlonek widzi wiec biblioteke
-- publiczna tego klubu - i to jest poprawne. Cisza wobec obcego jest
-- testowana nizej, na klubie `private`.
--
-- Aktor jest zakladany TUTAJ, a nie brany z fixture'a. "Obcy A"
-- (…0004) jest w tym klubie ZBANOWANY od sekcji 38, wiec liczyl nie
-- nie-czlonka, tylko brak `can_read` po banie - i asercja mowila o czym innym,
-- niz jej nazwa. Rozpoznanie kosztowalo tyle, ze warto zostawic slad.
INSERT INTO auth.users (id, email)
VALUES ('a0000000-0000-0000-0000-000000000006','gosc-a@t');
INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('a0000000-0000-0000-0000-000000000006',
        '11111111-1111-1111-1111-111111111111','Gosc A',false);

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000006';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_documents_list(:'club_id'::uuid,NULL,NULL,NULL,50,0)) = 1,
  'A28: nie-czlonek klubu "members" widzi wylacznie dokumenty jawne');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_documents_list(:'club_id'::uuid,NULL,NULL,NULL,50,0)) = 0,
  'A28: zbanowany nie dostaje NAWET biblioteki jawnej');

-- Kalendarz + obecnosc.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.club_event_upsert(:'club_id'::uuid,
  ('{"slug":"posiedzenie-1","title_pl":"Posiedzenie","title_en":"Sitting",
     "kind":"meeting","starts_at":"' || (now() + interval '7 day')::text ||
   '","meeting_url":"https://meet.example/abc","rsvp_enabled":true,"capacity":1}')::jsonb)
  AS ev_meet \gset

SELECT pg_temp.assert(
  (SELECT meeting_url FROM public.club_events_list(:'club_id'::uuid,NULL,NULL,NULL,50)
    WHERE id = :'ev_meet'::uuid) = 'https://meet.example/abc',
  'A28: kurator widzi adres pokoju spotkania');

-- ADRES POKOJU SPOTKANIA to nie jest metadana wydarzenia, tylko klucz do
-- niego. Nie-czlonek widzi, ZE spotkanie jest, i nie dostaje linku - inaczej
-- kazdy zalogowany wchodzi na posiedzenie klubu, do ktorego nie nalezy.
-- "Gosc A" (…0006), nie "Obcy A" (…0004): ten drugi jest w tym klubie
-- zbanowany od sekcji 38, wiec nie ma `can_read` i asercja o widocznosci
-- terminu nie mialaby na czym stanac.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000006';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_events_list(:'club_id'::uuid,NULL,NULL,NULL,50)) = 1,
  'A28: nie-czlonek klubu "members" widzi termin posiedzenia');
SELECT pg_temp.assert(
  (SELECT meeting_url FROM public.club_events_list(:'club_id'::uuid,NULL,NULL,NULL,50)
    WHERE id = :'ev_meet'::uuid) IS NULL,
  'A28: adres pokoju spotkania NIE wychodzi poza uczestnikow');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_event_rsvp('%s','going') $q$, :'ev_meet'),
  'A28: obecnosc wymaga AKTYWNEGO czlonkostwa, nie samego can_read');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT public.club_event_rsvp(:'ev_meet'::uuid, 'going');
SELECT pg_temp.assert(
  (SELECT going_count FROM public.club_events WHERE id = :'ev_meet'::uuid) = 1,
  'A28: trigger policzyl obecnych');
-- Zmiana 'going' -> 'going' nie zajmuje DRUGIEGO miejsca przy limicie 1.
SELECT public.club_event_rsvp(:'ev_meet'::uuid, 'going');
SELECT pg_temp.assert(
  (SELECT going_count FROM public.club_events WHERE id = :'ev_meet'::uuid) = 1,
  'A28: powtorzona deklaracja nie zwieksza licznika');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000005';
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_event_rsvp('%s','going') $q$, :'ev_meet'),
  'A28: limit miejsc zamyka liste obecnych');
-- Zejscie z listy NIGDY nie moze byc zablokowane przez limit.
SELECT public.club_event_rsvp(:'ev_meet'::uuid, 'declined');
SELECT pg_temp.assert(
  (SELECT going_count FROM public.club_events WHERE id = :'ev_meet'::uuid) = 1,
  'A28: odmowa przechodzi mimo pelnej listy i nie rusza licznika obecnych');

-- Harmonogram: kolejnosc nadawana automatycznie, gdy klient jej nie poda.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.club_milestone_upsert(:'club_id'::uuid,
  '{"slug":"konsultacje","title_pl":"Konsultacje","title_en":"Consultations","state":"active"}'::jsonb) AS ms1 \gset
SELECT public.club_milestone_upsert(:'club_id'::uuid,
  '{"slug":"pierwsze-czytanie","title_pl":"Pierwsze czytanie","title_en":"First reading"}'::jsonb) AS ms2 \gset
SELECT pg_temp.assert(
  (SELECT order_index FROM public.club_milestones WHERE id = :'ms2'::uuid) = 1,
  'A28: kolejny etap dostaje nastepna pozycje bez udzialu klienta');

-- Pomiar. Szereg ma KAZDY dzien okna, takze pusty - inaczej wykres ma dziury.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_series(:'club_id'::uuid, 30)) = 30,
  'A28: szereg dzienny wypelnia luki zerami');

SELECT pg_temp.assert(
  (SELECT documents_count FROM public.club_workspace_stats(:'club_id'::uuid, 30)) = 2,
  'A28: przekroj liczy dokumenty widoczne dla wolajacego');
SELECT pg_temp.assert(
  (SELECT upcoming_events FROM public.club_workspace_stats(:'club_id'::uuid, 30)) = 1,
  'A28: przekroj liczy nadchodzace wydarzenia');
SELECT pg_temp.assert(
  (SELECT open_milestones FROM public.club_workspace_stats(:'club_id'::uuid, 30)) = 2,
  'A28: przekroj liczy otwarte etapy');

-- Klub :club_id ma attribution_mode='anonymous_allowed', wiec ranking autorow
-- MUSI byc pusty. To jest ta sama regula, co ukrywanie autora we wpisie:
-- lista dziesieciu nazwisk deanonimizuje rozmowe skuteczniej niz podpis.
SELECT pg_temp.assert(
  (SELECT top_contributors FROM public.club_workspace_stats(:'club_id'::uuid, 30)) = '[]'::jsonb,
  'A28: ranking autorow milczy poza klubem atrybuowanym');

-- Cisza wobec obcego - na klubie, ktory REALNIE jest zamkniety. Pomiar jest
-- wyciekiem tak samo jak tresc: liczba tematow i rozklad rodzajow opisuja
-- klub wystarczajaco dokladnie, by nie oddawac ich osobie bez dostepu.
SELECT public.admin_club_upsert('{"slug":"klub-zamkniety","name_pl":"Klub zamkniety",
  "name_en":"Closed club","visibility":"private","status":"active"}'::jsonb) AS closed_club \gset
SELECT public.club_document_upsert(:'closed_club'::uuid,
  '{"slug":"tajny","title_pl":"Tajny","title_en":"Secret","external_url":"https://e.org/s"}'::jsonb);

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_documents_list(:'closed_club'::uuid,NULL,NULL,NULL,50,0)) = 0,
  'A28: obcy nie widzi biblioteki klubu private');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_workspace_stats(:'closed_club'::uuid, 30)) = 0,
  'A28: obcy nie pozna nawet ksztaltu dynamiki klubu private');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_activity_series(:'closed_club'::uuid, 30)) = 0,
  'A28: szereg dzienny takze milczy wobec obcego');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_milestones_list(:'closed_club'::uuid)) = 0,
  'A28: harmonogram klubu private takze milczy');

-- Izolacja miedzy klubami: id z klubu B podane pod bramka klubu A.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_document_upsert('%s','{"id":"%s","title_pl":"Przejete"}'::jsonb) $q$,
         :'lay_club', :'doc_public'),
  'A28: kurator nie przejmie dokumentu innego klubu, podajac jego id');

-- ===========================================================================
-- A32: KLUB JAKO SIEC LUDZI
--
-- Klub osobny od `:club_id`, bo tamten ma `attribution_mode` =
-- 'anonymous_allowed' i celowo milczy o ludziach - a tu sprawdzamy dokladnie
-- powierzchnie, ktore o ludziach mowia.
-- ===========================================================================
\echo ''
\echo '== A32.1 Autozapis autora do skladu (naprawa "0 czlonkow") =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';

SELECT public.admin_club_upsert('{"slug":"klub-sieci","name_pl":"Klub sieci",
  "name_en":"Network club","visibility":"members","who_can_post":"members",
  "attribution_mode":"attributed","policy_area":"geopolitics","status":"active"}'::jsonb)
  AS net_club \gset

SELECT g.id AS net_group FROM public.club_groups g WHERE g.club_id = :'net_club'::uuid LIMIT 1 \gset

-- Autor NIE jest w skladzie: pisze z uprawnienia platformy, dokladnie jak
-- w klubie referencyjnym, ktory pokazywal "0 czlonkow" przy siedmiu watkach.
SELECT pg_temp.assert(
  (SELECT member_count FROM public.clubs WHERE id = :'net_club'::uuid) = 0,
  'A32: swiezy klub startuje z pustym skladem');

-- Watek idzie INSERT-em, nie przez `club_create_thread`: przedmiotem tej
-- asercji jest TRIGGER autozapisu, a nie sciezka kompozytora. Wpiecie sie
-- w RPC wiazaloby ja z jego sygnatura, ktora zmieniala sie w tym module
-- trzykrotnie - i test padalby na kazdej kolejnej zmianie z powodu, ktorego
-- wcale nie bada.
INSERT INTO public.club_threads (tenant_id, club_id, group_id, author_id, slug, title, body, topic)
VALUES ('11111111-1111-1111-1111-111111111111', :'net_club'::uuid, :'net_group'::uuid,
        'a0000000-0000-0000-0000-000000000001', 'watek-sieciowy',
        'Zdolnosci a deklaracje w regionie',
        'Tresc watku sieciowego, dluzsza niz dziesiec znakow.', 'geopolitics')
RETURNING id AS net_thread \gset

SELECT pg_temp.assert(EXISTS (SELECT 1 FROM public.club_members m
  WHERE m.club_id = :'net_club'::uuid
    AND m.user_id = 'a0000000-0000-0000-0000-000000000001'
    AND m.status = 'active' AND m.invite_source = 'auto'),
  'A32: autor watku trafia do skladu, a zrodlo zapisu zostaje w danych');
SELECT pg_temp.assert(
  (SELECT member_count FROM public.clubs WHERE id = :'net_club'::uuid) = 1,
  'A32: licznik skladu idzie za autozapisem');

\echo '== A32.2 Ogloszenia szukam / oferuje =='
SELECT public.admin_club_member_upsert(:'net_club'::uuid,'a0000000-0000-0000-0000-000000000003','member','active',NULL);
SELECT public.admin_club_member_upsert(:'net_club'::uuid,'a0000000-0000-0000-0000-000000000005','member','active',NULL);

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT public.club_board_notice_create(:'net_club'::uuid,'seeking',
  '  Szukam   kontaktu w  MON  ','geopolitics',14) AS notice_id \gset

SELECT pg_temp.assert(
  (SELECT body FROM public.club_board_notices WHERE id = :'notice_id'::uuid) = 'Szukam kontaktu w MON',
  'A32: ogloszenie zwiniete do jednej linii juz w bazie');
SELECT pg_temp.assert(
  (SELECT is_mine AND can_close FROM public.club_board_notices_list(:'net_club'::uuid,NULL,NULL,8,0)),
  'A32: autor widzi wlasne ogloszenie jako swoje i zamykalne');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_board_notices_list(:'net_club'::uuid,'offering',NULL,8,0)) = 0,
  'A32: zawezenie po rodzaju odsiewa drugi rodzaj');

UPDATE public.club_board_notices SET expires_at = now() - interval '1 day' WHERE id = :'notice_id'::uuid;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_board_notices_list(:'net_club'::uuid,NULL,NULL,8,0)) = 0,
  'A32: wygasle ogloszenie znika przy ODCZYCIE, bez jobu sprzatajacego');
UPDATE public.club_board_notices SET expires_at = now() + interval '10 days' WHERE id = :'notice_id'::uuid;

SELECT pg_temp.assert(public.club_board_notice_close(:'notice_id'::uuid),
  'A32: autor zamyka wlasne ogloszenie');
SELECT pg_temp.assert(
  (SELECT status FROM public.club_board_notices WHERE id = :'notice_id'::uuid) = 'closed',
  'A32: zamkniete przez autora to "zalatwione", nie "zdjete"');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_board_notice_create('%s','seeking','Ogloszenie obcego w klubie',NULL,14) $q$,
         :'net_club'),
  'A32: obcy nie powiesi ogloszenia w klubie members');

\echo '== A32.3 Kompetencje i eksperci watku =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000005';
SELECT pg_temp.assert(
  public.club_expertise_set(:'net_club'::uuid,
    ARRAY['geopolitics',' GEOPOLITICS ','energy','zly-klucz!']) = 2,
  'A32: deklaracja znormalizowana, powtorzenie i smiec odsiane');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_expertise_mine(:'net_club'::uuid)) = 2,
  'A32: wlasne deklaracje sa czytelne dla formularza');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_thread_experts(:'net_thread'::uuid, 6)) = 1,
  'A32: ekspert znaleziony po obszarze watku');
SELECT pg_temp.assert(
  (SELECT NOT in_thread AND NOT pinged_by_me AND topic = 'geopolitics'
     FROM public.club_thread_experts(:'net_thread'::uuid, 6)),
  'A32: ekspert oznaczony jako nieobecny w watku i jeszcze nieproszony');

SELECT pg_temp.assert(
  public.club_thread_expert_ping(:'net_thread'::uuid,'a0000000-0000-0000-0000-000000000005'),
  'A32: pierwsza prosba o zdanie przechodzi');
SELECT pg_temp.assert(
  NOT public.club_thread_expert_ping(:'net_thread'::uuid,'a0000000-0000-0000-0000-000000000005'),
  'A32: powtorzona prosba tej samej osoby jest cicho odrzucona');
SELECT pg_temp.assert(
  (SELECT pinged_by_me FROM public.club_thread_experts(:'net_thread'::uuid, 6)),
  'A32: interfejs wie, ze prosba juz poszla');

\echo '== A32.4 Sklad z sygnalem obecnosci =='
SELECT pg_temp.assert(
  (SELECT members_total FROM public.club_roster_signal(:'net_club'::uuid, 12)) = 3,
  'A32: sklad liczy trzy osoby');
SELECT pg_temp.assert(
  (SELECT active_24h FROM public.club_roster_signal(:'net_club'::uuid, 12)) = 1,
  'A32: aktywny w dobie to autor watku, a nie kazdy zapisany');
SELECT pg_temp.assert(
  (SELECT (faces->0->>'is_active')::boolean FROM public.club_roster_signal(:'net_club'::uuid, 12)),
  'A32: pierwsza twarz to osoba, ktora tu wlasnie byla');
SELECT pg_temp.assert(
  (SELECT (faces->0 ? 'topics') AND NOT (faces->0 ? 'sort')
     FROM public.club_roster_signal(:'net_club'::uuid, 12)),
  'A32: twarz niesie tagi kompetencji i nie wypuszcza klucza sortujacego');

-- A34: iskra wychodzi ze skladu, twarz dostaje podpis.
-- Stanowisko dostaje autor watku, bo to ON stoi na pierwszej pozycji puli
-- (porzadek: kto tu wlasnie byl, potem kto wlasnie doszedl).
UPDATE public.profiles
   SET job_title = 'Dyrektor', current_company = 'MSZ'
 WHERE id = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  pg_get_function_result('public.club_roster_signal(uuid,integer)'::regprocedure)
    NOT LIKE '%people_series%',
  'A34: szereg czasowy znika z sygnatury razem z iskra aktywnosci');
SELECT pg_temp.assert(
  (SELECT (faces->0 ? 'headline') AND (faces->0 ? 'joined_at')
     FROM public.club_roster_signal(:'net_club'::uuid, 12)),
  'A34: twarz niesie stanowisko i date dolaczenia - awatar bez podpisu jest ozdoba');
SELECT pg_temp.assert(
  (SELECT faces->0->>'headline' = 'Dyrektor - MSZ'
     FROM public.club_roster_signal(:'net_club'::uuid, 12)),
  'A34: stanowisko sklejone tak samo, jak w tablicy ogloszen i katalogu ekspertow');
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(faces) = 3
     FROM public.club_roster_signal(:'net_club'::uuid, 24)),
  'A34: pula twarzy jest wieksza niz szesc miejsc w panelu - interfejs ma czym rotowac');

\echo '== A32.5 Poznaj czlonka =='
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_member_spotlight_current(:'net_club'::uuid)) = 1,
  'A32: rotacja oddaje dokladnie jedna osobe');
SELECT pg_temp.assert(
  (SELECT NOT curated FROM public.club_member_spotlight_current(:'net_club'::uuid)),
  'A32: bez przypiecia redakcyjnego dziala rotacja');

INSERT INTO public.club_member_spotlight (tenant_id, club_id, user_id, week_start, blurb_pl, blurb_en)
VALUES ('11111111-1111-1111-1111-111111111111', :'net_club'::uuid,
        'a0000000-0000-0000-0000-000000000005', (date_trunc('week', now()))::date,
        'Trzy zdania o tej osobie.','Three sentences about this person.');
SELECT pg_temp.assert(
  (SELECT curated AND user_id = 'a0000000-0000-0000-0000-000000000005'
     FROM public.club_member_spotlight_current(:'net_club'::uuid)),
  'A32: przypiecie redakcyjne wygrywa z rotacja');

\echo '== A32.6 Kto bedzie na spotkaniu =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.club_event_upsert(:'net_club'::uuid,
  '{"slug":"spotkanie","title_pl":"Spotkanie","title_en":"Meeting",
    "starts_at":"2030-01-01T10:00:00Z","rsvp_enabled":true}'::jsonb) AS net_event \gset

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT public.club_event_rsvp(:'net_event'::uuid,'going');
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000005';
SELECT public.club_event_rsvp(:'net_event'::uuid,'declined');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_event_attendees(:'net_event'::uuid, 12)) = 1,
  'A32: odmowa nie trafia na liste obecnych');
SELECT pg_temp.assert(
  (SELECT is_me AND state = 'going' FROM public.club_event_attendees(:'net_event'::uuid, 12)),
  'A32: wlasne potwierdzenie jest rozpoznane jako wlasne');

\echo '== A34.1 Modul dorobku wycofany w calosci =='
-- Drugi glos w rozmowie - z tego samego powodu, co przy watku wyzej.
INSERT INTO public.club_replies (tenant_id, club_id, thread_id, author_id, body)
VALUES ('11111111-1111-1111-1111-111111111111', :'net_club'::uuid, :'net_thread'::uuid,
        'a0000000-0000-0000-0000-000000000003', 'Glos w dyskusji.');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.club_document_upsert(:'net_club'::uuid, format(
  '{"slug":"brief","title_pl":"Brief","title_en":"Brief","kind":"policy_brief",
    "external_url":"https://e.org/b","thread_id":"%s"}', :'net_thread')::jsonb);
SELECT public.club_document_upsert(:'net_club'::uuid,
  '{"slug":"zrodlo","title_pl":"Zrodlo","title_en":"Source","kind":"analysis",
    "external_url":"https://e.org/s"}'::jsonb);

-- Modul zniknal z produktu, wiec RPC znika z bazy. Asercja pilnuje OBU
-- sygnatur: A32 miala dwa argumenty, A33 dolozyla przesuniecie - zdjecie
-- tylko nowszej zostawiloby dzialajacy, nieodpytywany endpoint z nazwiskami.
SELECT pg_temp.assert(
  to_regprocedure('public.club_output_list(uuid,integer)') IS NULL
    AND to_regprocedure('public.club_output_list(uuid,integer,integer)') IS NULL,
  'A34: RPC dorobku znika razem z modulem - obie sygnatury');

UPDATE public.clubs SET attribution_mode = 'chatham' WHERE id = :'net_club'::uuid;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_thread_experts(:'net_thread'::uuid, 6)) = 0
    OR (SELECT can_see_members FROM public.club_capabilities(:'net_club'::uuid, NULL,
          'a0000000-0000-0000-0000-000000000003')),
  'A32: panel ekspertow milczy tam, gdzie sklad jest ukryty');
UPDATE public.clubs SET attribution_mode = 'attributed' WHERE id = :'net_club'::uuid;

-- ===========================================================================
-- A33: PELNE WIDOKI MODULOW SIECIUJACYCH
--
-- Szyna jest streszczeniem, strona - pelnym zbiorem. Te asercje pilnuja
-- granicy miedzy nimi: to, czego szyna NIE pokazuje (archiwum, paginacja,
-- katalog obszarow, historia przedstawien), ma byc osiagalne ze strony
-- i wylacznie dla tego, kto ma do tego prawo.
-- ===========================================================================
\echo ''
\echo '== A33.1 Ogloszenia: archiwum i zakres "moje" =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';

-- Ogloszenie z A32 zostalo ZAMKNIETE przez autora, wiec domyslna lista milczy.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_board_notices_list(:'net_club'::uuid,NULL,NULL,50,0,false,false)) = 0,
  'A33: domyslna lista nadal pokazuje wylacznie otwarte');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_board_notices_list(:'net_club'::uuid,NULL,NULL,50,0,false,true)) = 1,
  'A33: archiwum pokazuje zamkniete ogloszenie');
SELECT pg_temp.assert(
  (SELECT status = 'closed' AND NOT is_expired AND is_mine
     FROM public.club_board_notices_list(:'net_club'::uuid,NULL,NULL,50,0,true,true)),
  'A33: archiwum odroznia "zalatwione" od "wygaslo" i wie, ze to moje');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000005';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_board_notices_list(:'net_club'::uuid,NULL,NULL,50,0,true,true)) = 0,
  'A33: zakres "moje" nie pokazuje cudzych ogloszen');

\echo '== A33.3 Katalog ekspertow klubu =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_experts_list(:'net_club'::uuid, NULL, NULL, 24, 0)) = 1,
  'A33: katalog oddaje osobe z deklaracja');
SELECT pg_temp.assert(
  (SELECT cardinality(topics) = 2 AND thread_count = 0 AND reply_count = 0
     FROM public.club_experts_list(:'net_club'::uuid, NULL, NULL, 24, 0)),
  'A33: katalog niesie deklaracje ORAZ dorobek w klubie');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_experts_list(:'net_club'::uuid, 'energy', NULL, 24, 0)) = 1,
  'A33: zawezenie po obszarze nie gubi pozostalych deklaracji tej osoby');
SELECT pg_temp.assert(
  (SELECT cardinality(topics) FROM public.club_experts_list(:'net_club'::uuid, 'energy', NULL, 24, 0)) = 2,
  'A33: po zawezeniu wychodzi CALY zbior deklaracji, nie jedna pasujaca');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_experts_list(:'net_club'::uuid, 'transport', NULL, 24, 0)) = 0,
  'A33: obszar bez deklaracji daje pusty katalog');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_expertise_areas(:'net_club'::uuid)) = 2,
  'A33: chipy filtra znaja dwa obszary');
SELECT pg_temp.assert(
  (SELECT people FROM public.club_expertise_areas(:'net_club'::uuid) LIMIT 1) = 1,
  'A33: chip niesie licznik osob, nie deklaracji');

\echo '== A33.4 Poznaj czlonka: archiwum i redakcja =='
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_member_spotlight_history(:'net_club'::uuid, 12)) = 1,
  'A33: archiwum widzi przypiecie redakcyjne z A32');
SELECT pg_temp.assert(
  (SELECT is_current AND NOT can_manage
     FROM public.club_member_spotlight_history(:'net_club'::uuid, 12)),
  'A33: biezacy tydzien oznaczony, a czlonek nie dostaje narzedzi redakcji');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_member_spotlight_upsert('%s','a0000000-0000-0000-0000-000000000003',NULL,'Opis','Blurb') $q$,
         :'net_club'),
  'A33: obcy nie przypnie czlonka tygodnia');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
-- Sroda podana przez redakcje ma sie znormalizowac do poniedzialku tego
-- tygodnia, a nie zostac odrzucona bledem CHECK-a.
SELECT public.club_member_spotlight_upsert(:'net_club'::uuid,
  'a0000000-0000-0000-0000-000000000003',
  (date_trunc('week', now()) + interval '2 days')::date,
  'Trzy zdania o kims innym.','Three sentences about someone else.') AS spot_id \gset

SELECT pg_temp.assert(
  (SELECT week_start = (date_trunc('week', now()))::date
     FROM public.club_member_spotlight WHERE id = :'spot_id'::uuid),
  'A33: sroda znormalizowana do poniedzialku');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_member_spotlight WHERE club_id = :'net_club'::uuid) = 1,
  'A33: przypiecie na ten sam tydzien PODMIENIA, a nie dokłada drugiego');
SELECT pg_temp.assert(
  (SELECT user_id FROM public.club_member_spotlight_current(:'net_club'::uuid))
    = 'a0000000-0000-0000-0000-000000000003',
  'A33: modul czyta nowe przypiecie natychmiast');

SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_member_spotlight_upsert('%s','a0000000-0000-0000-0000-000000000004',NULL,NULL,NULL) $q$,
         :'net_club'),
  'A33: nie da sie przypiac kogos spoza skladu');

SELECT pg_temp.assert(public.club_member_spotlight_delete(:'spot_id'::uuid),
  'A33: moderacja zdejmuje przypiecie');
SELECT pg_temp.assert(
  (SELECT NOT curated FROM public.club_member_spotlight_current(:'net_club'::uuid)),
  'A33: po zdjeciu przypiecia modul wraca na rotacje, a nie gasnie');

\echo '== A33.5 Pojedyncze spotkanie po slugu =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_event_view(:'net_club'::uuid, 'spotkanie')) = 1,
  'A33: spotkanie osiagalne po slugu, bez pobierania calego kalendarza');
SELECT pg_temp.assert(
  (SELECT my_rsvp = 'going' AND going_count >= 1
     FROM public.club_event_view(:'net_club'::uuid, 'spotkanie')),
  'A33: widok pojedynczego spotkania zna MOJE potwierdzenie');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_event_view(:'net_club'::uuid, 'nie-ma-takiego')) = 0,
  'A33: nieistniejacy slug to zero wierszy, nie wyjatek');

-- Klub `members` jest CZYTELNY dla kazdego zalogowanego - to jest sens tej
-- widocznosci i nie ma tu czego ukrywac. Ukryte sa dwie rzeczy WEWNATRZ
-- wydarzenia: adres pokoju wideo (wyciekly poza klub jest zaproszeniem dla
-- kazdego, kto go dostanie dalej) i lista nazwisk uczestnikow.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
UPDATE public.club_events SET meeting_url = 'https://meet.example.org/klub'
 WHERE club_id = :'net_club'::uuid AND slug = 'spotkanie';

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT meeting_url IS NOT NULL FROM public.club_event_view(:'net_club'::uuid, 'spotkanie')),
  'A33: uczestnik dostaje adres pokoju');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_event_view(:'net_club'::uuid, 'spotkanie')) = 1,
  'A33: obcy widzi, ze spotkanie istnieje - klub members jest czytelny');
SELECT pg_temp.assert(
  (SELECT meeting_url IS NULL FROM public.club_event_view(:'net_club'::uuid, 'spotkanie')),
  'A33: obcy NIE dostaje adresu pokoju wideo');

-- Klub NIECZYTELNY milczy o wszystkim: `can_see_members` to w tym module
-- dokladnie `can_read` (patrz club_capabilities), wiec granica przebiega na
-- widocznosci klubu, a nie na czlonkostwie.
UPDATE public.clubs SET visibility = 'private' WHERE id = :'net_club'::uuid;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_event_view(:'net_club'::uuid, 'spotkanie')) = 0,
  'A33: klub private milczy o spotkaniu wobec obcego');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_experts_list(:'net_club'::uuid, NULL, NULL, 24, 0)) = 0,
  'A33: katalog ekspertow klubu private takze milczy');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_member_spotlight_history(:'net_club'::uuid, 12)) = 0,
  'A33: archiwum przedstawien klubu private takze milczy');
UPDATE public.clubs SET visibility = 'members' WHERE id = :'net_club'::uuid;

\echo '== A33.6 Obecnosc respektuje widocznosc profilu =='
-- Ten sam czlowiek nie moze byc NIEWIDOCZNY na liscie skladu i WYPISANY
-- Z NAZWISKA na liscie uczestnikow - patrz naglowek sekcji 4a migracji A33.
SELECT id AS net_event FROM public.club_events
 WHERE club_id = :'net_club'::uuid AND slug = 'spotkanie' \gset

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_event_attendees(:'net_event'::uuid, 12)) = 1,
  'A33: profil widoczny w katalogu jest wypisany na liscie obecnych');

UPDATE public.profiles SET discoverable = false
 WHERE id = 'a0000000-0000-0000-0000-000000000005';
INSERT INTO public.club_event_rsvps (event_id, user_id, tenant_id, state)
VALUES (:'net_event'::uuid, 'a0000000-0000-0000-0000-000000000005',
        '11111111-1111-1111-1111-111111111111', 'going')
ON CONFLICT (event_id, user_id) DO UPDATE SET state = 'going';

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_event_attendees(:'net_event'::uuid, 12)) = 1,
  'A33: osoba ukryta w katalogu NIE trafia na liste nazwisk');
SELECT pg_temp.assert(
  (SELECT going_count FROM public.club_event_view(:'net_club'::uuid, 'spotkanie')) = 2,
  'A33: licznik obecnosci zostaje pelny - liczba nikogo nie zdradza');
UPDATE public.profiles SET discoverable = true
 WHERE id = 'a0000000-0000-0000-0000-000000000005';

\echo '== A33.7 Widocznosc profilu obowiazuje na KAZDEJ powierzchni o ludziach =='
-- Deklaracja kompetencji nie jest zgoda na bycie wymienionym z nazwiska.
-- Czlonek wypisany z katalogu ma zniknac ze WSZYSTKICH czterech powierzchni,
-- nie z trzech - inaczej wystarczy otworzyc czwarta, zeby obejsc jego decyzje.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_thread_experts(:'net_thread'::uuid, 6)) = 1,
  'A33: ekspert widoczny w katalogu jest w panelu watku');

UPDATE public.profiles SET discoverable = false
 WHERE id = 'a0000000-0000-0000-0000-000000000005';

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_thread_experts(:'net_thread'::uuid, 6)) = 0,
  'A33: panel ekspertow watku respektuje wypisanie z katalogu');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_experts_list(:'net_club'::uuid, NULL, NULL, 24, 0)) = 0,
  'A33: katalog ekspertow tak samo');

-- Przypiecie redakcyjne nie moze byc OBEJSCIEM tej decyzji.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_member_spotlight_upsert('%s','a0000000-0000-0000-0000-000000000005',NULL,NULL,NULL) $q$,
         :'net_club'),
  'A33: nie da sie przypiac osoby wypisanej z katalogu');

INSERT INTO public.club_member_spotlight (tenant_id, club_id, user_id, week_start, blurb_pl, blurb_en)
VALUES ('11111111-1111-1111-1111-111111111111', :'net_club'::uuid,
        'a0000000-0000-0000-0000-000000000005', (date_trunc('week', now()))::date,
        'Wpis sprzed wypisania.','Entry from before the opt-out')
ON CONFLICT (club_id, week_start) DO UPDATE
  SET user_id = EXCLUDED.user_id, blurb_pl = EXCLUDED.blurb_pl;

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_member_spotlight_current(:'net_club'::uuid)
    WHERE curated) = 0,
  'A33: przypiecie sprzed wypisania przestaje byc pokazywane');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_member_spotlight_history(:'net_club'::uuid, 12)) = 0,
  'A33: wypisanie z katalogu dziala WSTECZ takze na archiwum');

DELETE FROM public.club_member_spotlight WHERE club_id = :'net_club'::uuid;
UPDATE public.profiles SET discoverable = true
 WHERE id = 'a0000000-0000-0000-0000-000000000005';

\echo '== A33.8 Anonim: tresc tak, nazwiska nie =='
-- Cala plaszczyzna TRESCI modulu jest otwarta dla `anon`. Dwie nowe funkcje
-- czytajace musza sie w to wpisac, ale nazwiska zostaja za logowaniem.
UPDATE public.clubs SET visibility = 'public' WHERE id = :'net_club'::uuid;
SELECT set_config('request.jwt.claim.sub', '', false);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_event_view(:'net_club'::uuid, 'spotkanie')) = 1,
  'A33: anonim widzi spotkanie klubu publicznego');
SELECT pg_temp.assert(
  (SELECT meeting_url IS NULL FROM public.club_event_view(:'net_club'::uuid, 'spotkanie')),
  'A33: anonim NIE dostaje adresu pokoju wideo');
-- A34: skladu anonim nie dostaje NAWET w klubie publicznym. `can_see_members`
-- to w bazie dokladnie `can_read`, wiec bramka nie moze stac na nim samym -
-- stoi na braku GRANT-u dla `anon` i to jest tutaj przedmiotem asercji.
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.club_roster_signal(uuid,integer)', 'EXECUTE'),
  'A34: anonim nie wywola skladu z twarzami w zadnym klubie');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
UPDATE public.clubs SET visibility = 'members' WHERE id = :'net_club'::uuid;

-- ===========================================================================
-- A35: ZGLOSZENIA DO KLUBOW - CALA SCIEZKA, NIE TYLKO WALIDACJA
--
-- Audyt 2026-08-11 (rozdz. 1.1 i 8.1): `club_apply_submit` nie dzialalo w
-- ZADNYM przypadku - `source_type = 'club_application'` lamalo CHECK na
-- `crm_leads`, a oba zapisy siedza w jednej transakcji, wiec wyjatek z drugiego
-- wycofywal pierwszy. Testy jednostkowe pokrywaly czysta walidacje i kopie SEO;
-- ani jedna linia sciezki serwerowej nie byla wykonywana nigdzie.
--
-- Dlatego asercje ponizej patrza na SKUTEK w obu tabelach, nie na kod wyjscia
-- funkcji. Ograniczenie `crm_leads_source_type_check` harness stawia
-- w brzmieniu SPRZED modulu klubow, wiec te asercje przechodza WYLACZNIE
-- dlatego, ze sekcja A1 migracji A35 je rozszerzyla.
-- ===========================================================================
\echo ''
\echo '== A35.0 Plan czlonkowski: ranga daje sie w harnessie USTAWIC =='
-- Prog `pro_required` to ranga 20, a domyslna ranga w harnessie jest zerowa.
-- Bez planu w bazie kazda asercja ponizej konczylaby sie na pierwszej bramce -
-- i wygladalaby jak poprawna odmowa.
INSERT INTO public.membership_tiers (tenant_id, key, rank, name_pl, name_en, is_default) VALUES
  ('11111111-1111-1111-1111-111111111111','free',0,'Bezpłatny','Free',true),
  ('11111111-1111-1111-1111-111111111111','pro',20,'Pro','Pro',false),
  ('11111111-1111-1111-1111-111111111111','vip',25,'VIP','VIP',false);

-- `current_membership_tier()` liczy plan w tenancie PUBLICZNYM, wiec asercja
-- pilnuje, ze to nadal tenant fixture'a. Gdyby harness kiedys zaczal stawiac
-- wlasny tenant obok, granty ponizej trafialyby w pustke, a cala sekcja
-- milczaco testowalaby odmowe.
SELECT pg_temp.assert(
  public.public_tenant_id() = '11111111-1111-1111-1111-111111111111',
  'A35: tenant publiczny to tenant fixture''a');

INSERT INTO public.membership_grants (tenant_id, user_id, tier_key)
VALUES ('11111111-1111-1111-1111-111111111111',
        'a0000000-0000-0000-0000-000000000004','pro');

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert(
  (SELECT rank FROM public.current_membership_tier()) = 20,
  'A35: grant planu podnosi rangę wolajacego do 20');

\echo '== A35.1 [1.1] Zgloszenie zapisuje sie w OBU tabelach =='
SELECT public.club_apply_submit($j${
  "specialization_slug": "defence-geopolitics",
  "first_name": "Obcy", "last_name": "Kandydat",
  "email": "Kandydat@Example.ORG",
  "phone": "+48 500 100 200",
  "company": "Analizy Sp. z o.o.", "job_position": "Analityk",
  "seniority": "senior", "industry": "defence",
  "country": "Polska", "city": "Warszawa",
  "linkedin_url": "https://linkedin.com/in/kandydat",
  "years_experience": "12",
  "expertise": "Budzety obronne", "languages": "pl, en",
  "motivation": "Chce rozmawiac o architekturze bezpieczenstwa Europy z praktykami.",
  "goals": "Wymiana doswiadczen", "contribution": "Analizy budzetowe",
  "availability": "wieczory", "referral_source": "newsletter",
  "consent": true, "marketing_consent": true, "lang": "pl"
}$j$::jsonb) AS app_id \gset

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_applications
    WHERE id = :'app_id'::uuid
      AND user_id = 'a0000000-0000-0000-0000-000000000004'
      AND tenant_id = '11111111-1111-1111-1111-111111111111'
      AND specialization_slug = 'defence-geopolitics'
      AND status = 'pending'
      AND years_experience = 12
      AND tier_rank = 20 AND tier_key = 'pro') = 1,
  'A35: wiersz zgloszenia powstal z ranga i planem wolajacego');

-- E-mail wchodzi z wielkimi literami CELOWO: `email_norm` jest kluczem
-- deduplikacji leada, wiec asercja sprawdza takze, ze zostal znormalizowany.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.crm_leads
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
      AND email_norm = 'kandydat@example.org'
      AND source_type = 'club_application') = 1,
  'A35: lead CRM powstal ze zrodlem club_application');

-- Krok 1 wejscia do CRM (`crm_upsert_from_form`) daje pola, ktore poprzedni
-- surowy INSERT gubil, a krok 2 - zrodlo, zgode i licznik zgloszen. Asercja
-- patrzy na OBA, bo pominiecie drugiego kroku nie zmienia liczby wierszy.
SELECT pg_temp.assert(
  (SELECT country = 'Polska' AND linkedin_url = 'https://linkedin.com/in/kandydat'
          AND company_id IS NOT NULL
          AND marketing_consent
          AND club_application_count = 1
          AND club_specializations = ARRAY['defence-geopolitics']
          AND club_applied_at IS NOT NULL
     FROM public.crm_leads
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
      AND email_norm = 'kandydat@example.org'),
  'A35: lead ma kraj, LinkedIn, firme, zgode i slad zgloszenia');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.crm_companies
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
      AND name_norm = 'analizy sp. z o.o.') = 1,
  'A35: firma kandydata weszla do katalogu CRM przez kanoniczna funkcje');

-- Ograniczenie MUSI byc zywe. Bez tej asercji poprzednie przechodzilyby takze
-- na bazie, na ktorej ktos skasowal CHECK - a wtedy nie testowalyby niczego.
SELECT pg_temp.assert(
  (SELECT pg_get_constraintdef(oid) LIKE '%''club_application''%'
     FROM pg_constraint WHERE conname = 'crm_leads_source_type_check'),
  'A35: crm_leads_source_type_check istnieje i dopuszcza club_application');
SELECT pg_temp.assert_raises(
  $q$ UPDATE public.crm_leads SET source_type = 'klub'
       WHERE email_norm = 'kandydat@example.org' $q$,
  'A35: ograniczenie nadal odrzuca wartosc spoza zbioru');

\echo '== A35.2 [8.2] Drugie otwarte zgloszenie tej samej specjalizacji odpada =='
-- Zgloszenie jest IDENTYCZNE - to jest ten przypadek, ktory przed A2 po prostu
-- sie udawal, bo kandydat bez widoku wlasnego zgloszenia nie mial innego
-- sposobu zareagowania na cisze.
SELECT pg_temp.assert_raises(
  $q$ SELECT public.club_apply_submit($j${
    "specialization_slug": "defence-geopolitics",
    "first_name": "Obcy", "last_name": "Kandydat",
    "email": "kandydat@example.org",
    "motivation": "Chce rozmawiac o architekturze bezpieczenstwa Europy z praktykami.",
    "consent": true
  }$j$::jsonb) $q$,
  'A35: duplicate_open - drugie otwarte zgloszenie tej samej specjalizacji');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_applications
    WHERE user_id = 'a0000000-0000-0000-0000-000000000004'
      AND specialization_slug = 'defence-geopolitics') = 1,
  'A35: odrzucony duplikat nie zostawil wiersza');

-- Po decyzji komisji ta sama specjalizacja jest dozwolona ponownie - warunek
-- indeksu obejmuje wylacznie statusy otwarte.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.admin_club_application_set_status(:'app_id'::uuid, 'rejected', 'Za maly dorobek.');
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT public.club_apply_submit($j${
  "specialization_slug": "defence-geopolitics",
  "first_name": "Obcy", "last_name": "Kandydat",
  "email": "kandydat@example.org",
  "motivation": "Wracam z nowym dorobkiem i chce dokonczyc te rozmowe.",
  "consent": true
}$j$::jsonb) AS app_id2 \gset
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_applications
    WHERE user_id = 'a0000000-0000-0000-0000-000000000004'
      AND specialization_slug = 'defence-geopolitics') = 2,
  'A35: po decyzji komisji ponowne zgloszenie przechodzi');

-- Drugie zgloszenie NIE zaklada drugiego leada - dedup idzie po email_norm.
SELECT pg_temp.assert(
  (SELECT club_application_count = 2 FROM public.crm_leads
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
      AND email_norm = 'kandydat@example.org'),
  'A35: powracajacy kandydat podbija licznik, nie zaklada drugiego leada');

\echo '== A35.3 Bramki: plan globalny, prog klubu, walidacja lat =='
-- Ranga zerowa: `pro_required` PRZED czymkolwiek innym.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert_raises(
  $q$ SELECT public.club_apply_submit($j${
    "specialization_slug": "finance-economy", "email": "czlonek@example.org",
    "motivation": "Interesuje mnie polityka fiskalna i konkurencyjnosc.",
    "consent": true
  }$j$::jsonb) $q$,
  'A35: pro_required - ranga ponizej progu nie sklada zgloszenia');

-- Prog WLASNY klubu. Kandydat ma rangę 20, klub wymaga 25, wiec
-- `club_capabilities` zwraca tier_too_low - i to ma zatrzymac zgloszenie,
-- a nie dopiero pierwsze wejscie do klubu po przyjeciu.
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
SELECT public.admin_club_upsert('{"slug":"elitarny","name_pl":"Elitarny","name_en":"Elite",
  "visibility":"members","status":"active"}'::jsonb) AS elite_id \gset
UPDATE public.clubs SET min_tier_rank = 25 WHERE id = :'elite_id'::uuid;

SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
SELECT pg_temp.assert(
  (SELECT reason FROM public.club_capabilities(:'elite_id'::uuid, NULL,
     'a0000000-0000-0000-0000-000000000004')) = 'tier_too_low',
  'A35: klub ponad planem daje tier_too_low w club_capabilities');
SELECT pg_temp.assert_raises(
  format($q$ SELECT public.club_apply_submit(jsonb_build_object(
    'specialization_slug','finance-economy', 'club_id','%s',
    'email','kandydat@example.org',
    'motivation','Chcialbym wejsc do klubu, do ktorego moj plan nie siega.',
    'consent', true)) $q$, :'elite_id'),
  'A35: club_tier_too_low - zgloszenie do klubu ponad planem');

-- `years_experience` przed A35 bylo rzutowane surowym `::integer`, wiec tekst
-- dawal 22P02, ktorego klient nie umie zmapowac. Teraz odpada na regexie.
SELECT pg_temp.assert_raises(
  $q$ SELECT public.club_apply_submit($j${
    "specialization_slug": "finance-economy", "email": "kandydat@example.org",
    "motivation": "Motywacja wystarczajaco dluga, by przejsc bramke dlugosci.",
    "consent": true, "years_experience": "dwadziescia"
  }$j$::jsonb) $q$,
  'A35: years_invalid - lata podane slowem');
SELECT pg_temp.assert_raises(
  $q$ SELECT public.club_apply_submit($j${
    "specialization_slug": "finance-economy", "email": "kandydat@example.org",
    "motivation": "Motywacja wystarczajaco dluga, by przejsc bramke dlugosci.",
    "consent": true, "years_experience": "99"
  }$j$::jsonb) $q$,
  'A35: years_invalid - lata powyzej gornego progu');

\echo '== A35.4 [2.2 / 6.1] Kandydat widzi swoje zgloszenie, komisja nie wychodzi =='
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_my_applications()) = 2,
  'A35: club_my_applications oddaje oba zgloszenia wolajacego');
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.routines r
      JOIN information_schema.parameters pa ON pa.specific_name = r.specific_name
     WHERE r.routine_schema = 'public' AND r.routine_name = 'club_my_applications'
       AND pa.parameter_name = 'admin_note'),
  'A35: club_my_applications nie ma kolumny admin_note');
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(public.club_export_my_data(2000) -> 'club_applications')) = 2,
  'A35: zgloszenia wchodza do eksportu RODO');
SELECT pg_temp.assert(
  NOT ((public.club_export_my_data(2000) -> 'club_applications' -> 0) ? 'admin_note'),
  'A35: eksport RODO nie niesie notatki komisji');

\echo '== A35.5 [2.1 / 3.2] accepted ma konsekwencje i jest idempotentne =='
SET request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
-- Zgloszenie ze WSKAZANYM klubem, zeby decyzja miala gdzie utworzyc czlonkostwo.
UPDATE public.club_applications SET club_id = :'net_club'::uuid WHERE id = :'app_id2'::uuid;
-- Profil kandydata z JEDNYM polem wypelnionym: back-fill ma dopisac puste
-- i NIE ruszyc tego, co juz jest.
UPDATE public.profiles SET job_title = 'Wlasny wpis', first_name = NULL, last_name = NULL
 WHERE id = 'a0000000-0000-0000-0000-000000000004';
UPDATE public.club_applications
   SET first_name = 'Obcy', last_name = 'Kandydat', job_position = 'Analityk',
       company = 'Analizy Sp. z o.o.', country = 'Polska'
 WHERE id = :'app_id2'::uuid;

SELECT public.admin_club_application_set_status(:'app_id2'::uuid, 'accepted', NULL);
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_members
    WHERE club_id = :'net_club'::uuid
      AND user_id = 'a0000000-0000-0000-0000-000000000004'
      AND status = 'active' AND role = 'member' AND invite_source = 'auto') = 1,
  'A35: accepted zaklada czlonkostwo ze zrodlem auto');
SELECT pg_temp.assert(
  (SELECT first_name = 'Obcy' AND current_company = 'Analizy Sp. z o.o.'
          AND job_title = 'Wlasny wpis'
     FROM public.profiles WHERE id = 'a0000000-0000-0000-0000-000000000004'),
  'A35: back-fill dopisuje puste pola i nie nadpisuje wypelnionych');

-- Powtorka decyzji: bez drugiego czlonkostwa i bez drugiego powiadomienia.
SELECT count(*) AS notif_before FROM public.notifications
 WHERE user_id = 'a0000000-0000-0000-0000-000000000004' \gset
SELECT public.admin_club_application_set_status(:'app_id2'::uuid, 'accepted', NULL);
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_members
    WHERE club_id = :'net_club'::uuid
      AND user_id = 'a0000000-0000-0000-0000-000000000004') = 1,
  'A35: powtorne accepted nie duplikuje czlonkostwa');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.notifications
    WHERE user_id = 'a0000000-0000-0000-0000-000000000004') = :'notif_before'::bigint,
  'A35: powtorne accepted nie wysyla drugiego powiadomienia');

-- Ban zostaje banem. To powtorka bledu naprawionego w A19 - dlatego asercja
-- jest tutaj, a nie w opisie migracji.
UPDATE public.club_members SET status = 'banned'
 WHERE club_id = :'net_club'::uuid AND user_id = 'a0000000-0000-0000-0000-000000000004';
SELECT public.admin_club_application_set_status(:'app_id2'::uuid, 'pending', NULL);
SELECT public.admin_club_application_set_status(:'app_id2'::uuid, 'accepted', NULL);
SELECT pg_temp.assert(
  (SELECT status FROM public.club_members
    WHERE club_id = :'net_club'::uuid
      AND user_id = 'a0000000-0000-0000-0000-000000000004') = 'banned',
  'A35: accepted NIE zdejmuje bana');

\echo '== A35.6 [7.1] Skrzynka admina oddaje nazwe klubu w obu jezykach =='
SELECT pg_temp.assert(
  to_regprocedure('public.admin_club_applications_list(text,uuid,text,text,integer)') IS NOT NULL,
  'A35: skrzynka zgloszen ma dokladnie jedna sygnature');
SELECT pg_temp.assert(
  (SELECT count(*) FROM information_schema.parameters
    WHERE specific_schema = 'public'
      AND specific_name IN (
        SELECT specific_name FROM information_schema.routines
         WHERE routine_schema = 'public' AND routine_name = 'admin_club_applications_list')
      AND parameter_name IN ('club_name_pl','club_name_en')) = 2
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.parameters
       WHERE specific_schema = 'public'
         AND specific_name IN (
           SELECT specific_name FROM information_schema.routines
            WHERE routine_schema = 'public' AND routine_name = 'admin_club_applications_list')
         AND parameter_name = 'club_name'),
  'A35: club_name zastapione przez club_name_pl i club_name_en');
SELECT pg_temp.assert(
  (SELECT club_name_pl IS NOT NULL AND club_name_en IS NOT NULL
     FROM public.admin_club_applications_list(NULL, :'net_club'::uuid, NULL, NULL, 50)),
  'A35: skrzynka oddaje obie nazwy dla zgloszenia z klubem');

\echo '== A35.7 [6.2] Anonimizacja zostawia wiersz statystyczny =='
SELECT pg_temp.assert(
  public.anonymize_club_applications_for_user('a0000000-0000-0000-0000-000000000004') = 2,
  'A35: anonimizacja zwraca liczbe wierszy');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_applications
    WHERE user_id = 'a0000000-0000-0000-0000-000000000004'
      AND first_name = '' AND last_name = '' AND email = ''
      AND phone = '' AND linkedin_url = '' AND city = ''
      AND motivation = '' AND goals = '' AND contribution = ''
      AND expertise = '' AND admin_note = '') = 2,
  'A35: dane osobowe i notatka komisji wyczyszczone');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.club_applications
    WHERE user_id = 'a0000000-0000-0000-0000-000000000004'
      AND specialization_slug = 'defence-geopolitics'
      AND tier_rank = 20) = 2,
  'A35: wymiary zbiorcze zostaja - specjalizacja, plan, status');
SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated',
    'public.anonymize_club_applications_for_user(uuid)', 'EXECUTE'),
  'A35: anonimizacji nie wywola zalogowany uzytkownik');

\echo ''
\echo '=========================================='
\echo ' WSZYSTKIE ASERCJE PRZESZLY'
\echo '=========================================='
