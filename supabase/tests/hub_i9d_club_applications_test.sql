-- pgTAP: RODO - zgłoszenia do klubów (I9d-Y1, Z-I9c-01; migracje
-- 20261020161500-161600 i rdzeń katalogu 20261020162200; decyzja
-- właściciela 2026-10-20 „optymalne rozwiązanie wybierz").
--
-- CO PRZYPINA:
--   * koniec członkostwa: wyjście/ban stempluje `club_members.ended_at`
--     (z `left` w `banned` data zostaje), powrót czyści; skasowane
--     członkostwo i usunięty klub - data w zgłoszeniu;
--   * kategoria `club_applications`: odrzucone po okresie od decyzji,
--     przyjęte po okresie od końca członkostwa (także bez klubu - od
--     decyzji) -> anonimizacja; oczekujące, członkostwo trwające i świeże
--     wyjście - nigdy; podgląd i najemca w karencji niczego nie zmieniają;
--   * anonimizacja: dane kontaktowe, teksty własne i notatka komisji puste,
--     powiązanie CRM i błędy NULL, `user_id` -> pseudonim v8 (jeden na
--     konto); klub, specjalizacja, status, daty, warstwa i pola zgrubne
--     zostają; powtórka = 0;
--   * usunięcie konta: zgłoszenia oczekujące też zanonimizowane (status
--     bez zmian), jeden pseudonim;
--   * decyzja komisji dla zgłoszenia zanonimizowanego albo osoby bez konta:
--     `application_anonymized`, bez zmiany;
--   * ACL funkcji.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_club_applications
BEGIN;
SELECT plan(24);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- A: najemca po karencji (bez wierszy ustawień -> założenie + 14 dni, czyli
-- wykonanie); B: najemca w karencji.
INSERT INTO public.tenants (id, slug, name, created_at) VALUES
  ('19d10000-0000-4000-8000-0000000000a0', 'i9d-kluby-a', 'I9d Kluby A', now() - interval '30 days'),
  ('19d10000-0000-4000-8000-0000000000b0', 'i9d-kluby-b', 'I9d Kluby B', now());
INSERT INTO auth.users (id, email)
SELECT ('19d10000-0000-4000-8000-00000000e00' || n)::uuid, 'osoba' || n || '@i9d-kluby.test'
  FROM generate_series(1, 9) n;
INSERT INTO auth.users (id, email) VALUES
  ('19d10000-0000-4000-8000-00000000a001', 'admin@i9d-kluby.test'),
  ('19d10000-0000-4000-8000-00000000b001', 'admin-b@i9d-kluby.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19d10000-0000-4000-8000-00000000a001', 'admin@i9d-kluby.test', 'Admin', '19d10000-0000-4000-8000-0000000000a0'),
  ('19d10000-0000-4000-8000-00000000b001', 'admin-b@i9d-kluby.test', 'Admin B', '19d10000-0000-4000-8000-0000000000b0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19d10000-0000-4000-8000-00000000a001', 'admin', '19d10000-0000-4000-8000-0000000000a0'),
  ('19d10000-0000-4000-8000-00000000b001', 'admin', '19d10000-0000-4000-8000-0000000000b0');
INSERT INTO public.clubs (id, tenant_id, slug, name_pl, name_en) VALUES
  ('19d10000-0000-4000-8000-0000000000c1', '19d10000-0000-4000-8000-0000000000a0', 'i9d-klub-1', 'Klub 1', 'Club 1'),
  ('19d10000-0000-4000-8000-0000000000c2', '19d10000-0000-4000-8000-0000000000a0', 'i9d-klub-2', 'Klub 2', 'Club 2'),
  ('19d10000-0000-4000-8000-0000000000c3', '19d10000-0000-4000-8000-0000000000a0', 'i9d-klub-3', 'Klub 3', 'Club 3');

CREATE FUNCTION pg_temp.ts(p interval) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() - p $$;
CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;

-- Zgłoszenie z KOMPLETEM danych: kontakt, teksty własne, pola zgrubne,
-- warstwa, zgody, powiązanie CRM i teksty błędów.
CREATE FUNCTION pg_temp.app(p_id text, p_tenant text, p_user text, p_spec text, p_status text, p_club text,
                            p_created interval, p_reviewed interval)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.club_applications (
    id, tenant_id, user_id, specialization_slug, club_id, status, first_name, last_name, email, phone, company,
    job_position, seniority, industry, country, city, linkedin_url, years_experience, expertise, languages,
    motivation, goals, contribution, availability, referral_source, consent, marketing_consent, tier_key, tier_rank,
    admin_note, lang, crm_lead_id, crm_error, notify_error, created_at, reviewed_at)
  VALUES (
    p_id::uuid, p_tenant::uuid, p_user::uuid, p_spec, p_club::uuid, p_status, 'Imię ' || p_id, 'Nazwisko',
    'kontakt-' || right(p_id, 3) || '@i9d-kluby.test', '+48 600 100 200', 'Firma', 'Analityk', 'senior',
    'energia', 'PL', 'Gdańsk', 'https://www.linkedin.com/in/osoba', 12, 'Rynek gazu', 'polski, angielski',
    'Motywacja', 'Cele', 'Wkład', 'Wieczory', 'Konferencja', true, true, 'pro', 20, 'Notatka komisji', 'en',
    gen_random_uuid(), 'crm: kontakt@i9d-kluby.test', 'notify: kontakt@i9d-kluby.test',
    pg_temp.ts(p_created), CASE WHEN p_reviewed IS NULL THEN NULL ELSE pg_temp.ts(p_reviewed) END)
$$;

-- a01/a02: ta sama osoba, dwa odrzucenia sprzed 30 mies. (jeden pseudonim).
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001a1', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e001', 'energy', 'rejected', NULL, '31 months', '30 months');
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001a2', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e001', 'security', 'rejected', NULL, '32 months', '31 months');
-- a03: odrzucone 10 mies. temu - w okresie.
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001a3', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e002', 'energy', 'rejected', NULL, '11 months', '10 months');
-- a04/a05: oczekujące (pending, needs_info) sprzed 40 mies. - nigdy automatycznie.
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001a4', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e003', 'energy', 'pending', NULL, '40 months', NULL);
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001a5', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e003', 'security', 'needs_info', NULL, '40 months', '39 months');
-- a06: przyjęte, wyjście z klubu 30 mies. temu; a07: wyjście 6 mies. temu;
-- a08: członkostwo trwa od 40 mies.
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001a6', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e004', 'energy', 'accepted',
                   '19d10000-0000-4000-8000-0000000000c1', '41 months', '40 months');
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001a7', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e005', 'energy', 'accepted',
                   '19d10000-0000-4000-8000-0000000000c1', '41 months', '40 months');
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001a8', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e006', 'energy', 'accepted',
                   '19d10000-0000-4000-8000-0000000000c1', '41 months', '40 months');
-- a09: przyjęte bez klubu (sama specjalizacja) - decyzja 30 mies. temu.
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001a9', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e007', 'energy', 'accepted', NULL, '31 months', '30 months');
-- a10: przyjęte do klubu 2 (członkostwo skasowane niżej); a11: klub 3 (usunięty niżej).
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001b0', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e008', 'energy', 'accepted',
                   '19d10000-0000-4000-8000-0000000000c2', '41 months', '40 months');
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001b1', '19d10000-0000-4000-8000-0000000000a0',
                   '19d10000-0000-4000-8000-00000000e009', 'energy', 'accepted',
                   '19d10000-0000-4000-8000-0000000000c3', '41 months', '40 months');
-- B (karencja): odrzucone sprzed 30 mies.
SELECT pg_temp.app('19d10000-0000-4000-8000-0000000001c1', '19d10000-0000-4000-8000-0000000000b0',
                   '19d10000-0000-4000-8000-00000000e001', 'energy', 'rejected', NULL, '31 months', '30 months');

INSERT INTO public.club_members (tenant_id, club_id, user_id, status) VALUES
  ('19d10000-0000-4000-8000-0000000000a0', '19d10000-0000-4000-8000-0000000000c1', '19d10000-0000-4000-8000-00000000e004', 'active'),
  ('19d10000-0000-4000-8000-0000000000a0', '19d10000-0000-4000-8000-0000000000c1', '19d10000-0000-4000-8000-00000000e005', 'active'),
  ('19d10000-0000-4000-8000-0000000000a0', '19d10000-0000-4000-8000-0000000000c1', '19d10000-0000-4000-8000-00000000e006', 'active'),
  ('19d10000-0000-4000-8000-0000000000a0', '19d10000-0000-4000-8000-0000000000c2', '19d10000-0000-4000-8000-00000000e008', 'active'),
  ('19d10000-0000-4000-8000-0000000000a0', '19d10000-0000-4000-8000-0000000000c3', '19d10000-0000-4000-8000-00000000e009', 'active');

CREATE FUNCTION pg_temp.member_end(p_user text) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT m.ended_at FROM public.club_members m
   WHERE m.club_id = '19d10000-0000-4000-8000-0000000000c1' AND m.user_id = p_user::uuid
$$;
CREATE FUNCTION pg_temp.app_row(p_id text) RETURNS public.club_applications LANGUAGE sql AS $$
  SELECT a FROM public.club_applications a WHERE a.id = p_id::uuid
$$;

-- ── 1. Koniec członkostwa ────────────────────────────────────────────────────
SELECT ok(
  pg_temp.member_end('19d10000-0000-4000-8000-00000000e004') IS NULL,
  'członkostwo aktywne: brak końca (ended_at NULL)');

UPDATE public.club_members SET status = 'left'
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c1' AND user_id = '19d10000-0000-4000-8000-00000000e004';
SELECT ok(
  pg_temp.member_end('19d10000-0000-4000-8000-00000000e004') >= now() - interval '1 minute',
  'wyjście z klubu (left) stempluje koniec członkostwa');

-- Powrót czyści; ponowne wyjście stempluje; z left w banned data zostaje.
UPDATE public.club_members SET status = 'active'
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c1' AND user_id = '19d10000-0000-4000-8000-00000000e005';
UPDATE public.club_members SET status = 'left'
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c1' AND user_id = '19d10000-0000-4000-8000-00000000e005';
UPDATE public.club_members SET ended_at = pg_temp.ts('6 months')
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c1' AND user_id = '19d10000-0000-4000-8000-00000000e005';
UPDATE public.club_members SET status = 'banned'
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c1' AND user_id = '19d10000-0000-4000-8000-00000000e005';
CREATE TEMP TABLE probe ON COMMIT DROP AS
SELECT pg_temp.member_end('19d10000-0000-4000-8000-00000000e005') AS banned_end;
UPDATE public.club_members SET status = 'active'
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c1' AND user_id = '19d10000-0000-4000-8000-00000000e005';
SELECT ok(
  (SELECT banned_end BETWEEN pg_temp.ts('6 months') - interval '1 minute' AND pg_temp.ts('6 months') + interval '1 minute'
     FROM probe)
  AND pg_temp.member_end('19d10000-0000-4000-8000-00000000e005') IS NULL,
  'z left w banned koniec się nie przesuwa; powrót do active czyści koniec');
-- Fikstura okresów: u4 wyszedł 30 mies. temu, u5 - 6 mies. temu.
UPDATE public.club_members SET status = 'left'
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c1' AND user_id = '19d10000-0000-4000-8000-00000000e005';
UPDATE public.club_members SET ended_at = pg_temp.ts('6 months')
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c1' AND user_id = '19d10000-0000-4000-8000-00000000e005';
UPDATE public.club_members SET ended_at = pg_temp.ts('30 months')
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c1' AND user_id = '19d10000-0000-4000-8000-00000000e004';

-- Skasowane członkostwo (admin) -> data w zgłoszeniu; nowe członkostwo ją czyści.
DELETE FROM public.club_members
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c2' AND user_id = '19d10000-0000-4000-8000-00000000e008';
CREATE TEMP TABLE probe_gone ON COMMIT DROP AS
SELECT (pg_temp.app_row('19d10000-0000-4000-8000-0000000001b0')).membership_ended_at AS gone_end;
INSERT INTO public.club_members (tenant_id, club_id, user_id, status) VALUES
  ('19d10000-0000-4000-8000-0000000000a0', '19d10000-0000-4000-8000-0000000000c2', '19d10000-0000-4000-8000-00000000e008', 'active');
SELECT ok(
  (SELECT gone_end >= now() - interval '1 minute' FROM probe_gone)
  AND (pg_temp.app_row('19d10000-0000-4000-8000-0000000001b0')).membership_ended_at IS NULL,
  'skasowane członkostwo: koniec w zgłoszeniu; ponowne członkostwo go czyści');
DELETE FROM public.club_members
 WHERE club_id = '19d10000-0000-4000-8000-0000000000c2' AND user_id = '19d10000-0000-4000-8000-00000000e008';
UPDATE public.club_applications SET membership_ended_at = pg_temp.ts('30 months')
 WHERE id = '19d10000-0000-4000-8000-0000000001b0';

-- Usunięty klub: zgłoszenie odłączone (club_id NULL) z datą końca.
DELETE FROM public.clubs WHERE id = '19d10000-0000-4000-8000-0000000000c3';
SELECT ok(
  (SELECT club_id IS NULL AND membership_ended_at >= now() - interval '1 minute' AND status = 'accepted'
     FROM public.club_applications WHERE id = '19d10000-0000-4000-8000-0000000001b1'),
  'usunięty klub: zgłoszenie bez klubu, koniec członkostwa w zgłoszeniu, status bez zmian');

-- ── 2. Podgląd i karencja ────────────────────────────────────────────────────
CREATE TEMP TABLE snap ON COMMIT DROP AS
SELECT a.id, a.user_id, a.email, a.updated_at FROM public.club_applications a
 WHERE a.tenant_id IN ('19d10000-0000-4000-8000-0000000000a0', '19d10000-0000-4000-8000-0000000000b0');

SELECT is(
  (public._data_retention_club_applications('19d10000-0000-4000-8000-0000000000a0', pg_temp.ts('24 months'),
                                            false, 100) ->> 'affected')::int,
  5, 'podgląd: 5 kandydatów (2 odrzucenia osoby 1, wyjście 30 mies. temu, przyjęte bez klubu, członkostwo skasowane 30 mies. temu)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.club_applications a JOIN snap s ON s.id = a.id
               WHERE a.user_id IS DISTINCT FROM s.user_id OR a.email IS DISTINCT FROM s.email),
  'podgląd niczego nie zmienia');

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
INSERT INTO r SELECT 'b', public._data_retention_run_tenant('19d10000-0000-4000-8000-0000000000b0', 'schedule', 1000);
SELECT ok(
  (SELECT v -> 'club_applications' ->> 'mode' = 'preview' AND (v -> 'club_applications' ->> 'affected')::int = 1
     FROM r WHERE k = 'b')
  AND (SELECT email = 'kontakt-1c1@i9d-kluby.test' AND user_id = '19d10000-0000-4000-8000-00000000e001'
         FROM public.club_applications WHERE id = '19d10000-0000-4000-8000-0000000001c1'),
  'najemca w karencji: przebieg w trybie podglądu liczy, zgłoszenie bez zmian');

-- ── 3. Wykonanie ─────────────────────────────────────────────────────────────
INSERT INTO r SELECT 'a1', public._data_retention_run_tenant('19d10000-0000-4000-8000-0000000000a0', 'schedule', 1000);
SELECT ok(
  (SELECT v -> 'club_applications' ->> 'mode' = 'execute' AND (v -> 'club_applications' ->> 'affected')::int = 5
          AND (v -> 'club_applications' ->> 'backlog')::boolean IS FALSE
     FROM r WHERE k = 'a1'),
  'wykonanie: 5 zgłoszeń (2 odrzucenia, wyjście 30 mies. temu, bez klubu, członkostwo skasowane 30 mies. temu)');

SELECT ok(
  (SELECT count(*) = 5 AND bool_and(
            substr(a.user_id::text, 15, 1) = '8' AND a.first_name = '' AND a.last_name = '' AND a.email = ''
            AND a.phone = '' AND a.company = '' AND a.job_position = '' AND a.city = '' AND a.linkedin_url = ''
            AND a.expertise = '' AND a.languages = '' AND a.motivation = '' AND a.goals = '' AND a.contribution = ''
            AND a.availability = '' AND a.referral_source = '' AND a.admin_note = '' AND a.crm_lead_id IS NULL
            AND a.crm_error IS NULL AND a.notify_error IS NULL)
     FROM public.club_applications a
    WHERE a.id IN ('19d10000-0000-4000-8000-0000000001a1', '19d10000-0000-4000-8000-0000000001a2',
                   '19d10000-0000-4000-8000-0000000001a6', '19d10000-0000-4000-8000-0000000001a9',
                   '19d10000-0000-4000-8000-0000000001b0')),
  'anonimizacja: dane kontaktowe, teksty własne i notatka puste, CRM i błędy NULL, user_id -> pseudonim v8');

SELECT ok(
  (SELECT bool_and(a.specialization_slug IS NOT NULL AND a.industry = 'energia' AND a.seniority = 'senior'
                   AND a.country = 'PL' AND a.years_experience = 12 AND a.tier_key = 'pro' AND a.tier_rank = 20
                   AND a.consent AND a.marketing_consent AND a.lang = 'en' AND a.reviewed_at IS NOT NULL
                   AND a.created_at < pg_temp.ts('30 months') AND a.status IN ('rejected', 'accepted'))
     FROM public.club_applications a
    WHERE a.id IN ('19d10000-0000-4000-8000-0000000001a1', '19d10000-0000-4000-8000-0000000001a2',
                   '19d10000-0000-4000-8000-0000000001a6', '19d10000-0000-4000-8000-0000000001a9',
                   '19d10000-0000-4000-8000-0000000001b0'))
  AND (pg_temp.app_row('19d10000-0000-4000-8000-0000000001a6')).club_id = '19d10000-0000-4000-8000-0000000000c1'
  AND (pg_temp.app_row('19d10000-0000-4000-8000-0000000001a2')).specialization_slug = 'security',
  'zostają: klub, specjalizacja, status, daty, warstwa, pola zgrubne, flagi zgód i język');

SELECT ok(
  (pg_temp.app_row('19d10000-0000-4000-8000-0000000001a1')).user_id
    = (pg_temp.app_row('19d10000-0000-4000-8000-0000000001a2')).user_id
  AND (pg_temp.app_row('19d10000-0000-4000-8000-0000000001a1')).user_id
    <> (pg_temp.app_row('19d10000-0000-4000-8000-0000000001a6')).user_id,
  'jeden pseudonim na konto (dwa zgłoszenia osoby), różne konta - różne pseudonimy');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.club_applications a JOIN snap s ON s.id = a.id
               WHERE a.id IN ('19d10000-0000-4000-8000-0000000001a3', '19d10000-0000-4000-8000-0000000001a4',
                              '19d10000-0000-4000-8000-0000000001a5', '19d10000-0000-4000-8000-0000000001a7',
                              '19d10000-0000-4000-8000-0000000001a8', '19d10000-0000-4000-8000-0000000001b1')
                 AND (a.user_id IS DISTINCT FROM s.user_id OR a.email IS DISTINCT FROM s.email)),
  'nietknięte: odrzucenie w okresie, oczekujące sprzed 40 mies., świeże wyjście, członkostwo trwające, świeżo usunięty klub');

SELECT ok(
  EXISTS (SELECT 1 FROM public.data_retention_runs
           WHERE tenant_id = '19d10000-0000-4000-8000-0000000000a0' AND category = 'club_applications'
             AND mode = 'execute' AND affected = 5 AND error_code IS NULL),
  'dziennik przebiegów: wiersz kategorii bez błędu');

INSERT INTO r SELECT 'a2', public._data_retention_run_tenant('19d10000-0000-4000-8000-0000000000a0', 'schedule', 1000);
SELECT is((SELECT (v -> 'club_applications' ->> 'affected')::int FROM r WHERE k = 'a2'), 0,
  'idempotencja: powtórka nie znajduje kandydatów (pseudonim v8 = zanonimizowane)');

-- Krótszy okres z panelu (12 mies.) obejmuje odrzucenie sprzed 10 mies.? Nie -
-- i świeże wyjście (6 mies.) też nie; okres 36 - nic z zanonimizowanych nie wraca.
SELECT is(
  (public._data_retention_club_applications('19d10000-0000-4000-8000-0000000000a0', pg_temp.ts('12 months'),
                                            false, 100) ->> 'affected')::int,
  0, 'okres 12 mies.: odrzucenie sprzed 10 mies. i wyjście sprzed 6 mies. nadal poza progiem');
SELECT is(
  (public._data_retention_club_applications('19d10000-0000-4000-8000-0000000000a0', pg_temp.ts('9 months'),
                                            false, 100) ->> 'affected')::int,
  1, 'próg 9 mies.: tylko odrzucenie sprzed 10 mies. (oczekujące i członkostwo trwające - nigdy)');

-- ── 4. Decyzja komisji dla zgłoszenia bez osoby ──────────────────────────────
SELECT pg_temp.as_user('19d10000-0000-4000-8000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_club_application_set_status('19d10000-0000-4000-8000-0000000001a1', 'accepted', NULL) $$,
  'P0001', 'application_anonymized', 'decyzja dla zgłoszenia zanonimizowanego: application_anonymized');
SELECT lives_ok(
  $$ SELECT public.admin_club_application_set_status('19d10000-0000-4000-8000-0000000001a4', 'review', NULL) $$,
  'decyzja dla zgłoszenia żyjącej osoby działa jak dotąd');
RESET ROLE;
SELECT ok(
  (SELECT status = 'rejected' AND first_name = '' FROM public.club_applications
    WHERE id = '19d10000-0000-4000-8000-0000000001a1')
  AND (SELECT status = 'review' FROM public.club_applications WHERE id = '19d10000-0000-4000-8000-0000000001a4'),
  'odmowa niczego nie zmienia; zgłoszenie żyjącej osoby zmienia status');

-- Osoba bez konta (usunięta poza ścieżką RODO) - też odmowa.
INSERT INTO public.club_applications (id, tenant_id, user_id, specialization_slug, first_name, email)
VALUES ('19d10000-0000-4000-8000-0000000001d1', '19d10000-0000-4000-8000-0000000000a0',
        '19d10000-0000-4000-8000-00000000dead', 'energy', 'Bez konta', 'bez-konta@i9d-kluby.test');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_club_application_set_status('19d10000-0000-4000-8000-0000000001d1', 'rejected', 'Brak') $$,
  'P0001', 'application_anonymized', 'decyzja dla zgłoszenia osoby bez konta: application_anonymized');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── 5. Usunięcie konta: oczekujące też anonimizowane ─────────────────────────
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_retain_accounting;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_redact_revenue;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_redact_hub;
DELETE FROM auth.users WHERE id = '19d10000-0000-4000-8000-00000000e003';
SELECT ok(
  (SELECT count(*) = 2 AND count(DISTINCT a.user_id) = 1 AND bool_and(substr(a.user_id::text, 15, 1) = '8')
          AND bool_and(a.email = '' AND a.languages = '' AND a.availability = '' AND a.crm_lead_id IS NULL)
          AND bool_and(a.industry = 'energia' AND a.tier_key = 'pro')
          AND array_agg(a.status ORDER BY a.status) = ARRAY['needs_info', 'review']
     FROM public.club_applications a
    WHERE a.id IN ('19d10000-0000-4000-8000-0000000001a4', '19d10000-0000-4000-8000-0000000001a5')),
  'usunięcie konta: zgłoszenia (także w toku) zanonimizowane jednym pseudonimem, status i pola zgrubne zostają');

-- ── 6. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
             'public._club_applications_anonymize(uuid[], uuid)',
             'public._data_retention_club_candidates(uuid, timestamptz, integer)',
             'public._data_retention_club_applications(uuid, timestamptz, boolean, integer)',
             'public.tg_club_members_membership_end()', 'public.tg_club_members_membership_gone()',
             'public.tg_club_applications_club_detached()']) f,
           unnest(ARRAY['anon', 'authenticated', 'service_role']) r
     WHERE has_function_privilege(r, f, 'EXECUTE')),
  'acl: anonimizacja, kandydaci, kategoria i wyzwalacze - bez EXECUTE dla ról API');
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_club_application_set_status(uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_club_application_set_status(uuid, text, text)', 'EXECUTE'),
  'acl: decyzja komisji - authenticated (admin z sesji), bez anon');

SELECT * FROM finish();
ROLLBACK;
