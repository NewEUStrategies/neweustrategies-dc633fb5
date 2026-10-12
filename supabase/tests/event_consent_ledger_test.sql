-- pgTAP: rejestr zgod uczestnikow wydarzen (REG-02 / REG-14, infrastruktura)
-- - migracje 20261012100100_event_consent_ledger,
-- 20261012100200_event_consent_helpers i
-- 20261012100300_event_person_crm_sync_consent_ledger.
--
-- DEFEKT. Zgody osoby byly golymi stemplami w `event_people`, ktore stawial
-- kazdy, kto wpisal cudzy adres w formularz; wycofania nie pisal nikt, a most
-- CRM przy kazdym wywolaniu przepisywal stempel na `marketing_consent = true`
-- (zgoda w CRM tylko rosla, wycofanie nigdy tam nie docieralo).
--
-- CO PRZYPINA:
--   * ACL - funkcje rejestru tylko dla service_role, potwierdzenia DOI
--     niewidoczne dla klienta, ksiega bez zapisu z klienta i bez poprawiania
--     nawet kluczem serwisowym;
--   * ksiega jest append-only (UPDATE/TRUNCATE rzucaja `append_only`, akcja
--     ON DELETE SET NULL kluczy obcych przechodzi), a kazdy z czterech
--     CHECK-ow inwariantow odrzuca swoj zakazany wiersz;
--   * udzielenie: formularz nie udzieli marketingu (CHECK), kanal konta
--     projektuje zgode, ale nie zdejmuje wycofania; DOI zdejmuje wycofanie
--     i nie wskrzesza celu spoza linku;
--   * link DOI: w bazie tylko sha256, token 32 znaki, nowy zastepuje stary;
--   * wycofanie: projekcja, `consent_withdrawn_at`, zastapienie linkow,
--     CRM `marketing_consent = false` + wiersz given=false;
--   * KRYTERIUM REG-14: po wycofaniu most CRM nie przywraca zgody - takze gdy
--     stary pisarz ponownie postawi stempel, i takze po wycofaniu po stronie
--     CRM (given=false spoza modulu);
--   * spadek `legacy_single_opt_in` i zachowanie mostu dla osob bez ksiegi;
--   * `event_registrations.submitted_profile`: tylko obiekt, najwyzej 4000
--     znakow (odmowa, nie przyciecie);
--   * RLS: wlasciciel czyta swoja ksiege, admin najemcy swoja, nikt cudzej;
--   * wersje tekstu wycofuje sie z uzycia raz, a wycofana dalej jest dowodem.
--
-- now() jest stale w transakcji - kolejnosc wpisow niesie `seq`.
BEGIN;
SELECT plan(95);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Fikstury ────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('ec0a0000-0000-0000-0000-0000000000aa', 'ecl-a', 'Consent Ledger A', 'ecl-a.example'),
  ('ec0b0000-0000-0000-0000-0000000000bb', 'ecl-b', 'Consent Ledger B', 'ecl-b.example');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('ec000000-0000-0000-0000-0000000000a1', 'owner@ecl.example', now()),
  ('ec000000-0000-0000-0000-0000000000a2', 'admin@ecl.example', now()),
  ('ec000000-0000-0000-0000-0000000000a3', 'other@ecl.example', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('ec000000-0000-0000-0000-0000000000a1', 'owner@ecl.example', 'ECL Owner', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000a2', 'admin@ecl.example', 'ECL Admin', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000a3', 'other@ecl.example', 'ECL Other', 'ec0a0000-0000-0000-0000-0000000000aa');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('ec000000-0000-0000-0000-0000000000a2', 'admin', 'ec0a0000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('ec100000-0000-0000-0000-0000000000e1', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ecl-event', 'ECL', 'ECL', '2030-06-10 08:00+00', 'published'),
  ('ec100000-0000-0000-0000-0000000000e2', 'ec0b0000-0000-0000-0000-0000000000bb',
   'ecl-event-b', 'ECL B', 'ECL B', '2030-06-10 08:00+00', 'published');

-- P1 wlasciciel konta; P2 wycofal wszystko (stary stempel partnerow zostal
-- obok wycofania - ksztalt danych sprzed ksiegi); P3 zgody sprzed ksiegi;
-- P4 bez adresu; P6 bez zgod; P9 w drugim najemcy.
INSERT INTO public.event_people
  (id, tenant_id, user_id, email, first_name, last_name, consent_data_processing_at,
   consent_marketing_at, consent_partner_sharing_at, consent_withdrawn_at) VALUES
  ('ec300000-0000-0000-0000-000000000001', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ec000000-0000-0000-0000-0000000000a1', 'owner@ecl.example', 'Ola', 'Owner',
   '2026-01-01 10:00+00', NULL, NULL, NULL),
  ('ec300000-0000-0000-0000-000000000002', 'ec0a0000-0000-0000-0000-0000000000aa',
   NULL, 'withdrawn@ecl.example', 'Wiktor', 'Withdrawn',
   '2026-01-01 10:00+00', NULL, '2026-01-10 10:00+00', '2026-02-01 10:00+00'),
  ('ec300000-0000-0000-0000-000000000003', 'ec0a0000-0000-0000-0000-0000000000aa',
   NULL, 'legacy@ecl.example', 'Lena', 'Legacy',
   '2026-01-15 10:00+00', '2026-01-15 10:00+00', '2026-01-15 10:00+00', NULL),
  ('ec300000-0000-0000-0000-000000000004', 'ec0a0000-0000-0000-0000-0000000000aa',
   NULL, NULL, 'Nina', 'Noemail',
   '2026-01-20 10:00+00', '2026-01-20 10:00+00', NULL, NULL),
  ('ec300000-0000-0000-0000-000000000006', 'ec0a0000-0000-0000-0000-0000000000aa',
   NULL, 'fresh@ecl.example', 'Filip', 'Fresh',
   NULL, NULL, NULL, NULL),
  ('ec300000-0000-0000-0000-000000000009', 'ec0b0000-0000-0000-0000-0000000000bb',
   NULL, 'tenant-b@ecl.example', 'Bea', 'Other',
   NULL, NULL, NULL, NULL);

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, registration_mode) VALUES
  ('ec400000-0000-0000-0000-000000000001', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ec100000-0000-0000-0000-0000000000e1', 'ec300000-0000-0000-0000-000000000001', 'rsvp'),
  ('ec400000-0000-0000-0000-000000000002', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ec100000-0000-0000-0000-0000000000e1', 'ec300000-0000-0000-0000-000000000002', 'rsvp'),
  ('ec400000-0000-0000-0000-000000000003', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ec100000-0000-0000-0000-0000000000e1', 'ec300000-0000-0000-0000-000000000003', 'rsvp'),
  ('ec400000-0000-0000-0000-000000000006', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ec100000-0000-0000-0000-0000000000e1', 'ec300000-0000-0000-0000-000000000006', 'rsvp'),
  ('ec400000-0000-0000-0000-000000000009', 'ec0b0000-0000-0000-0000-0000000000bb',
   'ec100000-0000-0000-0000-0000000000e2', 'ec300000-0000-0000-0000-000000000009', 'rsvp');

-- Kontakt CRM osoby ze spadkiem - zgoda jeszcze zgaszona (most ja podniesie).
INSERT INTO public.crm_leads (tenant_id, email, email_norm, marketing_consent) VALUES
  ('ec0a0000-0000-0000-0000-0000000000aa', 'legacy@ecl.example', 'legacy@ecl.example', false);

CREATE TEMP TABLE _ecl_tok (k text PRIMARY KEY, token text NOT NULL) ON COMMIT DROP;

-- ── 1-13. Uprawnienia ────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_consent_text_check(text,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_consent_text_check(text,integer,text)', 'EXECUTE'),
  '_event_consent_text_check: bez EXECUTE dla klienta');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_person_consents_confirm(uuid,uuid,text[],text,uuid,uuid,uuid,integer,text,text,text,uuid,text,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_person_consents_confirm(uuid,uuid,text[],text,uuid,uuid,uuid,integer,text,text,text,uuid,text,boolean)', 'EXECUTE'),
  '_event_person_consents_confirm: bez EXECUTE dla klienta');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_consent_issue_confirmation(uuid,uuid,text[],uuid,uuid,integer,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_consent_issue_confirmation(uuid,uuid,text[],uuid,uuid,integer,text,text,text)', 'EXECUTE'),
  '_event_consent_issue_confirmation: bez EXECUTE dla klienta');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_person_consents_withdraw(uuid,uuid,text[],text,text,text,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_person_consents_withdraw(uuid,uuid,text[],text,text,text,uuid,text)', 'EXECUTE'),
  '_event_person_consents_withdraw: bez EXECUTE dla klienta');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_person_consent_crm_withdraw(uuid,uuid,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_person_consent_crm_withdraw(uuid,uuid,text,text,text)', 'EXECUTE'),
  '_event_person_consent_crm_withdraw: bez EXECUTE dla klienta');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_consent_withdraw_by_email(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_consent_withdraw_by_email(uuid,text,text)', 'EXECUTE'),
  '_event_consent_withdraw_by_email: bez EXECUTE dla klienta');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_person_crm_sync(uuid,uuid,text,text,text[],jsonb,boolean,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_person_crm_sync(uuid,uuid,text,text,text[],jsonb,boolean,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_consent_backfill_legacy()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_consent_backfill_legacy()', 'EXECUTE'),
  'most CRM i spadek: bez EXECUTE dla klienta (granty mostu bez zmian)');
SELECT ok(
  has_function_privilege('service_role', 'public._event_consent_text_check(text,integer,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_person_consents_confirm(uuid,uuid,text[],text,uuid,uuid,uuid,integer,text,text,text,uuid,text,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_consent_issue_confirmation(uuid,uuid,text[],uuid,uuid,integer,text,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_person_consents_withdraw(uuid,uuid,text[],text,text,text,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_person_consent_crm_withdraw(uuid,uuid,text,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_consent_withdraw_by_email(uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_person_crm_sync(uuid,uuid,text,text,text[],jsonb,boolean,text,jsonb)', 'EXECUTE'),
  'service_role zachowuje EXECUTE (serwer i funkcje SECURITY DEFINER)');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.event_consent_confirmations', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.event_consent_confirmations', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.event_consent_confirmations', 'INSERT'),
  'potwierdzenia DOI: zaden odczyt ani zapis klienta');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.event_consent_records', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.event_consent_records', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.event_consent_records', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.event_consent_records', 'TRUNCATE')
  AND NOT has_table_privilege('anon', 'public.event_consent_records', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.event_consent_records', 'INSERT'),
  'ksiega: authenticated bez zapisu, anon bez dostepu');
SELECT ok(has_table_privilege('authenticated', 'public.event_consent_records', 'SELECT'),
  'ksiega: authenticated czyta (zakres zawezaja polityki RLS)');
SELECT ok(
  NOT has_table_privilege('service_role', 'public.event_consent_records', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.event_consent_records', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.event_consent_records', 'TRUNCATE')
  AND has_table_privilege('service_role', 'public.event_consent_records', 'INSERT'),
  'ksiega: nawet service_role tylko dopisuje (bez UPDATE/DELETE/TRUNCATE)');
SELECT ok(
  has_table_privilege('anon', 'public.event_consent_texts', 'SELECT')
  AND has_table_privilege('authenticated', 'public.event_consent_texts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.event_consent_texts', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.event_consent_texts', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.event_consent_texts', 'UPDATE'),
  'teksty zgod: publiczny odczyt, zapis wylacznie migracja');

-- ── 14-17. Teksty ────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.event_consent_texts WHERE version = 1 AND retired_at IS NULL),
  6, 'wersja 1: trzy cele x dwa jezyki, obowiazujaca');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_consent_texts
               WHERE body_sha256 <> encode(extensions.digest(body, 'sha256'), 'hex')),
  'odcisk sha256 liczy baza i opisuje dokladnie zapisany tekst');
SELECT throws_like(
  $$UPDATE public.event_consent_texts SET body = 'Zmieniony po fakcie tekst zgody.'
     WHERE purpose = 'marketing' AND version = 1 AND lang = 'pl'$$,
  'append_only%', 'tresc opublikowanej wersji nie do zmiany');
SELECT throws_like(
  $$DELETE FROM public.event_consent_texts WHERE purpose = 'marketing' AND version = 1 AND lang = 'pl'$$,
  'append_only%', 'opublikowanej wersji nie da sie usunac');

-- ── 18-20. Spadek legacy_single_opt_in ───────────────────────────────────────
SELECT public._event_consent_backfill_legacy();
SELECT is(
  (SELECT count(*)::int FROM public.event_consent_records
    WHERE tenant_id = 'ec0a0000-0000-0000-0000-0000000000aa'),
  2, 'spadek: dwa wpisy (P3 marketing i partnerzy); wycofany P2 i P4 bez adresu pominieci');
SELECT ok(
  (SELECT bool_and(status = 'confirmed' AND evidence = 'legacy_single_opt_in'
                   AND created_at = '2026-01-15 10:00+00' AND email_norm = 'legacy@ecl.example'
                   AND text_version IS NULL)
     FROM public.event_consent_records
    WHERE person_id = 'ec300000-0000-0000-0000-000000000003'),
  'spadek: confirmed/legacy_single_opt_in z data stempla i adresem osoby');
SELECT is(public._event_consent_backfill_legacy(), 0, 'spadek idempotentny: drugie wywolanie nic nie dopisuje');

-- Osoby dopisane PO spadku (bez wpisow ksiegi): P5 - zgode wycofano po stronie
-- CRM (given=false spoza modulu), P7 - stary stempel bez zadnego wycofania.
INSERT INTO public.event_people
  (id, tenant_id, email, first_name, last_name, consent_data_processing_at, consent_marketing_at) VALUES
  ('ec300000-0000-0000-0000-000000000005', 'ec0a0000-0000-0000-0000-0000000000aa',
   'crmside@ecl.example', 'Cezary', 'Crmside', '2026-01-05 10:00+00', '2026-01-05 10:00+00'),
  ('ec300000-0000-0000-0000-000000000007', 'ec0a0000-0000-0000-0000-0000000000aa',
   'plain@ecl.example', 'Patrycja', 'Plain', '2026-01-05 10:00+00', '2026-01-05 10:00+00');
INSERT INTO public.crm_leads (tenant_id, email, email_norm, marketing_consent) VALUES
  ('ec0a0000-0000-0000-0000-0000000000aa', 'crmside@ecl.example', 'crmside@ecl.example', false);
INSERT INTO public.crm_consent_log
  (tenant_id, email, source_type, consent_key, consent_text, given, created_at) VALUES
  ('ec0a0000-0000-0000-0000-0000000000aa', 'crmside@ecl.example', 'newsletter',
   'marketing', 'Unsubscribed from the newsletter.', false, '2026-03-01 10:00+00');

-- ── 21-32. Append-only i inwarianty ──────────────────────────────────────────
SELECT throws_like(
  $$UPDATE public.event_consent_records SET status = 'withdrawn'
     WHERE person_id = 'ec300000-0000-0000-0000-000000000003'$$,
  'append_only%', 'UPDATE wpisu ksiegi rzuca append_only (takze wlascicielowi tabeli)');
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$UPDATE public.event_consent_records SET source = 'x'
     WHERE person_id = 'ec300000-0000-0000-0000-000000000003'$$,
  '42501', NULL, 'service_role nie ma nawet prawa UPDATE na ksiedze');
RESET ROLE;
SELECT throws_like($$TRUNCATE public.event_consent_records$$, 'append_only%',
  'TRUNCATE ksiegi rzuca append_only');

-- P6: zgoda na przetwarzanie danych zapisana BEZ projekcji (niezweryfikowany
-- zapis na istniejaca osobe), ze wskazaniem zgloszenia, ktore zaraz zniknie.
SELECT lives_ok(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000006',
      ARRAY['data_processing'], 'registration_form', NULL,
      'ec400000-0000-0000-0000-000000000006', NULL, 1, 'pl',
      'ip:' || repeat('a6', 16), 'pgtap/1.0', NULL, 'registration_form', false)$$,
  'data_processing z formularza (bez projekcji) przechodzi');
SELECT ok(
  (SELECT consent_data_processing_at IS NULL FROM public.event_people
    WHERE id = 'ec300000-0000-0000-0000-000000000006')
  AND (SELECT event_id = 'ec100000-0000-0000-0000-0000000000e1' AND status = 'confirmed'
         FROM public.event_consent_records WHERE person_id = 'ec300000-0000-0000-0000-000000000006'),
  'p_project = false: wpis ksiegi (z wydarzeniem ze zgloszenia), kartoteka nietknieta');
SELECT lives_ok(
  $$DELETE FROM public.event_registrations WHERE id = 'ec400000-0000-0000-0000-000000000006'$$,
  'usuniecie zgloszenia nie wywraca sie na straznikach ksiegi (ON DELETE SET NULL)');
SELECT ok(
  (SELECT registration_id IS NULL AND event_id = 'ec100000-0000-0000-0000-0000000000e1'
     FROM public.event_consent_records WHERE person_id = 'ec300000-0000-0000-0000-000000000006'),
  'akcja klucza obcego zeruje wylacznie odnosnik do zgloszenia, tresc wpisu zostaje');

SELECT throws_ok(
  $$INSERT INTO public.event_consent_records
      (tenant_id, person_id, email_norm, purpose, status, evidence, text_version, text_lang)
    VALUES ('ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000006',
            'fresh@ecl.example', 'marketing', 'confirmed', 'registration_form', 1, 'pl')$$,
  '23514',
  'new row for relation "event_consent_records" violates check constraint "event_consent_records_verified_grant"',
  'CHECK _verified_grant: marketing z samego formularza odrzucony');
SELECT throws_ok(
  $$INSERT INTO public.event_consent_records
      (tenant_id, person_id, email_norm, purpose, status, evidence, text_version, text_lang)
    VALUES ('ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000006',
            'fresh@ecl.example', 'marketing', 'pending', 'verified_account', 1, 'pl')$$,
  '23514',
  'new row for relation "event_consent_records" violates check constraint "event_consent_records_pending_channel"',
  'CHECK _pending_channel: prosba o potwierdzenie tylko z formularza');
SELECT throws_ok(
  $$INSERT INTO public.event_consent_records
      (tenant_id, person_id, email_norm, purpose, status, evidence)
    VALUES ('ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000006',
            'fresh@ecl.example', 'marketing', 'withdrawn', 'registration_form')$$,
  '23514',
  'new row for relation "event_consent_records" violates check constraint "event_consent_records_withdraw_channel"',
  'CHECK _withdraw_channel: wycofanie tylko kanalem wlasciciela');
SELECT throws_ok(
  $$INSERT INTO public.event_consent_records
      (tenant_id, person_id, email_norm, purpose, status, evidence)
    VALUES ('ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000006',
            'fresh@ecl.example', 'marketing', 'confirmed', 'verified_account')$$,
  '23514',
  'new row for relation "event_consent_records" violates check constraint "event_consent_records_text_for_grant"',
  'CHECK _text_for_grant: udzielenie bez wskazania tekstu odrzucone');
SELECT throws_ok(
  $$INSERT INTO public.event_consent_records
      (tenant_id, person_id, email_norm, purpose, status, evidence, text_version, text_lang)
    VALUES ('ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000006',
            'fresh@ecl.example', 'marketing', 'confirmed', 'verified_account', 99, 'pl')$$,
  '23503', NULL, 'klucz obcy tekstu: wersji, ktorej nie ma, nie da sie wskazac');

-- ── 33-48. Udzielenie ────────────────────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000001',
      ARRAY['marketing'], 'registration_form', NULL, 'ec400000-0000-0000-0000-000000000001',
      NULL, 1, 'pl', NULL, NULL, NULL, 'registration_form')$$,
  '23514',
  'new row for relation "event_consent_records" violates check constraint "event_consent_records_verified_grant"',
  'REG-02: marketing z dowodem registration_form jest niemozliwy takze przez funkcje (CHECK)');
SELECT throws_like(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000001',
      ARRAY['marketing'], 'verified_account', NULL, NULL, NULL, 99, 'pl', NULL, NULL, NULL, NULL)$$,
  'consent_text_unknown%', 'nieznana wersja tekstu: odmowa');
SELECT throws_like(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000001',
      ARRAY['marketing'], 'verified_account', NULL, NULL, NULL, 1, 'pl',
      'ip:10.0.0.1', NULL, NULL, NULL)$$,
  'invalid_payload%', 'surowy adres IP zamiast solonego skrotu: odmowa');
SELECT throws_like(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000001',
      ARRAY['marketing'], 'legacy_single_opt_in', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)$$,
  'invalid_consent_evidence%', 'spadku nie da sie dopisac funkcja (tylko migracja)');
SELECT throws_like(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000001',
      ARRAY['marketing'], 'verified_account', NULL, NULL, NULL, 1, 'pl', NULL, NULL, NULL, NULL, false)$$,
  'invalid_payload%', 'marketing bez projekcji odrzucony (ksiega = kartoteka)');
SELECT throws_like(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000001',
      ARRAY['marketing'], 'verified_account', NULL, 'ec400000-0000-0000-0000-000000000002',
      NULL, 1, 'pl', NULL, NULL, NULL, NULL)$$,
  'invalid_payload%', 'cudze zgloszenie jako okolicznosc zgody: odmowa');

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000001',
      ARRAY['partner_sharing', 'marketing', 'marketing'], 'verified_account',
      NULL, 'ec400000-0000-0000-0000-000000000001', NULL, 1, 'pl',
      'ip:' || repeat('a1', 16), 'pgtap/1.0', 'ec000000-0000-0000-0000-0000000000a1',
      'registration_form')$$,
  'service_role: wlasciciel konta (zweryfikowany adres) udziela marketingu i partnerow');
RESET ROLE;
SELECT ok(
  (SELECT consent_marketing_at IS NOT NULL AND consent_partner_sharing_at IS NOT NULL
          AND consent_withdrawn_at IS NULL
     FROM public.event_people WHERE id = 'ec300000-0000-0000-0000-000000000001'),
  'verified_account: projekcja obu celow w kartotece');
SELECT is(
  (SELECT count(*)::int FROM public.event_consent_records
    WHERE person_id = 'ec300000-0000-0000-0000-000000000001'
      AND status = 'confirmed' AND evidence = 'verified_account'
      AND ip_subject = 'ip:' || repeat('a1', 16) AND user_agent = 'pgtap/1.0'
      AND text_version = 1 AND text_lang = 'pl'
      AND event_id = 'ec100000-0000-0000-0000-0000000000e1'
      AND registration_id = 'ec400000-0000-0000-0000-000000000001'
      AND actor_user_id = 'ec000000-0000-0000-0000-0000000000a1'
      AND email_norm = 'owner@ecl.example'),
  2, 'po jednym wpisie na cel (bez duplikatu), z tekstem, IP i UA z serwera');

SELECT throws_like(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000002',
      ARRAY['marketing'], 'verified_account', NULL, 'ec400000-0000-0000-0000-000000000002',
      NULL, 1, 'pl', NULL, NULL, NULL, NULL)$$,
  'consent_withdrawn_requires_reconfirmation%',
  'kanal konta NIE zdejmuje globalnego wycofania (tylko DOI)');
SELECT ok(
  (SELECT consent_marketing_at IS NULL AND consent_withdrawn_at = '2026-02-01 10:00+00'
     FROM public.event_people WHERE id = 'ec300000-0000-0000-0000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE person_id = 'ec300000-0000-0000-0000-000000000002'),
  'odmowa: kartoteka i ksiega osoby wycofanej nietkniete');

SELECT lives_ok(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000006',
      ARRAY['data_processing'], 'registration_form', 'ec100000-0000-0000-0000-0000000000e1',
      NULL, NULL, 1, 'en', NULL, NULL, NULL, 'registration_form')$$,
  'data_processing z projekcja (nowa osoba albo wlasciciel)');
SELECT ok(
  (SELECT consent_data_processing_at IS NOT NULL FROM public.event_people
    WHERE id = 'ec300000-0000-0000-0000-000000000006'),
  'p_project = true: COALESCE(consent_data_processing_at, now())');

-- data_processing nie przesuwa istniejacego stempla i nie dotyka wycofania
-- (to podstawa obslugi zapisu, nie zgoda marketingowa).
SELECT lives_ok(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000001',
      ARRAY['data_processing'], 'verified_account', NULL, 'ec400000-0000-0000-0000-000000000001',
      NULL, 1, 'pl', NULL, NULL, 'ec000000-0000-0000-0000-0000000000a1', 'registration_form')$$,
  'data_processing kanalem konta u osoby z dawnym stemplem przechodzi');
SELECT lives_ok(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000002',
      ARRAY['data_processing'], 'registration_form', NULL, 'ec400000-0000-0000-0000-000000000002',
      NULL, 1, 'pl', NULL, NULL, NULL, 'registration_form')$$,
  'data_processing u osoby wycofanej przechodzi (bez consent_withdrawn_requires_reconfirmation)');
SELECT ok(
  (SELECT consent_data_processing_at = '2026-01-01 10:00+00' FROM public.event_people
    WHERE id = 'ec300000-0000-0000-0000-000000000001')
  AND (SELECT consent_data_processing_at = '2026-01-01 10:00+00'
              AND consent_withdrawn_at = '2026-02-01 10:00+00'
              AND consent_marketing_at IS NULL
              AND consent_partner_sharing_at = '2026-01-10 10:00+00'
         FROM public.event_people WHERE id = 'ec300000-0000-0000-0000-000000000002'),
  'data_processing: COALESCE nie przesuwa stempla; wycofanie i cele marketingowe nietkniete');

-- ── 49-59. Link DOI i potwierdzenie ──────────────────────────────────────────
INSERT INTO _ecl_tok (k, token)
SELECT 'p2-first', public._event_consent_issue_confirmation(
  'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000002',
  ARRAY['marketing'], NULL, 'ec400000-0000-0000-0000-000000000002', 1, 'pl',
  'ip:' || repeat('b2', 16), 'ua-b');
SELECT ok((SELECT token ~ '^[A-Za-z0-9_-]{32}$' FROM _ecl_tok WHERE k = 'p2-first'),
  'link DOI: jawny token 32 znaki base64url');
SELECT ok(
  (SELECT c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex')
          AND strpos(to_jsonb(c)::text, t.token) = 0
          AND c.email_norm = 'withdrawn@ecl.example'
          AND c.event_id = 'ec100000-0000-0000-0000-0000000000e1'
     FROM public.event_consent_confirmations c, _ecl_tok t
    WHERE t.k = 'p2-first' AND c.person_id = 'ec300000-0000-0000-0000-000000000002'),
  'w bazie wylacznie sha256 tokenu (jawnego nie ma w zadnej kolumnie)');
SELECT is(
  (SELECT count(*)::int FROM public.event_consent_records r
     JOIN public.event_consent_confirmations c ON c.id = r.confirmation_id
    WHERE r.person_id = 'ec300000-0000-0000-0000-000000000002'
      AND r.status = 'pending' AND r.evidence = 'registration_form' AND r.purpose = 'marketing'
      AND r.ip_subject = 'ip:' || repeat('b2', 16) AND r.user_agent = 'ua-b'),
  1, 'wydanie linku: wpis pending z formularza, przypiety do potwierdzenia');

INSERT INTO _ecl_tok (k, token)
SELECT 'p2-second', public._event_consent_issue_confirmation(
  'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000002',
  ARRAY['marketing'], NULL, 'ec400000-0000-0000-0000-000000000002', 1, 'pl',
  'ip:' || repeat('b2', 16), 'ua-b');
SELECT ok(
  (SELECT count(*) FROM public.event_consent_confirmations
    WHERE person_id = 'ec300000-0000-0000-0000-000000000002'
      AND confirmed_at IS NULL AND superseded_at IS NULL) = 1
  AND (SELECT c.superseded_at IS NOT NULL FROM public.event_consent_confirmations c, _ecl_tok t
        WHERE t.k = 'p2-first' AND c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex')),
  'nowy link zastepuje poprzedni: jeden otwarty na osobe');

SELECT throws_like(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000002',
      ARRAY['marketing'], 'email_double_opt_in', NULL, NULL,
      (SELECT c.id FROM public.event_consent_confirmations c, _ecl_tok t
        WHERE t.k = 'p2-first' AND c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex')),
      NULL, NULL, NULL, NULL, NULL, 'email_double_opt_in')$$,
  'invalid_payload%', 'DOI bez potwierdzonego linku (zastapiony, nieostemplowany): odmowa');

-- Potwierdzenie tak, jak robi to RPC z linku: najpierw stempel potwierdzenia.
UPDATE public.event_consent_confirmations c
   SET confirmed_at = now(), confirmed_ip_subject = 'ip:' || repeat('c3', 16), confirmed_user_agent = 'ua-c'
  FROM _ecl_tok t
 WHERE t.k = 'p2-second' AND c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex');
SELECT lives_ok(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000002',
      ARRAY['marketing'], 'email_double_opt_in', NULL, 'ec400000-0000-0000-0000-000000000002',
      (SELECT c.id FROM public.event_consent_confirmations c, _ecl_tok t
        WHERE t.k = 'p2-second' AND c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex')),
      NULL, NULL, 'ip:' || repeat('c3', 16), 'ua-c', NULL, 'email_double_opt_in')$$,
  'DOI z potwierdzonego linku przechodzi mimo wycofania');
SELECT ok(
  (SELECT consent_withdrawn_at IS NULL AND consent_marketing_at IS NOT NULL
          AND consent_partner_sharing_at IS NULL
     FROM public.event_people WHERE id = 'ec300000-0000-0000-0000-000000000002'),
  'DOI zdejmuje wycofanie i NIE wskrzesza starego stempla partnerow (spoza linku)');
SELECT is(
  (SELECT count(*)::int FROM public.event_consent_records r, public.event_consent_confirmations c, _ecl_tok t
    WHERE t.k = 'p2-second' AND c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex')
      AND r.confirmation_id = c.id AND r.status = 'confirmed' AND r.evidence = 'email_double_opt_in'
      AND r.text_version = 1 AND r.text_lang = 'pl' AND r.ip_subject = 'ip:' || repeat('c3', 16)),
  1, 'wpis DOI: potwierdzenie, tekst wersji z linku, IP z potwierdzenia');

-- Link potwierdzony, ale wydany na INNY adres (organizator zmienil e-mail
-- osoby) albo potwierdzony po terminie - nie jest dowodem dla tej skrzynki.
INSERT INTO _ecl_tok (k, token)
SELECT 'p6-moved', public._event_consent_issue_confirmation(
  'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000006',
  ARRAY['marketing'], 'ec100000-0000-0000-0000-0000000000e1', NULL, 1, 'pl', NULL, NULL);
UPDATE public.event_consent_confirmations c
   SET confirmed_at = now(), email_norm = 'previous@ecl.example'
  FROM _ecl_tok t
 WHERE t.k = 'p6-moved' AND c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex');
SELECT throws_like(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000006',
      ARRAY['marketing'], 'email_double_opt_in', NULL, NULL,
      (SELECT c.id FROM public.event_consent_confirmations c, _ecl_tok t
        WHERE t.k = 'p6-moved' AND c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex')),
      NULL, NULL, NULL, NULL, NULL, 'email_double_opt_in')$$,
  'invalid_payload%', 'DOI z linku wydanego na poprzedni adres osoby: odmowa');
UPDATE public.event_consent_confirmations c
   SET email_norm = 'fresh@ecl.example', expires_at = c.created_at + interval '1 minute',
       confirmed_at = c.created_at + interval '2 minutes'
  FROM _ecl_tok t
 WHERE t.k = 'p6-moved' AND c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex');
SELECT throws_like(
  $$SELECT public._event_person_consents_confirm(
      'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000006',
      ARRAY['marketing'], 'email_double_opt_in', NULL, NULL,
      (SELECT c.id FROM public.event_consent_confirmations c, _ecl_tok t
        WHERE t.k = 'p6-moved' AND c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex')),
      NULL, NULL, NULL, NULL, NULL, 'email_double_opt_in')$$,
  'invalid_payload%', 'DOI potwierdzony po wygasnieciu linku: odmowa');
SELECT ok(
  (SELECT consent_marketing_at IS NULL FROM public.event_people
    WHERE id = 'ec300000-0000-0000-0000-000000000006')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE person_id = 'ec300000-0000-0000-0000-000000000006'
                     AND purpose = 'marketing' AND status = 'confirmed'),
  'odrzucony DOI: ani projekcji, ani wpisu confirmed');

-- ── 60-71. Most CRM i wycofanie (REG-14) ─────────────────────────────────────
-- Kazde wywolanie z efektem ubocznym idzie OSOBNA instrukcja, a asercja
-- dopiero po niej: podzapytanie w tej samej instrukcji co funkcja VOLATILE
-- widzi migawke sprzed jej zapisow, wiec sprawdzaloby stan sprzed wywolania.
-- Most nigdy nie rzuca (blad zostaje w event_person_crm_links), dlatego
-- zapamietujemy zwrocony kontakt i sprawdzamy, ze nie jest NULL.
CREATE TEMP TABLE _ecl_sync (k text PRIMARY KEY, lead uuid) ON COMMIT DROP;

INSERT INTO _ecl_sync (k, lead)
SELECT 'p3-legacy', public._event_person_crm_sync('ec0a0000-0000-0000-0000-0000000000aa',
  'ec300000-0000-0000-0000-000000000003', 'event_participant', 'event:ecl-event:registration',
  ARRAY['event:ecl-event'], '{}'::jsonb, true, NULL, '{}'::jsonb);
SELECT ok(
  (SELECT lead IS NOT NULL FROM _ecl_sync WHERE k = 'p3-legacy')
  AND (SELECT marketing_consent FROM public.crm_leads WHERE email_norm = 'legacy@ecl.example'),
  'most: spadek legacy jest dowodem (zgoda kontaktu podniesiona)');
SELECT ok(
  EXISTS (SELECT 1 FROM public.crm_consent_log
           WHERE lower(email) = 'legacy@ecl.example' AND given
             AND form_name = 'evidence:legacy_single_opt_in' AND consent_version IS NULL
             AND consent_text LIKE 'Organizer marketing consent given by the event participant (event_people.consent_marketing_at = 2026-01-15T10:00:00Z)%'),
  'most: zgoda ze spadku z dotychczasowym opisem stempla i kanalem w form_name');

INSERT INTO _ecl_tok (k, token)
SELECT 'p3-open', public._event_consent_issue_confirmation(
  'ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000003',
  ARRAY['partner_sharing'], 'ec100000-0000-0000-0000-0000000000e1', NULL, 1, 'en', NULL, NULL);

SET LOCAL ROLE service_role;
SELECT is(
  public._event_person_consents_withdraw('ec0a0000-0000-0000-0000-0000000000aa',
    'ec300000-0000-0000-0000-000000000003', ARRAY['marketing', 'partner_sharing'], 'manage_token',
    'ip:' || repeat('d4', 16), 'ua-d', NULL, 'manage_token'),
  true, 'wycofanie wszystkiego kluczem samoobslugi (service_role): bylo co wycofac');
RESET ROLE;
SELECT ok(
  (SELECT consent_marketing_at IS NULL AND consent_partner_sharing_at IS NULL
          AND consent_withdrawn_at IS NOT NULL
     FROM public.event_people WHERE id = 'ec300000-0000-0000-0000-000000000003'),
  'wycofanie: projekcja wyzerowana, consent_withdrawn_at ustawione (oba cele)');
SELECT is(
  (SELECT count(*)::int FROM public.event_consent_records
    WHERE person_id = 'ec300000-0000-0000-0000-000000000003' AND status = 'withdrawn'
      AND evidence = 'manage_token' AND ip_subject = 'ip:' || repeat('d4', 16) AND user_agent = 'ua-d'),
  2, 'wycofanie: wpis withdrawn na kazdy cel z kanalem, IP i UA');
SELECT ok(
  (SELECT c.superseded_at IS NOT NULL FROM public.event_consent_confirmations c, _ecl_tok t
    WHERE t.k = 'p3-open' AND c.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex')),
  'wycofanie zastepuje otwarty link DOI obejmujacy wycofany cel');
SELECT ok(NOT (SELECT marketing_consent FROM public.crm_leads WHERE email_norm = 'legacy@ecl.example'),
  'REG-14: wycofanie dociera do CRM (marketing_consent = false)');
SELECT ok(
  EXISTS (SELECT 1 FROM public.crm_consent_log
           WHERE tenant_id = 'ec0a0000-0000-0000-0000-0000000000aa'
             AND lower(email) = 'legacy@ecl.example' AND NOT given AND consent_key = 'marketing'
             AND source_type = 'event' AND source_id = 'ec300000-0000-0000-0000-000000000003'
             AND form_id = 'event_consent:manage_token' AND ip = 'ip:' || repeat('d4', 16)
             AND user_agent = 'ua-d'),
  'REG-14: rejestr zgod CRM dostaje wiersz given=false z kanalem i IP');
SELECT ok(
  EXISTS (SELECT 1 FROM public.audit_log a JOIN public.crm_leads l ON l.id = a.entity_id
           WHERE l.email_norm = 'legacy@ecl.example' AND a.entity_type = 'crm_lead'
             AND a.action = 'event.consent.withdrawn'
             AND a.metadata->>'person_id' = 'ec300000-0000-0000-0000-000000000003'),
  'wycofanie widac na osi czasu kontaktu');

INSERT INTO _ecl_sync (k, lead)
SELECT 'p3-after-withdraw', public._event_person_crm_sync('ec0a0000-0000-0000-0000-0000000000aa',
  'ec300000-0000-0000-0000-000000000003', 'event_participant', 'event:ecl-event:checkin',
  ARRAY['event:ecl-event'], '{}'::jsonb, false, 'event.checkin.attended',
  '{"registration_id":"ec400000-0000-0000-0000-000000000003"}'::jsonb);
SELECT ok(
  (SELECT lead IS NOT NULL FROM _ecl_sync WHERE k = 'p3-after-withdraw')
  AND NOT (SELECT marketing_consent FROM public.crm_leads WHERE email_norm = 'legacy@ecl.example'),
  'REG-14: most po wycofaniu NIE przywraca zgody w CRM');

-- Stary pisarz (event_register sprzed B1a) stawia stempel ponownie i zeruje
-- wycofanie - ksiega i tak mowi "withdrawn", wiec CRM zostaje wylaczony.
UPDATE public.event_people
   SET consent_marketing_at = now(), consent_withdrawn_at = NULL
 WHERE id = 'ec300000-0000-0000-0000-000000000003';
INSERT INTO _ecl_sync (k, lead)
SELECT 'p3-restamped', public._event_person_crm_sync('ec0a0000-0000-0000-0000-0000000000aa',
  'ec300000-0000-0000-0000-000000000003', 'event_participant', 'event:ecl-event:registration',
  ARRAY['event:ecl-event'], '{}'::jsonb, true, NULL, '{}'::jsonb);
SELECT ok(
  (SELECT lead IS NOT NULL FROM _ecl_sync WHERE k = 'p3-restamped')
  AND NOT (SELECT marketing_consent FROM public.crm_leads WHERE email_norm = 'legacy@ecl.example')
  AND (SELECT count(*) FROM public.crm_consent_log
        WHERE lower(email) = 'legacy@ecl.example' AND given) = 1,
  'REG-14: stempel postawiony obok ksiegi (stary pisarz) nie wskrzesza zgody w CRM');

SELECT is(
  public._event_person_consents_withdraw('ec0a0000-0000-0000-0000-0000000000aa',
    'ec300000-0000-0000-0000-000000000006', ARRAY['marketing'], 'account_settings',
    NULL, NULL, NULL, 'account_settings'),
  false, 'wycofanie bez aktywnej zgody: false (wpis i tak zapisany)');

-- ── 72-74. Wycofanie po stronie CRM, osoby bez ksiegi, dowod DOI ─────────────
INSERT INTO _ecl_sync (k, lead)
SELECT 'p5-crmside', public._event_person_crm_sync('ec0a0000-0000-0000-0000-0000000000aa',
  'ec300000-0000-0000-0000-000000000005', 'event_participant', 'event:ecl-event:registration',
  ARRAY['event:ecl-event'], '{}'::jsonb, true, NULL, '{}'::jsonb);
SELECT ok(
  (SELECT lead IS NOT NULL FROM _ecl_sync WHERE k = 'p5-crmside')
  AND NOT (SELECT marketing_consent FROM public.crm_leads WHERE email_norm = 'crmside@ecl.example')
  AND NOT EXISTS (SELECT 1 FROM public.crm_consent_log WHERE lower(email) = 'crmside@ecl.example' AND given),
  'REG-14: given=false po stronie CRM (nowsze niz stempel) zatrzymuje most');

INSERT INTO _ecl_sync (k, lead)
SELECT 'p7-plain', public._event_person_crm_sync('ec0a0000-0000-0000-0000-0000000000aa',
  'ec300000-0000-0000-0000-000000000007', 'event_participant', 'event:ecl-event:registration',
  ARRAY['event:ecl-event'], '{}'::jsonb, true, NULL, '{}'::jsonb);
SELECT ok(
  (SELECT lead IS NOT NULL FROM _ecl_sync WHERE k = 'p7-plain')
  AND (SELECT marketing_consent FROM public.crm_leads WHERE email_norm = 'plain@ecl.example')
  AND EXISTS (SELECT 1 FROM public.crm_consent_log
               WHERE lower(email) = 'plain@ecl.example' AND given AND form_name IS NULL
                 AND form_id = 'event:ecl-event:registration' AND consent_version IS NULL
                 AND consent_text LIKE '%event_people.consent_marketing_at = 2026-01-05T10:00:00Z%'),
  'osoba bez wpisow ksiegi: regula i opis dotychczasowe (zgodnosc z 14_crm_bridge)');

INSERT INTO _ecl_sync (k, lead)
SELECT 'p2-doi', public._event_person_crm_sync('ec0a0000-0000-0000-0000-0000000000aa',
  'ec300000-0000-0000-0000-000000000002', 'event_participant', 'event:ecl-event:registration',
  ARRAY['event:ecl-event'], '{}'::jsonb, true, NULL, '{}'::jsonb);
SELECT ok(
  (SELECT lead IS NOT NULL FROM _ecl_sync WHERE k = 'p2-doi')
  AND (SELECT marketing_consent FROM public.crm_leads WHERE email_norm = 'withdrawn@ecl.example')
  AND EXISTS (
    SELECT 1 FROM public.crm_consent_log g
     WHERE lower(g.email) = 'withdrawn@ecl.example' AND g.given
       AND g.consent_text = (SELECT body FROM public.event_consent_texts
                              WHERE purpose = 'marketing' AND version = 1 AND lang = 'pl')
       AND g.consent_version = 'event-marketing-v1-pl' AND g.lang = 'pl'
       AND g.form_name = 'evidence:email_double_opt_in'
       AND g.ip = 'ip:' || repeat('c3', 16) AND g.user_agent = 'ua-c'),
  'most z dowodem DOI: prawdziwy tekst, wersja, kanal, IP i UA w rejestrze zgod CRM');

-- ── 75-83. Wycofanie z konta, po adresie, odmowy, najemca ────────────────────
SELECT lives_ok(
  $$SELECT public._event_person_consents_withdraw('ec0a0000-0000-0000-0000-0000000000aa',
      'ec300000-0000-0000-0000-000000000001', ARRAY['marketing'], 'account_settings',
      'ip:' || repeat('e5', 16), 'ua-e', 'ec000000-0000-0000-0000-0000000000a1', 'profile.privacy')$$,
  'wlasciciel wycofuje sam marketing z ustawien konta');
SELECT ok(
  (SELECT consent_marketing_at IS NULL AND consent_partner_sharing_at IS NOT NULL
          AND consent_withdrawn_at IS NULL
     FROM public.event_people WHERE id = 'ec300000-0000-0000-0000-000000000001')
  AND EXISTS (SELECT 1 FROM public.crm_consent_log
               WHERE lower(email) = 'owner@ecl.example' AND NOT given
                 AND form_id = 'event_consent:account_settings' AND ip = 'ip:' || repeat('e5', 16))
  -- P6 nie ma kontaktu w CRM, a wiersz given=false i tak powstal (wycofanie
  -- wyzej): zatrzyma most, gdy kontakt kiedys powstanie.
  AND EXISTS (SELECT 1 FROM public.crm_consent_log
               WHERE lower(email) = 'fresh@ecl.example' AND NOT given
                 AND form_id = 'event_consent:account_settings')
  AND NOT EXISTS (SELECT 1 FROM public.crm_leads WHERE email_norm = 'fresh@ecl.example'),
  'czesciowe wycofanie: partnerzy zostaja, bez globalnego wycofania; given=false takze bez kontaktu');

INSERT INTO _ecl_tok (k, token)
SELECT 'by-email', public._event_consent_withdraw_by_email('ec0a0000-0000-0000-0000-0000000000aa',
  '  WITHDRAWN@ecl.EXAMPLE ', 'unsubscribe_link')::text;
SELECT is((SELECT token FROM _ecl_tok WHERE k = 'by-email'), 'true',
  'link wypisu: osoba po adresie (wielkosc liter i spacje bez znaczenia)');
SELECT ok(
  (SELECT consent_marketing_at IS NULL FROM public.event_people WHERE id = 'ec300000-0000-0000-0000-000000000002')
  AND EXISTS (SELECT 1 FROM public.event_consent_records
               WHERE person_id = 'ec300000-0000-0000-0000-000000000002' AND status = 'withdrawn'
                 AND evidence = 'unsubscribe_link')
  AND NOT (SELECT marketing_consent FROM public.crm_leads WHERE email_norm = 'withdrawn@ecl.example'),
  'link wypisu: projekcja, ksiega i CRM');
SELECT is(
  public._event_consent_withdraw_by_email('ec0a0000-0000-0000-0000-0000000000aa',
    'nobody@ecl.example', 'unsubscribe_link'),
  false, 'adres bez osoby: false, bez bledu');
SELECT throws_like(
  $$SELECT public._event_consent_withdraw_by_email('ec0a0000-0000-0000-0000-0000000000aa',
      'owner@ecl.example', 'registration_form')$$,
  'invalid_consent_evidence%', 'wycofanie kanalem spoza listy: odmowa');
SELECT throws_like(
  $$SELECT public._event_consent_withdraw_by_email('ec0a0000-0000-0000-0000-0000000000aa',
      'nobody@ecl.example', 'registration_form')$$,
  'invalid_consent_evidence%', 'zly kanal nie chowa sie za adresem bez kartoteki');
SELECT throws_like(
  $$SELECT public._event_person_consents_withdraw('ec0a0000-0000-0000-0000-0000000000aa',
      'ec300000-0000-0000-0000-000000000001', ARRAY['data_processing'], 'account_settings',
      NULL, NULL, NULL, NULL)$$,
  'invalid_consent_purpose%', 'zgody na przetwarzanie danych nie wycofuje sie tym kanalem');
INSERT INTO _ecl_tok (k, token)
SELECT 'cross-tenant', public._event_person_consents_withdraw('ec0b0000-0000-0000-0000-0000000000bb',
  'ec300000-0000-0000-0000-000000000003', ARRAY['marketing'], 'manage_token',
  NULL, NULL, NULL, NULL)::text;
SELECT ok(
  (SELECT token FROM _ecl_tok WHERE k = 'cross-tenant') = 'false'
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE tenant_id = 'ec0b0000-0000-0000-0000-0000000000bb'),
  'osoba z innego najemcy: false i zaden wpis');

-- ── 84-86. submitted_profile: dane niezweryfikowanego zapisujacego ───────────
SELECT lives_ok(
  $$UPDATE public.event_registrations
       SET submitted_profile = '{"first_name":"Mallory","last_name":"Attacker"}'::jsonb
     WHERE id = 'ec400000-0000-0000-0000-000000000003'$$,
  'submitted_profile: obiekt jsonb przyjety');
SELECT throws_ok(
  $$UPDATE public.event_registrations SET submitted_profile = '["Mallory"]'::jsonb
     WHERE id = 'ec400000-0000-0000-0000-000000000003'$$,
  '23514',
  'new row for relation "event_registrations" violates check constraint "event_registrations_submitted_profile_shape"',
  'submitted_profile: tablica (nie obiekt) odrzucona');
SELECT throws_ok(
  $$UPDATE public.event_registrations
       SET submitted_profile = jsonb_build_object('company_text', repeat('x', 4000))
     WHERE id = 'ec400000-0000-0000-0000-000000000003'$$,
  '23514',
  'new row for relation "event_registrations" violates check constraint "event_registrations_submitted_profile_shape"',
  'submitted_profile: ponad 4000 znakow odrzucone (odmowa, nie przyciecie)');

-- Wpis w drugim najemcy (do asercji RLS).
SELECT public._event_person_consents_confirm(
  'ec0b0000-0000-0000-0000-0000000000bb', 'ec300000-0000-0000-0000-000000000009',
  ARRAY['data_processing'], 'registration_form', NULL, 'ec400000-0000-0000-0000-000000000009',
  NULL, 1, 'pl', NULL, NULL, NULL, 'registration_form');

-- ── 87-92. RLS ksiegi i potwierdzen ──────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"ec000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  EXISTS (SELECT 1 FROM public.event_consent_records WHERE person_id = 'ec300000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE person_id <> 'ec300000-0000-0000-0000-000000000001'),
  'osoba z kontem czyta wylacznie wlasna ksiege');
SELECT throws_ok($$SELECT 1 FROM public.event_consent_confirmations$$, '42501', NULL,
  'potwierdzenia DOI niewidoczne dla klienta');
SELECT throws_ok(
  $$INSERT INTO public.event_consent_records
      (tenant_id, person_id, email_norm, purpose, status, evidence, text_version, text_lang)
    VALUES ('ec0a0000-0000-0000-0000-0000000000aa', 'ec300000-0000-0000-0000-000000000001',
            'owner@ecl.example', 'marketing', 'confirmed', 'verified_account', 1, 'pl')$$,
  '42501', NULL, 'klient nie dopisze sobie zgody do ksiegi');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"ec000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(
  EXISTS (SELECT 1 FROM public.event_consent_records WHERE person_id = 'ec300000-0000-0000-0000-000000000003')
  AND NOT EXISTS (SELECT 1 FROM public.event_consent_records
                   WHERE tenant_id = 'ec0b0000-0000-0000-0000-0000000000bb'),
  'admin najemcy czyta ksiege swoich osob, nie cudzego najemcy');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"ec000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.event_consent_records), 0,
  'konto bez osoby i bez roli nie widzi zadnego wpisu');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT 1 FROM public.event_consent_records$$, '42501', NULL,
  'anon nie ma dostepu do ksiegi');
RESET ROLE;

-- ── 93-95. Wycofanie wersji tekstu z uzycia ──────────────────────────────────
-- Jedyna dopuszczalna zmiana opublikowanej wersji, jednorazowa; wpisy
-- wskazujace wersje wycofana dalej sie waliduja (stara paczka formularza).
SELECT lives_ok(
  $$UPDATE public.event_consent_texts SET retired_at = now()
     WHERE purpose = 'marketing' AND version = 1 AND lang = 'pl'$$,
  'tekst: wycofanie wersji z uzycia (retired_at) przechodzi');
SELECT throws_like(
  $$UPDATE public.event_consent_texts SET retired_at = now() + interval '1 day'
     WHERE purpose = 'marketing' AND version = 1 AND lang = 'pl'$$,
  'append_only%', 'tekst: wersje wycofuje sie raz (bez przesuwania daty)');
SELECT lives_ok(
  $$SELECT public._event_consent_text_check('marketing', 1, 'pl')$$,
  'tekst: wersja wycofana z uzycia nadal jest znanym dowodem');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
