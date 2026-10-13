-- ============================================================================
-- 78 DOMKNIECIE PRZEKAZAN MIEDZY STRUMIENIAMI AUDYTU OPS (B3)
--
-- PO CO TEN PLIK ISTNIEJE
-- Dwa defekty wykryte przez strumienie S1 i S2, ale lezace poza ich zakresem:
--
--   1. `event_package_invite_accept` padal przy KAZDYM wywolaniu (23514):
--      zrodlo `package_invitation` spoza list CHECK osoby i zgloszenia oraz
--      e-mail zaproszenia zostawiany bez tokenu (`event_package_seats_
--      invite_pair`). S1 zarejestrowal to w 33_* jako `assert_known_defect`
--      i sprawdzal zgody po zdjeciu obu ograniczen. Migracja 20261012140000
--      dopisuje `package_invitation` do obu list i zeruje e-mail razem
--      z tokenem. Tu: przyjecie na NIETKNIETYCH ograniczeniach, ksztalt
--      miejsca po przyjeciu, jednorazowosc tokenu, gwarancja S1 (przyjecie
--      nie czysci `consent_withdrawn_at`, nie nadaje zgody partnerskiej),
--      widok panelu, usuniecie zgloszenia (RODO) zwracajace miejsce do puli
--      i druga strona: ograniczenia nadal odrzucaja to, co mialy odrzucac.
--   2. `admin_event_session_delete` po S2 (`event_checkpoints_session_fk`
--      NO ACTION) konczyl sie surowym 23503 dla sesji z punktem odprawy.
--      Migracja 20261012140100 dodaje jawny kod `session_has_checkpoints`.
--      Tu: odmowa dla punktu na sesji i na PODSESJI (kaskada), liczba
--      punktow w komunikacie, pierwszenstwo `session_has_signups`, punkt
--      wylaczony tez blokuje, izolacja najemcy, kontrapunkt po usunieciu
--      punktu.
--
-- CZEGO NIE SPRAWDZA: strony klienta (mapowanie kodu na zdanie PL/EN siedzi
-- w vitest: `adminAgendaErrors.test.ts`).
--
-- SPRZATANIE. Jedna transakcja zakonczona ROLLBACK-iem.
-- ============================================================================

\echo '== 78 domkniecie przekazan OPS: zaproszenie z pakietu, usuniecie sesji =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 0: SCENOGRAFIA
--
-- Najemca A = publiczny najemca harnessu (1111...), najemca B do izolacji.
-- a1 admin A, b1 admin B. Wydarzenie P (pakiet), wydarzenie S (sesje).
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('78000000-0000-0000-0000-0000000000b0', 'Tenant B (78)', 'tb-ops78');

INSERT INTO auth.users (id, email) VALUES
  ('78a00000-0000-0000-0000-0000000000a1', 'ops78.admin@example.org'),
  ('78a00000-0000-0000-0000-0000000000b1', 'ops78.admin.b@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('78a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111'),
  ('78a00000-0000-0000-0000-0000000000b1', 'admin', '78000000-0000-0000-0000-0000000000b0')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('78a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('78a00000-0000-0000-0000-0000000000b1', '78000000-0000-0000-0000-0000000000b0')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status,
   registration_mode, registration_flow)
VALUES
  ('78e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'ops78-pakiet', 'Kongres z pakietem', 'Package congress',
   now() + interval '6 days', now() + interval '7 days', 'Europe/Warsaw',
   'published', 'form', 'instant'),
  ('78e00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'ops78-sesje', 'Kongres z sesjami', 'Session congress',
   now() + interval '10 days', now() + interval '11 days', 'Europe/Warsaw',
   'published', 'rsvp', 'instant');

-- ---------------------------------------------------------------------------
-- SEKCJA 1: PRZYJECIE ZAPROSZENIA Z PAKIETU (20261012140000)
-- ---------------------------------------------------------------------------
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en)
VALUES ('78700000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
        '78e00000-0000-0000-0000-0000000000a1', 'pakietowy', 'Pakietowy', 'Package');
INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, seats)
VALUES ('78900000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
        '78e00000-0000-0000-0000-0000000000a1', '78700000-0000-0000-0000-0000000000a1',
        'firma', 'Pakiet firmowy', 'Company package', 3);
INSERT INTO public.event_package_orders
  (id, tenant_id, event_id, package_id, buyer_email, seats_total, status, paid_at)
VALUES ('78800000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
        '78e00000-0000-0000-0000-0000000000a1', '78900000-0000-0000-0000-0000000000a1',
        'kupujacy.78@example.org', 3, 'paid', now());

-- Miejsce N: zaproszenie dla adresu, ktorego kartoteka nie zna (nowa osoba).
-- Miejsce W: zaproszenie dla osoby, ktora wczesniej WYCOFALA zgody.
-- Miejsce Z: zaproszenie, ktore zostaje niezuzyte (para nadal e-mail + token).
INSERT INTO public.event_package_seats
  (id, tenant_id, event_id, package_order_id, invite_email, invite_name,
   invite_token_hash, invite_sent_at, invite_expires_at)
VALUES
  ('78600000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a1', '78800000-0000-0000-0000-0000000000a1',
   'nowa.78@example.org', 'Nowa',
   encode(extensions.digest('zaproszenie-78-nowa-00000001', 'sha256'), 'hex'),
   now() - interval '1 day', now() + interval '29 days'),
  ('78600000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a1', '78800000-0000-0000-0000-0000000000a1',
   'wycofana.78@example.org', 'Wycofana',
   encode(extensions.digest('zaproszenie-78-wycofana-0001', 'sha256'), 'hex'),
   now() - interval '1 day', now() + interval '29 days'),
  ('78600000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a1', '78800000-0000-0000-0000-0000000000a1',
   'czeka.78@example.org', 'Czeka',
   encode(extensions.digest('zaproszenie-78-czeka-0000001', 'sha256'), 'hex'),
   now() - interval '1 day', now() + interval '29 days');

-- Osoba z wycofaniem: zgoda marketingowa i partnerska nadane, potem wycofane.
INSERT INTO public.event_people
  (id, tenant_id, email, first_name, last_name, source,
   consent_data_processing_at, consent_marketing_at, consent_partner_sharing_at,
   consent_withdrawn_at)
VALUES ('78b00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
        'wycofana.78@example.org', 'Wanda', 'Wycofana', 'self_registration',
        now() - interval '30 days', now() - interval '30 days', now() - interval '30 days',
        now() - interval '10 days');

-- Przyjecie biegnie jako ANONIM (link z maila), dokladnie jak na produkcji.
SELECT pg_temp.act_as(NULL, NULL);

CREATE TEMP TABLE z78_q (k text PRIMARY KEY, u uuid) ON COMMIT DROP;

DO $do$
DECLARE
  v jsonb;
  v_reg uuid;
  v_person uuid;
BEGIN
  v := public.event_package_invite_accept(jsonb_build_object(
    'token', 'zaproszenie-78-nowa-00000001', 'first_name', 'Nina', 'last_name', 'Nowa',
    'job_title', 'Analityczka', 'consent_data_processing', true));
  v_reg := (v->>'registration_id')::uuid;
  INSERT INTO z78_q VALUES ('reg_nowa', v_reg);

  PERFORM pg_temp.assert(
    v_reg IS NOT NULL AND v->>'status' = 'approved'
    AND v->>'event_id' = '78e00000-0000-0000-0000-0000000000a1'
    AND length(v->>'qr_token') > 20 AND length(v->>'manage_token') > 20,
    '78/pakiet: przyjecie zaproszenia przechodzi na nietknietych ograniczeniach i oddaje zgloszenie z kodami');

  SELECT r.person_id INTO v_person FROM public.event_registrations r WHERE r.id = v_reg;
  INSERT INTO z78_q VALUES ('person_nowa', v_person);

  PERFORM pg_temp.assert(
    (SELECT r.source = 'package_invitation' AND r.status = 'approved'
            AND r.decision_source = 'system' AND r.ticket_type_id = '78700000-0000-0000-0000-0000000000a1'
            AND r.consent_partner_sharing_at IS NULL
       FROM public.event_registrations r WHERE r.id = v_reg),
    '78/pakiet: zgloszenie ma zrodlo package_invitation, bilet pakietu i brak zgody partnerskiej');

  PERFORM pg_temp.assert(
    (SELECT p.source = 'package_invitation' AND p.email_norm = 'nowa.78@example.org'
            AND p.first_name = 'Nina' AND p.consent_data_processing_at IS NOT NULL
            AND p.consent_marketing_at IS NULL AND p.consent_partner_sharing_at IS NULL
       FROM public.event_people p WHERE p.id = v_person),
    '78/pakiet: nowa osoba ma zrodlo package_invitation, adres z zaproszenia i tylko zgode na przetwarzanie');

  PERFORM pg_temp.assert(
    (SELECT s.registration_id = v_reg AND s.assigned_at IS NOT NULL
            AND s.invite_token_hash IS NULL AND s.invite_email IS NULL
            AND s.invite_sent_at IS NOT NULL AND s.invite_expires_at IS NOT NULL
            AND s.invite_name = 'Nowa' AND s.revoked_at IS NULL
       FROM public.event_package_seats s WHERE s.id = '78600000-0000-0000-0000-0000000000a1'),
    '78/pakiet: zuzyte miejsce traci token I e-mail naraz, zachowuje os czasu zaproszenia');

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.domain_events d
      WHERE d.aggregate_id = v_reg::text
        AND d.event_type = 'event.registration.created.v1'
        AND d.payload->>'source' = 'package_invitation') = 1,
    '78/pakiet: zdarzenie domenowe utworzenia zgloszenia niesie zrodlo package_invitation');
END
$do$;

-- Jednorazowosc: skrot tokenu zniknal, wiec drugie uzycie linku to zly token.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_package_invite_accept(jsonb_build_object(
       'token', 'zaproszenie-78-nowa-00000001', 'first_name', 'Nina', 'last_name', 'Nowa',
       'consent_data_processing', true))$q$,
  'invalid_token',
  '78/pakiet/ODMOWA: drugie uzycie tego samego linku zaproszenia');

-- GWARANCJA S1 (OPS-01): przyjecie przez osobe z wycofaniem nie czysci
-- wycofania, nie odswieza zgody marketingowej i nie nadaje partnerskiej.
DO $do$
DECLARE
  v jsonb;
  v_person uuid := '78b00000-0000-0000-0000-0000000000a2';
  v_before public.event_people;
BEGIN
  SELECT * INTO v_before FROM public.event_people p WHERE p.id = v_person;
  v := public.event_package_invite_accept(jsonb_build_object(
    'token', 'zaproszenie-78-wycofana-0001', 'first_name', 'Wanda', 'last_name', 'Wycofana',
    'consent_data_processing', true));
  INSERT INTO z78_q VALUES ('reg_wycofana', (v->>'registration_id')::uuid);

  PERFORM pg_temp.assert(
    (SELECT r.person_id = v_person AND r.source = 'package_invitation'
       FROM public.event_registrations r WHERE r.id = (v->>'registration_id')::uuid),
    '78/pakiet: zaproszenie na adres z kartoteki trafia do ISTNIEJACEJ osoby');
  PERFORM pg_temp.assert(
    (SELECT p.consent_withdrawn_at = v_before.consent_withdrawn_at
            AND p.consent_marketing_at = v_before.consent_marketing_at
            AND p.consent_partner_sharing_at = v_before.consent_partner_sharing_at
            AND p.source = 'self_registration'
       FROM public.event_people p WHERE p.id = v_person),
    '78/pakiet: przyjecie NIE czysci consent_withdrawn_at i nie rusza stempli zgod ani zrodla osoby');
  PERFORM pg_temp.assert(
    public._event_partner_consent_at('11111111-1111-1111-1111-111111111111',
                                     '78e00000-0000-0000-0000-0000000000a1', v_person) IS NULL,
    '78/pakiet: osoba z wycofaniem nie ma po przyjeciu skutecznej zgody partnerskiej');
END
$do$;

-- Widok organizatora: przypisane miejsca bez adresu, czekajace z adresem.
SELECT pg_temp.act_as('78a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (SELECT count(*) FILTER (WHERE l.state = 'assigned' AND l.invite_email IS NULL
                             AND l.attendee_name IN ('Nina Nowa', 'Wanda Wycofana')) = 2
      AND count(*) FILTER (WHERE l.state = 'invited' AND l.invite_email = 'czeka.78@example.org') = 1
     FROM public.admin_event_package_seats_list('78800000-0000-0000-0000-0000000000a1') l),
  '78/pakiet/panel: dwa miejsca przypisane (imie i nazwisko, bez adresu) i jedno czekajace z adresem');
SELECT pg_temp.assert(
  (SELECT o.seats_invited = 1
     FROM public.admin_event_package_orders_list('78e00000-0000-0000-0000-0000000000a1') o
    WHERE o.id = '78800000-0000-0000-0000-0000000000a1'),
  '78/pakiet/panel: licznik zaproszen liczy tylko niezuzyte zaproszenie');

-- RODO: usuniecie zgloszenia zwraca miejsce do puli kupujacego (S2:
-- ON DELETE SET NULL (registration_id) + wyzwalacz stempla) bez kolizji
-- z para e-mail/token - zuzyte miejsce adresu juz nie ma.
SELECT pg_temp.act_as(NULL, NULL);
DELETE FROM public.event_registrations r WHERE r.id = (SELECT u FROM z78_q WHERE k = 'reg_nowa');
SELECT pg_temp.assert(
  (SELECT s.registration_id IS NULL AND s.assigned_at IS NULL
          AND s.invite_email IS NULL AND s.invite_token_hash IS NULL
     FROM public.event_package_seats s WHERE s.id = '78600000-0000-0000-0000-0000000000a1'),
  '78/pakiet: usuniecie zgloszenia zwalnia zuzyte miejsce bez naruszenia pary e-mail/token');

-- DRUGA STRONA: ograniczenia nie zostaly poluzowane ponad potrzebe.
SELECT pg_temp.assert(
  pg_get_constraintdef((SELECT c.oid FROM pg_constraint c
                         WHERE c.conname = 'event_package_seats_invite_pair'
                           AND c.conrelid = 'public.event_package_seats'::regclass))
    = 'CHECK (((invite_email IS NULL) = (invite_token_hash IS NULL)))',
  '78/pakiet: para e-mail/token zostaje scisla (bez wyjatku dla zuzytego miejsca)');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_package_seats SET invite_token_hash = NULL
      WHERE id = '78600000-0000-0000-0000-0000000000a3'$q$,
  'event_package_seats_invite_pair',
  '78/pakiet/ODMOWA: e-mail zaproszenia bez tokenu nadal jest odrzucany');
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_people (tenant_id, email, first_name, last_name, source)
     VALUES ('11111111-1111-1111-1111-111111111111', 'zrodlo.78@example.org', 'Zla', 'Wartosc',
             'package')$q$,
  'event_people_source_values',
  '78/pakiet/ODMOWA: zrodlo osoby spoza listy nadal jest odrzucane');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_registrations SET source = 'package'
      WHERE id = (SELECT u FROM z78_q WHERE k = 'reg_wycofana')$q$,
  'event_registrations_source_values',
  '78/pakiet/ODMOWA: zrodlo zgloszenia spoza listy nadal jest odrzucane');
SELECT pg_temp.assert(
  (SELECT bool_and(pg_get_constraintdef(c.oid) LIKE '%''package_invitation''%'
                   AND pg_get_constraintdef(c.oid) LIKE '%''self_registration''%'
                   AND pg_get_constraintdef(c.oid) LIKE '%''scan''%')
          AND count(*) = 2
     FROM pg_constraint c
    WHERE c.conname IN ('event_people_source_values', 'event_registrations_source_values')),
  '78/pakiet: obie listy zrodla maja package_invitation obok siedmiu dawnych wartosci');

SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_package_invite_accept(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_package_invite_accept(jsonb)', 'EXECUTE')
  AND (SELECT p.prosecdef
              AND p.proconfig @> ARRAY['search_path=public, pg_temp']
         FROM pg_proc p
        WHERE p.oid = 'public.event_package_invite_accept(jsonb)'::regprocedure),
  '78/pakiet/granty: link z maila dziala dla anonima, funkcja DEFINER z search_path public, pg_temp');

-- ---------------------------------------------------------------------------
-- SEKCJA 2: USUNIECIE SESJI Z PUNKTEM ODPRAWY (20261012140100)
-- ---------------------------------------------------------------------------
-- Blok K (z podsesja K1), sesja P z punktem, sesja Z z zapisem i punktem,
-- sesja L bez niczego (kontrapunkt).
INSERT INTO public.event_sessions
  (id, tenant_id, event_id, parent_session_id, title_pl, title_en, starts_at, ends_at,
   status, requires_signup, sort_order)
VALUES
  ('78500000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a2', NULL, 'Blok K', 'Block K',
   now() + interval '10 days 1 hour', now() + interval '10 days 4 hours', 'published', false, 10),
  ('78500000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a2', '78500000-0000-0000-0000-0000000000a1',
   'Podsesja K1', 'Sub-session K1',
   now() + interval '10 days 1 hour', now() + interval '10 days 2 hours', 'published', false, 11),
  ('78500000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a2', NULL, 'Sesja P', 'Session P',
   now() + interval '10 days 5 hours', now() + interval '10 days 6 hours', 'published', false, 20),
  ('78500000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a2', NULL, 'Sesja Z', 'Session Z',
   now() + interval '10 days 7 hours', now() + interval '10 days 8 hours', 'published', true, 30),
  ('78500000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a2', NULL, 'Sesja L', 'Session L',
   now() + interval '10 days 9 hours', now() + interval '10 days 10 hours', 'published', false, 40);

INSERT INTO public.event_checkpoints
  (id, tenant_id, event_id, name_pl, name_en, kind, session_id, is_active)
VALUES
  ('78c00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a2', 'Wejscie K1', 'K1 door', 'session',
   '78500000-0000-0000-0000-0000000000a2', true),
  ('78c00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a2', 'Wejscie P', 'P door', 'session',
   '78500000-0000-0000-0000-0000000000a3', true),
  ('78c00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a2', 'Wejscie P boczne', 'P side door', 'session',
   '78500000-0000-0000-0000-0000000000a3', false),
  ('78c00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111',
   '78e00000-0000-0000-0000-0000000000a2', 'Wejscie Z', 'Z door', 'session',
   '78500000-0000-0000-0000-0000000000a4', true);

-- Aktywny zapis na sesje Z (wiersz wprost - jak w 10_sessions, sekcja 15).
INSERT INTO auth.users (id, email) VALUES
  ('78a00000-0000-0000-0000-0000000000c1', 'ops78.uczestnik@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id)
VALUES ('11111111-1111-1111-1111-111111111111', '78e00000-0000-0000-0000-0000000000a2',
        '78500000-0000-0000-0000-0000000000a4', '78a00000-0000-0000-0000-0000000000c1');

SELECT pg_temp.act_as('78a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

-- Pierwszenstwo: sesja z zapisami ma byc odwolana - to zdanie wygrywa
-- z punktem odprawy, ktory tez ma.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_delete('78500000-0000-0000-0000-0000000000a4')$q$,
  'session_has_signups: 1 active signup',
  '78/sesje/ODMOWA: zapisy wygrywaja z punktem odprawy (droga to odwolanie sesji)');

-- Dwa punkty na sesji P, w tym WYLACZONY - klucz obcy nie zna wylaczenia.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_delete('78500000-0000-0000-0000-0000000000a3')$q$,
  'session_has_checkpoints: 2 checkpoint(s)',
  '78/sesje/ODMOWA: sesja z punktami odprawy (takze wylaczonym) - jawny kod z liczba, nie 23503');

-- Punkt na PODSESJI blokuje blok nadrzedny: podsesja zniknelaby kaskada.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_delete('78500000-0000-0000-0000-0000000000a1')$q$,
  'session_has_checkpoints: 1 checkpoint(s)',
  '78/sesje/ODMOWA: punkt odprawy podsesji blokuje usuniecie bloku nadrzednego');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_delete('78500000-0000-0000-0000-0000000000a2')$q$,
  'session_has_checkpoints: 1 checkpoint(s)',
  '78/sesje/ODMOWA: punkt odprawy blokuje usuniecie samej podsesji');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE event_id = '78e00000-0000-0000-0000-0000000000a2') = 5
  AND (SELECT count(*) FROM public.event_checkpoints
        WHERE event_id = '78e00000-0000-0000-0000-0000000000a2') = 4,
  '78/sesje: odmowy niczego nie usunely (sesje i punkty na miejscu)');

-- Izolacja: administrator innego najemcy dostaje `not_found`, a nie wiedze
-- o punktach odprawy cudzej sesji.
SELECT pg_temp.act_as('78a00000-0000-0000-0000-0000000000b1', '78000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_delete('78500000-0000-0000-0000-0000000000a3')$q$,
  'not_found',
  '78/sesje/IZOLACJA: obcy najemca nie usunie sesji i nie dowie sie o jej punktach');

SELECT pg_temp.act_as('78a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

-- Kontrapunkty: sesja bez punktow i zapisow znika; po zmianie rodzaju punktu
-- podsesji blok znika razem z podsesja (kaskada), a punkt zostaje strefa.
SELECT pg_temp.assert(
  public.admin_event_session_delete('78500000-0000-0000-0000-0000000000a5'),
  '78/sesje: sesje bez punktow i zapisow da sie usunac (kontrapunkt)');

UPDATE public.event_checkpoints SET kind = 'zone', session_id = NULL
 WHERE id = '78c00000-0000-0000-0000-0000000000a2';
SELECT pg_temp.assert(
  public.admin_event_session_delete('78500000-0000-0000-0000-0000000000a1'),
  '78/sesje: po zmianie rodzaju punktu podsesji blok da sie usunac');
-- Osobna instrukcja: migawka zapytania sprzed wywolania funkcji nie widzi
-- jej DELETE, wiec sprawdzenie w tym samym SELECT-cie widzialoby stary stan.
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_sessions
               WHERE id IN ('78500000-0000-0000-0000-0000000000a1',
                            '78500000-0000-0000-0000-0000000000a2'))
  AND EXISTS (SELECT 1 FROM public.event_checkpoints
               WHERE id = '78c00000-0000-0000-0000-0000000000a2' AND kind = 'zone'),
  '78/sesje: blok znika razem z podsesja (kaskada), punkt zostaje strefa');

DELETE FROM public.event_checkpoints
 WHERE id IN ('78c00000-0000-0000-0000-0000000000a3', '78c00000-0000-0000-0000-0000000000a4');
SELECT pg_temp.assert(
  public.admin_event_session_delete('78500000-0000-0000-0000-0000000000a3'),
  '78/sesje: po usunieciu punktow sesja P da sie usunac');

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_session_delete(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_session_delete(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.admin_event_session_delete(uuid)', 'EXECUTE')
  AND (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
         FROM pg_proc p WHERE p.oid = 'public.admin_event_session_delete(uuid)'::regprocedure),
  '78/sesje/granty: ACL bez zmian (anon nie, authenticated i service_role tak), DEFINER z search_path');

SELECT pg_temp.act_as(NULL, NULL);

ROLLBACK;

\echo '== 78 domkniecie przekazan OPS: koniec =='
