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

-- ---------------------------------------------------------------------------
-- Fixture: dwa tenanty, pieciu aktorow
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111','Tenant A','ta'),
  ('22222222-2222-2222-2222-222222222222','Tenant B','tb');

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

SELECT public.club_reply(:'thread_id'::uuid,'Poziom 0',NULL,false) AS r0 \gset
SELECT public.club_reply(:'thread_id'::uuid,'Poziom 1',:'r0'::uuid,false) AS r1 \gset
SELECT public.club_reply(:'thread_id'::uuid,'Poziom 2',:'r1'::uuid,false) AS r2 \gset
SELECT public.club_reply(:'thread_id'::uuid,'Probowal 3',:'r2'::uuid,false) AS r3 \gset

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
  pg_get_functiondef('public.club_create_thread(uuid,text,text,text,boolean,text,text)'::regprocedure)
    LIKE '%pg_advisory_xact_lock%',
  'club_create_thread bierze blokade przed liczeniem limitu');
SELECT pg_temp.assert(
  pg_get_functiondef('public.club_invite_by_email(uuid,text,text,uuid)'::regprocedure)
    LIKE '%club_invite:%',
  'club_invite_by_email bierze TEN SAM klucz blokady co club_invite');
SELECT pg_temp.assert(
  pg_get_functiondef('public.club_invite(uuid,uuid,text,text,uuid)'::regprocedure)
    LIKE '%club_invite:%',
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

\echo ''
\echo '=========================================='
\echo ' WSZYSTKIE ASERCJE PRZESZLY'
\echo '=========================================='
