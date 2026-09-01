-- pgTAP: STAN KONCOWY polityk RLS modulu 12 (powiadomienia / web push / zgody).
--
-- PO CO TEN PLIK. Modul 12 to piec powierzchni danych o piecu ROZNYCH modelach
-- dostepu: powiadomienie jest per (uzytkownik, tenant), preferencja per
-- (uzytkownik, tenant), subskrypcja push per URZADZENIE uzytkownika, zgoda RODO
-- per OSOBA, a kolejka doreczen jest wylacznie serwerowa. Kazda z nich ma inny
-- poprawny predykat, wiec zaden pojedynczy inwariant maszynowy ich nie pokryje.
-- Ten plik przybija je jednoczesnie: KSZTALT z pg_catalog (pg_policies,
-- pg_class.relrowsecurity, information_schema.role_table_grants) ORAZ SKUTEK
-- realnymi INSERT/UPDATE/SELECT w sesji z ustawionym `request.jwt.claims`.
-- Sam ksztalt przechodzi na literowce w nazwie polityki; sam skutek nie lapie
-- regresji „ktos dopisal druga polityke obok".
--
-- CZEGO NIE LAPIE BRAMKA `bun run check:sql-owner-tenant-scope`. Tamta bramka
-- jest RELACYJNA i samokalibrujaca sie: zapala sie dopiero wtedy, gdy NA TEJ
-- SAMEJ TABELI chocby jedna klauzula wlascicielska wiaze tenanta - taki
-- „swiadek" dowodzi, ze schemat sam zadeklarowal skalowanie po tenancie.
-- `push_subscriptions` ma w stanie koncowym DOKLADNIE JEDNA polityke i ta
-- polityka tenanta NIE wiaze, wiec swiadka nie ma i bramka strukturalnie nie ma
-- czego porownac. Identycznie `user_consents` (jedna polityka, bez tenanta).
-- Dla obu tabel THIS TEST JEST TYM SWIADKIEM: wpisuje na trwale, jaka decyzja
-- zapadla, zeby brak alarmu z bramki nie byl mylony z brakiem tematu.
--
-- ── USTALENIA (stan koncowy, po przejsciu WSZYSTKICH migracji) ──────────────
--
-- 1) push_subscriptions - JEDNA polityka `push subs owner all`, FOR ALL,
--    TO authenticated, USING/WITH CHECK = `user_id = (SELECT auth.uid())`.
--    Ustanawia ja 20260713092000_notification_channels.sql; rownolegly potok
--    z 20260713180000 (cztery polityki `push_subscriptions_own_*`) zostal
--    skasowany przez 20260713210000_notifications_pipeline_reconciliation.sql,
--    ktore swiadomie zostawilo wariant `FOR ALL` jako kanoniczny.
--
--    DEFEKT (opisany, NIE naprawiany w tym pliku - test niczego nie migruje).
--    Tabela MA kolumne `tenant_id uuid NOT NULL DEFAULT public_tenant_id()`,
--    a dyspozytor `src/lib/notifications/dispatch.server.ts` czyta urzadzenia
--    kluczem ZLOZONYM: `.in("tenant_id", tenantIds).in("user_id", userIds)`.
--    Serwer zaklada wiec rozdzial per tenant, ktorego RLS w ogole nie pilnuje:
--    klient moze wstawic wlasny wiersz z DOWOLNYM `tenant_id` i przestawic go
--    pozniej (asercje 16-17 ponizej to POKAZUJA, a nie zglaszaja jako blad -
--    to jest przybicie stanu zastanego).
--
--    ROZSTRZYGNIECIE „per uzytkownik czy per uzytkownik-w-tenancie":
--    PER UZYTKOWNIK. Trzy niezalezne dowody z samego repo:
--      (a) `UNIQUE (endpoint)` - endpoint Web Push nalezy do PRZEGLADARKI, nie
--          do obszaru roboczego. Jedno urzadzenie fizycznie nie moze miec
--          dwoch wierszy, wiec rozdzial per tenant jest na tej tabeli
--          niewykonalny.
--      (b) `profiles` ma klucz glowny `id`, jeden `tenant_id` na konto, a
--          trigger `profiles_pin_tenant_id` blokuje samodzielna zmiane tenanta.
--          Scenariusz (b) z zadania - „uzytkownik nalezy do dwoch obszarow" -
--          nie istnieje na poziomie konta auth: to sa DWA konta o roznych
--          `auth.uid()`, a wtedy predykat po `user_id` juz je rozdziela.
--      (c) `engagement_overview` (20260713099000) liczy `push_optin` przez
--          JOIN `profiles p ON p.id = ps.user_id WHERE p.tenant_id = v_tenant`,
--          czyli rozstrzyga tenanta Z PROFILU, IGNORUJAC `ps.tenant_id`. Dwaj
--          konsumenci tej samej tabeli czytaja tenanta z dwoch roznych miejsc.
--    Wniosek: `push_subscriptions.tenant_id` to NIEODSWIEZANA denormalizacja
--    `profiles.tenant_id`. Klient (`src/lib/notifications/push.ts`) nie podaje
--    tej kolumny w ogole - upsert `onConflict: "endpoint"` nie dotyka jej przy
--    aktualizacji, wiec po scenariuszu (a) z zadania („uzytkownik przeniesiony
--    miedzy obszarami roboczymi") wiersz zostaje ze STARYM tenantem. Wtedy:
--    trigger `tg_notifications_enqueue_push` widzi subskrypcje (sprawdza sam
--    `user_id`) i wstawia zadanie do kolejki, ale dyspozytor filtruje po
--    `(tenant_id, user_id)` i nie znajduje urzadzenia - a `dispatch.server.ts`
--    ma `p_dead: !ok && (devices === 0 || ...)`, wiec zadanie ladnie umiera
--    jako DEAD BEZ JEDNEJ PROBY WYSYLKI. Push cichnie i nikt sie nie dowiaduje.
--
--    PROPONOWANA POLITYKA (do osobnej migracji, decyzja wlasciciela modulu):
--      DROP POLICY "push subs owner all" ON public.push_subscriptions;
--      CREATE POLICY "push subs owner all" ON public.push_subscriptions
--        FOR ALL TO authenticated
--        USING (user_id = (SELECT auth.uid()))
--        WITH CHECK (user_id = (SELECT auth.uid())
--                    AND tenant_id = (SELECT public.current_tenant_id()));
--    USING zostaje BEZ tenanta CELOWO: po przeniesieniu uzytkownika jego stary
--    wiersz musi pozostac widoczny i usuwalny, inaczej zostaje smieciem, ktory
--    trzyma zakladnika w `UNIQUE (endpoint)` i przegladarka nigdy nie zdola
--    zasubskrybowac sie ponownie. Tenant wiaze wylacznie WITH CHECK, wiec kazdy
--    ZAPIS stempluje biezacy tenant domowy. Komplementarnie `push.ts` powinien
--    podawac `tenant_id` jawnie w upsercie, zeby odswiezal go przy kazdym
--    wejsciu w ustawienia.
--
-- 2) user_consents - JEDNA polityka `user_consents_select_own`, tylko SELECT,
--    `auth.uid() = user_id`, bez tenanta. Polityki i granty zapisu zdjete przez
--    20260803140001_consent_gpc_signal.sql, powtorzone i domkniete przez
--    20260803190927_fff99c9d-23b7-4465-adad-c3aef71099ff.sql. Brak polityk
--    zapisu jest SPOJNY z projektem: zapis idzie wylacznie przez
--    `set_user_consent` (SECURITY DEFINER), ktora gwarantuje wpis do
--    `user_consent_events` - czyli dowod z art. 7 ust. 1 RODO nie moze sie
--    rozjechac ze stanem. Brak tenanta w predykacie jest POPRAWNY: zgoda
--    nalezy do OSOBY (podmiotu danych), nie do obszaru roboczego, wiec
--    wlasciciel czyta swoja zgode z kazdego kontekstu. Asercje 20-21 to
--    BRAMKA: oblewaja, gdy ktokolwiek „naprawi" ten lockdown dopisujac
--    polityke lub grant INSERT/UPDATE/DELETE dla roli `authenticated`.
--
-- 3) notifications - TRZY polityki (SELECT/UPDATE/DELETE) z
--    20260703233757_0e3565f9-49f0-4832-9b22-1a41a01f92d2.sql, kazda
--    `auth.uid() = user_id AND tenant_id = public.current_tenant_id()`,
--    ZERO polityk INSERT i ZERO grantu INSERT dla `authenticated`. Klient nie
--    ma zadnej sciezki wstawienia powiadomienia - ani sobie, ani obcemu
--    uzytkownikowi. Producentem jest wylacznie serwer (`enqueue_notification`
--    i triggery domenowe), a `notifications_enforce_tenant` dodatkowo pilnuje,
--    zeby `tenant_id` powiadomienia byl tenantem ODBIORCY.
--
-- 4) notification_preferences - CZTERY polityki, wszystkie tenantowe, ale
--    tenant wyznaczany PODZAPYTANIEM `(SELECT tenant_id FROM public.profiles
--    WHERE id = auth.uid())` (INSERT z 20260710152630, pozostale trzy przepisane
--    przez 20260814221337_7032c52d-ad30-4821-a2e9-4ae1fa855a8f.sql), podczas gdy
--    `notifications` uzywa `public.current_tenant_id()`.
--
--    ROZSTRZYGNIECIE ROWNOWAZNOSCI: rownowazne co do WARTOSCI, NIEROWNOWAZNE co
--    do KONTEKSTU BEZPIECZENSTWA.
--      - `current_tenant_id()` (ostatnia definicja: 20260626180412) ma cialo
--        DOSLOWNIE `SELECT tenant_id FROM public.profiles WHERE id = auth.uid()`.
--        NIE czyta nagłówka, JWT ani hosta - to nie jest `public_tenant_id()`
--        (tamta rzeczywiscie rozstrzyga host). Asercja 36 to przybija.
--      - IMPERSONACJA nie tworzy rozjazdu: `startImpersonation`
--        (src/lib/admin/impersonation.functions.ts) wydaje PRAWDZIWA sesje
--        magiclink konta docelowego, wiec `auth.uid()` JEST uidem celu i OBIE
--        formy czytaja ten sam wiersz `profiles`.
--      - SESJA BEZ PROFILU (swieze konto, uzytkownik usuniety z `profiles`):
--        obie formy zwracaja NULL, `tenant_id = NULL` daje NULL, wiec OBIE
--        tabele odmawiaja (fail-closed). Asercje 39-41.
--      - ROZJAZD REALNY: `current_tenant_id()` jest SECURITY DEFINER, wiec
--        OMIJA RLS na `profiles`; podzapytanie inline jest w kontekscie
--        wolajacego, wiec RLS na `profiles` JEJ DOTYCZY. Gdy samoodczyt profilu
--        przestanie byc dozwolony (zaostrzenie polityki `Profiles authenticated
--        read`, dopisanie klauzuli RESTRICTIVE, filtr na koncie usunietym),
--        `notifications` dziala dalej, a `notification_preferences` odmawia
--        WSZYSTKIEGO - lacznie z odczytem wlasnych przelacznikow i z INSERT-em
--        pierwszego wiersza. Kierunek awarii jest bezpieczny (fail-closed), ale
--        cichy: uzytkownik traci ustawienia powiadomien bez zadnego bledu w
--        logach RLS. Asercje 42-43 wywoluja ten stan JAWNIE (polityka
--        RESTRICTIVE zalozona i skasowana WEWNATRZ tej transakcji, cofana przez
--        ROLLBACK - plik nie zmienia schematu) i przybijaja rozjazd.
--
-- 5) notification_deliveries i notification_digests - te relacje NIE ISTNIEJA.
--    Nie ma ich ani w migracjach, ani w `src/integrations/supabase/types.ts`.
--    Brak `ENABLE ROW LEVEL SECURITY` nie oznaczal wiec tabeli bez RLS, tylko
--    tabele bez tabeli. Rzeczywiste odpowiedniki w stanie koncowym to:
--      - doreczenia: `public.notification_push_queue`
--        (20260713092000_notification_channels.sql) - RLS WLACZONY, jedna
--        polityka odczytu dla admina tenanta, ale ZERO grantow dla
--        `authenticated`/`anon`, wiec plaszczyzna kliencka jest zamknieta juz
--        na poziomie przywilejow, zanim RLS w ogole dojdzie do glosu;
--      - digest: NIE jest tabela, tylko kolumnami `email_digest` /
--        `digest_last_sent_at` na `notification_preferences` plus funkcja
--        `claim_due_digests` (service role).
--    Konkurencyjny `public.push_outbox` z 20260713180000 zostal USUNIETY przez
--    20260713210000. Asercje 1-4 przybijaja te nieobecnosci, zeby nikt nie
--    odtworzyl dubla potoku, a asercje 6-8 sa BRAMKA na przyszlosc: oblewaja,
--    gdy ktos nada tabeli modulu grant dla `authenticated`/`anon` przy
--    WYLACZONYM RLS, albo otworzy kolejke doreczen dla roli klienckiej.
--
-- Zero prawdziwych danych osobowych - wylacznie example.com / example.org.
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(43);

-- Na auth.users i notifications wisza triggery uzytkownika (auto-provisioning
-- profilu/tenanta oraz `notifications_enforce_tenant`, ktory nie pozwala
-- zapisac powiadomienia w innym tenancie niz tenant odbiorcy). Wylaczamy je na
-- czas seeda, bo potrzebujemy zbudowac wiersz ROZJECHANY - taki, jaki zostaje
-- po przeniesieniu uzytkownika miedzy obszarami roboczymi. DISABLE TRIGGER USER
-- jest transakcyjne, wiec ROLLBACK je przywraca.
ALTER TABLE auth.users DISABLE TRIGGER USER;
ALTER TABLE public.notifications DISABLE TRIGGER USER;

-- ── Seed: dwa obszary robocze, konto w kazdym, plus konto BEZ profilu ───────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('12aaaaaa-0000-0000-0000-00000000000a', 'm12-a', 'Modul 12 Tenant A'),
  ('12bbbbbb-0000-0000-0000-00000000000b', 'm12-b', 'Modul 12 Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('12000000-0000-0000-0000-0000000000a1', 'ann@example.com'),
  ('12000000-0000-0000-0000-0000000000b1', 'bob@example.org'),
  ('12000000-0000-0000-0000-0000000000c1', 'ghost@example.com');

-- Ann w A, Bob w B. `ghost` CELOWO bez wiersza w `profiles` - to modeluje swieze
-- konto przed provisioningiem oraz konto usuniete z profili.
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('12000000-0000-0000-0000-0000000000a1', 'ann@example.com', 'Ann', '12aaaaaa-0000-0000-0000-00000000000a'),
  ('12000000-0000-0000-0000-0000000000b1', 'bob@example.org', 'Bob', '12bbbbbb-0000-0000-0000-00000000000b');

-- Trzy powiadomienia: wlasne, ROZJECHANE (uid Ann, ale tenant B - stan po
-- przeniesieniu konta) i cudze.
INSERT INTO public.notifications (id, user_id, tenant_id, kind, title_pl) VALUES
  ('12000000-0000-0000-0000-0000000000f1', '12000000-0000-0000-0000-0000000000a1',
   '12aaaaaa-0000-0000-0000-00000000000a', 'system', 'M12 wlasne Ann w A'),
  ('12000000-0000-0000-0000-0000000000f2', '12000000-0000-0000-0000-0000000000a1',
   '12bbbbbb-0000-0000-0000-00000000000b', 'system', 'M12 dryf Ann w B'),
  ('12000000-0000-0000-0000-0000000000f3', '12000000-0000-0000-0000-0000000000b1',
   '12bbbbbb-0000-0000-0000-00000000000b', 'system', 'M12 cudze Boba w B');

INSERT INTO public.notification_preferences (user_id, tenant_id) VALUES
  ('12000000-0000-0000-0000-0000000000a1', '12aaaaaa-0000-0000-0000-00000000000a'),
  ('12000000-0000-0000-0000-0000000000b1', '12bbbbbb-0000-0000-0000-00000000000b');

INSERT INTO public.user_consents (user_id, consent_key, given, version, tenant_id) VALUES
  ('12000000-0000-0000-0000-0000000000b1', 'marketing', true, 'm12-v1',
   '12bbbbbb-0000-0000-0000-00000000000b');

-- Urzadzenie Boba - Ann nie ma prawa go zobaczyc.
INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth) VALUES
  ('12000000-0000-0000-0000-0000000000b1', '12bbbbbb-0000-0000-0000-00000000000b',
   'https://push.example.com/bob-device', 'p256dhp256dhp256dh', 'authauthauth');

-- ════════════════════════════════════════════════════════════════════════════
-- A. INWENTARZ MODULU: co w stanie koncowym ISTNIEJE, a co nie
-- ════════════════════════════════════════════════════════════════════════════

-- 1-2. Relacje z opisu zadania nie istnieja. Gdyby ktos je kiedys zalozyl,
-- ta asercja ma go zmusic do swiadomej decyzji o RLS zamiast cichego CREATE.
SELECT ok(to_regclass('public.notification_deliveries') IS NULL,
  'notification_deliveries NIE ISTNIEJE - doreczenia trzyma notification_push_queue');

SELECT ok(to_regclass('public.notification_digests') IS NULL,
  'notification_digests NIE ISTNIEJE - digest to kolumny notification_preferences');

-- 3. Dubel potoku push (20260713180000) zostal wycofany przez 20260713210000.
SELECT ok(to_regclass('public.push_outbox') IS NULL,
  'push_outbox NIE ISTNIEJE - rownolegly potok push wycofany przez 20260713210000');

-- 4. Kanoniczna kolejka doreczen istnieje.
SELECT ok(to_regclass('public.notification_push_queue') IS NOT NULL,
  'notification_push_queue ISTNIEJE - to jest kanoniczna kolejka doreczen push');

-- 5. Wszystkie szesc tabel modulu ma wlaczony RLS. Liczba jest sztywna: nowa
-- tabela modulu bez RLS nie podniesie licznika i asercja oblegnie.
SELECT is(
  (SELECT count(*)::int
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('notifications', 'notification_preferences',
                        'notification_push_queue', 'push_subscriptions',
                        'user_consents', 'user_consent_events')
      AND c.relrowsecurity),
  6,
  'wszystkie 6 tabel modulu 12 ma relrowsecurity = true');

-- ════════════════════════════════════════════════════════════════════════════
-- B. BRAMKA NA PRZYSZLOSC: grant dla roli klienckiej bez RLS = otwarta tabela
-- ════════════════════════════════════════════════════════════════════════════

-- 6. Inwariant generyczny. RLS wylaczony + jakikolwiek grant dla anon /
-- authenticated / PUBLIC oznacza tabele czytana przez kazdego zalogowanego bez
-- ograniczen. Ta asercja oblewa DOKLADNIE w tym momencie, w ktorym ktos doda
-- tabele do modulu i zapomni o `ENABLE ROW LEVEL SECURITY`.
SELECT is(
  (SELECT count(*)::int
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('notifications', 'notification_preferences',
                        'notification_push_queue', 'push_subscriptions',
                        'user_consents', 'user_consent_events',
                        'notification_deliveries', 'notification_digests',
                        'push_outbox')
      AND NOT c.relrowsecurity
      AND EXISTS (
        SELECT 1 FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public'
           AND g.table_name = c.relname
           AND g.grantee IN ('anon', 'authenticated', 'PUBLIC'))),
  0,
  'zadna tabela modulu 12 nie ma grantu dla roli klienckiej przy WYLACZONYM RLS');

-- 7. `anon` nie ma na tym module NICZEGO. Powiadomienia, preferencje, zgody i
-- subskrypcje push sa z definicji danymi zalogowanej osoby - sesja anonimowa nie
-- ma tu nawet czego odczytac.
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('notifications', 'notification_preferences',
                         'notification_push_queue', 'push_subscriptions',
                         'user_consents', 'user_consent_events')
      AND grantee IN ('anon', 'PUBLIC')),
  0,
  'anon/PUBLIC nie ma ZADNEGO grantu na tabelach modulu 12');

-- 8. Kolejka doreczen jest wylacznie serwerowa. Polityka odczytu dla admina na
-- niej wisi, ale bez grantu jest martwa - i taki ma pozostac stan domyslny.
SELECT is(
  (SELECT count(*)::int FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'notification_push_queue'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')),
  0,
  'notification_push_queue: zero grantow klienckich (kolejka nalezy do service_role)');

-- ════════════════════════════════════════════════════════════════════════════
-- C. push_subscriptions - KSZTALT
-- ════════════════════════════════════════════════════════════════════════════

-- 9. Dokladnie jedna polityka. Licznik jest tu wazniejszy niz tresc: caly
-- pojednany stan (20260713210000) polega na tym, ze cztery polityki `own_*`
-- z rownoleglego potoku ZNIKNELY. Ich powrot to natychmiastowa regresja.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_subscriptions'),
  1,
  'push_subscriptions: DOKLADNIE jedna polityka (duble own_* pozostaja skasowane)');

-- 10. Tozsamosc tej jednej polityki - nazwa, komenda i rola razem, zeby test nie
-- przeszedl na samej liczbie polityk po podmianie ich znaczenia.
SELECT is(
  (SELECT policyname || '|' || cmd || '|' || roles::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_subscriptions'),
  'push subs owner all|ALL|{authenticated}',
  'push_subscriptions: polityka „push subs owner all", FOR ALL, TO authenticated');

-- 11. DEFEKT PRZYBITY SWIADOMIE: ani USING, ani WITH CHECK nie wspominaja
-- tenanta, mimo ze kolumna istnieje i dyspozytor po niej filtruje. Ta asercja
-- oblegnie w dniu, w ktorym ktos ZAMKNIE ten defekt - i to jest zamierzone:
-- wtedy trzeba tu wpisac nowy stan i skasowac akapit „PROPONOWANA POLITYKA"
-- z naglowka, zeby dokumentacja nie klamala.
SELECT ok(
  (SELECT coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%tenant%'
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'push_subscriptions'),
  'push_subscriptions: polityka NIE wiaze tenanta - stan zastany, opisany w naglowku');

-- 12. Kolumna tenanta jednak ISTNIEJE i jest obowiazkowa. To wlasnie ta para -
-- kolumna wymagana przez schemat, ale nie pilnowana przez RLS - jest zrodlem
-- rozjazdu z dyspozytorem.
SELECT is(
  (SELECT is_nullable || '/' || coalesce(column_default, 'brak')
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
      AND column_name = 'tenant_id'),
  'NO/public_tenant_id()',
  'push_subscriptions.tenant_id jest NOT NULL z domyslnym public_tenant_id()');

-- ════════════════════════════════════════════════════════════════════════════
-- D. push_subscriptions - SKUTEK (realna sesja Ann z obszaru A)
-- ════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"12000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

-- 13. Predykat wlascicielski dziala tam, gdzie zostal napisany: cudze urzadzenie
-- jest niewidoczne. Wyciek endpointu + p256dh + auth to gotowy material do
-- podszycia sie pod push cudzej osoby, wiec ta asercja jest nieprzeskakiwalna.
SELECT is(
  (SELECT count(*)::int FROM public.push_subscriptions
    WHERE user_id = '12000000-0000-0000-0000-0000000000b1'),
  0,
  'push_subscriptions: Ann nie widzi urzadzenia Boba (klucze push nie wyciekaja)');

-- 14. Podszycie sie po `user_id` jest zablokowane - to jest ta czesc polityki,
-- ktora rzeczywiscie chroni.
SELECT throws_ok(
  $$INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth)
    VALUES ('12000000-0000-0000-0000-0000000000b1',
            '12bbbbbb-0000-0000-0000-00000000000b',
            'https://push.example.com/podszycie', 'p256dhp256dhp256dh', 'authauthauth')$$,
  '42501',
  NULL,
  'push_subscriptions: INSERT na CUDZE user_id odrzucony (42501)');

-- 15. Pominiety `tenant_id` domyslnie ustawia sie na tenant domowy - i wlasnie
-- tak robi klient (`push.ts` nie podaje tej kolumny w ogole). Wartosc jest wiec
-- poprawna w chwili zapisu i przestaje byc poprawna po przeniesieniu konta.
INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
VALUES ('12000000-0000-0000-0000-0000000000a1',
        'https://push.example.com/ann-device', 'p256dhp256dhp256dh', 'authauthauth');

SELECT is(
  (SELECT tenant_id FROM public.push_subscriptions
    WHERE endpoint = 'https://push.example.com/ann-device'),
  '12aaaaaa-0000-0000-0000-00000000000a'::uuid,
  'push_subscriptions: pominiety tenant_id domysla sie tenanta domowego zapisujacego');

-- 16. DEFEKT, skutek nr 1: wlasny wiersz z CUDZYM tenantem przechodzi. Polityka
-- sprawdza tylko `user_id`, wiec `tenant_id` jest polem pod kontrola klienta.
SELECT lives_ok(
  $$INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth)
    VALUES ('12000000-0000-0000-0000-0000000000a1',
            '12bbbbbb-0000-0000-0000-00000000000b',
            'https://push.example.com/ann-obcy-tenant', 'p256dhp256dhp256dh', 'authauthauth')$$,
  'push_subscriptions: DEFEKT - INSERT wlasnego wiersza z OBCYM tenant_id przechodzi');

-- 17. DEFEKT, skutek nr 2: istniejacy wiersz mozna przestawic na obcy tenant.
-- To ta sama dziura od strony UPDATE - `FOR ALL` obejmuje obie operacje.
SELECT lives_ok(
  $$UPDATE public.push_subscriptions
       SET tenant_id = '12bbbbbb-0000-0000-0000-00000000000b'
     WHERE endpoint = 'https://push.example.com/ann-device'$$,
  'push_subscriptions: DEFEKT - UPDATE przestawiajacy tenant_id na obcy przechodzi');

-- 18. Konsekwencja operacyjna, odwzorowana zapytaniem dyspozytora
-- (`.in("tenant_id", tenantIds).in("user_id", userIds).is("failed_at", null)`):
-- po rozjezdzie tenanta urzadzen jest ZERO, a `dispatch.server.ts` oznacza takie
-- zadanie jako DEAD (`devices === 0`) bez ani jednej proby wysylki. Push cichnie
-- bez sladu w bledach - to jest realny koszt tego, ze RLS tenanta nie pilnuje.
SELECT is(
  (SELECT count(*)::int FROM public.push_subscriptions ps
    WHERE ps.tenant_id = '12aaaaaa-0000-0000-0000-00000000000a'
      AND ps.user_id = '12000000-0000-0000-0000-0000000000a1'
      AND ps.failed_at IS NULL),
  0,
  'dyspozytor po rozjezdzie tenanta widzi ZERO urzadzen Ann - zadanie umiera jako DEAD');

-- ════════════════════════════════════════════════════════════════════════════
-- E. user_consents - lockdown zapisu jest STANEM DOCELOWYM, nie brakiem
-- ════════════════════════════════════════════════════════════════════════════

RESET ROLE;

-- 19. Dokladnie jedna polityka na calej tabeli.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_consents'),
  1,
  'user_consents: DOKLADNIE jedna polityka (tylko sciezka odczytu)');

-- 20. BRAMKA. Oblewa, gdy ktokolwiek dopisze polityke INSERT/UPDATE/DELETE dla
-- roli `authenticated` - a to jest bardzo kuszaca „naprawa", bo z zewnatrz
-- wyglada, jakby tabeli brakowalo polityk zapisu. Brakuje ich CELOWO: kazdy
-- zapis musi przejsc przez `set_user_consent`, ktora w tej samej transakcji
-- dopisuje wpis do `user_consent_events`. Polityka INSERT rozspoilaby stan
-- zgody z jej dowodem, czyli zniszczylaby material dowodowy art. 7 ust. 1 RODO.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_consents'
      AND cmd <> 'SELECT'
      AND 'authenticated' = ANY (roles)),
  0,
  'user_consents: ZERO polityk INSERT/UPDATE/DELETE dla authenticated (zapis tylko przez set_user_consent)');

-- 21. Ta sama bramka na poziomie przywilejow - polityka i grant to dwie osobne
-- warstwy i obie musza zostac zamkniete.
SELECT is(
  (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
     FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'user_consents'
      AND grantee = 'authenticated'),
  'SELECT',
  'user_consents: authenticated ma WYLACZNIE grant SELECT');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"12000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

-- 22. Brak tenanta w predykacie NIE oznacza braku izolacji: `auth.uid()`
-- rozdziela osoby, a zgoda jest wlasnoscia osoby, nie obszaru roboczego.
SELECT is(
  (SELECT count(*)::int FROM public.user_consents
    WHERE user_id = '12000000-0000-0000-0000-0000000000b1'),
  0,
  'user_consents: Ann nie widzi zgody Boba mimo braku predykatu tenanta');

-- 23. Sfabrykowanie zgody, ktorej sie nie wyrazilo, jest niemozliwe.
SELECT throws_ok(
  $$INSERT INTO public.user_consents (user_id, consent_key, given, version)
    VALUES ('12000000-0000-0000-0000-0000000000a1', 'marketing', true, 'podrobka')$$,
  '42501',
  NULL,
  'user_consents: INSERT klienta odrzucony (42501) - zgody nie da sie dopisac recznie');

-- 24. Lockdown bez dowodu, ze legalna sciezka zyje, bylby tylko awaria. RPC
-- nadal zapisuje - i sama stempluje user_id, tenant_id oraz znaczniki czasu.
SELECT public.set_user_consent(
  p_key => 'analytics', p_given => true, p_version => 'm12-v1', p_gpc => false,
  p_lang => 'pl', p_ip => '198.51.100.7', p_user_agent => 'pgTAP',
  p_source => 'account', p_banner_version => 'm12-b1',
  p_decision_id => '12000000-0000-0000-0000-0000000000d1',
  p_page_url => '/profile/privacy');

SELECT is(
  (SELECT count(*)::int FROM public.user_consents
    WHERE user_id = '12000000-0000-0000-0000-0000000000a1' AND consent_key = 'analytics'),
  1,
  'user_consents: set_user_consent nadal zapisuje mimo braku grantu (lockdown to nie awaria)');

-- ════════════════════════════════════════════════════════════════════════════
-- F. notifications - brak klienckiej sciezki wstawienia
-- ════════════════════════════════════════════════════════════════════════════

RESET ROLE;

-- 25. Trzy polityki, ani jednej wiecej.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications'),
  3,
  'notifications: DOKLADNIE trzy polityki (SELECT/UPDATE/DELETE)');

-- 26. BRAMKA. Zero polityk INSERT. Polityka INSERT na tej tabeli oznaczalaby, ze
-- klient sam produkuje powiadomienia - a stad juz tylko krok do podszywania sie
-- pod system w skrzynce obcej osoby.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications' AND cmd = 'INSERT'),
  0,
  'notifications: ZERO polityk INSERT - powiadomienia produkuje wylacznie serwer');

-- 27. Kazda z trzech polityk wiaze tenanta przez `current_tenant_id()`.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications'
      AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%current_tenant_id()%'),
  3,
  'notifications: wszystkie trzy polityki wiaza tenanta przez current_tenant_id()');

-- 28. Druga warstwa - brak samego przywileju. Nawet gdyby polityka INSERT
-- wrocila, bez grantu i tak nic nie wejdzie.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.notifications', 'INSERT'),
  'notifications: authenticated NIE ma grantu INSERT');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"12000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

-- 29. Skutek: nawet powiadomienie SAMEMU SOBIE jest odrzucane. Gdyby przechodzilo,
-- klient moglby w nastepnym kroku podmienic `user_id` na cudze i wstrzykiwac
-- tresci do skrzynki obcej osoby - dlatego zamkniete jest calkowicie.
SELECT throws_ok(
  $$INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl)
    VALUES ('12000000-0000-0000-0000-0000000000a1',
            '12aaaaaa-0000-0000-0000-00000000000a', 'system', 'M12 wstrzykniete')$$,
  '42501',
  NULL,
  'notifications: INSERT klienta odrzucony (42501) nawet na WLASNE user_id');

-- 30. Predykat tenanta jest NOSNY, nie ozdobny: wiersz z uidem Ann, ale tenantem
-- B (stan po przeniesieniu konta) pozostaje niewidoczny. Bez tego czlonek
-- obszaru A czytalby historie powiadomien z obszaru B.
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE title_pl = 'M12 dryf Ann w B'),
  0,
  'notifications: rozjechane powiadomienie (uid Ann / tenant B) jest niewidoczne');

-- 31. I oczywiscie cudze powiadomienie tez.
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE title_pl = 'M12 cudze Boba w B'),
  0,
  'notifications: powiadomienie Boba niewidoczne dla Ann');

-- ════════════════════════════════════════════════════════════════════════════
-- G. ROZJAZD: current_tenant_id() vs podzapytanie do profiles
-- ════════════════════════════════════════════════════════════════════════════

RESET ROLE;

-- 32. Cztery polityki na preferencjach.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_preferences'),
  4,
  'notification_preferences: DOKLADNIE cztery polityki (SELECT/INSERT/UPDATE/DELETE)');

-- 33. Wszystkie cztery WIAZA tenanta - tyle ze podzapytaniem do `profiles`.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_preferences'
      AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%FROM profiles%'),
  4,
  'notification_preferences: wszystkie cztery wiaza tenanta podzapytaniem do profiles');

-- 34-35. Rozjazd FORMY, przybity z obu stron: preferencje nie wolaja funkcji,
-- powiadomienia nie robia podzapytania. Dwie konwencje w jednym module to nie
-- kosmetyka - roznia sie kontekstem bezpieczenstwa (patrz asercje 42-43).
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_preferences'
      AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%current_tenant_id%'),
  0,
  'rozjazd: ZADNA polityka notification_preferences nie wola current_tenant_id()');

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications'
      AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%FROM profiles%'),
  0,
  'rozjazd: ZADNA polityka notifications nie robi podzapytania do profiles');

-- 36. Cialo funkcji to DOSLOWNIE to samo podzapytanie. To rozstrzyga pytanie
-- „czy current_tenant_id() czyta naglowek/JWT/host": NIE. Hosta rozstrzyga
-- `public_tenant_id()`, ktora jest INNA funkcja i tutaj nie wystepuje.
SELECT is(
  (SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))
     FROM pg_proc p WHERE p.oid = 'public.current_tenant_id()'::regprocedure),
  'SELECT tenant_id FROM public.profiles WHERE id = auth.uid()',
  'current_tenant_id() czyta PROFIL, nie naglowek/JWT/host - tresc jest ta sama co inline');

-- 37. ...a mimo to nie jest tym samym, bo dziala w INNYM kontekscie. To jedyna
-- roznica miedzy oboma zapisami i zarazem cale zrodlo rozjazdu.
SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.current_tenant_id()'::regprocedure),
  'current_tenant_id() jest SECURITY DEFINER - omija RLS na profiles, inline nie omija');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"12000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

-- 38. Rownowaznosc WARTOSCI w normalnej sesji: dopoki polityka `Profiles
-- authenticated read` przepuszcza samoodczyt (`id = auth.uid()`), obie formy
-- zwracaja to samo. Dotyczy to takze IMPERSONACJI, bo ta wydaje prawdziwa sesje
-- konta docelowego - `auth.uid()` jest wtedy uidem celu dla OBU form naraz.
SELECT is(
  public.current_tenant_id(),
  (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
  'rownowaznosc WARTOSCI: w sesji z czytelnym profilem obie formy daja ten sam tenant');

-- 39-41. Sesja BEZ PROFILU (swieze konto / konto usuniete z profiles): obie formy
-- zwracaja NULL, `tenant_id = NULL` daje NULL, wiec OBIE tabele odmawiaja.
-- Kierunek awarii jest bezpieczny i IDENTYCZNY po obu stronach - to jest ta
-- czesc, w ktorej rozjazdu NIE MA.
SELECT set_config('request.jwt.claims',
  '{"sub":"12000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);

SELECT ok(
  public.current_tenant_id() IS NULL
    AND (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()) IS NULL,
  'sesja bez profilu: OBIE formy zwracaja NULL (brak tenanta, nie „jakikolwiek")');

SELECT is(
  (SELECT count(*)::int FROM public.notifications),
  0,
  'sesja bez profilu: notifications fail-closed (zero wierszy)');

SELECT is(
  (SELECT count(*)::int FROM public.notification_preferences),
  0,
  'sesja bez profilu: notification_preferences fail-closed (zero wierszy)');

-- 42-43. ROZJAZD REALNY. Zakladamy na `profiles` polityke RESTRICTIVE, ktora
-- odcina samoodczyt profilu - to modeluje kazde przyszle zaostrzenie polityki
-- `Profiles authenticated read` (np. filtr na koncie usunietym albo zawezenie do
-- personelu). Polityka powstaje i znika WEWNATRZ tej transakcji, a ROLLBACK na
-- koncu pliku cofa ja bezwarunkowo - schemat repozytorium nie jest ruszany.
--
-- Wynik: `notifications` (SECURITY DEFINER) dziala dalej, `notification_preferences`
-- (podzapytanie inline) odmawia WSZYSTKIEGO, lacznie z odczytem wlasnych
-- przelacznikow i INSERT-em pierwszego wiersza. Awaria jest bezpieczna, ale
-- cicha: uzytkownik traci ustawienia powiadomien bez zadnego sygnalu.
RESET ROLE;
CREATE POLICY m12_tmp_block_profile_selfread ON public.profiles
  AS RESTRICTIVE FOR SELECT TO authenticated USING (false);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"12000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE title_pl = 'M12 wlasne Ann w A'),
  1,
  'rozjazd KONTEKSTU: przy odcietym odczycie profilu notifications NADAL dziala (DEFINER)');

SELECT is(
  (SELECT count(*)::int FROM public.notification_preferences),
  0,
  'rozjazd KONTEKSTU: przy odcietym odczycie profilu notification_preferences ODMAWIA (INVOKER)');

RESET ROLE;
DROP POLICY m12_tmp_block_profile_selfread ON public.profiles;
SELECT set_config('request.jwt.claims', NULL, true);

SELECT * FROM finish();
ROLLBACK;
