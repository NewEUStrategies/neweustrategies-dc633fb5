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
-- przywrocenie na potrzeby dalszych testow
SELECT public.admin_club_member_upsert(:'club_id'::uuid,'a0000000-0000-0000-0000-000000000005','lead','active',NULL);

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

\echo ''
\echo '=========================================='
\echo ' WSZYSTKIE ASERCJE PRZESZLY'
\echo '=========================================='
