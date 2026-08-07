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

\echo ''
\echo '=========================================='
\echo ' WSZYSTKIE ASERCJE PRZESZLY'
\echo '=========================================='
