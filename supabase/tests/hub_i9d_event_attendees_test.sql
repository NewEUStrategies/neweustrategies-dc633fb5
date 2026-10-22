-- pgTAP: retencja uczestników wydarzeń (I9d-Y1, Z-I9c-07; migracje
-- 20261020161800 i rdzeń katalogu 20261020162200; decyzja właściciela
-- 2026-10-20: anonimizacja 24 mies. od ostatniego udziału/rejestracji).
--
-- CO PRZYPINA:
--   * kandydat: osoba bez konta, nie prelegent, bez aktywności od progu
--     (zgłoszenie, obecność, anulowanie, termin wydarzenia - przyszłe
--     wydarzenie chroni zapis) i bez płatności w terminie dowodów
--     księgowych (`accounting_retention_until`);
--   * anonimizacja: imię i nazwisko `[redacted]`, kontakt, opisy, zdjęcie,
--     linki NULL/puste; kopie w zgłoszeniach (odpowiedzi, profil przysłany,
--     powody) wyczyszczone, notatka decyzji `[redacted]` (CHECK odrzucenia);
--     obecność, status, płatność, daty, źródło, pola zgrubne i KAŻDA zgoda
--     (także partnerska - raporty sponsorów) zostają;
--   * podgląd i najemca w karencji niczego nie zmieniają; powtórka = 0;
--     usunięcie konta czyni osobę kandydatem; ACL.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_event_attendees
BEGIN;
SELECT plan(15);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, created_at) VALUES
  ('19d30000-0000-4000-8000-0000000000a0', 'i9d-wydarzenia-a', 'I9d Wydarzenia A', now() - interval '30 days'),
  ('19d30000-0000-4000-8000-0000000000b0', 'i9d-wydarzenia-b', 'I9d Wydarzenia B', now());
INSERT INTO auth.users (id, email) VALUES
  ('19d30000-0000-4000-8000-00000000e004', 'konto@i9d-wydarzenia.test');

CREATE FUNCTION pg_temp.ts(p interval) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() - p $$;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at) VALUES
  ('19d30000-0000-4000-8000-0000000000e1', '19d30000-0000-4000-8000-0000000000a0', 'i9d-stare', 'Stare', 'Old',
   pg_temp.ts('30 months'), pg_temp.ts('30 months') + interval '4 hours'),
  ('19d30000-0000-4000-8000-0000000000e2', '19d30000-0000-4000-8000-0000000000a0', 'i9d-swieze', 'Świeże', 'Recent',
   pg_temp.ts('10 months'), NULL),
  ('19d30000-0000-4000-8000-0000000000e3', '19d30000-0000-4000-8000-0000000000a0', 'i9d-przyszle', 'Przyszłe', 'Future',
   now() + interval '2 months', NULL),
  ('19d30000-0000-4000-8000-0000000000e4', '19d30000-0000-4000-8000-0000000000a0', 'i9d-dawne', 'Dawne', 'Ancient',
   pg_temp.ts('8 years'), NULL),
  ('19d30000-0000-4000-8000-0000000000e5', '19d30000-0000-4000-8000-0000000000b0', 'i9d-stare-b', 'Stare B', 'Old B',
   pg_temp.ts('30 months'), NULL);

-- Osoba z KOMPLETEM danych (kontakt, opisy, zgody); p_user - konto.
CREATE FUNCTION pg_temp.person(p_id text, p_tenant text, p_created interval, p_user text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.event_people (
    id, tenant_id, user_id, first_name, last_name, email, phone, job_title, company_text, social_profile_url, notes,
    photo_url, bio_pl, bio_en, seeking_pl, seeking_en, offering_pl, offering_en, social_links, email_visible,
    phone_visible, industry, specialization, source, consent_data_processing_at, consent_marketing_at,
    consent_partner_sharing_at, created_at)
  VALUES (
    p_id::uuid, p_tenant::uuid, p_user::uuid, 'Anna', 'Kowalska-' || right(p_id, 2),
    'osoba-' || right(p_id, 2) || '@i9d-wydarzenia.test', '+48 600 200 300', 'Analityczka', 'Instytut',
    'https://www.linkedin.com/in/anna', 'Notatka organizatora', 'https://cdn.example/anna.jpg', 'Bio PL', 'Bio EN',
    'Szukam', 'Seeking', 'Oferuję', 'Offering', '{"x": "https://x.com/anna"}', true, true, 'energia', 'gaz',
    'self_registration', pg_temp.ts(p_created), pg_temp.ts(p_created), pg_temp.ts(p_created), pg_temp.ts(p_created))
$$;
-- Zgłoszenie z kopiami danych osoby.
CREATE FUNCTION pg_temp.reg(p_person text, p_event text, p_created interval, p_status text DEFAULT 'approved',
                            p_paid interval DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, registration_mode, status, attended_at, cancelled_at, decided_at, decision_source,
    decision_note, answers, submitted_profile, participant_reason, cancel_reason, payment_status, paid_at,
    consent_partner_sharing_at, created_at)
  SELECT p.tenant_id, p_event::uuid, p.id, 'form', p_status,
         CASE WHEN p_status = 'attended' THEN pg_temp.ts(p_created) END,
         CASE WHEN p_status = 'cancelled' THEN pg_temp.ts('5 months') END,
         CASE WHEN p_status = 'rejected' THEN pg_temp.ts(p_created) END,
         CASE WHEN p_status = 'rejected' THEN 'organizer' END,
         CASE WHEN p_status = 'rejected' THEN 'Brak miejsc dla Anny Kowalskiej' END,
         '{"firma": "Instytut", "telefon": "+48 600 200 300"}', '{"email": "anna@i9d-wydarzenia.test"}',
         'Chcę poznać Annę', CASE WHEN p_status = 'cancelled' THEN 'Choroba Anny' END,
         CASE WHEN p_paid IS NULL THEN 'not_required' ELSE 'paid' END,
         CASE WHEN p_paid IS NULL THEN NULL ELSE pg_temp.ts(p_paid) END,
         pg_temp.ts(p_created), pg_temp.ts(p_created)
    FROM public.event_people p WHERE p.id = p_person::uuid
$$;

-- P1: bez konta, obecność na wydarzeniu sprzed 30 mies. -> anonimizacja.
SELECT pg_temp.person('19d30000-0000-4000-8000-0000000000d1', '19d30000-0000-4000-8000-0000000000a0', '31 months');
SELECT pg_temp.reg('19d30000-0000-4000-8000-0000000000d1', '19d30000-0000-4000-8000-0000000000e1', '30 months', 'attended');
-- P2: zgłoszenie na wydarzenie sprzed 10 mies. -> zostaje.
SELECT pg_temp.person('19d30000-0000-4000-8000-0000000000d2', '19d30000-0000-4000-8000-0000000000a0', '31 months');
SELECT pg_temp.reg('19d30000-0000-4000-8000-0000000000d2', '19d30000-0000-4000-8000-0000000000e2', '11 months');
-- P3: dawny zapis na PRZYSZŁE wydarzenie -> zostaje.
SELECT pg_temp.person('19d30000-0000-4000-8000-0000000000d3', '19d30000-0000-4000-8000-0000000000a0', '31 months');
SELECT pg_temp.reg('19d30000-0000-4000-8000-0000000000d3', '19d30000-0000-4000-8000-0000000000e3', '31 months');
-- P4: powiązana z ISTNIEJĄCYM kontem -> zostaje (historia w profilu).
SELECT pg_temp.person('19d30000-0000-4000-8000-0000000000d4', '19d30000-0000-4000-8000-0000000000a0', '31 months',
                      '19d30000-0000-4000-8000-00000000e004');
SELECT pg_temp.reg('19d30000-0000-4000-8000-0000000000d4', '19d30000-0000-4000-8000-0000000000e1', '30 months', 'attended');
-- P5: płatne zgłoszenie sprzed 3 lat (dowód księgowy w terminie) -> zostaje.
SELECT pg_temp.person('19d30000-0000-4000-8000-0000000000d5', '19d30000-0000-4000-8000-0000000000a0', '3 years');
SELECT pg_temp.reg('19d30000-0000-4000-8000-0000000000d5', '19d30000-0000-4000-8000-0000000000e1', '3 years', 'approved',
                   '3 years');
-- P6: płatne zgłoszenie sprzed 8 lat (termin dowodów minął) -> anonimizacja.
SELECT pg_temp.person('19d30000-0000-4000-8000-0000000000d6', '19d30000-0000-4000-8000-0000000000a0', '8 years');
SELECT pg_temp.reg('19d30000-0000-4000-8000-0000000000d6', '19d30000-0000-4000-8000-0000000000e4', '8 years', 'approved',
                   '8 years');
-- P7: prelegent bez konta (publiczna karta) -> poza kategorią.
SELECT pg_temp.person('19d30000-0000-4000-8000-0000000000d7', '19d30000-0000-4000-8000-0000000000a0', '31 months');
INSERT INTO public.speaker_profiles (tenant_id, person_id)
VALUES ('19d30000-0000-4000-8000-0000000000a0', '19d30000-0000-4000-8000-0000000000d7');
-- P8: odrzucony przez organizatora 30 mies. temu (powód wymagany CHECK-iem).
SELECT pg_temp.person('19d30000-0000-4000-8000-0000000000d8', '19d30000-0000-4000-8000-0000000000a0', '31 months');
SELECT pg_temp.reg('19d30000-0000-4000-8000-0000000000d8', '19d30000-0000-4000-8000-0000000000e1', '30 months', 'rejected');
-- P9: dawne zgłoszenie, anulowane 5 mies. temu (aktywność) -> zostaje.
SELECT pg_temp.person('19d30000-0000-4000-8000-0000000000d9', '19d30000-0000-4000-8000-0000000000a0', '31 months');
SELECT pg_temp.reg('19d30000-0000-4000-8000-0000000000d9', '19d30000-0000-4000-8000-0000000000e1', '30 months', 'cancelled');
-- B (karencja): osoba sprzed 30 mies.
SELECT pg_temp.person('19d30000-0000-4000-8000-0000000000da', '19d30000-0000-4000-8000-0000000000b0', '31 months');
SELECT pg_temp.reg('19d30000-0000-4000-8000-0000000000da', '19d30000-0000-4000-8000-0000000000e5', '30 months', 'attended');

CREATE TEMP TABLE snap ON COMMIT DROP AS
SELECT p.id, p.email, p.first_name, p.consent_data_processing_at, p.consent_marketing_at,
       p.consent_partner_sharing_at, p.consent_withdrawn_at, p.source, p.created_at, p.industry, p.specialization,
       public._event_partner_consent_at(p.tenant_id, '19d30000-0000-4000-8000-0000000000e1', p.id) AS partner_at
  FROM public.event_people p
 WHERE p.tenant_id IN ('19d30000-0000-4000-8000-0000000000a0', '19d30000-0000-4000-8000-0000000000b0');
CREATE TEMP TABLE snap_reg ON COMMIT DROP AS
SELECT r.id, r.person_id, r.status, r.attended_at, r.payment_status, r.paid_at, r.created_at, r.source,
       r.consent_partner_sharing_at, r.ticket_type_id, r.registration_mode
  FROM public.event_registrations r
 WHERE r.tenant_id = '19d30000-0000-4000-8000-0000000000a0';

-- ── Podgląd i karencja ───────────────────────────────────────────────────────
SELECT is(
  (public._data_retention_event_attendees('19d30000-0000-4000-8000-0000000000a0', pg_temp.ts('24 months'),
                                          false, 100) ->> 'affected')::int,
  3, 'podgląd: 3 kandydatów (obecność sprzed 30 mies., płatność sprzed 8 lat, odrzucenie sprzed 30 mies.)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_people p JOIN snap s ON s.id = p.id
               WHERE p.email IS DISTINCT FROM s.email OR p.anonymized_at IS NOT NULL),
  'podgląd niczego nie zmienia');

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
INSERT INTO r SELECT 'b', public._data_retention_run_tenant('19d30000-0000-4000-8000-0000000000b0', 'schedule', 1000);
SELECT ok(
  (SELECT v -> 'event_attendees' ->> 'mode' = 'preview' AND (v -> 'event_attendees' ->> 'affected')::int = 1
     FROM r WHERE k = 'b')
  AND (SELECT email = 'osoba-da@i9d-wydarzenia.test' AND anonymized_at IS NULL FROM public.event_people
        WHERE id = '19d30000-0000-4000-8000-0000000000da'),
  'najemca w karencji: przebieg w trybie podglądu liczy, osoba bez zmian');

-- ── Wykonanie ────────────────────────────────────────────────────────────────
INSERT INTO r SELECT 'a1', public._data_retention_run_tenant('19d30000-0000-4000-8000-0000000000a0', 'schedule', 1000);
SELECT ok(
  (SELECT v -> 'event_attendees' ->> 'mode' = 'execute' AND (v -> 'event_attendees' ->> 'affected')::int = 3
          AND (v -> 'event_attendees' ->> 'registrations')::int = 3
     FROM r WHERE k = 'a1')
  AND EXISTS (SELECT 1 FROM public.data_retention_runs
               WHERE tenant_id = '19d30000-0000-4000-8000-0000000000a0' AND category = 'event_attendees'
                 AND mode = 'execute' AND affected = 3 AND error_code IS NULL),
  'wykonanie: 3 osoby i ich 3 zgłoszenia, wiersz przebiegu bez błędu');

SELECT ok(
  (SELECT count(*) = 3 AND bool_and(
            p.first_name = '[redacted]' AND p.last_name = '[redacted]' AND p.email IS NULL AND p.phone IS NULL
            AND p.job_title IS NULL AND p.company_text IS NULL AND p.social_profile_url IS NULL AND p.notes IS NULL
            AND p.photo_url IS NULL AND p.bio_pl IS NULL AND p.bio_en IS NULL AND p.seeking_pl IS NULL
            AND p.seeking_en IS NULL AND p.offering_pl IS NULL AND p.offering_en IS NULL AND p.social_links = '{}'
            AND NOT p.email_visible AND NOT p.phone_visible AND p.anonymized_at IS NOT NULL)
     FROM public.event_people p
    WHERE p.id IN ('19d30000-0000-4000-8000-0000000000d1', '19d30000-0000-4000-8000-0000000000d6',
                   '19d30000-0000-4000-8000-0000000000d8')),
  'anonimizacja osoby: imię i nazwisko [redacted], kontakt, opisy, zdjęcie i linki usunięte, znacznik anonymized_at');

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.event_people p JOIN snap s ON s.id = p.id
     WHERE p.id IN ('19d30000-0000-4000-8000-0000000000d1', '19d30000-0000-4000-8000-0000000000d6',
                    '19d30000-0000-4000-8000-0000000000d8')
       AND (p.consent_data_processing_at IS DISTINCT FROM s.consent_data_processing_at
            OR p.consent_marketing_at IS DISTINCT FROM s.consent_marketing_at
            OR p.consent_partner_sharing_at IS DISTINCT FROM s.consent_partner_sharing_at
            OR p.consent_withdrawn_at IS DISTINCT FROM s.consent_withdrawn_at
            OR p.source IS DISTINCT FROM s.source OR p.created_at IS DISTINCT FROM s.created_at
            OR p.industry IS DISTINCT FROM s.industry OR p.specialization IS DISTINCT FROM s.specialization
            OR public._event_partner_consent_at(p.tenant_id, '19d30000-0000-4000-8000-0000000000e1', p.id)
               IS DISTINCT FROM s.partner_at)),
  'zostają: zgody (przetwarzanie, marketing, partnerska - raport sponsora), źródło, data założenia, pola zgrubne');

SELECT ok(
  (SELECT bool_and(r.answers = '{}' AND r.submitted_profile IS NULL AND r.participant_reason IS NULL
                   AND r.cancel_reason IS NULL)
     FROM public.event_registrations r
    WHERE r.person_id IN ('19d30000-0000-4000-8000-0000000000d1', '19d30000-0000-4000-8000-0000000000d6',
                          '19d30000-0000-4000-8000-0000000000d8'))
  AND (SELECT decision_note = '[redacted]' AND status = 'rejected' FROM public.event_registrations
        WHERE person_id = '19d30000-0000-4000-8000-0000000000d8')
  AND NOT EXISTS (
    SELECT 1 FROM public.event_registrations r JOIN snap_reg s ON s.id = r.id
     WHERE r.status IS DISTINCT FROM s.status OR r.attended_at IS DISTINCT FROM s.attended_at
        OR r.payment_status IS DISTINCT FROM s.payment_status OR r.paid_at IS DISTINCT FROM s.paid_at
        OR r.created_at IS DISTINCT FROM s.created_at OR r.source IS DISTINCT FROM s.source
        OR r.consent_partner_sharing_at IS DISTINCT FROM s.consent_partner_sharing_at
        OR r.ticket_type_id IS DISTINCT FROM s.ticket_type_id OR r.registration_mode IS DISTINCT FROM s.registration_mode),
  'zgłoszenia: kopie danych wyczyszczone, notatka odrzucenia [redacted]; obecność, status, płatność, daty, źródło, bilet i zgoda partnerska zostają');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.event_people p JOIN snap s ON s.id = p.id
               WHERE p.id IN ('19d30000-0000-4000-8000-0000000000d2', '19d30000-0000-4000-8000-0000000000d3',
                              '19d30000-0000-4000-8000-0000000000d4', '19d30000-0000-4000-8000-0000000000d5',
                              '19d30000-0000-4000-8000-0000000000d7', '19d30000-0000-4000-8000-0000000000d9')
                 AND (p.email IS DISTINCT FROM s.email OR p.first_name IS DISTINCT FROM s.first_name
                      OR p.anonymized_at IS NOT NULL))
  AND (SELECT answers <> '{}' FROM public.event_registrations WHERE person_id = '19d30000-0000-4000-8000-0000000000d2'),
  'nietknięci: świeże zgłoszenie, przyszłe wydarzenie, konto, płatność w terminie dowodów, prelegent, świeże anulowanie');

INSERT INTO r SELECT 'a2', public._data_retention_run_tenant('19d30000-0000-4000-8000-0000000000a0', 'schedule', 1000);
SELECT is((SELECT (v -> 'event_attendees' ->> 'affected')::int FROM r WHERE k = 'a2'), 0,
  'idempotencja: powtórka nie znajduje kandydatów');

-- Próg 12 mies.: dochodzi tylko zgłoszenie sprzed 11 mies.? Nie - wydarzenie
-- sprzed 10 mies. trzyma osobę; anulowanie sprzed 5 mies. też.
SELECT is(
  (public._data_retention_event_attendees('19d30000-0000-4000-8000-0000000000a0', pg_temp.ts('12 months'),
                                          false, 100) ->> 'affected')::int,
  0, 'okres 12 mies.: termin wydarzenia (10 mies.) i anulowanie (5 mies.) liczą się jako aktywność');
SELECT is(
  (public._data_retention_event_attendees('19d30000-0000-4000-8000-0000000000a0', pg_temp.ts('9 months'),
                                          false, 100) ->> 'affected')::int,
  1, 'próg 9 mies.: tylko osoba ze zgłoszeniem na wydarzenie sprzed 10 mies.');

-- Usunięcie konta (klucz obcy SET NULL) czyni osobę kandydatem.
DELETE FROM auth.users WHERE id = '19d30000-0000-4000-8000-00000000e004';
SELECT ok(
  (SELECT user_id IS NULL AND anonymized_at IS NULL FROM public.event_people WHERE id = '19d30000-0000-4000-8000-0000000000d4')
  AND (public._data_retention_event_attendees('19d30000-0000-4000-8000-0000000000a0', pg_temp.ts('24 months'),
                                              false, 100) ->> 'affected')::int = 1,
  'po usunięciu konta osoba (historia sprzed 30 mies.) wchodzi w regułę 24 mies.');

-- Prelegent z dawną obecnością nadal poza kategorią.
SELECT pg_temp.reg('19d30000-0000-4000-8000-0000000000d7', '19d30000-0000-4000-8000-0000000000e1', '30 months', 'attended');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public._data_retention_event_attendee_candidates('19d30000-0000-4000-8000-0000000000a0',
                                                                             pg_temp.ts('24 months'), 100) c
               WHERE c = '19d30000-0000-4000-8000-0000000000d7'),
  'prelegent bez konta (publiczna karta) wyłączony z kategorii');

-- ── Schemat i ACL ────────────────────────────────────────────────────────────
SELECT has_column('public', 'event_people', 'anonymized_at', 'event_people.anonymized_at - znacznik anonimizacji');
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
             'public._data_retention_event_attendee_candidates(uuid, timestamptz, integer)',
             'public._data_retention_event_attendees(uuid, timestamptz, boolean, integer)']) f,
           unnest(ARRAY['anon', 'authenticated', 'service_role']) r
     WHERE has_function_privilege(r, f, 'EXECUTE')),
  'acl: kandydaci i funkcja kategorii - bez EXECUTE dla ról API');

SELECT * FROM finish();
ROLLBACK;
