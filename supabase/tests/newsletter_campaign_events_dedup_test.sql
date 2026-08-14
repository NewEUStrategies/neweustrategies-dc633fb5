-- pgTAP: jedno zdarzenie zaangażowania na (kampania, subskrybent, rodzaj, dobę
-- UTC) - i jedna ścieżka zapisu.
--
-- Weryfikuje migrację 20260814150000_newsletter_campaign_events_daily_unique.sql.
-- Do jej powstania doprowadziło szóste zgłoszenie tej samej usterki: tabela
-- `newsletter_campaign_events` nie miała ŻADNEGO indeksu unikalnego, a pisały
-- do niej równolegle dwa producenty mierzące to samo (piksel/przekierowanie
-- oraz webhook dostawcy poczty). Każde otwarcie liczyło się dwa razy, więc
-- panel kampanii potrafił pokazać wskaźnik otwarć powyżej 100%.
--
-- Trigger scoringu CRM (`trg_score_on_campaign_event`) jest wyłączony na czas
-- transakcji: przedmiotem testu jest inwariant unikalności i RPC, nie efekty
-- uboczne w leadach.

BEGIN;
SELECT plan(28);

ALTER TABLE public.newsletter_subscribers DISABLE TRIGGER USER;
ALTER TABLE public.newsletter_campaign_events DISABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- Seed: dwa obszary robocze, kampania w pierwszym z nich
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, slug, name) VALUES
  ('d1111111-1111-1111-1111-1111111111d1', 'nce-tenant-a', 'Tenant A'),
  ('d2222222-2222-2222-2222-2222222222d2', 'nce-tenant-b', 'Tenant B');

INSERT INTO public.newsletter_campaigns (id, tenant_id, name, subject_pl, subject_en, html_pl, html_en)
VALUES
  ('ca111111-1111-1111-1111-1111111111ca', 'd1111111-1111-1111-1111-1111111111d1',
   'Kampania A', 'Temat', 'Subject', '<p>a</p>', '<p>a</p>'),
  ('cb222222-2222-2222-2222-2222222222cb', 'd2222222-2222-2222-2222-2222222222d2',
   'Kampania B', 'Temat', 'Subject', '<p>b</p>', '<p>b</p>');

INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status) VALUES
  ('5a111111-1111-1111-1111-1111111111aa', 'd1111111-1111-1111-1111-1111111111d1',
   'reader-a@x.test', 'subscribed'),
  ('5a222222-2222-2222-2222-2222222222aa', 'd1111111-1111-1111-1111-1111111111d1',
   'reader-a2@x.test', 'subscribed'),
  ('5b111111-1111-1111-1111-1111111111bb', 'd2222222-2222-2222-2222-2222222222d2',
   'reader-b@x.test', 'subscribed');

-- ---------------------------------------------------------------------------
-- 1) Sam inwariant: indeks istnieje, jest UNIKALNY i CZĘŚCIOWY
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'newsletter_campaign_events'
       AND indexname = 'nl_campaign_events_subscriber_day_uq'
  ),
  'indeks nl_campaign_events_subscriber_day_uq istnieje'
);

SELECT ok(
  (SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'nl_campaign_events_subscriber_day_uq')
  LIKE 'CREATE UNIQUE INDEX%',
  'indeks jest UNIKALNY - to on, a nie kod aplikacji, jest ostatnia linia obrony'
);

SELECT ok(
  (SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'nl_campaign_events_subscriber_day_uq')
  LIKE '%WHERE (subscriber_id IS NOT NULL)%',
  'indeks jest CZESCIOWY - NULL-e w indeksie unikalnym sa rozlaczne, wiec zdarzenia nieprzypisane sa poza nim'
);

SELECT ok(
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'newsletter_campaign_events'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%') >= 1,
  'tabela ma co najmniej jeden indeks unikalny (stan zastany: zero)'
);

-- ---------------------------------------------------------------------------
-- 2) Zachowanie inwariantu przy zapisie BEZPOSREDNIM (service_role)
-- ---------------------------------------------------------------------------
INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind)
VALUES ('d1111111-1111-1111-1111-1111111111d1', 'ca111111-1111-1111-1111-1111111111ca',
        '5a111111-1111-1111-1111-1111111111aa', 'open');

SELECT throws_ok(
  $$ INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind)
     VALUES ('d1111111-1111-1111-1111-1111111111d1', 'ca111111-1111-1111-1111-1111111111ca',
             '5a111111-1111-1111-1111-1111111111aa', 'open') $$,
  '23505',
  NULL,
  'drugie otwarcie tego samego odbiorcy tego samego dnia jest odrzucane przez baze'
);

SELECT lives_ok(
  $$ INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind)
     VALUES ('d1111111-1111-1111-1111-1111111111d1', 'ca111111-1111-1111-1111-1111111111ca',
             '5a111111-1111-1111-1111-1111111111aa', 'click') $$,
  'klikniecie tego samego odbiorcy tego samego dnia to INNY rodzaj - przechodzi'
);

SELECT lives_ok(
  $$ INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind, created_at)
     VALUES ('d1111111-1111-1111-1111-1111111111d1', 'ca111111-1111-1111-1111-1111111111ca',
             '5a111111-1111-1111-1111-1111111111aa', 'open', now() - interval '1 day') $$,
  'otwarcie w INNEJ dobie przechodzi - powrot do wiadomosci nazajutrz to nowa informacja'
);

SELECT lives_ok(
  $$ INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind)
     VALUES ('d1111111-1111-1111-1111-1111111111d1', 'ca111111-1111-1111-1111-1111111111ca',
             '5a222222-2222-2222-2222-2222222222aa', 'open') $$,
  'otwarcie INNEGO odbiorcy tego samego dnia przechodzi'
);

-- Granica doby biegnie po kalendarzu UTC, nie po oknie 24 h: dwa zdarzenia
-- oddalone o minuty trafiaja do roznych kubelkow, gdy dzieli je polnoc.
SELECT lives_ok(
  $$ INSERT INTO public.newsletter_campaign_events (tenant_id, campaign_id, subscriber_id, kind, created_at)
     VALUES ('d1111111-1111-1111-1111-1111111111d1', 'ca111111-1111-1111-1111-1111111111ca',
             '5b111111-1111-1111-1111-1111111111bb', 'open', '2026-08-10 23:59:00+00'),
            ('d1111111-1111-1111-1111-1111111111d1', 'ca111111-1111-1111-1111-1111111111ca',
             '5b111111-1111-1111-1111-1111111111bb', 'open', '2026-08-11 00:01:00+00') $$,
  'granica kubelka to polnoc UTC, nie okno 24 h'
);

-- ---------------------------------------------------------------------------
-- 3) RPC: jedyna sciezka zapisu
-- ---------------------------------------------------------------------------
SELECT is(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca',
     '5a111111-1111-1111-1111-1111111111aa', 'open', NULL) ->> 'reason'),
  'duplicate_in_day',
  'RPC zwraca duplikat zamiast bledu, gdy zdarzenie tej doby juz istnieje'
);

SELECT is(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca',
     '5a111111-1111-1111-1111-1111111111aa', 'open', NULL) ->> 'recorded'),
  'false',
  'duplikat NIE tworzy wiersza'
);

-- Nowy odbiorca w tej kampanii - pierwszy zapis przez RPC.
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status)
VALUES ('5a333333-3333-3333-3333-3333333333aa', 'd1111111-1111-1111-1111-1111111111d1',
        'reader-a3@x.test', 'subscribed');

SELECT is(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca',
     '5a333333-3333-3333-3333-3333333333aa', 'open', NULL) ->> 'recorded'),
  'true',
  'pierwsze zdarzenie odbiorcy w tej dobie jest zapisywane'
);

SELECT is(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca',
     '5b111111-1111-1111-1111-1111111111bb', 'open', NULL) ->> 'reason'),
  'unknown_subscriber',
  'GRANICA OBSZARU ROBOCZEGO: subskrybent tenanta B nie tworzy zdarzenia w kampanii tenanta A'
);

SELECT is(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca', NULL, 'open', NULL) ->> 'reason'),
  'unknown_subscriber',
  'zdarzenie bez subskrybenta jest odrzucane - nie da sie go ani przypisac, ani zdeduplikowac'
);

SELECT is(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca',
     '5a111111-1111-1111-1111-1111111111aa', 'bounced', NULL) ->> 'reason'),
  'invalid_kind',
  'rodzaj spoza (open, click) jest odrzucany'
);

SELECT is(
  (public.newsletter_record_campaign_event(
     'ffffffff-ffff-ffff-ffff-ffffffffffff',
     '5a111111-1111-1111-1111-1111111111aa', 'open', NULL) ->> 'reason'),
  'unknown_campaign',
  'nieznana kampania nie tworzy zdarzenia (tenant pochodzi WYLACZNIE z kampanii)'
);

SELECT is(
  (SELECT tenant_id FROM public.newsletter_campaign_events
    WHERE subscriber_id = '5a333333-3333-3333-3333-3333333333aa'),
  'd1111111-1111-1111-1111-1111111111d1'::uuid,
  'tenant zdarzenia pochodzi z kampanii, nie z zadania'
);

-- ---------------------------------------------------------------------------
-- 4) ACL: zapis idzie wylacznie przez service_role
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon',
    'public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)', 'EXECUTE'),
  'anon nie moze wolac RPC zapisu zdarzen'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)', 'EXECUTE'),
  'zalogowany uzytkownik nie moze fabrykowac zdarzen zaangazowania'
);

SELECT ok(
  has_function_privilege('service_role',
    'public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)', 'EXECUTE'),
  'service_role (piksel / przekierowanie) zapisuje'
);

SELECT ok(
  NOT has_function_privilege('anon',
    'public.newsletter_campaign_engagement(uuid)', 'EXECUTE'),
  'anon nie czyta zaangazowania kampanii'
);

-- ---------------------------------------------------------------------------
-- 4b) Czas WYSTAPIENIA, nie czas dostarczenia webhooka
-- ---------------------------------------------------------------------------
-- Webhook dostawcy potrafi dotrzec z opoznieniem albo poza kolejnoscia. Gdyby
-- kubelek liczyl sie od chwili ODBIORU, dwa otwarcia z tej samej doby
-- dostarczone po dwoch stronach polnocy policzylyby sie dwa razy, a dwa
-- z roznych dob dostarczone razem - zlaly w jedno.
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status)
VALUES ('5a444444-4444-4444-4444-4444444444aa', 'd1111111-1111-1111-1111-1111111111d1',
        'reader-a4@x.test', 'subscribed');

SELECT is(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca',
     '5a444444-4444-4444-4444-4444444444aa', 'open', NULL,
     '2026-08-10 23:59:00+00'::timestamptz) ->> 'event_day'),
  '2026-08-10',
  'kubelek bierze sie z czasu WYSTAPIENIA, nie z chwili zapisu'
);

SELECT is(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca',
     '5a444444-4444-4444-4444-4444444444aa', 'open', NULL,
     '2026-08-10 23:10:00+00'::timestamptz) ->> 'reason'),
  'duplicate_in_day',
  'drugie zdarzenie z TEJ SAMEJ doby wystapienia jest duplikatem, choc dotarlo pozniej'
);

SELECT is(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca',
     '5a444444-4444-4444-4444-4444444444aa', 'open', NULL,
     '2026-08-11 00:01:00+00'::timestamptz) ->> 'recorded'),
  'true',
  'zdarzenie zza polnocy UTC to inna doba - zapisuje sie mimo laczonej dostawy'
);

SELECT ok(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca',
     '5a444444-4444-4444-4444-4444444444aa', 'click', NULL,
     (now() + interval '5 days')::timestamptz) ->> 'event_day')::date
  <= (now() AT TIME ZONE 'UTC')::date,
  'czas z przyszlosci jest scinany do teraz - przestawiony zegar dostawcy nie zaklada kubelkow w przod'
);

SELECT is(
  (public.newsletter_record_campaign_event(
     'ca111111-1111-1111-1111-1111111111ca',
     '5a222222-2222-2222-2222-2222222222aa', 'click', NULL, NULL) ->> 'event_day'),
  (now() AT TIME ZONE 'UTC')::date::text,
  'NULL = teraz (sciezka pikselu i przekierowania, ktore pisza w chwili zdarzenia)'
);

-- Stary, 4-argumentowy wariant nie moze zostac w bazie obok nowego: dwa
-- przeciazenia znaczylyby, ze czesc wywolan po cichu omija czas wystapienia.
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'newsletter_record_campaign_event'),
  1,
  'RPC zapisu ma DOKLADNIE jedno przeciazenie'
);

-- ---------------------------------------------------------------------------
-- 5) Odczyt panelu: zasieg unikalny != liczba zdarzen
-- ---------------------------------------------------------------------------
-- Bez auth.uid() bramka roli musi odmowic - inaczej RPC byloby furtka na
-- kazdy obszar roboczy dla dowolnego wywolania spoza sesji uzytkownika.
SELECT throws_ok(
  $$ SELECT * FROM public.newsletter_campaign_engagement('ca111111-1111-1111-1111-1111111111ca') $$,
  '42501',
  NULL,
  'odczyt zaangazowania bez zalogowanego staffa jest odrzucany'
);

SELECT * FROM finish();
ROLLBACK;
